import { invoke } from "@tauri-apps/api/core";

import type {
  CalendarAgendaDay,
  CalendarConflictQuery,
  CalendarEventQuery,
  CalendarEventRecord,
  CalendarReminderRule,
  CalendarScheduleItem,
  CalendarTemplateRecord,
  RecurringCalendarChannel,
  RecurringCalendarRule,
} from "@/types/domain";

export type CalendarEventMutationInput = {
  title: string;
  description?: string;
  eventType: CalendarEventRecord["eventType"];
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  timezone?: string;
  status?: CalendarEventRecord["status"];
  priority?: number;
  caseId?: string;
  casePathSnapshot?: string;
  ownerUserLabel?: string;
  participantLabels?: string[];
  sourceType?: CalendarEventRecord["sourceType"];
  sourceTextSnapshot?: string;
  externalProvider?: string;
  externalEventId?: string;
  reminders?: CalendarReminderRule[];
};

export type CalendarTemplateApplyInput = {
  templateId: string;
  anchorAt: string;
  titleOverride?: string;
  descriptionOverride?: string;
  caseId?: string;
  casePathSnapshot?: string;
  ownerUserLabel?: string;
  participantLabels?: string[];
};

export type RecurringCalendarRuleMutationInput = {
  title: string;
  originalText?: string;
  cron: string;
  timezone?: string;
  eventType: CalendarEventRecord["eventType"];
  message?: string;
  channels?: RecurringCalendarChannel[];
  status?: RecurringCalendarRule["status"];
  startAt?: string;
  endAt?: string;
  caseId?: string;
  casePathSnapshot?: string;
  ownerUserLabel?: string;
  sourceType?: CalendarEventRecord["sourceType"];
};

export type PreviewRecurringCalendarRuleInput = {
  cron: string;
  timezone?: string;
  fromAt?: string;
  limit?: number;
};

export type MarkRecurringCalendarDeliveryInput = {
  ruleId: string;
  scheduledAt: string;
  channel: RecurringCalendarChannel;
};

/** 查询日历事件列表。 */
export function listCalendarEvents(query: CalendarEventQuery = {}) {
  return invoke<CalendarEventRecord[]>("list_calendar_events_command", { query });
}

/** 查询日历聚合项，包含普通事项和周期执行点。 */
export function listCalendarScheduleItems(query: CalendarEventQuery = {}) {
  return invoke<CalendarScheduleItem[]>("list_calendar_schedule_items_command", { query });
}

/** 创建日历事件。 */
export function createCalendarEvent(payload: CalendarEventMutationInput) {
  return invoke<CalendarEventRecord>("create_calendar_event_command", { payload });
}

/** 更新日历事件。 */
export function updateCalendarEvent(eventId: string, payload: Partial<CalendarEventMutationInput>) {
  return invoke<CalendarEventRecord>("update_calendar_event_command", { eventId, payload });
}

/** 删除日历事件。 */
export function deleteCalendarEvent(eventId: string) {
  return invoke<void>("delete_calendar_event_command", { eventId });
}

/** 标记日历事件完成。 */
export function completeCalendarEvent(eventId: string, sourceType?: CalendarEventRecord["sourceType"]) {
  return invoke<CalendarEventRecord>("complete_calendar_event_command", {
    eventId,
    payload: sourceType ? { sourceType } : null,
  });
}

/** 查询未来 30 天日程。 */
export function listCalendarAgenda() {
  return invoke<CalendarAgendaDay[]>("list_calendar_agenda_command");
}

/** 读取内置期限模板。 */
export function listCalendarTemplates() {
  return invoke<CalendarTemplateRecord[]>("list_calendar_templates_command");
}

/** 套用期限模板生成事件。 */
export function applyCalendarTemplate(payload: CalendarTemplateApplyInput) {
  return invoke<CalendarEventRecord>("apply_calendar_template_command", { payload });
}

/** 查询当前时间段的冲突事项。 */
export function searchCalendarConflicts(query: CalendarConflictQuery) {
  return invoke<CalendarEventRecord[]>("search_calendar_conflicts_command", { query });
}

/** 查询周期日程规则。 */
export function listRecurringCalendarRules() {
  return invoke<RecurringCalendarRule[]>("list_recurring_calendar_rules_command");
}

/** 创建周期日程规则。 */
export function createRecurringCalendarRule(payload: RecurringCalendarRuleMutationInput) {
  return invoke<RecurringCalendarRule>("create_recurring_calendar_rule_command", { payload });
}

/** 更新周期日程规则。 */
export function updateRecurringCalendarRule(
  ruleId: string,
  payload: Partial<RecurringCalendarRuleMutationInput>,
) {
  return invoke<RecurringCalendarRule>("update_recurring_calendar_rule_command", {
    ruleId,
    payload,
  });
}

/** 暂停周期日程规则。 */
export function pauseRecurringCalendarRule(ruleId: string) {
  return invoke<RecurringCalendarRule>("pause_recurring_calendar_rule_command", { ruleId });
}

/** 删除周期日程规则。 */
export function deleteRecurringCalendarRule(ruleId: string) {
  return invoke<void>("delete_recurring_calendar_rule_command", { ruleId });
}

/** 预览周期日程未来执行点。 */
export function previewRecurringCalendarRule(payload: PreviewRecurringCalendarRuleInput) {
  return invoke<string[]>("preview_recurring_calendar_rule_command", { payload });
}

/** 标记周期执行点指定渠道已触发。 */
export function markRecurringCalendarDelivery(payload: MarkRecurringCalendarDeliveryInput) {
  return invoke<boolean>("mark_recurring_calendar_delivery_command", { payload });
}
