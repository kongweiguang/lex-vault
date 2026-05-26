//! appserver_client 模块回归测试。
//!
//! @author kongweiguang

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::{oneshot, Mutex};

use crate::event_normalizer::{CodexUiEvent, TurnInfo};

use super::client::{
    enrich_agent_message_delta_phase, observe_turn_completion, remember_agent_message_phase,
    turn_thread_waiting_key, PendingTurnCompletion,
};
use super::model_config::{
    lex_vault_app_version, lex_vault_model_config_batch_params, lex_vault_model_config_is_current,
    lex_vault_runtime_default_model, lex_vault_runtime_law_admin_client_id,
    lex_vault_runtime_model_base_url, LEX_VAULT_APP_VERSION, LEX_VAULT_LAW_TOKEN_ENV,
    LEX_VAULT_MODEL_PROVIDER_ID,
};
use super::params::{
    experimental_feature_enablement_params, legal_turn_start_params, legal_user_text,
    plugin_enablement_write_params, thread_compact_start_params, thread_list_params,
    thread_read_params, thread_resume_params, thread_start_params, turn_interrupt_params,
    APPROVAL_POLICY, COLLABORATION_MODE_DEFAULT, COLLABORATION_MODE_DEFAULT_MODEL,
    COLLABORATION_MODE_DEFAULT_REASONING_EFFORT, THREAD_SANDBOX_MODE, TURN_SANDBOX_POLICY_TYPE,
};
use super::protocol::{
    StartLegalTurnAttachment, StartLegalTurnPluginMention, StartLegalTurnRequest,
};

/// 验证 thread/start 默认使用完全访问，避免触发 Windows sandbox helper。
#[test]
fn thread_start_params_use_danger_full_access() {
    let params = thread_start_params("C:\\workspace".to_string(), None);

    assert_eq!(params["sandbox"], THREAD_SANDBOX_MODE);
    assert_eq!(params["approvalPolicy"], APPROVAL_POLICY);
    assert_eq!(params["ephemeral"], false);
}

/// 验证 thread/resume 会沿用桌面端默认权限和审批策略。
#[test]
fn thread_resume_params_keep_runtime_policy() {
    let params = thread_resume_params("thr_1".to_string(), Some("C:\\workspace".to_string()));

    assert_eq!(params["threadId"], "thr_1");
    assert_eq!(params["cwd"], "C:\\workspace");
    assert_eq!(params["sandbox"], THREAD_SANDBOX_MODE);
    assert_eq!(params["approvalPolicy"], APPROVAL_POLICY);
}

/// 验证 thread/list 只按工作目录和更新时间排序，不按来源过滤，避免漏掉 Codex 落盘会话。
#[test]
fn thread_list_params_keep_all_codex_sources() {
    let params = thread_list_params(Some("C:\\workspace".to_string()), None);

    #[cfg(windows)]
    assert_eq!(params["cwd"], r"\\?\C:\workspace");
    #[cfg(not(windows))]
    assert_eq!(params["cwd"], "C:\\workspace");
    assert_eq!(params["limit"], 50);
    assert_eq!(params["sortKey"], "updated_at");
    assert_eq!(params["sortDirection"], "desc");
    assert!(params.get("sourceKinds").is_none());
}

/// 验证已经带有 Windows 长路径前缀的 cwd 不会被重复拼接。
#[test]
fn thread_list_params_keep_existing_windows_long_path_prefix() {
    let params = thread_list_params(Some(r"\\?\C:\workspace".to_string()), None);

    assert_eq!(params["cwd"], r"\\?\C:\workspace");
}

/// 验证 thread/read 回填历史时会显式请求完整 items，保证 reasoning/commentary 可恢复。
#[test]
fn read_thread_params_request_full_items_when_loading_turns() {
    let params = thread_read_params("thr_1".to_string(), true);

    assert_eq!(params["threadId"], "thr_1");
    assert_eq!(params["includeTurns"], true);
    assert_eq!(params["itemsView"], "full");
}

/// 验证 agentMessage delta 能继承 started 事件中的 phase，避免过程说明被当成最终正文。
#[test]
fn agent_message_delta_inherits_phase_from_started_item() {
    let mut phases = HashMap::new();
    remember_agent_message_phase(
        "item/started",
        &json!({
            "threadId": "thr_1",
            "turnId": "turn_1",
            "item": {
                "id": "msg_1",
                "type": "agentMessage",
                "phase": "commentary"
            }
        }),
        &mut phases,
    );

    let mut params = json!({
        "threadId": "thr_1",
        "turnId": "turn_1",
        "itemId": "msg_1",
        "delta": "先读取材料"
    });
    enrich_agent_message_delta_phase("item/agentMessage/delta", &mut params, &phases);

    assert_eq!(params["phase"], "commentary");
}

/// 验证外部桥接可以先按 thread 预登记等待项，避免 app-server 极快返回时漏掉 turn 事件。
#[tokio::test]
async fn turn_completion_waiter_binds_thread_pending_before_turn_start() {
    let completions = Arc::new(Mutex::new(HashMap::new()));
    let (sender, receiver) = oneshot::channel();
    completions.lock().await.insert(
        turn_thread_waiting_key("thread_1"),
        PendingTurnCompletion {
            output_text: String::new(),
            sender: Some(sender),
        },
    );

    observe_turn_completion(
        &completions,
        &CodexUiEvent::TurnStarted {
            turn: TurnInfo {
                id: "turn_1".to_string(),
                thread_id: "thread_1".to_string(),
                status: Some("running".to_string()),
                token_usage: None,
            },
        },
    )
    .await;
    observe_turn_completion(
        &completions,
        &CodexUiEvent::AssistantDelta {
            thread_id: "thread_1".to_string(),
            turn_id: Some("turn_1".to_string()),
            item_id: None,
            text: "你好，微信".to_string(),
        },
    )
    .await;
    observe_turn_completion(
        &completions,
        &CodexUiEvent::TurnCompleted {
            turn: TurnInfo {
                id: "turn_1".to_string(),
                thread_id: "thread_1".to_string(),
                status: Some("completed".to_string()),
                token_usage: Some(json!({ "total": 1 })),
            },
        },
    )
    .await;

    let output = receiver
        .await
        .expect("turn completion sender should reply")
        .expect("turn completion should succeed");
    assert_eq!(output.thread_id, "thread_1");
    assert_eq!(output.turn_id, "turn_1");
    assert_eq!(output.text, "你好，微信");
    assert_eq!(output.status.as_deref(), Some("completed"));
    assert!(completions.lock().await.is_empty());
}

/// 验证模型配置和应用版本通过 app-server config/batchWrite 参数表达，不依赖直接拼写 config.toml。
#[test]
fn lex_vault_model_config_batch_params_write_provider_and_app_version() {
    let params =
        lex_vault_model_config_batch_params(Path::new("C:\\agent\\.internal\\kongweiguang.md"));
    let edits = params["edits"]
        .as_array()
        .expect("edits should be an array");

    assert_eq!(params["reloadUserConfig"], true);
    assert_eq!(edits[0]["keyPath"], "lex_vault.app_version");
    assert_eq!(edits[0]["value"], LEX_VAULT_APP_VERSION);
    assert_eq!(edits[1]["keyPath"], "model");
    assert_eq!(edits[1]["value"], lex_vault_runtime_default_model());
    assert_eq!(edits[2]["keyPath"], "model_provider");
    assert_eq!(edits[2]["value"], LEX_VAULT_MODEL_PROVIDER_ID);
    assert_eq!(edits[4]["keyPath"], "model_instructions_file");
    assert_eq!(edits[4]["value"], "C:\\agent\\.internal\\kongweiguang.md");
    assert_eq!(
        edits[5]["keyPath"],
        format!("model_providers.{LEX_VAULT_MODEL_PROVIDER_ID}")
    );
    assert_eq!(
        edits[5]["value"]["base_url"],
        lex_vault_runtime_model_base_url()
    );
    assert_eq!(edits[5]["value"]["env_key"], LEX_VAULT_LAW_TOKEN_ENV);
    assert_eq!(edits[5]["value"]["wire_api"], "responses");
    assert_eq!(edits[5]["value"]["requires_openai_auth"], false);
    assert_eq!(
        edits[5]["value"]["http_headers"]["clientid"],
        lex_vault_runtime_law_admin_client_id()
    );
}

/// 验证旧 provider 即使应用版本一致，只要缺少 env_key 也会触发配置重写。
#[test]
fn lex_vault_model_config_requires_env_key_even_when_version_matches() {
    let current_without_env_key = json!({
        "config": {
            "lex_vault": {
                "app_version": LEX_VAULT_APP_VERSION
            },
            "model": lex_vault_runtime_default_model(),
            "model_provider": LEX_VAULT_MODEL_PROVIDER_ID,
            "model_instructions_file": "C:\\agent\\.internal\\kongweiguang.md",
            "model_providers": {
                LEX_VAULT_MODEL_PROVIDER_ID: {
                    "base_url": lex_vault_runtime_model_base_url(),
                    "wire_api": "responses",
                    "requires_openai_auth": false,
                    "http_headers": {
                        "clientid": lex_vault_runtime_law_admin_client_id()
                    }
                }
            }
        }
    });
    let current_with_env_key = json!({
        "config": {
            "lex_vault": {
                "app_version": LEX_VAULT_APP_VERSION
            },
            "model": lex_vault_runtime_default_model(),
            "model_provider": LEX_VAULT_MODEL_PROVIDER_ID,
            "model_instructions_file": "C:\\agent\\.internal\\kongweiguang.md",
            "model_providers": {
                LEX_VAULT_MODEL_PROVIDER_ID: {
                    "base_url": lex_vault_runtime_model_base_url(),
                    "env_key": LEX_VAULT_LAW_TOKEN_ENV,
                    "wire_api": "responses",
                    "requires_openai_auth": false,
                    "http_headers": {
                        "clientid": lex_vault_runtime_law_admin_client_id()
                    }
                }
            }
        }
    });

    assert!(!lex_vault_model_config_is_current(
        &current_without_env_key,
        Path::new("C:\\agent\\.internal\\kongweiguang.md")
    ));
    assert!(lex_vault_model_config_is_current(
        &current_with_env_key,
        Path::new("C:\\agent\\.internal\\kongweiguang.md")
    ));
}

/// 验证能从 app-server config/read 响应中读取应用版本，用于决定是否重写默认配置。
#[test]
fn lex_vault_app_version_reads_config_section() {
    let response = json!({
        "config": {
            "lex_vault": {
                "app_version": "0.1.2"
            }
        }
    });

    assert_eq!(lex_vault_app_version(&response).as_deref(), Some("0.1.2"));
    assert_eq!(lex_vault_app_version(&json!({"config": {}})), None);
}

/// 验证 turn/start 使用结构化协作模式对象、完全访问策略，并继续携带审批策略。
#[test]
fn legal_turn_start_params_use_danger_full_access_policy() {
    let req = StartLegalTurnRequest {
        thread_id: "thread_1".to_string(),
        cwd: "C:\\workspace".to_string(),
        user_prompt: "你好".to_string(),
        attachments: vec![],
        developer_instructions: Some("目录说明".to_string()),
        skill_name: Some("plugin-creator".to_string()),
        plugin_mentions: vec![],
    };
    let text = legal_user_text(&req);

    let params = legal_turn_start_params(req, Some(Path::new("C:\\skill\\SKILL.md")), text, vec![]);

    assert_eq!(
        params["sandboxPolicy"],
        json!({ "type": TURN_SANDBOX_POLICY_TYPE })
    );
    assert_eq!(params["approvalPolicy"], APPROVAL_POLICY);
    assert_eq!(
        params["collaborationMode"]["mode"],
        COLLABORATION_MODE_DEFAULT
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["model"],
        COLLABORATION_MODE_DEFAULT_MODEL
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        COLLABORATION_MODE_DEFAULT_REASONING_EFFORT
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        "目录说明"
    );
    assert_eq!(params["input"][0]["text"], "$plugin-creator 你好");
    assert_eq!(params["input"][0]["text_elements"], json!([]));
    assert_eq!(params["input"][1]["name"], "plugin-creator");
}

/// 验证停止输出使用 turn/interrupt 所需的 threadId 和 turnId，不依赖停止 runtime。
#[test]
fn turn_interrupt_params_target_specific_turn() {
    let params = turn_interrupt_params("thread_1".to_string(), "turn_1".to_string());

    assert_eq!(params["threadId"], "thread_1");
    assert_eq!(params["turnId"], "turn_1");
    assert!(params.get("runtime").is_none());
}

/// 验证 thread/compact/start 只需要目标 threadId，压缩进度由 notification 回传。
#[test]
fn thread_compact_start_params_target_thread() {
    let params = thread_compact_start_params("thread_1".to_string());

    assert_eq!(params["threadId"], "thread_1");
    assert!(params.get("turnId").is_none());
}

/// 验证案件入口未选择专项 skill 时，turn/start 只发送用户原始问题，不再查找空 skill 路径。
#[test]
fn legal_turn_start_params_allow_plain_turn_without_skill() {
    let req = StartLegalTurnRequest {
        thread_id: "thread_1".to_string(),
        cwd: "C:\\workspace".to_string(),
        user_prompt: "梳理案件事实".to_string(),
        attachments: vec![],
        developer_instructions: None,
        skill_name: None,
        plugin_mentions: vec![],
    };
    let text = legal_user_text(&req);

    let params = legal_turn_start_params(req, None, text, vec![]);

    assert_eq!(params["input"][0]["text"], "梳理案件事实");
    assert_eq!(
        params["input"]
            .as_array()
            .expect("input should be array")
            .len(),
        1
    );
    assert!(params.get("collaborationMode").is_none());
}

/// 验证普通对话也会通过隐藏 developer_instructions 注入目录语义，不污染用户可见问题正文。
#[test]
fn legal_turn_start_params_attach_hidden_developer_instructions_for_plain_turn() {
    let req = StartLegalTurnRequest {
        thread_id: "thread_1".to_string(),
        cwd: "C:\\workspace".to_string(),
        user_prompt: "整理今天的工作".to_string(),
        attachments: vec![],
        developer_instructions: Some("这是隐藏目录说明".to_string()),
        skill_name: None,
        plugin_mentions: vec![],
    };
    let text = legal_user_text(&req);

    let params = legal_turn_start_params(req, None, text, vec![]);

    assert_eq!(params["input"][0]["text"], "整理今天的工作");
    assert_eq!(
        params["collaborationMode"]["settings"]["developer_instructions"],
        "这是隐藏目录说明"
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["model"],
        COLLABORATION_MODE_DEFAULT_MODEL
    );
    assert_eq!(
        params["collaborationMode"]["settings"]["reasoning_effort"],
        COLLABORATION_MODE_DEFAULT_REASONING_EFFORT
    );
}

/// 验证选择插件时会在用户文本前插入 mention token，并追加结构化 mention input。
#[test]
fn legal_turn_start_params_append_plugin_mentions() {
    let req = StartLegalTurnRequest {
        thread_id: "thread_1".to_string(),
        cwd: "C:\\workspace".to_string(),
        user_prompt: "总结最近动态".to_string(),
        attachments: vec![],
        developer_instructions: None,
        skill_name: None,
        plugin_mentions: vec![StartLegalTurnPluginMention {
            name: "Sample Plugin".to_string(),
            path: "plugin://sample@test".to_string(),
        }],
    };
    let text = legal_user_text(&req);

    let params = legal_turn_start_params(req, None, text, vec![]);

    assert_eq!(params["input"][0]["text"], "@sample 总结最近动态");
    assert_eq!(params["input"][1]["type"], "mention");
    assert_eq!(params["input"][1]["name"], "Sample Plugin");
    assert_eq!(params["input"][1]["path"], "plugin://sample@test");
}

/// 验证多模态 turn/start 会把图片 input 排在文本之后、skill 和 plugin 之前。
#[test]
fn legal_turn_start_params_keep_multimodal_input_order() {
    let req = StartLegalTurnRequest {
        thread_id: "thread_1".to_string(),
        cwd: "C:\\workspace".to_string(),
        user_prompt: "请结合附件说明问题".to_string(),
        attachments: vec![StartLegalTurnAttachment {
            id: "image-1".to_string(),
            name: "evidence.png".to_string(),
            kind: "image".to_string(),
            source: "composer".to_string(),
            mime_type: "image/png".to_string(),
            size: Some(128),
            path: Some("C:\\temp\\evidence.png".to_string()),
            url: None,
            bytes: None,
            data_base64: None,
        }],
        developer_instructions: None,
        skill_name: Some("plugin-creator".to_string()),
        plugin_mentions: vec![StartLegalTurnPluginMention {
            name: "Sample Plugin".to_string(),
            path: "plugin://sample@test".to_string(),
        }],
    };
    let text = legal_user_text(&req);
    let params = legal_turn_start_params(
        req,
        Some(Path::new("C:\\skill\\SKILL.md")),
        text,
        vec![json!({
            "type": "localImage",
            "path": "C:\\temp\\evidence.png"
        })],
    );

    assert_eq!(params["input"][0]["type"], "text");
    assert_eq!(params["input"][1]["type"], "localImage");
    assert_eq!(params["input"][2]["type"], "skill");
    assert_eq!(params["input"][3]["type"], "mention");
}

/// 验证实验特性开关参数符合 app-server 当前要求的 `enablement` 映射结构。
#[test]
fn experimental_feature_enablement_params_use_enablement_map() {
    let params = experimental_feature_enablement_params("plugins", true);

    assert_eq!(params["enablement"]["plugins"], true);
}

/// 验证插件启用配置通过 app-server `config/batchWrite` 的 upsert 协议表达。
#[test]
fn plugin_enablement_write_params_use_plugins_upsert() {
    let params =
        plugin_enablement_write_params("documents@openai-primary-runtime".to_string(), true);

    assert_eq!(params["edits"][0]["keyPath"], "plugins");
    assert_eq!(
        params["edits"][0]["value"]["documents@openai-primary-runtime"]["enabled"],
        true
    );
    assert_eq!(params["edits"][0]["mergeStrategy"], "upsert");
    assert_eq!(params["reloadUserConfig"], true);
}
