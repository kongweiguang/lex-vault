//! local_data 工作空间配置能力。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::auth::initialize_auth_store;
use super::calendar::initialize_calendar_store;
use super::path::{
    non_blank, normalize_directory, user_config_database_path, CASE_MASTER_DIRECTORY,
    CASE_REF_DIRECTORY, DEFAULT_DATABASE_FILE, DOC_TEMPLATE_DIRECTORY, KEY_CASE_MASTER,
    KEY_CASE_REF, KEY_DOC_TEMPLATE, KEY_LAW_DIRECTORY, LAW_DIRECTORY, WORKSPACE_DATA_DIRECTORY,
};
use super::store::{
    initialize_user_config_store, initialize_workspace_config_store, read_config_value,
    read_workspace_root, write_config_value, write_workspace_root,
};

/// 本机应用配置。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// 当前用户选择的业务工作空间根目录；为空表示首次启动尚未配置。
    pub workspace_root: String,
    /// 用户级配置 SQLite 数据库路径，保存应用配置、账号展示信息和登录令牌。
    pub user_config_database: String,
    /// 当前工作空间级 SQLite 数据库路径，保存该工作空间的数据索引。
    pub workspace_database: String,
    /// 当前工作空间内的文书模板目录路径。
    pub doc_template: String,
    /// 当前工作空间内的法规资料目录路径。
    pub law_directory: String,
    /// 当前工作空间内的案例资料目录路径。
    pub case_ref: String,
    /// 当前工作空间内的案件存储根目录路径。
    pub case_master: String,
}

/// 应用配置更新请求，空字段表示保留原值。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigPatch {
    /// 当前用户选择的业务工作空间根目录。
    pub workspace_root: Option<String>,
    /// 当前工作空间内的文书模板目录路径。
    pub doc_template: Option<String>,
    /// 当前工作空间内的法规资料目录路径。
    pub law_directory: Option<String>,
    /// 当前工作空间内的案例资料目录路径。
    pub case_ref: Option<String>,
    /// 当前工作空间内的案件存储根目录路径。
    pub case_master: Option<String>,
}

/// 读取用户级配置，并在已有工作空间时补齐工作空间目录骨架。
pub(super) fn load_config() -> Result<AppConfig, String> {
    let user_database = user_config_database_path()?;
    initialize_user_config_store(&user_database)?;
    initialize_auth_store(&user_database)?;
    let workspace_root = read_workspace_root(&user_database)?.unwrap_or_default();
    let config = load_workspace_config(&user_database, workspace_root)?;
    if !config.workspace_root.trim().is_empty() {
        ensure_workspace_layout(&config)?;
    }
    Ok(config)
}

/// 更新用户级配置并返回最终配置。
pub(super) fn update_config(patch: AppConfigPatch) -> Result<AppConfig, String> {
    let AppConfigPatch {
        workspace_root: patch_workspace_root,
        doc_template,
        law_directory,
        case_ref,
        case_master,
    } = patch;
    let user_database = user_config_database_path()?;
    initialize_user_config_store(&user_database)?;
    initialize_auth_store(&user_database)?;
    let mut workspace_root = read_workspace_root(&user_database)?.unwrap_or_default();
    if let Some(value) = non_blank(patch_workspace_root) {
        workspace_root = normalize_directory(&value)?.display().to_string();
    }
    write_workspace_root(&user_database, &workspace_root)?;
    let mut config = load_workspace_config(&user_database, workspace_root)?;
    if !config.workspace_root.trim().is_empty() {
        apply_workspace_config_patch(
            &mut config,
            AppConfigPatch {
                workspace_root: None,
                doc_template,
                law_directory,
                case_ref,
                case_master,
            },
        )?;
        write_workspace_directory_config(&config)?;
        ensure_workspace_layout(&config)?;
    }
    Ok(config)
}

/// 读取并校验当前配置必须已经绑定工作空间。
pub(super) fn configured_workspace_config() -> Result<AppConfig, String> {
    let config = load_config()?;
    if config.workspace_root.trim().is_empty() {
        Err("请先在首次引导或设置中选择工作空间".to_string())
    } else {
        Ok(config)
    }
}

/// 根据用户配置库和工作空间根路径构建前端配置视图。
pub(super) fn build_config(
    user_database: &Path,
    workspace_root: String,
) -> Result<AppConfig, String> {
    let workspace_root = workspace_root.trim().to_string();
    let workspace_path = if workspace_root.is_empty() {
        None
    } else {
        Some(PathBuf::from(&workspace_root))
    };
    Ok(AppConfig {
        workspace_root,
        user_config_database: user_database.display().to_string(),
        workspace_database: workspace_path
            .as_ref()
            .map(|path| {
                path.join(WORKSPACE_DATA_DIRECTORY)
                    .join(DEFAULT_DATABASE_FILE)
                    .display()
                    .to_string()
            })
            .unwrap_or_default(),
        doc_template: workspace_path
            .as_ref()
            .map(|path| path.join(DOC_TEMPLATE_DIRECTORY).display().to_string())
            .unwrap_or_default(),
        law_directory: workspace_path
            .as_ref()
            .map(|path| path.join(LAW_DIRECTORY).display().to_string())
            .unwrap_or_default(),
        case_ref: workspace_path
            .as_ref()
            .map(|path| path.join(CASE_REF_DIRECTORY).display().to_string())
            .unwrap_or_default(),
        case_master: workspace_path
            .as_ref()
            .map(|path| path.join(CASE_MASTER_DIRECTORY).display().to_string())
            .unwrap_or_default(),
    })
}

/// 读取工作空间配置库中的可修改目录配置，并叠加到默认配置视图。
pub(super) fn load_workspace_config(
    user_database: &Path,
    workspace_root: String,
) -> Result<AppConfig, String> {
    let mut config = build_config(user_database, workspace_root)?;
    if config.workspace_root.trim().is_empty() {
        return Ok(config);
    }

    initialize_workspace_config_store(Path::new(&config.workspace_database))?;
    if let Some(value) = read_config_value(Path::new(&config.workspace_database), KEY_DOC_TEMPLATE)?
    {
        config.doc_template = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) =
        read_config_value(Path::new(&config.workspace_database), KEY_LAW_DIRECTORY)?
    {
        config.law_directory = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) = read_config_value(Path::new(&config.workspace_database), KEY_CASE_REF)? {
        config.case_ref = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) = read_config_value(Path::new(&config.workspace_database), KEY_CASE_MASTER)?
    {
        config.case_master = normalize_directory(&value)?.display().to_string();
    }
    Ok(config)
}

/// 将设置页传入的目录配置合并到当前工作空间配置。
pub(super) fn apply_workspace_config_patch(
    config: &mut AppConfig,
    patch: AppConfigPatch,
) -> Result<(), String> {
    if let Some(value) = non_blank(patch.doc_template) {
        config.doc_template = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) = non_blank(patch.law_directory) {
        config.law_directory = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) = non_blank(patch.case_ref) {
        config.case_ref = normalize_directory(&value)?.display().to_string();
    }
    if let Some(value) = non_blank(patch.case_master) {
        config.case_master = normalize_directory(&value)?.display().to_string();
    }
    Ok(())
}

/// 将当前工作空间可修改目录配置写入工作空间级 SQLite。
pub(super) fn write_workspace_directory_config(config: &AppConfig) -> Result<(), String> {
    let database = Path::new(&config.workspace_database);
    initialize_workspace_config_store(database)?;
    write_config_value(database, KEY_DOC_TEMPLATE, &config.doc_template)?;
    write_config_value(database, KEY_LAW_DIRECTORY, &config.law_directory)?;
    write_config_value(database, KEY_CASE_REF, &config.case_ref)?;
    write_config_value(database, KEY_CASE_MASTER, &config.case_master)
}

/// 确保工作空间业务目录和工作空间级索引库存在。
pub(super) fn ensure_workspace_layout(config: &AppConfig) -> Result<(), String> {
    for directory in [
        &config.workspace_root,
        &config.doc_template,
        &config.law_directory,
        &config.case_ref,
        &config.case_master,
    ] {
        fs::create_dir_all(directory).map_err(|err| format!("创建目录失败：{directory}，{err}"))?;
    }
    initialize_calendar_store(Path::new(&config.workspace_database))
}
