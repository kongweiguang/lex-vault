import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  PauseCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Calendar as BigCalendar,
  dayjsLocalizer,
  Views,
  type EventProps,
  type SlotInfo,
  type View,
} from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { showAlert, showConfirm } from "@/services/dialog-service";
import {
  applyCalendarTemplate,
  completeCalendarEvent,
  createCalendarEvent,
  deleteCalendarEvent,
  deleteRecurringCalendarRule,
  listCalendarScheduleItems,
  listCalendarTemplates,
  pauseRecurringCalendarRule,
  searchCalendarConflicts,
  updateCalendarEvent,
  type CalendarEventMutationInput,
} from "@/services/calendar-service";
import type {
  CalendarEventRecord,
  CalendarEventStatus,
  CalendarEventType,
  CalendarScheduleItem,
  CalendarTemplateRecord,
  CaseRecord,
  RecurringCalendarChannel,
} from "@/types/domain";
import {
  CALENDAR_EVENT_TYPE_OPTIONS,
  CALENDAR_STATUS_OPTIONS,
  calendarEventColor,
  presentCalendarEventType,
  summarizeDeadlineState,
  toLocalDateTimeInput,
} from "@/features/calendar/calendar-helpers";

dayjs.locale("zh-cn");

const localizer = dayjsLocalizer(dayjs);

/**
 * @author kongweiguang
 * react-big-calendar 中文消息，覆盖默认英文按钮、表头和空状态提示。
 */
export const CALENDAR_MESSAGES = {
  allDay: "全天",
  previous: "上一页",
  next: "下一页",
  today: "今天",
  month: "月",
  week: "周",
  work_week: "工作周",
  day: "日",
  agenda: "日程",
  date: "日期",
  time: "时间",
  event: "事项",
  noEventsInRange: "当前时间范围暂无事项",
  showMore: (count: number) => `另有 ${count} 项`,
};

type CalendarUiEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: CalendarScheduleItem;
};

type CalendarScheduleAgendaDay = {
  day: string;
  items: CalendarScheduleItem[];
};

type CalendarFormState = {
  id?: string;
  title: string;
  description: string;
  eventType: CalendarEventType;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  status: CalendarEventStatus;
  priority: number;
  caseId: string;
  ownerUserLabel: string;
  participantLabels: string;
  sourceType: CalendarEventRecord["sourceType"];
  reminderPresetValue: string;
  reminderChannels: RecurringCalendarChannel[];
};

type CalendarFormErrors = Partial<Record<"title" | "startAt" | "endAt", string>>;

type CalendarReminderPreset = {
  value: string;
  label: string;
  offsetMinutes: number[];
};

const CUSTOM_REMINDER_PRESET_PREFIX = "CUSTOM:";
const DEFAULT_REMINDER_PRESET_VALUE = "DAY_AND_HALF_HOUR_BEFORE";

export const CALENDAR_REMINDER_PRESETS: CalendarReminderPreset[] = [
  { value: "NONE", label: "不提醒", offsetMinutes: [] },
  { value: "AT_START", label: "开始时", offsetMinutes: [0] },
  { value: "MINUTES_15_BEFORE", label: "15 分钟前", offsetMinutes: [15] },
  { value: "MINUTES_30_BEFORE", label: "30 分钟前", offsetMinutes: [30] },
  { value: "HOUR_1_BEFORE", label: "1 小时前", offsetMinutes: [60] },
  { value: "DAY_1_BEFORE", label: "1 天前", offsetMinutes: [1440] },
  { value: DEFAULT_REMINDER_PRESET_VALUE, label: "1 天前 + 30 分钟前", offsetMinutes: [1440, 30] },
  { value: "DAYS_3_AND_DAY_1_BEFORE", label: "3 天前 + 1 天前", offsetMinutes: [4320, 1440] },
  { value: "DAYS_7_AND_DAY_1_BEFORE", label: "7 天前 + 1 天前", offsetMinutes: [10080, 1440] },
];

const DEFAULT_FORM: CalendarFormState = {
  title: "",
  description: "",
  eventType: "MEETING",
  startAt: dayjs().add(1, "hour").format("YYYY-MM-DDTHH:mm"),
  endAt: dayjs().add(2, "hour").format("YYYY-MM-DDTHH:mm"),
  allDay: false,
  timezone: "Asia/Shanghai",
  status: "SCHEDULED",
  priority: 1,
  caseId: "",
  ownerUserLabel: "",
  participantLabels: "",
  sourceType: "MANUAL",
  reminderPresetValue: DEFAULT_REMINDER_PRESET_VALUE,
  reminderChannels: ["DESKTOP"],
};

const REQUIRED_FIELD_LABEL = " *";

export function validateCalendarFormState(formState: CalendarFormState): CalendarFormErrors {
  const nextErrors: CalendarFormErrors = {};
  if (!formState.title.trim()) {
    nextErrors.title = "请输入事项标题";
  }
  if (!formState.startAt.trim()) {
    nextErrors.startAt = "请选择开始时间";
  }
  if (!formState.endAt.trim()) {
    nextErrors.endAt = "请选择结束时间";
  }
  if (formState.startAt.trim() && formState.endAt.trim()) {
    const start = dayjs(formState.startAt);
    const end = dayjs(formState.endAt);
    if (!start.isValid()) {
      nextErrors.startAt = "开始时间格式不正确";
    }
    if (!end.isValid()) {
      nextErrors.endAt = "结束时间格式不正确";
    }
    if (start.isValid() && end.isValid() && end.isBefore(start)) {
      nextErrors.endAt = "结束时间不能早于开始时间";
    }
  }
  return nextErrors;
}

function toUiEvent(item: CalendarScheduleItem): CalendarUiEvent {
  const startAt = scheduleItemStartAt(item);
  const endAt = scheduleItemEndAt(item);
  const start = new Date(startAt);
  const end = new Date(endAt);
  return {
    id: scheduleItemId(item),
    title: scheduleItemTitle(item),
    start,
    end: end.getTime() <= start.getTime() ? dayjs(start).add(30, "minute").toDate() : end,
    allDay: item.itemType === "EVENT" ? item.event.allDay : false,
    resource: item,
  };
}

function scheduleItemId(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.id : item.occurrence.id;
}

function scheduleItemTitle(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.title : item.occurrence.title;
}

function scheduleItemEventType(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.eventType : item.occurrence.eventType;
}

function scheduleItemStartAt(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.startAt : item.occurrence.startAt;
}

function scheduleItemEndAt(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.endAt : item.occurrence.endAt;
}

function scheduleItemCaseId(item: CalendarScheduleItem) {
  return item.itemType === "EVENT" ? item.event.caseId : item.occurrence.caseId;
}

function filterScheduleItemsInNextWeek(items: CalendarScheduleItem[], now = dayjs()) {
  const end = now.add(7, "day");
  return items.filter((item) => {
    const start = dayjs(scheduleItemStartAt(item));
    return start.isAfter(now) && (start.isBefore(end) || start.isSame(end));
  });
}

function buildScheduleAgendaDays(items: CalendarScheduleItem[], now = dayjs()) {
  const end = now.add(30, "day");
  const grouped = new Map<string, CalendarScheduleItem[]>();
  items
    .filter((item) => {
      const start = dayjs(scheduleItemStartAt(item));
      return (start.isAfter(now) || start.isSame(now)) && (start.isBefore(end) || start.isSame(end));
    })
    .forEach((item) => {
      const day = dayjs(scheduleItemStartAt(item)).format("YYYY-MM-DD");
      grouped.set(day, [...(grouped.get(day) ?? []), item]);
    });
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, dayItems]) => ({
      day,
      items: dayItems.sort((left, right) => scheduleItemStartAt(left).localeCompare(scheduleItemStartAt(right))),
    }));
}

function buildCalendarQueryRange(date: Date, view: View) {
  const base = dayjs(date);
  const visibleStart = view === Views.MONTH
    ? base.startOf("month").subtract(7, "day")
    : base.startOf("week").subtract(1, "day");
  const visibleEnd = view === Views.MONTH
    ? base.endOf("month").add(7, "day")
    : base.endOf("week").add(1, "day");
  const agendaEnd = dayjs().add(30, "day");
  return {
    startAtFrom: visibleStart.isBefore(dayjs().subtract(1, "day"))
      ? visibleStart.toISOString()
      : dayjs().subtract(1, "day").toISOString(),
    startAtTo: visibleEnd.isAfter(agendaEnd) ? visibleEnd.toISOString() : agendaEnd.toISOString(),
  };
}

function normalizeReminderOffsets(offsetMinutes: number[]) {
  return [...new Set(
    offsetMinutes
      .filter((item) => Number.isFinite(item) && item >= 0)
      .map((item) => Math.trunc(item)),
  )].sort((left, right) => left - right);
}

function reminderOffsetsKey(offsetMinutes: number[]) {
  return normalizeReminderOffsets(offsetMinutes).join(",");
}

function customReminderPresetValue(offsetMinutes: number[]) {
  return `${CUSTOM_REMINDER_PRESET_PREFIX}${reminderOffsetsKey(offsetMinutes)}`;
}

export function getReminderPresetValue(offsetMinutes: number[]) {
  const key = reminderOffsetsKey(offsetMinutes);
  const preset = CALENDAR_REMINDER_PRESETS.find((item) => reminderOffsetsKey(item.offsetMinutes) === key);
  return preset?.value ?? customReminderPresetValue(offsetMinutes);
}

export function getReminderOffsetsFromPresetValue(value: string) {
  if (value.startsWith(CUSTOM_REMINDER_PRESET_PREFIX)) {
    return value
      .slice(CUSTOM_REMINDER_PRESET_PREFIX.length)
      .split(",")
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item >= 0);
  }
  return CALENDAR_REMINDER_PRESETS.find((item) => item.value === value)?.offsetMinutes ?? [];
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

export function formatReminderOffsets(offsetMinutes: number[]) {
  const normalized = normalizeReminderOffsets(offsetMinutes).sort((left, right) => right - left);
  if (!normalized.length) {
    return "未设置";
  }
  return normalized.map(formatReminderOffset).join("、");
}

function normalizeReminderChannels(channels: RecurringCalendarChannel[]) {
  const normalized = channels.filter((channel) => channel === "DESKTOP" || channel === "WECHAT_SELF");
  return normalized.length ? Array.from(new Set(normalized)) : ["DESKTOP" as const];
}

function formatReminderChannels(channels: RecurringCalendarChannel[]) {
  if (!channels.length) {
    return "未设置";
  }
  const normalized = Array.from(new Set(channels));
  return [
    normalized.includes("DESKTOP") ? "桌面" : "",
    normalized.includes("WECHAT_SELF") ? "微信" : "",
  ].filter(Boolean).join("、");
}

function calendarReminderChannels(reminders: CalendarEventRecord["reminders"]) {
  return Array.from(new Set(reminders.map((item) => item.channel)));
}

function buildReminderPresetOptions(value: string) {
  const customOffsets = value.startsWith(CUSTOM_REMINDER_PRESET_PREFIX)
    ? getReminderOffsetsFromPresetValue(value)
    : [];
  return value.startsWith(CUSTOM_REMINDER_PRESET_PREFIX)
    ? [
      ...CALENDAR_REMINDER_PRESETS,
      {
        value,
        label: `自定义：${formatReminderOffsets(customOffsets)}`,
        offsetMinutes: customOffsets,
      },
    ]
    : CALENDAR_REMINDER_PRESETS;
}

function toggleReminderChannel(
  channels: RecurringCalendarChannel[],
  channel: RecurringCalendarChannel,
  checked: boolean,
) {
  const nextChannels = checked
    ? [...channels, channel]
    : channels.filter((item) => item !== channel);
  return normalizeReminderChannels(nextChannels);
}

function buildFormState(event?: CalendarEventRecord | null): CalendarFormState {
  if (!event) {
    return DEFAULT_FORM;
  }
  const reminderOffsets = event.reminders.map((item) => item.offsetMinutes);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    startAt: toLocalDateTimeInput(event.startAt),
    endAt: toLocalDateTimeInput(event.endAt),
    allDay: event.allDay,
    timezone: event.timezone,
    status: event.status,
    priority: event.priority,
    caseId: event.caseId,
    ownerUserLabel: event.ownerUserLabel,
    participantLabels: event.participantLabels.join("、"),
    sourceType: event.sourceType,
    reminderPresetValue: getReminderPresetValue(reminderOffsets),
    reminderChannels: calendarReminderChannels(event.reminders),
  };
}

export function buildMutationPayload(form: CalendarFormState, cases: CaseRecord[]): CalendarEventMutationInput {
  const selectedCase = cases.find((item) => item.id === form.caseId);
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    eventType: form.eventType,
    startAt: dayjs(form.startAt).toISOString(),
    endAt: dayjs(form.endAt || form.startAt).toISOString(),
    allDay: form.allDay,
    timezone: form.timezone.trim() || "Asia/Shanghai",
    status: form.status,
    priority: Number(form.priority) || 0,
    caseId: selectedCase?.id,
    casePathSnapshot: selectedCase?.casePath,
    ownerUserLabel: form.ownerUserLabel.trim(),
    participantLabels: form.participantLabels
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
    sourceType: form.sourceType,
    reminders: getReminderOffsetsFromPresetValue(form.reminderPresetValue)
      .flatMap((offsetMinutes) =>
        normalizeReminderChannels(form.reminderChannels)
          .map((channel) => ({ offsetMinutes, channel })),
      ),
  };
}

function extractCalendarErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return "请检查必填项和时间范围后重试";
}

/**
 * @author kongweiguang
 * 律师日历面板，负责展示案件期限、庭期、会议和本地日历操作入口。
 */
export function CalendarPanel({
  cases,
  selectedCaseId,
  onSelectCase,
  resolvedThemeMode,
}: {
  /** 当前工作空间下的案件列表。 */
  cases: CaseRecord[];
  /** 当前选中的案件 ID。 */
  selectedCaseId: string | null;
  /** 切换当前案件。 */
  onSelectCase: (caseId: string | null) => void;
  /** 当前解析后的系统主题模式（light | dark）。 */
  resolvedThemeMode?: "light" | "dark";
}) {
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduleItems, setScheduleItems] = useState<CalendarScheduleItem[]>([]);
  const [agendaDays, setAgendaDays] = useState<CalendarScheduleAgendaDay[]>([]);
  const [templates, setTemplates] = useState<CalendarTemplateRecord[]>([]);
  const [selectedItem, setSelectedItem] = useState<CalendarScheduleItem | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedType, setSelectedType] = useState<CalendarEventType | "ALL">("ALL");
  const [selectedStatus, setSelectedStatus] = useState<CalendarEventStatus | "ALL">("ALL");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formState, setFormState] = useState<CalendarFormState>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<CalendarFormErrors>({});
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const uiEvents = useMemo(() => scheduleItems.map(toUiEvent), [scheduleItems]);
  const nextWeekItems = useMemo(() => filterScheduleItemsInNextWeek(scheduleItems), [scheduleItems]);
  const reminderPresetOptions = useMemo(
    () => buildReminderPresetOptions(formState.reminderPresetValue),
    [formState.reminderPresetValue],
  );
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const selectedEvent = selectedItem?.itemType === "EVENT" ? selectedItem.event : null;
  const selectedOccurrence = selectedItem?.itemType === "RECURRING_OCCURRENCE" ? selectedItem.occurrence : null;

  async function loadCalendarData() {
    setIsLoading(true);
    try {
      const { startAtFrom, startAtTo } = buildCalendarQueryRange(date, view);
      const [nextItems, nextTemplates] = await Promise.all([
        listCalendarScheduleItems({
          startAtFrom,
          startAtTo,
          caseId: selectedCaseId ?? undefined,
          eventTypes: selectedType === "ALL" ? undefined : [selectedType],
          statuses: selectedStatus === "ALL" ? undefined : [selectedStatus],
          keyword: searchKeyword.trim() || undefined,
        }),
        listCalendarTemplates(),
      ]);
      setScheduleItems(nextItems);
      setAgendaDays(buildScheduleAgendaDays(nextItems));
      setTemplates(nextTemplates);
      if (selectedItem) {
        const currentKey = scheduleItemId(selectedItem);
        setSelectedItem(nextItems.find((item) => scheduleItemId(item) === currentKey) ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCalendarData();
  }, [date, selectedCaseId, searchKeyword, selectedStatus, selectedType, view]);

  useEffect(() => {
    if (!selectedCaseId) {
      return;
    }
    if (!cases.some((item) => item.id === selectedCaseId)) {
      onSelectCase(null);
    }
  }, [cases, onSelectCase, selectedCaseId]);

  function openCreateForm(startAt?: Date, endAt?: Date) {
    setConflictNotice(null);
    setFormErrors({});
    const nextStart = startAt ? dayjs(startAt) : dayjs().add(1, "hour");
    const nextEnd = endAt ? dayjs(endAt) : nextStart.add(1, "hour");
    setFormState({
      ...DEFAULT_FORM,
      caseId: selectedCaseId ?? "",
      startAt: nextStart.format("YYYY-MM-DDTHH:mm"),
      endAt: nextEnd.format("YYYY-MM-DDTHH:mm"),
    });
    setIsFormOpen(true);
  }

  function openEditForm(event: CalendarEventRecord) {
    setConflictNotice(null);
    setFormErrors({});
    setFormState(buildFormState(event));
    setIsFormOpen(true);
  }

  function validateFormState() {
    const nextErrors = validateCalendarFormState(formState);
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSaveEvent() {
    if (!validateFormState()) {
      return;
    }
    const payload = buildMutationPayload(formState, cases);
    setIsSubmitting(true);
    try {
      const conflicts = await searchCalendarConflicts({
        startAt: payload.startAt,
        endAt: payload.endAt,
        caseId: payload.caseId,
        excludeEventId: formState.id,
      });
      setConflictNotice(
        conflicts.length
          ? `当前时间段存在 ${conflicts.length} 个已排期事项，请确认是否需要改期。`
          : null,
      );
      if (formState.id) {
        await updateCalendarEvent(formState.id, payload);
      } else {
        await createCalendarEvent(payload);
      }
      setIsFormOpen(false);
      await loadCalendarData();
    } catch (error) {
      console.error("保存日历事项失败", error);
      await showAlert({
        title: "保存日历事项失败",
        message: extractCalendarErrorMessage(error),
        description: "请检查必填项、时间范围或案件关联后重试。",
        intent: "warning",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    const confirmed = await showConfirm({
      title: "删除日历事项",
      message: "确认删除当前日历事项？",
      description: "删除后当前排期将从本地日历中移除。",
      confirmText: "确认删除",
      cancelText: "取消",
      intent: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteCalendarEvent(eventId);
      if (selectedEvent?.id === eventId) {
        setSelectedItem(null);
      }
      await loadCalendarData();
    } catch (error) {
      console.error("删除日历事项失败", error);
      await showAlert({
        title: "删除失败",
        message: "删除日历事项失败，请稍后重试。",
        intent: "warning",
      });
    }
  }

  async function handleCompleteEvent(eventId: string) {
    try {
      await completeCalendarEvent(eventId, "MANUAL");
      await loadCalendarData();
    } catch (error) {
      console.error("完成日历事项失败", error);
      await showAlert({
        title: "操作失败",
        message: "完成日历事项失败，请稍后重试。",
        intent: "warning",
      });
    }
  }

  async function handlePauseRecurringRule(ruleId: string) {
    try {
      await pauseRecurringCalendarRule(ruleId);
      setSelectedItem(null);
      await loadCalendarData();
    } catch (error) {
      console.error("暂停周期日程失败", error);
      await showAlert({
        title: "暂停失败",
        message: extractCalendarErrorMessage(error),
        intent: "warning",
      });
    }
  }

  async function handleDeleteRecurringRule(ruleId: string) {
    const confirmed = await showConfirm({
      title: "删除周期日程",
      message: "确认删除整条周期日程规则？",
      description: "删除后后续执行点将不再显示，也不会继续提醒。",
      confirmText: "确认删除",
      cancelText: "取消",
      intent: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteRecurringCalendarRule(ruleId);
      setSelectedItem(null);
      await loadCalendarData();
    } catch (error) {
      console.error("删除周期日程失败", error);
      await showAlert({
        title: "删除失败",
        message: extractCalendarErrorMessage(error),
        intent: "warning",
      });
    }
  }

  async function handleApplyTemplate(templateId: string) {
    if (!selectedCase && !(await showConfirm({
      title: "以通用事项生成",
      message: "当前未选择案件，是否以通用事项方式生成？",
      description: "继续后不会自动绑定案件上下文。",
      confirmText: "继续生成",
      cancelText: "返回选择案件",
      intent: "warning",
    }))) {
      return;
    }
    try {
      await applyCalendarTemplate({
        templateId,
        anchorAt: dayjs().toISOString(),
        caseId: selectedCase?.id,
        casePathSnapshot: selectedCase?.casePath,
        ownerUserLabel: selectedCase?.name,
      });
      await loadCalendarData();
    } catch (error) {
      console.error("套用期限模板失败", error);
      await showAlert({
        title: "套用失败",
        message: "套用期限模板失败，请稍后重试。",
        intent: "warning",
      });
    }
  }

  const visibleAgendaDays = selectedCaseId
    ? agendaDays
      .map((day) => ({
        ...day,
        items: day.items.filter((item) => scheduleItemCaseId(item) === selectedCaseId),
      }))
      .filter((day) => day.items.length > 0)
    : agendaDays;

  const eventPropGetter = (event: CalendarUiEvent) => {
    const isDark = resolvedThemeMode === "dark";
    const color = calendarEventColor(scheduleItemEventType(event.resource), isDark);
    return {
      style: {
        backgroundColor: isDark ? `${color}20` : `${color}12`, // 配合半透明背景色实现现代毛玻璃/发光质感
        borderColor: isDark ? `${color}40` : `${color}50`, // 亮色下边框稍微深一些，暗色下稍微浅一些以融合卡片
        color,
        borderRadius: "6px",
        borderLeft: `4px solid ${color}`,
      },
    };
  };

  const components = {
    event: ({ event }: EventProps<CalendarUiEvent>) => (
      <div className="truncate text-xs font-semibold">
        {event.resource.itemType === "RECURRING_OCCURRENCE" ? "周期 " : ""}
        {scheduleItemEventType(event.resource) === "DEADLINE"
          ? "期限"
          : presentCalendarEventType(scheduleItemEventType(event.resource))} {event.title}
      </div>
    ),
  };

  return (
    <section className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-[color:var(--color-border)] px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]">
                  <CalendarIcon className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-primary)]">日历工作台</p>
                  <h1 className="mt-1 text-2xl font-semibold text-[color:var(--color-card-foreground)]">律师日历</h1>
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                围绕庭期、期限、会见与跟进事项统一排期；需要 AI 协作时，直接在普通会话或案件会话里提问即可调用内置日历 MCP 能力。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={isLoading} onClick={() => void loadCalendarData()} type="button" variant="outline">
                {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                刷新
              </Button>
              <Button onClick={() => openCreateForm()} type="button">
                <Plus />
                新建事项
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden px-6 py-6 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <aside className="grid gap-4 overflow-y-auto">
            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">筛选</h2>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-[color:var(--color-card-foreground)]">案件</span>
                  <Select
                    onChange={(event) => onSelectCase(event.target.value || null)}
                    surface="card"
                    value={selectedCaseId ?? ""}
                  >
                    <option value="">全部事项</option>
                    {cases.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </Select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-[color:var(--color-card-foreground)]">类型</span>
                  <Select
                    onChange={(event) => setSelectedType((event.target.value || "ALL") as CalendarEventType | "ALL")}
                    surface="card"
                    value={selectedType}
                  >
                    <option value="ALL">全部类型</option>
                    {CALENDAR_EVENT_TYPE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </Select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-[color:var(--color-card-foreground)]">状态</span>
                  <Select
                    onChange={(event) => setSelectedStatus((event.target.value || "ALL") as CalendarEventStatus | "ALL")}
                    surface="card"
                    value={selectedStatus}
                  >
                    <option value="ALL">全部状态</option>
                    {CALENDAR_STATUS_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </Select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-[color:var(--color-card-foreground)]">关键字</span>
                  <input
                    className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 text-sm"
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    placeholder="标题、负责人、参与人"
                    value={searchKeyword}
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">期限模板</h2>
              <div className="mt-3 grid gap-3">
                {templates.map((template) => (
                  <button
                    className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-left transition hover:border-[color:var(--color-primary)]/30"
                    key={template.id}
                    onClick={() => void handleApplyTemplate(template.id)}
                    type="button"
                  >
                    <div className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{template.name}</div>
                    <div className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{template.description}</div>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button onClick={() => setDate(dayjs(date).subtract(1, view === Views.MONTH ? "month" : "week").toDate())} size="icon" type="button" variant="outline">
                  <ChevronLeft />
                </Button>
                <Button onClick={() => setDate(new Date())} type="button" variant="outline">今天</Button>
                <Button onClick={() => setDate(dayjs(date).add(1, view === Views.MONTH ? "month" : "week").toDate())} size="icon" type="button" variant="outline">
                  <ChevronRight />
                </Button>
                <span className="ml-2 text-sm font-semibold text-[color:var(--color-card-foreground)]">
                  {dayjs(date).format(view === Views.MONTH ? "YYYY 年 M 月" : "YYYY 年 M 月 D 日")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setView(Views.MONTH)} type="button" variant={view === Views.MONTH ? "default" : "outline"}>月</Button>
                <Button onClick={() => setView(Views.WEEK)} type="button" variant={view === Views.WEEK ? "default" : "outline"}>周</Button>
                <Button onClick={() => setView(Views.AGENDA)} type="button" variant={view === Views.AGENDA ? "default" : "outline"}>日程</Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
              <BigCalendar
                culture="zh-cn"
                components={components}
                date={date}
                eventPropGetter={eventPropGetter}
                events={uiEvents}
                localizer={localizer}
                messages={CALENDAR_MESSAGES}
                onNavigate={setDate}
                onSelectEvent={(event: CalendarUiEvent) => setSelectedItem(event.resource)}
                onSelectSlot={(slot: SlotInfo) => openCreateForm(slot.start, slot.end)}
                onView={(nextView: View) => setView(nextView)}
                selectable
                startAccessor="start"
                endAccessor="end"
                style={{ height: "100%" }}
                toolbar={false}
                view={view}
                views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
              />
            </div>
          </section>

          <aside className="grid gap-4 overflow-y-auto">
            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <div className="flex items-center gap-2">
                <Clock3 className="size-4 text-[color:var(--color-primary)]" />
                <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">未来 7 天</h2>
              </div>
              <div className="mt-3 grid gap-3">
                {nextWeekItems.length ? nextWeekItems.map((item) => (
                  <button
                    className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-left transition hover:border-[color:var(--color-primary)]/30"
                    key={scheduleItemId(item)}
                    onClick={() => setSelectedItem(item)}
                    type="button"
                  >
                    <div className="text-sm font-semibold text-[color:var(--color-card-foreground)]">
                      {item.itemType === "RECURRING_OCCURRENCE" ? "周期 · " : ""}{scheduleItemTitle(item)}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                      {dayjs(scheduleItemStartAt(item)).format("MM-DD HH:mm")} · {presentCalendarEventType(scheduleItemEventType(item))}
                    </div>
                    <div className="mt-2 text-xs font-medium text-[color:var(--color-primary)]">
                      {item.itemType === "EVENT" ? summarizeDeadlineState(item.event) : "周期日程"}
                    </div>
                  </button>
                )) : (
                  <div className="rounded-xl border border-dashed border-[color:var(--color-border)] px-4 py-6 text-sm text-[color:var(--color-muted-foreground)]">
                    未来一周暂无排期事项。
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">事项详情</h2>
              {selectedEvent ? (
                <div className="mt-4 grid gap-3">
                  <div>
                    <div className="text-lg font-semibold text-[color:var(--color-card-foreground)]">{selectedEvent.title}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[color:var(--color-secondary)] px-2.5 py-1 text-[color:var(--color-primary)]">
                        {presentCalendarEventType(selectedEvent.eventType)}
                      </span>
                      <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-1 text-[color:var(--color-card-foreground)]">
                        {summarizeDeadlineState(selectedEvent)}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                    {selectedEvent.description || "暂无说明"}
                  </div>
                  <div className="grid gap-2 text-sm text-[color:var(--color-card-foreground)]">
                    <div>开始：{dayjs(selectedEvent.startAt).format("YYYY-MM-DD HH:mm")}</div>
                    <div>结束：{dayjs(selectedEvent.endAt).format("YYYY-MM-DD HH:mm")}</div>
                    <div>案件：{cases.find((item) => item.id === selectedEvent.caseId)?.name || "未关联案件"}</div>
                    <div>负责人：{selectedEvent.ownerUserLabel || "未填写"}</div>
                    <div>来源：{selectedEvent.sourceType}</div>
                    <div>提醒：{formatReminderOffsets(selectedEvent.reminders.map((item) => item.offsetMinutes))}</div>
                    <div>渠道：{formatReminderChannels(calendarReminderChannels(selectedEvent.reminders))}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => openEditForm(selectedEvent)} type="button" variant="outline">编辑</Button>
                    {selectedEvent.status === "SCHEDULED" ? (
                      <Button onClick={() => void handleCompleteEvent(selectedEvent.id)} type="button" variant="outline">标记完成</Button>
                    ) : null}
                    <Button onClick={() => void handleDeleteEvent(selectedEvent.id)} type="button" variant="outline">
                      <Trash2 />
                      删除
                    </Button>
                  </div>
                </div>
              ) : selectedOccurrence ? (
                <div className="mt-4 grid gap-3">
                  <div>
                    <div className="text-lg font-semibold text-[color:var(--color-card-foreground)]">{selectedOccurrence.title}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[color:var(--color-secondary)] px-2.5 py-1 text-[color:var(--color-primary)]">
                        周期
                      </span>
                      <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-1 text-[color:var(--color-card-foreground)]">
                        {presentCalendarEventType(selectedOccurrence.eventType)}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                    {selectedOccurrence.message || selectedOccurrence.rule.originalText || "暂无提醒正文"}
                  </div>
                  <div className="grid gap-2 text-sm text-[color:var(--color-card-foreground)]">
                    <div>执行：{dayjs(selectedOccurrence.scheduledAt).format("YYYY-MM-DD HH:mm")}</div>
                    <div>规则：{selectedOccurrence.rule.cron}</div>
                    <div>渠道：{selectedOccurrence.channels.includes("DESKTOP") ? "桌面" : ""}{selectedOccurrence.channels.includes("WECHAT_SELF") ? " 微信" : ""}</div>
                    <div>案件：{cases.find((item) => item.id === selectedOccurrence.caseId)?.name || "未关联案件"}</div>
                    <div>状态：{selectedOccurrence.rule.status === "ACTIVE" ? "启用中" : "已暂停"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void handlePauseRecurringRule(selectedOccurrence.ruleId)} type="button" variant="outline">
                      <PauseCircle />
                      暂停规则
                    </Button>
                    <Button onClick={() => void handleDeleteRecurringRule(selectedOccurrence.ruleId)} type="button" variant="outline">
                      <Trash2 />
                      删除规则
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-border)] px-4 py-8 text-sm text-[color:var(--color-muted-foreground)]">
                  选择一个日历事项后，这里会显示详细信息、案件关联和快捷操作。
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">未来 30 天日程</h2>
              <div className="mt-3 grid gap-3">
                {visibleAgendaDays.slice(0, 6).map((day) => (
                  <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3" key={day.day}>
                    <div className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{day.day}</div>
                    <div className="mt-2 grid gap-2">
                      {day.items.slice(0, 3).map((item) => (
                        <button
                          className="text-left text-xs leading-5 text-[color:var(--color-muted-foreground)]"
                          key={scheduleItemId(item)}
                          onClick={() => setSelectedItem(item)}
                          type="button"
                        >
                          {item.itemType === "RECURRING_OCCURRENCE" ? "周期 · " : ""}{scheduleItemTitle(item)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>

      {isFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-2xl">
            <div className="border-b border-[color:var(--color-border)] px-5 py-4">
              <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">
                {formState.id ? "编辑日历事项" : "新建日历事项"}
              </h2>
              <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">带 * 的字段为必填项。</p>
            </div>
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">标题<span className="text-rose-500">{REQUIRED_FIELD_LABEL}</span></span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" onChange={(event) => {
                  const value = event.target.value;
                  setFormState((current) => ({ ...current, title: value }));
                  setFormErrors((current) => ({ ...current, title: value.trim() ? undefined : current.title }));
                }} value={formState.title} />
                {formErrors.title ? <span className="text-xs text-rose-500">{formErrors.title}</span> : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">类型<span className="text-rose-500">{REQUIRED_FIELD_LABEL}</span></span>
                <Select onChange={(event) => setFormState((current) => ({ ...current, eventType: event.target.value as CalendarEventType }))} surface="background" value={formState.eventType}>
                  {CALENDAR_EVENT_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-2 text-sm md:col-span-2">
                <span className="font-medium text-[color:var(--color-card-foreground)]">说明</span>
                <textarea className="min-h-24 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 text-[color:var(--color-card-foreground)]" onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))} value={formState.description} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">开始时间<span className="text-rose-500">{REQUIRED_FIELD_LABEL}</span></span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" onChange={(event) => {
                  const value = event.target.value;
                  setFormState((current) => ({ ...current, startAt: value }));
                  setFormErrors((current) => ({ ...current, startAt: undefined }));
                }} type="datetime-local" value={formState.startAt} />
                {formErrors.startAt ? <span className="text-xs text-rose-500">{formErrors.startAt}</span> : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">结束时间<span className="text-rose-500">{REQUIRED_FIELD_LABEL}</span></span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" onChange={(event) => {
                  const value = event.target.value;
                  setFormState((current) => ({ ...current, endAt: value }));
                  setFormErrors((current) => ({ ...current, endAt: undefined }));
                }} type="datetime-local" value={formState.endAt} />
                {formErrors.endAt ? <span className="text-xs text-rose-500">{formErrors.endAt}</span> : null}
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">案件</span>
                <Select onChange={(event) => setFormState((current) => ({ ...current, caseId: event.target.value }))} surface="background" value={formState.caseId}>
                  <option value="">未关联案件</option>
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">状态</span>
                <Select onChange={(event) => setFormState((current) => ({ ...current, status: event.target.value as CalendarEventStatus }))} surface="background" value={formState.status}>
                  {CALENDAR_STATUS_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">负责人</span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" onChange={(event) => setFormState((current) => ({ ...current, ownerUserLabel: event.target.value }))} value={formState.ownerUserLabel} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">参与人</span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" onChange={(event) => setFormState((current) => ({ ...current, participantLabels: event.target.value }))} placeholder="用顿号或逗号分隔" value={formState.participantLabels} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">优先级</span>
                <input className="h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]" min={0} onChange={(event) => setFormState((current) => ({ ...current, priority: Number(event.target.value) || 0 }))} type="number" value={formState.priority} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">提醒</span>
                <Select
                  onChange={(event) => setFormState((current) => ({ ...current, reminderPresetValue: event.target.value }))}
                  surface="background"
                  value={formState.reminderPresetValue}
                >
                  {reminderPresetOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </label>
              <div className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--color-card-foreground)]">通知渠道</span>
                <div className="flex min-h-10 items-center gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[color:var(--color-card-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={formState.reminderChannels.includes("DESKTOP")}
                      onChange={(event) => setFormState((current) => ({
                        ...current,
                        reminderChannels: toggleReminderChannel(current.reminderChannels, "DESKTOP", event.target.checked),
                      }))}
                      type="checkbox"
                    />
                    桌面
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={formState.reminderChannels.includes("WECHAT_SELF")}
                      onChange={(event) => setFormState((current) => ({
                        ...current,
                        reminderChannels: toggleReminderChannel(current.reminderChannels, "WECHAT_SELF", event.target.checked),
                      }))}
                      type="checkbox"
                    />
                    微信
                  </label>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input checked={formState.allDay} onChange={(event) => setFormState((current) => ({ ...current, allDay: event.target.checked }))} type="checkbox" />
                全天事项
              </label>
              {conflictNotice ? (
                <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 md:col-span-2">
                  {conflictNotice}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)] px-5 py-4">
              <Button onClick={() => setIsFormOpen(false)} type="button" variant="outline">取消</Button>
              <Button disabled={isSubmitting} onClick={() => void handleSaveEvent()} type="button">
                {isSubmitting ? <LoaderCircle className="animate-spin" /> : <Plus />}
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

export default CalendarPanel;
