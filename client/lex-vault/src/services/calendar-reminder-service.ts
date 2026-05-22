import dayjs from "dayjs";

import { listCalendarScheduleItems, markRecurringCalendarDelivery } from "@/services/calendar-service";
import { notify } from "@/services/notification-service";
import { sendWechatMessage } from "@/services/wechat-service";
import type {
  CalendarEventRecord,
  CalendarScheduleItem,
  RecurringCalendarChannel,
  RecurringCalendarOccurrence,
} from "@/types/domain";

const REMINDER_STORAGE_KEY = "lex-vault.calendar.reminders.notified";
const POLL_INTERVAL_MS = 60 * 1000;
const REMINDER_LOOKBACK_MS = 2 * 60 * 1000;
const REMINDER_LOOKAHEAD_DAYS = 8;
const MAX_STORED_REMINDER_KEYS = 500;

export type CalendarReminderDueItem = {
  kind: "EVENT";
  event: CalendarEventRecord;
  channel: RecurringCalendarChannel;
  offsetMinutes: number;
  reminderAt: Date;
  dedupeKey: string;
};

export type RecurringCalendarReminderDueItem = {
  kind: "RECURRING_OCCURRENCE";
  occurrence: RecurringCalendarOccurrence;
  channel: RecurringCalendarChannel;
  offsetMinutes: 0;
  reminderAt: Date;
  dedupeKey: string;
};

export type CalendarReminderQueueItem = CalendarReminderDueItem | RecurringCalendarReminderDueItem;

type StoredReminderState = Record<string, number>;

/** 启动日历提醒轮询器。 */
export function startCalendarReminderWatcher() {
  let stopped = false;
  let checking = false;

  async function tick() {
    if (stopped || checking) {
      return;
    }
    checking = true;
    try {
      await checkCalendarReminders(new Date());
    } catch (error) {
      console.error("检查日历提醒失败", error);
    } finally {
      checking = false;
    }
  }

  void tick();
  const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

/** 扫描当前应触发的提醒并发送通知。 */
export async function checkCalendarReminders(now: Date) {
  const items = await listCalendarScheduleItems({
    startAtFrom: dayjs(now).subtract(REMINDER_LOOKBACK_MS, "millisecond").toISOString(),
    startAtTo: dayjs(now).add(REMINDER_LOOKAHEAD_DAYS, "day").toISOString(),
    statuses: ["SCHEDULED"],
  });
  const storedState = readStoredReminderState();
  const dueItems = collectDueCalendarScheduleReminders(items, now, storedState);

  for (const item of dueItems) {
    const message = buildCalendarReminderMessage(item);
    if (item.kind === "RECURRING_OCCURRENCE") {
      await dispatchRecurringReminder(item, message);
    } else {
      await dispatchEventReminder(item, message).catch((error) => {
        console.error(`发送日历提醒失败：${item.channel}`, error);
      });
    }
    storedState[item.dedupeKey] = now.getTime();
  }

  if (dueItems.length) {
    writeStoredReminderState(trimStoredReminderState(storedState));
  }
}

/** 从事项列表中挑出当前到期且未提醒过的提醒项。 */
export function collectDueCalendarReminders(
  events: CalendarEventRecord[],
  now: Date,
  notifiedState: StoredReminderState,
) {
  const nowTime = now.getTime();
  const earliestTime = nowTime - REMINDER_LOOKBACK_MS;
  const dueItems: CalendarReminderDueItem[] = [];

  for (const event of events) {
    if (event.status !== "SCHEDULED") {
      continue;
    }
    const startTime = new Date(event.startAt).getTime();
    if (!Number.isFinite(startTime)) {
      continue;
    }
    for (const reminder of event.reminders) {
      const offsetMinutes = Math.max(0, Math.trunc(reminder.offsetMinutes));
      const channel = reminder.channel ?? "DESKTOP";
      const reminderTime = startTime - offsetMinutes * 60 * 1000;
      const dedupeKey = buildCalendarReminderKey(event, offsetMinutes, channel);
      const legacyDedupeKey = `${event.id}:${event.startAt}:${offsetMinutes}`;
      if (notifiedState[dedupeKey] || (channel === "DESKTOP" && notifiedState[legacyDedupeKey])) {
        continue;
      }
      if (reminderTime <= nowTime && reminderTime >= earliestTime) {
        dueItems.push({
          kind: "EVENT",
          event,
          channel,
          offsetMinutes,
          reminderAt: new Date(reminderTime),
          dedupeKey,
        });
      }
    }
  }

  return dueItems.sort((left, right) => left.reminderAt.getTime() - right.reminderAt.getTime());
}

/** 从聚合日程项中挑出普通事项提醒和周期执行点提醒。 */
export function collectDueCalendarScheduleReminders(
  items: CalendarScheduleItem[],
  now: Date,
  notifiedState: StoredReminderState,
) {
  const eventDueItems = collectDueCalendarReminders(
    items.flatMap((item) => (item.itemType === "EVENT" && item.event ? [item.event] : [])),
    now,
    notifiedState,
  );
  const recurringDueItems = collectDueRecurringCalendarReminders(items, now, notifiedState);
  return [...eventDueItems, ...recurringDueItems].sort(
    (left, right) => left.reminderAt.getTime() - right.reminderAt.getTime(),
  );
}

export function collectDueRecurringCalendarReminders(
  items: CalendarScheduleItem[],
  now: Date,
  notifiedState: StoredReminderState,
) {
  const nowTime = now.getTime();
  const earliestTime = nowTime - REMINDER_LOOKBACK_MS;
  const dueItems: RecurringCalendarReminderDueItem[] = [];

  for (const item of items) {
    if (item.itemType !== "RECURRING_OCCURRENCE" || !item.occurrence) {
      continue;
    }
    const scheduledTime = new Date(item.occurrence.scheduledAt).getTime();
    if (!Number.isFinite(scheduledTime) || scheduledTime > nowTime || scheduledTime < earliestTime) {
      continue;
    }
    for (const channel of item.occurrence.channels) {
      if (item.occurrence.deliveredChannels.includes(channel)) {
        continue;
      }
      const dedupeKey = buildRecurringCalendarReminderKey(item.occurrence, channel);
      if (notifiedState[dedupeKey]) {
        continue;
      }
      dueItems.push({
        kind: "RECURRING_OCCURRENCE",
        occurrence: item.occurrence,
        channel,
        offsetMinutes: 0,
        reminderAt: new Date(scheduledTime),
        dedupeKey,
      });
    }
  }

  return dueItems.sort((left, right) => left.reminderAt.getTime() - right.reminderAt.getTime());
}

export function buildCalendarReminderMessage(item: CalendarReminderQueueItem) {
  if (item.kind === "RECURRING_OCCURRENCE") {
    const eventTime = dayjs(item.occurrence.scheduledAt).format("YYYY-MM-DD HH:mm");
    const content = item.occurrence.message || item.occurrence.title;
    const caseText = item.occurrence.caseId ? "，已关联案件" : "";
    return `${content}（周期日程，${eventTime}${caseText}）。`;
  }
  const eventTime = dayjs(item.event.startAt).format("YYYY-MM-DD HH:mm");
  const reminderText = formatReminderOffset(item.offsetMinutes);
  const caseText = item.event.caseId ? "，已关联案件" : "";
  return `${item.event.title} 将于 ${eventTime} 开始（${reminderText}提醒${caseText}）。`;
}

async function dispatchRecurringReminder(item: RecurringCalendarReminderDueItem, message: string) {
  try {
    if (item.channel === "DESKTOP") {
      await notify({
        kind: "calendar-reminder",
        title: "周期日程提醒",
        body: message,
      });
    } else if (item.channel === "WECHAT_SELF") {
      await sendWechatMessage(message);
    }
  } catch (error) {
    console.error(`发送周期日程提醒失败：${item.channel}`, error);
  } finally {
    await markRecurringCalendarDelivery({
      ruleId: item.occurrence.ruleId,
      scheduledAt: item.occurrence.scheduledAt,
      channel: item.channel,
    }).catch((error) => {
      console.error("记录周期日程提醒投递失败", error);
    });
  }
}

async function dispatchEventReminder(item: CalendarReminderDueItem, message: string) {
  if (item.channel === "DESKTOP") {
    await notify({
      kind: "calendar-reminder",
      title: "日历提醒",
      body: message,
    });
  } else if (item.channel === "WECHAT_SELF") {
    await sendWechatMessage(message);
  }
}

function buildCalendarReminderKey(event: CalendarEventRecord, offsetMinutes: number, channel: RecurringCalendarChannel) {
  return `${event.id}:${event.startAt}:${offsetMinutes}:${channel}`;
}

function buildRecurringCalendarReminderKey(
  occurrence: RecurringCalendarOccurrence,
  channel: RecurringCalendarChannel,
) {
  return `recurring:${occurrence.ruleId}:${occurrence.scheduledAt}:${channel}`;
}

function formatReminderOffset(offsetMinutes: number) {
  if (offsetMinutes === 0) {
    return "开始时";
  }
  if (offsetMinutes % 1440 === 0) {
    return `${offsetMinutes / 1440} 天前`;
  }
  if (offsetMinutes % 60 === 0) {
    return `${offsetMinutes / 60} 小时前`;
  }
  return `${offsetMinutes} 分钟前`;
}

function readStoredReminderState(): StoredReminderState {
  try {
    const raw = window.localStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredReminderState(state: StoredReminderState) {
  window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(state));
}

function trimStoredReminderState(state: StoredReminderState) {
  return Object.fromEntries(
    Object.entries(state)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_STORED_REMINDER_KEYS),
  );
}
