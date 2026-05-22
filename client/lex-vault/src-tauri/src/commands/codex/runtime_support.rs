use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::json;
use tauri::State;
use toml_edit::{value, DocumentMut, Item, Table};

use crate::appserver_client::AppServerJsonRpcClient;
use crate::appserver_client::ThreadSummary;
use crate::commands::codex::models::plugin_summaries_from_plugin_list_value;
use crate::commands::codex::{CodexRuntimeView, CodexThreadRecord};
use crate::commands::local_data;
use crate::jsonrpc::AppError;
use crate::runtime_bundle::{lex_vault_home_dir, locate_runtime_plugin_marketplaces_directory};

/// 已移除的内置律师 skill 目录名，启动时会清理旧版本残留。
const REMOVED_LEGAL_SKILL_NAMES: [&str; 2] = ["legal-contract-review", "legal-document-drafting"];

/// Codex runtime home 目录名。
pub(crate) const CODEX_HOME_DIRECTORY: &str = "agent";
/// model_instructions_file 在当前 profile 下的相对目录。
pub(crate) const MODEL_INSTRUCTIONS_DIRECTORY: &str = ".internal";
/// model_instructions_file 文件名。
pub(crate) const MODEL_INSTRUCTIONS_FILE_NAME: &str = "kongweiguang.md";
/// 按 Codex marketplace 默认约定写入当前 profile 的目录。
pub(crate) const CODEX_MARKETPLACES_DIRECTORY: &str = ".tmp/marketplaces";
/// Lex Vault 默认模型 instructions 文件内容。
pub(crate) const LEX_VAULT_MODEL_INSTRUCTIONS: &str =
    include_str!("../../../resources/model_instructions/kongweiguang.md");
/// 内置本地能力 MCP server 在配置中的固定名称。
const BUILTIN_LOCAL_MCP_SERVER_NAME: &str = "lex_vault_local";
/// 旧版本仅承载日历能力时使用过的 MCP server 名称，启动时自动迁移。
const LEGACY_CALENDAR_MCP_SERVER_NAME: &str = "calendar_local";
/// Lex Vault 在 app-server config 中记录预装插件指纹的 keyPath。
const PREINSTALLED_PLUGINS_FINGERPRINT_KEY_PATH: &str =
    "lex_vault.preinstalled_plugins_fingerprint";
/// 旧版本离线 marketplace 使用过的非官方名称，启动时需要自动迁移清理。
const LEGACY_PREINSTALLED_MARKETPLACE_NAMES: [&str; 1] = ["kong"];

/// 资源目录中一个待预装的 marketplace 摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BundledPluginMarketplace {
    /// marketplace 稳定名称。
    pub name: String,
    /// 复制到当前 profile 后的 marketplace 根目录。
    pub root: PathBuf,
    /// marketplace 中需要预装的插件目录名列表。
    pub plugin_names: Vec<String>,
}

/// marketplace.json 顶层结构。
#[derive(Debug, Deserialize)]
struct MarketplaceManifest {
    /// marketplace 稳定名称。
    name: String,
    /// marketplace 中声明的插件条目。
    #[serde(default)]
    plugins: Vec<MarketplacePluginEntry>,
}

/// marketplace.json 中的插件条目。
#[derive(Debug, Deserialize)]
struct MarketplacePluginEntry {
    /// 插件目录名。
    name: String,
}

pub(crate) async fn runtime_client(
    state: &State<'_, crate::commands::codex::AppState>,
) -> Result<CodexRuntimeView, AppError> {
    let mut guard = state.codex.lock().await;
    clear_stale_runtime_if_exited(&mut guard)?;
    let runtime = guard.as_ref().ok_or_else(|| {
        AppError::new(
            "APP_SERVER_NOT_RUNNING",
            "Codex runtime 未启动",
            "请先调用 codex_start_runtime",
            true,
        )
    })?;
    Ok(CodexRuntimeView {
        client: runtime.client.clone(),
        codex_home: runtime.codex_home.clone(),
    })
}

/// 进入命令处理前先探测 sidecar 是否已经退出，避免前端仍持有失活 runtime 句柄。
pub(crate) fn clear_stale_runtime_if_exited(
    runtime: &mut Option<crate::commands::codex::CodexRuntime>,
) -> Result<(), AppError> {
    let Some(current_runtime) = runtime.as_mut() else {
        return Ok(());
    };
    match current_runtime.process.child.try_wait() {
        Ok(Some(_status)) => {
            *runtime = None;
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(err) => Err(AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "检查 Codex runtime 状态失败",
            err.to_string(),
            true,
        )),
    }
}

pub(crate) fn profile_codex_home(profile_id: &str) -> Result<PathBuf, AppError> {
    // 当前运行时目录已经固定为 `~/.lex-vault/agent`，保留 profile_id 仅为了兼容现有命令入参。
    let _ = profile_id;
    let base = lex_vault_home_dir()?;
    Ok(base.join(CODEX_HOME_DIRECTORY))
}

/// 清理旧版本遗留的本地律师 skills，后续能力统一走 runtime zip 中的插件包分发。
pub(crate) fn cleanup_legacy_builtin_skills(codex_home: &Path) -> Result<(), AppError> {
    let skills_dir = codex_home.join("skills");
    for skill_name in REMOVED_LEGAL_SKILL_NAMES {
        let stale_target = skills_dir.join(skill_name);
        if !stale_target.exists() {
            continue;
        }
        // 清理旧版本曾经写入的内置 skill，避免用户仍能从运行时列表中选到已下线能力。
        let remove_result = if stale_target.is_dir() {
            std::fs::remove_dir_all(&stale_target)
        } else {
            std::fs::remove_file(&stale_target)
        };
        remove_result.map_err(|err| {
            AppError::new(
                "SKILL_INSTALL_FAILED",
                "清理已移除内置 skill 失败",
                err.to_string(),
                true,
            )
        })?;
    }
    Ok(())
}

/// 将 runtime zip 中的 marketplace 复制到当前 profile，供后续离线预装使用。
pub(crate) fn install_builtin_plugin_marketplaces(
    codex_home: &Path,
) -> Result<Vec<BundledPluginMarketplace>, AppError> {
    let Some(resources_dir) = locate_runtime_plugin_marketplaces_directory()? else {
        return Ok(Vec::new());
    };
    install_builtin_plugin_marketplaces_from(&resources_dir, codex_home)
}

/// 基于当前资源目录计算预装插件内容指纹，用于避免重复安装。
pub(crate) fn builtin_plugin_marketplaces_fingerprint(
    marketplaces: &[BundledPluginMarketplace],
) -> Result<Option<String>, AppError> {
    if marketplaces.is_empty() {
        return Ok(None);
    }
    let mut hasher = DefaultHasher::new();
    for marketplace in marketplaces {
        marketplace.name.hash(&mut hasher);
        hash_directory_contents(&marketplace.root, &marketplace.root, &mut hasher)?;
    }
    Ok(Some(format!("{:016x}", hasher.finish())))
}

/// 在 runtime 初始化后注册本地 marketplace，并按需执行一次官方 `plugin/install`。
pub(crate) async fn sync_builtin_plugin_marketplaces(
    client: &AppServerJsonRpcClient,
    marketplaces: &[BundledPluginMarketplace],
    fingerprint: Option<&str>,
) -> Result<(), AppError> {
    if marketplaces.is_empty() {
        return Ok(());
    }

    let plugin_list: serde_json::Value = client.list_plugins().await?;
    let current_config: serde_json::Value = client
        .request(
            "config/read",
            json!({
                "includeLayers": false,
                "cwd": null
            }),
        )
        .await?;
    let current_fingerprint = current_config
        .get("config")
        .and_then(|config| config.get("lex_vault"))
        .and_then(|config| config.get("preinstalled_plugins_fingerprint"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let discovered_marketplaces = plugin_list
        .get("marketplaces")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let marketplace_records = discovered_marketplaces
        .iter()
        .filter_map(serde_json::Value::as_object)
        .collect::<Vec<_>>();
    let installed_plugins =
        plugin_summaries_from_plugin_list_value(&plugin_list, &marketplace_records);
    for marketplace in marketplaces {
        let marketplace_visible = discovered_marketplaces.iter().any(|entry| {
            entry.get("name").and_then(serde_json::Value::as_str) == Some(marketplace.name.as_str())
        });
        if !marketplace_visible {
            return Err(AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "预装插件市场未被 Codex runtime 识别",
                format!(
                    "marketplace={} root={}",
                    marketplace.name,
                    marketplace.root.display()
                ),
                true,
            ));
        }
        for plugin_name in &marketplace.plugin_names {
            let discovered_plugin = installed_plugins.iter().find(|plugin| {
                plugin.marketplace_name == marketplace.name && plugin.plugin_name == *plugin_name
            });
            let Some(discovered_plugin) = discovered_plugin else {
                return Err(AppError::new(
                    "PLUGIN_INSTALL_FAILED",
                    "预装插件未出现在 Codex 插件列表中",
                    format!("plugin={} marketplace={}", plugin_name, marketplace.name),
                    true,
                ));
            };
            if discovered_plugin.installed {
                continue;
            }
            let marketplace_path = Some(discovered_plugin.marketplace_path.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "PLUGIN_INSTALL_FAILED",
                        "Codex 插件列表缺少 marketplacePath",
                        format!("plugin={} marketplace={}", plugin_name, marketplace.name),
                        true,
                    )
                })?;
            client
                .install_plugin(marketplace_path.to_string(), plugin_name.clone())
                .await?;
        }
    }

    if let Some(fingerprint) =
        fingerprint.filter(|value| current_fingerprint.as_deref() != Some(*value))
    {
        client
            .request::<_, serde_json::Value>(
                "config/batchWrite",
                json!({
                    "edits": [
                        {
                            "keyPath": PREINSTALLED_PLUGINS_FINGERPRINT_KEY_PATH,
                            "value": fingerprint,
                            "mergeStrategy": "replace"
                        }
                    ],
                    "reloadUserConfig": true
                }),
            )
            .await?;
    }

    Ok(())
}

pub(crate) fn prepare_codex_runtime_home(codex_home: &Path) -> Result<String, AppError> {
    let token = local_data::read_saved_access_token()
        .map_err(|err| AppError::new("CODEX_AUTH_NOT_FOUND", "读取登录信息失败", err, true))?;
    if token.trim().is_empty() {
        return Err(AppError::new(
            "CODEX_AUTH_NOT_FOUND",
            "登录信息不存在",
            "启动 Codex runtime 前需要先完成 law-admin 登录",
            true,
        ));
    }

    std::fs::create_dir_all(codex_home).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建 Codex Home 失败",
            err.to_string(),
            true,
        )
    })?;

    Ok(token)
}

/// 确保当前 profile 的模型 instructions 文件存在，并返回其绝对路径。
pub(crate) fn ensure_model_instructions_file(codex_home: &Path) -> Result<PathBuf, AppError> {
    let instructions_dir = codex_home.join(MODEL_INSTRUCTIONS_DIRECTORY);
    std::fs::create_dir_all(&instructions_dir).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建模型 instructions 目录失败",
            err.to_string(),
            true,
        )
    })?;
    let instructions_file = instructions_dir.join(MODEL_INSTRUCTIONS_FILE_NAME);
    std::fs::write(&instructions_file, LEX_VAULT_MODEL_INSTRUCTIONS).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "写入模型 instructions 文件失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(instructions_file)
}

/// 预先把本地能力 MCP server 写入当前 profile 的 `config.toml`，让 app-server 通过 URL 直连桌面端常驻 server。
pub(crate) fn ensure_builtin_local_mcp_server_config(
    codex_home: &Path,
    server_url: &str,
) -> Result<(), AppError> {
    ensure_builtin_local_mcp_server_config_with_url(codex_home, server_url)
}

pub(crate) fn validate_workspace(cwd: &str) -> Result<(), AppError> {
    if cwd.trim().is_empty() || !Path::new(cwd).is_dir() {
        return Err(AppError::new(
            "WORKSPACE_NOT_FOUND",
            "工作空间不存在",
            cwd.to_string(),
            true,
        ));
    }
    Ok(())
}

/// 测试和运行时共用的 MCP server 配置写入逻辑。
fn ensure_builtin_local_mcp_server_config_with_url(
    codex_home: &Path,
    server_url: &str,
) -> Result<(), AppError> {
    let config_path = codex_home.join("config.toml");
    let raw = if config_path.is_file() {
        std::fs::read_to_string(&config_path).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "读取 Codex 配置文件失败",
                err.to_string(),
                true,
            )
        })?
    } else {
        String::new()
    };
    let mut document = raw.parse::<DocumentMut>().unwrap_or_default();
    let root = document.as_table_mut();
    if !root.contains_key("mcp_servers") || !matches!(root["mcp_servers"], Item::Table(_)) {
        root["mcp_servers"] = Item::Table(Table::new());
    }

    let mcp_servers = document["mcp_servers"]
        .as_table_mut()
        .expect("mcp_servers should be a table");
    // 迁移旧版本只承载日历能力时的 `calendar_local` 命名，统一收口到通用本地能力 server。
    mcp_servers.remove(LEGACY_CALENDAR_MCP_SERVER_NAME);
    if !mcp_servers.contains_key(BUILTIN_LOCAL_MCP_SERVER_NAME) {
        mcp_servers[BUILTIN_LOCAL_MCP_SERVER_NAME] = Item::Table(Table::new());
    }
    let server_table = mcp_servers[BUILTIN_LOCAL_MCP_SERVER_NAME]
        .as_table_mut()
        .expect("local mcp server entry should be a table");
    server_table.remove("command");
    server_table.remove("args");
    server_table["url"] = value(server_url.trim().to_string());

    std::fs::write(&config_path, document.to_string()).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "写入内置 MCP server 配置失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(())
}

pub(crate) fn thread_record_from_summary(thread: ThreadSummary) -> CodexThreadRecord {
    let preview = thread.preview.unwrap_or_default();
    let title = thread
        .name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| {
            preview
                .lines()
                .next()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .unwrap_or("小隐会话")
                .to_string()
        });
    CodexThreadRecord {
        id: thread.id,
        cwd: thread.cwd.display().to_string(),
        ephemeral: thread.ephemeral,
        title,
        preview,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        status: thread.status,
        turns: thread.turns,
    }
}

pub(crate) fn audit(codex_home: &Path, event_type: &str, payload: serde_json::Value) {
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let path = codex_home.parent().unwrap_or(codex_home).join("audit");
    if std::fs::create_dir_all(&path).is_err() {
        return;
    }
    let line = json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "eventType": event_type,
        "payload": payload
    })
    .to_string()
        + "\n";
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.join(format!("{date}.jsonl")))
        .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()));
}

pub(crate) fn emit_error(message: String) -> AppError {
    AppError::new(
        "APP_SERVER_PROTOCOL_ERROR",
        "发送 Codex 事件失败",
        message,
        true,
    )
}

/// 安装测试或运行时传入的本地 marketplace 目录。
pub(crate) fn install_builtin_plugin_marketplaces_from(
    resources_dir: &Path,
    codex_home: &Path,
) -> Result<Vec<BundledPluginMarketplace>, AppError> {
    if !resources_dir.is_dir() {
        return Ok(Vec::new());
    }
    let target_root = codex_home.join(CODEX_MARKETPLACES_DIRECTORY);
    std::fs::create_dir_all(&target_root).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "创建预装插件目录失败",
            err.to_string(),
            true,
        )
    })?;

    let mut marketplaces = Vec::new();
    let entries = std::fs::read_dir(resources_dir).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "读取内置插件资源目录失败",
            err.to_string(),
            true,
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "读取内置插件资源条目失败",
                err.to_string(),
                true,
            )
        })?;
        let source_path = entry.path();
        if !source_path.is_dir() {
            continue;
        }
        let manifest = read_marketplace_manifest(&source_path)?;
        let target_path = target_root.join(&manifest.name);
        if manifest.plugins.is_empty() {
            if target_path.exists() {
                std::fs::remove_dir_all(&target_path).map_err(|err| {
                    AppError::new(
                        "PLUGIN_INSTALL_FAILED",
                        "清理空预装插件市场失败",
                        err.to_string(),
                        true,
                    )
                })?;
            }
            continue;
        }
        if target_path.exists() && marketplace_directories_match(&source_path, &target_path)? {
            let canonical_target = std::fs::canonicalize(&target_path).unwrap_or(target_path);
            marketplaces.push(BundledPluginMarketplace {
                name: manifest.name,
                root: canonical_target,
                plugin_names: manifest
                    .plugins
                    .into_iter()
                    .map(|plugin| plugin.name)
                    .collect(),
            });
            continue;
        }
        if target_path.exists() {
            std::fs::remove_dir_all(&target_path).map_err(|err| {
                AppError::new(
                    "PLUGIN_INSTALL_FAILED",
                    "清理旧版预装插件市场失败",
                    err.to_string(),
                    true,
                )
            })?;
        }
        copy_path_recursively(&source_path, &target_path).map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "复制预装插件市场失败",
                err.to_string(),
                true,
            )
        })?;
        // Windows 上历史脏目录或异常中断后，目标目录中的 `.agents/plugins/marketplace.json`
        // 可能缺失或残留旧内容；这里强制以资源目录中的 manifest 覆写一遍，保证 Codex
        // 始终能按官方 marketplace 结构重新发现插件。
        copy_marketplace_manifest(&source_path, &target_path)?;
        let canonical_target = std::fs::canonicalize(&target_path).unwrap_or(target_path);
        marketplaces.push(BundledPluginMarketplace {
            name: manifest.name,
            root: canonical_target,
            plugin_names: manifest
                .plugins
                .into_iter()
                .map(|plugin| plugin.name)
                .collect(),
        });
    }
    marketplaces.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(marketplaces)
}

/// 当资源目录与 profile 中的 marketplace 内容完全一致时，直接复用已有目录，避免 Windows
/// 在重复启动时因为目录仍被后台句柄占用而删除失败。
fn marketplace_directories_match(source: &Path, target: &Path) -> Result<bool, AppError> {
    if !target.is_dir() {
        return Ok(false);
    }
    Ok(directory_contents_fingerprint(source)? == directory_contents_fingerprint(target)?)
}

/// 解析 marketplace.json，并提取稳定 marketplace 名称和插件清单。
fn read_marketplace_manifest(source_path: &Path) -> Result<MarketplaceManifest, AppError> {
    let manifest_path = source_path
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let raw = std::fs::read_to_string(&manifest_path).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "读取 marketplace.json 失败",
            format!("{}: {err}", manifest_path.display()),
            true,
        )
    })?;
    serde_json::from_str::<MarketplaceManifest>(&raw).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "解析 marketplace.json 失败",
            format!("{}: {err}", manifest_path.display()),
            true,
        )
    })
}

/// 递归复制目录内容，确保预装插件可以离线落盘到 profile。
fn copy_path_recursively(source: &Path, target: &Path) -> std::io::Result<()> {
    if source.is_dir() {
        std::fs::create_dir_all(target)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let child_source = entry.path();
            let child_target = target.join(entry.file_name());
            copy_path_recursively(&child_source, &child_target)?;
        }
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source, target).map(|_| ())
}

/// 显式覆写 marketplace manifest，避免目标目录沿用旧版或不完整的 `.agents` 内容。
fn copy_marketplace_manifest(source_root: &Path, target_root: &Path) -> Result<(), AppError> {
    let source_manifest = source_root
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let target_manifest = target_root
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    std::fs::create_dir_all(
        target_manifest
            .parent()
            .expect("marketplace manifest parent should exist"),
    )
    .map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "创建预装插件 marketplace manifest 目录失败",
            err.to_string(),
            true,
        )
    })?;
    std::fs::copy(&source_manifest, &target_manifest)
        .map(|_| ())
        .map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "写入预装插件 marketplace manifest 失败",
                format!(
                    "{} -> {}: {}",
                    source_manifest.display(),
                    target_manifest.display(),
                    err
                ),
                true,
            )
        })
}

/// 计算单个 marketplace 目录的稳定内容指纹，用于判断 profile 中是否已是最新副本。
fn directory_contents_fingerprint(root: &Path) -> Result<u64, AppError> {
    let mut hasher = DefaultHasher::new();
    hash_directory_contents(root, root, &mut hasher)?;
    Ok(hasher.finish())
}

/// 把离线 marketplace 和默认启用的插件条目写入当前 profile 的 config.toml。
pub(crate) fn ensure_builtin_plugin_marketplaces_config(
    codex_home: &Path,
    marketplaces: &[BundledPluginMarketplace],
) -> Result<(), AppError> {
    let config_path = codex_home.join("config.toml");
    let raw = if config_path.is_file() {
        std::fs::read_to_string(&config_path).map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "读取 Codex 配置文件失败",
                err.to_string(),
                true,
            )
        })?
    } else {
        String::new()
    };
    let mut document = raw.parse::<DocumentMut>().unwrap_or_default();
    // 清理旧版本遗留的 `kong` marketplace，避免升级后列表中继续出现非官方标识。
    remove_legacy_builtin_plugin_marketplaces(codex_home, &mut document)?;
    cleanup_stale_builtin_plugin_marketplaces(codex_home, &mut document, marketplaces)?;
    if marketplaces.is_empty() {
        std::fs::write(&config_path, document.to_string()).map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "写入 Codex 插件配置失败",
                err.to_string(),
                true,
            )
        })?;
        return Ok(());
    }
    let root = document.as_table_mut();
    if !root.contains_key("marketplaces") || !matches!(root["marketplaces"], Item::Table(_)) {
        root["marketplaces"] = Item::Table(Table::new());
    }
    if !root.contains_key("plugins") || !matches!(root["plugins"], Item::Table(_)) {
        root["plugins"] = Item::Table(Table::new());
    }

    for marketplace in marketplaces {
        let marketplaces_table = document["marketplaces"]
            .as_table_mut()
            .expect("marketplaces table should exist");
        if !marketplaces_table.contains_key(&marketplace.name) {
            marketplaces_table[&marketplace.name] = Item::Table(Table::new());
        }
        let marketplace_table = marketplaces_table[&marketplace.name]
            .as_table_mut()
            .expect("marketplace entry should be a table");
        marketplace_table["source_type"] = value("local");
        marketplace_table["source"] = value(marketplace.root.display().to_string());

        let plugins_table = document["plugins"]
            .as_table_mut()
            .expect("plugins table should exist");
        for plugin_name in &marketplace.plugin_names {
            let plugin_id = format!("{plugin_name}@{}", marketplace.name);
            if !plugins_table.contains_key(&plugin_id) {
                plugins_table[&plugin_id] = Item::Table(Table::new());
            }
            let plugin_table = plugins_table[&plugin_id]
                .as_table_mut()
                .expect("plugin entry should be a table");
            plugin_table["enabled"] = value(true);
        }
    }

    std::fs::write(&config_path, document.to_string()).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "写入 Codex 插件配置失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(())
}

/// 清理已经不再由当前安装包声明的预装 marketplace 与插件条目。
fn cleanup_stale_builtin_plugin_marketplaces(
    codex_home: &Path,
    document: &mut DocumentMut,
    marketplaces: &[BundledPluginMarketplace],
) -> Result<(), AppError> {
    let managed_marketplace_names =
        collect_managed_builtin_marketplace_names(codex_home, document, marketplaces)?;
    let expected_marketplace_names = marketplaces
        .iter()
        .map(|marketplace| marketplace.name.clone())
        .collect::<HashSet<_>>();
    let expected_plugin_ids = marketplaces
        .iter()
        .flat_map(|marketplace| {
            marketplace
                .plugin_names
                .iter()
                .map(|plugin_name| format!("{plugin_name}@{}", marketplace.name))
        })
        .collect::<HashSet<_>>();
    let preinstalled_root = codex_home.join(CODEX_MARKETPLACES_DIRECTORY);

    for marketplace_name in managed_marketplace_names
        .iter()
        .filter(|name| !expected_marketplace_names.contains(*name))
    {
        let marketplace_path = preinstalled_root.join(marketplace_name);
        if marketplace_path.exists() {
            std::fs::remove_dir_all(&marketplace_path).map_err(|err| {
                AppError::new(
                    "PLUGIN_INSTALL_FAILED",
                    "清理已下线预装插件市场目录失败",
                    format!("{}: {}", marketplace_path.display(), err),
                    true,
                )
            })?;
        }
    }

    if let Some(marketplaces_table) = document
        .get_mut("marketplaces")
        .and_then(Item::as_table_mut)
    {
        let stale_marketplaces = marketplaces_table
            .iter()
            .map(|(key, _)| key.to_string())
            .filter(|name| {
                managed_marketplace_names.contains(name)
                    && !expected_marketplace_names.contains(name)
            })
            .collect::<Vec<_>>();
        for marketplace_name in stale_marketplaces {
            marketplaces_table.remove(&marketplace_name);
        }
    }

    if let Some(plugins_table) = document.get_mut("plugins").and_then(Item::as_table_mut) {
        let stale_plugin_ids = plugins_table
            .iter()
            .map(|(key, _)| key.to_string())
            .filter(|plugin_id| {
                plugin_id
                    .rsplit_once('@')
                    .map(|(_, marketplace_name)| {
                        managed_marketplace_names.contains(marketplace_name)
                    })
                    .unwrap_or(false)
                    && !expected_plugin_ids.contains(plugin_id)
            })
            .collect::<Vec<_>>();
        for plugin_id in stale_plugin_ids {
            plugins_table.remove(&plugin_id);
        }
    }

    Ok(())
}

/// 清理旧版本遗留的非官方 marketplace 名称和目录，避免界面继续展示 `kong` 标识。
fn remove_legacy_builtin_plugin_marketplaces(
    codex_home: &Path,
    document: &mut DocumentMut,
) -> Result<(), AppError> {
    let legacy_root = codex_home.join(CODEX_MARKETPLACES_DIRECTORY);
    for legacy_name in LEGACY_PREINSTALLED_MARKETPLACE_NAMES {
        let legacy_marketplace_path = legacy_root.join(legacy_name);
        if legacy_marketplace_path.exists() {
            std::fs::remove_dir_all(&legacy_marketplace_path).map_err(|err| {
                AppError::new(
                    "PLUGIN_INSTALL_FAILED",
                    "清理旧版预装插件市场目录失败",
                    format!("{}: {}", legacy_marketplace_path.display(), err),
                    true,
                )
            })?;
        }

        if let Some(marketplaces_table) = document
            .get_mut("marketplaces")
            .and_then(Item::as_table_mut)
        {
            marketplaces_table.remove(legacy_name);
        }

        if let Some(plugins_table) = document.get_mut("plugins").and_then(Item::as_table_mut) {
            let legacy_plugin_ids = plugins_table
                .iter()
                .map(|(key, _)| key.to_string())
                .filter(|plugin_id| plugin_id.ends_with(&format!("@{legacy_name}")))
                .collect::<Vec<_>>();
            for plugin_id in legacy_plugin_ids {
                plugins_table.remove(&plugin_id);
            }
        }
    }
    Ok(())
}

/// 收集当前 profile 下由 Lex Vault 管理的预装 marketplace 名称集合。
fn collect_managed_builtin_marketplace_names(
    codex_home: &Path,
    document: &DocumentMut,
    marketplaces: &[BundledPluginMarketplace],
) -> Result<HashSet<String>, AppError> {
    let mut names = marketplaces
        .iter()
        .map(|marketplace| marketplace.name.clone())
        .collect::<HashSet<_>>();
    names.extend(
        LEGACY_PREINSTALLED_MARKETPLACE_NAMES
            .iter()
            .map(|name| (*name).to_string()),
    );

    let preinstalled_root = codex_home.join(CODEX_MARKETPLACES_DIRECTORY);
    if !preinstalled_root.is_dir() {
        collect_builtin_marketplace_names_from_config(document, &mut names);
        return Ok(names);
    }

    let entries = std::fs::read_dir(&preinstalled_root).map_err(|err| {
        AppError::new(
            "PLUGIN_INSTALL_FAILED",
            "读取预装插件市场目录失败",
            err.to_string(),
            true,
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "读取预装插件市场条目失败",
                err.to_string(),
                true,
            )
        })?;
        if entry.path().is_dir() {
            names.insert(entry.file_name().to_string_lossy().to_string());
        }
    }
    collect_builtin_marketplace_names_from_config(document, &mut names);
    Ok(names)
}

/// 从当前配置文件中补采集已声明过的内置 marketplace 名称，避免目录已删但配置残留时漏清理。
fn collect_builtin_marketplace_names_from_config(
    document: &DocumentMut,
    names: &mut HashSet<String>,
) {
    if let Some(marketplaces_table) = document.get("marketplaces").and_then(Item::as_table) {
        names.extend(marketplaces_table.iter().map(|(key, _)| key.to_string()));
    }
    if let Some(plugins_table) = document.get("plugins").and_then(Item::as_table) {
        for plugin_id in plugins_table.iter().map(|(key, _)| key.to_string()) {
            if let Some((_, marketplace_name)) = plugin_id.rsplit_once('@') {
                names.insert(marketplace_name.to_string());
            }
        }
    }
}

/// 递归收集文件内容，生成稳定指纹，便于判断资源插件是否发生变化。
fn hash_directory_contents(
    root: &Path,
    current: &Path,
    hasher: &mut DefaultHasher,
) -> Result<(), AppError> {
    let mut children = std::fs::read_dir(current)
        .map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "读取预装插件目录失败",
                err.to_string(),
                true,
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| {
            AppError::new(
                "PLUGIN_INSTALL_FAILED",
                "遍历预装插件目录失败",
                err.to_string(),
                true,
            )
        })?;
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        relative.hash(hasher);
        if path.is_dir() {
            hash_directory_contents(root, &path, hasher)?;
            continue;
        }
        std::fs::read(&path)
            .map_err(|err| {
                AppError::new(
                    "PLUGIN_INSTALL_FAILED",
                    "读取预装插件文件失败",
                    format!("{}: {err}", path.display()),
                    true,
                )
            })?
            .hash(hasher);
    }
    Ok(())
}
