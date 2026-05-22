//! local_data 认证信息存储能力。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::store::{execute_sql, open_connection};

/// 当前登录会话信息。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    /// 登录用户名。
    pub username: String,
    /// law-admin 返回的访问令牌，统一保存在用户级 SQLite 中。
    pub access_token: String,
}

/// 认证信息更新请求。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfoPatch {
    /// 登录用户名。
    pub username: Option<String>,
    /// law-admin 返回的访问令牌，写入用户级 SQLite。
    pub access_token: Option<String>,
}

/// 初始化预留登录信息表。
pub(super) fn initialize_auth_store(database: &Path) -> Result<(), String> {
    migrate_legacy_auth_store(database)?;
    execute_sql(
        database,
        "CREATE TABLE IF NOT EXISTS auth_info (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT, access_token TEXT)",
    )?;
    execute_sql(database, "INSERT OR IGNORE INTO auth_info(id) VALUES (1)")
}

/// 从用户级配置库读取认证信息。
pub(super) fn read_auth_info(database: &Path) -> Result<AuthInfo, String> {
    let connection = open_connection(database)?;
    connection
        .query_row(
            "SELECT username, access_token FROM auth_info WHERE id = 1",
            [],
            |row| {
                Ok(AuthInfo {
                    username: row
                        .get::<_, Option<String>>("username")?
                        .unwrap_or_default(),
                    access_token: row
                        .get::<_, Option<String>>("access_token")?
                        .unwrap_or_default(),
                })
            },
        )
        .map_err(|err| format!("读取登录信息失败：{err}"))
}

/// 将认证信息写入用户级配置库。
pub(super) fn write_auth_info(database: &Path, auth: &AuthInfo) -> Result<(), String> {
    let connection = open_connection(database)?;
    connection
        .execute(
            "UPDATE auth_info SET username = ?, access_token = ? WHERE id = 1",
            params![&auth.username, &auth.access_token],
        )
        .map(|_| ())
        .map_err(|err| format!("写入登录信息失败：{err}"))
}

/// 清空用户级配置库中的认证信息。
pub(super) fn clear_auth_info_in_database(database: &Path) -> Result<(), String> {
    write_auth_info(database, &AuthInfo::default())
}

/// 读取用户级 SQLite 中的访问令牌。
pub(super) fn read_auth_access_token(database: &Path) -> Result<String, String> {
    let connection = open_connection(database)?;
    connection
        .query_row(
            "SELECT access_token FROM auth_info WHERE id = 1",
            [],
            |row| row.get::<_, Option<String>>("access_token"),
        )
        .optional()
        .map_err(|err| format!("读取登录 token 失败：{err}"))
        .map(|value| normalize_access_token(&value.flatten().unwrap_or_default()))
}

/// 规范化 access_token，避免重复 Bearer 前缀或首尾空白导致后端判定 token 无效。
pub(super) fn normalize_access_token(value: &str) -> String {
    let token = value.trim();
    token
        .strip_prefix("Bearer ")
        .or_else(|| token.strip_prefix("bearer "))
        .unwrap_or(token)
        .trim()
        .to_string()
}

/// 将旧版包含 refresh_token / expires_at 的 auth_info 表迁移到当前精简结构。
fn migrate_legacy_auth_store(database: &Path) -> Result<(), String> {
    let connection = open_connection(database)?;
    let column_names = auth_info_column_names(&connection)?;
    if column_names.is_empty()
        || !column_names
            .iter()
            .any(|name| name == "refresh_token" || name == "expires_at")
    {
        return Ok(());
    }

    connection
        .execute_batch(
            r#"
BEGIN;
ALTER TABLE auth_info RENAME TO auth_info_legacy;
CREATE TABLE auth_info (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT, access_token TEXT);
INSERT INTO auth_info(id, username, access_token)
SELECT id, username, access_token FROM auth_info_legacy;
DROP TABLE auth_info_legacy;
COMMIT;
"#,
        )
        .map_err(|err| format!("迁移登录信息表失败：{err}"))
}

/// 读取 auth_info 当前列集合，用于判断是否需要迁移旧表结构。
fn auth_info_column_names(connection: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(auth_info)")
        .map_err(|err| format!("读取登录信息表结构失败：{err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("读取登录信息表结构失败：{err}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("读取登录信息表结构失败：{err}"))
}
