//! event_normalizer 模块回归测试。
//!
//! @author kongweiguang

use serde_json::json;

use super::{normalize_approval_request, CodexUiEvent, EventNormalizer};

#[test]
fn normalizes_agent_message_delta() {
    let event = EventNormalizer::normalize(
        "item/agentMessage/delta",
        json!({"threadId":"thr_1","turnId":"turn_1","itemId":"msg_1","delta":"你好","item":{"id":"msg_1","type":"agentMessage","phase":"final_answer"}}),
    );

    match event {
        CodexUiEvent::AssistantDelta {
            thread_id,
            turn_id,
            item_id,
            text,
        } => {
            assert_eq!(thread_id, "thr_1");
            assert_eq!(turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item_id.as_deref(), Some("msg_1"));
            assert_eq!(text, "你好");
        }
        _ => panic!("unexpected event"),
    }
}

#[test]
fn agent_message_delta_without_phase_becomes_final_delta() {
    let event = EventNormalizer::normalize(
        "item/agentMessage/delta",
        json!({"threadId":"thr_1","turnId":"turn_1","itemId":"msg_1b","delta":"正文","item":{"id":"msg_1b","type":"agentMessage"}}),
    );

    match event {
        CodexUiEvent::AssistantDelta {
            thread_id,
            turn_id,
            item_id,
            text,
        } => {
            assert_eq!(thread_id, "thr_1");
            assert_eq!(turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item_id.as_deref(), Some("msg_1b"));
            assert_eq!(text, "正文");
        }
        _ => panic!("phase 缺失的 agentMessage delta 应直接写入正文"),
    }
}

#[test]
fn commentary_agent_message_delta_becomes_process_delta() {
    let event = EventNormalizer::normalize(
        "item/agentMessage/delta",
        json!({
            "threadId":"thr_1",
            "turnId":"turn_1",
            "delta":"先整理历史结构",
            "item": {
                "id": "msg_delta_1",
                "type": "agentMessage",
                "phase": "commentary"
            }
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.item_id.as_deref(), Some("msg_delta_1"));
            assert_eq!(item.segment_key, None);
            assert_eq!(item.kind, "commentary");
            assert_eq!(item.text, "先整理历史结构");
            assert!(!item.promotable_answer);
            assert!(!item.snapshot);
        }
        _ => panic!("commentary delta should become process delta"),
    }
}

#[test]
fn top_level_commentary_phase_delta_becomes_process_delta() {
    let event = EventNormalizer::normalize(
        "item/agentMessage/delta",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "itemId": "msg_delta_2",
            "phase": "commentary",
            "delta": "先读取材料"
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.item_id.as_deref(), Some("msg_delta_2"));
            assert_eq!(item.kind, "commentary");
            assert_eq!(item.text, "先读取材料");
        }
        _ => panic!("顶层 phase=commentary 的 agentMessage delta 应进入过程区"),
    }
}

#[test]
fn unknown_notification_becomes_warning() {
    let event = EventNormalizer::normalize("future/event", json!({}));

    match event {
        CodexUiEvent::Warning { message } => {
            assert!(message.contains("future/event"));
        }
        _ => panic!("unexpected event"),
    }
}

#[test]
fn user_message_item_started_is_not_a_tool() {
    let event = EventNormalizer::normalize(
        "item/started",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "item_1",
                "type": "userMessage",
                "content": []
            }
        }),
    );

    match event {
        CodexUiEvent::Warning { message } => {
            assert!(message.contains("非工具生命周期"));
        }
        _ => panic!("userMessage item should not be exposed as a tool"),
    }
}

#[test]
fn command_execution_item_started_is_a_tool() {
    let event = EventNormalizer::normalize(
        "item/started",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "item_1",
                "type": "commandExecution",
                "command": "dir"
            }
        }),
    );

    match event {
        CodexUiEvent::ToolStarted { item } => {
            assert_eq!(item.kind, "commandExecution");
            assert_eq!(item.command.as_deref(), Some("dir"));
        }
        _ => panic!("commandExecution item should be exposed as a tool"),
    }
}

#[test]
fn context_compaction_item_started_is_exposed_as_process_tool() {
    let event = EventNormalizer::normalize(
        "item/started",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_compact",
            "item": {
                "id": "compact_1",
                "type": "contextCompaction"
            }
        }),
    );

    match event {
        CodexUiEvent::ToolStarted { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id, "turn_compact");
            assert_eq!(item.item_id.as_deref(), Some("compact_1"));
            assert_eq!(item.kind, "contextCompaction");
            assert_eq!(item.title, "压缩上下文");
        }
        _ => panic!("contextCompaction item should be exposed as a process tool"),
    }
}

#[test]
fn mcp_tool_call_approval_request_uses_nested_message_and_tool_metadata() {
    let request = normalize_approval_request(
        "approval-mcp-1".to_string(),
        "mcpServer/elicitation/request",
        json!({
            "threadId": "thr_mcp",
            "serverName": "lex_vault_local",
            "request": {
                "mode": "form",
                "message": "Allow the lex_vault_local MCP server to run tool \"calendar_create_event\"?",
                "_meta": {
                    "codex_approval_kind": "mcp_tool_call",
                    "tool_description": "创建新的庭期、期限、会议、跟进或待办事项。",
                    "persist": ["session", "always"]
                },
                "requestedSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
    );

    assert_eq!(request.thread_id, "thr_mcp");
    assert_eq!(request.operation_type, "mcp_tool_call");
    assert_eq!(request.title, "允许调用 MCP 工具：calendar_create_event");
    assert_eq!(request.tool_name.as_deref(), Some("calendar_create_event"));
    assert_eq!(
        request.reason.as_deref(),
        Some("将调用 lex_vault_local 的 calendar_create_event 工具。 创建新的庭期、期限、会议、跟进或待办事项。 当前协议支持按会话或长期记住这次授权。")
    );
}

#[test]
fn completed_agent_message_can_supply_full_text() {
    let event = EventNormalizer::normalize(
        "item/completed",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "msg_1",
                "type": "agentMessage",
                "phase": "final_answer",
                "text": "完整回答"
            }
        }),
    );

    match event {
        CodexUiEvent::AssistantMessageCompleted {
            thread_id,
            turn_id,
            item_id,
            text,
        } => {
            assert_eq!(thread_id, "thr_1");
            assert_eq!(turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item_id.as_deref(), Some("msg_1"));
            assert_eq!(text.as_deref(), Some("完整回答"));
        }
        _ => panic!("agentMessage completion should become assistant completion"),
    }
}

#[test]
fn completed_agent_message_without_phase_becomes_final_message() {
    let event = EventNormalizer::normalize(
        "item/completed",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "msg_1b",
                "type": "agentMessage",
                "text": "兼容最终回答"
            }
        }),
    );

    match event {
        CodexUiEvent::AssistantMessageCompleted {
            thread_id,
            turn_id,
            item_id,
            text,
        } => {
            assert_eq!(thread_id, "thr_1");
            assert_eq!(turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item_id.as_deref(), Some("msg_1b"));
            assert_eq!(text.as_deref(), Some("兼容最终回答"));
        }
        _ => panic!("phase 缺失的 agentMessage 应作为最终正文兼容处理"),
    }
}

#[test]
fn commentary_agent_message_completed_becomes_process_delta() {
    let event = EventNormalizer::normalize(
        "item/completed",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "msg_2",
                "type": "agentMessage",
                "phase": "commentary",
                "text": "先检查目录结构"
            }
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.item_id.as_deref(), Some("msg_2"));
            assert_eq!(item.segment_key, None);
            assert_eq!(item.kind, "commentary");
            assert_eq!(item.text, "先检查目录结构");
            assert!(!item.promotable_answer);
            assert!(item.snapshot);
        }
        _ => panic!("commentary agent message should become process delta"),
    }
}

#[test]
fn reasoning_summary_part_added_becomes_empty_process_delta() {
    let event = EventNormalizer::normalize(
        "item/reasoning/summaryPartAdded",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "summaryIndex": 1
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.segment_key.as_deref(), Some("summary:1"));
            assert_eq!(item.kind, "reasoning");
            assert_eq!(item.text, "");
            assert!(!item.promotable_answer);
            assert!(!item.snapshot);
        }
        _ => panic!("reasoning summaryPartAdded 应继续归一化为过程增量"),
    }
}

#[test]
fn reasoning_summary_delta_becomes_process_delta() {
    let event = EventNormalizer::normalize(
        "item/reasoning/summaryTextDelta",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "delta": "正在对比历史记录结构。"
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.segment_key, None);
            assert_eq!(item.kind, "reasoning");
            assert_eq!(item.text, "正在对比历史记录结构。");
            assert!(!item.promotable_answer);
            assert!(!item.snapshot);
        }
        _ => panic!("reasoning delta should become process delta"),
    }
}

#[test]
fn reasoning_content_delta_carries_content_segment_key() {
    let event = EventNormalizer::normalize(
        "item/reasoning/textDelta",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "contentIndex": 2,
            "delta": "补充原始推理"
        }),
    );

    match event {
        CodexUiEvent::AssistantProcessDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id.as_deref(), Some("turn_1"));
            assert_eq!(item.segment_key.as_deref(), Some("content:2"));
            assert_eq!(item.kind, "reasoning");
            assert_eq!(item.text, "补充原始推理");
            assert!(!item.promotable_answer);
            assert!(!item.snapshot);
        }
        _ => panic!("reasoning content delta should keep content segment key"),
    }
}

#[test]
fn command_output_delta_becomes_tool_delta() {
    let event = EventNormalizer::normalize(
        "item/commandExecution/outputDelta",
        json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "itemId": "call_1",
            "delta": "line 1"
        }),
    );

    match event {
        CodexUiEvent::ToolDelta { item } => {
            assert_eq!(item.thread_id, "thr_1");
            assert_eq!(item.turn_id, "turn_1");
            assert_eq!(item.item_id.as_deref(), Some("call_1"));
            assert_eq!(item.kind, "commandExecution");
            assert_eq!(item.delta, "line 1");
        }
        _ => panic!("commandExecution output delta should become tool delta"),
    }
}

#[test]
fn retrying_error_becomes_user_visible_warning() {
    let event = EventNormalizer::normalize(
        "error",
        json!({
            "error": { "message": "Reconnecting... 2/5" },
            "willRetry": true,
            "threadId": "thr_1",
            "turnId": "turn_1"
        }),
    );

    match event {
        CodexUiEvent::Warning { message } => {
            assert!(message.contains("Reconnecting"));
        }
        _ => panic!("retrying error should become warning"),
    }
}
