//! 本机配置和工作空间数据索引的 SQLite 命令。
//!
//! @author kongweiguang

#[path = "local_data/auth.rs"]
mod auth;
#[path = "local_data/billing.rs"]
pub(crate) mod billing;
#[path = "local_data/calendar.rs"]
pub(crate) mod calendar;
#[path = "local_data/config.rs"]
mod config;
#[path = "local_data/path.rs"]
mod path;
#[path = "local_data/store.rs"]
mod store;

use std::path::Path;
use tauri::State;

pub use auth::{AuthInfo, AuthInfoPatch};
pub use billing::{
    BillingCaseQuery, BillingCaseSetting, BillingCaseSummary, BillingExpenseEntry,
    BillingTimeEntry, CreateBillingExpenseEntryInput, CreateBillingTimeEntryInput,
    UpdateBillingExpenseEntryInput, UpdateBillingTimeEntryInput, UpsertBillingCaseSettingInput,
};
pub use calendar::{
    ApplyCalendarTemplateInput, CalendarAgendaDay, CalendarEventRecord, CalendarScheduleItem,
    CalendarTemplateRecord, CompleteCalendarEventInput, CreateCalendarEventInput,
    CreateRecurringCalendarRuleInput, ListCalendarEventsQuery, MarkRecurringCalendarDeliveryInput,
    PreviewRecurringCalendarRuleInput, RecurringCalendarRuleRecord, SearchCalendarConflictsQuery,
    UpdateCalendarEventInput, UpdateRecurringCalendarRuleInput,
};
pub use config::{AppConfig, AppConfigPatch};

use crate::wechat_gateway_auth::sync_wechat_gateway_auth_state;
use auth::{
    clear_auth_info_in_database, initialize_auth_store, normalize_access_token,
    read_auth_access_token, read_auth_info, write_auth_info,
};
use billing::{
    create_billing_expense_entry, create_billing_time_entry, delete_billing_expense_entry,
    delete_billing_time_entry, get_billing_case_setting, list_billing_case_summaries,
    list_billing_expense_entries, list_billing_time_entries, update_billing_expense_entry,
    update_billing_time_entry, upsert_billing_case_setting,
};
use calendar::{
    apply_calendar_template, complete_calendar_event, create_calendar_event,
    create_recurring_calendar_rule, delete_calendar_event, delete_recurring_calendar_rule,
    list_calendar_agenda, list_calendar_events, list_calendar_schedule_items,
    list_calendar_templates, list_recurring_calendar_rules, mark_recurring_calendar_delivery,
    pause_recurring_calendar_rule, preview_recurring_calendar_rule, search_calendar_conflicts,
    update_calendar_event, update_recurring_calendar_rule,
};
#[cfg(test)]
use config::{
    apply_workspace_config_patch, build_config, ensure_workspace_layout, load_workspace_config,
    write_workspace_directory_config,
};
use config::{configured_workspace_config, load_config, update_config};
use path::user_config_database_path;
#[cfg(test)]
use path::{
    CASE_MASTER_DIRECTORY, CASE_REF_DIRECTORY, DEFAULT_DATABASE_FILE, DOC_TEMPLATE_DIRECTORY,
    LAW_DIRECTORY, WORKSPACE_DATA_DIRECTORY,
};
#[cfg(test)]
use store::{execute_sql, read_workspace_root, write_workspace_root};
#[cfg(test)]
use store::{initialize_user_config_store, read_config_value, write_config_value};

/// 初始化用户级配置库和认证信息；工作空间由用户首次选择后再初始化。
pub fn initialize_local_home() -> Result<AppConfig, String> {
    let config = load_config()?;
    let _ = sync_wechat_gateway_auth_state(&read_saved_access_token().unwrap_or_default());
    Ok(config)
}

/// 读取本机应用配置。
#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    load_config()
}

/// 更新本机应用配置。
#[tauri::command]
pub fn update_app_config(
    config: AppConfigPatch,
    local_mcp: State<'_, crate::local_mcp_server::LocalMcpRuntimeState>,
) -> Result<AppConfig, String> {
    let updated = update_config(config)?;
    local_mcp.update_workspace_database(
        (!updated.workspace_database.trim().is_empty())
            .then(|| std::path::PathBuf::from(updated.workspace_database.as_str())),
    )?;
    Ok(updated)
}

/// 读取本机保存的登录会话。
#[tauri::command]
pub fn get_auth_info() -> Result<AuthInfo, String> {
    let user_database = user_config_database_path()?;
    initialize_auth_store(&user_database)?;
    read_auth_info(&user_database)
}

/// 保存 law-admin 登录返回的 token；token 写入用户级 SQLite，由 runtime 启动时注入环境变量。
#[tauri::command]
pub fn update_auth_info(auth: AuthInfoPatch) -> Result<AuthInfo, String> {
    let AuthInfoPatch {
        username,
        access_token,
    } = auth;
    let user_database = user_config_database_path()?;
    initialize_auth_store(&user_database)?;
    let mut current = read_auth_info(&user_database)?;
    if let Some(value) = username {
        current.username = value;
    }
    if let Some(value) = access_token {
        current.access_token = normalize_access_token(&value);
    }
    write_auth_info(&user_database, &current)?;
    sync_wechat_gateway_auth_state(&current.access_token)?;
    Ok(current)
}

/// 清空本机保存的登录会话。
#[tauri::command]
pub fn clear_auth_info() -> Result<(), String> {
    let user_database = user_config_database_path()?;
    initialize_auth_store(&user_database)?;
    clear_auth_info_in_database(&user_database)?;
    sync_wechat_gateway_auth_state("")?;
    Ok(())
}

/// 读取当前 law-admin 访问令牌，供 app-server 启动前注入环境变量。
pub fn read_saved_access_token() -> Result<String, String> {
    let user_database = user_config_database_path()?;
    initialize_auth_store(&user_database)?;
    read_auth_access_token(&user_database).map(|token| normalize_access_token(&token))
}

/// 查询工作空间中的日历事项。
#[tauri::command]
pub fn list_calendar_events_command(
    query: Option<ListCalendarEventsQuery>,
) -> Result<Vec<CalendarEventRecord>, String> {
    let config = configured_workspace_config()?;
    list_calendar_events(
        Path::new(&config.workspace_database),
        query.unwrap_or_default(),
    )
}

/// 新建日历事项。
#[tauri::command]
pub fn create_calendar_event_command(
    payload: CreateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    let config = configured_workspace_config()?;
    create_calendar_event(Path::new(&config.workspace_database), payload)
}

/// 更新日历事项。
#[tauri::command]
pub fn update_calendar_event_command(
    event_id: String,
    payload: UpdateCalendarEventInput,
) -> Result<CalendarEventRecord, String> {
    let config = configured_workspace_config()?;
    update_calendar_event(Path::new(&config.workspace_database), &event_id, payload)
}

/// 删除日历事项。
#[tauri::command]
pub fn delete_calendar_event_command(event_id: String) -> Result<(), String> {
    let config = configured_workspace_config()?;
    delete_calendar_event(Path::new(&config.workspace_database), &event_id)
}

/// 标记日历事项完成。
#[tauri::command]
pub fn complete_calendar_event_command(
    event_id: String,
    payload: Option<CompleteCalendarEventInput>,
) -> Result<CalendarEventRecord, String> {
    let config = configured_workspace_config()?;
    complete_calendar_event(
        Path::new(&config.workspace_database),
        &event_id,
        payload.unwrap_or(CompleteCalendarEventInput { source_type: None }),
    )
}

/// 查询未来 30 天日程。
#[tauri::command]
pub fn list_calendar_agenda_command() -> Result<Vec<CalendarAgendaDay>, String> {
    let config = configured_workspace_config()?;
    list_calendar_agenda(Path::new(&config.workspace_database))
}

/// 读取内置期限模板。
#[tauri::command]
pub fn list_calendar_templates_command() -> Result<Vec<CalendarTemplateRecord>, String> {
    let config = configured_workspace_config()?;
    list_calendar_templates(Path::new(&config.workspace_database))
}

/// 套用期限模板。
#[tauri::command]
pub fn apply_calendar_template_command(
    payload: ApplyCalendarTemplateInput,
) -> Result<CalendarEventRecord, String> {
    let config = configured_workspace_config()?;
    apply_calendar_template(Path::new(&config.workspace_database), payload)
}

/// 查询当前时间段的冲突事项。
#[tauri::command]
pub fn search_calendar_conflicts_command(
    query: SearchCalendarConflictsQuery,
) -> Result<Vec<CalendarEventRecord>, String> {
    let config = configured_workspace_config()?;
    search_calendar_conflicts(Path::new(&config.workspace_database), query)
}

/// 查询周期日程规则。
#[tauri::command]
pub fn list_recurring_calendar_rules_command() -> Result<Vec<RecurringCalendarRuleRecord>, String> {
    let config = configured_workspace_config()?;
    list_recurring_calendar_rules(Path::new(&config.workspace_database))
}

/// 创建周期日程规则。
#[tauri::command]
pub fn create_recurring_calendar_rule_command(
    payload: CreateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    let config = configured_workspace_config()?;
    create_recurring_calendar_rule(Path::new(&config.workspace_database), payload)
}

/// 更新周期日程规则。
#[tauri::command]
pub fn update_recurring_calendar_rule_command(
    rule_id: String,
    payload: UpdateRecurringCalendarRuleInput,
) -> Result<RecurringCalendarRuleRecord, String> {
    let config = configured_workspace_config()?;
    update_recurring_calendar_rule(Path::new(&config.workspace_database), &rule_id, payload)
}

/// 暂停周期日程规则。
#[tauri::command]
pub fn pause_recurring_calendar_rule_command(
    rule_id: String,
) -> Result<RecurringCalendarRuleRecord, String> {
    let config = configured_workspace_config()?;
    pause_recurring_calendar_rule(Path::new(&config.workspace_database), &rule_id)
}

/// 删除周期日程规则。
#[tauri::command]
pub fn delete_recurring_calendar_rule_command(rule_id: String) -> Result<(), String> {
    let config = configured_workspace_config()?;
    delete_recurring_calendar_rule(Path::new(&config.workspace_database), &rule_id)
}

/// 预览周期日程未来执行点。
#[tauri::command]
pub fn preview_recurring_calendar_rule_command(
    payload: PreviewRecurringCalendarRuleInput,
) -> Result<Vec<String>, String> {
    preview_recurring_calendar_rule(payload)
}

/// 查询日历聚合项，包含普通事项和周期执行点。
#[tauri::command]
pub fn list_calendar_schedule_items_command(
    query: Option<ListCalendarEventsQuery>,
) -> Result<Vec<CalendarScheduleItem>, String> {
    let config = configured_workspace_config()?;
    list_calendar_schedule_items(
        Path::new(&config.workspace_database),
        query.unwrap_or_default(),
    )
}

/// 标记周期执行点指定渠道已经触发。
#[tauri::command]
pub fn mark_recurring_calendar_delivery_command(
    payload: MarkRecurringCalendarDeliveryInput,
) -> Result<bool, String> {
    let config = configured_workspace_config()?;
    mark_recurring_calendar_delivery(Path::new(&config.workspace_database), payload)
}

/// 查询案件默认计费设置。
#[tauri::command]
pub fn get_billing_case_setting_command(
    case_id: String,
) -> Result<Option<BillingCaseSetting>, String> {
    let config = configured_workspace_config()?;
    get_billing_case_setting(Path::new(&config.workspace_database), &case_id)
}

/// 保存案件默认计费设置。
#[tauri::command]
pub fn upsert_billing_case_setting_command(
    payload: UpsertBillingCaseSettingInput,
) -> Result<BillingCaseSetting, String> {
    let config = configured_workspace_config()?;
    upsert_billing_case_setting(Path::new(&config.workspace_database), payload)
}

/// 查询工时记录列表。
#[tauri::command]
pub fn list_billing_time_entries_command(
    query: Option<BillingCaseQuery>,
) -> Result<Vec<BillingTimeEntry>, String> {
    let config = configured_workspace_config()?;
    list_billing_time_entries(
        Path::new(&config.workspace_database),
        query.unwrap_or_default(),
    )
}

/// 创建工时记录。
#[tauri::command]
pub fn create_billing_time_entry_command(
    payload: CreateBillingTimeEntryInput,
) -> Result<BillingTimeEntry, String> {
    let config = configured_workspace_config()?;
    create_billing_time_entry(Path::new(&config.workspace_database), payload)
}

/// 更新工时记录。
#[tauri::command]
pub fn update_billing_time_entry_command(
    entry_id: String,
    payload: UpdateBillingTimeEntryInput,
) -> Result<BillingTimeEntry, String> {
    let config = configured_workspace_config()?;
    update_billing_time_entry(Path::new(&config.workspace_database), &entry_id, payload)
}

/// 删除工时记录。
#[tauri::command]
pub fn delete_billing_time_entry_command(entry_id: String) -> Result<(), String> {
    let config = configured_workspace_config()?;
    delete_billing_time_entry(Path::new(&config.workspace_database), &entry_id)
}

/// 查询费用记录列表。
#[tauri::command]
pub fn list_billing_expense_entries_command(
    query: Option<BillingCaseQuery>,
) -> Result<Vec<BillingExpenseEntry>, String> {
    let config = configured_workspace_config()?;
    list_billing_expense_entries(
        Path::new(&config.workspace_database),
        query.unwrap_or_default(),
    )
}

/// 创建费用记录。
#[tauri::command]
pub fn create_billing_expense_entry_command(
    payload: CreateBillingExpenseEntryInput,
) -> Result<BillingExpenseEntry, String> {
    let config = configured_workspace_config()?;
    create_billing_expense_entry(Path::new(&config.workspace_database), payload)
}

/// 更新费用记录。
#[tauri::command]
pub fn update_billing_expense_entry_command(
    entry_id: String,
    payload: UpdateBillingExpenseEntryInput,
) -> Result<BillingExpenseEntry, String> {
    let config = configured_workspace_config()?;
    update_billing_expense_entry(Path::new(&config.workspace_database), &entry_id, payload)
}

/// 删除费用记录。
#[tauri::command]
pub fn delete_billing_expense_entry_command(entry_id: String) -> Result<(), String> {
    let config = configured_workspace_config()?;
    delete_billing_expense_entry(Path::new(&config.workspace_database), &entry_id)
}

/// 查询案件计费汇总。
#[tauri::command]
pub fn list_billing_case_summaries_command() -> Result<Vec<BillingCaseSummary>, String> {
    let config = configured_workspace_config()?;
    list_billing_case_summaries(Path::new(&config.workspace_database))
}

#[cfg(test)]
#[path = "../tests/commands_local_data_tests.rs"]
mod tests;
