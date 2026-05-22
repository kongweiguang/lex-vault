//! local_data 通用 SQLite 存储能力。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::Path;

/// 用户级配置库中工作空间根路径对应的键。
const KEY_WORKSPACE_ROOT: &str = "workspaceRoot";

/// 初始化用户级应用配置表。
pub(super) fn initialize_user_config_store(database: &Path) -> Result<(), String> {
    execute_sql(
        database,
        "CREATE TABLE IF NOT EXISTS app_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL)",
    )
}

/// 初始化工作空间级应用配置表。
pub(super) fn initialize_workspace_config_store(database: &Path) -> Result<(), String> {
    execute_sql(
        database,
        "CREATE TABLE IF NOT EXISTS app_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL)",
    )
}

/// 从用户级配置库读取工作空间根目录。
pub(super) fn read_workspace_root(database: &Path) -> Result<Option<String>, String> {
    initialize_user_config_store(database)?;
    read_config_value(database, KEY_WORKSPACE_ROOT)
}

/// 写入工作空间根目录到用户级配置库。
pub(super) fn write_workspace_root(database: &Path, workspace_root: &str) -> Result<(), String> {
    initialize_user_config_store(database)?;
    write_config_value(database, KEY_WORKSPACE_ROOT, workspace_root)
}

/// 读取配置键值。
pub(super) fn read_config_value(database: &Path, key: &str) -> Result<Option<String>, String> {
    let connection = open_connection(database)?;
    connection
        .query_row(
            "SELECT config_value FROM app_config WHERE config_key = ?",
            params![key],
            |row| row.get::<_, String>("config_value"),
        )
        .optional()
        .map_err(|err| format!("读取应用配置失败：{err}"))
}

/// 写入配置键值。
pub(super) fn write_config_value(database: &Path, key: &str, value: &str) -> Result<(), String> {
    let connection = open_connection(database)?;
    connection
        .execute(
            "INSERT INTO app_config(config_key, config_value) VALUES (?, ?) ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value",
            params![key, value],
        )
        .map(|_| ())
        .map_err(|err| format!("写入应用配置失败：{err}"))
}

/// 执行无返回值 SQL。
pub(super) fn execute_sql(database: &Path, sql: &str) -> Result<(), String> {
    open_connection(database)?
        .execute(sql, [])
        .map(|_| ())
        .map_err(|err| format!("初始化 SQLite 数据库失败：{err}"))
}

/// 打开 SQLite 连接并设置基础参数。
pub(super) fn open_connection(database: &Path) -> Result<Connection, String> {
    ensure_parent_directory(database)?;
    let connection = Connection::open(database)
        .map_err(|err| format!("打开 SQLite 数据库失败：{}，{err}", database.display()))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|err| format!("设置 SQLite 参数失败：{err}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|err| format!("设置 SQLite 超时失败：{err}"))?;
    Ok(connection)
}

/// 确保数据库父目录存在。
fn ensure_parent_directory(database: &Path) -> Result<(), String> {
    if let Some(parent) = database.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建 SQLite 数据库目录失败：{}，{err}", parent.display()))?;
    }
    Ok(())
}
