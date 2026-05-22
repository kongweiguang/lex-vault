//! Lex Vault 运行日志初始化与便捷封装。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::Value;
use tracing_appender::non_blocking::WorkerGuard;

const LEX_VAULT_HOME_DIRECTORY: &str = ".lex-vault";

static LOG_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// 初始化基于 tracing 的文件日志，默认写入 `~/.lex-vault/logs/lex-vault.log`。
pub fn initialize_logging() -> Result<PathBuf, String> {
    let base =
        dirs::home_dir().ok_or_else(|| "无法确定当前用户目录，初始化日志目录失败".to_string())?;
    initialize_logging_with_base(&base)
}

/// 返回当前日志目录；若尚未初始化则尝试按默认位置初始化。
pub fn log_directory() -> Option<PathBuf> {
    if let Some(path) = LOG_DIRECTORY.get() {
        return Some(path.clone());
    }
    initialize_logging().ok()
}

/// 记录 info 级别日志。
pub fn log_info(event: &str, message: impl AsRef<str>) {
    tracing::info!(target: "lex_vault", event, message = %message.as_ref());
}

/// 记录 warn 级别日志。
pub fn log_warn(event: &str, message: impl AsRef<str>) {
    tracing::warn!(target: "lex_vault", event, message = %message.as_ref());
}

/// 记录 error 级别日志。
pub fn log_error(event: &str, message: impl AsRef<str>) {
    tracing::error!(target: "lex_vault", event, message = %message.as_ref());
}

/// 记录附带结构化详情的日志，便于按时间线排查协议和运行时问题。
pub fn log_with_details(level: &str, event: &str, message: impl AsRef<str>, details: Value) {
    match level {
        "ERROR" => {
            tracing::error!(target: "lex_vault", event, message = %message.as_ref(), details = %details)
        }
        "WARN" => {
            tracing::warn!(target: "lex_vault", event, message = %message.as_ref(), details = %details)
        }
        _ => {
            tracing::info!(target: "lex_vault", event, message = %message.as_ref(), details = %details)
        }
    }
}

fn initialize_logging_with_base(base: &Path) -> Result<PathBuf, String> {
    if let Some(path) = LOG_DIRECTORY.get() {
        return Ok(path.clone());
    }

    let path = base.join(LEX_VAULT_HOME_DIRECTORY).join("logs");
    std::fs::create_dir_all(&path).map_err(|err| format!("创建日志目录失败：{err}"))?;

    let file_appender = tracing_appender::rolling::never(&path, "lex-vault.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(non_blocking)
        .with_target(true)
        .with_level(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_file(true)
        .with_line_number(true)
        .finish();

    let _ = tracing::subscriber::set_global_default(subscriber);
    let _ = LOG_GUARD.set(guard);
    let _ = LOG_DIRECTORY.set(path.clone());
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_logging_creates_log_directory_under_lex_vault_home() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = initialize_logging_with_base(temp.path()).expect("init log dir");
        assert!(path.ends_with(Path::new(".lex-vault").join("logs")));
        assert!(path.is_dir());
    }
}
