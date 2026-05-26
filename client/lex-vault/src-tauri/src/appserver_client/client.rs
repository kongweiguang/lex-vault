use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use sanitize_filename::sanitize;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStderr;
use tokio::sync::{oneshot, Mutex};

use crate::appserver_client::model_config::{
    codex_memory_feature_config_batch_params, codex_memory_feature_config_is_current,
    lex_vault_model_config_batch_params, lex_vault_model_config_is_current,
};
use crate::appserver_client::params::{
    experimental_feature_enablement_params, legal_turn_start_params, legal_user_text,
    plugin_enablement_write_params, thread_compact_start_params, thread_list_params,
    thread_read_params, thread_resume_params, thread_start_params, turn_interrupt_params,
    RUNTIME_EXPERIMENTAL_FEATURES,
};
use crate::appserver_client::protocol::{
    CompletedTurnOutput, StartLegalTurnAttachment, StartLegalTurnRequest, ThreadListResponse,
    ThreadMemoryMode, ThreadReadResponse, ThreadResumeResponse, ThreadStartResponse,
    TurnStartResponse,
};
use crate::conversation_trace::append_trace;
use crate::event_normalizer::{
    normalize_approval_request, ApprovalDecisionKind, ApprovalDecisionRequest, CodexUiEvent,
};
use crate::jsonrpc::{
    AppError, JsonRpcError, JsonRpcIncoming, JsonRpcNotification, JsonRpcRequest,
};
use crate::logging::{log_error, log_info, log_with_details};

pub const CODEX_EVENT_NAME: &str = "codex://event";
const CLIENT_NAME: &str = "lex_vault_desktop";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const TURN_COMPLETION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MCP_ELICITATION_REQUEST_METHOD: &str = "mcpServer/elicitation/request";

#[derive(Clone)]
pub struct AppServerJsonRpcClient {
    /// 写入 app-server stdin 的共享句柄。
    writer: Arc<Mutex<tokio::process::ChildStdin>>,
    /// JSON-RPC 请求自增 ID。
    next_id: Arc<AtomicU64>,
    /// 等待 JSON-RPC response 的请求表。
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>,
    /// 等待前端审批回写的 app-server 主动请求表。
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    /// 等待指定 turn 完成并收集最终回复文本的桥接请求表。
    turn_completions: Arc<Mutex<HashMap<String, PendingTurnCompletion>>>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    request_id: Value,
    method: String,
}

/// 微信等外部入口等待某个 turn 完成时使用的临时聚合状态。
pub(super) struct PendingTurnCompletion {
    /// 已流式收到的最终回答文本。
    pub(super) output_text: String,
    /// 等待完成结果的一次性回调。
    pub(super) sender: Option<oneshot::Sender<Result<CompletedTurnOutput, AppError>>>,
}

impl AppServerJsonRpcClient {
    pub fn new(
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
        stderr: ChildStderr,
        app: AppHandle,
    ) -> Self {
        let client = Self {
            writer: Arc::new(Mutex::new(stdin)),
            next_id: Arc::new(AtomicU64::new(1)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            approvals: Arc::new(Mutex::new(HashMap::new())),
            turn_completions: Arc::new(Mutex::new(HashMap::new())),
        };
        client.spawn_stdout_reader(stdout, app.clone());
        spawn_stderr_reader(stderr, app);
        client
    }

    pub async fn initialize(&self) -> Result<Value, AppError> {
        log_info(
            "app_server_initialize_started",
            "开始初始化 Codex app-server 连接",
        );
        let response: Value = self
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": CLIENT_NAME,
                        "title": "Lex Vault Desktop",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true
                    }
                }),
            )
            .await
            .map_err(|err| {
                AppError::new(
                    "APP_SERVER_INITIALIZE_FAILED",
                    "Codex app-server 初始化失败",
                    err.message,
                    true,
                )
            })?;

        self.notify("initialized", json!({})).await?;
        log_info(
            "app_server_initialize_completed",
            "Codex app-server 初始化握手完成",
        );
        Ok(response)
    }

    pub async fn configure_lex_vault_model(
        &self,
        model_instructions_file: &Path,
    ) -> Result<(), AppError> {
        let current_config: Value = self
            .request(
                "config/read",
                json!({
                    "includeLayers": false,
                    "cwd": null
                }),
            )
            .await?;

        if lex_vault_model_config_is_current(&current_config, model_instructions_file) {
            return Ok(());
        }

        let _: Value = self
            .request(
                "config/batchWrite",
                lex_vault_model_config_batch_params(model_instructions_file),
            )
            .await?;
        Ok(())
    }

    /// 按 app-server 官方配置写入能力启用 Codex memories。
    pub async fn configure_codex_memory_feature(&self) -> Result<(), AppError> {
        let current_config: Value = self
            .request(
                "config/read",
                json!({
                    "includeLayers": false,
                    "cwd": null
                }),
            )
            .await?;

        if codex_memory_feature_config_is_current(&current_config) {
            return Ok(());
        }

        let _: Value = self
            .request(
                "config/batchWrite",
                codex_memory_feature_config_batch_params(),
            )
            .await?;
        Ok(())
    }

    /// 启用 Lex Vault 当前会用到的 app-server 实验特性。
    pub async fn enable_runtime_features(&self) -> Result<(), AppError> {
        for feature_name in RUNTIME_EXPERIMENTAL_FEATURES {
            let _: Value = self
                .request(
                    "experimentalFeature/enablement/set",
                    experimental_feature_enablement_params(feature_name, true),
                )
                .await?;
        }
        Ok(())
    }

    pub async fn start_thread(
        &self,
        cwd: String,
        ephemeral: Option<bool>,
    ) -> Result<ThreadStartResponse, AppError> {
        self.request("thread/start", thread_start_params(cwd, ephemeral))
            .await
    }

    pub async fn resume_thread(
        &self,
        thread_id: String,
        cwd: Option<String>,
    ) -> Result<ThreadResumeResponse, AppError> {
        self.request("thread/resume", thread_resume_params(thread_id, cwd))
            .await
    }

    pub async fn list_threads(
        &self,
        cwd: Option<String>,
        limit: Option<u32>,
    ) -> Result<ThreadListResponse, AppError> {
        self.request("thread/list", thread_list_params(cwd, limit))
            .await
    }

    pub async fn read_thread(
        &self,
        thread_id: String,
        include_turns: bool,
    ) -> Result<ThreadReadResponse, AppError> {
        self.request("thread/read", thread_read_params(thread_id, include_turns))
            .await
    }

    /// 设置 thread 的持久化记忆资格。
    pub async fn set_thread_memory_mode(
        &self,
        thread_id: String,
        mode: ThreadMemoryMode,
    ) -> Result<(), AppError> {
        let _: Value = self
            .request(
                "thread/memoryMode/set",
                json!({
                    "threadId": thread_id,
                    "mode": mode,
                }),
            )
            .await?;
        Ok(())
    }

    /// 清空当前 `CODEX_HOME` 下的 memory 产物和 sqlite 阶段数据。
    pub async fn reset_memory(&self) -> Result<(), AppError> {
        let _: Value = self.request("memory/reset", Option::<()>::None).await?;
        Ok(())
    }

    pub async fn start_legal_turn(
        &self,
        req: StartLegalTurnRequest,
        skill_path: Option<&Path>,
    ) -> Result<TurnStartResponse, AppError> {
        let prepared_input = self.prepare_legal_turn_input(&req).await?;
        self.request(
            "turn/start",
            legal_turn_start_params(
                req,
                skill_path,
                prepared_input.text,
                prepared_input.extra_input,
            ),
        )
        .await
    }

    /// 发起 turn 并等待其完成，返回最终回答文本，供微信等非前端入口同步拿到回复。
    pub async fn start_legal_turn_and_wait(
        &self,
        req: StartLegalTurnRequest,
        skill_path: Option<&Path>,
    ) -> Result<CompletedTurnOutput, AppError> {
        let thread_id = req.thread_id.clone();
        let thread_key = turn_thread_waiting_key(&thread_id);
        let (sender, receiver) = oneshot::channel();
        {
            let mut completions = self.turn_completions.lock().await;
            if completions.contains_key(&thread_key) {
                return Err(AppError::new(
                    "TURN_COMPLETION_ALREADY_WAITING",
                    "当前 thread 已有等待中的 turn",
                    format!("threadId={thread_id}"),
                    true,
                ));
            }
            completions.insert(
                thread_key.clone(),
                PendingTurnCompletion {
                    output_text: String::new(),
                    sender: Some(sender),
                },
            );
        }

        let response = match self.start_legal_turn(req, skill_path).await {
            Ok(response) => response,
            Err(error) => {
                self.turn_completions.lock().await.remove(&thread_key);
                return Err(error);
            }
        };
        let turn_id = response.turn.id.clone();
        let key = turn_completion_key(&thread_id, &turn_id);
        {
            let mut completions = self.turn_completions.lock().await;
            if !completions.contains_key(&key) {
                if let Some(completion) = completions.remove(&thread_key) {
                    completions.insert(key.clone(), completion);
                }
            }
        }

        let result = match tokio::time::timeout(TURN_COMPLETION_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                remove_turn_completion_waiter(&self.turn_completions, &key, &thread_key).await;
                return Err(AppError::new(
                    "TURN_COMPLETION_CANCELED",
                    "等待 Codex turn 完成被取消",
                    format!("threadId={thread_id} turnId={turn_id}"),
                    true,
                ));
            }
            Err(_) => {
                remove_turn_completion_waiter(&self.turn_completions, &key, &thread_key).await;
                return Err(AppError::new(
                    "TURN_COMPLETION_TIMEOUT",
                    "等待 Codex turn 完成超时",
                    format!("threadId={thread_id} turnId={turn_id}"),
                    true,
                ));
            }
        };
        remove_turn_completion_waiter(&self.turn_completions, &key, &thread_key).await;
        result
    }

    pub async fn interrupt_turn(
        &self,
        thread_id: String,
        turn_id: String,
    ) -> Result<Value, AppError> {
        self.request("turn/interrupt", turn_interrupt_params(thread_id, turn_id))
            .await
    }

    /// 触发 app-server 原生 thread 上下文压缩，进度继续走标准 turn/item notification。
    pub async fn compact_thread(&self, thread_id: String) -> Result<Value, AppError> {
        self.request(
            "thread/compact/start",
            thread_compact_start_params(thread_id),
        )
        .await
    }

    /// 查询插件市场和插件清单。
    pub async fn list_plugins(&self) -> Result<Value, AppError> {
        self.request("plugin/list", json!({})).await
    }

    /// 读取单个插件详情。
    pub async fn read_plugin(
        &self,
        marketplace_path: String,
        plugin_name: String,
    ) -> Result<Value, AppError> {
        self.request(
            "plugin/read",
            json!({
                "marketplacePath": marketplace_path,
                "pluginName": plugin_name
            }),
        )
        .await
    }

    /// 安装单个插件。
    pub async fn install_plugin(
        &self,
        marketplace_path: String,
        plugin_name: String,
    ) -> Result<Value, AppError> {
        self.request(
            "plugin/install",
            json!({
                "marketplacePath": marketplace_path,
                "pluginName": plugin_name
            }),
        )
        .await
    }

    /// 卸载单个插件。
    pub async fn uninstall_plugin(&self, plugin_id: String) -> Result<Value, AppError> {
        self.request(
            "plugin/uninstall",
            json!({
                "pluginId": plugin_id
            }),
        )
        .await
    }

    /// 切换单个插件在当前 profile 配置中的启用状态。
    pub async fn set_plugin_enabled(
        &self,
        plugin_id: String,
        enabled: bool,
    ) -> Result<Value, AppError> {
        self.request(
            "config/batchWrite",
            plugin_enablement_write_params(plugin_id, enabled),
        )
        .await
    }

    /// 添加远程插件市场。
    pub async fn add_marketplace(&self, source: String) -> Result<Value, AppError> {
        self.request(
            "marketplace/add",
            json!({
                "source": source
            }),
        )
        .await
    }

    /// 移除已配置的插件市场。
    pub async fn remove_marketplace(&self, name: String) -> Result<Value, AppError> {
        self.request(
            "marketplace/remove",
            json!({
                "name": name
            }),
        )
        .await
    }

    /// 升级一个或全部插件市场。
    pub async fn upgrade_marketplace(
        &self,
        marketplace_name: Option<String>,
    ) -> Result<Value, AppError> {
        self.request(
            "marketplace/upgrade",
            json!({
                "marketplaceName": marketplace_name
            }),
        )
        .await
    }

    /// 通过 app-server 文件系统能力创建目录，统一复用同一条主进程桥接链路。
    pub async fn create_directory(&self, path: &Path) -> Result<(), AppError> {
        let _: Value = self
            .request(
                "fs/createDirectory",
                json!({
                    "path": path.display().to_string(),
                    "recursive": true
                }),
            )
            .await?;
        Ok(())
    }

    /// 通过 app-server 文件系统能力写入临时附件，避免桌面端和微信入口各自直接碰文件系统。
    pub async fn write_file_base64(&self, path: &Path, data_base64: &str) -> Result<(), AppError> {
        let _: Value = self
            .request(
                "fs/writeFile",
                json!({
                    "path": path.display().to_string(),
                    "dataBase64": data_base64
                }),
            )
            .await?;
        Ok(())
    }

    /// 将统一桥接请求转换为 app-server `turn/start.input` 所需的文本与多模态输入。
    async fn prepare_legal_turn_input(
        &self,
        req: &StartLegalTurnRequest,
    ) -> Result<PreparedLegalTurnInput, AppError> {
        let mut text = legal_user_text(req);
        let mut extra_input = Vec::new();
        let mut file_contexts = Vec::new();

        for (index, attachment) in req.attachments.iter().enumerate() {
            match self
                .prepare_legal_turn_attachment(&req.thread_id, attachment, index)
                .await?
            {
                PreparedAttachment::Input(input) => extra_input.push(input),
                PreparedAttachment::FileContext(context) => {
                    file_contexts.push(render_attachment_file_context(&context));
                }
            }
        }

        if !file_contexts.is_empty() {
            text = [text.trim(), file_contexts.join("\n\n").trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
        }

        Ok(PreparedLegalTurnInput { text, extra_input })
    }

    /// 统一处理桌面端和微信入口附件，必要时先经 app-server 文件系统能力落盘。
    async fn prepare_legal_turn_attachment(
        &self,
        thread_id: &str,
        attachment: &StartLegalTurnAttachment,
        index: usize,
    ) -> Result<PreparedAttachment, AppError> {
        if is_image_attachment(attachment) {
            if let Some(url) = selected_attachment_url(attachment) {
                return Ok(PreparedAttachment::Input(json!({
                    "type": "image",
                    "url": url
                })));
            }
        }

        let local_path = if let Some(path) = selected_attachment_path(attachment) {
            Some(path)
        } else if let Some(data_base64) = attachment_base64_payload(attachment) {
            let staged_path = staged_attachment_path(thread_id, attachment, index);
            if let Some(parent) = staged_path.parent() {
                self.create_directory(parent).await?;
            }
            self.write_file_base64(&staged_path, &data_base64).await?;
            Some(staged_path.display().to_string())
        } else {
            None
        };

        if is_image_attachment(attachment) {
            if let Some(path) = local_path {
                return Ok(PreparedAttachment::Input(json!({
                    "type": "localImage",
                    "path": path
                })));
            }
        }

        Ok(PreparedAttachment::FileContext(AttachmentFileContext {
            name: selected_attachment_name(attachment),
            kind: selected_attachment_kind(attachment),
            source: selected_attachment_source(attachment),
            mime_type: selected_attachment_mime_type(attachment),
            size: attachment.size,
            path: local_path,
        }))
    }

    pub async fn respond_approval(
        &self,
        decision: ApprovalDecisionRequest,
    ) -> Result<(), AppError> {
        let pending = self
            .approvals
            .lock()
            .await
            .remove(&decision.request_id)
            .ok_or_else(|| {
                AppError::new(
                    "APPROVAL_RESPONSE_FAILED",
                    "审批请求不存在或已处理",
                    decision.request_id.clone(),
                    true,
                )
            })?;

        let result = approval_response_for_method(&pending.method, &decision.decision);
        self.write_value(json!({
            "id": pending.request_id,
            "result": result
        }))
        .await?;

        Ok(())
    }

    pub async fn request<P, R>(&self, method: &str, params: P) -> Result<R, AppError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let started_at = Instant::now();
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let params_value = serde_json::to_value(&params).map_err(|err| {
            log_with_details(
                "ERROR",
                "app_server_request_params_serialize_failed",
                format!("请求参数序列化失败：{method}"),
                json!({ "id": id, "method": method, "error": err.to_string() }),
            );
            AppError::new(
                "APP_SERVER_PROTOCOL_ERROR",
                "请求参数序列化失败",
                err.to_string(),
                true,
            )
        })?;
        log_with_details(
            "INFO",
            "app_server_request_started",
            format!("发送 app-server 请求：{method}"),
            json!({ "id": id, "method": method, "params": params_value }),
        );
        append_trace(
            &trace_key_from_value(method, &params_value),
            "request_started",
            format!("发送 app-server 请求：{method}"),
            json!({ "id": id, "method": method, "params": params_value }),
        );

        self.write_value(
            serde_json::to_value(JsonRpcRequest { id, method, params }).map_err(|err| {
                log_with_details(
                    "ERROR",
                    "app_server_request_serialize_failed",
                    format!("JSON-RPC 请求序列化失败：{method}"),
                    json!({ "id": id, "method": method, "error": err.to_string() }),
                );
                AppError::new(
                    "APP_SERVER_PROTOCOL_ERROR",
                    "JSON-RPC 请求序列化失败",
                    err.to_string(),
                    true,
                )
            })?,
        )
        .await?;

        let response = tokio::time::timeout(REQUEST_TIMEOUT, rx)
            .await
            .map_err(|_| {
                log_with_details(
                    "ERROR",
                    "app_server_request_timeout",
                    format!("app-server 请求超时：{method}"),
                    json!({ "id": id, "method": method, "timeoutMs": REQUEST_TIMEOUT.as_millis() }),
                );
                AppError::new(
                    "APP_SERVER_REQUEST_TIMEOUT",
                    "app-server 请求超时",
                    method.to_string(),
                    true,
                )
            })?
            .map_err(|_| {
                log_with_details(
                    "ERROR",
                    "app_server_response_channel_closed",
                    format!("app-server response 通道已关闭：{method}"),
                    json!({ "id": id, "method": method }),
                );
                AppError::new(
                    "APP_SERVER_PROTOCOL_ERROR",
                    "app-server response 通道已关闭",
                    method.to_string(),
                    true,
                )
            })?
            .map_err(|err| {
                log_with_details(
                    "ERROR",
                    "app_server_request_failed",
                    format!("app-server 返回错误：{method}"),
                    json!({
                        "id": id,
                        "method": method,
                        "code": err.code,
                        "message": err.message,
                        "data": err.data,
                    }),
                );
                AppError::new(
                    "APP_SERVER_PROTOCOL_ERROR",
                    "app-server 返回错误",
                    err.message,
                    true,
                )
                .with_details(json!({"code": err.code, "data": err.data}))
            })?;

        let response_for_trace = response.clone();
        let parsed = serde_json::from_value(response).map_err(|err| {
            log_with_details(
                "ERROR",
                "app_server_response_parse_failed",
                format!("app-server response 解析失败：{method}"),
                json!({ "id": id, "method": method, "error": err.to_string() }),
            );
            AppError::new(
                "APP_SERVER_PROTOCOL_ERROR",
                "app-server response 解析失败",
                err.to_string(),
                true,
            )
        })?;
        log_with_details(
            "INFO",
            "app_server_request_completed",
            format!("app-server 请求完成：{method}"),
            json!({
                "id": id,
                "method": method,
                "durationMs": started_at.elapsed().as_millis(),
            }),
        );
        append_trace(
            &trace_key_from_value(method, &response_for_trace),
            "request_completed",
            format!("app-server 请求完成：{method}"),
            json!({
                "id": id,
                "method": method,
                "durationMs": started_at.elapsed().as_millis(),
                "result": response_for_trace,
            }),
        );
        Ok(parsed)
    }

    pub async fn notify<P>(&self, method: &str, params: P) -> Result<(), AppError>
    where
        P: Serialize,
    {
        log_with_details(
            "INFO",
            "app_server_notification_started",
            format!("发送 app-server notification：{method}"),
            json!({ "method": method }),
        );
        self.write_value(
            serde_json::to_value(JsonRpcNotification { method, params }).map_err(|err| {
                log_with_details(
                    "ERROR",
                    "app_server_notification_serialize_failed",
                    format!("JSON-RPC notification 序列化失败：{method}"),
                    json!({ "method": method, "error": err.to_string() }),
                );
                AppError::new(
                    "APP_SERVER_PROTOCOL_ERROR",
                    "JSON-RPC notification 序列化失败",
                    err.to_string(),
                    true,
                )
            })?,
        )
        .await
    }

    async fn write_value(&self, value: Value) -> Result<(), AppError> {
        let mut writer = self.writer.lock().await;
        let mut line = serde_json::to_vec(&value).map_err(|err| {
            log_with_details(
                "ERROR",
                "app_server_write_serialize_failed",
                "JSON-RPC 写入序列化失败",
                json!({ "error": err.to_string() }),
            );
            AppError::new(
                "APP_SERVER_PROTOCOL_ERROR",
                "JSON-RPC 写入序列化失败",
                err.to_string(),
                true,
            )
        })?;
        line.push(b'\n');
        writer.write_all(&line).await.map_err(|err| {
            log_with_details(
                "ERROR",
                "app_server_stdin_write_failed",
                "写入 app-server stdin 失败",
                json!({ "error": err.to_string() }),
            );
            AppError::new(
                "APP_SERVER_PROTOCOL_ERROR",
                "写入 app-server stdin 失败",
                err.to_string(),
                true,
            )
        })?;
        writer.flush().await.map_err(|err| {
            log_with_details(
                "ERROR",
                "app_server_stdin_flush_failed",
                "刷新 app-server stdin 失败",
                json!({ "error": err.to_string() }),
            );
            AppError::new(
                "APP_SERVER_PROTOCOL_ERROR",
                "刷新 app-server stdin 失败",
                err.to_string(),
                true,
            )
        })
    }

    fn spawn_stdout_reader(&self, stdout: tokio::process::ChildStdout, app: AppHandle) {
        let writer = self.writer.clone();
        let pending = self.pending.clone();
        let approvals = self.approvals.clone();
        let turn_completions = self.turn_completions.clone();
        let agent_message_phases = Arc::new(Mutex::new(HashMap::new()));
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        log_with_details(
                            "INFO",
                            "app_server_stdout_line",
                            "收到 app-server stdout JSON-RPC 行",
                            json!({ "line": line }),
                        );
                        append_trace(
                            &trace_key_from_stdout_line(&line),
                            "stdout_line",
                            "收到 app-server stdout JSON-RPC 行",
                            json!({ "line": line }),
                        );
                        handle_incoming_line(
                            &app,
                            &writer,
                            &pending,
                            &approvals,
                            &turn_completions,
                            &agent_message_phases,
                            &line,
                        )
                        .await;
                    }
                    Ok(None) => {
                        log_error("app_server_stdout_closed", "Codex app-server stdout 已关闭");
                        let _ = app.emit(
                            CODEX_EVENT_NAME,
                            CodexUiEvent::RuntimeFailed {
                                error: AppError::new(
                                    "CODEX_RUNTIME_START_FAILED",
                                    "Codex app-server 已退出",
                                    "stdout 已关闭",
                                    true,
                                ),
                            },
                        );
                        break;
                    }
                    Err(err) => {
                        log_with_details(
                            "ERROR",
                            "app_server_stdout_read_failed",
                            "读取 app-server stdout 失败",
                            json!({ "error": err.to_string() }),
                        );
                        let _ = app.emit(
                            CODEX_EVENT_NAME,
                            CodexUiEvent::RuntimeFailed {
                                error: AppError::new(
                                    "APP_SERVER_PROTOCOL_ERROR",
                                    "读取 app-server stdout 失败",
                                    err.to_string(),
                                    true,
                                ),
                            },
                        );
                        break;
                    }
                }
            }
        });
    }
}

async fn handle_incoming_line(
    app: &AppHandle,
    writer: &Arc<Mutex<tokio::process::ChildStdin>>,
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, JsonRpcError>>>>>,
    approvals: &Arc<Mutex<HashMap<String, PendingApproval>>>,
    turn_completions: &Arc<Mutex<HashMap<String, PendingTurnCompletion>>>,
    agent_message_phases: &Arc<Mutex<HashMap<String, String>>>,
    line: &str,
) {
    let incoming: JsonRpcIncoming = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(err) => {
            log_with_details(
                "ERROR",
                "app_server_invalid_jsonrpc_line",
                "app-server 输出不是合法 JSON-RPC",
                json!({ "error": err.to_string(), "line": line }),
            );
            let _ = app.emit(
                CODEX_EVENT_NAME,
                CodexUiEvent::Warning {
                    message: format!("app-server 输出不是合法 JSON-RPC: {err}"),
                },
            );
            return;
        }
    };

    if incoming.method.is_none() {
        if let Some(id) = incoming.id.and_then(|value| value.as_u64()) {
            log_with_details(
                "INFO",
                "app_server_response_received",
                "收到 app-server response",
                json!({ "id": id, "hasError": incoming.error.is_some() }),
            );
            if let Some(tx) = pending.lock().await.remove(&id) {
                let _ = tx.send(match incoming.error {
                    Some(error) => Err(error),
                    None => Ok(incoming.result.unwrap_or(Value::Null)),
                });
            }
        }
        return;
    }

    let method = incoming.method.unwrap_or_default();
    let mut params = incoming.params.unwrap_or_else(|| json!({}));
    if let Some(id) = incoming.id {
        log_with_details(
            "INFO",
            "app_server_request_received",
            format!("收到 app-server 主动 request：{method}"),
            json!({ "id": id, "method": method }),
        );
        if should_auto_approve_request(&method, &params) {
            log_with_details(
                "INFO",
                "app_server_request_auto_approved",
                format!("自动通过 app-server 主动 request：{method}"),
                json!({ "id": id, "method": method, "params": params }),
            );
            append_trace(
                &trace_key_from_value(&method, &params),
                "approval_auto_completed",
                format!("自动通过 app-server 主动 request：{method}"),
                json!({ "id": id, "method": method, "decision": "allow_once" }),
            );
            if let Err(err) = write_jsonrpc_value(
                writer,
                json!({
                    "id": id,
                    "result": approval_response_for_method(&method, &ApprovalDecisionKind::AllowOnce)
                }),
            )
            .await
            {
                let _ = app.emit(
                    CODEX_EVENT_NAME,
                    CodexUiEvent::Warning {
                        message: format!("自动通过 app-server 审批失败：{}", err.message),
                    },
                );
            }
            return;
        }
        let request_id = id
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| id.to_string());
        approvals.lock().await.insert(
            request_id.clone(),
            PendingApproval {
                request_id: id,
                method: method.clone(),
            },
        );
        let request = normalize_approval_request(request_id, &method, params);
        append_trace(
            &request.thread_id,
            "approval_request",
            format!("收到 app-server 主动 request：{method}"),
            json!({ "method": method, "request": request }),
        );
        let _ = app.emit(CODEX_EVENT_NAME, CodexUiEvent::ApprovalRequired { request });
        return;
    }

    {
        let mut phases = agent_message_phases.lock().await;
        remember_agent_message_phase(&method, &params, &mut phases);
        enrich_agent_message_delta_phase(&method, &mut params, &phases);
    }

    let event = crate::event_normalizer::EventNormalizer::normalize(&method, params);
    log_with_details(
        "INFO",
        "app_server_notification_received",
        format!("收到 app-server notification：{method}"),
        json!({ "method": method, "eventType": event_name(&event) }),
    );
    append_trace(
        &trace_key_from_event(&event),
        "normalized_event",
        format!("收到 app-server notification：{method}"),
        json!({ "method": method, "eventType": event_name(&event), "event": event }),
    );
    observe_turn_completion(turn_completions, &event).await;
    let _ = app.emit(CODEX_EVENT_NAME, event);
}

async fn write_jsonrpc_value(
    writer: &Arc<Mutex<tokio::process::ChildStdin>>,
    value: Value,
) -> Result<(), AppError> {
    let mut writer = writer.lock().await;
    let mut line = serde_json::to_vec(&value).map_err(|err| {
        log_with_details(
            "ERROR",
            "app_server_write_serialize_failed",
            "JSON-RPC 写入序列化失败",
            json!({ "error": err.to_string() }),
        );
        AppError::new(
            "APP_SERVER_PROTOCOL_ERROR",
            "JSON-RPC 写入序列化失败",
            err.to_string(),
            true,
        )
    })?;
    line.push(b'\n');
    writer.write_all(&line).await.map_err(|err| {
        log_with_details(
            "ERROR",
            "app_server_stdin_write_failed",
            "写入 app-server stdin 失败",
            json!({ "error": err.to_string() }),
        );
        AppError::new(
            "APP_SERVER_PROTOCOL_ERROR",
            "写入 app-server stdin 失败",
            err.to_string(),
            true,
        )
    })?;
    writer.flush().await.map_err(|err| {
        log_with_details(
            "ERROR",
            "app_server_stdin_flush_failed",
            "刷新 app-server stdin 失败",
            json!({ "error": err.to_string() }),
        );
        AppError::new(
            "APP_SERVER_PROTOCOL_ERROR",
            "刷新 app-server stdin 失败",
            err.to_string(),
            true,
        )
    })
}

/// 将 app-server 事件同步给等待 turn 完成的本机桥接调用。
pub(super) async fn observe_turn_completion(
    turn_completions: &Arc<Mutex<HashMap<String, PendingTurnCompletion>>>,
    event: &CodexUiEvent,
) {
    match event {
        CodexUiEvent::TurnStarted { turn } => {
            bind_pending_turn_completion(turn_completions, &turn.thread_id, &turn.id).await;
        }
        CodexUiEvent::AssistantDelta {
            thread_id,
            turn_id: Some(turn_id),
            text,
            ..
        } => {
            bind_pending_turn_completion(turn_completions, thread_id, turn_id).await;
            let mut completions = turn_completions.lock().await;
            if let Some(completion) = completions.get_mut(&turn_completion_key(thread_id, turn_id))
            {
                completion.output_text.push_str(text);
            }
        }
        CodexUiEvent::AssistantMessageCompleted {
            thread_id,
            turn_id: Some(turn_id),
            text: Some(text),
            ..
        } => {
            bind_pending_turn_completion(turn_completions, thread_id, turn_id).await;
            let mut completions = turn_completions.lock().await;
            if let Some(completion) = completions.get_mut(&turn_completion_key(thread_id, turn_id))
            {
                completion.output_text = text.clone();
            }
        }
        CodexUiEvent::TurnCompleted { turn } => {
            let key = turn_completion_key(&turn.thread_id, &turn.id);
            let thread_key = turn_thread_waiting_key(&turn.thread_id);
            let completion = {
                let mut completions = turn_completions.lock().await;
                completions
                    .remove(&key)
                    .or_else(|| completions.remove(&thread_key))
            };
            if let Some(mut completion) = completion {
                if let Some(sender) = completion.sender.take() {
                    let _ = sender.send(Ok(CompletedTurnOutput {
                        thread_id: turn.thread_id.clone(),
                        turn_id: turn.id.clone(),
                        text: completion.output_text.trim().to_string(),
                        status: turn.status.clone(),
                        token_usage: turn.token_usage.clone(),
                    }));
                }
            }
        }
        CodexUiEvent::TurnFailed { error } => {
            if let Some(key) = turn_failure_completion_key(error) {
                let completion = turn_completions.lock().await.remove(&key);
                if let Some(mut completion) = completion {
                    if let Some(sender) = completion.sender.take() {
                        let _ = sender.send(Err(error.clone()));
                    }
                }
            }
        }
        CodexUiEvent::RuntimeFailed { error } => {
            let completions = turn_completions
                .lock()
                .await
                .drain()
                .map(|(_, completion)| completion)
                .collect::<Vec<_>>();
            for mut completion in completions {
                if let Some(sender) = completion.sender.take() {
                    let _ = sender.send(Err(error.clone()));
                }
            }
        }
        _ => {}
    }
}

/// 统一桥接层准备好的 turn 文本与额外 input items。
struct PreparedLegalTurnInput {
    /// 发送给 app-server 的主文本。
    text: String,
    /// 除文本外的多模态 input items，例如 image/localImage。
    extra_input: Vec<Value>,
}

/// 单个附件经桥接层归一化后的结果。
enum PreparedAttachment {
    /// 直接进入 app-server `input` 数组的结构化项。
    Input(Value),
    /// 需要并入文本中的文件上下文。
    FileContext(AttachmentFileContext),
}

/// 非图片附件或图片 fallback 的文件上下文。
struct AttachmentFileContext {
    /// 附件名。
    name: String,
    /// 附件类型。
    kind: String,
    /// 附件来源。
    source: String,
    /// MIME 类型。
    mime_type: String,
    /// 文件大小。
    size: Option<u64>,
    /// 可读取的本机绝对路径。
    path: Option<String>,
}

/// 把预登记的 thread 等待项绑定到 app-server 返回的真实 turn。
async fn bind_pending_turn_completion(
    turn_completions: &Arc<Mutex<HashMap<String, PendingTurnCompletion>>>,
    thread_id: &str,
    turn_id: &str,
) {
    let key = turn_completion_key(thread_id, turn_id);
    let thread_key = turn_thread_waiting_key(thread_id);
    let mut completions = turn_completions.lock().await;
    if completions.contains_key(&key) {
        return;
    }
    if let Some(completion) = completions.remove(&thread_key) {
        completions.insert(key, completion);
    }
}

/// 移除等待表中某次 turn 的精确 key 和预登记 key。
async fn remove_turn_completion_waiter(
    turn_completions: &Arc<Mutex<HashMap<String, PendingTurnCompletion>>>,
    key: &str,
    thread_key: &str,
) {
    let mut completions = turn_completions.lock().await;
    completions.remove(key);
    completions.remove(thread_key);
}

/// 构造等待 turn 完成表的稳定 key。
fn turn_completion_key(thread_id: &str, turn_id: &str) -> String {
    format!("{thread_id}__{turn_id}")
}

/// 构造尚未拿到 turnId 时的 thread 级等待 key。
pub(super) fn turn_thread_waiting_key(thread_id: &str) -> String {
    format!("{thread_id}__pending")
}

/// 从 turn/failed 错误上下文中还原等待表 key。
fn turn_failure_completion_key(error: &AppError) -> Option<String> {
    let details = error.details.as_ref()?;
    let thread_id = json_text_field(details, "threadId").or_else(|| {
        details
            .get("turn")
            .and_then(|turn| json_text_field(turn, "threadId"))
    })?;
    let turn_id = json_text_field(details, "turnId").or_else(|| {
        details
            .get("turn")
            .and_then(|turn| json_text_field(turn, "id"))
    })?;
    Some(turn_completion_key(&thread_id, &turn_id))
}

/// 记录 agentMessage 的 phase；app-server 的 delta 事件通常只带 itemId，需要用 started/completed 事件补齐上下文。
pub(super) fn remember_agent_message_phase(
    method: &str,
    params: &Value,
    phases: &mut HashMap<String, String>,
) {
    if method != "item/started" && method != "item/completed" {
        return;
    }
    let Some(item) = params.get("item") else {
        return;
    };
    if json_text_field(item, "type").as_deref() != Some("agentMessage") {
        return;
    }
    let Some(item_id) = json_text_field(item, "id") else {
        return;
    };
    let Some(phase) = json_text_field(item, "phase") else {
        return;
    };
    phases.insert(item_id, phase);
}

/// 给缺少 phase 的 agentMessage delta 补上上下文，避免 commentary 被误当成最终正文流式渲染。
pub(super) fn enrich_agent_message_delta_phase(
    method: &str,
    params: &mut Value,
    phases: &HashMap<String, String>,
) {
    if method != "item/agentMessage/delta" || json_text_field(params, "phase").is_some() {
        return;
    }
    let Some(item_id) = json_text_field(params, "itemId") else {
        return;
    };
    let Some(phase) = phases.get(&item_id).cloned() else {
        return;
    };
    let Value::Object(object) = params else {
        return;
    };
    object.insert("phase".to_string(), Value::String(phase));
}

/// 读取 JSON 字符串字段，兼容 app-server 常见的 camelCase 与 snake_case 字段名。
fn json_text_field(value: &Value, camel_name: &str) -> Option<String> {
    value
        .get(camel_name)
        .or_else(|| value.get(camel_to_snake(camel_name).as_str()))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// 将前端协议字段名转为 Rust/JSON 中可能出现的 snake_case 名称。
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

fn spawn_stderr_reader(stderr: ChildStderr, app: AppHandle) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            log_with_details(
                "WARN",
                "app_server_stderr_line",
                "收到 app-server stderr 日志",
                json!({ "line": line }),
            );
            append_trace(
                "runtime",
                "stderr_line",
                "收到 app-server stderr 日志",
                json!({ "line": line }),
            );
            let _ = app.emit(
                CODEX_EVENT_NAME,
                CodexUiEvent::Warning {
                    message: format!("app-server: {line}"),
                },
            );
        }
    });
}

fn event_name(event: &CodexUiEvent) -> &'static str {
    match event {
        CodexUiEvent::RuntimeStarted => "runtime_started",
        CodexUiEvent::RuntimeStopped => "runtime_stopped",
        CodexUiEvent::RuntimeFailed { .. } => "runtime_failed",
        CodexUiEvent::ThreadStarted { .. } => "thread_started",
        CodexUiEvent::ThreadHistoryUpdated { .. } => "thread_history_updated",
        CodexUiEvent::TurnStarted { .. } => "turn_started",
        CodexUiEvent::AssistantDelta { .. } => "assistant_delta",
        CodexUiEvent::AssistantProcessDelta { .. } => "assistant_process_delta",
        CodexUiEvent::AssistantMessageCompleted { .. } => "assistant_message_completed",
        CodexUiEvent::ToolStarted { .. } => "tool_started",
        CodexUiEvent::ToolDelta { .. } => "tool_delta",
        CodexUiEvent::ToolCompleted { .. } => "tool_completed",
        CodexUiEvent::ApprovalRequired { .. } => "approval_required",
        CodexUiEvent::ApprovalCompleted { .. } => "approval_completed",
        CodexUiEvent::TurnCompleted { .. } => "turn_completed",
        CodexUiEvent::TurnFailed { .. } => "turn_failed",
        CodexUiEvent::Warning { .. } => "warning",
    }
}

fn trace_key_from_value(method: &str, value: &Value) -> String {
    value
        .get("threadId")
        .and_then(Value::as_str)
        .map(|thread_id| {
            value
                .get("turnId")
                .and_then(Value::as_str)
                .map(|turn_id| format!("{thread_id}__{turn_id}"))
                .unwrap_or_else(|| thread_id.to_string())
        })
        .or_else(|| {
            value
                .get("thread")
                .and_then(|thread| thread.get("id").and_then(Value::as_str).map(str::to_string))
        })
        .or_else(|| {
            value.get("turn").and_then(|turn| {
                let thread_id = turn.get("threadId").and_then(Value::as_str)?;
                let turn_id = turn.get("id").and_then(Value::as_str)?;
                Some(format!("{thread_id}__{turn_id}"))
            })
        })
        .unwrap_or_else(|| method.replace('/', "_"))
}

fn trace_key_from_stdout_line(line: &str) -> String {
    serde_json::from_str::<Value>(line)
        .ok()
        .map(|value| {
            value
                .get("params")
                .map(|params| trace_key_from_value("notification", params))
                .or_else(|| {
                    value
                        .get("result")
                        .map(|result| trace_key_from_value("response", result))
                })
                .unwrap_or_else(|| "runtime".to_string())
        })
        .unwrap_or_else(|| "runtime".to_string())
}

fn trace_key_from_event(event: &CodexUiEvent) -> String {
    match event {
        CodexUiEvent::ThreadStarted { thread } => thread.id.clone(),
        CodexUiEvent::ThreadHistoryUpdated { thread_id, .. } => thread_id.clone(),
        CodexUiEvent::TurnStarted { turn } | CodexUiEvent::TurnCompleted { turn } => {
            format!("{}__{}", turn.thread_id, turn.id)
        }
        CodexUiEvent::AssistantDelta {
            thread_id, turn_id, ..
        }
        | CodexUiEvent::AssistantMessageCompleted {
            thread_id, turn_id, ..
        } => turn_id
            .as_ref()
            .map(|turn_id| format!("{thread_id}__{turn_id}"))
            .unwrap_or_else(|| thread_id.clone()),
        CodexUiEvent::AssistantProcessDelta { item } => item
            .turn_id
            .as_ref()
            .map(|turn_id| format!("{}__{}", item.thread_id, turn_id))
            .unwrap_or_else(|| item.thread_id.clone()),
        CodexUiEvent::ToolStarted { item } => format!("{}__{}", item.thread_id, item.turn_id),
        CodexUiEvent::ToolDelta { item } => format!("{}__{}", item.thread_id, item.turn_id),
        CodexUiEvent::ToolCompleted { item } => format!("{}__{}", item.thread_id, item.turn_id),
        CodexUiEvent::ApprovalRequired { request } => request.thread_id.clone(),
        CodexUiEvent::ApprovalCompleted { request_id, .. } => format!("approval__{request_id}"),
        CodexUiEvent::RuntimeStarted
        | CodexUiEvent::RuntimeStopped
        | CodexUiEvent::RuntimeFailed { .. }
        | CodexUiEvent::TurnFailed { .. }
        | CodexUiEvent::Warning { .. } => "runtime".to_string(),
    }
}

fn approval_response_for_method(method: &str, decision: &ApprovalDecisionKind) -> Value {
    match method {
        MCP_ELICITATION_REQUEST_METHOD => json!({
            "action": if matches!(decision, ApprovalDecisionKind::Deny) {
                "decline"
            } else {
                "accept"
            },
            "content": Value::Null
        }),
        "item/fileChange/requestApproval" => json!({
            "decision": if matches!(decision, ApprovalDecisionKind::Deny) {
                "reject"
            } else {
                "accept"
            }
        }),
        _ => json!({
            "decision": if matches!(decision, ApprovalDecisionKind::Deny) {
                "cancel"
            } else {
                "accept"
            }
        }),
    }
}

fn should_auto_approve_request(method: &str, params: &Value) -> bool {
    let _ = params;
    matches!(
        method,
        MCP_ELICITATION_REQUEST_METHOD
            | "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        approval_response_for_method, should_auto_approve_request, ApprovalDecisionKind,
        MCP_ELICITATION_REQUEST_METHOD,
    };
    use serde_json::json;

    #[test]
    fn mcp_elicitation_allow_uses_accept_action() {
        let response = approval_response_for_method(
            MCP_ELICITATION_REQUEST_METHOD,
            &ApprovalDecisionKind::AllowOnce,
        );

        assert_eq!(
            response,
            json!({
                "action": "accept",
                "content": null
            })
        );
    }

    #[test]
    fn mcp_elicitation_deny_uses_decline_action() {
        let response = approval_response_for_method(
            MCP_ELICITATION_REQUEST_METHOD,
            &ApprovalDecisionKind::Deny,
        );

        assert_eq!(
            response,
            json!({
                "action": "decline",
                "content": null
            })
        );
    }

    #[test]
    fn local_mcp_approval_is_auto_approved() {
        let params = json!({
            "serverName": "lex_vault_local",
            "request": {
                "_meta": {
                    "codex_approval_kind": "tool_call",
                    "tool_name": "calendar_create_event"
                }
            }
        });

        assert!(should_auto_approve_request(
            MCP_ELICITATION_REQUEST_METHOD,
            &params
        ));
    }

    #[test]
    fn non_local_mcp_approval_is_still_auto_approved() {
        let params = json!({
            "serverName": "remote_server",
            "request": {
                "_meta": {
                    "codex_approval_kind": "tool_call",
                    "tool_name": "library_search"
                }
            }
        });

        assert!(should_auto_approve_request(
            MCP_ELICITATION_REQUEST_METHOD,
            &params
        ));
    }

    #[test]
    fn command_and_file_change_approvals_are_auto_approved() {
        assert!(should_auto_approve_request(
            "item/commandExecution/requestApproval",
            &json!({})
        ));
        assert!(should_auto_approve_request(
            "item/fileChange/requestApproval",
            &json!({})
        ));
    }
}

/// 判断附件是否应走 app-server 图片输入。
fn is_image_attachment(attachment: &StartLegalTurnAttachment) -> bool {
    let kind = attachment.kind.trim().to_ascii_lowercase();
    kind == "image" || attachment.mime_type.trim().starts_with("image/")
}

/// 选择附件展示名，缺失时退化为稳定占位名。
fn selected_attachment_name(attachment: &StartLegalTurnAttachment) -> String {
    let name = attachment.name.trim();
    if name.is_empty() {
        "attachment".to_string()
    } else {
        name.to_string()
    }
}

/// 选择附件类型标签。
fn selected_attachment_kind(attachment: &StartLegalTurnAttachment) -> String {
    let kind = attachment.kind.trim();
    if kind.is_empty() {
        "file".to_string()
    } else {
        kind.to_string()
    }
}

/// 选择附件来源标签。
fn selected_attachment_source(attachment: &StartLegalTurnAttachment) -> String {
    let source = attachment.source.trim();
    if source.is_empty() {
        "composer".to_string()
    } else {
        source.to_string()
    }
}

/// 选择 MIME 类型标签。
fn selected_attachment_mime_type(attachment: &StartLegalTurnAttachment) -> String {
    let mime_type = attachment.mime_type.trim();
    if mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        mime_type.to_string()
    }
}

/// 选择可直接发送给 app-server 的远程图片 URL。
fn selected_attachment_url(attachment: &StartLegalTurnAttachment) -> Option<String> {
    attachment
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 选择已经存在的本机绝对路径。
fn selected_attachment_path(attachment: &StartLegalTurnAttachment) -> Option<String> {
    let path = attachment.path.as_deref()?.trim();
    if path.is_empty() || !Path::new(path).is_absolute() {
        return None;
    }
    Some(path.to_string())
}

/// 从前端字节或外部 base64 中取得最终落盘负载。
fn attachment_base64_payload(attachment: &StartLegalTurnAttachment) -> Option<String> {
    if let Some(bytes) = attachment.bytes.as_ref() {
        if !bytes.is_empty() {
            return Some(BASE64_STANDARD.encode(bytes));
        }
    }
    attachment
        .data_base64
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 生成当前 thread 的临时附件 staging 目录。
fn staged_attachment_root(thread_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("lex-vault")
        .join("codex-attachments")
        .join(sanitize(thread_id))
}

/// 生成单个附件的临时落盘路径。
fn staged_attachment_path(
    thread_id: &str,
    attachment: &StartLegalTurnAttachment,
    index: usize,
) -> PathBuf {
    let file_name = sanitized_attachment_file_name(attachment, index);
    staged_attachment_root(thread_id).join(file_name)
}

/// 生成安全的附件文件名，避免不同入口把路径分隔符带进 staging 目录。
fn sanitized_attachment_file_name(attachment: &StartLegalTurnAttachment, index: usize) -> String {
    let safe_name = sanitize(selected_attachment_name(attachment));
    let fallback_name = if safe_name.trim().is_empty() {
        format!("attachment-{index}")
    } else {
        safe_name
    };
    let safe_id = sanitize(attachment.id.trim());
    if safe_id.trim().is_empty() {
        fallback_name
    } else {
        format!("{safe_id}-{fallback_name}")
    }
}

/// 渲染非图片附件的轻量文件上下文，不在桌面端自行解析正文。
fn render_attachment_file_context(context: &AttachmentFileContext) -> String {
    let mut lines = vec![format!(
        "<attachment-file name=\"{}\" kind=\"{}\" source=\"{}\">",
        xml_escape_attribute(&context.name),
        xml_escape_attribute(&context.kind),
        xml_escape_attribute(&context.source)
    )];
    lines.push(format!("文件名：{}", context.name));
    lines.push(format!("类型：{}", context.kind));
    lines.push(format!("来源：{}", context.source));
    lines.push(format!("MIME：{}", context.mime_type));
    if let Some(size) = context.size {
        lines.push(format!("大小：{size} 字节"));
    }
    if let Some(path) = context.path.as_deref() {
        lines.push(format!("绝对路径：{path}"));
        lines.push("如需读取内容，请直接使用工具访问该路径，不要依赖客户端本地解析。".to_string());
    } else {
        lines.push("当前入口只提供了附件摘要，没有可直接读取的本机路径。".to_string());
    }
    lines.push("</attachment-file>".to_string());
    lines.join("\n")
}

/// 仅用于简单 XML 属性转义，避免文件名里的引号破坏上下文结构。
fn xml_escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
