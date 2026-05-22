use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// app-server thread 记忆模式。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThreadMemoryMode {
    /// 允许当前 thread 继续参与 Codex memory 生成。
    Enabled,
    /// 禁止当前 thread 继续参与 Codex memory 生成。
    Disabled,
}

/// `thread/start` 返回的最小信息。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartResponse {
    /// app-server thread 对象。
    pub thread: ThreadSummary,
}

/// `thread/resume` 返回的最小信息。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeResponse {
    /// app-server thread 对象。
    pub thread: ThreadSummary,
}

/// `thread/list` 返回的最小信息。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResponse {
    /// 当前页 thread 列表。
    pub data: Vec<ThreadSummary>,
    /// 下一页游标。
    pub next_cursor: Option<String>,
    /// 反向翻页游标。
    pub backwards_cursor: Option<String>,
}

/// `thread/read` 返回的最小信息。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadResponse {
    /// app-server thread 对象。
    pub thread: ThreadSummary,
}

/// app-server thread 最小摘要。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    /// Codex thread ID。
    pub id: String,
    /// 工作目录。
    pub cwd: PathBuf,
    /// 是否临时会话。
    #[serde(default)]
    pub ephemeral: bool,
    /// thread 预览文本，通常来自首条用户消息。
    #[serde(default)]
    pub preview: Option<String>,
    /// 用户可见 thread 名称。
    #[serde(default)]
    pub name: Option<String>,
    /// 创建时间 Unix 秒。
    #[serde(default)]
    pub created_at: Option<i64>,
    /// 更新时间 Unix 秒。
    #[serde(default)]
    pub updated_at: Option<i64>,
    /// thread 当前运行状态，由 app-server 原样返回。
    #[serde(default)]
    pub status: Option<Value>,
    /// `thread/read` 或 `thread/resume` 可携带的 turn 历史。
    #[serde(default)]
    pub turns: Vec<Value>,
}

/// `turn/start` 返回的最小信息。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartResponse {
    /// app-server turn 对象。
    pub turn: TurnSummary,
}

/// app-server turn 完成后可供外部桥接方消费的最终输出。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTurnOutput {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: String,
    /// 最终 assistant 文本，只包含可发给用户的 final answer。
    pub text: String,
    /// turn 结束状态。
    pub status: Option<String>,
    /// token 用量，字段结构由 app-server 版本决定。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<Value>,
}

/// app-server turn 最小摘要。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSummary {
    /// Codex turn ID。
    pub id: String,
    /// turn 状态。
    pub status: Option<String>,
}

/// 律师任务启动请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLegalTurnRequest {
    /// Codex thread ID。
    pub thread_id: String,
    /// 本次任务工作目录。
    pub cwd: String,
    /// 用户原始任务说明。
    pub user_prompt: String,
    /// 结构化附件输入，统一交给 Rust 桥接层转换为 app-server UserInput。
    #[serde(default)]
    pub attachments: Vec<StartLegalTurnAttachment>,
    /// 隐藏传给 Codex 的开发者级目录上下文。
    #[serde(default)]
    pub developer_instructions: Option<String>,
    /// 要显式注入的 skill 名称；为空时按通用对话发送。
    #[serde(default)]
    pub skill_name: Option<String>,
    /// 要显式注入的插件 mention；为空时按普通问题发送。
    #[serde(default)]
    pub plugin_mentions: Vec<StartLegalTurnPluginMention>,
}

/// 律师任务附件输入。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartLegalTurnAttachment {
    /// 附件运行时标识。
    #[serde(default)]
    pub id: String,
    /// 附件文件名。
    pub name: String,
    /// 归一化附件类型，例如 image/document/file。
    #[serde(default)]
    pub kind: String,
    /// 附件来源入口，例如 composer/wechat。
    #[serde(default)]
    pub source: String,
    /// MIME 类型。
    #[serde(default)]
    pub mime_type: String,
    /// 文件大小，单位字节。
    #[serde(default)]
    pub size: Option<u64>,
    /// 已存在的本机绝对路径。
    #[serde(default)]
    pub path: Option<String>,
    /// 已存在的远程 URL。
    #[serde(default)]
    pub url: Option<String>,
    /// 浏览器直接上传时附带的原始字节。
    #[serde(default)]
    pub bytes: Option<Vec<u8>>,
    /// 外部入口已准备好的 base64 字节串。
    #[serde(default)]
    pub data_base64: Option<String>,
}

/// `turn/start` 输入中的插件 mention。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLegalTurnPluginMention {
    /// UI 展示名称。
    pub name: String,
    /// app-server 需要的稳定插件路径，格式为 `plugin://<plugin>@<marketplace>`。
    pub path: String,
}
