//! 微信扫码连接命令。
//!
//! @author kongweiguang

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::appserver_client::{StartLegalTurnAttachment, StartLegalTurnRequest};
use crate::conversation_trace::append_trace;
use crate::event_normalizer::CodexUiEvent;
use crate::jsonrpc::AppError;
use crate::logging::{log_info, log_with_details};
use crate::runtime_bundle::{
    is_valid_runtime_root, lex_vault_home_dir, LEX_VAULT_HOME_DIRECTORY, PRIMARY_RUNTIME_DIRECTORY,
};

/// 前端监听微信扫码连接状态的事件名。
pub const WECHAT_LOGIN_EVENT_NAME: &str = "lex-vault://wechat-login";

/// Node helper 投递微信消息到 Rust 的 JSONL 事件类型。
const WECHAT_THREAD_REQUEST_TYPE: &str = "wechat-thread-message";
/// Rust 返回微信消息处理结果到 Node helper 的 JSONL 事件类型。
const WECHAT_THREAD_RESPONSE_TYPE: &str = "wechat-thread-response";
/// assistant final answer 中声明“回微信文件”的结构化标签名。
const WECHAT_SEND_FILE_TAG: &str = "wechat-send-file";
/// 兼容模型更容易产出的历史标签名。
const WECHAT_SEND_FILE_TAG_COMPAT: &str = "attach_file";
/// 微信回文件标签别名，兼容模型常见输出漂移。
const WECHAT_SEND_FILE_TAG_ALIASES: [&str; 4] = [
    WECHAT_SEND_FILE_TAG,
    "send_file",
    WECHAT_SEND_FILE_TAG_COMPAT,
    "attach-file",
];
/// Rust 投递给 Node helper 的主动微信消息事件类型。
const WECHAT_PROACTIVE_MESSAGE_TYPE: &str = "wechat-proactive-message";
/// Node helper 读取模块根目录的环境变量名。
const WECHAT_MODULE_ROOTS_ENV: &str = "LEX_VAULT_WECHAT_MODULE_ROOTS";
/// OpenClaw/微信 SDK 状态目录环境变量名。
const OPENCLAW_STATE_DIR_ENV: &str = "OPENCLAW_STATE_DIR";
/// 显式指定 Node.js 可执行文件的环境变量名。
const LEX_VAULT_NODE_ENV: &str = "LEX_VAULT_NODE";
/// Lex Vault 内置 runtime 根目录环境变量名。
const LEX_VAULT_RUNTIME_ROOT_ENV: &str = "LEX_VAULT_RUNTIME_ROOT";
/// 微信 helper 资源目录名。
const WECHAT_RESOURCE_DIRECTORY: &str = "wechat";
/// 微信 helper 文件名。
const WECHAT_LOGIN_HELPER_FILE: &str = "login-helper.mjs";
/// 微信 SDK 状态子目录名。
const WECHAT_STATE_DIRECTORY: &str = "wechat";
/// 微信会话到 Codex thread 的映射文件名。
const WECHAT_THREAD_MAP_FILE_NAME: &str = "thread-map.json";
/// 微信目录回复临时压缩包目录名。
const WECHAT_REPLY_ARCHIVE_DIRECTORY: &str = "reply-archives";
/// 微信消息默认进入的 Codex profile。
const LEX_VAULT_CODEX_PROFILE_ID: &str = "lex-vault";
/// Node 依赖目录名。
const NODE_MODULES_DIRECTORY: &str = "node_modules";

/// Windows 子进程创建时不显示控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 微信扫码连接运行状态。
#[derive(Clone, Default)]
pub struct WechatLoginState {
    /// 当前扫码连接运行时状态。
    inner: Arc<Mutex<WechatLoginRuntime>>,
}

/// 微信消息桥接运行状态。
#[derive(Clone, Default)]
pub struct WechatThreadBridgeState {
    /// 同一微信会话的串行队列，避免连续消息并发写入同一个 thread。
    conversation_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    /// 映射文件读写锁，避免并发覆盖 `conversationId -> threadId`。
    mapping_lock: Arc<Mutex<()>>,
}

/// 微信扫码连接运行时内部状态。
#[derive(Default)]
struct WechatLoginRuntime {
    /// 正在运行的 Node helper 子进程。
    child: Option<Child>,
    /// 写回 Node helper stdin 的本机桥接通道。
    bridge_writer: Option<Arc<Mutex<ChildStdin>>>,
    /// 最近一次扫码连接状态。
    status: WechatLoginStatus,
}

/// 前端可消费的微信扫码连接状态。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatLoginStatus {
    /// 状态码：idle / starting / waiting / scanned / expired / connected / failed / canceled。
    pub status: String,
    /// 面向用户的状态说明。
    pub message: String,
    /// 终端二维码文本块，前端使用等宽字体展示。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_ascii: Option<String>,
    /// 微信 SDK 返回的账号 ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// 状态更新时间，UTC RFC3339。
    pub updated_at: String,
}

/// 启动微信扫码或恢复监听的请求参数。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatLoginStartRequest {
    /// 是否强制重新生成二维码并重新扫码。
    pub force_login: Option<bool>,
    /// 是否只恢复已有登录态，不主动进入扫码流程。
    #[serde(default)]
    pub resume_only: Option<bool>,
}

/// Node helper 投递的一条微信消息请求。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatThreadBridgeRequest {
    /// 微信 SDK 侧稳定会话 ID，同一联系人或群聊应保持一致。
    pub conversation_id: String,
    /// 微信 SDK 消息 ID；如果 SDK 未提供则为空。
    #[serde(default)]
    pub message_id: String,
    /// 已整理过的用户消息文本，包含轻量附件摘要。
    #[serde(default)]
    pub text: String,
    /// SDK 原始文本，仅用于排障时判断是否为空，不写入审计正文。
    #[serde(default)]
    pub raw_text: String,
    /// 联系人名称或微信会话显示名。
    #[serde(default)]
    pub contact_name: String,
    /// 群聊中实际发言人名称；普通联系人可与 contactName 相同。
    #[serde(default)]
    pub sender_name: String,
    /// 群聊主题或群名称。
    #[serde(default)]
    pub room_topic: String,
    /// 是否来自群聊。
    #[serde(default)]
    pub is_room: bool,
    /// 微信消息时间戳，保持 SDK 原始字符串。
    #[serde(default)]
    pub timestamp: String,
    /// 可选附件摘要；当前只进入提示，不主动读取附件正文。
    #[serde(default)]
    pub media: Option<WechatThreadBridgeMedia>,
}

/// 微信附件摘要。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatThreadBridgeMedia {
    /// 附件类型，例如 image/audio/video/file。
    #[serde(default, rename = "type")]
    pub kind: String,
    /// 附件文件名。
    #[serde(default)]
    pub file_name: String,
    /// 附件 MIME 类型。
    #[serde(default)]
    pub mime_type: String,
    /// 附件文件大小，单位字节。
    #[serde(default)]
    pub size: Option<u64>,
    /// 已存在的远程 URL。
    #[serde(default)]
    pub url: String,
    /// 已存在的本机路径。
    #[serde(default)]
    pub path: String,
    /// 外部入口已准备好的 base64 字节串。
    #[serde(default)]
    pub data_base64: String,
}

/// helper stdout 中的一条微信 thread 请求 JSON 行。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatThreadBridgeRequestLine {
    /// 事件类型，固定为 `wechat-thread-message`。
    #[serde(rename = "type")]
    pub event_type: String,
    /// 请求 ID，用于 helper 将异步响应匹配回当前 chat 调用。
    pub request_id: String,
    /// 微信消息载荷。
    pub message: WechatThreadBridgeRequest,
}

/// 写回 helper stdin 的微信 thread 响应 JSON 行。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatThreadBridgeResponseLine {
    /// 事件类型，固定为 `wechat-thread-response`。
    #[serde(rename = "type")]
    pub event_type: String,
    /// 请求 ID，与 helper 发来的 requestId 保持一致。
    pub request_id: String,
    /// 当前请求是否成功生成微信回复。
    pub ok: bool,
    /// 成功时的 Codex thread ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// 成功时的 Codex turn ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    /// 成功时可直接发回微信的最终回复，失败时为用户可读提示。
    pub text: String,
    /// 成功时可选的微信回复文件。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<WechatThreadBridgeResponseMedia>,
    /// 成功时可选的多文件微信回复列表。多于一个文件时由 helper 顺序发送。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_list: Vec<WechatThreadBridgeResponseMedia>,
    /// 失败时的稳定错误码。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// 写回 helper 的微信回复文件。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatThreadBridgeResponseMedia {
    /// 回复文件类型，供 helper 直接映射到 SDK ChatResponse.media.type。
    #[serde(rename = "type")]
    pub kind: String,
    /// 本机绝对路径。
    pub path: String,
    /// 展示给微信侧的文件名提示。
    pub file_name: String,
}

/// 写给 helper 的主动微信消息请求。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatProactiveMessageLine {
    /// 事件类型，固定为 `wechat-proactive-message`。
    #[serde(rename = "type")]
    pub event_type: String,
    /// 需要主动发送到微信的文本。
    pub text: String,
}

/// 微信会话到 Codex thread 的映射文件。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WechatThreadMapFile {
    /// 映射文件版本，便于后续迁移。
    #[serde(default = "wechat_thread_map_version")]
    version: u32,
    /// conversationId 到 thread 信息的映射。
    #[serde(default)]
    mappings: HashMap<String, WechatThreadMapping>,
}

/// 单个微信会话对应的 Codex thread 信息。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WechatThreadMapping {
    /// 微信 SDK 侧稳定会话 ID。
    conversation_id: String,
    /// Codex thread ID。
    thread_id: String,
    /// thread 工作目录。
    cwd: String,
    /// 最近一次联系人或群名摘要。
    #[serde(default)]
    display_name: String,
    /// 是否来自群聊。
    #[serde(default)]
    is_room: bool,
    /// 更新时间，UTC RFC3339。
    updated_at: String,
}

/// 从 assistant final answer 中提取出的微信回复内容。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedWechatReplyContent {
    /// 发给微信用户的可见文字。
    text: String,
    /// 可选回复文件。
    media: Option<WechatThreadBridgeResponseMedia>,
    /// 可选多文件回复列表。用于用户明确要求逐个发送多个文件/文件夹时。
    media_list: Vec<WechatThreadBridgeResponseMedia>,
}

impl Default for WechatLoginStatus {
    fn default() -> Self {
        status_with_message("idle", "微信尚未连接。")
    }
}

/// 启动微信扫码连接流程。
#[tauri::command]
pub async fn wechat_login_start(
    req: Option<WechatLoginStartRequest>,
    state: State<'_, WechatLoginState>,
    app: AppHandle,
) -> Result<WechatLoginStatus, AppError> {
    log_info("wechat_login_start_requested", "收到微信扫码连接启动请求");
    start_wechat_login_helper(req, state.inner().clone(), app).await
}

/// 桌面端启动后自动恢复已有微信监听；没有历史登录态时保持安静，不主动弹出扫码流程。
pub fn spawn_wechat_auto_resume(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if !should_auto_resume_wechat() {
            log_info(
                "wechat_auto_resume_skipped",
                "未检测到可恢复的微信状态目录，跳过自动启动微信监听",
            );
            return;
        }
        let state = app.state::<WechatLoginState>().inner().clone();
        let request = WechatLoginStartRequest {
            force_login: Some(false),
            resume_only: Some(true),
        };
        match start_wechat_login_helper(Some(request), state, app.clone()).await {
            Ok(status) => log_with_details(
                "INFO",
                "wechat_auto_resume_completed",
                "微信监听自动恢复流程完成",
                json!({ "status": status.status, "message": status.message }),
            ),
            Err(error) => log_with_details(
                "WARN",
                "wechat_auto_resume_failed",
                "微信监听自动恢复失败",
                json!({
                    "code": error.code,
                    "title": error.title,
                    "message": error.message,
                    "details": error.details,
                }),
            ),
        }
    });
}

/// 启动微信 helper 子进程，供扫码命令和启动自动恢复复用同一条管线。
async fn start_wechat_login_helper(
    req: Option<WechatLoginStartRequest>,
    managed_state: WechatLoginState,
    app: AppHandle,
) -> Result<WechatLoginStatus, AppError> {
    let mut old_child = {
        let mut runtime = managed_state.inner.lock().await;
        clear_finished_child(&mut runtime);
        if runtime.child.is_some() && should_keep_running_wechat_child(&runtime.status) {
            let status = runtime.status.clone();
            drop(runtime);
            emit_wechat_status(&app, &status)?;
            return Ok(status);
        }
        runtime.bridge_writer = None;
        runtime.child.take()
    };
    if let Some(child) = old_child.as_mut() {
        let _ = terminate_wechat_child(child).await;
    }

    let helper_path = locate_wechat_login_helper()?;
    let node_path = locate_node_executable();
    let state_dir = wechat_state_directory()?;
    std::fs::create_dir_all(&state_dir).map_err(|err| {
        AppError::new(
            "WECHAT_LOGIN_START_FAILED",
            "创建微信状态目录失败",
            err.to_string(),
            true,
        )
    })?;
    let module_roots = candidate_module_roots();
    let mut command = Command::new(&node_path);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.kill_on_drop(true);
    for (key, value) in wechat_login_environment(&state_dir, &module_roots)? {
        command.env(key, value);
    }
    let req = req.unwrap_or_default();
    command.args(wechat_helper_args(&req, &helper_path));
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            AppError::new(
                "WECHAT_LOGIN_START_FAILED",
                "启动微信扫码连接失败",
                format!("{} {}: {err}", node_path.display(), helper_path.display()),
                true,
            )
        })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::new(
            "WECHAT_LOGIN_START_FAILED",
            "无法读取微信 helper 输出",
            "子进程没有提供 stdout 管道",
            true,
        )
    })?;
    let stdin = child.stdin.take().ok_or_else(|| {
        AppError::new(
            "WECHAT_LOGIN_START_FAILED",
            "无法写入微信 helper 输入",
            "子进程没有提供 stdin 管道",
            true,
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        AppError::new(
            "WECHAT_LOGIN_START_FAILED",
            "无法读取微信 helper 日志",
            "子进程没有提供 stderr 管道",
            true,
        )
    })?;
    let bridge_writer = Arc::new(Mutex::new(stdin));

    let mut runtime = managed_state.inner.lock().await;
    runtime.child = Some(child);
    runtime.bridge_writer = Some(bridge_writer.clone());
    runtime.status = status_with_message("starting", "正在启动微信扫码连接...");
    let status = runtime.status.clone();
    drop(runtime);
    emit_wechat_status(&app, &status)?;
    spawn_wechat_stdout_reader(stdout, managed_state.clone(), app.clone(), bridge_writer);
    spawn_wechat_stderr_reader(stderr);
    Ok(status)
}

/// 取消当前微信扫码连接流程。
#[tauri::command]
pub async fn wechat_login_cancel(
    state: State<'_, WechatLoginState>,
    app: AppHandle,
) -> Result<WechatLoginStatus, AppError> {
    log_info("wechat_login_cancel_requested", "收到微信扫码连接取消请求");
    let managed_state = state.inner().clone();
    stop_wechat_receiver(&managed_state).await;
    let status = update_wechat_status(
        &managed_state,
        WechatLoginStatus {
            status: "canceled".to_string(),
            message: "已取消微信扫码连接。".to_string(),
            qr_ascii: None,
            account_id: None,
            updated_at: current_timestamp(),
        },
    )
    .await;
    emit_wechat_status(&app, &status)?;
    Ok(status)
}

/// Tauri 应用退出时停止微信接收器，保证 helper 生命周期不超过律隐台主进程。
pub fn shutdown_wechat_receiver(app: &AppHandle) {
    let state = app.state::<WechatLoginState>().inner().clone();
    tauri::async_runtime::block_on(async move {
        stop_wechat_receiver(&state).await;
    });
}

/// 停止当前微信 helper 子进程，并断开桥接写入句柄。
async fn stop_wechat_receiver(state: &WechatLoginState) {
    let mut child = {
        let mut runtime = state.inner.lock().await;
        runtime.bridge_writer = None;
        runtime.child.take()
    };
    if let Some(child) = child.as_mut() {
        let _ = terminate_wechat_child(child).await;
    }
}

/// 读取当前微信扫码连接状态。
#[tauri::command]
pub async fn wechat_status_read(
    state: State<'_, WechatLoginState>,
) -> Result<WechatLoginStatus, AppError> {
    let mut runtime = state.inner().inner.lock().await;
    clear_finished_child(&mut runtime);
    Ok(runtime.status.clone())
}

/// 尝试通过已连接的微信 helper 主动发送文本消息。
#[tauri::command]
pub async fn wechat_send_message(
    state: State<'_, WechatLoginState>,
    text: String,
) -> Result<bool, AppError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(false);
    }
    let writer = {
        let mut runtime = state.inner().inner.lock().await;
        clear_finished_child(&mut runtime);
        if runtime.status.status != "connected" {
            return Ok(false);
        }
        runtime.bridge_writer.clone()
    };
    let Some(writer) = writer else {
        return Ok(false);
    };
    write_wechat_proactive_message(
        &writer,
        &WechatProactiveMessageLine {
            event_type: WECHAT_PROACTIVE_MESSAGE_TYPE.to_string(),
            text,
        },
    )
    .await?;
    Ok(true)
}

/// 判断状态是否仍处于扫码流程中。
pub(crate) fn is_login_in_progress(status: &WechatLoginStatus) -> bool {
    matches!(status.status.as_str(), "starting" | "waiting" | "scanned")
}

/// 判断已有微信 helper 是否仍应作为唯一接收器继续复用。
pub(crate) fn should_keep_running_wechat_child(status: &WechatLoginStatus) -> bool {
    is_login_in_progress(status) || status.status == "connected"
}

/// 生成微信 SDK 状态目录。
pub(crate) fn wechat_state_directory_from_home(home: &Path) -> PathBuf {
    home.join(LEX_VAULT_HOME_DIRECTORY)
        .join(WECHAT_STATE_DIRECTORY)
}

/// 判断是否存在可尝试恢复的微信 SDK 状态目录。
pub(crate) fn should_auto_resume_wechat_from_state_dir(state_dir: &Path) -> bool {
    state_dir
        .read_dir()
        .map(|mut entries| entries.any(|entry| entry.is_ok()))
        .unwrap_or(false)
}

/// 构造 Node helper 启动参数；脚本路径必须放在自定义参数前，避免 Node.js 把参数当成自身选项。
pub(crate) fn wechat_helper_args(
    req: &WechatLoginStartRequest,
    helper_path: &Path,
) -> Vec<OsString> {
    let mut args = vec![helper_path.as_os_str().to_os_string()];
    if req.force_login.unwrap_or(false) {
        args.push(OsString::from("--force-login"));
    }
    if req.resume_only.unwrap_or(false) {
        args.push(OsString::from("--resume-only"));
    }
    args
}

/// 判断桌面端启动时是否需要自动尝试恢复微信监听。
fn should_auto_resume_wechat() -> bool {
    wechat_state_directory()
        .map(|state_dir| should_auto_resume_wechat_from_state_dir(&state_dir))
        .unwrap_or(false)
}

/// 构造 Node helper 需要的环境变量。
pub(crate) fn wechat_login_environment(
    state_dir: &Path,
    module_roots: &[PathBuf],
) -> Result<Vec<(String, String)>, AppError> {
    let mut environment = vec![(
        OPENCLAW_STATE_DIR_ENV.to_string(),
        state_dir.display().to_string(),
    )];
    let module_roots = module_roots
        .iter()
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    if !module_roots.is_empty() {
        let joined = std::env::join_paths(module_roots.iter()).map_err(|err| {
            AppError::new(
                "WECHAT_LOGIN_START_FAILED",
                "拼接微信 Node 模块路径失败",
                err.to_string(),
                true,
            )
        })?;
        environment.push((
            WECHAT_MODULE_ROOTS_ENV.to_string(),
            joined.to_string_lossy().to_string(),
        ));
    }
    Ok(environment)
}

/// 从 helper JSON 行解析状态。
pub(crate) fn parse_wechat_helper_status(line: &str) -> Option<WechatLoginStatus> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("wechat-login") {
        return None;
    }
    let status = value.get("status")?.as_str()?.to_string();
    let message = value
        .get("message")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    Some(WechatLoginStatus {
        status,
        message,
        qr_ascii: value
            .get("qrAscii")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        account_id: value
            .get("accountId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        updated_at: current_timestamp(),
    })
}

/// 从 helper JSON 行解析微信 thread 桥接请求。
pub(crate) fn parse_wechat_thread_request(line: &str) -> Option<WechatThreadBridgeRequestLine> {
    let request = serde_json::from_str::<WechatThreadBridgeRequestLine>(line).ok()?;
    (request.event_type == WECHAT_THREAD_REQUEST_TYPE
        && !request.request_id.trim().is_empty()
        && !request.message.conversation_id.trim().is_empty())
    .then_some(request)
}

/// 终止微信 helper 子进程，便于命令和回归测试复用同一条清理路径。
pub(crate) async fn terminate_wechat_child(child: &mut Child) -> std::io::Result<()> {
    child.kill().await
}

/// 更新内部状态并返回新状态。
pub(crate) async fn update_wechat_status(
    state: &WechatLoginState,
    mut status: WechatLoginStatus,
) -> WechatLoginStatus {
    let mut runtime = state.inner.lock().await;
    if status.qr_ascii.is_none()
        && matches!(
            status.status.as_str(),
            "starting" | "waiting" | "scanned" | "expired"
        )
    {
        status.qr_ascii = runtime.status.qr_ascii.clone();
    }
    runtime.status = status.clone();
    clear_finished_child(&mut runtime);
    status
}

/// 向前端推送微信扫码连接状态。
fn emit_wechat_status(app: &AppHandle, status: &WechatLoginStatus) -> Result<(), AppError> {
    app.emit(WECHAT_LOGIN_EVENT_NAME, status.clone())
        .map_err(|err| {
            AppError::new(
                "WECHAT_LOGIN_EVENT_FAILED",
                "发送微信连接状态失败",
                err.to_string(),
                true,
            )
        })
}

/// 清理已经退出的 helper 子进程句柄。
fn clear_finished_child(runtime: &mut WechatLoginRuntime) {
    if let Some(child) = runtime.child.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            runtime.child = None;
            runtime.bridge_writer = None;
        }
    }
}

/// 监听 helper 标准输出中的 JSON 状态行。
fn spawn_wechat_stdout_reader(
    stdout: tokio::process::ChildStdout,
    state: WechatLoginState,
    app: AppHandle,
    bridge_writer: Arc<Mutex<ChildStdin>>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Some(status) = parse_wechat_helper_status(&line) {
                        log_with_details(
                            "INFO",
                            "wechat_login_status",
                            "收到微信扫码连接状态",
                            json!({ "status": status.status, "message": status.message }),
                        );
                        let status = update_wechat_status(&state, status).await;
                        let _ = emit_wechat_status(&app, &status);
                        continue;
                    }
                    if let Some(request) = parse_wechat_thread_request(&line) {
                        let app = app.clone();
                        let bridge_writer = bridge_writer.clone();
                        tokio::spawn(async move {
                            let response = process_wechat_thread_request_line(&app, request).await;
                            if let Err(err) =
                                write_wechat_thread_response(&bridge_writer, &response).await
                            {
                                log_with_details(
                                    "ERROR",
                                    "wechat_thread_response_write_failed",
                                    "写回微信 thread 响应失败",
                                    json!({ "error": err.to_string() }),
                                );
                            }
                        });
                    }
                }
                Ok(None) => {
                    let mut runtime = state.inner.lock().await;
                    clear_finished_child(&mut runtime);
                    if is_login_in_progress(&runtime.status) {
                        runtime.status = WechatLoginStatus {
                            status: "failed".to_string(),
                            message: "微信扫码连接已退出，请重新尝试。".to_string(),
                            qr_ascii: None,
                            account_id: None,
                            updated_at: current_timestamp(),
                        };
                        let status = runtime.status.clone();
                        drop(runtime);
                        let _ = emit_wechat_status(&app, &status);
                    }
                    break;
                }
                Err(err) => {
                    let status = update_wechat_status(
                        &state,
                        WechatLoginStatus {
                            status: "failed".to_string(),
                            message: format!("读取微信扫码连接状态失败：{err}"),
                            qr_ascii: None,
                            account_id: None,
                            updated_at: current_timestamp(),
                        },
                    )
                    .await;
                    let _ = emit_wechat_status(&app, &status);
                    break;
                }
            }
        }
    });
}

/// 监听 helper stderr，用于技术排障，不进入前端协议。
fn spawn_wechat_stderr_reader(stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            log_with_details(
                "WARN",
                "wechat_login_stderr",
                "收到微信 helper stderr 日志",
                json!({ "line": line }),
            );
        }
    });
}

/// 处理 helper 投递的一条微信消息，并压缩为可写回 helper 的响应。
async fn process_wechat_thread_request_line(
    app: &AppHandle,
    request: WechatThreadBridgeRequestLine,
) -> WechatThreadBridgeResponseLine {
    let request_id = request.request_id.clone();
    match process_wechat_thread_request(app, request.message).await {
        Ok(output) => {
            let parsed_reply = parse_wechat_reply_content(&output.text);
            WechatThreadBridgeResponseLine {
                event_type: WECHAT_THREAD_RESPONSE_TYPE.to_string(),
                request_id,
                ok: true,
                thread_id: Some(output.thread_id),
                turn_id: Some(output.turn_id),
                text: if parsed_reply.text.trim().is_empty()
                    && parsed_reply.media.is_none()
                    && parsed_reply.media_list.is_empty()
                {
                    "小隐这次没有生成可发送的回复，请换个问法再试试。".to_string()
                } else {
                    parsed_reply.text
                },
                media: parsed_reply.media,
                media_list: parsed_reply.media_list,
                error_code: None,
            }
        }
        Err(error) => {
            log_with_details(
                "ERROR",
                "wechat_thread_request_failed",
                "微信消息接入 Codex thread 失败",
                json!({
                    "requestId": request_id,
                    "code": error.code,
                    "title": error.title,
                    "message": error.message,
                    "details": error.details,
                }),
            );
            WechatThreadBridgeResponseLine {
                event_type: WECHAT_THREAD_RESPONSE_TYPE.to_string(),
                request_id,
                ok: false,
                thread_id: None,
                turn_id: None,
                text: wechat_user_message_for_error(&error),
                media: None,
                media_list: Vec::new(),
                error_code: Some(error.code),
            }
        }
    }
}

/// 将微信消息写入或恢复 Codex thread，并等待最终回复。
async fn process_wechat_thread_request(
    app: &AppHandle,
    request: WechatThreadBridgeRequest,
) -> Result<crate::appserver_client::CompletedTurnOutput, AppError> {
    let conversation_id = normalize_conversation_id(&request.conversation_id);
    let bridge_state = app.state::<WechatThreadBridgeState>();
    let queue_lock = conversation_queue_lock(&bridge_state, &conversation_id).await;
    let _queue_guard = queue_lock.lock().await;

    log_with_details(
        "INFO",
        "wechat_thread_request_received",
        "收到微信消息 thread 桥接请求",
        json!({
            "conversationId": conversation_id,
            "messageId": request.message_id,
            "isRoom": request.is_room,
            "textLength": request.text.chars().count(),
            "hasMedia": request.media.is_some(),
        }),
    );
    append_trace(
        &format!("wechat_{conversation_id}"),
        "wechat_request_received",
        "收到微信消息 thread 桥接请求",
        json!({
            "conversationId": conversation_id,
            "messageId": request.message_id,
            "isRoom": request.is_room,
            "textLength": request.text.chars().count(),
            "hasMedia": request.media.is_some(),
        }),
    );

    let config = crate::commands::local_data::initialize_local_home().map_err(|err| {
        AppError::new(
            "WECHAT_WORKSPACE_NOT_READY",
            "微信消息无法进入桌面端会话",
            err,
            true,
        )
    })?;
    let cwd = config.workspace_root.trim().to_string();
    crate::commands::codex::validate_workspace(&cwd)?;

    ensure_wechat_codex_runtime(app).await?;
    let codex_state = app.state::<crate::commands::codex::AppState>();
    let runtime = crate::commands::codex::runtime_client(&codex_state).await?;
    let mapping = read_wechat_thread_mapping(&bridge_state, &conversation_id).await?;
    let thread_id = ensure_wechat_thread(&runtime.client, mapping, &cwd).await?;
    write_wechat_thread_mapping(
        &bridge_state,
        WechatThreadMapping {
            conversation_id: conversation_id.clone(),
            thread_id: thread_id.clone(),
            cwd: cwd.clone(),
            display_name: wechat_display_name(&request),
            is_room: request.is_room,
            updated_at: current_timestamp(),
        },
    )
    .await?;

    let output = runtime
        .client
        .start_legal_turn_and_wait(
            StartLegalTurnRequest {
                thread_id: thread_id.clone(),
                cwd: cwd.clone(),
                user_prompt: build_wechat_turn_prompt(&request, &conversation_id),
                attachments: wechat_request_attachments(&request),
                developer_instructions: wechat_turn_developer_instructions()?,
                skill_name: None,
                plugin_mentions: vec![],
            },
            None,
        )
        .await?;
    crate::commands::codex::audit(
        &runtime.codex_home,
        "wechat_turn_completed",
        json!({
            "conversationId": conversation_id,
            "threadId": output.thread_id,
            "turnId": output.turn_id,
            "status": output.status,
            "replyLength": output.text.chars().count(),
        }),
    );
    let _ = app.emit(
        crate::appserver_client::CODEX_EVENT_NAME,
        CodexUiEvent::ThreadHistoryUpdated {
            thread_id: output.thread_id.clone(),
            cwd,
        },
    );
    Ok(output)
}

/// 确保微信消息到达时 Codex runtime 已经启动。
async fn ensure_wechat_codex_runtime(app: &AppHandle) -> Result<(), AppError> {
    let codex_state = app.state::<crate::commands::codex::AppState>();
    let local_mcp = app.state::<crate::local_mcp_server::LocalMcpRuntimeState>();
    crate::commands::codex::command_handlers::codex_start_runtime(
        LEX_VAULT_CODEX_PROFILE_ID.to_string(),
        codex_state,
        local_mcp,
        app.clone(),
    )
    .await
}

/// 根据映射恢复 thread；映射失效时自动创建新的普通会话 thread。
async fn ensure_wechat_thread(
    client: &crate::appserver_client::AppServerJsonRpcClient,
    mapping: Option<WechatThreadMapping>,
    cwd: &str,
) -> Result<String, AppError> {
    if let Some(mapping) = mapping {
        match client
            .resume_thread(mapping.thread_id.clone(), Some(cwd.to_string()))
            .await
        {
            Ok(response) => return Ok(response.thread.id),
            Err(error) => {
                log_with_details(
                    "WARN",
                    "wechat_thread_resume_failed",
                    "微信会话对应 thread 恢复失败，将创建新 thread",
                    json!({
                        "threadId": mapping.thread_id,
                        "code": error.code,
                        "message": error.message,
                    }),
                );
            }
        }
    }

    client
        .start_thread(cwd.to_string(), Some(false))
        .await
        .map(|response| response.thread.id)
}

/// 写回 helper stdin 的单行 JSON 响应。
async fn write_wechat_thread_response(
    writer: &Arc<Mutex<ChildStdin>>,
    response: &WechatThreadBridgeResponseLine,
) -> Result<(), AppError> {
    let mut line = serde_json::to_vec(response).map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_RESPONSE_FAILED",
            "序列化微信 thread 响应失败",
            err.to_string(),
            true,
        )
    })?;
    line.push(b'\n');
    let mut writer = writer.lock().await;
    writer.write_all(&line).await.map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_RESPONSE_FAILED",
            "写入微信 helper stdin 失败",
            err.to_string(),
            true,
        )
    })?;
    writer.flush().await.map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_RESPONSE_FAILED",
            "刷新微信 helper stdin 失败",
            err.to_string(),
            true,
        )
    })
}

/// 写给 helper stdin 的主动微信消息 JSON 行。
async fn write_wechat_proactive_message(
    writer: &Arc<Mutex<ChildStdin>>,
    message: &WechatProactiveMessageLine,
) -> Result<(), AppError> {
    let mut line = serde_json::to_vec(message).map_err(|err| {
        AppError::new(
            "WECHAT_PROACTIVE_MESSAGE_FAILED",
            "序列化主动微信消息失败",
            err.to_string(),
            true,
        )
    })?;
    line.push(b'\n');
    let mut writer = writer.lock().await;
    writer.write_all(&line).await.map_err(|err| {
        AppError::new(
            "WECHAT_PROACTIVE_MESSAGE_FAILED",
            "写入微信 helper 主动消息失败",
            err.to_string(),
            true,
        )
    })?;
    writer.flush().await.map_err(|err| {
        AppError::new(
            "WECHAT_PROACTIVE_MESSAGE_FAILED",
            "刷新微信 helper 主动消息失败",
            err.to_string(),
            true,
        )
    })
}

/// 获取同一微信会话的串行处理锁。
async fn conversation_queue_lock(
    state: &WechatThreadBridgeState,
    conversation_id: &str,
) -> Arc<Mutex<()>> {
    let mut locks = state.conversation_locks.lock().await;
    locks
        .entry(conversation_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// 读取指定微信会话的 thread 映射。
async fn read_wechat_thread_mapping(
    state: &WechatThreadBridgeState,
    conversation_id: &str,
) -> Result<Option<WechatThreadMapping>, AppError> {
    let _guard = state.mapping_lock.lock().await;
    let mappings = read_wechat_thread_map_file()?;
    Ok(mappings.mappings.get(conversation_id).cloned())
}

/// 写入指定微信会话的 thread 映射。
async fn write_wechat_thread_mapping(
    state: &WechatThreadBridgeState,
    mapping: WechatThreadMapping,
) -> Result<(), AppError> {
    let _guard = state.mapping_lock.lock().await;
    let mut mappings = read_wechat_thread_map_file()?;
    mappings.version = wechat_thread_map_version();
    mappings
        .mappings
        .insert(mapping.conversation_id.clone(), mapping);
    write_wechat_thread_map_file(&mappings)
}

/// 读取 `conversationId -> threadId` 映射文件。
fn read_wechat_thread_map_file() -> Result<WechatThreadMapFile, AppError> {
    let path = wechat_thread_map_file_path()?;
    if !path.is_file() {
        return Ok(WechatThreadMapFile {
            version: wechat_thread_map_version(),
            mappings: HashMap::new(),
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_MAP_FAILED",
            "读取微信 thread 映射失败",
            format!("{}: {err}", path.display()),
            true,
        )
    })?;
    serde_json::from_str::<WechatThreadMapFile>(&raw).map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_MAP_FAILED",
            "解析微信 thread 映射失败",
            format!("{}: {err}", path.display()),
            true,
        )
    })
}

/// 写入 `conversationId -> threadId` 映射文件。
fn write_wechat_thread_map_file(mappings: &WechatThreadMapFile) -> Result<(), AppError> {
    let path = wechat_thread_map_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            AppError::new(
                "WECHAT_THREAD_MAP_FAILED",
                "创建微信 thread 映射目录失败",
                err.to_string(),
                true,
            )
        })?;
    }
    let content = serde_json::to_string_pretty(mappings).map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_MAP_FAILED",
            "序列化微信 thread 映射失败",
            err.to_string(),
            true,
        )
    })?;
    std::fs::write(&path, content).map_err(|err| {
        AppError::new(
            "WECHAT_THREAD_MAP_FAILED",
            "写入微信 thread 映射失败",
            format!("{}: {err}", path.display()),
            true,
        )
    })
}

/// 当前用户的微信 thread 映射文件路径。
fn wechat_thread_map_file_path() -> Result<PathBuf, AppError> {
    Ok(lex_vault_home_dir()?
        .join(WECHAT_STATE_DIRECTORY)
        .join(WECHAT_THREAD_MAP_FILE_NAME))
}

/// 当前映射文件版本。
fn wechat_thread_map_version() -> u32 {
    1
}

/// 归一化微信会话 ID，避免空 key 写入映射文件。
fn normalize_conversation_id(conversation_id: &str) -> String {
    let trimmed = conversation_id.trim();
    if trimmed.is_empty() {
        "wechat-user".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 生成微信入口隐藏 developer instructions，补充工作区目录语义与回文件约束。
fn wechat_turn_developer_instructions() -> Result<Option<String>, AppError> {
    let config = crate::commands::local_data::get_app_config().map_err(|err| {
        AppError::new(
            "APP_CONFIG_READ_FAILED",
            "读取工作区目录配置失败",
            err,
            true,
        )
    })?;
    let workspace_instructions =
        crate::commands::codex::command_handlers::build_workspace_directory_developer_instructions(
            &config,
        );
    Ok(
        crate::commands::codex::command_handlers::merge_developer_instructions(
            workspace_instructions.as_deref(),
            Some(wechat_reply_file_developer_instructions()),
        ),
    )
}

/// 微信入口专用隐藏 developer instructions。
fn wechat_reply_file_developer_instructions() -> String {
    [
        "以下约束仅适用于当前微信消息回复。",
        "默认直接用简洁、自然、中文的微信聊天语气回复用户，不要暴露任何内部协议、工具细节或推理过程。",
        "如果你判断这次回复需要把本机已有文件、本轮刚生成完成的本机文件，或本机文件夹里的直接子文件发给微信用户，请在 final answer 末尾追加结构化标签：<wechat-send-file path=\"本机绝对路径\" fileName=\"可选展示文件名\" mode=\"direct|archive\" />。",
        "path 只能填写本机绝对路径，可以是普通文件或文件夹；不要填写 URL、相对路径或 base64 内容。",
        "当只需要发送 1 个普通文件时，声明 1 个标签即可，mode 可省略。",
        "当用户明确要多个文件/多个文件夹直接发过来时，可以声明多个标签，或声明文件夹路径；未写 mode 时按 direct 处理，文件夹会展开为直接子文件并逐个发送。",
        "当用户明确说压缩、打包、zip 时，使用 mode=\"archive\"；文件夹会打包成 zip 后发送。",
        "如果一次会发送多个文件，而用户没有说要压缩还是逐个发送，请先用自然语言追问用户，不要擅自声明文件标签。",
        "标签外只保留给微信用户看的简短说明文字，不要在正文里解释这个标签机制。",
    ]
    .join("\n")
}

/// 构造进入 Codex thread 的轻量微信来源上下文。
pub(crate) fn build_wechat_turn_prompt(
    request: &WechatThreadBridgeRequest,
    conversation_id: &str,
) -> String {
    let mut lines = vec![
        "<wechat-message>".to_string(),
        "来源：微信普通会话。".to_string(),
        format!("微信会话 ID：{conversation_id}。"),
        format!(
            "会话类型：{}。",
            if request.is_room {
                "群聊"
            } else {
                "联系人"
            }
        ),
    ];
    if !request.contact_name.trim().is_empty() {
        lines.push(format!(
            "联系人/会话名称：{}。",
            request.contact_name.trim()
        ));
    }
    if !request.room_topic.trim().is_empty() {
        lines.push(format!("群聊名称：{}。", request.room_topic.trim()));
    }
    if !request.sender_name.trim().is_empty() {
        lines.push(format!("发言人：{}。", request.sender_name.trim()));
    }
    if !request.message_id.trim().is_empty() {
        lines.push(format!("微信消息 ID：{}。", request.message_id.trim()));
    }
    if let Some(media) = request
        .media
        .as_ref()
        .filter(|media| !wechat_media_has_accessible_content(media))
    {
        lines.push(format!(
            "附件摘要：类型={}，文件名={}，MIME={}。当前入口只提供了附件摘要。",
            empty_to_dash(&media.kind),
            empty_to_dash(&media.file_name),
            empty_to_dash(&media.mime_type)
        ));
    }
    lines.push("用户消息：".to_string());
    lines.push(if request.text.trim().is_empty() {
        "用户发送了一条空白消息。".to_string()
    } else {
        request.text.trim().to_string()
    });
    lines.push("</wechat-message>".to_string());
    lines.push("请直接回复这条微信消息；适合微信聊天场景，默认简洁、直接、中文输出。".to_string());
    lines.join("\n")
}

/// 从 assistant final answer 中拆出微信可见文本和可选文件回复声明。
pub(crate) fn parse_wechat_reply_content(text: &str) -> ParsedWechatReplyContent {
    let (tags, visible_text) = extract_wechat_send_file_tags(text);
    let normalized_text = visible_text.trim().to_string();

    if tags.is_empty() {
        return ParsedWechatReplyContent {
            text: normalized_text,
            media: None,
            media_list: Vec::new(),
        };
    }

    let mut media_list = Vec::new();
    for tag in &tags {
        let Some(attributes) = parse_wechat_send_file_attributes(tag) else {
            log_with_details(
                "WARN",
                "wechat_reply_file_tag_parse_failed",
                "微信回复回文件标签解析失败，本次跳过该文件声明",
                json!({ "tag": tag }),
            );
            continue;
        };
        media_list.extend(build_wechat_reply_media_list(attributes));
    }
    let media = if media_list.len() == 1 {
        media_list.first().cloned()
    } else {
        None
    };

    ParsedWechatReplyContent {
        text: normalized_text,
        media,
        media_list: if media_list.len() > 1 {
            media_list
        } else {
            Vec::new()
        },
    }
}

/// 提取 `<wechat-send-file ... />` 标签，并返回移除标签后的可见文本。
fn extract_wechat_send_file_tags(text: &str) -> (Vec<String>, String) {
    let mut cursor = 0usize;
    let mut tags = Vec::new();
    let mut visible = String::with_capacity(text.len());

    while let Some((start, _tag_name)) = find_next_wechat_send_file_tag(text, cursor) {
        visible.push_str(&text[cursor..start]);
        let rest = &text[start..];
        if let Some(relative_end) = rest.find("/>") {
            let end = start + relative_end + 2;
            tags.push(text[start..end].to_string());
            cursor = end;
        } else {
            visible.push_str(rest);
            cursor = text.len();
            break;
        }
    }

    if cursor < text.len() {
        visible.push_str(&text[cursor..]);
    }

    (tags, visible)
}

/// 找到下一个支持的微信回文件标签起点。
fn find_next_wechat_send_file_tag(text: &str, cursor: usize) -> Option<(usize, &'static str)> {
    WECHAT_SEND_FILE_TAG_ALIASES
        .iter()
        .filter_map(|tag_name| {
            text[cursor..]
                .find(&format!("<{tag_name}"))
                .map(|index| (cursor + index, *tag_name))
        })
        .min_by_key(|(index, _)| *index)
}

/// 解析 `<wechat-send-file ... />` 标签属性。
fn parse_wechat_send_file_attributes(tag: &str) -> Option<HashMap<String, String>> {
    let trimmed = tag.trim();
    let tag_name = WECHAT_SEND_FILE_TAG_ALIASES
        .iter()
        .find(|tag_name| trimmed.starts_with(&format!("<{tag_name}")))?;
    let opening = format!("<{tag_name}");
    if !trimmed.ends_with("/>") {
        return None;
    }

    let inner = trimmed[opening.len()..trimmed.len() - 2].trim();
    let mut attributes = HashMap::new();
    let mut remainder = inner;

    while !remainder.is_empty() {
        remainder = remainder.trim_start();
        if remainder.is_empty() {
            break;
        }
        let eq_index = remainder.find('=')?;
        let key = remainder[..eq_index].trim();
        if key.is_empty() {
            return None;
        }
        let after_eq = remainder[eq_index + 1..].trim_start();
        let quote = after_eq.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }
        let value_rest = &after_eq[quote.len_utf8()..];
        let value_end = value_rest.find(quote)?;
        let value = &value_rest[..value_end];
        attributes.insert(key.to_string(), html_unescape_minimal(value));
        remainder = &value_rest[value_end + quote.len_utf8()..];
    }

    Some(attributes)
}

/// 将属性中的少量 XML/HTML 实体还原为普通字符，便于处理 Windows 路径。
fn html_unescape_minimal(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// 校验并构造微信回复文件描述。目录默认展开为直接子文件；mode=archive 时打包发送。
fn build_wechat_reply_media_list(
    attributes: HashMap<String, String>,
) -> Vec<WechatThreadBridgeResponseMedia> {
    let path_value = attributes
        .get("path")
        .map(String::as_str)
        .unwrap_or_default();
    let requested_path = PathBuf::from(path_value.trim());
    if !requested_path.is_absolute() {
        log_with_details(
            "WARN",
            "wechat_reply_file_path_not_absolute",
            "微信回复文件路径不是本机绝对路径，本次降级为纯文本回复",
            json!({ "path": path_value }),
        );
        return Vec::new();
    }
    let Some(resolved_path) = resolve_wechat_reply_path(&requested_path) else {
        log_with_details(
            "WARN",
            "wechat_reply_file_path_missing",
            "微信回复文件不存在或无法唯一纠偏，本次降级为纯文本回复",
            json!({ "path": requested_path.display().to_string() }),
        );
        return Vec::new();
    };
    let archive_mode = attributes
        .get("mode")
        .or_else(|| attributes.get("sendMode"))
        .or_else(|| attributes.get("send_mode"))
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "archive" | "zip" | "compress" | "compressed" | "package"
            )
        })
        .unwrap_or(false);
    let paths = prepare_wechat_reply_media_paths(&resolved_path, archive_mode);
    paths
        .into_iter()
        .filter_map(|path| build_wechat_reply_media_from_file(&path, &attributes))
        .collect()
}

/// 从一个普通文件构造微信回复文件描述。
fn build_wechat_reply_media_from_file(
    path: &Path,
    attributes: &HashMap<String, String>,
) -> Option<WechatThreadBridgeResponseMedia> {
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => {
            log_with_details(
                "WARN",
                "wechat_reply_file_path_not_file",
                "微信回复文件路径不是普通文件，本次降级为纯文本回复",
                json!({ "path": path.display().to_string() }),
            );
            return None;
        }
        Err(err) => {
            log_with_details(
                "WARN",
                "wechat_reply_file_path_missing",
                "微信回复文件不存在或无法读取，本次降级为纯文本回复",
                json!({ "path": path.display().to_string(), "error": err.to_string() }),
            );
            return None;
        }
    };
    if let Err(err) = std::fs::File::open(&path) {
        log_with_details(
            "WARN",
            "wechat_reply_file_open_failed",
            "微信回复文件无法打开，本次降级为纯文本回复",
            json!({ "path": path.display().to_string(), "error": err.to_string() }),
        );
        return None;
    }

    let file_name = attributes
        .get("fileName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let resolved_file_name = if file_name.is_empty() {
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("wechat-file")
            .to_string()
    } else {
        file_name
    };

    Some(WechatThreadBridgeResponseMedia {
        kind: wechat_reply_media_kind(&path, &resolved_file_name, metadata.len()),
        path: path.display().to_string(),
        file_name: resolved_file_name,
    })
}

/// 解析模型声明的文件或目录路径；当末段名称只差空白字符时，在同目录内做唯一纠偏。
fn resolve_wechat_reply_path(path: &Path) -> Option<PathBuf> {
    if path.is_file() || path.is_dir() {
        return Some(path.to_path_buf());
    }

    let parent = path.parent()?;
    let requested_name = path.file_name()?.to_string_lossy();
    let normalized_requested_name = normalize_wechat_reply_path_name(&requested_name);
    if normalized_requested_name.is_empty() {
        return None;
    }

    let mut matches = std::fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_file() || file_type.is_dir())
                .unwrap_or(false)
        })
        .filter(|entry| {
            normalize_wechat_reply_path_name(&entry.file_name().to_string_lossy())
                == normalized_requested_name
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    matches.sort();

    if matches.len() == 1 {
        let resolved = matches.remove(0);
        log_with_details(
            "INFO",
            "wechat_reply_file_path_corrected",
            "微信回复文件路径已按同目录唯一文件名纠偏",
            json!({
                "requestedPath": path.display().to_string(),
                "resolvedPath": resolved.display().to_string(),
            }),
        );
        Some(resolved)
    } else {
        None
    }
}

/// 将回复路径准备成可发送文件列表；普通文件原样返回，目录按 direct 或 archive 处理。
fn prepare_wechat_reply_media_paths(path: &Path, archive_mode: bool) -> Vec<PathBuf> {
    if path.is_file() {
        return vec![path.to_path_buf()];
    }
    if path.is_dir() {
        if archive_mode {
            return archive_wechat_reply_directory(path).into_iter().collect();
        }
        return expand_wechat_reply_directory(path);
    }
    Vec::new()
}

/// 将目录展开为直接子文件，避免把预览缓存等子目录混入微信回复。
fn expand_wechat_reply_directory(directory: &Path) -> Vec<PathBuf> {
    let mut entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|file_type| file_type.is_file())
                    .unwrap_or(false)
            })
            .map(|entry| entry.path())
            .collect::<Vec<_>>(),
        Err(err) => {
            log_with_details(
                "WARN",
                "wechat_reply_directory_read_failed",
                "读取微信回复目录失败，本次跳过该目录",
                json!({ "directory": directory.display().to_string(), "error": err.to_string() }),
            );
            return Vec::new();
        }
    };
    entries.sort();
    if entries.is_empty() {
        log_with_details(
            "WARN",
            "wechat_reply_directory_empty",
            "微信回复目录没有可发送的直接子文件，本次跳过该目录",
            json!({ "directory": directory.display().to_string() }),
        );
    }
    entries
}

/// 将目录直接子文件打包成 zip，避免把预览缓存等子目录混入微信回复。
fn archive_wechat_reply_directory(directory: &Path) -> Option<PathBuf> {
    let archive_root = lex_vault_home_dir()
        .ok()?
        .join(WECHAT_STATE_DIRECTORY)
        .join(WECHAT_REPLY_ARCHIVE_DIRECTORY);
    if let Err(err) = std::fs::create_dir_all(&archive_root) {
        log_with_details(
            "WARN",
            "wechat_reply_archive_directory_create_failed",
            "创建微信回复压缩包目录失败，本次降级为纯文本回复",
            json!({ "directory": archive_root.display().to_string(), "error": err.to_string() }),
        );
        return None;
    }

    let base_name = directory
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("wechat-files");
    let archive_name = format!(
        "{}-{}.zip",
        sanitize_filename::sanitize(base_name),
        Uuid::new_v4()
    );
    let archive_path = archive_root.join(archive_name);

    let archive_file = match File::create(&archive_path) {
        Ok(file) => file,
        Err(err) => {
            log_with_details(
                "WARN",
                "wechat_reply_archive_create_failed",
                "创建微信回复压缩包失败，本次降级为纯文本回复",
                json!({ "path": archive_path.display().to_string(), "error": err.to_string() }),
            );
            return None;
        }
    };
    let mut writer = ZipWriter::new(archive_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut file_count = 0usize;
    let mut entries = std::fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_file())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().replace('\\', "/");
        if file_name.trim().is_empty() {
            continue;
        }
        if let Err(err) = writer.start_file(&file_name, options) {
            log_with_details(
                "WARN",
                "wechat_reply_archive_write_failed",
                "写入微信回复压缩包失败，本次降级为纯文本回复",
                json!({ "file": path.display().to_string(), "error": err.to_string() }),
            );
            let _ = std::fs::remove_file(&archive_path);
            return None;
        }
        let mut source = match File::open(&path) {
            Ok(file) => file,
            Err(err) => {
                log_with_details(
                    "WARN",
                    "wechat_reply_archive_source_open_failed",
                    "读取目录内文件失败，本次降级为纯文本回复",
                    json!({ "file": path.display().to_string(), "error": err.to_string() }),
                );
                let _ = std::fs::remove_file(&archive_path);
                return None;
            }
        };
        if let Err(err) = std::io::copy(&mut source, &mut writer) {
            log_with_details(
                "WARN",
                "wechat_reply_archive_copy_failed",
                "复制目录内文件到压缩包失败，本次降级为纯文本回复",
                json!({ "file": path.display().to_string(), "error": err.to_string() }),
            );
            let _ = std::fs::remove_file(&archive_path);
            return None;
        }
        file_count += 1;
    }

    if file_count == 0 {
        let _ = std::fs::remove_file(&archive_path);
        log_with_details(
            "WARN",
            "wechat_reply_archive_empty_directory",
            "微信回复目录没有可发送的直接子文件，本次降级为纯文本回复",
            json!({ "directory": directory.display().to_string() }),
        );
        return None;
    }

    if let Err(err) = writer.finish() {
        let _ = std::fs::remove_file(&archive_path);
        log_with_details(
            "WARN",
            "wechat_reply_archive_finish_failed",
            "完成微信回复压缩包失败，本次降级为纯文本回复",
            json!({ "path": archive_path.display().to_string(), "error": err.to_string() }),
        );
        return None;
    }

    log_with_details(
        "INFO",
        "wechat_reply_directory_archived",
        "微信回复目录已打包为单个 zip 文件",
        json!({
            "directory": directory.display().to_string(),
            "archivePath": archive_path.display().to_string(),
            "fileCount": file_count,
        }),
    );
    Some(archive_path)
}

/// 路径名纠偏只忽略空白字符，避免把不同中文名称误合并。
fn normalize_wechat_reply_path_name(value: &str) -> String {
    value.chars().filter(|ch| !ch.is_whitespace()).collect()
}

/// 按扩展名归一化微信回复文件类型，交给 helper 直接映射到 SDK media.type。
fn wechat_reply_media_kind(path: &Path, file_name: &str, _size: u64) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .or_else(|| {
            Path::new(file_name)
                .extension()
                .and_then(|value| value.to_str())
        })
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => "image".to_string(),
        "mp4" | "mov" | "webm" | "mkv" | "avi" => "video".to_string(),
        _ => "file".to_string(),
    }
}

/// 生成映射文件和日志中使用的微信会话显示名。
fn wechat_display_name(request: &WechatThreadBridgeRequest) -> String {
    [
        request.room_topic.trim(),
        request.contact_name.trim(),
        request.sender_name.trim(),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or("微信会话")
    .to_string()
}

/// 空字符串在上下文中使用短横线占位，避免读者误以为字段缺失。
fn empty_to_dash(value: &str) -> &str {
    if value.trim().is_empty() {
        "-"
    } else {
        value.trim()
    }
}

/// 将微信媒体归一化为统一桥接附件输入，交给 Rust app-server client 继续 staging。
fn wechat_request_attachments(
    request: &WechatThreadBridgeRequest,
) -> Vec<StartLegalTurnAttachment> {
    request
        .media
        .as_ref()
        .and_then(wechat_media_to_attachment)
        .into_iter()
        .collect()
}

/// 判断当前微信附件是否携带了可直接访问的 URL、路径或字节。
fn wechat_media_has_accessible_content(media: &WechatThreadBridgeMedia) -> bool {
    !media.url.trim().is_empty()
        || !media.path.trim().is_empty()
        || !media.data_base64.trim().is_empty()
}

/// 微信入口只做归一化，不自行决定如何解析文件内容。
fn wechat_media_to_attachment(media: &WechatThreadBridgeMedia) -> Option<StartLegalTurnAttachment> {
    let name = media.file_name.trim();
    if name.is_empty() && media.kind.trim().is_empty() && media.mime_type.trim().is_empty() {
        return None;
    }

    Some(StartLegalTurnAttachment {
        id: if name.is_empty() {
            "wechat-attachment".to_string()
        } else {
            format!("wechat-{}", name)
        },
        name: if name.is_empty() {
            "wechat-attachment".to_string()
        } else {
            name.to_string()
        },
        kind: media.kind.trim().to_string(),
        source: "wechat".to_string(),
        mime_type: media.mime_type.trim().to_string(),
        size: media.size,
        path: (!media.path.trim().is_empty()).then(|| media.path.trim().to_string()),
        url: (!media.url.trim().is_empty()).then(|| media.url.trim().to_string()),
        bytes: None,
        data_base64: (!media.data_base64.trim().is_empty())
            .then(|| media.data_base64.trim().to_string()),
    })
}

/// 将内部错误转换为微信端稳定、可读、不泄露底层细节的提示。
fn wechat_user_message_for_error(error: &AppError) -> String {
    match error.code.as_str() {
        "CODEX_AUTH_NOT_FOUND" => {
            "微信已连接，但当前律隐台账号还没登录。请先在桌面端完成账号登录，小隐才能继续回复消息。"
                .to_string()
        }
        "WECHAT_WORKSPACE_NOT_READY" | "WORKSPACE_NOT_FOUND" => {
            "微信已连接，但桌面端还没有配置可用工作空间。请先打开律隐台选择工作空间后再继续。"
                .to_string()
        }
        "TURN_COMPLETION_TIMEOUT" => {
            "桌面端小隐生成回复时间较长，本次微信回复已超时；你可以稍后在桌面端历史中查看或重新发送。"
                .to_string()
        }
        "APP_SERVER_PROTOCOL_ERROR"
            if error.message.contains("429") || error.message.contains("额度") =>
        {
            "当前 AI 套餐额度暂时不可用，请稍后重试或在桌面端检查套餐状态。".to_string()
        }
        "PLUGIN_INSTALL_FAILED" => {
            "桌面端运行环境初始化失败，当前微信消息暂时发不出去。请回到律隐台重启一次；如果还是不行，再联系开发者处理本机运行环境。"
                .to_string()
        }
        "CODEX_RUNTIME_START_FAILED" | "APP_SERVER_NOT_RUNNING" => {
            "桌面端小隐正在准备运行环境，暂时无法回复微信消息；请稍后重试。".to_string()
        }
        "TURN_RUNTIME_ERROR" => wechat_turn_runtime_error_message(error),
        _ => "桌面端小隐暂时无法回复微信消息，请稍后重试或回到律隐台查看详情。".to_string(),
    }
}

/// 将常见 turn 运行期错误转换为微信端可直接理解的提示。
fn wechat_turn_runtime_error_message(error: &AppError) -> String {
    if is_wechat_model_overloaded_error(error) {
        return "当前模型通道正忙，请稍后再试；如果连续多次出现，可以回到桌面端改用其他模型或稍后重试。"
            .to_string();
    }
    if is_wechat_quota_or_rate_limit_error(error) {
        return "当前 AI 套餐额度或调用频率已达上限，请稍后重试或在桌面端检查套餐状态。"
            .to_string();
    }
    if is_wechat_authentication_error(error) {
        return "当前 AI 模型认证信息不可用，桌面端暂时无法回复微信消息。请回到律隐台检查账号登录和模型配置。"
            .to_string();
    }
    if is_wechat_network_error(error) {
        return "桌面端连接 AI 服务时网络异常，本次微信回复没有成功发出。请稍后重试。".to_string();
    }
    "桌面端小隐执行回复时出错了，请稍后重试或回到律隐台查看详情。".to_string()
}

/// 判断微信 turn 失败是否属于模型通道过载，便于给微信端更明确的稳定提示。
fn is_wechat_model_overloaded_error(error: &AppError) -> bool {
    if contains_text_ignore_case(&error.message, "Selected model is at capacity") {
        return true;
    }
    error
        .details
        .as_ref()
        .and_then(|details| details.get("error"))
        .and_then(|value| value.get("codexErrorInfo"))
        .and_then(|value| value.as_str())
        == Some("serverOverloaded")
}

/// 判断 turn 失败是否属于额度或频率限制。
fn is_wechat_quota_or_rate_limit_error(error: &AppError) -> bool {
    let patterns = ["429", "rate limit", "quota", "credits", "额度", "频率限制"];
    contains_any_text_ignore_case(&error.message, &patterns)
        || error
            .details
            .as_ref()
            .and_then(|details| details.get("error"))
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .is_some_and(|message| contains_any_text_ignore_case(message, &patterns))
}

/// 判断 turn 失败是否属于认证问题。
fn is_wechat_authentication_error(error: &AppError) -> bool {
    let patterns = [
        "unauthorized",
        "forbidden",
        "authentication",
        "invalid api key",
        "api key",
        "401",
        "403",
    ];
    contains_any_text_ignore_case(&error.message, &patterns)
}

/// 判断 turn 失败是否属于网络或服务连接异常。
fn is_wechat_network_error(error: &AppError) -> bool {
    let patterns = [
        "timed out",
        "timeout",
        "network",
        "connection",
        "connect",
        "econn",
        "socket",
        "dns",
        "unreachable",
    ];
    contains_any_text_ignore_case(&error.message, &patterns)
}

/// 忽略大小写判断文本是否包含指定片段。
fn contains_text_ignore_case(text: &str, pattern: &str) -> bool {
    text.to_ascii_lowercase()
        .contains(&pattern.to_ascii_lowercase())
}

/// 忽略大小写判断文本是否包含任意一个常见片段。
fn contains_any_text_ignore_case(text: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|pattern| contains_text_ignore_case(text, pattern))
}

/// 当前时间戳。
fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 快速构造状态。
fn status_with_message(status: &str, message: &str) -> WechatLoginStatus {
    WechatLoginStatus {
        status: status.to_string(),
        message: message.to_string(),
        qr_ascii: None,
        account_id: None,
        updated_at: current_timestamp(),
    }
}

/// 定位微信登录 helper 脚本。
fn locate_wechat_login_helper() -> Result<PathBuf, AppError> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("client")
                .join("lex-vault")
                .join("src-tauri")
                .join("resources")
                .join(WECHAT_RESOURCE_DIRECTORY)
                .join(WECHAT_LOGIN_HELPER_FILE),
        );
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("resources")
                .join(WECHAT_RESOURCE_DIRECTORY)
                .join(WECHAT_LOGIN_HELPER_FILE),
        );
        candidates.push(
            current_dir
                .join("resources")
                .join(WECHAT_RESOURCE_DIRECTORY)
                .join(WECHAT_LOGIN_HELPER_FILE),
        );
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(
                parent
                    .join("resources")
                    .join(WECHAT_RESOURCE_DIRECTORY)
                    .join(WECHAT_LOGIN_HELPER_FILE),
            );
            candidates.push(
                parent
                    .join(WECHAT_RESOURCE_DIRECTORY)
                    .join(WECHAT_LOGIN_HELPER_FILE),
            );
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::new(
                "WECHAT_LOGIN_HELPER_NOT_FOUND",
                "未找到微信登录 helper",
                "请确认 resources/wechat/login-helper.mjs 已随应用分发",
                true,
            )
        })
}

/// 定位可用 Node.js。
fn locate_node_executable() -> PathBuf {
    if let Some(path) = std::env::var_os(LEX_VAULT_NODE_ENV) {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return candidate;
        }
    }
    for candidate in node_executable_candidates() {
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

/// 收集 Node 可执行文件候选。
fn node_executable_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_root) = runtime_root_from_env_or_common_locations() {
        #[cfg(windows)]
        candidates.push(runtime_root.join("dependencies/node/bin/node.exe"));
        #[cfg(not(windows))]
        candidates.push(runtime_root.join("dependencies/node/bin/node"));
    }
    candidates
}

/// 收集 Node helper 解析依赖时可尝试的模块根目录。
fn candidate_module_roots() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("client").join("lex-vault"));
        candidates.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.to_path_buf());
        }
    }
    if let Some(runtime_root) = runtime_root_from_env_or_common_locations() {
        candidates.push(runtime_root.join("dependencies").join("node"));
        candidates.push(runtime_root);
    }
    candidates
        .into_iter()
        .filter(|path| path.join(NODE_MODULES_DIRECTORY).is_dir())
        .collect()
}

/// 在环境变量、开发目录和缓存目录中查找内置 runtime。
fn runtime_root_from_env_or_common_locations() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(LEX_VAULT_RUNTIME_ROOT_ENV) {
        let candidate = PathBuf::from(path);
        if candidate.is_dir() {
            return Some(candidate);
        }
        return None;
    }
    let runtime_root = lex_vault_home_dir().ok()?.join(PRIMARY_RUNTIME_DIRECTORY);
    if is_valid_runtime_root(&runtime_root) {
        return Some(runtime_root);
    }
    None
}

/// 当前用户的微信 SDK 状态目录。
fn wechat_state_directory() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::new(
            "WECHAT_LOGIN_START_FAILED",
            "无法定位用户目录",
            "dirs::home_dir 返回空",
            true,
        )
    })?;
    Ok(wechat_state_directory_from_home(&home))
}

#[cfg(test)]
#[path = "../tests/commands_wechat_tests.rs"]
mod tests;
