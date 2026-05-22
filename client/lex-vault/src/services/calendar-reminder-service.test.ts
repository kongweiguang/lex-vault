import { describe, expect, it } from "vitest";

import {
  buildCalendarReminderMessage,
  collectDueCalendarReminders,
  collectDueRecurringCalendarReminders,
} from "@/services/calendar-reminder-service";
import type {
  CalendarEventRecord,
  CalendarScheduleItem,
  RecurringCalendarChannel,
  RecurringCalendarOccurrence,
  RecurringCalendarRule,
} from "@/types/domain";

function buildEvent(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: "event-1",
    title: "提交答辩状",
    description: "",
    eventType: "DEADLINE",
    startAt: "2026-05-20T10:30:00.000Z",
    endAt: "2026-05-20T10:30:00.000Z",
    allDay: false,
    timezone: "Asia/Shanghai",
    status: "SCHEDULED",
    priority: 3,
    caseId: "case-1",
    casePathSnapshot: "C:/workspace/cases/case-1",
    ownerUserLabel: "张律师",
    participantLabels: [],
    sourceType: "MANUAL",
    sourceTextSnapshot: "",
    externalProvider: "",
    externalEventId: "",
    reminders: [{ offsetMinutes: 30, channel: "DESKTOP" }],
    createdAt: "2026-05-18T00:00:00Z",
    updatedAt: "2026-05-18T00:00:00Z",
    isOverdue: false,
    isDueToday: true,
    isUpcoming: false,
    ...overrides,
  };
}

function buildRecurringItem(overrides: Partial<RecurringCalendarOccurrence> = {}): CalendarScheduleItem {
  const channels: RecurringCalendarChannel[] = ["WECHAT_SELF"];
  const rule: RecurringCalendarRule = {
    id: "rule-1",
    title: "写周报",
    originalText: "每周五 18 点微信提醒我写周报",
    cron: "0 18 * * 5",
    timezone: "Asia/Shanghai",
    eventType: "FOLLOW_UP" as const,
    message: "写周报",
    channels,
    status: "ACTIVE" as const,
    startAt: "2026-05-20T00:00:00.000Z",
    endAt: "",
    caseId: "",
    casePathSnapshot: "",
    ownerUserLabel: "",
    sourceType: "AI_CREATED" as const,
    createdAt: "2026-05-18T00:00:00Z",
    updatedAt: "2026-05-18T00:00:00Z",
  };
  const occurrence: RecurringCalendarOccurrence = {
    id: "recurring:rule-1:2026-05-22T10:00:00.000Z",
    ruleId: "rule-1",
    title: "写周报",
    eventType: "FOLLOW_UP" as const,
    scheduledAt: "2026-05-22T10:00:00.000Z",
    startAt: "2026-05-22T10:00:00.000Z",
    endAt: "2026-05-22T10:00:00.000Z",
    timezone: "Asia/Shanghai",
    message: "写周报",
    channels,
    deliveredChannels: [],
    caseId: "",
    casePathSnapshot: "",
    ownerUserLabel: "",
    sourceType: "AI_CREATED" as const,
    rule,
    ...overrides,
  };
  return {
    itemType: "RECURRING_OCCURRENCE",
    occurrence,
  };
}

describe("calendar-reminder-service", () => {
  it("collects reminders that just reached their notification time", () => {
    const dueItems = collectDueCalendarReminders(
      [buildEvent()],
      new Date("2026-05-20T10:00:30.000Z"),
      {},
    );

    expect(dueItems).toHaveLength(1);
    expect(dueItems[0].offsetMinutes).toBe(30);
    expect(dueItems[0].channel).toBe("DESKTOP");
  });

  it("skips reminders that were already notified", () => {
    const event = buildEvent();
    const dueItems = collectDueCalendarReminders(
      [event],
      new Date("2026-05-20T10:00:30.000Z"),
      {
        [`${event.id}:${event.startAt}:30:DESKTOP`]: Date.now(),
      },
    );

    expect(dueItems).toEqual([]);
  });

  it("collects manual reminders separately for each selected channel", () => {
    const dueItems = collectDueCalendarReminders(
      [
        buildEvent({
          reminders: [
            { offsetMinutes: 30, channel: "DESKTOP" },
            { offsetMinutes: 30, channel: "WECHAT_SELF" },
          ],
        }),
      ],
      new Date("2026-05-20T10:00:30.000Z"),
      {},
    );

    expect(dueItems.map((item) => item.channel)).toEqual(["DESKTOP", "WECHAT_SELF"]);
  });

  it("skips non-scheduled events", () => {
    const dueItems = collectDueCalendarReminders(
      [buildEvent({ status: "DONE" })],
      new Date("2026-05-20T10:00:30.000Z"),
      {},
    );

    expect(dueItems).toEqual([]);
  });

  it("builds a readable reminder message", () => {
    const [item] = collectDueCalendarReminders(
      [buildEvent()],
      new Date("2026-05-20T10:00:30.000Z"),
      {},
    );

    expect(buildCalendarReminderMessage(item)).toContain("提交答辩状 将于");
    expect(buildCalendarReminderMessage(item)).toContain("30 分钟前提醒");
  });

  it("collects due recurring reminders by channel and skips delivered channels", () => {
    const dueItems = collectDueRecurringCalendarReminders(
      [buildRecurringItem()],
      new Date("2026-05-22T10:00:30.000Z"),
      {},
    );

    expect(dueItems).toHaveLength(1);
    expect(dueItems[0].channel).toBe("WECHAT_SELF");
    expect(buildCalendarReminderMessage(dueItems[0])).toContain("周期日程");

    const skippedItems = collectDueRecurringCalendarReminders(
      [buildRecurringItem({ deliveredChannels: ["WECHAT_SELF"] })],
      new Date("2026-05-22T10:00:30.000Z"),
      {},
    );
    expect(skippedItems).toEqual([]);
  });
});
