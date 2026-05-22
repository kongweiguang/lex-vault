use serde_json::Value;

use crate::event_normalizer::{
    helpers::{
        agent_message_phase, extract_output_preview, extract_reasoning_text, is_agent_message_item,
        is_commentary_item, is_final_answer_item, is_reasoning_item, is_tool_item, number_field,
        text_field, tool_info_from_params, turn_info_from_params,
    },
    ApprovalRequest, CodexUiEvent, ProcessDeltaInfo, RiskLevel, ThreadInfo, ToolCallDeltaInfo,
    ToolCallResult,
};
use crate::jsonrpc::AppError;

const MCP_ELICITATION_REQUEST_METHOD: &str = "mcpServer/elicitation/request";
const MCP_TOOL_CALL_APPROVAL_KIND: &str = "mcp_tool_call";
const MCP_APPROVAL_KIND_KEY: &str = "codex_approval_kind";
const MCP_APPROVAL_PERSIST_KEY: &str = "persist";
const MCP_TOOL_NAME_KEY: &str = "tool_name";
const MCP_TOOL_TITLE_KEY: &str = "tool_title";
const MCP_TOOL_DESCRIPTION_KEY: &str = "tool_description";

/// Codex 原始 notification 归一化器。
pub struct EventNormalizer;

impl EventNormalizer {
    /// 将 app-server method + params 转为前端稳定事件。
    pub fn normalize(method: &str, params: Value) -> CodexUiEvent {
        match method {
            "thread/started" => normalize_thread_started(params),
            "turn/started" => normalize_turn_started(params),
            "item/agentMessage/delta" => normalize_agent_delta(params),
            "item/reasoning/summaryTextDelta"
            | "item/reasoning/summaryPartAdded"
            | "item/reasoning/textDelta" => normalize_reasoning_delta(method, params),
            "item/commandExecution/outputDelta" => normalize_command_output_delta(params),
            "item/started" => normalize_item_started(params),
            "item/completed" => normalize_item_completed(params),
            "turn/completed" => normalize_turn_completed(params),
            "turn/failed" => normalize_turn_failed(params),
            "error" => normalize_runtime_error(params),
            "warning" => normalize_warning(params),
            _ => CodexUiEvent::Warning {
                message: format!("收到未识别的 app-server notification: {method}"),
            },
        }
    }
}

fn normalize_thread_started(params: Value) -> CodexUiEvent {
    let thread = params.get("thread").unwrap_or(&params);
    CodexUiEvent::ThreadStarted {
        thread: ThreadInfo {
            id: text_field(thread, "id").unwrap_or_default(),
            cwd: text_field(thread, "cwd").unwrap_or_default(),
            ephemeral: thread
                .get("ephemeral")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        },
    }
}

fn normalize_turn_started(params: Value) -> CodexUiEvent {
    CodexUiEvent::TurnStarted {
        turn: turn_info_from_params(&params),
    }
}

fn normalize_agent_delta(params: Value) -> CodexUiEvent {
    let thread_id = text_field(&params, "threadId").unwrap_or_default();
    let turn_id = text_field(&params, "turnId");
    let text = text_field(&params, "delta").unwrap_or_default();
    let item = params.get("item").unwrap_or(&params);
    let phase = agent_message_phase(&params);

    if matches!(phase.as_deref(), Some("commentary")) {
        return CodexUiEvent::AssistantProcessDelta {
            item: ProcessDeltaInfo {
                thread_id,
                turn_id,
                item_id: text_field(item, "id").or_else(|| text_field(&params, "itemId")),
                segment_key: None,
                kind: "commentary".to_string(),
                text,
                promotable_answer: false,
                snapshot: false,
            },
        };
    }

    CodexUiEvent::AssistantDelta {
        thread_id,
        turn_id,
        item_id: text_field(item, "id").or_else(|| text_field(&params, "itemId")),
        text,
    }
}

fn normalize_item_started(params: Value) -> CodexUiEvent {
    if !is_tool_item(&params) {
        return CodexUiEvent::Warning {
            message: "忽略 Codex 非工具生命周期 item/started 事件".to_string(),
        };
    }

    CodexUiEvent::ToolStarted {
        item: tool_info_from_params(&params),
    }
}

fn normalize_item_completed(params: Value) -> CodexUiEvent {
    let item = params.get("item").unwrap_or(&params);
    if is_agent_message_item(&params) {
        if is_final_answer_item(&params) {
            return CodexUiEvent::AssistantMessageCompleted {
                thread_id: text_field(&params, "threadId").unwrap_or_default(),
                turn_id: text_field(&params, "turnId"),
                item_id: text_field(item, "id").or_else(|| text_field(&params, "itemId")),
                text: text_field(item, "text"),
            };
        }
        if is_commentary_item(&params) {
            return CodexUiEvent::AssistantProcessDelta {
                item: ProcessDeltaInfo {
                    thread_id: text_field(&params, "threadId").unwrap_or_default(),
                    turn_id: text_field(&params, "turnId"),
                    item_id: text_field(item, "id"),
                    segment_key: None,
                    kind: "commentary".to_string(),
                    text: text_field(item, "text").unwrap_or_default(),
                    promotable_answer: false,
                    snapshot: true,
                },
            };
        }
        return CodexUiEvent::AssistantMessageCompleted {
            thread_id: text_field(&params, "threadId").unwrap_or_default(),
            turn_id: text_field(&params, "turnId"),
            item_id: text_field(item, "id").or_else(|| text_field(&params, "itemId")),
            text: text_field(item, "text"),
        };
    }

    if is_reasoning_item(&params) {
        return CodexUiEvent::AssistantProcessDelta {
            item: ProcessDeltaInfo {
                thread_id: text_field(&params, "threadId").unwrap_or_default(),
                turn_id: text_field(&params, "turnId"),
                item_id: text_field(item, "id"),
                segment_key: reasoning_segment_key(&params),
                kind: "reasoning".to_string(),
                text: extract_reasoning_text(item).unwrap_or_default(),
                promotable_answer: false,
                snapshot: true,
            },
        };
    }

    if !is_tool_item(&params) {
        return CodexUiEvent::Warning {
            message: "忽略 Codex 非工具生命周期 item/completed 事件".to_string(),
        };
    }

    CodexUiEvent::ToolCompleted {
        item: ToolCallResult {
            thread_id: text_field(&params, "threadId").unwrap_or_default(),
            turn_id: text_field(&params, "turnId").unwrap_or_default(),
            item_id: text_field(item, "id"),
            kind: text_field(item, "type").unwrap_or_else(|| "unknown".to_string()),
            status: text_field(item, "status"),
            output_preview: extract_output_preview(item),
        },
    }
}

fn normalize_reasoning_delta(method: &str, params: Value) -> CodexUiEvent {
    let item = params.get("item").unwrap_or(&params);
    let text = match method {
        "item/reasoning/summaryPartAdded" => String::new(),
        _ => text_field(&params, "delta")
            .or_else(|| text_field(&params, "text"))
            .unwrap_or_else(|| format!("收到未识别的 reasoning 增量事件：{method}")),
    };
    CodexUiEvent::AssistantProcessDelta {
        item: ProcessDeltaInfo {
            thread_id: text_field(&params, "threadId").unwrap_or_default(),
            turn_id: text_field(&params, "turnId"),
            item_id: text_field(item, "id"),
            segment_key: reasoning_segment_key(&params),
            kind: "reasoning".to_string(),
            text,
            promotable_answer: false,
            snapshot: false,
        },
    }
}

fn normalize_command_output_delta(params: Value) -> CodexUiEvent {
    CodexUiEvent::ToolDelta {
        item: ToolCallDeltaInfo {
            thread_id: text_field(&params, "threadId").unwrap_or_default(),
            turn_id: text_field(&params, "turnId").unwrap_or_default(),
            item_id: text_field(&params, "itemId"),
            kind: "commandExecution".to_string(),
            delta: text_field(&params, "delta").unwrap_or_default(),
        },
    }
}

fn reasoning_segment_key(params: &Value) -> Option<String> {
    number_field(params, "summaryIndex")
        .map(|index| format!("summary:{index}"))
        .or_else(|| number_field(params, "contentIndex").map(|index| format!("content:{index}")))
}

fn normalize_turn_completed(params: Value) -> CodexUiEvent {
    CodexUiEvent::TurnCompleted {
        turn: turn_info_from_params(&params),
    }
}

fn normalize_turn_failed(params: Value) -> CodexUiEvent {
    CodexUiEvent::TurnFailed {
        error: AppError::new(
            "TURN_START_FAILED",
            "Codex turn 执行失败",
            params
                .get("error")
                .and_then(|value| text_field(value, "message"))
                .unwrap_or_else(|| "app-server 返回 turn/failed".to_string()),
            true,
        )
        .with_details(params),
    }
}

fn normalize_runtime_error(params: Value) -> CodexUiEvent {
    let message = params
        .get("error")
        .and_then(|value| text_field(value, "message"))
        .unwrap_or_else(|| "Codex runtime 返回错误事件".to_string());
    let retrying = params
        .get("willRetry")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if retrying {
        CodexUiEvent::Warning {
            message: format!("Codex 正在重连模型通道：{message}"),
        }
    } else {
        CodexUiEvent::TurnFailed {
            error: AppError::new("TURN_RUNTIME_ERROR", "Codex turn 执行出错", message, true)
                .with_details(params),
        }
    }
}

fn normalize_warning(params: Value) -> CodexUiEvent {
    CodexUiEvent::Warning {
        message: text_field(&params, "message")
            .unwrap_or_else(|| "Codex runtime 返回警告事件".to_string()),
    }
}

/// 将 app-server 主动审批 request 转成 UI 事件。
pub fn normalize_approval_request(
    request_id: String,
    method: &str,
    params: Value,
) -> ApprovalRequest {
    if method == MCP_ELICITATION_REQUEST_METHOD {
        return normalize_mcp_elicitation_approval_request(request_id, params);
    }

    let operation_type = match method {
        "item/commandExecution/requestApproval" => "command_execution",
        "item/fileChange/requestApproval" => "file_change",
        "item/permissions/requestApproval" => "permissions",
        _ => "unknown",
    }
    .to_string();
    let command = text_field(&params, "command");
    let paths = params
        .get("grantRoot")
        .and_then(Value::as_str)
        .map(|path| vec![path.to_string()])
        .unwrap_or_default();

    ApprovalRequest {
        id: request_id,
        thread_id: text_field(&params, "threadId").unwrap_or_default(),
        operation_type,
        title: command
            .as_ref()
            .map(|value| format!("执行命令：{value}"))
            .unwrap_or_else(|| "Codex 请求审批".to_string()),
        command,
        tool_name: text_field(&params, "toolName"),
        paths,
        risk_level: RiskLevel::High,
        reason: text_field(&params, "reason"),
        raw: params,
    }
}

fn normalize_mcp_elicitation_approval_request(
    request_id: String,
    params: Value,
) -> ApprovalRequest {
    let thread_id = text_field(&params, "threadId").unwrap_or_default();
    let server_name = text_field(&params, "serverName").unwrap_or_else(|| "MCP server".to_string());
    let request = params.get("request").unwrap_or(&params);
    let meta = request
        .get("_meta")
        .or_else(|| request.get("meta"))
        .and_then(Value::as_object);
    let approval_kind = meta
        .and_then(|value| value.get(MCP_APPROVAL_KIND_KEY))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let message = text_field(request, "message");
    let tool_name = meta
        .and_then(|value| value.get(MCP_TOOL_NAME_KEY))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| extract_tool_name_from_message(message.as_deref()));
    let tool_title = meta
        .and_then(|value| value.get(MCP_TOOL_TITLE_KEY))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let tool_description = meta
        .and_then(|value| value.get(MCP_TOOL_DESCRIPTION_KEY))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let persist_hint = meta
        .and_then(|value| value.get(MCP_APPROVAL_PERSIST_KEY))
        .map(format_persist_hint)
        .filter(|value| !value.is_empty());
    let title_target = tool_title
        .clone()
        .or_else(|| tool_name.clone())
        .unwrap_or_else(|| server_name.clone());
    let operation_type = if approval_kind == MCP_TOOL_CALL_APPROVAL_KIND {
        "mcp_tool_call"
    } else {
        "mcp_elicitation"
    }
    .to_string();
    let title = if approval_kind == MCP_TOOL_CALL_APPROVAL_KIND {
        format!("允许调用 MCP 工具：{title_target}")
    } else {
        format!("允许 {server_name} 请求操作")
    };
    let reason = build_mcp_approval_reason(
        &server_name,
        tool_name.as_deref(),
        tool_description.as_deref(),
        message.as_deref(),
        persist_hint.as_deref(),
    );

    ApprovalRequest {
        id: request_id,
        thread_id,
        operation_type,
        title,
        command: None,
        tool_name: tool_title.or(tool_name),
        paths: Vec::new(),
        risk_level: RiskLevel::High,
        reason,
        raw: params,
    }
}

fn build_mcp_approval_reason(
    server_name: &str,
    tool_name: Option<&str>,
    tool_description: Option<&str>,
    message: Option<&str>,
    persist_hint: Option<&str>,
) -> Option<String> {
    let mut lines = Vec::new();
    if let Some(tool_name) = tool_name.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("将调用 {server_name} 的 {tool_name} 工具。"));
    } else {
        lines.push(format!("将调用 {server_name} 提供的 MCP 工具。"));
    }
    if let Some(tool_description) = tool_description {
        lines.push(tool_description.to_string());
    } else if let Some(message) = message.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(message.to_string());
    }
    if let Some(persist_hint) = persist_hint {
        lines.push(persist_hint.to_string());
    }
    (!lines.is_empty()).then_some(lines.join(" "))
}

fn extract_tool_name_from_message(message: Option<&str>) -> Option<String> {
    let message = message?.trim();
    if message.is_empty() {
        return None;
    }
    let marker = "run tool \"";
    let start = message.find(marker)?;
    let after_marker = &message[start + marker.len()..];
    let end = after_marker.find('"')?;
    let tool_name = after_marker[..end].trim();
    (!tool_name.is_empty()).then_some(tool_name.to_string())
}

fn format_persist_hint(value: &Value) -> String {
    match value {
        Value::String(mode) if mode == "session" => "当前协议支持按会话记住这次授权。".to_string(),
        Value::String(mode) if mode == "always" => {
            "当前协议支持把这次授权记为长期允许。".to_string()
        }
        Value::Array(modes) => {
            let supports_session = modes.iter().any(|mode| mode.as_str() == Some("session"));
            let supports_always = modes.iter().any(|mode| mode.as_str() == Some("always"));
            match (supports_session, supports_always) {
                (true, true) => "当前协议支持按会话或长期记住这次授权。".to_string(),
                (true, false) => "当前协议支持按会话记住这次授权。".to_string(),
                (false, true) => "当前协议支持把这次授权记为长期允许。".to_string(),
                (false, false) => String::new(),
            }
        }
        _ => String::new(),
    }
}
