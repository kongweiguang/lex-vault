import dayjs from "dayjs";

import type { CalendarEventRecord, CalendarEventStatus, CalendarEventType } from "@/types/domain";

export const CALENDAR_EVENT_TYPE_OPTIONS: Array<{ value: CalendarEventType; label: string }> = [
  { value: "COURT_HEARING", label: "庭期" },
  { value: "DEADLINE", label: "期限" },
  { value: "MEETING", label: "会议" },
  { value: "FOLLOW_UP", label: "跟进" },
  { value: "TASK_DUE", label: "待办" },
];

export const CALENDAR_STATUS_OPTIONS: Array<{ value: CalendarEventStatus; label: string }> = [
  { value: "SCHEDULED", label: "进行中" },
  { value: "DONE", label: "已完成" },
  { value: "CANCELLED", label: "已取消" },
];

/** 返回日历事件类型中文标签。 */
export function presentCalendarEventType(type: CalendarEventType) {
  return CALENDAR_EVENT_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type;
}

/** 返回日历状态中文标签。 */
export function presentCalendarStatus(status: CalendarEventStatus) {
  return CALENDAR_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

/**
 * 根据日历事件类型与当前主题模式，返回对应的高对比度、视效协调的视觉色值。
 * 浅色模式下返回深雅色系以保证字迹清晰易读；深色模式下返回明亮柔和的粉彩色系（Pastel）以保障可读性并配合发光质感。
 * 
 * @author kongweiguang
 * @param type 日历事件类型
 * @param isDark 是否为深色模式，默认为 false
 * @returns 十六进制颜色代码
 */
export function calendarEventColor(type: CalendarEventType, isDark = false) {
  if (isDark) {
    switch (type) {
      case "COURT_HEARING":
        return "#38bdf8"; // 亮天蓝色
      case "DEADLINE":
        return "#f87171"; // 亮珊瑚红
      case "MEETING":
        return "#818cf8"; // 柔和靛蓝
      case "FOLLOW_UP":
        return "#fbbf24"; // 明亮金黄
      case "TASK_DUE":
      default:
        return "#34d399"; // 薄荷绿
    }
  } else {
    switch (type) {
      case "COURT_HEARING":
        return "#0369a1"; // 深天蓝
      case "DEADLINE":
        return "#be123c"; // 深玫瑰红
      case "MEETING":
        return "#4f46e5"; // 现代靛蓝
      case "FOLLOW_UP":
        return "#b45309"; // 温暖琥珀褐
      case "TASK_DUE":
      default:
        return "#0f766e"; // 深翡翠绿
    }
  }
}

/** 组合“逾期 / 今日到期 / 即将到期”等优先展示状态。 */
export function summarizeDeadlineState(event: CalendarEventRecord) {
  if (event.status !== "SCHEDULED") {
    return presentCalendarStatus(event.status);
  }
  if (event.isOverdue) {
    return "逾期中";
  }
  if (event.isDueToday) {
    return "今日到期";
  }
  if (event.isUpcoming) {
    return "即将到期";
  }
  return "已排期";
}

/** 转换为 `datetime-local` 输入框可直接消费的本地时间。 */
export function toLocalDateTimeInput(value: string) {
  return dayjs(value).format("YYYY-MM-DDTHH:mm");
}

/** 仅显示本周内的事件，供快速概览与测试复用。 */
export function filterEventsInNextWeek(events: CalendarEventRecord[], now = dayjs()) {
  const end = now.add(7, "day");
  return events.filter((event) => {
    const start = dayjs(event.startAt);
    return start.isAfter(now) && (start.isBefore(end) || start.isSame(end));
  });
}
