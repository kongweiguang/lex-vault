use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::appserver_client::{
    StartLegalTurnRequest, ThreadListResponse, ThreadMemoryMode, ThreadReadResponse,
    ThreadResumeResponse, ThreadStartResponse, TurnStartResponse, CODEX_EVENT_NAME,
};
use crate::codex_process::{CodexProcess, CodexProcessManager};
use crate::commands::codex::models::AppState;
use crate::commands::codex::models::{
    operation_result_from_value, plugin_details_from_value, plugin_list_result_from_value,
};
use crate::commands::codex::{
    audit, cleanup_legacy_builtin_skills, clear_stale_runtime_if_exited, emit_error,
    ensure_builtin_local_mcp_server_config, ensure_model_instructions_file,
    prepare_codex_runtime_home, profile_codex_home, runtime_client, thread_record_from_summary,
    validate_workspace, AddMarketplaceRequest, CodexOperationResult, CodexPluginDetails,
    CodexPluginListResult, CodexRuntime, CodexThreadListResult, CodexThreadRecord,
    CompactThreadRequest, InterruptTurnRequest, ListThreadsRequest, PluginEnablementRequest,
    PluginLookupRequest, ReadThreadRequest, RemoveMarketplaceRequest, ResumeThreadRequest,
    StartThreadRequest, ThreadMemoryModeRequest, UninstallPluginRequest, UpgradeMarketplaceRequest,
};
use crate::commands::local_data::{get_app_config, AppConfig};
use crate::event_normalizer::{ApprovalDecisionRequest, CodexUiEvent, ThreadInfo, TurnInfo};
use crate::jsonrpc::AppError;
use crate::logging::{log_info, log_with_details};
use crate::runtime_bundle::{
    RuntimeBundleProgress, RuntimeBundleStatus, RUNTIME_BUNDLE_EVENT_NAME,
};

/// 记录 Codex runtime 启动链路中的失败节点，避免日志里只剩下 start requested。
fn log_runtime_start_failure(step: &str, error: &AppError) {
    log_with_details(
        "ERROR",
        "codex_runtime_start_failed",
        format!("Codex runtime 启动失败，失败节点：{step}"),
        json!({
            "step": step,
            "error": {
                "code": error.code,
                "title": error.title,
                "message": error.message,
                "recoverable": error.recoverable,
                "details": error.details,
            }
        }),
    );
}

/// 将 runtime 下载/解压阶段同步推送给前端，供阻断弹框展示安装进度。
fn emit_runtime_bundle_progress(app: &AppHandle, progress: RuntimeBundleProgress) {
    let _ = app.emit(RUNTIME_BUNDLE_EVENT_NAME, progress);
}

/// 仅准备 Codex runtime 与案件知识库 graphify 依赖包，不启动 app-server，供桌面端启动阶段先行检测和下载。
#[tauri::command]
pub async fn codex_prepare_runtime_bundle(app: AppHandle) -> Result<(), AppError> {
    let app_state = app.state::<AppState>();
    let _prepare_guard = app_state.runtime_bundle_prepare.lock().await;
    tokio::task::block_in_place(|| {
        let mut primary_runtime_reporter = |progress: RuntimeBundleProgress| {
            if progress.status != RuntimeBundleStatus::Ready {
                emit_runtime_bundle_progress(&app, progress);
            }
        };
        crate::runtime_bundle::ensure_primary_runtime_bundle_with_reporter(
            &mut primary_runtime_reporter,
        )?;
        let mut knowledge_runtime_reporter = |progress: RuntimeBundleProgress| {
            emit_runtime_bundle_progress(&app, progress);
        };
        crate::knowledge_runtime::ensure_knowledge_runtime_with_reporter(
            &mut knowledge_runtime_reporter,
        )
    })
    .map(|_| ())
    .inspect_err(|error| {
        emit_runtime_bundle_progress(
            &app,
            RuntimeBundleProgress {
                status: RuntimeBundleStatus::Failed,
                message: error.message.clone(),
                step_current: None,
                step_total: None,
                downloaded_bytes: None,
                total_bytes: None,
            },
        );
        log_runtime_start_failure("prepare_runtime_bundle_only", error);
    })
}

/// 启动 Codex app-server runtime。
#[tauri::command]
pub async fn codex_start_runtime(
    profile_id: String,
    state: State<'_, AppState>,
    local_mcp: State<'_, crate::local_mcp_server::LocalMcpRuntimeState>,
    app: AppHandle,
) -> Result<(), AppError> {
    let _startup_guard = state.runtime_startup.lock().await;
    log_with_details(
        "INFO",
        "codex_runtime_start_requested",
        "收到启动 Codex runtime 请求",
        json!({ "profileId": profile_id }),
    );
    let app_config = crate::commands::local_data::initialize_local_home().map_err(|err| {
        let error = AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "读取本地工作空间配置失败",
            err,
            true,
        );
        log_runtime_start_failure("initialize_local_home", &error);
        error
    })?;
    let local_mcp_url = local_mcp
        .ensure_started(
            (!app_config.workspace_database.trim().is_empty())
                .then(|| std::path::PathBuf::from(app_config.workspace_database.as_str())),
        )
        .map_err(|err| {
            let error = AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "启动内置本地 MCP server 失败",
                err,
                true,
            );
            log_runtime_start_failure("ensure_local_mcp_started", &error);
            error
        })?;
    let mut guard = state.codex.lock().await;
    clear_stale_runtime_if_exited(&mut guard)?;
    if guard.is_some() {
        let runtime = guard.as_ref().expect("guard.is_some checked above");
        let client = runtime.client.clone();
        let codex_home = runtime.codex_home.clone();
        drop(guard);

        cleanup_legacy_builtin_skills(&codex_home)?;
        client.configure_codex_memory_feature().await?;
        ensure_builtin_local_mcp_server_config(&codex_home, &local_mcp_url)?;
        client
            .request::<_, serde_json::Value>("config/mcpServer/reload", json!({}))
            .await?;
        app.emit(CODEX_EVENT_NAME, CodexUiEvent::RuntimeStarted)
            .map_err(|err| emit_error(err.to_string()))?;
        log_info(
            "codex_runtime_reused",
            "复用已存在的 Codex runtime，并完成本地 MCP 配置热刷新",
        );
        return Ok(());
    }

    let codex_home = profile_codex_home(&profile_id)?;
    log_with_details(
        "INFO",
        "codex_runtime_start_step",
        "Codex runtime 启动准备：profile 目录已解析",
        json!({ "profileId": profile_id, "codexHome": codex_home }),
    );
    let access_token = prepare_codex_runtime_home(&codex_home).inspect_err(|error| {
        log_runtime_start_failure("prepare_codex_runtime_home", error);
    })?;
    cleanup_legacy_builtin_skills(&codex_home).inspect_err(|error| {
        log_runtime_start_failure("cleanup_legacy_builtin_skills", error);
    })?;
    log_info(
        "codex_runtime_legacy_skills_cleaned",
        "Codex runtime 旧版本地 skills 已清理",
    );
    ensure_builtin_local_mcp_server_config(&codex_home, &local_mcp_url).inspect_err(|error| {
        log_runtime_start_failure("ensure_builtin_local_mcp_server_config", error);
    })?;
    let model_instructions_file =
        ensure_model_instructions_file(&codex_home).inspect_err(|error| {
            log_runtime_start_failure("ensure_model_instructions_file", error);
        })?;
    let mut runtime_bundle_reporter = |progress: RuntimeBundleProgress| {
        emit_runtime_bundle_progress(&app, progress);
    };
    let _bundle_prepare_guard = state.runtime_bundle_prepare.lock().await;
    let process = tokio::task::block_in_place(|| {
        CodexProcessManager::start(&codex_home, &access_token, &mut runtime_bundle_reporter)
    })
    .inspect_err(|error| {
        emit_runtime_bundle_progress(
            &app,
            RuntimeBundleProgress {
                status: RuntimeBundleStatus::Failed,
                message: error.message.clone(),
                step_current: None,
                step_total: None,
                downloaded_bytes: None,
                total_bytes: None,
            },
        );
        log_runtime_start_failure("start_app_server_process", error);
    })?;
    log_info(
        "codex_runtime_process_started",
        "Codex runtime sidecar 进程已启动",
    );
    let client = crate::appserver_client::AppServerJsonRpcClient::new(
        process.stdin,
        process.stdout,
        process.stderr,
        app.clone(),
    );
    client.initialize().await.inspect_err(|error| {
        log_runtime_start_failure("initialize_app_server_client", error);
    })?;
    client
        .configure_codex_memory_feature()
        .await
        .inspect_err(|error| {
            log_runtime_start_failure("configure_codex_memory_feature", error);
        })?;
    client
        .configure_lex_vault_model(&model_instructions_file)
        .await
        .inspect_err(|error| {
            log_runtime_start_failure("configure_lex_vault_model", error);
        })?;
    client
        .enable_runtime_features()
        .await
        .inspect_err(|error| {
            log_runtime_start_failure("enable_runtime_features", error);
        })?;
    app.emit(CODEX_EVENT_NAME, CodexUiEvent::RuntimeStarted)
        .map_err(|err| emit_error(err.to_string()))?;
    log_info("codex_runtime_started", "Codex runtime 启动并初始化完成");

    *state.current_profile.write().await = Some(profile_id);
    *guard = Some(CodexRuntime {
        process: CodexProcess {
            child: process.child,
        },
        client,
        codex_home,
    });

    Ok(())
}

/// 停止 Codex app-server runtime。
#[tauri::command]
pub async fn codex_stop_runtime(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), AppError> {
    log_info(
        "codex_runtime_stop_requested",
        "收到停止 Codex runtime 请求",
    );
    let mut guard = state.codex.lock().await;
    if let Some(mut runtime) = guard.take() {
        let _ = runtime.process.child.kill().await;
    }
    *state.current_thread.write().await = None;
    app.emit(CODEX_EVENT_NAME, CodexUiEvent::RuntimeStopped)
        .map_err(|err| emit_error(err.to_string()))?;
    Ok(())
}

/// 创建新的 Codex thread。
#[tauri::command]
pub async fn codex_start_thread(
    req: StartThreadRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ThreadInfo, AppError> {
    validate_workspace(&req.cwd)?;
    log_with_details(
        "INFO",
        "codex_thread_start_requested",
        "开始创建新的 Codex thread",
        json!({ "cwd": req.cwd, "ephemeral": req.ephemeral }),
    );
    let runtime = runtime_client(&state).await?;
    let response: ThreadStartResponse = runtime
        .client
        .start_thread(req.cwd.clone(), req.ephemeral)
        .await?;
    let thread = ThreadInfo {
        id: response.thread.id,
        cwd: response.thread.cwd.display().to_string(),
        ephemeral: response.thread.ephemeral,
    };
    *state.current_thread.write().await = Some(thread.id.clone());
    app.emit(
        CODEX_EVENT_NAME,
        CodexUiEvent::ThreadStarted {
            thread: thread.clone(),
        },
    )
    .map_err(|err| emit_error(err.to_string()))?;
    audit(&runtime.codex_home, "thread_started", json!(&thread));
    Ok(thread)
}

/// 恢复已有 Codex thread。
#[tauri::command]
pub async fn codex_resume_thread(
    req: ResumeThreadRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ThreadInfo, AppError> {
    if let Some(cwd) = req.cwd.as_deref() {
        validate_workspace(cwd)?;
    }
    log_with_details(
        "INFO",
        "codex_thread_resume_requested",
        "开始恢复 Codex thread",
        json!({ "threadId": req.thread_id, "cwd": req.cwd }),
    );
    let runtime = runtime_client(&state).await?;
    let response: ThreadResumeResponse = runtime
        .client
        .resume_thread(req.thread_id.clone(), req.cwd.clone())
        .await?;
    let thread = ThreadInfo {
        id: response.thread.id,
        cwd: response.thread.cwd.display().to_string(),
        ephemeral: response.thread.ephemeral,
    };
    *state.current_thread.write().await = Some(thread.id.clone());
    app.emit(
        CODEX_EVENT_NAME,
        CodexUiEvent::ThreadStarted {
            thread: thread.clone(),
        },
    )
    .map_err(|err| emit_error(err.to_string()))?;
    audit(&runtime.codex_home, "thread_resumed", json!(&thread));
    Ok(thread)
}

/// 查询 Codex app-server 原生 thread 历史。
#[tauri::command]
pub async fn codex_list_threads(
    req: ListThreadsRequest,
    state: State<'_, AppState>,
) -> Result<CodexThreadListResult, AppError> {
    if let Some(cwd) = req.cwd.as_deref() {
        validate_workspace(cwd)?;
    }
    log_with_details(
        "INFO",
        "codex_thread_list_requested",
        "开始读取 Codex thread 历史列表",
        json!({ "cwd": req.cwd, "limit": req.limit }),
    );
    let runtime = runtime_client(&state).await?;
    let response: ThreadListResponse = runtime.client.list_threads(req.cwd, req.limit).await?;
    Ok(CodexThreadListResult {
        data: response
            .data
            .into_iter()
            .map(thread_record_from_summary)
            .collect(),
        next_cursor: response.next_cursor,
        backwards_cursor: response.backwards_cursor,
    })
}

/// 读取 Codex app-server 原生 thread 详情。
#[tauri::command]
pub async fn codex_read_thread(
    req: ReadThreadRequest,
    state: State<'_, AppState>,
) -> Result<CodexThreadRecord, AppError> {
    log_with_details(
        "INFO",
        "codex_thread_read_requested",
        "开始读取 Codex thread 详情",
        json!({ "threadId": req.thread_id, "includeTurns": req.include_turns }),
    );
    let runtime = runtime_client(&state).await?;
    let response: ThreadReadResponse = runtime
        .client
        .read_thread(req.thread_id, req.include_turns.unwrap_or(false))
        .await?;
    Ok(thread_record_from_summary(response.thread))
}

/// 发起律师助手 turn。
#[tauri::command]
pub async fn codex_start_legal_turn(
    mut req: StartLegalTurnRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TurnInfo, AppError> {
    validate_workspace(&req.cwd)?;
    req.developer_instructions = merge_developer_instructions(
        req.developer_instructions.as_deref(),
        workspace_directory_developer_instructions()?,
    );
    log_with_details(
        "INFO",
        "codex_turn_start_requested",
        "开始发起 Codex turn",
        json!({
            "threadId": req.thread_id,
            "cwd": req.cwd,
            "skillName": req.skill_name,
            "attachmentCount": req.attachments.len(),
            "pluginMentionCount": req.plugin_mentions.len(),
        }),
    );
    let runtime = runtime_client(&state).await?;
    let skill_name = req
        .skill_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let skill_path = skill_name
        .as_deref()
        .and_then(|name| resolve_skill_path(&runtime.codex_home, name));
    let response: TurnStartResponse = runtime
        .client
        .start_legal_turn(req.clone(), skill_path.as_deref())
        .await?;
    let turn = TurnInfo {
        id: response.turn.id,
        thread_id: req.thread_id,
        status: response.turn.status,
        token_usage: None,
    };
    app.emit(
        CODEX_EVENT_NAME,
        CodexUiEvent::TurnStarted { turn: turn.clone() },
    )
    .map_err(|err| emit_error(err.to_string()))?;
    audit(
        &runtime.codex_home,
        "skill_used",
        json!({"skillName": skill_name, "turnId": turn.id, "threadId": turn.thread_id}),
    );
    Ok(turn)
}

/// 从本机配置生成每轮 turn 隐藏注入的工作区目录说明。
fn workspace_directory_developer_instructions() -> Result<Option<String>, AppError> {
    let config = get_app_config().map_err(|err| {
        AppError::new(
            "APP_CONFIG_READ_FAILED",
            "读取工作区目录配置失败",
            err,
            true,
        )
    })?;
    Ok(build_workspace_directory_developer_instructions(&config))
}

/// 构造让模型理解 Lex Vault 内置目录语义的隐藏 developer instructions。
pub(crate) fn build_workspace_directory_developer_instructions(
    config: &AppConfig,
) -> Option<String> {
    let workspace_root = config.workspace_root.trim();
    if workspace_root.is_empty() {
        return None;
    }
    let doc_template = fallback_directory(&config.doc_template, workspace_root, "doc");
    let law_directory = fallback_directory(&config.law_directory, workspace_root, "law");
    let case_ref = fallback_directory(&config.case_ref, workspace_root, "case");
    let case_master = fallback_directory(&config.case_master, workspace_root, "master");

    Some(
        [
            "以下是 Lex Vault 当前工作区的隐藏目录上下文，请在理解用户问题时使用这些目录语义。",
            &format!("- workspaceRoot：{workspace_root}"),
            &format!("- <workspaceRoot>/doc/ 是文书模板目录，当前实际路径：{doc_template}"),
            &format!("- <workspaceRoot>/law/ 是法规资料目录，当前实际路径：{law_directory}"),
            &format!("- <workspaceRoot>/case/ 是案例资料目录，当前实际路径：{case_ref}"),
            &format!("- <workspaceRoot>/master/ 是案件存储根目录，当前实际路径：{case_master}"),
            "当需要检索工作区内的代码、文书、法规、案例、日志、JSON、Markdown 或其他文本文件内容时，优先使用 rg 检索，不要默认逐个文件硬读。",
            "律隐台会把随包分发的工具目录前置到运行时 PATH；如需显式定位该目录，可读取环境变量 LEX_VAULT_TOOLS_DIR，Windows 内置检索工具位于该目录下的 rg.exe。",
            "当当前任务需要下载、安装或更新 Python / Node.js 依赖时，优先使用国内镜像源，避免默认海外源过慢；除非用户明确指定其他源，Python 默认使用 https://pypi.tuna.tsinghua.edu.cn/simple，Node 默认使用 https://registry.npmmirror.com。",
            "如果需要给出安装命令，请优先让 pip、uv、pipx、poetry、npm、pnpm、yarn、npx 等命令显式继承或使用上述镜像配置；如果现有命令已经自带 index-url 或 registry 参数，则保持用户或项目原有覆盖优先。",
            "当用户提到模板、法规、案例、案件目录或相关文件时，请优先结合以上目录语义理解，不要把这些内置目录名当作无意义路径片段。",
            "当用户要求基于案件材料梳理事实、证据、时间线、争议焦点、证明目的或材料检索时，优先使用 lex_vault_local 提供的 case_graphify_status / case_graphify_build / case_graphify_search / case_graphify_read 工具读取案件知识库索引。",
            "如果当前案件还没有 graphify 索引，或索引已经过期，请先构建索引再回答，不要默认逐个硬读大文件；优先使用 graphify-extract 模式结果，只有在 indexMode 显示 fallback-local-text 时才把它视为保底索引。",
            "当用户需要联网搜索公开网页信息时，默认优先使用 lex_vault_local 提供的 web_search 工具；当用户明确要搜微信公众号文章、微信公开内容或搜狗微信结果时，默认优先使用 lex_vault_local 提供的 wechat_search 工具；当前运行时已通过顶层配置关闭模型或 provider 自带的 web search。",
            "如果本地 web_search 或 wechat_search 当前不可用、报错或超时，应先说明本地网页检索链路异常，再决定是否重试；不要静默切换到其他内置 web search。",
        ]
        .join("\n"),
    )
}

/// 保留已有专项技能 instructions，并追加工作区目录上下文。
pub(crate) fn merge_developer_instructions(
    current: Option<&str>,
    workspace_instructions: Option<String>,
) -> Option<String> {
    let current = current.map(str::trim).filter(|value| !value.is_empty());
    let workspace = workspace_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match (current, workspace) {
        (Some(left), Some(right)) => Some(format!("{left}\n\n{right}")),
        (Some(value), None) | (None, Some(value)) => Some(value.to_string()),
        (None, None) => None,
    }
}

/// 使用配置路径；配置缺省时回退到工作区默认目录名。
fn fallback_directory(configured: &str, workspace_root: &str, default_name: &str) -> String {
    let configured = configured.trim();
    if configured.is_empty() {
        return std::path::Path::new(workspace_root)
            .join(default_name)
            .display()
            .to_string();
    }
    configured.to_string()
}

/// 解析当前运行时中某个 skill 的真实路径，兼容顶层 skills 和 `.system` 内置 skills。
pub(crate) fn resolve_skill_path(
    codex_home: &std::path::Path,
    skill_name: &str,
) -> Option<std::path::PathBuf> {
    let normalized_skill_name = skill_name.trim();
    if normalized_skill_name.is_empty() {
        return None;
    }

    let direct_path = codex_home
        .join("skills")
        .join(normalized_skill_name)
        .join("SKILL.md");
    if direct_path.is_file() {
        return Some(direct_path);
    }

    let system_path = codex_home
        .join("skills")
        .join(".system")
        .join(normalized_skill_name)
        .join("SKILL.md");
    if system_path.is_file() {
        return Some(system_path);
    }

    None
}

/// 中断当前 Codex turn，保留 app-server runtime 供后续会话继续复用。
#[tauri::command]
pub async fn codex_interrupt_turn(
    req: InterruptTurnRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let runtime = runtime_client(&state).await?;
    runtime
        .client
        .interrupt_turn(req.thread_id, req.turn_id)
        .await?;
    Ok(())
}

/// 触发当前 Codex thread 的上下文压缩。
#[tauri::command]
pub async fn codex_compact_thread(
    req: CompactThreadRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log_with_details(
        "INFO",
        "codex_thread_compact_requested",
        "开始触发 Codex thread 上下文压缩",
        json!({ "threadId": req.thread_id }),
    );
    let runtime = runtime_client(&state).await?;
    runtime.client.compact_thread(req.thread_id.clone()).await?;
    audit(
        &runtime.codex_home,
        "thread_compaction_started",
        json!({ "threadId": req.thread_id }),
    );
    Ok(())
}

/// 显式切换单个 Codex thread 的 app-server 记忆模式。
#[tauri::command]
pub async fn codex_set_thread_memory_mode(
    req: ThreadMemoryModeRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mode = match req.mode.trim().to_ascii_lowercase().as_str() {
        "enabled" => ThreadMemoryMode::Enabled,
        "disabled" => ThreadMemoryMode::Disabled,
        _ => {
            return Err(AppError::new(
                "THREAD_MEMORY_MODE_INVALID",
                "记忆模式不支持",
                format!("mode={}", req.mode),
                true,
            ));
        }
    };
    let runtime = runtime_client(&state).await?;
    runtime
        .client
        .set_thread_memory_mode(req.thread_id.clone(), mode)
        .await?;
    audit(
        &runtime.codex_home,
        "thread_memory_mode_changed",
        json!({ "threadId": req.thread_id, "mode": mode }),
    );
    Ok(())
}

/// 清空当前运行时下 app-server 生成的 memory 产物。
#[tauri::command]
pub async fn codex_reset_memory(state: State<'_, AppState>) -> Result<(), AppError> {
    let runtime = runtime_client(&state).await?;
    runtime.client.reset_memory().await?;
    audit(&runtime.codex_home, "memory_reset", json!({}));
    Ok(())
}

/// 查询插件市场与插件列表。
#[tauri::command]
pub async fn codex_list_plugins(
    state: State<'_, AppState>,
) -> Result<CodexPluginListResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime.client.list_plugins().await?;
    Ok(plugin_list_result_from_value(response))
}

/// 读取单个插件详情。
#[tauri::command]
pub async fn codex_read_plugin(
    req: PluginLookupRequest,
    state: State<'_, AppState>,
) -> Result<CodexPluginDetails, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime
        .client
        .read_plugin(req.marketplace_path, req.plugin_name)
        .await?;
    Ok(plugin_details_from_value(response))
}

/// 安装单个插件。
#[tauri::command]
pub async fn codex_install_plugin(
    req: PluginLookupRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime
        .client
        .install_plugin(req.marketplace_path, req.plugin_name)
        .await?;
    audit(&runtime.codex_home, "plugin_installed", response.clone());
    Ok(operation_result_from_value("插件安装完成", response))
}

/// 卸载单个插件。
#[tauri::command]
pub async fn codex_uninstall_plugin(
    req: UninstallPluginRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime.client.uninstall_plugin(req.plugin_id).await?;
    audit(&runtime.codex_home, "plugin_uninstalled", response.clone());
    Ok(operation_result_from_value("插件卸载完成", response))
}

/// 切换单个插件是否启用。
#[tauri::command]
pub async fn codex_set_plugin_enabled(
    req: PluginEnablementRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime
        .client
        .set_plugin_enabled(req.plugin_id.clone(), req.enabled)
        .await?;
    audit(
        &runtime.codex_home,
        "plugin_enablement_changed",
        json!({
            "pluginId": req.plugin_id,
            "enabled": req.enabled,
            "response": response.clone()
        }),
    );
    Ok(operation_result_from_value(
        if req.enabled {
            "插件已启用"
        } else {
            "插件已停用"
        },
        response,
    ))
}

/// 添加远程插件市场。
#[tauri::command]
pub async fn codex_add_marketplace(
    req: AddMarketplaceRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime.client.add_marketplace(req.source).await?;
    audit(&runtime.codex_home, "marketplace_added", response.clone());
    Ok(operation_result_from_value("插件市场添加完成", response))
}

/// 移除已配置插件市场。
#[tauri::command]
pub async fn codex_remove_marketplace(
    req: RemoveMarketplaceRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime.client.remove_marketplace(req.name).await?;
    audit(&runtime.codex_home, "marketplace_removed", response.clone());
    Ok(operation_result_from_value("插件市场已移除", response))
}

/// 升级一个或全部插件市场。
#[tauri::command]
pub async fn codex_upgrade_marketplace(
    req: UpgradeMarketplaceRequest,
    state: State<'_, AppState>,
) -> Result<CodexOperationResult, AppError> {
    let runtime = runtime_client(&state).await?;
    let response = runtime
        .client
        .upgrade_marketplace(req.marketplace_name)
        .await?;
    audit(
        &runtime.codex_home,
        "marketplace_upgraded",
        response.clone(),
    );
    Ok(operation_result_from_value("插件市场升级完成", response))
}

/// 回传前端审批决策。
#[tauri::command]
pub async fn codex_respond_approval(
    req: ApprovalDecisionRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), AppError> {
    let runtime = runtime_client(&state).await?;
    runtime.client.respond_approval(req.clone()).await?;
    app.emit(
        CODEX_EVENT_NAME,
        CodexUiEvent::ApprovalCompleted {
            request_id: req.request_id.clone(),
            decision: req.decision.clone(),
        },
    )
    .map_err(|err| emit_error(err.to_string()))?;
    audit(
        &runtime.codex_home,
        "approval_decided",
        json!({"requestId": req.request_id, "decision": req.decision}),
    );
    Ok(())
}
