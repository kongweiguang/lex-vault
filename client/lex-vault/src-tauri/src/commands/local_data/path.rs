//! local_data 路径和命名规则。
//!
//! @author kongweiguang

use path_clean::PathClean;
use std::path::{Path, PathBuf};

/// Lex Vault 用户配置目录名。
const DEFAULT_HOME_DIRECTORY: &str = ".lex-vault";

/// Lex Vault 固定 SQLite 数据库文件名。
pub(super) const DEFAULT_DATABASE_FILE: &str = "lex-vault.db";

/// 工作空间内部 Lex Vault 数据目录名。
pub(super) const WORKSPACE_DATA_DIRECTORY: &str = ".lex-vault";

/// 工作空间内部文书模板目录名。
pub(super) const DOC_TEMPLATE_DIRECTORY: &str = "doc";

/// 工作空间内部法规目录名。
pub(super) const LAW_DIRECTORY: &str = "law";

/// 工作空间内部案例数据目录名。
pub(super) const CASE_REF_DIRECTORY: &str = "case";

/// 工作空间内部案件存储根目录名。
pub(super) const CASE_MASTER_DIRECTORY: &str = "master";

/// 工作空间配置库中文书模板路径对应的键。
pub(super) const KEY_DOC_TEMPLATE: &str = "docTemplate";

/// 工作空间配置库中法规资料路径对应的键。
pub(super) const KEY_LAW_DIRECTORY: &str = "lawDirectory";

/// 工作空间配置库中案例资料路径对应的键。
pub(super) const KEY_CASE_REF: &str = "caseRef";

/// 工作空间配置库中案件存储根路径对应的键。
pub(super) const KEY_CASE_MASTER: &str = "caseMaster";

/// 获取用户级配置 SQLite 数据库路径。
pub(super) fn user_config_database_path() -> Result<PathBuf, String> {
    Ok(lex_vault_home_directory()?.join(DEFAULT_DATABASE_FILE))
}

/// 获取 Lex Vault 用户配置目录。
fn lex_vault_home_directory() -> Result<PathBuf, String> {
    user_home_directory().map(|home| home.join(DEFAULT_HOME_DIRECTORY))
}

/// 获取当前用户主目录。
fn user_home_directory() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取当前用户目录".to_string())
}

/// 过滤空白字符串。
pub(super) fn non_blank(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

/// 规范化目录路径，避免依赖目标目录已经存在。
pub(super) fn normalize_directory(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    Ok(normalize_path(Path::new(trimmed)))
}

/// 规范化路径，避免依赖目标文件已经存在。
fn normalize_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    absolute.clean()
}
