use serde_json::Value;

use crate::event_normalizer::{ToolCallInfo, TurnInfo};

pub(super) fn is_tool_item(params: &Value) -> bool {
    let item = params.get("item").unwrap_or(params);
    matches!(
        text_field(item, "type").as_deref(),
        Some(
            "commandExecution"
                | "fileChange"
                | "mcpToolCall"
                | "dynamicToolCall"
                | "collabAgentToolCall"
                | "webSearch"
                | "imageView"
                | "imageGeneration"
                | "contextCompaction"
        )
    )
}

pub(super) fn is_agent_message_item(params: &Value) -> bool {
    let item = params.get("item").unwrap_or(params);
    matches!(text_field(item, "type").as_deref(), Some("agentMessage"))
}

pub(super) fn is_reasoning_item(params: &Value) -> bool {
    let item = params.get("item").unwrap_or(params);
    matches!(text_field(item, "type").as_deref(), Some("reasoning"))
}

pub(super) fn agent_message_phase(params: &Value) -> Option<String> {
    let item = params.get("item").unwrap_or(params);
    text_field(item, "phase").or_else(|| text_field(params, "phase"))
}

pub(super) fn is_final_answer_item(params: &Value) -> bool {
    matches!(agent_message_phase(params).as_deref(), Some("final_answer"))
}

pub(super) fn is_commentary_item(params: &Value) -> bool {
    matches!(agent_message_phase(params).as_deref(), Some("commentary"))
}

pub(super) fn turn_info_from_params(params: &Value) -> TurnInfo {
    let turn = params.get("turn").unwrap_or(params);
    TurnInfo {
        id: text_field(turn, "id").unwrap_or_default(),
        thread_id: text_field(params, "threadId")
            .or_else(|| text_field(turn, "threadId"))
            .unwrap_or_default(),
        status: text_field(turn, "status"),
        token_usage: params
            .get("tokenUsage")
            .cloned()
            .or_else(|| turn.get("tokenUsage").cloned()),
    }
}

pub(super) fn tool_info_from_params(params: &Value) -> ToolCallInfo {
    let item = params.get("item").unwrap_or(params);
    let kind = text_field(item, "type").unwrap_or_else(|| "unknown".to_string());
    let command = text_field(item, "command");
    let tool_name = text_field(item, "toolName").or_else(|| text_field(item, "tool_name"));
    let title = if kind == "contextCompaction" {
        "压缩上下文".to_string()
    } else if kind == "mcpToolCall" {
        tool_name
            .as_ref()
            .map(|value| format!("调用工具：{value}工具"))
            .unwrap_or_else(|| "调用工具".to_string())
    } else {
        command
            .as_ref()
            .map(|value| format!("执行命令：{value}"))
            .unwrap_or_else(|| format!("小隐工具：{kind}"))
    };
    ToolCallInfo {
        thread_id: text_field(params, "threadId").unwrap_or_default(),
        turn_id: text_field(params, "turnId").unwrap_or_default(),
        item_id: text_field(item, "id"),
        title,
        command,
        path: text_field(item, "path").or_else(|| text_field(item, "cwd")),
        kind,
    }
}

pub(super) fn text_field(value: &Value, camel_name: &str) -> Option<String> {
    let snake_name = camel_to_snake(camel_name);
    value
        .get(camel_name)
        .or_else(|| value.get(snake_name.as_str()))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(super) fn number_field(value: &Value, camel_name: &str) -> Option<u64> {
    let snake_name = camel_to_snake(camel_name);
    value
        .get(camel_name)
        .or_else(|| value.get(snake_name.as_str()))
        .and_then(Value::as_u64)
}

pub(super) fn extract_output_preview(item: &Value) -> Option<String> {
    ["output", "text", "content", "delta"]
        .iter()
        .find_map(|name| text_field(item, name))
        .map(|text| text.chars().take(600).collect())
}

pub(super) fn extract_reasoning_text(item: &Value) -> Option<String> {
    text_field(item, "text")
        .or_else(|| text_field(item, "content"))
        .or_else(|| extract_reasoning_array_text(item.get("summary")))
        .or_else(|| extract_reasoning_array_text(item.get("content")))
        .map(|text| text.chars().take(2000).collect())
}

fn extract_reasoning_array_text(value: Option<&Value>) -> Option<String> {
    let items = value?.as_array()?;
    let texts: Vec<String> = items
        .iter()
        .filter_map(extract_reasoning_value_text)
        .filter(|text| !text.trim().is_empty())
        .collect();
    if texts.is_empty() {
        None
    } else {
        Some(texts.join("\n\n"))
    }
}

fn extract_reasoning_value_text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| text_field(value, "text"))
        .or_else(|| {
            value.get("content").and_then(|content| {
                content.as_array().map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| {
                            part.as_str()
                                .map(str::to_string)
                                .or_else(|| text_field(part, "text"))
                        })
                        .collect::<Vec<String>>()
                        .join("\n")
                })
            })
        })
        .filter(|text| !text.trim().is_empty())
}

fn camel_to_snake(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_uppercase() {
            output.push('_');
            output.extend(character.to_lowercase());
        } else {
            output.push(character);
        }
    }
    output
}
