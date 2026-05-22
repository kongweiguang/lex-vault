use std::path::Path;

use path_clean::PathClean;
use serde_json::{json, Value};

use crate::appserver_client::protocol::{StartLegalTurnPluginMention, StartLegalTurnRequest};

pub const THREAD_SANDBOX_MODE: &str = "danger-full-access";
pub const TURN_SANDBOX_POLICY_TYPE: &str = "dangerFullAccess";
pub const APPROVAL_POLICY: &str = "never";
pub const COLLABORATION_MODE_DEFAULT: &str = "default";
pub const COLLABORATION_MODE_DEFAULT_MODEL: &str = "gpt-5.4";
pub const COLLABORATION_MODE_DEFAULT_REASONING_EFFORT: &str = "medium";
pub const RUNTIME_EXPERIMENTAL_FEATURES: [&str; 4] = ["plugins", "apps", "tool_search", "memories"];

pub fn thread_start_params(cwd: String, ephemeral: Option<bool>) -> Value {
    json!({
        "cwd": cwd,
        "ephemeral": ephemeral.unwrap_or(false),
        "sandbox": THREAD_SANDBOX_MODE,
        "approvalPolicy": APPROVAL_POLICY
    })
}

pub fn thread_resume_params(thread_id: String, cwd: Option<String>) -> Value {
    json!({
        "threadId": thread_id,
        "cwd": cwd,
        "sandbox": THREAD_SANDBOX_MODE,
        "approvalPolicy": APPROVAL_POLICY
    })
}

pub fn thread_list_params(cwd: Option<String>, limit: Option<u32>) -> Value {
    let normalized_cwd = cwd.map(|value| normalize_thread_filter_cwd(&value));
    json!({
        "cwd": normalized_cwd,
        "limit": limit.unwrap_or(50),
        "sortKey": "updated_at",
        "sortDirection": "desc"
    })
}

fn normalize_thread_filter_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    #[cfg(windows)]
    {
        if trimmed.starts_with(r"\\?\") {
            return trimmed.to_string();
        }
        let path = Path::new(trimmed);
        let normalized = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        }
        .clean();
        return format!(r"\\?\{}", normalized.display());
    }

    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

pub fn thread_read_params(thread_id: String, include_turns: bool) -> Value {
    json!({
        "threadId": thread_id,
        "includeTurns": include_turns,
        "itemsView": if include_turns { "full" } else { "summary" }
    })
}

pub fn legal_user_text(req: &StartLegalTurnRequest) -> String {
    let mut prefixes: Vec<String> = selected_plugin_mentions(req)
        .iter()
        .map(plugin_mention_token)
        .collect();
    if let Some(skill_name) = selected_skill_name(req) {
        prefixes.push(format!("${skill_name}"));
    }
    let prefix = prefixes.join(" ");
    [prefix.trim(), req.user_prompt.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

pub fn legal_turn_start_params(
    req: StartLegalTurnRequest,
    skill_path: Option<&Path>,
    text: String,
    extra_input: Vec<Value>,
) -> Value {
    let skill_name = selected_skill_name(&req);
    let developer_instructions = selected_developer_instructions(&req);
    let plugin_mentions = selected_plugin_mentions(&req);
    let mut input = vec![json!({ "type": "text", "text": text, "text_elements": [] })];
    input.extend(extra_input);
    if let (Some(skill_name), Some(path)) = (skill_name.clone(), skill_path) {
        input.push(json!({ "type": "skill", "name": skill_name, "path": path }));
    }
    for mention in plugin_mentions {
        input.push(json!({ "type": "mention", "name": mention.name, "path": mention.path }));
    }

    let mut params = json!({
        "threadId": req.thread_id,
        "cwd": req.cwd,
        "sandboxPolicy": {
            "type": TURN_SANDBOX_POLICY_TYPE
        },
        "approvalPolicy": APPROVAL_POLICY,
        "input": input
    });

    if skill_name.is_some() || developer_instructions.is_some() {
        let mut settings = json!({});
        // app-server 当前要求 collaborationMode.settings 只要出现就携带 model，
        // 普通对话仅注入隐藏目录说明时也必须补齐默认模型参数。
        settings["model"] = json!(COLLABORATION_MODE_DEFAULT_MODEL);
        settings["reasoning_effort"] = json!(COLLABORATION_MODE_DEFAULT_REASONING_EFFORT);
        if let Some(value) = developer_instructions {
            settings["developer_instructions"] = json!(value);
        }
        params["collaborationMode"] = json!({
            "mode": COLLABORATION_MODE_DEFAULT,
            "settings": settings
        });
    }

    params
}

fn selected_skill_name(req: &StartLegalTurnRequest) -> Option<String> {
    req.skill_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn selected_developer_instructions(req: &StartLegalTurnRequest) -> Option<String> {
    req.developer_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn selected_plugin_mentions(req: &StartLegalTurnRequest) -> Vec<StartLegalTurnPluginMention> {
    req.plugin_mentions
        .iter()
        .filter_map(|mention| {
            let name = mention.name.trim();
            let path = mention.path.trim();
            if name.is_empty() || path.is_empty() {
                return None;
            }
            Some(StartLegalTurnPluginMention {
                name: name.to_string(),
                path: path.to_string(),
            })
        })
        .collect()
}

fn plugin_mention_token(mention: &StartLegalTurnPluginMention) -> String {
    if let Some(path) = mention
        .path
        .strip_prefix("plugin://")
        .and_then(|value| value.split('@').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("@{path}");
    }
    format!("@{}", mention.name.trim())
}

pub fn experimental_feature_enablement_params(name: &str, enabled: bool) -> Value {
    json!({
        "enablement": {
            name: enabled
        }
    })
}

pub fn turn_interrupt_params(thread_id: String, turn_id: String) -> Value {
    json!({
        "threadId": thread_id,
        "turnId": turn_id
    })
}

pub fn thread_compact_start_params(thread_id: String) -> Value {
    json!({
        "threadId": thread_id
    })
}
