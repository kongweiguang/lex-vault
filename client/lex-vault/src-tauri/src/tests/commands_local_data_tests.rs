//! commands::local_data 模块回归测试。
//!
//! @author kongweiguang

use super::*;
use crate::commands::local_data::billing::{
    create_billing_expense_entry, create_billing_time_entry, get_billing_case_setting,
    initialize_billing_store, list_billing_case_summaries, list_billing_expense_entries,
    list_billing_time_entries, update_billing_time_entry, upsert_billing_case_setting,
    BillingCaseQuery, CreateBillingExpenseEntryInput, CreateBillingTimeEntryInput,
    UpdateBillingTimeEntryInput, UpsertBillingCaseSettingInput,
};
use crate::commands::local_data::calendar::{initialize_calendar_store, CalendarReminderRule};
use crate::commands::local_data::store::open_connection;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[test]
fn config_roundtrip_keeps_user_database_and_workspace_database_separate() {
    let user_database = temp_database("user-config");
    let workspace_root = temp_path("workspace-root");
    let config = build_config(&user_database, workspace_root.to_str().unwrap().to_string())
        .expect("build config");

    write_workspace_root(&user_database, &config.workspace_root).expect("write workspace root");
    let loaded_root = read_workspace_root(&user_database).expect("read workspace root");

    assert_eq!(loaded_root.as_deref(), Some(config.workspace_root.as_str()));
    assert_eq!(
        config.user_config_database,
        user_database.display().to_string()
    );
    assert_eq!(
        config.workspace_database,
        workspace_root
            .join(WORKSPACE_DATA_DIRECTORY)
            .join(DEFAULT_DATABASE_FILE)
            .display()
            .to_string()
    );
}

#[test]
fn workspace_initializer_creates_business_layout_and_workspace_database() {
    let user_database = temp_database("user");
    let workspace_root = temp_path("workspace");
    let config = build_config(&user_database, workspace_root.to_str().unwrap().to_string())
        .expect("build config");

    ensure_workspace_layout(&config).expect("initialize workspace layout");

    assert!(workspace_root.join(DOC_TEMPLATE_DIRECTORY).is_dir());
    assert!(workspace_root.join(LAW_DIRECTORY).is_dir());
    assert!(workspace_root.join(CASE_REF_DIRECTORY).is_dir());
    assert!(workspace_root.join(CASE_MASTER_DIRECTORY).is_dir());
    assert!(Path::new(&config.workspace_database).is_file());
}

#[test]
fn workspace_directory_config_is_saved_in_workspace_database() {
    let user_database = temp_database("user");
    let workspace_root = temp_path("workspace-with-config");
    let mut config = build_config(&user_database, workspace_root.to_str().unwrap().to_string())
        .expect("build config");

    apply_workspace_config_patch(
        &mut config,
        AppConfigPatch {
            workspace_root: None,
            doc_template: Some(workspace_root.join("my-doc").display().to_string()),
            law_directory: Some(workspace_root.join("my-law").display().to_string()),
            case_ref: Some(workspace_root.join("my-case").display().to_string()),
            case_master: Some(workspace_root.join("my-master").display().to_string()),
        },
    )
    .expect("apply patch");
    write_workspace_directory_config(&config).expect("write workspace config");

    let loaded = load_workspace_config(&user_database, config.workspace_root.clone())
        .expect("load workspace config");
    assert_eq!(
        loaded.doc_template,
        workspace_root.join("my-doc").display().to_string()
    );
    assert_eq!(
        loaded.case_ref,
        workspace_root.join("my-case").display().to_string()
    );
    assert_eq!(
        loaded.workspace_database,
        workspace_root
            .join(WORKSPACE_DATA_DIRECTORY)
            .join(DEFAULT_DATABASE_FILE)
            .display()
            .to_string()
    );
}

#[test]
fn legacy_runtime_keys_in_user_database_are_ignored_by_current_config_loader() {
    let user_database = temp_database("legacy-runtime-keys");
    let workspace_root = temp_path("workspace-legacy-runtime");
    let python_executable = temp_file("python-legacy.exe");
    let node_executable = temp_file("node-legacy.exe");
    initialize_user_config_store(&user_database).expect("initialize user config store");
    write_config_value(
        &user_database,
        "pythonExecutable",
        &python_executable.display().to_string(),
    )
    .expect("write legacy python runtime");
    write_config_value(
        &user_database,
        "nodeExecutable",
        &node_executable.display().to_string(),
    )
    .expect("write legacy node runtime");

    let loaded = load_workspace_config(&user_database, workspace_root.display().to_string())
        .expect("load workspace config");
    assert_eq!(loaded.workspace_root, workspace_root.display().to_string());
    assert_eq!(
        read_config_value(&user_database, "pythonExecutable").expect("read legacy python key"),
        Some(python_executable.display().to_string())
    );
    assert_eq!(
        read_config_value(&user_database, "nodeExecutable").expect("read legacy node key"),
        Some(node_executable.display().to_string())
    );
}

#[test]
fn empty_workspace_config_is_allowed_for_first_launch() {
    let user_database = temp_database("first-launch");
    let config = build_config(&user_database, String::new()).expect("build config");

    assert!(config.workspace_root.is_empty());
    assert!(config.workspace_database.is_empty());
    assert!(config.doc_template.is_empty());
    assert!(config.case_master.is_empty());
}

#[test]
fn auth_info_persists_access_token_in_sqlite() {
    let user_database = temp_database("auth-sqlite");
    initialize_auth_store(&user_database).expect("create auth store");

    write_auth_info(
        &user_database,
        &AuthInfo {
            username: "kong".to_string(),
            access_token: "law-token".to_string(),
        },
    )
    .expect("write auth");

    let loaded = read_auth_info(&user_database).expect("read auth");
    assert_eq!(loaded.username, "kong");
    assert_eq!(loaded.access_token, "law-token");
    assert_eq!(
        read_auth_access_token(&user_database).expect("read token"),
        "law-token"
    );
}

#[test]
fn initialize_auth_store_migrates_legacy_columns_and_keeps_auth_payload() {
    let user_database = temp_database("auth-migration");
    execute_sql(
        &user_database,
        "CREATE TABLE auth_info (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT, access_token TEXT, refresh_token TEXT, expires_at TEXT)",
    )
    .expect("create legacy auth store");
    execute_sql(
        &user_database,
        "INSERT INTO auth_info(id, username, access_token, refresh_token, expires_at) VALUES (1, 'kong', 'legacy-token', 'refresh-token', '2099-01-01T00:00:00Z')",
    )
    .expect("insert legacy auth row");

    initialize_auth_store(&user_database).expect("migrate auth store");

    let loaded = read_auth_info(&user_database).expect("read migrated auth");
    assert_eq!(loaded.username, "kong");
    assert_eq!(loaded.access_token, "legacy-token");

    let connection = open_connection(&user_database).expect("open migrated auth db");
    let mut statement = connection
        .prepare("PRAGMA table_info(auth_info)")
        .expect("query auth columns");
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("map auth columns")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect auth columns");
    assert_eq!(columns, vec!["id", "username", "access_token"]);
}

#[test]
fn normalize_access_token_removes_bearer_prefix_and_spaces() {
    assert_eq!(normalize_access_token("  Bearer abc123  "), "abc123");
    assert_eq!(normalize_access_token("bearer xyz"), "xyz");
    assert_eq!(normalize_access_token("plain-token"), "plain-token");
}

#[test]
fn calendar_initializer_creates_tables_and_default_templates() {
    let database = temp_database("calendar-init");

    initialize_calendar_store(&database).expect("initialize calendar store");

    let connection = open_connection(&database).expect("open calendar db");
    let template_count: i64 = connection
        .query_row("SELECT COUNT(1) FROM calendar_templates", [], |row| {
            row.get(0)
        })
        .expect("count templates");
    assert!(template_count >= 3);
}

#[test]
fn calendar_event_crud_and_conflict_search_work_in_workspace_database() {
    let database = temp_database("calendar-crud");
    let case_path = temp_path("calendar-case-master")
        .join("日历案件")
        .display()
        .to_string();
    let created_event = create_calendar_event(
        &database,
        CreateCalendarEventInput {
            title: "开庭".to_string(),
            description: Some("一审开庭".to_string()),
            event_type: "COURT_HEARING".to_string(),
            start_at: "2026-05-20T02:00:00Z".to_string(),
            end_at: Some("2026-05-20T04:00:00Z".to_string()),
            all_day: Some(false),
            timezone: Some("Asia/Shanghai".to_string()),
            status: Some("SCHEDULED".to_string()),
            priority: Some(2),
            case_id: Some("日历案件".to_string()),
            case_path_snapshot: Some(case_path.clone()),
            owner_user_label: Some("张律师".to_string()),
            participant_labels: Some(vec!["助理".to_string()]),
            source_type: Some("MANUAL".to_string()),
            source_text_snapshot: None,
            external_provider: None,
            external_event_id: None,
            reminders: Some(vec![CalendarReminderRule {
                offset_minutes: 30,
                channel: "DESKTOP".to_string(),
            }]),
        },
    )
    .expect("create event");

    assert_eq!(created_event.case_id, "日历案件");
    assert_eq!(created_event.case_path_snapshot, case_path);
    assert_eq!(
        created_event.reminders,
        vec![CalendarReminderRule {
            offset_minutes: 30,
            channel: "DESKTOP".to_string(),
        }]
    );

    let conflicts = search_calendar_conflicts(
        &database,
        SearchCalendarConflictsQuery {
            start_at: "2026-05-20T03:00:00Z".to_string(),
            end_at: Some("2026-05-20T03:30:00Z".to_string()),
            case_id: Some("日历案件".to_string()),
            exclude_event_id: None,
        },
    )
    .expect("search conflicts");
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].id, created_event.id);

    let updated_event = update_calendar_event(
        &database,
        &created_event.id,
        UpdateCalendarEventInput {
            title: Some("改期开庭".to_string()),
            description: None,
            event_type: None,
            start_at: None,
            end_at: None,
            all_day: None,
            timezone: None,
            status: Some("DONE".to_string()),
            priority: None,
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: None,
            participant_labels: Some(vec!["主办律师".to_string(), "书记员".to_string()]),
            source_type: Some("AI_UPDATED".to_string()),
            source_text_snapshot: Some("AI 改期确认".to_string()),
            external_provider: None,
            external_event_id: None,
            reminders: Some(vec![]),
        },
    )
    .expect("update event");

    assert_eq!(updated_event.title, "改期开庭");
    assert_eq!(updated_event.status, "DONE");
    assert!(updated_event.reminders.is_empty());
    assert_eq!(
        updated_event.participant_labels,
        vec!["主办律师".to_string(), "书记员".to_string()]
    );
}

#[test]
fn calendar_event_accepts_case_snapshot_when_case_table_is_not_synced() {
    let database = temp_database("calendar-case-snapshot");
    let case_path = temp_path("calendar-case-snapshot-path")
        .join("张三离婚案件")
        .display()
        .to_string();

    let created_event = create_calendar_event(
        &database,
        CreateCalendarEventInput {
            title: "沟通离婚进度".to_string(),
            description: None,
            event_type: "FOLLOW_UP".to_string(),
            start_at: "2026-05-21T02:00:00Z".to_string(),
            end_at: Some("2026-05-21T03:00:00Z".to_string()),
            all_day: Some(false),
            timezone: Some("Asia/Shanghai".to_string()),
            status: Some("SCHEDULED".to_string()),
            priority: Some(1),
            case_id: Some("张三离婚案件".to_string()),
            case_path_snapshot: Some(case_path.clone()),
            owner_user_label: Some("张律师".to_string()),
            participant_labels: None,
            source_type: Some("MANUAL".to_string()),
            source_text_snapshot: None,
            external_provider: None,
            external_event_id: None,
            reminders: Some(vec![]),
        },
    )
    .expect("create event with case snapshot");

    assert_eq!(created_event.case_id, "张三离婚案件");
    assert_eq!(created_event.case_path_snapshot, case_path);
}

#[test]
fn calendar_event_infers_case_id_from_snapshot_when_case_id_is_missing() {
    let database = temp_database("calendar-case-snapshot-infer-id");
    let case_path = temp_path("calendar-case-snapshot-infer-id-path")
        .join("王五借贷")
        .display()
        .to_string();

    let created_event = create_calendar_event(
        &database,
        CreateCalendarEventInput {
            title: "去武汉洪山法院".to_string(),
            description: None,
            event_type: "COURT_HEARING".to_string(),
            start_at: "2026-05-22T01:00:00Z".to_string(),
            end_at: Some("2026-05-22T02:00:00Z".to_string()),
            all_day: Some(false),
            timezone: Some("Asia/Shanghai".to_string()),
            status: Some("SCHEDULED".to_string()),
            priority: Some(1),
            case_id: None,
            case_path_snapshot: Some(case_path.clone()),
            owner_user_label: Some("王律师".to_string()),
            participant_labels: None,
            source_type: Some("AI_CREATED".to_string()),
            source_text_snapshot: None,
            external_provider: None,
            external_event_id: None,
            reminders: Some(vec![]),
        },
    )
    .expect("create event infers case id from snapshot");

    assert_eq!(created_event.case_id, "王五借贷");
    assert_eq!(created_event.case_path_snapshot, case_path);
}

#[test]
fn calendar_agenda_template_and_complete_flow_are_available() {
    let database = temp_database("calendar-agenda");
    let anchor = "2026-05-25T00:00:00Z".to_string();

    let template_event = apply_calendar_template(
        &database,
        ApplyCalendarTemplateInput {
            template_id: "deadline-defense".to_string(),
            anchor_at: anchor,
            title_override: None,
            description_override: None,
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: Some("李律师".to_string()),
            participant_labels: None,
        },
    )
    .expect("apply template");
    assert_eq!(template_event.source_type, "TEMPLATE");
    assert_eq!(template_event.title, "答辩期限");

    let completed = complete_calendar_event(
        &database,
        &template_event.id,
        CompleteCalendarEventInput {
            source_type: Some("AI_UPDATED".to_string()),
        },
    )
    .expect("complete event");
    assert_eq!(completed.status, "DONE");
    assert_eq!(completed.source_type, "AI_UPDATED");

    let agenda = list_calendar_agenda(&database).expect("list agenda");
    assert!(!agenda.is_empty());
}

#[test]
fn recurring_calendar_rules_expand_pause_and_dedupe_deliveries() {
    let database = temp_database("calendar-recurring");

    let rule = create_recurring_calendar_rule(
        &database,
        CreateRecurringCalendarRuleInput {
            title: "看日程".to_string(),
            original_text: Some("每天 9 点提醒我看日程".to_string()),
            cron: "0 9 * * *".to_string(),
            timezone: Some("Asia/Shanghai".to_string()),
            event_type: "FOLLOW_UP".to_string(),
            message: Some("看日程".to_string()),
            channels: Some(vec!["DESKTOP".to_string(), "WECHAT_SELF".to_string()]),
            status: None,
            start_at: Some("2026-05-20T00:00:00Z".to_string()),
            end_at: Some("2026-05-23T00:00:00Z".to_string()),
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: Some("张律师".to_string()),
            source_type: Some("AI_CREATED".to_string()),
        },
    )
    .expect("create recurring rule");

    assert_eq!(rule.status, "ACTIVE");
    assert_eq!(
        rule.channels,
        vec!["DESKTOP".to_string(), "WECHAT_SELF".to_string()]
    );

    let preview = preview_recurring_calendar_rule(PreviewRecurringCalendarRuleInput {
        cron: "0 9 * * *".to_string(),
        timezone: Some("Asia/Shanghai".to_string()),
        from_at: Some("2026-05-20T00:00:00Z".to_string()),
        limit: Some(5),
    })
    .expect("preview recurring rule");
    assert_eq!(preview.len(), 5);
    assert!(preview[0].starts_with("2026-05-20T01:00:00"));

    let schedule_items = list_calendar_schedule_items(
        &database,
        ListCalendarEventsQuery {
            start_at_from: Some("2026-05-20T00:00:00Z".to_string()),
            start_at_to: Some("2026-05-22T23:59:59Z".to_string()),
            statuses: Some(vec!["SCHEDULED".to_string()]),
            ..ListCalendarEventsQuery::default()
        },
    )
    .expect("list schedule items");
    let occurrences = schedule_items
        .iter()
        .filter_map(|item| item.occurrence.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(occurrences.len(), 3);
    assert_eq!(occurrences[0].rule_id, rule.id);

    let first_scheduled_at = occurrences[0].scheduled_at.clone();
    assert!(mark_recurring_calendar_delivery(
        &database,
        MarkRecurringCalendarDeliveryInput {
            rule_id: rule.id.clone(),
            scheduled_at: first_scheduled_at.clone(),
            channel: "DESKTOP".to_string(),
        },
    )
    .expect("mark first delivery"));
    assert!(!mark_recurring_calendar_delivery(
        &database,
        MarkRecurringCalendarDeliveryInput {
            rule_id: rule.id.clone(),
            scheduled_at: first_scheduled_at.clone(),
            channel: "DESKTOP".to_string(),
        },
    )
    .expect("dedupe delivery"));

    let schedule_items = list_calendar_schedule_items(
        &database,
        ListCalendarEventsQuery {
            start_at_from: Some("2026-05-20T00:00:00Z".to_string()),
            start_at_to: Some("2026-05-20T23:59:59Z".to_string()),
            statuses: Some(vec!["SCHEDULED".to_string()]),
            ..ListCalendarEventsQuery::default()
        },
    )
    .expect("list delivered schedule items");
    let delivered = schedule_items
        .iter()
        .find_map(|item| item.occurrence.as_ref())
        .expect("recurring occurrence after delivery");
    assert_eq!(delivered.delivered_channels, vec!["DESKTOP".to_string()]);

    let paused = pause_recurring_calendar_rule(&database, &rule.id).expect("pause recurring rule");
    assert_eq!(paused.status, "PAUSED");

    let schedule_items = list_calendar_schedule_items(
        &database,
        ListCalendarEventsQuery {
            start_at_from: Some("2026-05-20T00:00:00Z".to_string()),
            start_at_to: Some("2026-05-22T23:59:59Z".to_string()),
            statuses: Some(vec!["SCHEDULED".to_string()]),
            ..ListCalendarEventsQuery::default()
        },
    )
    .expect("list schedule items after pause");
    assert!(schedule_items
        .iter()
        .all(|item| item.item_type != "RECURRING_OCCURRENCE"));
}

#[test]
fn billing_initializer_creates_required_tables() {
    let database = temp_database("billing-init");

    initialize_billing_store(&database).expect("initialize billing store");

    let connection = open_connection(&database).expect("open billing db");
    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name IN ('billing_case_settings', 'billing_time_entries', 'billing_expense_entries')",
            [],
            |row| row.get(0),
        )
        .expect("count billing tables");
    assert_eq!(table_count, 3);
}

#[test]
fn billing_setting_entries_and_summary_roundtrip_in_workspace_database() {
    let database = temp_database("billing-summary");
    let case_path = temp_path("billing-case-path").join("王五合同纠纷");
    fs::create_dir_all(&case_path).expect("create case directory");

    let setting = upsert_billing_case_setting(
        &database,
        UpsertBillingCaseSettingInput {
            case_id: "王五合同纠纷".to_string(),
            case_name_snapshot: Some("王五合同纠纷".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            currency_code: Some("CNY".to_string()),
            default_hourly_rate: Some(600.0),
        },
    )
    .expect("save billing setting");
    assert_eq!(setting.default_hourly_rate, 600.0);

    let stored_setting = get_billing_case_setting(&database, "王五合同纠纷")
        .expect("load billing setting")
        .expect("billing setting should exist");
    assert_eq!(stored_setting.currency_code, "CNY");

    let billable_time = create_billing_time_entry(
        &database,
        CreateBillingTimeEntryInput {
            case_id: "王五合同纠纷".to_string(),
            case_name_snapshot: Some("王五合同纠纷".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            work_date: "2026-05-19".to_string(),
            description: Some("整理证据材料".to_string()),
            duration_minutes: 90,
            hourly_rate: None,
            owner_user_label: Some("张律师".to_string()),
            billable: Some(true),
        },
    )
    .expect("create billable time");
    assert_eq!(billable_time.hourly_rate, 600.0);
    assert_eq!(billable_time.amount, 900.0);

    let non_billable_time = create_billing_time_entry(
        &database,
        CreateBillingTimeEntryInput {
            case_id: "王五合同纠纷".to_string(),
            case_name_snapshot: Some("王五合同纠纷".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            work_date: "2026-05-20".to_string(),
            description: Some("内部复盘".to_string()),
            duration_minutes: 30,
            hourly_rate: None,
            owner_user_label: Some("张律师".to_string()),
            billable: Some(false),
        },
    )
    .expect("create non billable time");
    assert_eq!(non_billable_time.amount, 0.0);

    let updated_time = update_billing_time_entry(
        &database,
        &billable_time.id,
        UpdateBillingTimeEntryInput {
            case_id: None,
            case_name_snapshot: None,
            case_path_snapshot: None,
            work_date: None,
            description: Some("整理证据与起草说明".to_string()),
            duration_minutes: Some(120),
            hourly_rate: Some(650.0),
            owner_user_label: None,
            billable: Some(true),
        },
    )
    .expect("update time entry");
    assert_eq!(updated_time.duration_minutes, 120);
    assert_eq!(updated_time.amount, 1300.0);

    let expense = create_billing_expense_entry(
        &database,
        CreateBillingExpenseEntryInput {
            case_id: "王五合同纠纷".to_string(),
            case_name_snapshot: Some("王五合同纠纷".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            expense_date: "2026-05-20".to_string(),
            category: "差旅".to_string(),
            amount: 120.5,
            note: Some("往返法院交通".to_string()),
        },
    )
    .expect("create expense entry");
    assert_eq!(expense.amount, 120.5);

    let summaries = list_billing_case_summaries(&database).expect("list summaries");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].case_id, "王五合同纠纷");
    assert_eq!(summaries[0].default_hourly_rate, 600.0);
    assert_eq!(summaries[0].total_duration_minutes, 150);
    assert_eq!(summaries[0].time_amount, 1300.0);
    assert_eq!(summaries[0].expense_amount, 120.5);
    assert_eq!(summaries[0].total_amount, 1420.5);

    let time_entries = list_billing_time_entries(
        &database,
        BillingCaseQuery {
            case_id: Some("王五合同纠纷".to_string()),
        },
    )
    .expect("list time entries");
    assert_eq!(time_entries.len(), 2);

    let expense_entries = list_billing_expense_entries(
        &database,
        BillingCaseQuery {
            case_id: Some("王五合同纠纷".to_string()),
        },
    )
    .expect("list expense entries");
    assert_eq!(expense_entries.len(), 1);
}

#[test]
fn billing_rejects_invalid_case_snapshot_and_negative_values() {
    let database = temp_database("billing-invalid");
    let missing_case_path = temp_path("billing-missing-case")
        .join("不存在的案件")
        .display()
        .to_string();

    let invalid_case_error = create_billing_time_entry(
        &database,
        CreateBillingTimeEntryInput {
            case_id: "不存在的案件".to_string(),
            case_name_snapshot: Some("不存在的案件".to_string()),
            case_path_snapshot: missing_case_path,
            work_date: "2026-05-19".to_string(),
            description: Some("无效案件".to_string()),
            duration_minutes: 10,
            hourly_rate: Some(100.0),
            owner_user_label: Some("张律师".to_string()),
            billable: Some(true),
        },
    )
    .expect_err("should reject missing case snapshot");
    assert!(invalid_case_error.contains("案件目录不存在"));

    let case_path = temp_path("billing-invalid-case").join("赵六劳动争议");
    fs::create_dir_all(&case_path).expect("create valid case directory");

    let negative_time_error = create_billing_time_entry(
        &database,
        CreateBillingTimeEntryInput {
            case_id: "赵六劳动争议".to_string(),
            case_name_snapshot: Some("赵六劳动争议".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            work_date: "2026-05-19".to_string(),
            description: Some("无效工时".to_string()),
            duration_minutes: -1,
            hourly_rate: Some(100.0),
            owner_user_label: Some("张律师".to_string()),
            billable: Some(true),
        },
    )
    .expect_err("should reject negative duration");
    assert!(negative_time_error.contains("工时时长不能为负数"));

    let negative_expense_error = create_billing_expense_entry(
        &database,
        CreateBillingExpenseEntryInput {
            case_id: "赵六劳动争议".to_string(),
            case_name_snapshot: Some("赵六劳动争议".to_string()),
            case_path_snapshot: case_path.display().to_string(),
            expense_date: "2026-05-19".to_string(),
            category: "差旅".to_string(),
            amount: -1.0,
            note: Some("无效费用".to_string()),
        },
    )
    .expect_err("should reject negative expense");
    assert!(negative_expense_error.contains("费用金额不能为负数"));
}

fn temp_database(name: &str) -> PathBuf {
    temp_path(name).join(DEFAULT_DATABASE_FILE)
}

fn temp_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lex-vault-test-{name}-{}", Uuid::new_v4()))
}

fn temp_file(name: &str) -> PathBuf {
    let path = temp_path(name);
    std::fs::write(&path, b"runtime").expect("create temp runtime file");
    path
}
