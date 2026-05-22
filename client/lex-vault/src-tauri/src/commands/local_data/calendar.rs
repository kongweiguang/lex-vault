//! local_data 日历存储与查询能力。
//!
//! @author kongweiguang

use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, NaiveDateTime, TimeZone, Timelike, Utc,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use uuid::Uuid;

use super::store::{execute_sql, open_connection};

/// 日历事件类型，覆盖律师首期高频事项。
pub const CALENDAR_EVENT_TYPES: [&str; 5] = [
    "COURT_HEARING",
    "DEADLINE",
    "MEETING",
    "FOLLOW_UP",
    "TASK_DUE",
];

/// 日历事件状态。
pub const CALENDAR_EVENT_STATUSES: [&str; 3] = ["SCHEDULED", "DONE", "CANCELLED"];

/// 日历事件来源类型。
pub const CALENDAR_SOURCE_TYPES: [&str; 4] = ["MANUAL", "AI_CREATED", "AI_UPDATED", "TEMPLATE"];

/// 日历审计动作。
pub const CALENDAR_AUDIT_ACTIONS: [&str; 5] = [
    "CREATED",
    "UPDATED",
    "DELETED",
    "COMPLETED",
    "TEMPLATE_APPLIED",
];

/// 周期日程状态。
pub const CALENDAR_RECURRING_RULE_STATUSES: [&str; 2] = ["ACTIVE", "PAUSED"];

/// 周期日程提醒渠道。
pub const CALENDAR_RECURRING_CHANNELS: [&str; 2] = ["DESKTOP", "WECHAT_SELF"];

/// 普通日历提醒渠道，当前与周期提醒渠道保持一致。
pub const CALENDAR_REMINDER_CHANNELS: [&str; 2] = CALENDAR_RECURRING_CHANNELS;

/// 单条周期规则每次查询最多展开的执行点数量，避免异常 cron 造成 UI 卡顿。
const MAX_RECURRING_OCCURRENCES_PER_RULE: usize = 500;

/// 无时间范围查询时，周期规则默认向未来展开的天数。
const DEFAULT_RECURRING_LOOKAHEAD_DAYS: i64 = 90;

/// 无时间范围查询时，周期规则默认向过去回看的天数。
const DEFAULT_RECURRING_LOOKBACK_DAYS: i64 = 30;

/// 日历提醒规则。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarReminderRule {
    /// 提前提醒的分钟数，正数表示在开始前触发。
    pub offset_minutes: i64,
    /// 提醒渠道，旧数据或缺省输入默认使用桌面通知。
    #[serde(default = "default_reminder_channel")]
    pub channel: String,
}

fn default_reminder_channel() -> String {
    "DESKTOP".to_string()
}

/// 日历事件记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventRecord {
    /// 事件唯一标识。
    pub id: String,
    /// 事件标题。
    pub title: String,
    /// 事件补充说明。
    pub description: String,
    /// 事件类型。
    pub event_type: String,
    /// 开始时间，使用 ISO-8601 UTC 字符串保存。
    pub start_at: String,
    /// 结束时间，使用 ISO-8601 UTC 字符串保存。
    pub end_at: String,
    /// 是否为全天事项。
    pub all_day: bool,
    /// 时区标识。
    pub timezone: String,
    /// 当前状态。
    pub status: String,
    /// 优先级，取值越大越紧急。
    pub priority: i32,
    /// 关联案件 ID；为空表示个人或通用事项。
    pub case_id: String,
    /// 创建事件时快照下来的案件目录。
    pub case_path_snapshot: String,
    /// 负责人展示标签。
    pub owner_user_label: String,
    /// 参与人展示标签集合。
    pub participant_labels: Vec<String>,
    /// 来源类型。
    pub source_type: String,
    /// 生成该事项的原始文本快照。
    pub source_text_snapshot: String,
    /// 外部提供方标识，首期预留不用。
    pub external_provider: String,
    /// 外部事件 ID，首期预留不用。
    pub external_event_id: String,
    /// 提醒规则列表。
    pub reminders: Vec<CalendarReminderRule>,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
    /// 是否已经逾期。
    pub is_overdue: bool,
    /// 是否今天到期。
    pub is_due_today: bool,
    /// 是否未来七天内即将到期。
    pub is_upcoming: bool,
}

/// 创建事件请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarEventInput {
    /// 事件标题。
    pub title: String,
    /// 事件补充说明。
    pub description: Option<String>,
    /// 事件类型。
    pub event_type: String,
    /// 开始时间。
    pub start_at: String,
    /// 结束时间；为空时默认等于开始时间。
    pub end_at: Option<String>,
    /// 是否为全天事项。
    pub all_day: Option<bool>,
    /// 时区标识。
    pub timezone: Option<String>,
    /// 当前状态。
    pub status: Option<String>,
    /// 优先级。
    pub priority: Option<i32>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件目录快照；案件目录是当前唯一的案件来源。
    pub case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    pub owner_user_label: Option<String>,
    /// 参与人展示标签集合。
    pub participant_labels: Option<Vec<String>>,
    /// 来源类型。
    pub source_type: Option<String>,
    /// 原始文本快照。
    pub source_text_snapshot: Option<String>,
    /// 外部提供方标识，首期预留。
    pub external_provider: Option<String>,
    /// 外部事件 ID，首期预留。
    pub external_event_id: Option<String>,
    /// 提醒规则列表。
    pub reminders: Option<Vec<CalendarReminderRule>>,
}

/// 更新事件请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventInput {
    /// 事件标题。
    pub title: Option<String>,
    /// 事件补充说明。
    pub description: Option<String>,
    /// 事件类型。
    pub event_type: Option<String>,
    /// 开始时间。
    pub start_at: Option<String>,
    /// 结束时间。
    pub end_at: Option<String>,
    /// 是否为全天事项。
    pub all_day: Option<bool>,
    /// 时区标识。
    pub timezone: Option<String>,
    /// 当前状态。
    pub status: Option<String>,
    /// 优先级。
    pub priority: Option<i32>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    pub owner_user_label: Option<String>,
    /// 参与人展示标签集合。
    pub participant_labels: Option<Vec<String>>,
    /// 来源类型。
    pub source_type: Option<String>,
    /// 原始文本快照。
    pub source_text_snapshot: Option<String>,
    /// 外部提供方标识。
    pub external_provider: Option<String>,
    /// 外部事件 ID。
    pub external_event_id: Option<String>,
    /// 提醒规则列表；传空数组表示清空。
    pub reminders: Option<Vec<CalendarReminderRule>>,
}

/// 事件列表筛选条件。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCalendarEventsQuery {
    /// 起始时间下界。
    pub start_at_from: Option<String>,
    /// 起始时间上界。
    pub start_at_to: Option<String>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 事件类型过滤。
    pub event_types: Option<Vec<String>>,
    /// 状态过滤。
    pub statuses: Option<Vec<String>>,
    /// 关键字，匹配标题、说明、负责人和参与人。
    pub keyword: Option<String>,
}

/// 日程面板按天分组的聚合结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAgendaDay {
    /// 日期键，格式为 YYYY-MM-DD。
    pub day: String,
    /// 当天事件列表。
    pub events: Vec<CalendarEventRecord>,
}

/// 冲突查询请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCalendarConflictsQuery {
    /// 事件开始时间。
    pub start_at: String,
    /// 事件结束时间。
    pub end_at: Option<String>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 查询时排除的事件 ID，便于编辑时忽略自身。
    pub exclude_event_id: Option<String>,
}

/// 截止事项模板。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTemplateRecord {
    /// 模板唯一标识。
    pub id: String,
    /// 模板名称。
    pub name: String,
    /// 模板说明。
    pub description: String,
    /// 生成事件类型。
    pub event_type: String,
    /// 默认标题。
    pub default_title: String,
    /// 相对 anchor 的天偏移。
    pub relative_days: i64,
    /// 相对 anchor 的分钟偏移。
    pub relative_minutes: i64,
    /// 是否默认全天。
    pub all_day: bool,
    /// 默认优先级。
    pub priority: i32,
    /// 默认提醒规则。
    pub reminder_offsets: Vec<i64>,
}

/// 套用模板请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCalendarTemplateInput {
    /// 模板 ID。
    pub template_id: String,
    /// 锚点时间。
    pub anchor_at: String,
    /// 标题覆盖。
    pub title_override: Option<String>,
    /// 说明覆盖。
    pub description_override: Option<String>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    pub owner_user_label: Option<String>,
    /// 参与人展示标签集合。
    pub participant_labels: Option<Vec<String>>,
}

/// 完成事项请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteCalendarEventInput {
    /// 完成时写入的来源类型；AI 完成时可传 `AI_UPDATED`。
    pub source_type: Option<String>,
}

/// 周期日程规则记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringCalendarRuleRecord {
    /// 规则唯一标识。
    pub id: String,
    /// 规则标题。
    pub title: String,
    /// 用户原始自然语言描述。
    pub original_text: String,
    /// 5 字段 cron 表达式：minute hour day-of-month month day-of-week。
    pub cron: String,
    /// 时区标识，首版固定支持 Asia/Shanghai。
    pub timezone: String,
    /// 展示到日历上的事项类型。
    pub event_type: String,
    /// 到点后发送的提醒正文；为空时使用标题生成默认提醒。
    pub message: String,
    /// 提醒渠道，支持 DESKTOP 与 WECHAT_SELF。
    pub channels: Vec<String>,
    /// 规则状态：ACTIVE / PAUSED。
    pub status: String,
    /// 规则生效起点。
    pub start_at: String,
    /// 规则生效终点；为空表示长期有效。
    pub end_at: String,
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 负责人展示标签。
    pub owner_user_label: String,
    /// 来源类型。
    pub source_type: String,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 创建周期日程规则请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecurringCalendarRuleInput {
    /// 规则标题。
    pub title: String,
    /// 用户原始自然语言描述。
    pub original_text: Option<String>,
    /// 5 字段 cron 表达式。
    pub cron: String,
    /// 时区标识；为空时默认 Asia/Shanghai。
    pub timezone: Option<String>,
    /// 展示到日历上的事项类型。
    pub event_type: String,
    /// 到点后发送的提醒正文。
    pub message: Option<String>,
    /// 提醒渠道。
    pub channels: Option<Vec<String>>,
    /// 规则状态。
    pub status: Option<String>,
    /// 规则生效起点。
    pub start_at: Option<String>,
    /// 规则生效终点。
    pub end_at: Option<String>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    pub owner_user_label: Option<String>,
    /// 来源类型；AI 创建时可传 AI_CREATED。
    pub source_type: Option<String>,
}

/// 更新周期日程规则请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRecurringCalendarRuleInput {
    /// 规则标题。
    pub title: Option<String>,
    /// 用户原始自然语言描述。
    pub original_text: Option<String>,
    /// 5 字段 cron 表达式。
    pub cron: Option<String>,
    /// 时区标识。
    pub timezone: Option<String>,
    /// 展示到日历上的事项类型。
    pub event_type: Option<String>,
    /// 到点后发送的提醒正文。
    pub message: Option<String>,
    /// 提醒渠道。
    pub channels: Option<Vec<String>>,
    /// 规则状态。
    pub status: Option<String>,
    /// 规则生效起点。
    pub start_at: Option<String>,
    /// 规则生效终点。
    pub end_at: Option<String>,
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    pub owner_user_label: Option<String>,
    /// 来源类型。
    pub source_type: Option<String>,
}

/// 周期规则预览请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRecurringCalendarRuleInput {
    /// 5 字段 cron 表达式。
    pub cron: String,
    /// 时区标识；为空时默认 Asia/Shanghai。
    pub timezone: Option<String>,
    /// 从哪个时间之后开始预览。
    pub from_at: Option<String>,
    /// 最多返回几次，默认 5。
    pub limit: Option<usize>,
}

/// 周期日程执行点。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringCalendarOccurrence {
    /// 执行点稳定标识。
    pub id: String,
    /// 所属规则 ID。
    pub rule_id: String,
    /// 规则标题。
    pub title: String,
    /// 展示到日历上的事项类型。
    pub event_type: String,
    /// 执行时间。
    pub scheduled_at: String,
    /// 日历开始时间。
    pub start_at: String,
    /// 日历结束时间。
    pub end_at: String,
    /// 时区标识。
    pub timezone: String,
    /// 到点后发送的提醒正文。
    pub message: String,
    /// 提醒渠道。
    pub channels: Vec<String>,
    /// 已完成投递的渠道。
    pub delivered_channels: Vec<String>,
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 负责人展示标签。
    pub owner_user_label: String,
    /// 来源类型。
    pub source_type: String,
    /// 所属规则快照。
    pub rule: RecurringCalendarRuleRecord,
}

/// 日历聚合项：普通事项或周期执行点。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarScheduleItem {
    /// item 类型：EVENT / RECURRING_OCCURRENCE。
    pub item_type: String,
    /// 普通事项。
    pub event: Option<CalendarEventRecord>,
    /// 周期执行点。
    pub occurrence: Option<RecurringCalendarOccurrence>,
}

/// 记录周期执行点已投递请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkRecurringCalendarDeliveryInput {
    /// 所属规则 ID。
    pub rule_id: String,
    /// 执行时间。
    pub scheduled_at: String,
    /// 投递渠道。
    pub channel: String,
}

/// 初始化日历存储结构并写入默认模板。
pub(crate) fn initialize_calendar_store(database: &Path) -> Result<(), String> {
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  event_type TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  case_id TEXT NOT NULL DEFAULT '',
  case_path_snapshot TEXT NOT NULL DEFAULT '',
  owner_user_label TEXT NOT NULL DEFAULT '',
  participant_labels_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL,
  source_text_snapshot TEXT NOT NULL DEFAULT '',
  external_provider TEXT NOT NULL DEFAULT '',
  external_event_id TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)"#,
    )?;
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_reminders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'DESKTOP',
  FOREIGN KEY(event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
)"#,
    )?;
    ensure_calendar_reminder_channel_column(database)?;
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  event_type TEXT NOT NULL,
  default_title TEXT NOT NULL,
  relative_days INTEGER NOT NULL DEFAULT 0,
  relative_minutes INTEGER NOT NULL DEFAULT 0,
  all_day INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  reminder_offsets_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)"#,
    )?;
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_event_audits (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source_type TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)"#,
    )?;
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_recurring_rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_text TEXT NOT NULL DEFAULT '',
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  channels_json TEXT NOT NULL DEFAULT '["DESKTOP"]',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL DEFAULT '',
  case_id TEXT NOT NULL DEFAULT '',
  case_path_snapshot TEXT NOT NULL DEFAULT '',
  owner_user_label TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'AI_CREATED',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)"#,
    )?;
    execute_sql(
        database,
        r#"
CREATE TABLE IF NOT EXISTS calendar_recurring_deliveries (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  UNIQUE(rule_id, scheduled_at, channel),
  FOREIGN KEY(rule_id) REFERENCES calendar_recurring_rules(id) ON DELETE CASCADE
)"#,
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at)",
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_events_case_id ON calendar_events(case_id)",
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status)",
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_recurring_rules_status ON calendar_recurring_rules(status)",
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_recurring_rules_case_id ON calendar_recurring_rules(case_id)",
    )?;
    execute_sql(
        database,
        "CREATE INDEX IF NOT EXISTS idx_calendar_recurring_deliveries_scheduled_at ON calendar_recurring_deliveries(scheduled_at)",
    )?;
    seed_calendar_templates(database)
}

fn ensure_calendar_reminder_channel_column(database: &Path) -> Result<(), String> {
    let connection = open_connection(database)?;
    let column_names = calendar_reminder_column_names(&connection)?;
    if column_names.iter().any(|name| name == "channel") {
        return Ok(());
    }
    connection
        .execute(
            "ALTER TABLE calendar_reminders ADD COLUMN channel TEXT NOT NULL DEFAULT 'DESKTOP'",
            [],
        )
        .map(|_| ())
        .map_err(|err| format!("迁移日历提醒渠道字段失败：{err}"))
}

fn calendar_reminder_column_names(
    connection: &rusqlite::Connection,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(calendar_reminders)")
        .map_err(|err| format!("读取日历提醒表结构失败：{err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("读取日历提醒表结构失败：{err}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取日历提醒表结构失败：{err}"))
}

/// 查询工作空间中的日历事项。
pub(crate) fn list_calendar_events(
    database: &Path,
    query: ListCalendarEventsQuery,
) -> Result<Vec<CalendarEventRecord>, String> {
    initialize_calendar_store(database)?;
    let events = load_calendar_events(database)?;
    Ok(events
        .into_iter()
        .filter(|event| filter_calendar_event(event, &query))
        .collect())
}

/// 创建日历事项。
pub(crate) fn create_calendar_event(
    database: &Path,
    payload: CreateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("创建日历事务失败：{err}"))?;
    let event = build_new_calendar_event(&tx, payload)?;
    insert_calendar_event(&tx, &event)?;
    replace_event_reminders(&tx, &event.id, &event.reminders)?;
    insert_calendar_audit(&tx, &event, "CREATED")?;
    tx.commit()
        .map_err(|err| format!("提交创建日历事项失败：{err}"))?;
    Ok(event)
}

/// 更新日历事项。
pub(crate) fn update_calendar_event(
    database: &Path,
    event_id: &str,
    payload: UpdateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("更新日历事务失败：{err}"))?;
    let current = load_calendar_event_by_id(&tx, event_id)?
        .ok_or_else(|| format!("日历事项不存在：{event_id}"))?;
    let next = merge_calendar_event(&tx, current, payload)?;
    persist_calendar_event(&tx, &next)?;
    replace_event_reminders(&tx, &next.id, &next.reminders)?;
    insert_calendar_audit(&tx, &next, "UPDATED")?;
    tx.commit()
        .map_err(|err| format!("提交更新日历事项失败：{err}"))?;
    Ok(next)
}

/// 删除日历事项。
pub(crate) fn delete_calendar_event(database: &Path, event_id: &str) -> Result<(), String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("删除日历事务失败：{err}"))?;
    let current = load_calendar_event_by_id(&tx, event_id)?
        .ok_or_else(|| format!("日历事项不存在：{event_id}"))?;
    insert_calendar_audit(&tx, &current, "DELETED")?;
    tx.execute(
        "DELETE FROM calendar_reminders WHERE event_id = ?",
        params![event_id],
    )
    .map_err(|err| format!("删除日历提醒失败：{err}"))?;
    let deleted = tx
        .execute(
            "DELETE FROM calendar_events WHERE id = ?",
            params![event_id],
        )
        .map_err(|err| format!("删除日历事项失败：{err}"))?;
    if deleted == 0 {
        return Err(format!("日历事项不存在：{event_id}"));
    }
    tx.commit()
        .map_err(|err| format!("提交删除日历事项失败：{err}"))
}

/// 将事项标记为已完成。
pub(crate) fn complete_calendar_event(
    database: &Path,
    event_id: &str,
    payload: CompleteCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    initialize_calendar_store(database)?;
    update_calendar_event(
        database,
        event_id,
        UpdateCalendarEventInput {
            status: Some("DONE".to_string()),
            source_type: payload.source_type,
            title: None,
            description: None,
            event_type: None,
            start_at: None,
            end_at: None,
            all_day: None,
            timezone: None,
            priority: None,
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: None,
            participant_labels: None,
            source_text_snapshot: None,
            external_provider: None,
            external_event_id: None,
            reminders: None,
        },
    )
}

/// 查询未来 30 天日程，并按日期分组。
pub(crate) fn list_calendar_agenda(database: &Path) -> Result<Vec<CalendarAgendaDay>, String> {
    let now = Utc::now();
    let end = now + Duration::days(30);
    let events = list_calendar_events(
        database,
        ListCalendarEventsQuery {
            start_at_from: Some(now.to_rfc3339()),
            start_at_to: Some(end.to_rfc3339()),
            ..ListCalendarEventsQuery::default()
        },
    )?;
    let mut grouped = BTreeMap::<String, Vec<CalendarEventRecord>>::new();
    for event in events {
        let day = parse_event_datetime(&event.start_at)?
            .with_timezone(&Local)
            .date_naive()
            .to_string();
        grouped.entry(day).or_default().push(event);
    }
    Ok(grouped
        .into_iter()
        .map(|(day, events)| CalendarAgendaDay { day, events })
        .collect())
}

/// 读取默认模板集合。
pub(crate) fn list_calendar_templates(
    database: &Path,
) -> Result<Vec<CalendarTemplateRecord>, String> {
    initialize_calendar_store(database)?;
    let connection = open_connection(database)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, description, event_type, default_title, relative_days, relative_minutes, all_day, priority, reminder_offsets_json FROM calendar_templates ORDER BY name ASC",
        )
        .map_err(|err| format!("读取日历模板失败：{err}"))?;
    let rows = statement
        .query_map([], |row| {
            let reminder_offsets_json: String = row.get("reminder_offsets_json")?;
            let reminder_offsets = parse_json_vec_i64(&reminder_offsets_json)?;
            Ok(CalendarTemplateRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                description: row.get("description")?,
                event_type: row.get("event_type")?,
                default_title: row.get("default_title")?,
                relative_days: row.get("relative_days")?,
                relative_minutes: row.get("relative_minutes")?,
                all_day: row.get::<_, i32>("all_day")? == 1,
                priority: row.get("priority")?,
                reminder_offsets,
            })
        })
        .map_err(|err| format!("读取日历模板失败：{err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取日历模板失败：{err}"))
}

/// 根据模板生成截止事项。
pub(crate) fn apply_calendar_template(
    database: &Path,
    payload: ApplyCalendarTemplateInput,
) -> Result<CalendarEventRecord, String> {
    initialize_calendar_store(database)?;
    let template = list_calendar_templates(database)?
        .into_iter()
        .find(|item| item.id == payload.template_id)
        .ok_or_else(|| format!("日历模板不存在：{}", payload.template_id))?;
    let anchor = parse_event_datetime(&payload.anchor_at)?;
    let target = anchor
        + Duration::days(template.relative_days)
        + Duration::minutes(template.relative_minutes);
    let reminders = template
        .reminder_offsets
        .into_iter()
        .map(|offset_minutes| CalendarReminderRule {
            offset_minutes,
            channel: default_reminder_channel(),
        })
        .collect::<Vec<_>>();
    let event = create_calendar_event(
        database,
        CreateCalendarEventInput {
            title: payload
                .title_override
                .unwrap_or_else(|| template.default_title.clone()),
            description: Some(
                payload
                    .description_override
                    .unwrap_or_else(|| template.description.clone()),
            ),
            event_type: template.event_type,
            start_at: target.to_rfc3339(),
            end_at: Some(target.to_rfc3339()),
            all_day: Some(template.all_day),
            timezone: Some("Asia/Shanghai".to_string()),
            status: Some("SCHEDULED".to_string()),
            priority: Some(template.priority),
            case_id: payload.case_id,
            case_path_snapshot: payload.case_path_snapshot,
            owner_user_label: payload.owner_user_label,
            participant_labels: payload.participant_labels,
            source_type: Some("TEMPLATE".to_string()),
            source_text_snapshot: Some(format!("template:{}", payload.template_id)),
            external_provider: Some(String::new()),
            external_event_id: Some(String::new()),
            reminders: Some(reminders),
        },
    )?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("模板审计事务失败：{err}"))?;
    insert_calendar_audit(&tx, &event, "TEMPLATE_APPLIED")?;
    tx.commit()
        .map_err(|err| format!("提交模板审计失败：{err}"))?;
    Ok(event)
}

/// 查询指定时间段的冲突事项。
pub(crate) fn search_calendar_conflicts(
    database: &Path,
    query: SearchCalendarConflictsQuery,
) -> Result<Vec<CalendarEventRecord>, String> {
    initialize_calendar_store(database)?;
    let start_at = query.start_at;
    let end_at = query.end_at.unwrap_or_else(|| start_at.clone());
    let start = parse_event_datetime(&start_at)?;
    let end = parse_event_datetime(&end_at)?;
    if end < start {
        return Err("冲突查询结束时间不能早于开始时间".to_string());
    }
    let events = load_calendar_events(database)?;
    Ok(events
        .into_iter()
        .filter(|event| {
            query
                .case_id
                .as_ref()
                .map_or(true, |case_id| event.case_id == *case_id)
        })
        .filter(|event| {
            query
                .exclude_event_id
                .as_ref()
                .map_or(true, |exclude_id| event.id != *exclude_id)
        })
        .filter(|event| event.status == "SCHEDULED")
        .filter(|event| {
            let event_start = parse_event_datetime(&event.start_at).ok();
            let event_end = parse_event_datetime(&event.end_at).ok();
            match (event_start, event_end) {
                (Some(event_start), Some(event_end)) => event_start <= end && event_end >= start,
                _ => false,
            }
        })
        .collect())
}

/// 查询周期日程规则。
pub(crate) fn list_recurring_calendar_rules(
    database: &Path,
) -> Result<Vec<RecurringCalendarRuleRecord>, String> {
    initialize_calendar_store(database)?;
    load_recurring_rules(database)
}

/// 创建周期日程规则。
pub(crate) fn create_recurring_calendar_rule(
    database: &Path,
    payload: CreateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("创建周期日程事务失败：{err}"))?;
    let rule = build_new_recurring_rule(payload)?;
    insert_recurring_rule(&tx, &rule)?;
    tx.commit()
        .map_err(|err| format!("提交创建周期日程失败：{err}"))?;
    Ok(rule)
}

/// 更新周期日程规则。
pub(crate) fn update_recurring_calendar_rule(
    database: &Path,
    rule_id: &str,
    payload: UpdateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("更新周期日程事务失败：{err}"))?;
    let current = load_recurring_rule_by_id(&tx, rule_id)?
        .ok_or_else(|| format!("周期日程规则不存在：{rule_id}"))?;
    let next = merge_recurring_rule(current, payload)?;
    persist_recurring_rule(&tx, &next)?;
    tx.commit()
        .map_err(|err| format!("提交更新周期日程失败：{err}"))?;
    Ok(next)
}

/// 暂停周期日程规则。
pub(crate) fn pause_recurring_calendar_rule(
    database: &Path,
    rule_id: &str,
) -> Result<RecurringCalendarRuleRecord, String> {
    update_recurring_calendar_rule(
        database,
        rule_id,
        UpdateRecurringCalendarRuleInput {
            status: Some("PAUSED".to_string()),
            title: None,
            original_text: None,
            cron: None,
            timezone: None,
            event_type: None,
            message: None,
            channels: None,
            start_at: None,
            end_at: None,
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: None,
            source_type: None,
        },
    )
}

/// 删除周期日程规则。
pub(crate) fn delete_recurring_calendar_rule(database: &Path, rule_id: &str) -> Result<(), String> {
    initialize_calendar_store(database)?;
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("删除周期日程事务失败：{err}"))?;
    let updated = tx
        .execute(
            "UPDATE calendar_recurring_rules SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0",
            params![now_rfc3339(), rule_id],
        )
        .map_err(|err| format!("删除周期日程规则失败：{err}"))?;
    if updated == 0 {
        return Err(format!("周期日程规则不存在：{rule_id}"));
    }
    tx.commit()
        .map_err(|err| format!("提交删除周期日程失败：{err}"))
}

/// 预览周期日程未来执行时间。
pub(crate) fn preview_recurring_calendar_rule(
    payload: PreviewRecurringCalendarRuleInput,
) -> Result<Vec<String>, String> {
    let schedule = CronSchedule::parse(&payload.cron)?;
    validate_recurring_timezone(payload.timezone.as_deref().unwrap_or("Asia/Shanghai"))?;
    let from = match payload.from_at.as_deref() {
        Some(value) if !value.trim().is_empty() => parse_event_datetime(value)?,
        _ => Utc::now(),
    };
    let limit = payload.limit.unwrap_or(5).clamp(1, 20);
    Ok(next_cron_occurrences(&schedule, from, limit)
        .into_iter()
        .map(|item| item.to_rfc3339())
        .collect())
}

/// 查询日历聚合项，包含普通事项与周期规则展开出的虚拟执行点。
pub(crate) fn list_calendar_schedule_items(
    database: &Path,
    query: ListCalendarEventsQuery,
) -> Result<Vec<CalendarScheduleItem>, String> {
    initialize_calendar_store(database)?;
    let (range_start, range_end) = schedule_query_range(&query)?;
    let delivered_channels = load_recurring_deliveries(database, &range_start, &range_end)?;
    let mut items = list_calendar_events(database, query.clone())?
        .into_iter()
        .map(|event| CalendarScheduleItem {
            item_type: "EVENT".to_string(),
            event: Some(event),
            occurrence: None,
        })
        .collect::<Vec<_>>();

    for rule in load_recurring_rules(database)?
        .into_iter()
        .filter(|rule| rule.status == "ACTIVE")
        .filter(|rule| filter_recurring_rule(rule, &query))
    {
        for mut occurrence in expand_recurring_rule(&rule, range_start, range_end)? {
            occurrence.delivered_channels = delivered_channels
                .get(&(occurrence.rule_id.clone(), occurrence.scheduled_at.clone()))
                .cloned()
                .unwrap_or_default();
            items.push(CalendarScheduleItem {
                item_type: "RECURRING_OCCURRENCE".to_string(),
                event: None,
                occurrence: Some(occurrence),
            });
        }
    }

    items.sort_by(|left, right| schedule_item_start(left).cmp(&schedule_item_start(right)));
    Ok(items)
}

/// 记录周期日程指定执行点的投递结果。
pub(crate) fn mark_recurring_calendar_delivery(
    database: &Path,
    payload: MarkRecurringCalendarDeliveryInput,
) -> Result<bool, String> {
    initialize_calendar_store(database)?;
    let rule_id = payload.rule_id.trim();
    if rule_id.is_empty() {
        return Err("周期日程规则 ID 不能为空".to_string());
    }
    let scheduled_at = normalize_datetime_string(&payload.scheduled_at)?;
    let channel = normalize_recurring_channel(&payload.channel)?;
    let connection = open_connection(database)?;
    let inserted = connection
        .execute(
            "INSERT OR IGNORE INTO calendar_recurring_deliveries(id, rule_id, scheduled_at, channel, delivered_at) VALUES (?, ?, ?, ?, ?)",
            params![Uuid::new_v4().to_string(), rule_id, scheduled_at, channel, now_rfc3339()],
        )
        .map_err(|err| format!("记录周期提醒投递失败：{err}"))?;
    Ok(inserted > 0)
}

fn seed_calendar_templates(database: &Path) -> Result<(), String> {
    let defaults = [
        CalendarTemplateRecord {
            id: "deadline-defense".to_string(),
            name: "答辩期限".to_string(),
            description: "按锚点生成答辩提交期限提醒。".to_string(),
            event_type: "DEADLINE".to_string(),
            default_title: "答辩期限".to_string(),
            relative_days: 0,
            relative_minutes: 0,
            all_day: true,
            priority: 3,
            reminder_offsets: vec![24 * 60, 3 * 24 * 60],
        },
        CalendarTemplateRecord {
            id: "hearing-prep".to_string(),
            name: "开庭前准备".to_string(),
            description: "按庭期前 3 天生成准备事项。".to_string(),
            event_type: "FOLLOW_UP".to_string(),
            default_title: "开庭前准备".to_string(),
            relative_days: -3,
            relative_minutes: 0,
            all_day: true,
            priority: 2,
            reminder_offsets: vec![24 * 60],
        },
        CalendarTemplateRecord {
            id: "evidence-deadline".to_string(),
            name: "举证期限".to_string(),
            description: "按锚点生成举证截止事项。".to_string(),
            event_type: "DEADLINE".to_string(),
            default_title: "举证期限".to_string(),
            relative_days: 0,
            relative_minutes: 0,
            all_day: true,
            priority: 3,
            reminder_offsets: vec![24 * 60, 7 * 24 * 60],
        },
    ];
    let mut connection = open_connection(database)?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("写入默认日历模板事务失败：{err}"))?;
    for template in defaults {
        let now = now_rfc3339();
        tx.execute(
            "INSERT OR IGNORE INTO calendar_templates(id, name, description, event_type, default_title, relative_days, relative_minutes, all_day, priority, reminder_offsets_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                template.id,
                template.name,
                template.description,
                template.event_type,
                template.default_title,
                template.relative_days,
                template.relative_minutes,
                if template.all_day { 1 } else { 0 },
                template.priority,
                serde_json::to_string(&template.reminder_offsets)
                    .map_err(|err| format!("序列化默认模板提醒规则失败：{err}"))?,
                now,
                now,
            ],
        )
        .map_err(|err| format!("写入默认日历模板失败：{err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("提交默认日历模板失败：{err}"))
}

fn load_recurring_rules(database: &Path) -> Result<Vec<RecurringCalendarRuleRecord>, String> {
    let connection = open_connection(database)?;
    let mut statement = connection
        .prepare(
            "SELECT id, title, original_text, cron, timezone, event_type, message, channels_json, status, start_at, end_at, case_id, case_path_snapshot, owner_user_label, source_type, created_at, updated_at FROM calendar_recurring_rules WHERE deleted = 0 ORDER BY created_at DESC",
        )
        .map_err(|err| format!("读取周期日程规则失败：{err}"))?;
    let rows = statement
        .query_map([], map_recurring_rule_row)
        .map_err(|err| format!("读取周期日程规则失败：{err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取周期日程规则失败：{err}"))
}

fn load_recurring_rule_by_id(
    tx: &Transaction<'_>,
    rule_id: &str,
) -> Result<Option<RecurringCalendarRuleRecord>, String> {
    tx.query_row(
        "SELECT id, title, original_text, cron, timezone, event_type, message, channels_json, status, start_at, end_at, case_id, case_path_snapshot, owner_user_label, source_type, created_at, updated_at FROM calendar_recurring_rules WHERE id = ? AND deleted = 0",
        params![rule_id],
        map_recurring_rule_row,
    )
    .optional()
    .map_err(|err| format!("读取周期日程规则失败：{err}"))
}

fn map_recurring_rule_row(
    row: &rusqlite::Row<'_>,
) -> Result<RecurringCalendarRuleRecord, rusqlite::Error> {
    let channels_json: String = row.get("channels_json")?;
    let channels = serde_json::from_str::<Vec<String>>(&channels_json)
        .map_err(|err| row_text_error(format!("解析周期日程提醒渠道失败：{err}")))
        .and_then(|items| normalize_recurring_channels(Some(items)).map_err(row_text_error))?;
    Ok(RecurringCalendarRuleRecord {
        id: row.get("id")?,
        title: row.get("title")?,
        original_text: row.get("original_text")?,
        cron: row.get("cron")?,
        timezone: row.get("timezone")?,
        event_type: row.get("event_type")?,
        message: row.get("message")?,
        channels,
        status: row.get("status")?,
        start_at: row.get("start_at")?,
        end_at: row.get("end_at")?,
        case_id: row.get("case_id")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        owner_user_label: row.get("owner_user_label")?,
        source_type: row.get("source_type")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn build_new_recurring_rule(
    payload: CreateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    let now = now_rfc3339();
    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err("周期日程标题不能为空".to_string());
    }
    let cron = normalize_cron_expression(&payload.cron)?;
    CronSchedule::parse(&cron)?;
    let timezone =
        validate_recurring_timezone(payload.timezone.as_deref().unwrap_or("Asia/Shanghai"))?;
    validate_calendar_event_type(&payload.event_type)?;
    let status = validate_recurring_status(payload.status.as_deref().unwrap_or("ACTIVE"))?;
    let channels = normalize_recurring_channels(payload.channels)?;
    let start_at = match payload.start_at.as_deref() {
        Some(value) if !value.trim().is_empty() => normalize_datetime_string(value)?,
        _ => now.clone(),
    };
    let end_at = normalize_optional_datetime(payload.end_at.as_deref())?;
    validate_optional_recurring_range(&start_at, &end_at)?;
    let case_context = resolve_case_context(
        payload.case_id.as_deref(),
        payload.case_path_snapshot.as_deref(),
    )?;
    let source_type = payload
        .source_type
        .unwrap_or_else(|| "AI_CREATED".to_string());
    validate_calendar_source_type(&source_type)?;
    Ok(RecurringCalendarRuleRecord {
        id: Uuid::new_v4().to_string(),
        title: title.clone(),
        original_text: payload
            .original_text
            .unwrap_or_else(|| title.clone())
            .trim()
            .to_string(),
        cron,
        timezone,
        event_type: payload.event_type,
        message: payload.message.unwrap_or(title).trim().to_string(),
        channels,
        status,
        start_at,
        end_at,
        case_id: case_context.0,
        case_path_snapshot: case_context.1,
        owner_user_label: payload
            .owner_user_label
            .unwrap_or_default()
            .trim()
            .to_string(),
        source_type,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn merge_recurring_rule(
    current: RecurringCalendarRuleRecord,
    payload: UpdateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    let title = payload.title.unwrap_or(current.title).trim().to_string();
    if title.is_empty() {
        return Err("周期日程标题不能为空".to_string());
    }
    let cron = match payload.cron {
        Some(value) => normalize_cron_expression(&value)?,
        None => current.cron,
    };
    CronSchedule::parse(&cron)?;
    let timezone = validate_recurring_timezone(
        payload
            .timezone
            .as_deref()
            .unwrap_or(current.timezone.as_str()),
    )?;
    let event_type = payload.event_type.unwrap_or(current.event_type);
    validate_calendar_event_type(&event_type)?;
    let status = validate_recurring_status(payload.status.as_deref().unwrap_or(&current.status))?;
    let channels = match payload.channels {
        Some(channels) => normalize_recurring_channels(Some(channels))?,
        None => current.channels,
    };
    let start_at = match payload.start_at {
        Some(value) if !value.trim().is_empty() => normalize_datetime_string(&value)?,
        Some(_) => current.start_at,
        None => current.start_at,
    };
    let end_at = match payload.end_at {
        Some(value) => normalize_optional_datetime(Some(&value))?,
        None => current.end_at,
    };
    validate_optional_recurring_range(&start_at, &end_at)?;
    let case_context = resolve_case_context(
        payload.case_id.as_deref().or_else(|| {
            if current.case_id.is_empty() {
                None
            } else {
                Some(current.case_id.as_str())
            }
        }),
        payload
            .case_path_snapshot
            .as_deref()
            .or_else(|| Some(current.case_path_snapshot.as_str())),
    )?;
    let source_type = payload.source_type.unwrap_or(current.source_type);
    validate_calendar_source_type(&source_type)?;
    Ok(RecurringCalendarRuleRecord {
        id: current.id,
        title,
        original_text: payload
            .original_text
            .unwrap_or(current.original_text)
            .trim()
            .to_string(),
        cron,
        timezone,
        event_type,
        message: payload
            .message
            .unwrap_or(current.message)
            .trim()
            .to_string(),
        channels,
        status,
        start_at,
        end_at,
        case_id: case_context.0,
        case_path_snapshot: case_context.1,
        owner_user_label: payload
            .owner_user_label
            .unwrap_or(current.owner_user_label)
            .trim()
            .to_string(),
        source_type,
        created_at: current.created_at,
        updated_at: now_rfc3339(),
    })
}

fn insert_recurring_rule(
    tx: &Transaction<'_>,
    rule: &RecurringCalendarRuleRecord,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO calendar_recurring_rules(id, title, original_text, cron, timezone, event_type, message, channels_json, status, start_at, end_at, case_id, case_path_snapshot, owner_user_label, source_type, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        params![
            rule.id,
            rule.title,
            rule.original_text,
            rule.cron,
            rule.timezone,
            rule.event_type,
            rule.message,
            serde_json::to_string(&rule.channels)
                .map_err(|err| format!("序列化周期日程提醒渠道失败：{err}"))?,
            rule.status,
            rule.start_at,
            rule.end_at,
            rule.case_id,
            rule.case_path_snapshot,
            rule.owner_user_label,
            rule.source_type,
            rule.created_at,
            rule.updated_at,
        ],
    )
    .map(|_| ())
    .map_err(|err| format!("写入周期日程规则失败：{err}"))
}

fn persist_recurring_rule(
    tx: &Transaction<'_>,
    rule: &RecurringCalendarRuleRecord,
) -> Result<(), String> {
    tx.execute(
        "UPDATE calendar_recurring_rules SET title = ?, original_text = ?, cron = ?, timezone = ?, event_type = ?, message = ?, channels_json = ?, status = ?, start_at = ?, end_at = ?, case_id = ?, case_path_snapshot = ?, owner_user_label = ?, source_type = ?, updated_at = ? WHERE id = ? AND deleted = 0",
        params![
            rule.title,
            rule.original_text,
            rule.cron,
            rule.timezone,
            rule.event_type,
            rule.message,
            serde_json::to_string(&rule.channels)
                .map_err(|err| format!("序列化周期日程提醒渠道失败：{err}"))?,
            rule.status,
            rule.start_at,
            rule.end_at,
            rule.case_id,
            rule.case_path_snapshot,
            rule.owner_user_label,
            rule.source_type,
            rule.updated_at,
            rule.id,
        ],
    )
    .map_err(|err| format!("更新周期日程规则失败：{err}"))
    .and_then(|updated| {
        if updated == 0 {
            Err(format!("周期日程规则不存在：{}", rule.id))
        } else {
            Ok(())
        }
    })
}

fn load_recurring_deliveries(
    database: &Path,
    range_start: &DateTime<Utc>,
    range_end: &DateTime<Utc>,
) -> Result<HashMap<(String, String), Vec<String>>, String> {
    let connection = open_connection(database)?;
    let mut statement = connection
        .prepare(
            "SELECT rule_id, scheduled_at, channel FROM calendar_recurring_deliveries WHERE scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at ASC",
        )
        .map_err(|err| format!("读取周期提醒投递记录失败：{err}"))?;
    let rows = statement
        .query_map(
            params![range_start.to_rfc3339(), range_end.to_rfc3339()],
            |row| {
                Ok((
                    row.get::<_, String>("rule_id")?,
                    row.get::<_, String>("scheduled_at")?,
                    row.get::<_, String>("channel")?,
                ))
            },
        )
        .map_err(|err| format!("读取周期提醒投递记录失败：{err}"))?;
    let mut delivered = HashMap::<(String, String), Vec<String>>::new();
    for row in rows {
        let (rule_id, scheduled_at, channel) =
            row.map_err(|err| format!("读取周期提醒投递记录失败：{err}"))?;
        delivered
            .entry((rule_id, scheduled_at))
            .or_default()
            .push(channel);
    }
    for channels in delivered.values_mut() {
        channels.sort();
        channels.dedup();
    }
    Ok(delivered)
}

fn schedule_query_range(
    query: &ListCalendarEventsQuery,
) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    let now = Utc::now();
    let range_start = match query.start_at_from.as_deref() {
        Some(value) if !value.trim().is_empty() => parse_event_datetime(value)?,
        _ => now - Duration::days(DEFAULT_RECURRING_LOOKBACK_DAYS),
    };
    let range_end = match query.start_at_to.as_deref() {
        Some(value) if !value.trim().is_empty() => parse_event_datetime(value)?,
        _ => now + Duration::days(DEFAULT_RECURRING_LOOKAHEAD_DAYS),
    };
    if range_end < range_start {
        return Err("日程查询结束时间不能早于开始时间".to_string());
    }
    Ok((range_start, range_end))
}

fn filter_recurring_rule(
    rule: &RecurringCalendarRuleRecord,
    query: &ListCalendarEventsQuery,
) -> bool {
    if let Some(case_id) = query
        .case_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if rule.case_id != case_id {
            return false;
        }
    }
    if let Some(event_types) = query.event_types.as_ref().filter(|items| !items.is_empty()) {
        if !event_types.iter().any(|value| value == &rule.event_type) {
            return false;
        }
    }
    if let Some(statuses) = query.statuses.as_ref().filter(|items| !items.is_empty()) {
        let matches_status = statuses
            .iter()
            .any(|value| value == "SCHEDULED" || value == &rule.status);
        if !matches_status {
            return false;
        }
    }
    if let Some(keyword) = query
        .keyword
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    {
        let haystack = [
            rule.title.to_lowercase(),
            rule.original_text.to_lowercase(),
            rule.message.to_lowercase(),
            rule.owner_user_label.to_lowercase(),
            rule.case_id.to_lowercase(),
        ]
        .join(" ");
        if !haystack.contains(&keyword) {
            return false;
        }
    }
    true
}

fn expand_recurring_rule(
    rule: &RecurringCalendarRuleRecord,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
) -> Result<Vec<RecurringCalendarOccurrence>, String> {
    let schedule = CronSchedule::parse(&rule.cron)?;
    let rule_start = parse_event_datetime(&rule.start_at)?;
    let mut start = if rule_start > range_start {
        rule_start
    } else {
        range_start
    };
    let mut end = range_end;
    if !rule.end_at.trim().is_empty() {
        let rule_end = parse_event_datetime(&rule.end_at)?;
        if rule_end < end {
            end = rule_end;
        }
    }
    if end < start {
        return Ok(Vec::new());
    }
    start = ceil_to_minute(start);
    let occurrences =
        cron_occurrences_in_range(&schedule, start, end, MAX_RECURRING_OCCURRENCES_PER_RULE);
    Ok(occurrences
        .into_iter()
        .map(|scheduled_at| {
            let scheduled_at_text = scheduled_at.to_rfc3339();
            RecurringCalendarOccurrence {
                id: format!("recurring:{}:{}", rule.id, scheduled_at_text),
                rule_id: rule.id.clone(),
                title: rule.title.clone(),
                event_type: rule.event_type.clone(),
                scheduled_at: scheduled_at_text.clone(),
                start_at: scheduled_at_text.clone(),
                end_at: scheduled_at_text,
                timezone: rule.timezone.clone(),
                message: rule.message.clone(),
                channels: rule.channels.clone(),
                delivered_channels: Vec::new(),
                case_id: rule.case_id.clone(),
                case_path_snapshot: rule.case_path_snapshot.clone(),
                owner_user_label: rule.owner_user_label.clone(),
                source_type: rule.source_type.clone(),
                rule: rule.clone(),
            }
        })
        .collect())
}

fn schedule_item_start(item: &CalendarScheduleItem) -> String {
    item.event
        .as_ref()
        .map(|event| event.start_at.clone())
        .or_else(|| {
            item.occurrence
                .as_ref()
                .map(|occurrence| occurrence.start_at.clone())
        })
        .unwrap_or_default()
}

fn normalize_cron_expression(value: &str) -> Result<String, String> {
    let fields = value
        .split_whitespace()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if fields.len() != 5 {
        return Err(
            "周期日程 cron 必须是 5 字段：minute hour day-of-month month day-of-week".to_string(),
        );
    }
    Ok(fields.join(" "))
}

fn validate_recurring_timezone(value: &str) -> Result<String, String> {
    let timezone = value.trim();
    if timezone == "Asia/Shanghai" {
        Ok(timezone.to_string())
    } else {
        Err(format!("首版周期日程仅支持 Asia/Shanghai 时区：{timezone}"))
    }
}

fn validate_recurring_status(value: &str) -> Result<String, String> {
    let status = value.trim().to_uppercase();
    if CALENDAR_RECURRING_RULE_STATUSES
        .iter()
        .any(|candidate| *candidate == status)
    {
        Ok(status)
    } else {
        Err(format!("不支持的周期日程状态：{value}"))
    }
}

fn normalize_recurring_channels(values: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut channels = values
        .unwrap_or_else(|| vec!["DESKTOP".to_string()])
        .into_iter()
        .map(|value| normalize_recurring_channel(&value))
        .collect::<Result<Vec<_>, _>>()?;
    if channels.is_empty() {
        channels.push("DESKTOP".to_string());
    }
    channels.sort();
    channels.dedup();
    Ok(channels)
}

fn normalize_recurring_channel(value: &str) -> Result<String, String> {
    let channel = value.trim().to_uppercase();
    if CALENDAR_RECURRING_CHANNELS
        .iter()
        .any(|candidate| *candidate == channel)
    {
        Ok(channel)
    } else {
        Err(format!("不支持的周期日程提醒渠道：{value}"))
    }
}

fn normalize_optional_datetime(value: Option<&str>) -> Result<String, String> {
    match value {
        Some(value) if !value.trim().is_empty() => normalize_datetime_string(value),
        _ => Ok(String::new()),
    }
}

fn validate_optional_recurring_range(start_at: &str, end_at: &str) -> Result<(), String> {
    if end_at.trim().is_empty() {
        return Ok(());
    }
    validate_time_range(start_at, end_at)
}

fn row_text_error(message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

#[derive(Debug, Clone)]
struct CronSchedule {
    minutes: BTreeSet<u32>,
    hours: BTreeSet<u32>,
    days_of_month: BTreeSet<u32>,
    months: BTreeSet<u32>,
    days_of_week: BTreeSet<u32>,
}

impl CronSchedule {
    fn parse(expression: &str) -> Result<Self, String> {
        let normalized = normalize_cron_expression(expression)?;
        let fields = normalized.split_whitespace().collect::<Vec<_>>();
        Ok(Self {
            minutes: parse_cron_field(fields[0], 0, 59, "minute", false)?,
            hours: parse_cron_field(fields[1], 0, 23, "hour", false)?,
            days_of_month: parse_cron_field(fields[2], 1, 31, "day-of-month", false)?,
            months: parse_cron_field(fields[3], 1, 12, "month", false)?,
            days_of_week: parse_cron_field(fields[4], 0, 7, "day-of-week", true)?,
        })
    }

    fn matches(&self, datetime: DateTime<FixedOffset>) -> bool {
        self.minutes.contains(&datetime.minute())
            && self.hours.contains(&datetime.hour())
            && self.days_of_month.contains(&datetime.day())
            && self.months.contains(&datetime.month())
            && self
                .days_of_week
                .contains(&datetime.weekday().num_days_from_sunday())
    }
}

fn parse_cron_field(
    raw: &str,
    min: u32,
    max: u32,
    field_name: &str,
    normalize_sunday: bool,
) -> Result<BTreeSet<u32>, String> {
    let mut values = BTreeSet::new();
    for part in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        let (range_part, step) = match part.split_once('/') {
            Some((range_part, step_part)) => {
                let step = step_part
                    .parse::<u32>()
                    .map_err(|_| format!("cron {field_name} 步进值不正确：{part}"))?;
                if step == 0 {
                    return Err(format!("cron {field_name} 步进值不能为 0"));
                }
                (range_part, step)
            }
            None => (part, 1),
        };
        let (start, end) = if range_part == "*" {
            (min, max)
        } else if let Some((left, right)) = range_part.split_once('-') {
            (
                parse_cron_number(left, min, max, field_name)?,
                parse_cron_number(right, min, max, field_name)?,
            )
        } else {
            let value = parse_cron_number(range_part, min, max, field_name)?;
            (value, value)
        };
        if end < start {
            return Err(format!("cron {field_name} 范围不正确：{part}"));
        }
        let mut value = start;
        while value <= end {
            let normalized = if normalize_sunday && value == 7 {
                0
            } else {
                value
            };
            if normalized < min || normalized > max || (normalize_sunday && normalized > 6) {
                return Err(format!("cron {field_name} 数值超出范围：{value}"));
            }
            values.insert(normalized);
            match value.checked_add(step) {
                Some(next) => value = next,
                None => break,
            }
        }
    }
    if values.is_empty() {
        return Err(format!("cron {field_name} 不能为空"));
    }
    Ok(values)
}

fn parse_cron_number(value: &str, min: u32, max: u32, field_name: &str) -> Result<u32, String> {
    let parsed = value
        .parse::<u32>()
        .map_err(|_| format!("cron {field_name} 数值不正确：{value}"))?;
    if parsed < min || parsed > max {
        Err(format!("cron {field_name} 数值超出范围：{value}"))
    } else {
        Ok(parsed)
    }
}

fn next_cron_occurrences(
    schedule: &CronSchedule,
    from: DateTime<Utc>,
    limit: usize,
) -> Vec<DateTime<Utc>> {
    let mut cursor = ceil_to_minute(from + Duration::seconds(1));
    let deadline = from + Duration::days(366 * 5);
    let mut occurrences = Vec::new();
    while cursor <= deadline && occurrences.len() < limit {
        if schedule.matches(cursor.with_timezone(&shanghai_offset())) {
            occurrences.push(cursor);
        }
        cursor += Duration::minutes(1);
    }
    occurrences
}

fn cron_occurrences_in_range(
    schedule: &CronSchedule,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    limit: usize,
) -> Vec<DateTime<Utc>> {
    let mut cursor = ceil_to_minute(start);
    let mut occurrences = Vec::new();
    while cursor <= end && occurrences.len() < limit {
        if schedule.matches(cursor.with_timezone(&shanghai_offset())) {
            occurrences.push(cursor);
        }
        cursor += Duration::minutes(1);
    }
    occurrences
}

fn ceil_to_minute(datetime: DateTime<Utc>) -> DateTime<Utc> {
    let base = datetime
        .with_second(0)
        .and_then(|value| value.with_nanosecond(0))
        .unwrap_or(datetime);
    if base < datetime {
        base + Duration::minutes(1)
    } else {
        base
    }
}

fn shanghai_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 60 * 60).expect("Asia/Shanghai offset should be valid")
}

fn load_calendar_events(database: &Path) -> Result<Vec<CalendarEventRecord>, String> {
    let connection = open_connection(database)?;
    let mut statement = connection
        .prepare(
            "SELECT id, title, description, event_type, start_at, end_at, all_day, timezone, status, priority, case_id, case_path_snapshot, owner_user_label, participant_labels_json, source_type, source_text_snapshot, external_provider, external_event_id, created_at, updated_at FROM calendar_events WHERE deleted = 0 ORDER BY start_at ASC, priority DESC",
        )
        .map_err(|err| format!("读取日历事项失败：{err}"))?;
    let rows = statement
        .query_map([], |row| map_calendar_event_row(&connection, row))
        .map_err(|err| format!("读取日历事项失败：{err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取日历事项失败：{err}"))
}

fn load_calendar_event_by_id(
    tx: &Transaction<'_>,
    event_id: &str,
) -> Result<Option<CalendarEventRecord>, String> {
    tx.query_row(
        "SELECT id, title, description, event_type, start_at, end_at, all_day, timezone, status, priority, case_id, case_path_snapshot, owner_user_label, participant_labels_json, source_type, source_text_snapshot, external_provider, external_event_id, created_at, updated_at FROM calendar_events WHERE id = ? AND deleted = 0",
        params![event_id],
        |row| map_calendar_event_row_transaction(tx, row),
    )
    .optional()
    .map_err(|err| format!("读取日历事项失败：{err}"))
}

fn map_calendar_event_row(
    connection: &rusqlite::Connection,
    row: &rusqlite::Row<'_>,
) -> Result<CalendarEventRecord, rusqlite::Error> {
    let participant_labels_json: String = row.get("participant_labels_json")?;
    let start_at: String = row.get("start_at")?;
    let end_at: String = row.get("end_at")?;
    let status: String = row.get("status")?;
    let reminders = load_event_reminders_connection(connection, &row.get::<_, String>("id")?)?;
    let flags = compute_due_flags(&start_at, &end_at, &status).unwrap_or((false, false, false));
    Ok(CalendarEventRecord {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        event_type: row.get("event_type")?,
        start_at,
        end_at,
        all_day: row.get::<_, i32>("all_day")? == 1,
        timezone: row.get("timezone")?,
        status,
        priority: row.get("priority")?,
        case_id: row.get("case_id")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        owner_user_label: row.get("owner_user_label")?,
        participant_labels: parse_json_vec_string(&participant_labels_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        source_type: row.get("source_type")?,
        source_text_snapshot: row.get("source_text_snapshot")?,
        external_provider: row.get("external_provider")?,
        external_event_id: row.get("external_event_id")?,
        reminders,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        is_overdue: flags.0,
        is_due_today: flags.1,
        is_upcoming: flags.2,
    })
}

fn map_calendar_event_row_transaction(
    tx: &Transaction<'_>,
    row: &rusqlite::Row<'_>,
) -> Result<CalendarEventRecord, rusqlite::Error> {
    let participant_labels_json: String = row.get("participant_labels_json")?;
    let start_at: String = row.get("start_at")?;
    let end_at: String = row.get("end_at")?;
    let status: String = row.get("status")?;
    let reminders = load_event_reminders_transaction(tx, &row.get::<_, String>("id")?)?;
    let flags = compute_due_flags(&start_at, &end_at, &status).unwrap_or((false, false, false));
    Ok(CalendarEventRecord {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        event_type: row.get("event_type")?,
        start_at,
        end_at,
        all_day: row.get::<_, i32>("all_day")? == 1,
        timezone: row.get("timezone")?,
        status,
        priority: row.get("priority")?,
        case_id: row.get("case_id")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        owner_user_label: row.get("owner_user_label")?,
        participant_labels: parse_json_vec_string(&participant_labels_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        source_type: row.get("source_type")?,
        source_text_snapshot: row.get("source_text_snapshot")?,
        external_provider: row.get("external_provider")?,
        external_event_id: row.get("external_event_id")?,
        reminders,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        is_overdue: flags.0,
        is_due_today: flags.1,
        is_upcoming: flags.2,
    })
}

fn build_new_calendar_event(
    _tx: &Transaction<'_>,
    payload: CreateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    let now = now_rfc3339();
    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err("日历事项标题不能为空".to_string());
    }
    validate_calendar_event_type(&payload.event_type)?;
    let start_at = normalize_datetime_string(&payload.start_at)?;
    let end_at = normalize_datetime_string(payload.end_at.as_deref().unwrap_or(&payload.start_at))?;
    validate_time_range(&start_at, &end_at)?;
    let case_context = resolve_case_context(
        payload.case_id.as_deref(),
        payload.case_path_snapshot.as_deref(),
    )?;
    let reminders = normalize_reminders(payload.reminders.unwrap_or_default())?;
    let participant_labels = normalize_string_vec(payload.participant_labels.unwrap_or_default());
    let status = payload.status.unwrap_or_else(|| "SCHEDULED".to_string());
    validate_calendar_status(&status)?;
    let source_type = payload.source_type.unwrap_or_else(|| "MANUAL".to_string());
    validate_calendar_source_type(&source_type)?;
    let flags = compute_due_flags(&start_at, &end_at, &status)?;
    Ok(CalendarEventRecord {
        id: Uuid::new_v4().to_string(),
        title,
        description: payload.description.unwrap_or_default().trim().to_string(),
        event_type: payload.event_type,
        start_at,
        end_at,
        all_day: payload.all_day.unwrap_or(false),
        timezone: non_blank_or_default(payload.timezone, "Asia/Shanghai"),
        status,
        priority: payload.priority.unwrap_or(0),
        case_id: case_context.0,
        case_path_snapshot: case_context.1,
        owner_user_label: payload
            .owner_user_label
            .unwrap_or_default()
            .trim()
            .to_string(),
        participant_labels,
        source_type,
        source_text_snapshot: payload
            .source_text_snapshot
            .unwrap_or_default()
            .trim()
            .to_string(),
        external_provider: payload
            .external_provider
            .unwrap_or_default()
            .trim()
            .to_string(),
        external_event_id: payload
            .external_event_id
            .unwrap_or_default()
            .trim()
            .to_string(),
        reminders,
        created_at: now.clone(),
        updated_at: now,
        is_overdue: flags.0,
        is_due_today: flags.1,
        is_upcoming: flags.2,
    })
}

fn merge_calendar_event(
    _tx: &Transaction<'_>,
    current: CalendarEventRecord,
    payload: UpdateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    let title = payload.title.unwrap_or(current.title).trim().to_string();
    if title.is_empty() {
        return Err("日历事项标题不能为空".to_string());
    }
    let event_type = payload.event_type.unwrap_or(current.event_type);
    validate_calendar_event_type(&event_type)?;
    let start_at =
        normalize_datetime_string(payload.start_at.as_deref().unwrap_or(&current.start_at))?;
    let end_at = normalize_datetime_string(payload.end_at.as_deref().unwrap_or(&current.end_at))?;
    validate_time_range(&start_at, &end_at)?;
    let status = payload.status.unwrap_or(current.status);
    validate_calendar_status(&status)?;
    let source_type = payload.source_type.unwrap_or(current.source_type);
    validate_calendar_source_type(&source_type)?;
    let case_context = resolve_case_context(
        payload.case_id.as_deref().or_else(|| {
            if current.case_id.is_empty() {
                None
            } else {
                Some(current.case_id.as_str())
            }
        }),
        payload
            .case_path_snapshot
            .as_deref()
            .or_else(|| Some(current.case_path_snapshot.as_str())),
    )?;
    let reminders = match payload.reminders {
        Some(reminders) => normalize_reminders(reminders)?,
        None => current.reminders,
    };
    let participant_labels = payload
        .participant_labels
        .map(normalize_string_vec)
        .unwrap_or(current.participant_labels);
    let flags = compute_due_flags(&start_at, &end_at, &status)?;
    Ok(CalendarEventRecord {
        id: current.id,
        title,
        description: payload
            .description
            .unwrap_or(current.description)
            .trim()
            .to_string(),
        event_type,
        start_at,
        end_at,
        all_day: payload.all_day.unwrap_or(current.all_day),
        timezone: non_blank_or_default(
            Some(payload.timezone.unwrap_or(current.timezone)),
            "Asia/Shanghai",
        ),
        status,
        priority: payload.priority.unwrap_or(current.priority),
        case_id: case_context.0,
        case_path_snapshot: case_context.1,
        owner_user_label: payload
            .owner_user_label
            .unwrap_or(current.owner_user_label)
            .trim()
            .to_string(),
        participant_labels,
        source_type,
        source_text_snapshot: payload
            .source_text_snapshot
            .unwrap_or(current.source_text_snapshot)
            .trim()
            .to_string(),
        external_provider: payload
            .external_provider
            .unwrap_or(current.external_provider)
            .trim()
            .to_string(),
        external_event_id: payload
            .external_event_id
            .unwrap_or(current.external_event_id)
            .trim()
            .to_string(),
        reminders,
        created_at: current.created_at,
        updated_at: now_rfc3339(),
        is_overdue: flags.0,
        is_due_today: flags.1,
        is_upcoming: flags.2,
    })
}

fn insert_calendar_event(tx: &Transaction<'_>, event: &CalendarEventRecord) -> Result<(), String> {
    tx.execute(
        "INSERT INTO calendar_events(id, title, description, event_type, start_at, end_at, all_day, timezone, status, priority, case_id, case_path_snapshot, owner_user_label, participant_labels_json, source_type, source_text_snapshot, external_provider, external_event_id, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        params![
            event.id,
            event.title,
            event.description,
            event.event_type,
            event.start_at,
            event.end_at,
            if event.all_day { 1 } else { 0 },
            event.timezone,
            event.status,
            event.priority,
            event.case_id,
            event.case_path_snapshot,
            event.owner_user_label,
            serde_json::to_string(&event.participant_labels)
                .map_err(|err| format!("序列化参与人失败：{err}"))?,
            event.source_type,
            event.source_text_snapshot,
            event.external_provider,
            event.external_event_id,
            event.created_at,
            event.updated_at,
        ],
    )
    .map(|_| ())
    .map_err(|err| format!("写入日历事项失败：{err}"))
}

fn persist_calendar_event(tx: &Transaction<'_>, event: &CalendarEventRecord) -> Result<(), String> {
    tx.execute(
        "UPDATE calendar_events SET title = ?, description = ?, event_type = ?, start_at = ?, end_at = ?, all_day = ?, timezone = ?, status = ?, priority = ?, case_id = ?, case_path_snapshot = ?, owner_user_label = ?, participant_labels_json = ?, source_type = ?, source_text_snapshot = ?, external_provider = ?, external_event_id = ?, updated_at = ? WHERE id = ?",
        params![
            event.title,
            event.description,
            event.event_type,
            event.start_at,
            event.end_at,
            if event.all_day { 1 } else { 0 },
            event.timezone,
            event.status,
            event.priority,
            event.case_id,
            event.case_path_snapshot,
            event.owner_user_label,
            serde_json::to_string(&event.participant_labels)
                .map_err(|err| format!("序列化参与人失败：{err}"))?,
            event.source_type,
            event.source_text_snapshot,
            event.external_provider,
            event.external_event_id,
            event.updated_at,
            event.id,
        ],
    )
    .map_err(|err| format!("更新日历事项失败：{err}"))
    .and_then(|updated| {
        if updated == 0 {
            Err(format!("日历事项不存在：{}", event.id))
        } else {
            Ok(())
        }
    })
}

fn replace_event_reminders(
    tx: &Transaction<'_>,
    event_id: &str,
    reminders: &[CalendarReminderRule],
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM calendar_reminders WHERE event_id = ?",
        params![event_id],
    )
    .map_err(|err| format!("清理日历提醒失败：{err}"))?;
    for reminder in reminders {
        tx.execute(
            "INSERT INTO calendar_reminders(id, event_id, offset_minutes, channel) VALUES (?, ?, ?, ?)",
            params![
                Uuid::new_v4().to_string(),
                event_id,
                reminder.offset_minutes,
                reminder.channel
            ],
        )
        .map_err(|err| format!("写入日历提醒失败：{err}"))?;
    }
    Ok(())
}

fn insert_calendar_audit(
    tx: &Transaction<'_>,
    event: &CalendarEventRecord,
    action: &str,
) -> Result<(), String> {
    validate_calendar_audit_action(action)?;
    tx.execute(
        "INSERT INTO calendar_event_audits(id, event_id, action, source_type, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![
            Uuid::new_v4().to_string(),
            event.id,
            action,
            event.source_type,
            serde_json::to_string(event).map_err(|err| format!("序列化日历审计快照失败：{err}"))?,
            now_rfc3339(),
        ],
    )
    .map(|_| ())
    .map_err(|err| format!("写入日历审计失败：{err}"))
}

fn resolve_case_context(
    case_id: Option<&str>,
    case_path_snapshot: Option<&str>,
) -> Result<(String, String), String> {
    let mut case_id = case_id.unwrap_or_default().trim().to_string();
    let provided_path = case_path_snapshot.unwrap_or_default().trim().to_string();
    if case_id.is_empty() && !provided_path.is_empty() {
        case_id = Path::new(&provided_path)
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_default();
    }
    if case_id.is_empty() {
        return Ok((String::new(), provided_path));
    }
    if !provided_path.is_empty() {
        return Ok((case_id, provided_path));
    }
    Err(format!("关联案件不存在：{case_id}"))
}

fn filter_calendar_event(event: &CalendarEventRecord, query: &ListCalendarEventsQuery) -> bool {
    if let Some(case_id) = query
        .case_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if event.case_id != case_id {
            return false;
        }
    }
    if let Some(event_types) = query.event_types.as_ref().filter(|items| !items.is_empty()) {
        if !event_types.iter().any(|value| value == &event.event_type) {
            return false;
        }
    }
    if let Some(statuses) = query.statuses.as_ref().filter(|items| !items.is_empty()) {
        if !statuses.iter().any(|value| value == &event.status) {
            return false;
        }
    }
    if let Some(start_at_from) = query
        .start_at_from
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if parse_event_datetime(&event.start_at).ok() < parse_event_datetime(start_at_from).ok() {
            return false;
        }
    }
    if let Some(start_at_to) = query
        .start_at_to
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if parse_event_datetime(&event.start_at).ok() > parse_event_datetime(start_at_to).ok() {
            return false;
        }
    }
    if let Some(keyword) = query
        .keyword
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    {
        let haystack = [
            event.title.to_lowercase(),
            event.description.to_lowercase(),
            event.owner_user_label.to_lowercase(),
            event.case_id.to_lowercase(),
            event.participant_labels.join(" ").to_lowercase(),
        ]
        .join(" ");
        if !haystack.contains(&keyword) {
            return false;
        }
    }
    true
}

fn validate_calendar_event_type(value: &str) -> Result<(), String> {
    if CALENDAR_EVENT_TYPES
        .iter()
        .any(|candidate| *candidate == value)
    {
        Ok(())
    } else {
        Err(format!("不支持的日历事件类型：{value}"))
    }
}

fn validate_calendar_status(value: &str) -> Result<(), String> {
    if CALENDAR_EVENT_STATUSES
        .iter()
        .any(|candidate| *candidate == value)
    {
        Ok(())
    } else {
        Err(format!("不支持的日历事件状态：{value}"))
    }
}

fn validate_calendar_source_type(value: &str) -> Result<(), String> {
    if CALENDAR_SOURCE_TYPES
        .iter()
        .any(|candidate| *candidate == value)
    {
        Ok(())
    } else {
        Err(format!("不支持的日历来源类型：{value}"))
    }
}

fn validate_calendar_audit_action(value: &str) -> Result<(), String> {
    if CALENDAR_AUDIT_ACTIONS
        .iter()
        .any(|candidate| *candidate == value)
    {
        Ok(())
    } else {
        Err(format!("不支持的日历审计动作：{value}"))
    }
}

fn normalize_reminder_channel(value: &str) -> Result<String, String> {
    let channel = value.trim();
    if CALENDAR_REMINDER_CHANNELS
        .iter()
        .any(|candidate| *candidate == channel)
    {
        Ok(channel.to_string())
    } else {
        Err(format!("不支持的日历提醒渠道：{value}"))
    }
}

fn validate_time_range(start_at: &str, end_at: &str) -> Result<(), String> {
    let start = parse_event_datetime(start_at)?;
    let end = parse_event_datetime(end_at)?;
    if end < start {
        Err("日历事项结束时间不能早于开始时间".to_string())
    } else {
        Ok(())
    }
}

fn normalize_datetime_string(value: &str) -> Result<String, String> {
    parse_event_datetime(value).map(|datetime| datetime.to_rfc3339())
}

fn parse_event_datetime(value: &str) -> Result<DateTime<Utc>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("时间不能为空".to_string());
    }
    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(parsed.with_timezone(&Utc));
    }
    let naive = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M"))
        .map_err(|err| format!("时间格式不正确：{trimmed}，{err}"))?;
    let local = Local
        .from_local_datetime(&naive)
        .single()
        .ok_or_else(|| format!("时间格式不正确：{trimmed}，无法确定本地时区时间"))?;
    Ok(local.with_timezone(&Utc))
}

fn load_event_reminders_connection(
    connection: &rusqlite::Connection,
    event_id: &str,
) -> Result<Vec<CalendarReminderRule>, rusqlite::Error> {
    let mut statement = connection.prepare(
        "SELECT offset_minutes, channel FROM calendar_reminders WHERE event_id = ? ORDER BY offset_minutes DESC, channel ASC",
    )?;
    let rows = statement.query_map(params![event_id], |row| {
        Ok(CalendarReminderRule {
            offset_minutes: row.get("offset_minutes")?,
            channel: row.get("channel")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
}

fn load_event_reminders_transaction(
    tx: &Transaction<'_>,
    event_id: &str,
) -> Result<Vec<CalendarReminderRule>, rusqlite::Error> {
    let mut statement = tx.prepare(
        "SELECT offset_minutes, channel FROM calendar_reminders WHERE event_id = ? ORDER BY offset_minutes DESC, channel ASC",
    )?;
    let rows = statement.query_map(params![event_id], |row| {
        Ok(CalendarReminderRule {
            offset_minutes: row.get("offset_minutes")?,
            channel: row.get("channel")?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
}

fn normalize_reminders(
    reminders: Vec<CalendarReminderRule>,
) -> Result<Vec<CalendarReminderRule>, String> {
    let mut normalized = reminders
        .into_iter()
        .filter(|reminder| reminder.offset_minutes >= 0)
        .map(|reminder| {
            Ok(CalendarReminderRule {
                offset_minutes: reminder.offset_minutes,
                channel: normalize_reminder_channel(&reminder.channel)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    normalized.sort_by(|left, right| {
        left.offset_minutes
            .cmp(&right.offset_minutes)
            .then_with(|| left.channel.cmp(&right.channel))
    });
    normalized.dedup_by(|left, right| {
        left.offset_minutes == right.offset_minutes && left.channel == right.channel
    });
    Ok(normalized)
}

fn normalize_string_vec(values: Vec<String>) -> Vec<String> {
    let mut normalized = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn parse_json_vec_string(raw: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(raw)
        .map(normalize_string_vec)
        .map_err(|err| format!("解析参与人失败：{err}"))
}

fn parse_json_vec_i64(raw: &str) -> Result<Vec<i64>, rusqlite::Error> {
    serde_json::from_str::<Vec<i64>>(raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn compute_due_flags(
    start_at: &str,
    end_at: &str,
    status: &str,
) -> Result<(bool, bool, bool), String> {
    if status != "SCHEDULED" {
        return Ok((false, false, false));
    }
    let start = parse_event_datetime(start_at)?.with_timezone(&Local);
    let end = parse_event_datetime(end_at)?.with_timezone(&Local);
    let now = Local::now();
    let today = now.date_naive();
    let end_day = end.date_naive();
    let is_overdue = end < now;
    let is_due_today = end_day == today;
    let future_limit = today + chrono::Days::new(7);
    let is_upcoming = !is_overdue && end_day > today && end_day <= future_limit;
    let _ = start;
    Ok((is_overdue, is_due_today, is_upcoming))
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn non_blank_or_default(value: Option<String>, default: &str) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| default.to_string())
}
