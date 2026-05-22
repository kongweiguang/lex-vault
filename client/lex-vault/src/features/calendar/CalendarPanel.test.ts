import { describe, expect, it } from "vitest";

import {
  buildMutationPayload,
  CALENDAR_MESSAGES,
  formatReminderOffsets,
  getReminderOffsetsFromPresetValue,
  getReminderPresetValue,
  validateCalendarFormState,
} from "@/features/calendar/CalendarPanel";
import type { CaseRecord } from "@/types/domain";

type CalendarFormState = Parameters<typeof validateCalendarFormState>[0];

function buildFormState(overrides: Partial<CalendarFormState> = {}): CalendarFormState {
  return {
    title: "与当事人会面",
    description: "",
    eventType: "MEETING",
    startAt: "2026-05-18T10:00",
    endAt: "2026-05-18T11:00",
    allDay: false,
    timezone: "Asia/Shanghai",
    status: "SCHEDULED",
    priority: 1,
    caseId: "",
    ownerUserLabel: "",
    participantLabels: "",
    sourceType: "MANUAL",
    reminderPresetValue: "DAY_AND_HALF_HOUR_BEFORE",
    reminderChannels: ["DESKTOP"],
    ...overrides,
  };
}

const CASES: CaseRecord[] = [
  {
    id: "case-1",
    name: "买卖合同纠纷",
    casePath: "C:/workspace/cases/case-1",
    createdAt: "2026-05-18T00:00:00Z",
    updatedAt: "2026-05-18T00:00:00Z",
  },
];

describe("validateCalendarFormState", () => {
  it("marks missing required fields", () => {
    const errors = validateCalendarFormState(
      buildFormState({
        title: " ",
        startAt: "",
        endAt: "",
      }),
    );

    expect(errors).toEqual({
      title: "请输入事项标题",
      startAt: "请选择开始时间",
      endAt: "请选择结束时间",
    });
  });

  it("rejects an end time earlier than the start time", () => {
    const errors = validateCalendarFormState(
      buildFormState({
        startAt: "2026-05-18T11:00",
        endAt: "2026-05-18T10:00",
      }),
    );

    expect(errors.endAt).toBe("结束时间不能早于开始时间");
  });

  it("accepts a complete valid form", () => {
    expect(validateCalendarFormState(buildFormState())).toEqual({});
  });
});

describe("calendar reminder presets", () => {
  it("builds default day and half-hour reminder payload", () => {
    const payload = buildMutationPayload(buildFormState(), CASES);

    expect(payload.reminders).toEqual([
      { offsetMinutes: 1440, channel: "DESKTOP" },
      { offsetMinutes: 30, channel: "DESKTOP" },
    ]);
  });

  it("builds reminder payloads for every selected notification channel", () => {
    const payload = buildMutationPayload(
      buildFormState({
        reminderPresetValue: "MINUTES_30_BEFORE",
        reminderChannels: ["DESKTOP", "WECHAT_SELF"],
      }),
      CASES,
    );

    expect(payload.reminders).toEqual([
      { offsetMinutes: 30, channel: "DESKTOP" },
      { offsetMinutes: 30, channel: "WECHAT_SELF" },
    ]);
  });

  it("builds an empty reminder payload when no reminder is selected", () => {
    const payload = buildMutationPayload(
      buildFormState({
        reminderPresetValue: "NONE",
      }),
      CASES,
    );

    expect(payload.reminders).toEqual([]);
  });

  it("keeps historical custom reminder offsets through preset conversion", () => {
    const presetValue = getReminderPresetValue([45, 2880]);

    expect(presetValue).toBe("CUSTOM:45,2880");
    expect(getReminderOffsetsFromPresetValue(presetValue)).toEqual([45, 2880]);
    expect(formatReminderOffsets([45, 2880])).toBe("2 天前、45 分钟前");
  });
});

describe("CALENDAR_MESSAGES", () => {
  it("uses Chinese labels for built-in calendar chrome", () => {
    expect(CALENDAR_MESSAGES.today).toBe("今天");
    expect(CALENDAR_MESSAGES.allDay).toBe("全天");
    expect(CALENDAR_MESSAGES.date).toBe("日期");
    expect(CALENDAR_MESSAGES.event).toBe("事项");
    expect(CALENDAR_MESSAGES.noEventsInRange).toBe("当前时间范围暂无事项");
    expect(CALENDAR_MESSAGES.showMore(3)).toBe("另有 3 项");
  });
});
