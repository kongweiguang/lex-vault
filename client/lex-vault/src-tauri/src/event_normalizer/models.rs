use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::jsonrpc::AppError;

/// Codex runtime 向前端广播的稳定事件。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CodexUiEvent {
    /// runtime 已启动且完成 initialize 握手。
    RuntimeStarted,
    /// runtime 已停止。
    RuntimeStopped,
    /// runtime 启动、初始化或后台读取失败。
    RuntimeFailed {
        /// 统一错误信息。
        error: AppError,
    },
    /// thread 已创建或恢复。
    ThreadStarted {
        /// thread 摘要信息。
        thread: ThreadInfo,
    },
    /// 外部入口已更新某个 thread 历史，前端应刷新对应历史列表。
    ThreadHistoryUpdated {
        /// Codex thread ID。
        thread_id: String,
        /// thread 工作目录。
        cwd: String,
    },
    /// turn 已进入运行态。
    TurnStarted {
        /// turn 摘要信息。
        turn: TurnInfo,
    },
    /// assistant 文本流式增量。
    AssistantDelta {
        /// Codex thread ID。
        thread_id: String,
        /// Codex turn ID。
        turn_id: Option<String>,
        /// Codex agentMessage item ID。
        item_id: Option<String>,
        /// 文本增量。
        text: String,
    },
    /// assistant 处理过程文本增量，例如 reasoning 或 commentary。
    AssistantProcessDelta {
        /// 过程文本摘要。
        item: ProcessDeltaInfo,
    },
    /// assistant 单条消息完成。
    AssistantMessageCompleted {
        /// Codex thread ID。
        thread_id: String,
        /// Codex turn ID。
        turn_id: Option<String>,
        /// Codex agentMessage item ID。
        item_id: Option<String>,
        /// 可选完整文本。
        text: Option<String>,
    },
    /// 工具或命令开始执行。
    ToolStarted {
        /// 工具调用摘要。
        item: ToolCallInfo,
    },
    /// 工具或命令运行中的增量输出。
    ToolDelta {
        /// 工具输出增量摘要。
        item: ToolCallDeltaInfo,
    },
    /// 工具或命令完成执行。
    ToolCompleted {
        /// 工具调用结果摘要。
        item: ToolCallResult,
    },
    /// app-server 需要用户审批。
    ApprovalRequired {
        /// 审批请求信息。
        request: ApprovalRequest,
    },
    /// 用户审批已经回传给 app-server。
    ApprovalCompleted {
        /// 审批请求 ID。
        request_id: String,
        /// 用户选择的审批结论。
        decision: ApprovalDecisionKind,
    },
    /// turn 已完成。
    TurnCompleted {
        /// turn 摘要信息。
        turn: TurnInfo,
    },
    /// turn 执行失败。
    TurnFailed {
        /// 统一错误信息。
        error: AppError,
    },
    /// 兼容性警告或未识别事件。
    Warning {
        /// 警告文本。
        message: String,
    },
}

/// 前端可持久展示的 thread 摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    /// Codex thread ID。
    pub id: String,
    /// thread 工作目录。
    pub cwd: String,
    /// thread 是否为临时内存会话。
    pub ephemeral: bool,
}

/// 前端可持久展示的 turn 摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInfo {
    /// Codex turn ID。
    pub id: String,
    /// Codex thread ID。
    pub thread_id: String,
    /// turn 当前状态。
    pub status: Option<String>,
    /// token 用量，字段结构由 app-server 版本决定。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<Value>,
}

/// 工具调用开始信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallInfo {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: String,
    /// item ID。
    pub item_id: Option<String>,
    /// item 类型。
    pub kind: String,
    /// UI 展示标题。
    pub title: String,
    /// 命令行内容。
    pub command: Option<String>,
    /// 相关路径。
    pub path: Option<String>,
}

/// 工具调用完成信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallResult {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: String,
    /// item ID。
    pub item_id: Option<String>,
    /// item 类型。
    pub kind: String,
    /// item 完成状态。
    pub status: Option<String>,
    /// 输出预览，避免前端和审计日志承载过大的原始内容。
    pub output_preview: Option<String>,
}

/// 工具调用增量输出信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallDeltaInfo {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: String,
    /// item ID。
    pub item_id: Option<String>,
    /// item 类型。
    pub kind: String,
    /// 本次输出增量。
    pub delta: String,
}

/// 处理过程文本信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDeltaInfo {
    /// Codex thread ID。
    pub thread_id: String,
    /// Codex turn ID。
    pub turn_id: Option<String>,
    /// Codex item ID，用于把同一段 commentary/reasoning 的增量与完成快照合并到同一个过程块。
    pub item_id: Option<String>,
    /// reasoning 分段键，来自 summaryIndex/contentIndex，避免不同分段被错误合并。
    pub segment_key: Option<String>,
    /// 过程来源类型。
    pub kind: String,
    /// 过程文本。
    pub text: String,
    /// 是否允许 turn 完成时把这段过程文本提升为最终回答。
    pub promotable_answer: bool,
    /// 是否是 item/completed 带回来的完整快照；true 时前端应替换同 item 的已有增量。
    pub snapshot: bool,
}

/// 审批请求信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    /// 前端回传审批时使用的请求 ID。
    pub id: String,
    /// Codex thread ID。
    pub thread_id: String,
    /// 操作类型。
    pub operation_type: String,
    /// UI 展示标题。
    pub title: String,
    /// 命令行内容。
    pub command: Option<String>,
    /// 工具名称。
    pub tool_name: Option<String>,
    /// 相关路径列表。
    pub paths: Vec<String>,
    /// 风险等级。
    pub risk_level: RiskLevel,
    /// app-server 给出的原因。
    pub reason: Option<String>,
    /// 原始审批参数，便于前端调试和后续兼容。
    pub raw: Value,
}

/// 审批风险等级。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// 低风险。
    Low,
    /// 中风险。
    Medium,
    /// 高风险。
    High,
    /// 严重风险。
    Critical,
}

/// 审批决策请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionRequest {
    /// 审批请求 ID。
    pub request_id: String,
    /// 用户选择的审批结论。
    pub decision: ApprovalDecisionKind,
    /// 可选原因。
    pub reason: Option<String>,
}

/// 审批决策类型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecisionKind {
    /// 仅允许本次操作。
    AllowOnce,
    /// 允许当前 turn 中同类操作。
    AllowForTurn,
    /// 拒绝操作。
    Deny,
}
