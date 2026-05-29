//! codex_process 模块回归测试。
//!
//! @author kongweiguang

use super::{
    binary_names_for_target, build_runtime_environment, is_direct_app_server_binary_name,
    join_environment_paths, node_executable_candidates, prepend_path_entries,
    python_executable_candidates, resolve_runtime_executable, target_suffix_for_platform,
    BuiltinRuntimeConfig, CodexProcessManager,
};
use crate::commands::codex::profile_codex_home;
use crate::commands::local_data::read_saved_access_token;
use crate::local_mcp_server::LocalMcpRuntimeState;
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[test]
fn binary_names_for_windows_use_agent_server_prefix() {
    assert_eq!(
        binary_names_for_target("windows", "x86_64"),
        vec!["agent-server-x86_64-pc-windows-msvc.exe".to_string()]
    );
}

#[test]
fn binary_names_for_macos_include_darwin_target() {
    assert_eq!(
        binary_names_for_target("macos", "aarch64"),
        vec!["agent-server-aarch64-apple-darwin".to_string()]
    );
}

#[test]
fn target_suffix_for_unknown_platform_returns_none() {
    assert_eq!(target_suffix_for_platform("freebsd", "x86_64"), None);
}

#[test]
fn direct_app_server_binary_name_only_accepts_agent_server_prefix() {
    assert!(is_direct_app_server_binary_name(
        "agent-server-x86_64-pc-windows-msvc"
    ));
    assert!(!is_direct_app_server_binary_name(
        "codex-app-server-x86_64-pc-windows-msvc"
    ));
    assert!(!is_direct_app_server_binary_name("codex"));
}

#[test]
fn build_runtime_environment_injects_builtin_runtime_variables_and_prepends_path() {
    let original_path = std::env::var("PATH").ok();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let existing_path = if cfg!(windows) {
        r"C:\Windows\System32;C:\Tools".to_string()
    } else {
        "/usr/bin:/bin".to_string()
    };
    let python_path = if cfg!(windows) {
        r"C:\Runtime\Python\python.exe".to_string()
    } else {
        "/opt/python/bin/python".to_string()
    };
    let node_path = if cfg!(windows) {
        r"C:\Runtime\Node\node.exe".to_string()
    } else {
        "/opt/node/bin/node".to_string()
    };
    let python_dir = std::path::Path::new(&python_path)
        .parent()
        .expect("python dir")
        .display()
        .to_string();
    let node_dir = std::path::Path::new(&node_path)
        .parent()
        .expect("node dir")
        .display()
        .to_string();
    unsafe {
        std::env::set_var("PATH", &existing_path);
    }

    let env = build_runtime_environment(&BuiltinRuntimeConfig {
        python_executable: python_path.clone(),
        node_executable: node_path.clone(),
        runtime_root: if cfg!(windows) {
            r"C:\Runtime\agent-primary-runtime".to_string()
        } else {
            "/opt/agent-primary-runtime".to_string()
        },
        tools_directory: Some(if cfg!(windows) {
            r"C:\Runtime\LexVault\tools".to_string()
        } else {
            "/opt/lex-vault/tools".to_string()
        }),
        node_module_directories: vec![if cfg!(windows) {
            r"C:\Runtime\agent-primary-runtime\dependencies\node\node_modules".to_string()
        } else {
            "/opt/agent-primary-runtime/dependencies/node/node_modules".to_string()
        }],
        path_entries: vec![
            std::path::PathBuf::from(&python_dir),
            std::path::PathBuf::from(&node_dir),
            std::path::PathBuf::from(if cfg!(windows) {
                r"C:\Runtime\LexVault\tools"
            } else {
                "/opt/lex-vault/tools"
            }),
        ],
    });

    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_PYTHON" && value == &python_path));
    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_NODE" && value == &node_path));
    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_RUNTIME_ROOT"
            && value.contains("agent-primary-runtime")));
    assert!(env.iter().any(|(key, value)| {
        key == "PIP_INDEX_URL" && value == "https://pypi.tuna.tsinghua.edu.cn/simple"
    }));
    assert!(env
        .iter()
        .any(|(key, value)| key == "PIP_TRUSTED_HOST" && value == "pypi.tuna.tsinghua.edu.cn"));
    assert!(env.iter().any(|(key, value)| {
        key == "UV_DEFAULT_INDEX" && value == "https://pypi.tuna.tsinghua.edu.cn/simple"
    }));
    assert!(env.iter().any(|(key, value)| {
        key == "npm_config_registry" && value == "https://registry.npmmirror.com"
    }));
    assert!(env.iter().any(|(key, value)| {
        key == "NPM_CONFIG_REGISTRY" && value == "https://registry.npmmirror.com"
    }));
    assert!(env.iter().any(|(key, value)| {
        key == "YARN_NPM_REGISTRY_SERVER" && value == "https://registry.npmmirror.com"
    }));
    assert!(env
        .iter()
        .any(|(key, value)| { key == "LEX_VAULT_TOOLS_DIR" && value.contains("tools") }));
    assert!(env.iter().any(|(key, value)| {
        key == "NODE_REPL_NODE_MODULE_DIRS" && value.contains("node_modules")
    }));
    let path_value = env
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .expect("PATH should be injected");
    assert!(path_value.starts_with(&format!("{python_dir}{separator}{node_dir}{separator}")));
    assert!(path_value.contains("tools"));
    assert!(path_value.contains(&existing_path));

    restore_path(original_path);
}

#[test]
fn prepend_path_entries_deduplicates_runtime_directories() {
    let original_path = std::env::var("PATH").ok();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let existing_path = if cfg!(windows) {
        r"C:\Windows\System32;C:\Tools".to_string()
    } else {
        "/usr/bin:/bin".to_string()
    };
    let python_dir = if cfg!(windows) {
        r"C:\Runtime\Python"
    } else {
        "/opt/python"
    };
    let node_dir = if cfg!(windows) {
        r"C:\Runtime\Node"
    } else {
        "/opt/node"
    };
    unsafe {
        std::env::set_var("PATH", &existing_path);
    }

    let path_value = prepend_path_entries(&[
        std::path::PathBuf::from(python_dir),
        std::path::PathBuf::from(python_dir),
        std::path::PathBuf::from(node_dir),
    ])
    .expect("PATH should be built");

    assert_eq!(
        path_value,
        format!("{python_dir}{separator}{node_dir}{separator}{existing_path}")
    );
    restore_path(original_path);
}

#[test]
fn join_environment_paths_uses_platform_separator() {
    let value = join_environment_paths(&["one".to_string(), "two".to_string()]);
    if cfg!(windows) {
        assert_eq!(value, "one;two");
    } else {
        assert_eq!(value, "one:two");
    }
}

#[test]
fn resolve_runtime_executable_reads_current_platform_candidates() {
    let runtime_root = temp_runtime_root();
    let relative_python = python_executable_candidates()[0];
    let relative_node = node_executable_candidates()[0];
    let python_file = runtime_root.join(relative_python);
    let node_file = runtime_root.join(relative_node);
    if let Some(parent) = python_file.parent() {
        std::fs::create_dir_all(parent).expect("python runtime dir should exist");
    }
    if let Some(parent) = node_file.parent() {
        std::fs::create_dir_all(parent).expect("node runtime dir should exist");
    }
    std::fs::write(&python_file, b"python").expect("python runtime file should exist");
    std::fs::write(&node_file, b"node").expect("node runtime file should exist");

    let resolved_python = resolve_runtime_executable(&runtime_root, python_executable_candidates())
        .expect("python executable should resolve");
    let resolved_node = resolve_runtime_executable(&runtime_root, node_executable_candidates())
        .expect("node executable should resolve");

    assert_eq!(resolved_python, python_file.display().to_string());
    assert_eq!(resolved_node, node_file.display().to_string());

    let _ = std::fs::remove_dir_all(runtime_root);
}

fn restore_path(original_path: Option<String>) {
    match original_path {
        Some(path) => unsafe {
            std::env::set_var("PATH", path);
        },
        None => unsafe {
            std::env::remove_var("PATH");
        },
    }
}

fn temp_runtime_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("lex-vault-runtime-tests-{}", uuid::Uuid::new_v4()))
}

#[derive(Debug, Default)]
struct ManualE2eTurnResult {
    thread_id: String,
    turn_id: String,
    tool_titles: Vec<String>,
    final_text: String,
}

/// 手动 E2E：启动当前源码中的本地 MCP server，再起一个隔离的 app-server，
/// 验证 turn 中能真正看到 `web_search` 工具并完成一次联网搜索。
///
/// 运行方式：
/// `cargo test --manifest-path client/lex-vault/src-tauri/Cargo.toml manual_e2e_turn_can_call_web_search_through_local_mcp -- --ignored --nocapture`
#[tokio::test(flavor = "current_thread")]
#[ignore = "需要本机已登录 Lex Vault、可访问远程模型网关，并会真实联网检索"]
async fn manual_e2e_turn_can_call_web_search_through_local_mcp() {
    let access_token =
        read_saved_access_token().expect("manual e2e requires a saved Lex Vault access token");
    assert!(
        !access_token.trim().is_empty(),
        "manual e2e requires a non-empty Lex Vault access token"
    );

    let local_mcp = LocalMcpRuntimeState::default();
    let local_mcp_url = local_mcp
        .ensure_started(None)
        .expect("current source local MCP server should start");

    let source_codex_home =
        profile_codex_home("manual-e2e").expect("current Lex Vault codex home should resolve");
    let sandbox_home = tempdir().expect("temporary CODEX_HOME should be created");
    std::fs::create_dir_all(sandbox_home.path().join(".internal"))
        .expect("temporary .internal directory should exist");
    std::fs::copy(
        source_codex_home.join("config.toml"),
        sandbox_home.path().join("config.toml"),
    )
    .expect("config.toml should be copied into temporary CODEX_HOME");
    let source_instructions = source_codex_home.join(".internal").join("kongweiguang.md");
    if source_instructions.is_file() {
        std::fs::copy(
            &source_instructions,
            sandbox_home
                .path()
                .join(".internal")
                .join("kongweiguang.md"),
        )
        .expect("model instructions file should be copied");
    }

    let config_path = sandbox_home.path().join("config.toml");
    let config_content =
        std::fs::read_to_string(&config_path).expect("temporary config.toml should be readable");
    let current_home = sandbox_home
        .path()
        .display()
        .to_string()
        .replace('\\', "\\\\");
    let source_instructions_text = source_instructions
        .display()
        .to_string()
        .replace('\\', "\\\\");
    let rewritten = config_content
        .replace(
            "url = \"http://127.0.0.1:3945/mcp\"",
            &format!("url = \"{local_mcp_url}\""),
        )
        .replace(
            &format!("model_instructions_file = '{source_instructions_text}'"),
            &format!(
                "model_instructions_file = '{}\\\\.internal\\\\kongweiguang.md'",
                current_home
            ),
        );
    std::fs::write(&config_path, rewritten).expect("temporary config.toml should be rewritten");

    let mut noop_progress = |_progress| {};
    let process =
        CodexProcessManager::start(sandbox_home.path(), &access_token, &mut noop_progress)
            .expect("isolated app-server should start");
    let mut stdin = process.stdin;
    let mut stdout = BufReader::new(process.stdout);
    let mut child = process.child;

    let mut next_id = 1_u64;
    let initialize = send_manual_jsonrpc(
        &mut stdin,
        &mut stdout,
        &mut next_id,
        "initialize",
        json!({
            "clientInfo": {
                "name": "lex_vault_manual_e2e",
                "title": "Lex Vault Manual E2E",
                "version": "0.0.0"
            },
            "capabilities": {
                "experimentalApi": true
            }
        }),
    )
    .await
    .expect("initialize should succeed");
    assert!(
        initialize.get("codexHome").is_some(),
        "initialize should return runtime context: {initialize}"
    );
    send_manual_notification(&mut stdin, "initialized", json!({}))
        .await
        .expect("initialized notification should be sent");

    let thread_started = send_manual_jsonrpc(
        &mut stdin,
        &mut stdout,
        &mut next_id,
        "thread/start",
        json!({
            "cwd": r"C:\dev\law",
            "ephemeral": true,
            "sandbox": "danger-full-access",
            "approvalPolicy": "never"
        }),
    )
    .await
    .expect("thread/start should succeed");
    let thread_id = thread_started
        .get("thread")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .expect("thread/start should return thread id")
        .to_string();

    send_manual_jsonrpc(
        &mut stdin,
        &mut stdout,
        &mut next_id,
        "turn/start",
        json!({
            "threadId": thread_id,
            "cwd": r"C:\dev\law",
            "sandboxPolicy": {
                "type": "dangerFullAccess"
            },
            "approvalPolicy": "never",
            "input": [{
                "type": "text",
                "text": "请明确调用 lex_vault_local 的 web_search 工具，搜索 OpenAI Responses API 官方结果，只返回第一条结果的标题和链接。",
                "text_elements": []
            }],
            "collaborationMode": {
                "mode": "default",
                "settings": {
                    "model": "gpt-5.4",
                    "reasoning_effort": "medium"
                }
            }
        }),
    )
    .await
    .expect("turn/start should be accepted");

    let result = wait_manual_turn_completion(&mut stdin, &mut stdout)
        .await
        .expect("turn should complete successfully");
    assert!(
        result.final_text.contains("https://openai.com/"),
        "final answer should contain the searched OpenAI link, got: {}",
        result.final_text
    );
    assert!(
        result.final_text.contains("第一条结果")
            || result.final_text.contains("OpenAI | Research & Deployment")
            || result.tool_titles.iter().any(|title| title.contains("web_search")),
        "manual e2e should either surface web_search traces or the searched result, got titles={:?}, final_text={}",
        result.tool_titles,
        result.final_text
    );

    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn send_manual_jsonrpc(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    next_id: &mut u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request_id = *next_id;
    *next_id += 1;
    let payload = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params,
    });
    write_manual_json(stdin, &payload).await?;
    loop {
        let incoming = read_manual_jsonrpc_message(stdout).await?;
        if let Some(id) = incoming.get("id").and_then(Value::as_u64) {
            if id == request_id {
                if let Some(error) = incoming.get("error") {
                    return Err(error.to_string());
                }
                return incoming
                    .get("result")
                    .cloned()
                    .ok_or_else(|| format!("{method} missing result field"));
            }
        }
        handle_manual_server_request(stdin, &incoming).await?;
    }
}

async fn send_manual_notification(
    stdin: &mut tokio::process::ChildStdin,
    method: &str,
    params: Value,
) -> Result<(), String> {
    write_manual_json(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }),
    )
    .await
}

async fn wait_manual_turn_completion(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<ManualE2eTurnResult, String> {
    let started = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(240);
    let mut result = ManualE2eTurnResult::default();
    while started.elapsed() < timeout {
        let incoming = read_manual_jsonrpc_message(stdout).await?;
        if incoming.get("method").and_then(Value::as_str) == Some("turn/completed") {
            if let Some(turn) = incoming.get("params").and_then(|value| value.get("turn")) {
                result.thread_id = turn
                    .get("threadId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                result.turn_id = turn
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            return Ok(result);
        }
        if incoming.get("method").and_then(Value::as_str) == Some("turn/failed") {
            return Err(incoming.to_string());
        }
        if let Some(method) = incoming.get("method").and_then(Value::as_str) {
            match method {
                "item/started" | "item/completed" => {
                    if let Some(item) = incoming.get("params").and_then(|value| value.get("item")) {
                        if item.get("type").and_then(Value::as_str) == Some("toolCall") {
                            if let Some(title) = item.get("title").and_then(Value::as_str) {
                                result.tool_titles.push(title.to_string());
                            }
                        }
                        if item.get("type").and_then(Value::as_str) == Some("agentMessage")
                            && item.get("phase").and_then(Value::as_str) == Some("final_answer")
                        {
                            if let Some(parts) = item.get("content").and_then(Value::as_array) {
                                for part in parts {
                                    if part.get("type").and_then(Value::as_str)
                                        == Some("output_text")
                                    {
                                        if let Some(text) = part.get("text").and_then(Value::as_str)
                                        {
                                            result.final_text.push_str(text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                "item/agentMessage/delta" => {
                    let params = incoming.get("params").cloned().unwrap_or_default();
                    let phase = params.get("phase").and_then(Value::as_str);
                    if phase == Some("final_answer") || phase.is_none() {
                        if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                            result.final_text.push_str(delta);
                        }
                    }
                }
                _ => {}
            }
        }
        handle_manual_server_request(stdin, &incoming).await?;
    }
    Err("waiting turn completion timed out".to_string())
}

async fn handle_manual_server_request(
    stdin: &mut tokio::process::ChildStdin,
    incoming: &Value,
) -> Result<(), String> {
    let Some(id) = incoming.get("id") else {
        return Ok(());
    };
    let Some(method) = incoming.get("method").and_then(Value::as_str) else {
        return Ok(());
    };
    let response = match method {
        "mcpServer/elicitation/request" => json!({
            "jsonrpc": "2.0",
            "id": id.clone(),
            "result": {
                "action": "accept",
                "content": null
            }
        }),
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => json!({
            "jsonrpc": "2.0",
            "id": id.clone(),
            "result": {
                "decision": "accept"
            }
        }),
        _ => json!({
            "jsonrpc": "2.0",
            "id": id.clone(),
            "result": {
                "decision": "accept"
            }
        }),
    };
    write_manual_json(stdin, &response).await
}

async fn write_manual_json(
    stdin: &mut tokio::process::ChildStdin,
    value: &Value,
) -> Result<(), String> {
    let mut payload = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    payload.push(b'\n');
    stdin
        .write_all(&payload)
        .await
        .map_err(|err| err.to_string())?;
    stdin.flush().await.map_err(|err| err.to_string())
}

async fn read_manual_jsonrpc_message(
    stdout: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = stdout
            .read_line(&mut line)
            .await
            .map_err(|err| err.to_string())?;
        if bytes == 0 {
            return Err("app-server stdout closed unexpectedly".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        return serde_json::from_str(trimmed).map_err(|err| err.to_string());
    }
}
