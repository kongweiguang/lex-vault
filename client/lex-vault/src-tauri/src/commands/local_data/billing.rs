//! local_data 工时计费存储与查询能力。
//!
//! @author kongweiguang

use chrono::{NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use uuid::Uuid;

use super::store::open_connection;

/// 首版固定使用人民币。
pub const DEFAULT_BILLING_CURRENCY_CODE: &str = "CNY";

/// 案件默认计费设置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BillingCaseSetting {
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 币种编码，首版固定为 CNY。
    pub currency_code: String,
    /// 案件默认小时费率，单位元/小时。
    pub default_hourly_rate: f64,
    /// 最后更新时间。
    pub updated_at: String,
}

/// 工时记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BillingTimeEntry {
    /// 工时记录唯一标识。
    pub id: String,
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 工作日期，格式 YYYY-MM-DD。
    pub work_date: String,
    /// 事项说明。
    pub description: String,
    /// 时长，单位分钟。
    pub duration_minutes: i64,
    /// 本条工时使用的小时费率，单位元/小时。
    pub hourly_rate: f64,
    /// 本条工时应收金额，单位元。
    pub amount: f64,
    /// 经办人标签。
    pub owner_user_label: String,
    /// 是否可计费。
    pub billable: bool,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 费用记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BillingExpenseEntry {
    /// 费用记录唯一标识。
    pub id: String,
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 费用日期，格式 YYYY-MM-DD。
    pub expense_date: String,
    /// 费用分类。
    pub category: String,
    /// 金额，单位元。
    pub amount: f64,
    /// 备注说明。
    pub note: String,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 案件维度工时计费汇总。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BillingCaseSummary {
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: String,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 币种编码。
    pub currency_code: String,
    /// 默认小时费率。
    pub default_hourly_rate: f64,
    /// 累计工时，单位分钟。
    pub total_duration_minutes: i64,
    /// 工时应收合计。
    pub time_amount: f64,
    /// 费用合计。
    pub expense_amount: f64,
    /// 总额。
    pub total_amount: f64,
    /// 工时记录条数。
    pub time_entry_count: i64,
    /// 费用记录条数。
    pub expense_entry_count: i64,
}

/// 按案件查询工时或费用列表。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingCaseQuery {
    /// 关联案件 ID；为空时返回全部案件记录。
    pub case_id: Option<String>,
}

/// 新增或更新案件默认费率。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBillingCaseSettingInput {
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 币种编码，首版仅支持 CNY。
    pub currency_code: Option<String>,
    /// 默认小时费率，单位元/小时。
    pub default_hourly_rate: Option<f64>,
}

/// 新增工时记录。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBillingTimeEntryInput {
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 工作日期，格式 YYYY-MM-DD。
    pub work_date: String,
    /// 事项说明。
    pub description: Option<String>,
    /// 时长，单位分钟。
    pub duration_minutes: i64,
    /// 本条工时覆盖后的小时费率；为空时使用案件默认值。
    pub hourly_rate: Option<f64>,
    /// 经办人标签。
    pub owner_user_label: Option<String>,
    /// 是否可计费；为空时默认 true。
    pub billable: Option<bool>,
}

/// 更新工时记录。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBillingTimeEntryInput {
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件名称快照。
    pub case_name_snapshot: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 工作日期，格式 YYYY-MM-DD。
    pub work_date: Option<String>,
    /// 事项说明。
    pub description: Option<String>,
    /// 时长，单位分钟。
    pub duration_minutes: Option<i64>,
    /// 本条工时覆盖后的小时费率。
    pub hourly_rate: Option<f64>,
    /// 经办人标签。
    pub owner_user_label: Option<String>,
    /// 是否可计费。
    pub billable: Option<bool>,
}

/// 新增费用记录。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBillingExpenseEntryInput {
    /// 关联案件 ID。
    pub case_id: String,
    /// 案件名称快照。
    pub case_name_snapshot: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: String,
    /// 费用日期，格式 YYYY-MM-DD。
    pub expense_date: String,
    /// 费用分类。
    pub category: String,
    /// 金额，单位元。
    pub amount: f64,
    /// 备注说明。
    pub note: Option<String>,
}

/// 更新费用记录。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBillingExpenseEntryInput {
    /// 关联案件 ID。
    pub case_id: Option<String>,
    /// 案件名称快照。
    pub case_name_snapshot: Option<String>,
    /// 案件目录快照。
    pub case_path_snapshot: Option<String>,
    /// 费用日期，格式 YYYY-MM-DD。
    pub expense_date: Option<String>,
    /// 费用分类。
    pub category: Option<String>,
    /// 金额，单位元。
    pub amount: Option<f64>,
    /// 备注说明。
    pub note: Option<String>,
}

/// 初始化计费存储结构。
pub(crate) fn initialize_billing_store(database: &Path) -> Result<(), String> {
    let connection = open_connection(database)?;
    connection
        .execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS billing_case_settings (
  case_id TEXT PRIMARY KEY,
  case_name_snapshot TEXT NOT NULL,
  case_path_snapshot TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  default_hourly_rate REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_time_entries (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  case_name_snapshot TEXT NOT NULL,
  case_path_snapshot TEXT NOT NULL,
  work_date TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  hourly_rate REAL NOT NULL,
  amount REAL NOT NULL,
  owner_user_label TEXT NOT NULL,
  billable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_expense_entries (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  case_name_snapshot TEXT NOT NULL,
  case_path_snapshot TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_time_entries_case_id ON billing_time_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_billing_time_entries_work_date ON billing_time_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_billing_expense_entries_case_id ON billing_expense_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_billing_expense_entries_expense_date ON billing_expense_entries(expense_date);
"#,
        )
        .map_err(|err| format!("初始化工时计费存储失败：{err}"))
}

/// 查询单个案件默认计费设置。
pub(crate) fn get_billing_case_setting(
    database: &Path,
    case_id: &str,
) -> Result<Option<BillingCaseSetting>, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    load_billing_case_setting_by_id(&connection, case_id)
}

/// 新增或更新案件默认计费设置。
pub(crate) fn upsert_billing_case_setting(
    database: &Path,
    payload: UpsertBillingCaseSettingInput,
) -> Result<BillingCaseSetting, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let case_id = normalize_case_id(&payload.case_id)?;
    let case_name_snapshot = normalize_case_snapshot(
        &case_id,
        &payload.case_path_snapshot,
        payload.case_name_snapshot.as_deref(),
    )?;
    let currency_code = normalize_currency_code(payload.currency_code.as_deref())?;
    let default_hourly_rate = normalize_non_negative_money(
        payload.default_hourly_rate.unwrap_or_default(),
        "案件默认小时费率",
    )?;
    let updated_at = now_utc_string();

    connection
        .execute(
            "INSERT INTO billing_case_settings(case_id, case_name_snapshot, case_path_snapshot, currency_code, default_hourly_rate, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(case_id) DO UPDATE SET
               case_name_snapshot = excluded.case_name_snapshot,
               case_path_snapshot = excluded.case_path_snapshot,
               currency_code = excluded.currency_code,
               default_hourly_rate = excluded.default_hourly_rate,
               updated_at = excluded.updated_at",
            params![
                case_id,
                case_name_snapshot,
                payload.case_path_snapshot.trim(),
                currency_code,
                default_hourly_rate,
                updated_at
            ],
        )
        .map_err(|err| format!("保存案件默认费率失败：{err}"))?;

    load_billing_case_setting_by_id(&connection, &payload.case_id)?
        .ok_or_else(|| "保存案件默认费率后读取结果失败".to_string())
}

/// 查询工时记录列表。
pub(crate) fn list_billing_time_entries(
    database: &Path,
    query: BillingCaseQuery,
) -> Result<Vec<BillingTimeEntry>, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    load_billing_time_entries(&connection, query.case_id.as_deref())
}

/// 创建工时记录。
pub(crate) fn create_billing_time_entry(
    database: &Path,
    payload: CreateBillingTimeEntryInput,
) -> Result<BillingTimeEntry, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let case_id = normalize_case_id(&payload.case_id)?;
    let case_name_snapshot = normalize_case_snapshot(
        &case_id,
        &payload.case_path_snapshot,
        payload.case_name_snapshot.as_deref(),
    )?;
    let work_date = normalize_work_date(&payload.work_date)?;
    let description = payload.description.unwrap_or_default().trim().to_string();
    let duration_minutes = normalize_non_negative_integer(payload.duration_minutes, "工时时长")?;
    let owner_user_label = payload
        .owner_user_label
        .unwrap_or_default()
        .trim()
        .to_string();
    let billable = payload.billable.unwrap_or(true);
    let hourly_rate =
        resolve_time_entry_hourly_rate(&connection, &case_id, payload.hourly_rate, None, false)?;
    let amount = resolve_time_entry_amount(duration_minutes, hourly_rate, billable);
    let now = now_utc_string();
    let entry_id = Uuid::new_v4().to_string();

    connection
        .execute(
            "INSERT INTO billing_time_entries(id, case_id, case_name_snapshot, case_path_snapshot, work_date, description, duration_minutes, hourly_rate, amount, owner_user_label, billable, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                entry_id,
                case_id,
                case_name_snapshot,
                payload.case_path_snapshot.trim(),
                work_date,
                description,
                duration_minutes,
                hourly_rate,
                amount,
                owner_user_label,
                if billable { 1 } else { 0 },
                now,
                now
            ],
        )
        .map_err(|err| format!("创建工时记录失败：{err}"))?;

    load_billing_time_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| format!("工时记录不存在：{entry_id}"))
}

/// 更新工时记录。
pub(crate) fn update_billing_time_entry(
    database: &Path,
    entry_id: &str,
    payload: UpdateBillingTimeEntryInput,
) -> Result<BillingTimeEntry, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let current = load_billing_time_entry_by_id(&connection, entry_id)?
        .ok_or_else(|| format!("工时记录不存在：{entry_id}"))?;
    let next_case_id = payload.case_id.as_deref().unwrap_or(&current.case_id);
    let next_case_path_snapshot = payload
        .case_path_snapshot
        .as_deref()
        .unwrap_or(&current.case_path_snapshot);
    let case_id = normalize_case_id(next_case_id)?;
    let case_name_snapshot = normalize_case_snapshot(
        &case_id,
        next_case_path_snapshot,
        payload
            .case_name_snapshot
            .as_deref()
            .or(Some(&current.case_name_snapshot)),
    )?;
    let work_date =
        normalize_work_date(payload.work_date.as_deref().unwrap_or(&current.work_date))?;
    let description = payload
        .description
        .as_deref()
        .unwrap_or(&current.description)
        .trim()
        .to_string();
    let duration_minutes = normalize_non_negative_integer(
        payload.duration_minutes.unwrap_or(current.duration_minutes),
        "工时时长",
    )?;
    let owner_user_label = payload
        .owner_user_label
        .as_deref()
        .unwrap_or(&current.owner_user_label)
        .trim()
        .to_string();
    let billable = payload.billable.unwrap_or(current.billable);
    let case_changed = case_id != current.case_id;
    let hourly_rate = resolve_time_entry_hourly_rate(
        &connection,
        &case_id,
        payload.hourly_rate,
        Some(current.hourly_rate),
        case_changed,
    )?;
    let amount = resolve_time_entry_amount(duration_minutes, hourly_rate, billable);
    let updated_at = now_utc_string();

    connection
        .execute(
            "UPDATE billing_time_entries
             SET case_id = ?, case_name_snapshot = ?, case_path_snapshot = ?, work_date = ?, description = ?, duration_minutes = ?, hourly_rate = ?, amount = ?, owner_user_label = ?, billable = ?, updated_at = ?
             WHERE id = ?",
            params![
                case_id,
                case_name_snapshot,
                next_case_path_snapshot.trim(),
                work_date,
                description,
                duration_minutes,
                hourly_rate,
                amount,
                owner_user_label,
                if billable { 1 } else { 0 },
                updated_at,
                entry_id
            ],
        )
        .map_err(|err| format!("更新工时记录失败：{err}"))?;

    load_billing_time_entry_by_id(&connection, entry_id)?
        .ok_or_else(|| format!("工时记录不存在：{entry_id}"))
}

/// 删除工时记录。
pub(crate) fn delete_billing_time_entry(database: &Path, entry_id: &str) -> Result<(), String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let affected = connection
        .execute(
            "DELETE FROM billing_time_entries WHERE id = ?",
            params![entry_id],
        )
        .map_err(|err| format!("删除工时记录失败：{err}"))?;
    if affected == 0 {
        return Err(format!("工时记录不存在：{entry_id}"));
    }
    Ok(())
}

/// 查询费用记录列表。
pub(crate) fn list_billing_expense_entries(
    database: &Path,
    query: BillingCaseQuery,
) -> Result<Vec<BillingExpenseEntry>, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    load_billing_expense_entries(&connection, query.case_id.as_deref())
}

/// 创建费用记录。
pub(crate) fn create_billing_expense_entry(
    database: &Path,
    payload: CreateBillingExpenseEntryInput,
) -> Result<BillingExpenseEntry, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let case_id = normalize_case_id(&payload.case_id)?;
    let case_name_snapshot = normalize_case_snapshot(
        &case_id,
        &payload.case_path_snapshot,
        payload.case_name_snapshot.as_deref(),
    )?;
    let expense_date = normalize_work_date(&payload.expense_date)?;
    let category = normalize_required_text(&payload.category, "费用分类")?;
    let amount = normalize_non_negative_money(payload.amount, "费用金额")?;
    let note = payload.note.unwrap_or_default().trim().to_string();
    let now = now_utc_string();
    let entry_id = Uuid::new_v4().to_string();

    connection
        .execute(
            "INSERT INTO billing_expense_entries(id, case_id, case_name_snapshot, case_path_snapshot, expense_date, category, amount, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                entry_id,
                case_id,
                case_name_snapshot,
                payload.case_path_snapshot.trim(),
                expense_date,
                category,
                amount,
                note,
                now,
                now
            ],
        )
        .map_err(|err| format!("创建费用记录失败：{err}"))?;

    load_billing_expense_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| format!("费用记录不存在：{entry_id}"))
}

/// 更新费用记录。
pub(crate) fn update_billing_expense_entry(
    database: &Path,
    entry_id: &str,
    payload: UpdateBillingExpenseEntryInput,
) -> Result<BillingExpenseEntry, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let current = load_billing_expense_entry_by_id(&connection, entry_id)?
        .ok_or_else(|| format!("费用记录不存在：{entry_id}"))?;
    let next_case_id = payload.case_id.as_deref().unwrap_or(&current.case_id);
    let next_case_path_snapshot = payload
        .case_path_snapshot
        .as_deref()
        .unwrap_or(&current.case_path_snapshot);
    let case_id = normalize_case_id(next_case_id)?;
    let case_name_snapshot = normalize_case_snapshot(
        &case_id,
        next_case_path_snapshot,
        payload
            .case_name_snapshot
            .as_deref()
            .or(Some(&current.case_name_snapshot)),
    )?;
    let expense_date = normalize_work_date(
        payload
            .expense_date
            .as_deref()
            .unwrap_or(&current.expense_date),
    )?;
    let category = normalize_required_text(
        payload.category.as_deref().unwrap_or(&current.category),
        "费用分类",
    )?;
    let amount =
        normalize_non_negative_money(payload.amount.unwrap_or(current.amount), "费用金额")?;
    let note = payload
        .note
        .as_deref()
        .unwrap_or(&current.note)
        .trim()
        .to_string();
    let updated_at = now_utc_string();

    connection
        .execute(
            "UPDATE billing_expense_entries
             SET case_id = ?, case_name_snapshot = ?, case_path_snapshot = ?, expense_date = ?, category = ?, amount = ?, note = ?, updated_at = ?
             WHERE id = ?",
            params![
                case_id,
                case_name_snapshot,
                next_case_path_snapshot.trim(),
                expense_date,
                category,
                amount,
                note,
                updated_at,
                entry_id
            ],
        )
        .map_err(|err| format!("更新费用记录失败：{err}"))?;

    load_billing_expense_entry_by_id(&connection, entry_id)?
        .ok_or_else(|| format!("费用记录不存在：{entry_id}"))
}

/// 删除费用记录。
pub(crate) fn delete_billing_expense_entry(database: &Path, entry_id: &str) -> Result<(), String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let affected = connection
        .execute(
            "DELETE FROM billing_expense_entries WHERE id = ?",
            params![entry_id],
        )
        .map_err(|err| format!("删除费用记录失败：{err}"))?;
    if affected == 0 {
        return Err(format!("费用记录不存在：{entry_id}"));
    }
    Ok(())
}

/// 查询案件汇总列表。
pub(crate) fn list_billing_case_summaries(
    database: &Path,
) -> Result<Vec<BillingCaseSummary>, String> {
    initialize_billing_store(database)?;
    let connection = open_connection(database)?;
    let settings = load_all_billing_case_settings(&connection)?;
    let time_entries = load_billing_time_entries(&connection, None)?;
    let expense_entries = load_billing_expense_entries(&connection, None)?;
    let mut grouped = BTreeMap::<String, BillingCaseSummary>::new();

    for setting in settings {
        grouped.insert(
            setting.case_id.clone(),
            BillingCaseSummary {
                case_id: setting.case_id,
                case_name_snapshot: setting.case_name_snapshot,
                case_path_snapshot: setting.case_path_snapshot,
                currency_code: setting.currency_code,
                default_hourly_rate: setting.default_hourly_rate,
                total_duration_minutes: 0,
                time_amount: 0.0,
                expense_amount: 0.0,
                total_amount: 0.0,
                time_entry_count: 0,
                expense_entry_count: 0,
            },
        );
    }

    for entry in time_entries {
        let summary = grouped
            .entry(entry.case_id.clone())
            .or_insert_with(|| BillingCaseSummary {
                case_id: entry.case_id.clone(),
                case_name_snapshot: entry.case_name_snapshot.clone(),
                case_path_snapshot: entry.case_path_snapshot.clone(),
                currency_code: DEFAULT_BILLING_CURRENCY_CODE.to_string(),
                default_hourly_rate: 0.0,
                total_duration_minutes: 0,
                time_amount: 0.0,
                expense_amount: 0.0,
                total_amount: 0.0,
                time_entry_count: 0,
                expense_entry_count: 0,
            });
        summary.case_name_snapshot = coalesce_snapshot_name(
            &summary.case_name_snapshot,
            &entry.case_name_snapshot,
            &summary.case_id,
        );
        summary.case_path_snapshot =
            coalesce_snapshot_path(&summary.case_path_snapshot, &entry.case_path_snapshot);
        summary.total_duration_minutes += entry.duration_minutes;
        summary.time_amount = round_money(summary.time_amount + entry.amount);
        summary.time_entry_count += 1;
    }

    for entry in expense_entries {
        let summary = grouped
            .entry(entry.case_id.clone())
            .or_insert_with(|| BillingCaseSummary {
                case_id: entry.case_id.clone(),
                case_name_snapshot: entry.case_name_snapshot.clone(),
                case_path_snapshot: entry.case_path_snapshot.clone(),
                currency_code: DEFAULT_BILLING_CURRENCY_CODE.to_string(),
                default_hourly_rate: 0.0,
                total_duration_minutes: 0,
                time_amount: 0.0,
                expense_amount: 0.0,
                total_amount: 0.0,
                time_entry_count: 0,
                expense_entry_count: 0,
            });
        summary.case_name_snapshot = coalesce_snapshot_name(
            &summary.case_name_snapshot,
            &entry.case_name_snapshot,
            &summary.case_id,
        );
        summary.case_path_snapshot =
            coalesce_snapshot_path(&summary.case_path_snapshot, &entry.case_path_snapshot);
        summary.expense_amount = round_money(summary.expense_amount + entry.amount);
        summary.expense_entry_count += 1;
    }

    let mut summaries = grouped
        .into_values()
        .map(|mut summary| {
            summary.total_amount = round_money(summary.time_amount + summary.expense_amount);
            summary
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| {
        left.case_name_snapshot
            .cmp(&right.case_name_snapshot)
            .then_with(|| left.case_id.cmp(&right.case_id))
    });
    Ok(summaries)
}

fn load_all_billing_case_settings(
    connection: &Connection,
) -> Result<Vec<BillingCaseSetting>, String> {
    let mut statement = connection
        .prepare(
            "SELECT case_id, case_name_snapshot, case_path_snapshot, currency_code, default_hourly_rate, updated_at
             FROM billing_case_settings
             ORDER BY case_name_snapshot ASC, case_id ASC",
        )
        .map_err(|err| format!("读取案件默认费率失败：{err}"))?;
    let rows = statement
        .query_map([], map_billing_case_setting_row)
        .map_err(|err| format!("读取案件默认费率失败：{err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取案件默认费率失败：{err}"))
}

fn load_billing_case_setting_by_id(
    connection: &Connection,
    case_id: &str,
) -> Result<Option<BillingCaseSetting>, String> {
    connection
        .query_row(
            "SELECT case_id, case_name_snapshot, case_path_snapshot, currency_code, default_hourly_rate, updated_at
             FROM billing_case_settings WHERE case_id = ?",
            params![case_id],
            map_billing_case_setting_row,
        )
        .optional()
        .map_err(|err| format!("读取案件默认费率失败：{err}"))
}

fn load_billing_time_entries(
    connection: &Connection,
    case_id: Option<&str>,
) -> Result<Vec<BillingTimeEntry>, String> {
    let sql = if case_id.is_some() {
        "SELECT id, case_id, case_name_snapshot, case_path_snapshot, work_date, description, duration_minutes, hourly_rate, amount, owner_user_label, billable, created_at, updated_at
         FROM billing_time_entries WHERE case_id = ? ORDER BY work_date DESC, updated_at DESC"
    } else {
        "SELECT id, case_id, case_name_snapshot, case_path_snapshot, work_date, description, duration_minutes, hourly_rate, amount, owner_user_label, billable, created_at, updated_at
         FROM billing_time_entries ORDER BY work_date DESC, updated_at DESC"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|err| format!("读取工时记录失败：{err}"))?;
    let mapped = if let Some(value) = case_id {
        statement.query_map(params![value], map_billing_time_entry_row)
    } else {
        statement.query_map([], map_billing_time_entry_row)
    }
    .map_err(|err| format!("读取工时记录失败：{err}"))?;
    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取工时记录失败：{err}"))
}

fn load_billing_time_entry_by_id(
    connection: &Connection,
    entry_id: &str,
) -> Result<Option<BillingTimeEntry>, String> {
    connection
        .query_row(
            "SELECT id, case_id, case_name_snapshot, case_path_snapshot, work_date, description, duration_minutes, hourly_rate, amount, owner_user_label, billable, created_at, updated_at
             FROM billing_time_entries WHERE id = ?",
            params![entry_id],
            map_billing_time_entry_row,
        )
        .optional()
        .map_err(|err| format!("读取工时记录失败：{err}"))
}

fn load_billing_expense_entries(
    connection: &Connection,
    case_id: Option<&str>,
) -> Result<Vec<BillingExpenseEntry>, String> {
    let sql = if case_id.is_some() {
        "SELECT id, case_id, case_name_snapshot, case_path_snapshot, expense_date, category, amount, note, created_at, updated_at
         FROM billing_expense_entries WHERE case_id = ? ORDER BY expense_date DESC, updated_at DESC"
    } else {
        "SELECT id, case_id, case_name_snapshot, case_path_snapshot, expense_date, category, amount, note, created_at, updated_at
         FROM billing_expense_entries ORDER BY expense_date DESC, updated_at DESC"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|err| format!("读取费用记录失败：{err}"))?;
    let mapped = if let Some(value) = case_id {
        statement.query_map(params![value], map_billing_expense_entry_row)
    } else {
        statement.query_map([], map_billing_expense_entry_row)
    }
    .map_err(|err| format!("读取费用记录失败：{err}"))?;
    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取费用记录失败：{err}"))
}

fn load_billing_expense_entry_by_id(
    connection: &Connection,
    entry_id: &str,
) -> Result<Option<BillingExpenseEntry>, String> {
    connection
        .query_row(
            "SELECT id, case_id, case_name_snapshot, case_path_snapshot, expense_date, category, amount, note, created_at, updated_at
             FROM billing_expense_entries WHERE id = ?",
            params![entry_id],
            map_billing_expense_entry_row,
        )
        .optional()
        .map_err(|err| format!("读取费用记录失败：{err}"))
}

fn map_billing_case_setting_row(row: &Row<'_>) -> rusqlite::Result<BillingCaseSetting> {
    Ok(BillingCaseSetting {
        case_id: row.get("case_id")?,
        case_name_snapshot: row.get("case_name_snapshot")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        currency_code: row.get("currency_code")?,
        default_hourly_rate: row.get("default_hourly_rate")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_billing_time_entry_row(row: &Row<'_>) -> rusqlite::Result<BillingTimeEntry> {
    Ok(BillingTimeEntry {
        id: row.get("id")?,
        case_id: row.get("case_id")?,
        case_name_snapshot: row.get("case_name_snapshot")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        work_date: row.get("work_date")?,
        description: row.get("description")?,
        duration_minutes: row.get("duration_minutes")?,
        hourly_rate: row.get("hourly_rate")?,
        amount: row.get("amount")?,
        owner_user_label: row.get("owner_user_label")?,
        billable: row.get::<_, i64>("billable")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_billing_expense_entry_row(row: &Row<'_>) -> rusqlite::Result<BillingExpenseEntry> {
    Ok(BillingExpenseEntry {
        id: row.get("id")?,
        case_id: row.get("case_id")?,
        case_name_snapshot: row.get("case_name_snapshot")?,
        case_path_snapshot: row.get("case_path_snapshot")?,
        expense_date: row.get("expense_date")?,
        category: row.get("category")?,
        amount: row.get("amount")?,
        note: row.get("note")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn resolve_time_entry_hourly_rate(
    connection: &Connection,
    case_id: &str,
    hourly_rate: Option<f64>,
    current_hourly_rate: Option<f64>,
    case_changed: bool,
) -> Result<f64, String> {
    if let Some(value) = hourly_rate {
        return normalize_non_negative_money(value, "小时费率");
    }
    if case_changed {
        return load_billing_case_setting_by_id(connection, case_id)?
            .map(|setting| normalize_non_negative_money(setting.default_hourly_rate, "小时费率"))
            .transpose()
            .map(|value| value.unwrap_or_default());
    }
    if let Some(value) = current_hourly_rate {
        return normalize_non_negative_money(value, "小时费率");
    }
    load_billing_case_setting_by_id(connection, case_id)?
        .map(|setting| normalize_non_negative_money(setting.default_hourly_rate, "小时费率"))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn resolve_time_entry_amount(duration_minutes: i64, hourly_rate: f64, billable: bool) -> f64 {
    if !billable {
        return 0.0;
    }
    round_money((duration_minutes as f64 / 60.0) * hourly_rate)
}

fn normalize_case_id(case_id: &str) -> Result<String, String> {
    let normalized = case_id.trim().to_string();
    if normalized.is_empty() {
        return Err("工时计费记录必须关联案件".to_string());
    }
    Ok(normalized)
}

fn normalize_case_snapshot(
    case_id: &str,
    case_path_snapshot: &str,
    case_name_snapshot: Option<&str>,
) -> Result<String, String> {
    let normalized_path = case_path_snapshot.trim();
    if normalized_path.is_empty() {
        return Err("案件目录快照不能为空".to_string());
    }
    let case_path = Path::new(normalized_path);
    if !case_path.exists() || !case_path.is_dir() {
        return Err(format!("案件目录不存在：{normalized_path}"));
    }
    let derived_name = case_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if derived_name.is_empty() {
        return Err("案件目录快照缺少有效目录名".to_string());
    }
    if derived_name != case_id {
        return Err(format!("案件目录与案件标识不一致：{case_id}"));
    }
    let normalized_name = case_name_snapshot
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(derived_name.as_str())
        .to_string();
    Ok(normalized_name)
}

fn normalize_currency_code(currency_code: Option<&str>) -> Result<String, String> {
    let normalized = currency_code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_BILLING_CURRENCY_CODE)
        .to_uppercase();
    if normalized != DEFAULT_BILLING_CURRENCY_CODE {
        return Err(format!(
            "首版工时计费仅支持币种：{DEFAULT_BILLING_CURRENCY_CODE}"
        ));
    }
    Ok(normalized)
}

fn normalize_work_date(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err("日期不能为空".to_string());
    }
    NaiveDate::parse_from_str(normalized, "%Y-%m-%d")
        .map_err(|_| format!("日期格式不正确：{normalized}"))?;
    Ok(normalized.to_string())
}

fn normalize_required_text(value: &str, label: &str) -> Result<String, String> {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    Ok(normalized)
}

fn normalize_non_negative_integer(value: i64, label: &str) -> Result<i64, String> {
    if value < 0 {
        return Err(format!("{label}不能为负数"));
    }
    Ok(value)
}

fn normalize_non_negative_money(value: f64, label: &str) -> Result<f64, String> {
    if value.is_sign_negative() {
        return Err(format!("{label}不能为负数"));
    }
    Ok(round_money(value))
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn now_utc_string() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn coalesce_snapshot_name(current: &str, incoming: &str, case_id: &str) -> String {
    if !current.trim().is_empty() {
        return current.to_string();
    }
    if !incoming.trim().is_empty() {
        return incoming.to_string();
    }
    case_id.to_string()
}

fn coalesce_snapshot_path(current: &str, incoming: &str) -> String {
    if !current.trim().is_empty() {
        return current.to_string();
    }
    incoming.to_string()
}
