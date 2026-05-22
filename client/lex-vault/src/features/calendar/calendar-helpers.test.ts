import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import type { CalendarEventRecord } from "@/types/domain";
import {
  filterEventsInNextWeek,
  summarizeDeadlineState,
} from "@/features/calendar/calendar-helpers";

function buildEvent(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: "event-1",
    title: "庭前准备",
    description: "",
    eventType: "DEADLINE",
    startAt: "2026-05-20T01:00:00Z",
    endAt: "2026-05-20T01:00:00Z",
    allDay: false,
    timezone: "Asia/Shanghai",
    status: "SCHEDULED",
    priority: 1,
    caseId: "case-1",
    casePathSnapshot: "C:/workspace/master/case-1",
    ownerUserLabel: "张律师",
    participantLabels: [],
    sourceType: "MANUAL",
    sourceTextSnapshot: "",
    externalProvider: "",
    externalEventId: "",
    reminders: [],
    createdAt: "2026-05-18T00:00:00Z",
    updatedAt: "2026-05-18T00:00:00Z",
    isOverdue: false,
    isDueToday: false,
    isUpcoming: false,
    ...overrides,
  };
}

describe("calendar-helpers", () => {
  it("优先展示逾期和到期状态", () => {
    expect(summarizeDeadlineState(buildEvent({ isOverdue: true }))).toBe("逾期中");
    expect(summarizeDeadlineState(buildEvent({ isDueToday: true }))).toBe("今日到期");
    expect(summarizeDeadlineState(buildEvent({ isUpcoming: true }))).toBe("即将到期");
  });

  it("已完成或已取消事项回退为状态标签", () => {
    expect(summarizeDeadlineState(buildEvent({ status: "DONE" }))).toBe("已完成");
    expect(summarizeDeadlineState(buildEvent({ status: "CANCELLED" }))).toBe("已取消");
  });

  it("只返回未来七天内的事项", () => {
    const now = dayjs("2026-05-18T00:00:00Z");
    const events = [
      buildEvent({ id: "soon", startAt: "2026-05-20T01:00:00Z" }),
      buildEvent({ id: "far", startAt: "2026-05-30T01:00:00Z" }),
      buildEvent({ id: "past", startAt: "2026-05-17T23:00:00Z" }),
    ];

    expect(filterEventsInNextWeek(events, now).map((item) => item.id)).toEqual(["soon"]);
  });
});
