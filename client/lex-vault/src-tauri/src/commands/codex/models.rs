use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tokio::sync::{Mutex, RwLock};

use crate::appserver_client::AppServerJsonRpcClient;
use crate::codex_process::CodexProcess;

/// Codex runtime 全局状态。
#[derive(Default)]
pub struct AppState {
    /// 当前运行中的 Codex runtime。
    pub codex: Mutex<Option<CodexRuntime>>,
    /// 串行化 runtime 启动链路，避免多个入口并发拉起 app-server。
    pub runtime_startup: Mutex<()>,
    /// 串行化 runtime 包准备，避免重复下载或并发解压同一份运行时。
    pub runtime_bundle_prepare: Mutex<()>,
    /// 当前 profile ID。
    pub current_profile: RwLock<Option<String>>,
    /// 当前 thread ID。
    pub current_thread: RwLock<Option<String>>,
}

/// 运行中的 Codex runtime。
pub struct CodexRuntime {
    /// app-server 进程句柄。
    pub process: CodexProcess,
    /// app-server JSON-RPC 客户端。
    pub client: AppServerJsonRpcClient,
    /// 当前 runtime 使用的 Codex Home。
    pub codex_home: PathBuf,
}

/// 避免命令层长时间持有 runtime 锁的轻量视图。
pub struct CodexRuntimeView {
    /// JSON-RPC 客户端。
    pub client: AppServerJsonRpcClient,
    /// Codex Home 路径。
    pub codex_home: PathBuf,
}

/// 创建 thread 的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartThreadRequest {
    /// thread 工作目录。
    pub cwd: String,
    /// 是否为临时内存 thread。
    pub ephemeral: Option<bool>,
}

/// 恢复 thread 的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeThreadRequest {
    /// Codex thread ID。
    pub thread_id: String,
    /// 恢复后继续使用的工作目录。
    pub cwd: Option<String>,
}

/// 查询 Codex 原生 thread 历史的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListThreadsRequest {
    /// 可选工作目录过滤。
    pub cwd: Option<String>,
    /// 分页大小。
    pub limit: Option<u32>,
}

/// 读取 Codex 原生 thread 的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadThreadRequest {
    /// Codex thread ID。
    pub thread_id: String,
    /// 是否读取 turn 和 item 历史。
    pub include_turns: Option<bool>,
}

/// 中断 Codex turn 的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptTurnRequest {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: String,
}

/// 压缩单个 Codex thread 上下文的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactThreadRequest {
    /// Codex thread ID。
    pub thread_id: String,
}

/// 设置单个 Codex thread 记忆模式的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMemoryModeRequest {
    /// Codex thread ID。
    pub thread_id: String,
    /// 目标记忆模式，仅支持 `enabled` 或 `disabled`。
    pub mode: String,
}

/// 添加插件市场的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMarketplaceRequest {
    /// 远程市场地址，支持 HTTP(S) Git、SSH Git 或 GitHub `owner/repo` 简写。
    pub source: String,
}

/// 移除插件市场的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveMarketplaceRequest {
    /// 要移除的市场名称。
    pub name: String,
}

/// 升级插件市场的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeMarketplaceRequest {
    /// 可选市场名称；为空时升级全部已配置市场。
    pub marketplace_name: Option<String>,
}

/// 读取或安装插件的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLookupRequest {
    /// 插件所属市场路径。
    pub marketplace_path: String,
    /// 插件目录名。
    pub plugin_name: String,
}

/// 卸载插件的前端请求。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallPluginRequest {
    /// 插件稳定 ID，格式为 `<plugin>@<marketplace>`。
    pub plugin_id: String,
}

/// 前端可直接消费的 Codex 原生 thread 历史记录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadRecord {
    /// Codex thread ID。
    pub id: String,
    /// thread 工作目录。
    pub cwd: String,
    /// 是否为临时内存 thread。
    pub ephemeral: bool,
    /// 用户可见标题。
    pub title: String,
    /// 预览文本。
    pub preview: String,
    /// 创建时间 Unix 秒。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    /// 更新时间 Unix 秒。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    /// app-server 原始状态。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<serde_json::Value>,
    /// app-server 原始 turn 历史，只有 read/resume 且包含历史时才有值。
    pub turns: Vec<serde_json::Value>,
}

/// Codex 原生 thread 历史列表响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadListResult {
    /// 当前页 thread 列表。
    pub data: Vec<CodexThreadRecord>,
    /// 下一页游标。
    pub next_cursor: Option<String>,
    /// 反向翻页游标。
    pub backwards_cursor: Option<String>,
}

/// 插件市场摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginMarketplace {
    /// 市场名称。
    pub name: String,
    /// 市场根目录或标识路径。
    pub path: String,
    /// 市场来源地址。
    pub source: String,
    /// 当前市场中插件数量。
    pub plugin_count: usize,
}

/// 插件技能摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginSkillSummary {
    /// skill 目录名。
    pub name: String,
    /// skill 简短说明。
    pub description: String,
    /// 当前是否启用。
    pub enabled: bool,
}

/// 插件 app 摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginAppSummary {
    /// app 或 connector 名称。
    pub name: String,
    /// 当前是否仍需认证。
    pub needs_auth: bool,
}

/// 前端展示用插件摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginSummary {
    /// 插件稳定 ID，优先使用 `<plugin>@<marketplace>`。
    pub id: String,
    /// UI 展示名称。
    pub name: String,
    /// 插件目录名。
    pub plugin_name: String,
    /// 所属市场名称。
    pub marketplace_name: String,
    /// 所属市场路径。
    pub marketplace_path: String,
    /// 用于 `turn/start` 的 mention 路径。
    pub mention_path: String,
    /// 插件说明。
    pub description: String,
    /// 插件分类。
    pub category: String,
    /// 当前可用性状态。
    pub availability: String,
    /// 是否已经安装到本地运行环境。
    pub installed: bool,
    /// 当前是否启用。
    pub enabled: bool,
}

/// 插件列表响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginListResult {
    /// 已发现的插件市场。
    pub marketplaces: Vec<CodexPluginMarketplace>,
    /// 当前可展示的插件列表。
    pub plugins: Vec<CodexPluginSummary>,
    /// 市场加载错误摘要。
    pub marketplace_load_errors: Vec<String>,
    /// 官方推荐插件 ID。
    pub featured_plugin_ids: Vec<String>,
}

/// 单个插件详情。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginDetails {
    /// 插件稳定 ID。
    pub id: String,
    /// UI 展示名称。
    pub name: String,
    /// 插件目录名。
    pub plugin_name: String,
    /// 所属市场名称。
    pub marketplace_name: String,
    /// 所属市场路径。
    pub marketplace_path: String,
    /// 用于 `turn/start` 的 mention 路径。
    pub mention_path: String,
    /// 插件说明。
    pub description: String,
    /// 插件分类。
    pub category: String,
    /// 当前可用性状态。
    pub availability: String,
    /// 是否已经安装。
    pub installed: bool,
    /// 是否已启用。
    pub enabled: bool,
    /// 插件摘要要点。
    pub summary: Vec<String>,
    /// 插件自带 skills。
    pub skills: Vec<CodexPluginSkillSummary>,
    /// 插件自带 hooks 名称。
    pub hooks: Vec<String>,
    /// 插件自带 apps 名称。
    pub apps: Vec<CodexPluginAppSummary>,
    /// 插件自带 MCP server 名称。
    pub mcp_servers: Vec<String>,
    /// 原始详情，便于调试协议兼容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

/// 插件和市场相关操作的统一结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexOperationResult {
    /// 操作结果摘要。
    pub message: String,
    /// 原始协议返回，便于前端调试展示。
    pub raw: Value,
}

/// 从 `plugin/list` 原始响应提取前端需要的稳定字段。
pub fn plugin_list_result_from_value(value: Value) -> CodexPluginListResult {
    let marketplace_records = array_field(&value, "marketplaces")
        .iter()
        .filter_map(as_object)
        .collect::<Vec<_>>();
    let marketplaces = marketplace_records
        .iter()
        .map(|marketplace| CodexPluginMarketplace {
            name: string_field(*marketplace, &["name", "id"])
                .unwrap_or_else(|| "未命名市场".to_string()),
            path: string_field(*marketplace, &["path", "root", "marketplacePath"])
                .unwrap_or_default(),
            source: string_field(*marketplace, &["source", "url", "repository"])
                .unwrap_or_default(),
            plugin_count: array_field(*marketplace, "plugins").len(),
        })
        .collect();
    let plugins = plugin_summaries_from_plugin_list_value(&value, &marketplace_records);
    let marketplace_load_errors = array_field(&value, "marketplaceLoadErrors")
        .iter()
        .map(flatten_text)
        .filter(|value| !value.is_empty())
        .collect();
    let featured_plugin_ids = array_field(&value, "featuredPluginIds")
        .iter()
        .map(flatten_text)
        .filter(|value| !value.is_empty())
        .collect();

    CodexPluginListResult {
        marketplaces,
        plugins,
        marketplace_load_errors,
        featured_plugin_ids,
    }
}

/// 从 `plugin/read` 原始响应提取详情字段。
pub fn plugin_details_from_value(value: Value) -> CodexPluginDetails {
    let plugin = as_object(&value)
        .and_then(|record| record.get("plugin"))
        .and_then(as_object)
        .cloned()
        .or_else(|| as_object(&value).cloned())
        .unwrap_or_default();
    let summary = array_field(&value, "summary")
        .iter()
        .map(flatten_text)
        .filter(|line| !line.is_empty())
        .collect();
    let skills = array_field(&plugin, "skills")
        .iter()
        .filter_map(as_object)
        .map(|skill| CodexPluginSkillSummary {
            name: string_field(skill, &["name"]).unwrap_or_default(),
            description: string_field(skill, &["description", "shortDescription"])
                .unwrap_or_default(),
            enabled: bool_field(skill, &["enabled"]).unwrap_or(false),
        })
        .collect();
    let hooks = array_field(&plugin, "hooks")
        .iter()
        .map(flatten_text)
        .filter(|value| !value.is_empty())
        .collect();
    let apps = array_field(&plugin, "apps")
        .iter()
        .filter_map(as_object)
        .map(|app| CodexPluginAppSummary {
            name: string_field(app, &["name", "id"]).unwrap_or_default(),
            needs_auth: bool_field(app, &["needsAuth"]).unwrap_or(false),
        })
        .collect();
    let mcp_servers = array_field(&plugin, "mcpServers")
        .iter()
        .map(flatten_text)
        .filter(|value| !value.is_empty())
        .collect();
    let plugin_summary = plugin_summary_from_object(&plugin);

    CodexPluginDetails {
        id: plugin_summary.id,
        name: plugin_summary.name,
        plugin_name: plugin_summary.plugin_name,
        marketplace_name: plugin_summary.marketplace_name,
        marketplace_path: plugin_summary.marketplace_path,
        mention_path: plugin_summary.mention_path,
        description: plugin_summary.description,
        category: plugin_summary.category,
        availability: plugin_summary.availability,
        installed: plugin_summary.installed,
        enabled: plugin_summary.enabled,
        summary,
        skills,
        hooks,
        apps,
        mcp_servers,
        raw: Some(value),
    }
}

/// 将插件或市场操作的原始结果压缩为界面摘要。
pub fn operation_result_from_value(default_message: &str, value: Value) -> CodexOperationResult {
    let message = as_object(&value)
        .map(|record| {
            string_field(record, &["message", "status"])
                .or_else(|| string_field(record, &["installedRoot"]))
                .or_else(|| string_field(record, &["upgradedRoots"]))
                .unwrap_or_else(|| default_message.to_string())
        })
        .unwrap_or_else(|| default_message.to_string());
    CodexOperationResult {
        message,
        raw: value,
    }
}

fn plugin_summary_from_object(plugin: &serde_json::Map<String, Value>) -> CodexPluginSummary {
    plugin_summary_from_object_with_context(
        plugin,
        string_field(plugin, &["marketplaceName"]),
        string_field(plugin, &["marketplacePath"]),
    )
}

/// 将单个插件对象按给定 marketplace 上下文转换为稳定摘要。
fn plugin_summary_from_object_with_context(
    plugin: &serde_json::Map<String, Value>,
    marketplace_name: Option<String>,
    marketplace_path: Option<String>,
) -> CodexPluginSummary {
    let interface = plugin.get("interface").and_then(as_object);
    let plugin_name = string_field(plugin, &["pluginName", "name", "id"]).unwrap_or_default();
    let marketplace_name = marketplace_name.unwrap_or_default();
    let marketplace_path = marketplace_path.unwrap_or_default();
    let id = string_field(plugin, &["pluginId", "id"])
        .unwrap_or_else(|| format!("{plugin_name}@{marketplace_name}"));
    let mention_path = format!("plugin://{plugin_name}@{marketplace_name}");
    CodexPluginSummary {
        id,
        name: interface
            .and_then(|record| string_field(record, &["displayName"]))
            .or_else(|| string_field(plugin, &["name", "pluginName"]))
            .unwrap_or_else(|| plugin_name.clone()),
        plugin_name: plugin_name.clone(),
        marketplace_name: marketplace_name.clone(),
        marketplace_path,
        mention_path,
        description: interface
            .and_then(|record| string_field(record, &["shortDescription"]))
            .or_else(|| string_field(plugin, &["description"]))
            .unwrap_or_default(),
        category: interface
            .and_then(|record| string_field(record, &["category"]))
            .unwrap_or_default(),
        availability: string_field(plugin, &["availability"])
            .unwrap_or_else(|| "AVAILABLE".to_string()),
        installed: bool_field(plugin, &["installed"]).unwrap_or(false),
        enabled: bool_field(plugin, &["enabled", "isEnabled"]).unwrap_or(false),
    }
}

/// 兼容 `plugin/list` 的两种返回结构：
/// 1. 顶层直接给出 `plugins[]`
/// 2. 仅在 `marketplaces[].plugins[]` 中返回插件，并由 marketplace 提供上下文
pub(crate) fn plugin_summaries_from_plugin_list_value(
    value: &Value,
    marketplace_records: &[&serde_json::Map<String, Value>],
) -> Vec<CodexPluginSummary> {
    let top_level_plugins = array_field(value, "plugins")
        .iter()
        .filter_map(as_object)
        .map(plugin_summary_from_object)
        .collect::<Vec<_>>();
    if !top_level_plugins.is_empty() {
        return top_level_plugins;
    }

    marketplace_records
        .iter()
        .flat_map(|marketplace| {
            let marketplace_name = string_field(*marketplace, &["name", "id"]);
            let marketplace_path = string_field(*marketplace, &["path", "root", "marketplacePath"]);
            array_field(*marketplace, "plugins")
                .iter()
                .filter_map(as_object)
                .map(move |plugin| {
                    plugin_summary_from_object_with_context(
                        plugin,
                        marketplace_name.clone(),
                        marketplace_path.clone(),
                    )
                })
        })
        .collect()
}

fn array_field<'a>(value: &'a impl ValueAccess, key: &str) -> &'a [Value] {
    value
        .get_value(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn string_field(value: &impl ValueAccess, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get_value(key))
        .map(flatten_text)
        .filter(|text| !text.is_empty())
}

fn bool_field(value: &impl ValueAccess, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| {
        let raw = value.get_value(key)?;
        match raw {
            Value::Bool(value) => Some(*value),
            Value::String(value) if value.eq_ignore_ascii_case("true") => Some(true),
            Value::String(value) if value.eq_ignore_ascii_case("false") => Some(false),
            _ => None,
        }
    })
}

fn flatten_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.trim().to_string(),
        Value::Array(items) => items
            .iter()
            .map(flatten_text)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("，"),
        Value::Object(record) => {
            string_field(record, &["message", "text", "name", "id", "key"]).unwrap_or_default()
        }
    }
}

fn as_object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

trait ValueAccess {
    fn get_value(&self, key: &str) -> Option<&Value>;
}

impl ValueAccess for Value {
    fn get_value(&self, key: &str) -> Option<&Value> {
        self.as_object()?.get(key)
    }
}

impl ValueAccess for serde_json::Map<String, Value> {
    fn get_value(&self, key: &str) -> Option<&Value> {
        self.get(key)
    }
}

pub(crate) type AppStateRef<'a> = State<'a, AppState>;
