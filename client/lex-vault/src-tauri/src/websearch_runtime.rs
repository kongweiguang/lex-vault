//! 基于内置 runtime Playwright 包的网页检索运行时。
//!
//! @author kongweiguang

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::commands::codex::AppState;
use crate::jsonrpc::AppError;
use crate::logging::{log_error, log_info, log_with_details};
use crate::runtime_bundle::{ensure_primary_runtime_bundle, is_valid_runtime_root};

/// app-server 与本地 helper 约定的 runtime 根目录环境变量名。
const LEX_VAULT_RUNTIME_ROOT_ENV: &str = "LEX_VAULT_RUNTIME_ROOT";
/// app-server 与本地 helper 约定的 Node.js 解释器环境变量名。
const LEX_VAULT_NODE_ENV: &str = "LEX_VAULT_NODE";
/// helper 读取 Playwright 包路径的环境变量名。
const LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR_ENV: &str = "LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR";
/// Playwright 浏览器安装目录环境变量名。
const PLAYWRIGHT_BROWSERS_PATH_ENV: &str = "PLAYWRIGHT_BROWSERS_PATH";
/// Playwright 通用下载主机环境变量名。
const PLAYWRIGHT_DOWNLOAD_HOST_ENV: &str = "PLAYWRIGHT_DOWNLOAD_HOST";
/// Playwright Chromium 专属下载主机环境变量名。
const PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV: &str = "PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST";
/// Playwright 浏览器下载连接超时环境变量名。
const PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV: &str = "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT";
/// Lex Vault 自定义的 Playwright 通用下载主机覆盖环境变量。
const LEX_VAULT_PLAYWRIGHT_DOWNLOAD_HOST_ENV: &str = "LEX_VAULT_PLAYWRIGHT_DOWNLOAD_HOST";
/// Lex Vault 自定义的 Playwright Chromium 下载主机覆盖环境变量。
const LEX_VAULT_PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV: &str =
    "LEX_VAULT_PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST";
/// Lex Vault 自定义的 Playwright 下载连接超时覆盖环境变量。
const LEX_VAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV: &str =
    "LEX_VAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT";
/// 默认使用的公开国内 Playwright 镜像。
const DEFAULT_PLAYWRIGHT_DOWNLOAD_HOST: &str = "https://npmmirror.com/mirrors/playwright/";
/// 国内网络下浏览器安装连接建立通常更慢，适当放宽连接超时。
const DEFAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_MS: &str = "120000";
/// 内置网页检索资源目录名。
const WEBSEARCH_RESOURCE_DIRECTORY: &str = "websearch";
/// 网页检索 helper 文件名。
const WEBSEARCH_HELPER_FILE: &str = "search-helper.cjs";
/// 用户级网页检索目录名。
const WEBSEARCH_HOME_DIRECTORY: &str = "websearch";
/// 用户级 Playwright 浏览器缓存目录名。
const WEBSEARCH_BROWSERS_DIRECTORY: &str = "browsers";
/// 当前仅支持 Chromium。
const WEBSEARCH_BROWSER_CHANNEL: &str = "chromium";
/// 浏览器安装最长等待时间。
const WEBSEARCH_BROWSER_INSTALL_TIMEOUT_MS: u64 = 180_000;
/// 默认搜索条数。
pub(crate) const DEFAULT_WEB_SEARCH_LIMIT: u8 = 5;
/// 默认超时毫秒数。
pub(crate) const DEFAULT_WEB_SEARCH_TIMEOUT_MS: u64 = 15_000;
/// 默认搜索引擎。
pub(crate) const DEFAULT_WEB_SEARCH_ENGINE: &str = "sogou";
/// 微信文章搜索引擎。
pub(crate) const WECHAT_SEARCH_ENGINE: &str = "sogou_weixin";
/// Windows 子进程创建时不显示控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 供 MCP 工具调用的网页检索请求。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchRequest {
    /// 搜索关键字。
    pub query: String,
    /// 结果条数上限。
    pub limit: u8,
    /// 搜索引擎。
    pub engine: String,
    /// helper 超时。
    pub timeout_ms: u64,
    /// 是否在结果页摘要之外，继续访问结果页抓取简要页面摘要。
    pub include_page_summary: bool,
}

/// 单条网页搜索结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchItem {
    /// 结果标题。
    pub title: String,
    /// 结果链接。
    pub url: String,
    /// 搜索引擎摘要。
    pub snippet: String,
    /// 来源域名或站点名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// 结果时间；首版默认不强制提取。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    /// 访问结果页后抓取的简要页面摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_summary: Option<String>,
}

/// 网页检索结构化输出。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebSearchResult {
    /// 原始查询词。
    pub query: String,
    /// 实际使用的搜索引擎。
    pub engine: String,
    /// 返回结果数量。
    pub result_count: usize,
    /// 检索结果。
    pub results: Vec<WebSearchItem>,
}

/// 内部运行时上下文。
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebSearchRuntimeContext {
    /// 内置 runtime 根目录。
    runtime_root: PathBuf,
    /// Node.js 可执行文件。
    node_executable: PathBuf,
    /// runtime 中预装的 node_modules 根目录。
    runtime_node_modules: PathBuf,
    /// 预装的 Playwright 包目录。
    playwright_package_dir: PathBuf,
    /// Playwright CLI 脚本。
    playwright_cli: PathBuf,
    /// 打包资源中的网页检索 helper。
    helper_script: PathBuf,
    /// 用户级浏览器安装目录。
    browsers_directory: PathBuf,
}

/// 启动子进程后的输出与是否超时信息。
struct NodeProcessResult {
    /// 子进程最终输出。
    output: std::process::Output,
    /// 是否因为超时被主动结束。
    timed_out: bool,
}

/// 执行一次网页检索。
pub(crate) fn run_web_search(request: WebSearchRequest) -> Result<WebSearchResult, AppError> {
    let normalized = normalize_web_search_request(request)?;
    let context = prepare_websearch_runtime()?;
    if search_engine_requires_browser(&normalized.engine) {
        ensure_playwright_browser_ready_guarded(&context)?;
    }
    invoke_search_helper(&context, &normalized)
}

/// 启动后静默预热 Chromium 浏览器；失败只记录日志，不阻断应用启动。
pub(crate) fn spawn_silent_websearch_browser_prepare(app: AppHandle) {
    if !search_engine_requires_browser(DEFAULT_WEB_SEARCH_ENGINE)
        && !search_engine_requires_browser(WECHAT_SEARCH_ENGINE)
    {
        log_info(
            "websearch_browser_preload_skipped",
            "网页检索当前仅走 HTML 抓取，跳过 Chromium 预热",
        );
        return;
    }
    tauri::async_runtime::spawn(async move {
        let runtime_root = {
            let state = app.state::<AppState>();
            let _prepare_guard = state.runtime_bundle_prepare.lock().await;
            match tauri::async_runtime::spawn_blocking(ensure_primary_runtime_bundle).await {
                Ok(Ok(runtime_root)) => runtime_root,
                Ok(Err(error)) => {
                    log_with_details(
                        "WARN",
                        "websearch_browser_preload_skipped",
                        "网页检索浏览器预热跳过：主 runtime 尚未准备完成",
                        json!({
                            "code": error.code,
                            "title": error.title,
                            "message": error.message,
                        }),
                    );
                    return;
                }
                Err(error) => {
                    log_error(
                        "websearch_browser_preload_skipped",
                        format!("网页检索浏览器预热任务加入阻塞线程池失败：{error}"),
                    );
                    return;
                }
            }
        };

        match tauri::async_runtime::spawn_blocking(move || preload_websearch_browser(runtime_root))
            .await
        {
            Ok(Ok(())) => {
                log_info(
                    "websearch_browser_preload_ready",
                    "网页检索 Chromium 浏览器后台预热完成",
                );
            }
            Ok(Err(error)) => {
                log_with_details(
                    "WARN",
                    "websearch_browser_preload_failed",
                    "网页检索 Chromium 浏览器后台预热失败",
                    json!({
                        "code": error.code,
                        "title": error.title,
                        "message": error.message,
                    }),
                );
            }
            Err(error) => {
                log_error(
                    "websearch_browser_preload_failed",
                    format!("网页检索浏览器预热后台任务异常：{error}"),
                );
            }
        }
    });
}

/// 标准化用户请求并兜底默认值。
pub(crate) fn normalize_web_search_request(
    request: WebSearchRequest,
) -> Result<WebSearchRequest, AppError> {
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err(AppError::new(
            "WEBSEARCH_INVALID_REQUEST",
            "网页检索参数不完整",
            "query 不能为空",
            true,
        ));
    }
    let engine = normalize_search_engine(&request.engine)?;
    Ok(WebSearchRequest {
        query,
        limit: request.limit.clamp(1, 10),
        engine,
        timeout_ms: request.timeout_ms.clamp(5_000, 60_000),
        include_page_summary: request.include_page_summary,
    })
}

/// 准备 Playwright runtime 与 helper 上下文。
fn prepare_websearch_runtime() -> Result<WebSearchRuntimeContext, AppError> {
    let runtime_root = runtime_root_from_env_or_bundle()?;
    prepare_websearch_runtime_from_root(runtime_root)
}

/// 在已知 runtime 根目录的前提下准备 Playwright runtime 与 helper 上下文。
fn prepare_websearch_runtime_from_root(
    runtime_root: PathBuf,
) -> Result<WebSearchRuntimeContext, AppError> {
    let node_executable = node_executable_from_env_or_runtime(&runtime_root)?;
    let runtime_node_modules = runtime_root
        .join("dependencies")
        .join("node")
        .join("node_modules");
    if !runtime_node_modules.is_dir() {
        return Err(AppError::new(
            "WEBSEARCH_RUNTIME_MISSING",
            "网页检索运行时不完整",
            format!(
                "未找到 runtime node_modules 目录：{}",
                runtime_node_modules.display()
            ),
            true,
        ));
    }
    let playwright_package_dir = runtime_playwright_package_dir(&runtime_root)?;
    let playwright_cli = playwright_package_dir.join("cli.js");
    if !playwright_cli.is_file() {
        return Err(AppError::new(
            "WEBSEARCH_RUNTIME_MISSING",
            "网页检索运行时不完整",
            format!("未找到 Playwright CLI：{}", playwright_cli.display()),
            true,
        ));
    }
    let helper_script = locate_websearch_helper()?;
    let browsers_directory = websearch_browsers_directory()?;
    fs::create_dir_all(&browsers_directory).map_err(|err| {
        AppError::new(
            "WEBSEARCH_PREPARE_FAILED",
            "创建网页检索浏览器目录失败",
            format!("{}: {err}", browsers_directory.display()),
            true,
        )
    })?;

    Ok(WebSearchRuntimeContext {
        runtime_root,
        node_executable,
        runtime_node_modules,
        playwright_package_dir,
        playwright_cli,
        helper_script,
        browsers_directory,
    })
}

/// 确保当前用户的 Chromium 浏览器已安装到 Lex Vault 专属目录。
fn ensure_playwright_browser_ready(context: &WebSearchRuntimeContext) -> Result<(), AppError> {
    if is_playwright_browser_installed(context)? {
        return Ok(());
    }

    let output = spawn_node_process(
        &context.node_executable,
        &playwright_install_args(&context.playwright_cli),
        &playwright_environment(context),
        None,
        Some(context.runtime_root.as_path()),
        Some(WEBSEARCH_BROWSER_INSTALL_TIMEOUT_MS),
        "WEBSEARCH_BROWSER_INSTALL_FAILED",
        "安装网页检索浏览器失败",
    )?;
    if output.timed_out && is_playwright_browser_installed(context)? {
        return Ok(());
    }
    if !output.output.status.success() {
        return Err(AppError::new(
            "WEBSEARCH_BROWSER_INSTALL_FAILED",
            "安装网页检索浏览器失败",
            format!(
                "playwright install chromium 退出码异常：status={:?}, stderr={}",
                output.output.status.code(),
                String::from_utf8_lossy(&output.output.stderr).trim()
            ),
            true,
        ));
    }
    if !is_playwright_browser_installed(context)? {
        return Err(AppError::new(
            "WEBSEARCH_BROWSER_INSTALL_FAILED",
            "安装网页检索浏览器失败",
            "Playwright 安装命令执行完成，但未检测到 Chromium 可执行文件。".to_string(),
            true,
        ));
    }
    Ok(())
}

/// 使用进程级互斥保护浏览器安装链路，避免后台预热与前台调用重复安装 Chromium。
fn ensure_playwright_browser_ready_guarded(
    context: &WebSearchRuntimeContext,
) -> Result<(), AppError> {
    let _guard = browser_prepare_lock().lock().map_err(|_| {
        AppError::new(
            "WEBSEARCH_BROWSER_INSTALL_FAILED",
            "安装网页检索浏览器失败",
            "浏览器安装互斥锁已损坏".to_string(),
            true,
        )
    })?;
    ensure_playwright_browser_ready(context)
}

/// 供应用启动阶段后台预热 Chromium 使用；允许外部先复用已准备好的 runtime 根目录。
fn preload_websearch_browser(runtime_root: PathBuf) -> Result<(), AppError> {
    let context = prepare_websearch_runtime_from_root(runtime_root)?;
    ensure_playwright_browser_ready_guarded(&context)
}

/// 判断当前专属浏览器目录里是否已经具备 Chromium 可执行文件。
fn is_playwright_browser_installed(context: &WebSearchRuntimeContext) -> Result<bool, AppError> {
    let script = r#"
const fs = require('node:fs');
const playwright = require(process.env.LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR);
const executablePath = playwright.chromium.executablePath();
process.stdout.write(JSON.stringify({
  executablePath,
  exists: Boolean(executablePath) && fs.existsSync(executablePath),
}));
"#;
    let output = spawn_node_process(
        &context.node_executable,
        &node_eval_args(script),
        &playwright_environment(context),
        None,
        Some(context.runtime_root.as_path()),
        None,
        "WEBSEARCH_BROWSER_CHECK_FAILED",
        "检查网页检索浏览器失败",
    )?;
    if !output.output.status.success() {
        return Err(AppError::new(
            "WEBSEARCH_BROWSER_CHECK_FAILED",
            "检查网页检索浏览器失败",
            String::from_utf8_lossy(&output.output.stderr)
                .trim()
                .to_string(),
            true,
        ));
    }
    let payload: serde_json::Value =
        serde_json::from_slice(&output.output.stdout).map_err(|err| {
            AppError::new(
                "WEBSEARCH_BROWSER_CHECK_FAILED",
                "检查网页检索浏览器失败",
                format!("浏览器检查输出不是合法 JSON：{err}"),
                true,
            )
            .with_details(json!({
                "stdout": String::from_utf8_lossy(&output.output.stdout),
            }))
        })?;
    Ok(payload
        .get("exists")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

/// 调用 Node helper 执行网页检索。
fn invoke_search_helper(
    context: &WebSearchRuntimeContext,
    request: &WebSearchRequest,
) -> Result<WebSearchResult, AppError> {
    let input = serde_json::to_vec(request).map_err(|err| {
        AppError::new(
            "WEBSEARCH_EXECUTION_FAILED",
            "执行网页检索失败",
            format!("序列化 helper 请求失败：{err}"),
            true,
        )
    })?;
    let output = spawn_node_process(
        &context.node_executable,
        &search_helper_args(&context.helper_script),
        &playwright_environment(context),
        Some(&input),
        Some(context.runtime_root.as_path()),
        None,
        "WEBSEARCH_EXECUTION_FAILED",
        "执行网页检索失败",
    )?;
    if !output.output.status.success() {
        return Err(AppError::new(
            "WEBSEARCH_EXECUTION_FAILED",
            "执行网页检索失败",
            String::from_utf8_lossy(&output.output.stderr)
                .trim()
                .to_string(),
            true,
        )
        .with_details(json!({
            "stdout": String::from_utf8_lossy(&output.output.stdout),
            "stderr": String::from_utf8_lossy(&output.output.stderr),
        })));
    }
    let stdout = String::from_utf8(output.output.stdout).map_err(|err| {
        AppError::new(
            "WEBSEARCH_EXECUTION_FAILED",
            "执行网页检索失败",
            format!("helper 输出不是 UTF-8：{err}"),
            true,
        )
    })?;
    serde_json::from_str::<WebSearchResult>(stdout.trim()).map_err(|err| {
        AppError::new(
            "WEBSEARCH_EXECUTION_FAILED",
            "执行网页检索失败",
            format!("helper 输出不是合法结果 JSON：{err}"),
            true,
        )
        .with_details(json!({ "stdout": stdout }))
    })
}

/// 统一启动 Node 子进程。
fn spawn_node_process(
    node_executable: &Path,
    args: &[String],
    environment: &[(String, String)],
    stdin_payload: Option<&[u8]>,
    current_dir: Option<&Path>,
    timeout_ms: Option<u64>,
    error_code: &'static str,
    error_title: &'static str,
) -> Result<NodeProcessResult, AppError> {
    let mut command = Command::new(node_executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    command.args(args);
    for (key, value) in environment {
        command.env(key, value);
    }
    let mut child = command
        .stdin(if stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            AppError::new(
                error_code,
                error_title,
                format!(
                    "启动 Node helper 失败：{} {} ({err})",
                    node_executable.display(),
                    args.join(" ")
                ),
                true,
            )
        })?;
    if let Some(payload) = stdin_payload {
        let mut stdin = child.stdin.take().ok_or_else(|| {
            AppError::new(
                error_code,
                error_title,
                "子进程未提供 stdin 管道".to_string(),
                true,
            )
        })?;
        stdin.write_all(payload).map_err(|err| {
            AppError::new(
                error_code,
                error_title,
                format!("写入 Node helper stdin 失败：{err}"),
                true,
            )
        })?;
    }
    wait_for_child_output(child, timeout_ms, error_code, error_title)
}

/// 运行 Playwright CLI 的参数列表。
pub(crate) fn playwright_install_args(playwright_cli: &Path) -> Vec<String> {
    vec![
        playwright_cli.display().to_string(),
        "install".to_string(),
        WEBSEARCH_BROWSER_CHANNEL.to_string(),
    ]
}

/// `node -e` 参数列表。
fn node_eval_args(script: &str) -> Vec<String> {
    vec!["-e".to_string(), script.to_string()]
}

/// 调用网页检索 helper 的参数列表。
pub(crate) fn search_helper_args(helper_script: &Path) -> Vec<String> {
    vec![helper_script.display().to_string()]
}

/// 拼装 helper 与浏览器安装过程共用的环境变量。
fn playwright_environment(context: &WebSearchRuntimeContext) -> Vec<(String, String)> {
    let mut node_path_entries = vec![context.runtime_node_modules.display().to_string()];
    let pnpm_node_modules = context
        .runtime_node_modules
        .join(".pnpm")
        .join("node_modules");
    if pnpm_node_modules.is_dir() {
        node_path_entries.push(pnpm_node_modules.display().to_string());
    }
    let mut environment = vec![
        (
            LEX_VAULT_RUNTIME_ROOT_ENV.to_string(),
            context.runtime_root.display().to_string(),
        ),
        (
            LEX_VAULT_NODE_ENV.to_string(),
            context.node_executable.display().to_string(),
        ),
        (
            LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR_ENV.to_string(),
            context.playwright_package_dir.display().to_string(),
        ),
        (
            PLAYWRIGHT_BROWSERS_PATH_ENV.to_string(),
            context.browsers_directory.display().to_string(),
        ),
        (
            "NODE_PATH".to_string(),
            join_environment_paths(&node_path_entries),
        ),
    ];
    extend_playwright_download_environment(&mut environment);
    environment
}

/// 从 runtime 根目录解析预装的 Playwright 包目录。
pub(crate) fn runtime_playwright_package_dir(runtime_root: &Path) -> Result<PathBuf, AppError> {
    let candidate = runtime_root
        .join("dependencies")
        .join("node")
        .join("node_modules")
        .join("playwright");
    if candidate.is_dir() {
        return Ok(normalize_node_friendly_path(
            std::fs::canonicalize(&candidate).unwrap_or(candidate),
        ));
    }
    Err(AppError::new(
        "WEBSEARCH_RUNTIME_MISSING",
        "网页检索运行时不完整",
        format!("未找到 runtime 预装 Playwright 包：{}", candidate.display()),
        true,
    ))
}

/// 定位网页检索 helper。
fn locate_websearch_helper() -> Result<PathBuf, AppError> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("client")
                .join("lex-vault")
                .join("src-tauri")
                .join("resources")
                .join(WEBSEARCH_RESOURCE_DIRECTORY)
                .join(WEBSEARCH_HELPER_FILE),
        );
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("resources")
                .join(WEBSEARCH_RESOURCE_DIRECTORY)
                .join(WEBSEARCH_HELPER_FILE),
        );
        candidates.push(
            current_dir
                .join("resources")
                .join(WEBSEARCH_RESOURCE_DIRECTORY)
                .join(WEBSEARCH_HELPER_FILE),
        );
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(
                parent
                    .join("resources")
                    .join(WEBSEARCH_RESOURCE_DIRECTORY)
                    .join(WEBSEARCH_HELPER_FILE),
            );
            candidates.push(
                parent
                    .join(WEBSEARCH_RESOURCE_DIRECTORY)
                    .join(WEBSEARCH_HELPER_FILE),
            );
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::new(
                "WEBSEARCH_HELPER_NOT_FOUND",
                "未找到网页检索 helper",
                "请确认 resources/websearch/search-helper.cjs 已随应用分发".to_string(),
                true,
            )
        })
}

/// 按环境变量或内置 runtime bundle 定位运行时根目录。
fn runtime_root_from_env_or_bundle() -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os(LEX_VAULT_RUNTIME_ROOT_ENV) {
        let candidate = PathBuf::from(path);
        if is_valid_runtime_root(&candidate) {
            return Ok(normalize_node_friendly_path(
                std::fs::canonicalize(&candidate).unwrap_or(candidate),
            ));
        }
    }
    ensure_primary_runtime_bundle().map(normalize_node_friendly_path)
}

/// 按环境变量或 runtime 目录定位 Node.js。
fn node_executable_from_env_or_runtime(runtime_root: &Path) -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os(LEX_VAULT_NODE_ENV) {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(normalize_node_friendly_path(candidate));
        }
    }
    let candidate = if cfg!(windows) {
        runtime_root
            .join("dependencies")
            .join("node")
            .join("bin")
            .join("node.exe")
    } else {
        runtime_root
            .join("dependencies")
            .join("node")
            .join("bin")
            .join("node")
    };
    if candidate.is_file() {
        return Ok(normalize_node_friendly_path(
            std::fs::canonicalize(&candidate).unwrap_or(candidate),
        ));
    }
    Err(AppError::new(
        "WEBSEARCH_RUNTIME_MISSING",
        "网页检索运行时不完整",
        format!("未找到 runtime Node.js：{}", candidate.display()),
        true,
    ))
}

/// 统一返回用户级网页检索浏览器目录。
fn websearch_browsers_directory() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::new(
            "WEBSEARCH_PREPARE_FAILED",
            "无法定位用户目录",
            "dirs::home_dir 返回空".to_string(),
            true,
        )
    })?;
    Ok(websearch_home_dir_from_home(&home).join(WEBSEARCH_BROWSERS_DIRECTORY))
}

/// 生成用户级网页检索根目录。
pub(crate) fn websearch_home_dir_from_home(home: &Path) -> PathBuf {
    home.join(".lex-vault").join(WEBSEARCH_HOME_DIRECTORY)
}

/// 统一标准化引擎名称；当前支持公开网页检索与搜狗微信文章检索。
fn normalize_search_engine(engine: &str) -> Result<String, AppError> {
    let normalized = if engine.trim().is_empty() {
        DEFAULT_WEB_SEARCH_ENGINE.to_string()
    } else {
        engine.trim().to_lowercase()
    };
    if normalized == DEFAULT_WEB_SEARCH_ENGINE || normalized == WECHAT_SEARCH_ENGINE {
        return Ok(normalized);
    }
    Err(AppError::new(
        "WEBSEARCH_UNSUPPORTED_ENGINE",
        "暂不支持该搜索引擎",
        format!(
            "当前仅支持 {} 或 {}，收到：{}",
            DEFAULT_WEB_SEARCH_ENGINE, WECHAT_SEARCH_ENGINE, normalized
        ),
        true,
    ))
}

/// 仅需要浏览器自动化的引擎才触发 Playwright 浏览器安装检查。
fn search_engine_requires_browser(engine: &str) -> bool {
    match engine {
        DEFAULT_WEB_SEARCH_ENGINE | WECHAT_SEARCH_ENGINE => false,
        _ => false,
    }
}

/// 按当前平台的环境变量分隔符拼接路径列表。
fn join_environment_paths(entries: &[String]) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    entries.join(separator)
}

/// 把 Playwright 官方支持的浏览器下载环境变量透传给安装链路，
/// 允许桌面端复用企业内网制品库、国内 CDN 或代理，而不在代码里硬编码第三方镜像。
fn extend_playwright_download_environment(environment: &mut Vec<(String, String)>) {
    let explicit_download_host = read_trimmed_env(PLAYWRIGHT_DOWNLOAD_HOST_ENV)
        .or_else(|| read_trimmed_env(LEX_VAULT_PLAYWRIGHT_DOWNLOAD_HOST_ENV));
    let explicit_chromium_download_host = read_trimmed_env(PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV)
        .or_else(|| read_trimmed_env(LEX_VAULT_PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV));
    let explicit_timeout = read_trimmed_env(PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV)
        .or_else(|| read_trimmed_env(LEX_VAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV));

    append_env_alias(
        environment,
        PLAYWRIGHT_DOWNLOAD_HOST_ENV,
        LEX_VAULT_PLAYWRIGHT_DOWNLOAD_HOST_ENV,
    );
    append_env_alias(
        environment,
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV,
        LEX_VAULT_PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV,
    );
    append_env_alias(
        environment,
        PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV,
        LEX_VAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV,
    );
    if explicit_download_host.is_none() && explicit_chromium_download_host.is_none() {
        environment.push((
            PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST_ENV.to_string(),
            DEFAULT_PLAYWRIGHT_DOWNLOAD_HOST.to_string(),
        ));
    }
    if explicit_timeout.is_none() {
        environment.push((
            PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_ENV.to_string(),
            DEFAULT_PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT_MS.to_string(),
        ));
    }
    append_plain_env(environment, "HTTPS_PROXY");
    append_plain_env(environment, "HTTP_PROXY");
    append_plain_env(environment, "ALL_PROXY");
    append_plain_env(environment, "NO_PROXY");
    append_plain_env(environment, "NODE_EXTRA_CA_CERTS");
}

/// 读取标准环境变量或 Lex Vault 自定义别名，并统一写回 Playwright 官方键名。
fn append_env_alias(
    environment: &mut Vec<(String, String)>,
    official_key: &str,
    lex_vault_alias: &str,
) {
    if let Some(value) =
        read_trimmed_env(official_key).or_else(|| read_trimmed_env(lex_vault_alias))
    {
        environment.push((official_key.to_string(), value));
    }
}

/// 直接透传已有环境变量。
fn append_plain_env(environment: &mut Vec<(String, String)>, key: &str) {
    if let Some(value) = read_trimmed_env(key) {
        environment.push((key.to_string(), value));
    }
}

/// 读取并裁剪环境变量。
fn read_trimmed_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 浏览器安装是跨调用共享的副作用，使用进程级互斥避免并发安装。
fn browser_prepare_lock() -> &'static Mutex<()> {
    static BROWSER_PREPARE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    BROWSER_PREPARE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Node/Playwright 在 Windows 上对 `\\?\` 扩展前缀兼容性并不稳定；
/// helper 统一使用普通绝对路径，避免路径解析异常。
fn normalize_node_friendly_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.display().to_string();
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
        path
    }

    #[cfg(not(windows))]
    {
        path
    }
}

/// 等待子进程输出；若配置了超时，则在超时后主动结束并回传当前输出。
fn wait_for_child_output(
    mut child: std::process::Child,
    timeout_ms: Option<u64>,
    error_code: &'static str,
    error_title: &'static str,
) -> Result<NodeProcessResult, AppError> {
    let timed_out = if let Some(timeout_ms) = timeout_ms {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break false,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        break true;
                    }
                    thread::sleep(Duration::from_millis(250));
                }
                Err(err) => {
                    return Err(AppError::new(
                        error_code,
                        error_title,
                        format!("轮询 Node helper 状态失败：{err}"),
                        true,
                    ));
                }
            }
        }
    } else {
        false
    };
    let output = child.wait_with_output().map_err(|err| {
        AppError::new(
            error_code,
            error_title,
            format!("等待 Node helper 结束失败：{err}"),
            true,
        )
    })?;
    Ok(NodeProcessResult { output, timed_out })
}

#[cfg(test)]
#[path = "tests/websearch_runtime_tests.rs"]
mod tests;
