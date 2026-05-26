//! Codex app-server sidecar 进程管理。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};

use crate::jsonrpc::AppError;
use crate::runtime_bundle::{
    ensure_primary_runtime_bundle_with_reporter, is_valid_runtime_root, RuntimeBundleProgress,
};

/// 新版 app-server sidecar 文件名前缀。
const AGENT_SERVER_BINARY_PREFIX: &str = "agent-server";

/// 开发和部署环境中可显式指定 app-server 可执行文件的环境变量名。
const CODEX_APP_SERVER_ENV: &str = "LEX_VAULT_CODEX_APP_SERVER";

/// app-server 读取 Lex Vault Law provider token 的环境变量名。
const LEX_VAULT_LAW_TOKEN_ENV: &str = "LEX_VAULT_LAW_TOKEN";
/// app-server 与插件脚本读取 Python 解释器路径的环境变量名。
const LEX_VAULT_PYTHON_ENV: &str = "LEX_VAULT_PYTHON";
/// app-server 与插件脚本读取 Node.js 解释器路径的环境变量名。
const LEX_VAULT_NODE_ENV: &str = "LEX_VAULT_NODE";
/// app-server 与插件脚本读取 Lex Vault 内置 runtime 根目录的环境变量名。
const LEX_VAULT_RUNTIME_ROOT_ENV: &str = "LEX_VAULT_RUNTIME_ROOT";
/// app-server 与模型工具调用读取 Lex Vault 内置工具目录的环境变量名。
const LEX_VAULT_TOOLS_DIR_ENV: &str = "LEX_VAULT_TOOLS_DIR";
/// 当前工作空间根目录，供本地插件定位业务目录。
const LEX_VAULT_WORKSPACE_ROOT_ENV: &str = "LEX_VAULT_WORKSPACE_ROOT";
/// 当前工作空间级 SQLite 数据库路径，供本地插件直接访问。
const LEX_VAULT_WORKSPACE_DATABASE_ENV: &str = "LEX_VAULT_WORKSPACE_DATABASE";
/// Node REPL 运行时读取 Node.js 依赖目录搜索根的环境变量名。
const NODE_REPL_NODE_MODULE_DIRS_ENV: &str = "NODE_REPL_NODE_MODULE_DIRS";
/// Lex Vault 安装包内置 app-server sidecar 资源目录名。
const BUILTIN_BINARIES_DIRECTORY: &str = "binaries";
/// Lex Vault 安装包内置工具资源目录名。
const BUILTIN_TOOLS_DIRECTORY: &str = "tools";

/// Windows 子进程创建时不显示控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 运行中的 Codex app-server 子进程。
pub struct CodexProcess {
    /// 子进程句柄，用于停止 runtime 时结束 app-server。
    pub child: Child,
}

/// app-server 启动后交给 JSON-RPC 客户端接管的 stdio 句柄。
pub struct CodexProcessIo {
    /// 子进程句柄，用于停止 runtime 时结束 app-server。
    pub child: Child,
    /// JSON-RPC 写入通道。
    pub stdin: ChildStdin,
    /// JSON-RPC 读取通道。
    pub stdout: ChildStdout,
    /// app-server 日志通道，不能参与 JSON-RPC 解析。
    pub stderr: ChildStderr,
}

/// 负责定位并启动 Codex app-server sidecar。
pub struct CodexProcessManager;

/// 启动 app-server 前解析出的内置 runtime 信息。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct BuiltinRuntimeConfig {
    /// Python 可执行文件绝对路径。
    python_executable: String,
    /// Node.js 可执行文件绝对路径。
    node_executable: String,
    /// Lex Vault 内置 runtime 根目录绝对路径。
    runtime_root: String,
    /// Lex Vault 内置工具目录绝对路径。
    tools_directory: Option<String>,
    /// 需要暴露给 Node REPL 的 node_modules 搜索根目录。
    node_module_directories: Vec<String>,
    /// 需要前置到 app-server 子进程 PATH 的目录列表。
    path_entries: Vec<PathBuf>,
}

impl CodexProcessManager {
    /// 使用独立 `CODEX_HOME` 和登录 token 启动 `codex app-server --listen stdio://`。
    pub fn start(
        codex_home: &Path,
        access_token: &str,
        runtime_bundle_reporter: &mut dyn FnMut(RuntimeBundleProgress),
    ) -> Result<CodexProcessIo, AppError> {
        let binary = locate_codex_binary()?;
        std::fs::create_dir_all(codex_home).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "创建 Codex Home 失败",
                err.to_string(),
                true,
            )
        })?;

        let mut command = Command::new(&binary);
        // Windows 打包版启动 console subsystem 的 sidecar 时，需要显式隐藏子进程控制台窗口。
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        // `codex.exe` 需要 `app-server` 子命令，独立 sidecar 可执行文件直接接收参数。
        if !binary
            .file_stem()
            .and_then(|value| value.to_str())
            .map(is_direct_app_server_binary_name)
            .unwrap_or(false)
        {
            command.arg("app-server");
        }

        Self::apply_runtime_environment(&mut command, runtime_bundle_reporter)?;

        let mut child = command
            .arg("--listen")
            .arg("stdio://")
            .env("CODEX_HOME", codex_home)
            .env(LEX_VAULT_LAW_TOKEN_ENV, access_token)
            .current_dir(codex_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
                AppError::new(
                    "CODEX_RUNTIME_START_FAILED",
                    "启动 Codex app-server 失败",
                    format!("{}: {}", binary.display(), err),
                    true,
                )
            })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "无法接管 app-server stdin",
                "子进程没有提供 stdin 管道",
                true,
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "无法接管 app-server stdout",
                "子进程没有提供 stdout 管道",
                true,
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "无法接管 app-server stderr",
                "子进程没有提供 stderr 管道",
                true,
            )
        })?;

        Ok(CodexProcessIo {
            child,
            stdin,
            stdout,
            stderr,
        })
    }
}

impl CodexProcessManager {
    /// 为 app-server 及其后续子进程注入 Lex Vault 自动发现到的运行时环境。
    fn apply_runtime_environment(
        command: &mut Command,
        runtime_bundle_reporter: &mut dyn FnMut(RuntimeBundleProgress),
    ) -> Result<(), AppError> {
        let Some(runtime) = discover_builtin_runtime_config(runtime_bundle_reporter)? else {
            return Ok(());
        };
        let environment = build_runtime_environment(&runtime);
        for (key, value) in environment {
            command.env(key, value);
        }
        Ok(())
    }
}

/// 按开发目录、当前目录和打包目录的顺序查找 app-server 可执行文件。
fn locate_codex_binary() -> Result<PathBuf, AppError> {
    let binary_names = current_target_binary_names();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os(CODEX_APP_SERVER_ENV) {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        push_binary_candidates(
            &mut candidates,
            current_dir
                .join("src-tauri")
                .join("resources")
                .join(BUILTIN_BINARIES_DIRECTORY),
            &binary_names,
        );
        push_binary_candidates(&mut candidates, current_dir.clone(), &binary_names);
        push_binary_candidates(&mut candidates, current_dir.join(".."), &binary_names);
        push_binary_candidates(
            &mut candidates,
            current_dir
                .join("resources")
                .join(BUILTIN_BINARIES_DIRECTORY),
            &binary_names,
        );
        // 兼容旧版开发目录结构，避免本地尚未迁移 sidecar 时无法启动。
        push_binary_candidates(&mut candidates, current_dir.join("binaries"), &binary_names);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            push_binary_candidates(&mut candidates, parent.to_path_buf(), &binary_names);
            push_binary_candidates(
                &mut candidates,
                parent.join("resources").join(BUILTIN_BINARIES_DIRECTORY),
                &binary_names,
            );
            // 兼容旧版安装目录结构。
            push_binary_candidates(
                &mut candidates,
                parent.join(BUILTIN_BINARIES_DIRECTORY),
                &binary_names,
            );
        }
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::new(
                "CODEX_BINARY_NOT_FOUND",
                "未找到 Codex app-server 可执行文件",
                format!(
                    "请将当前平台对应的 {} 可执行文件放在 client/lex-vault/src-tauri/resources/binaries 目录或应用程序同级目录下",
                    current_target_binary_names().join(" / ")
                ),
                true,
            )
        })
}

/// 自动发现 Lex Vault 内置 runtime；优先应用资源目录，兼容回退到本机已有 Codex runtime 缓存。
fn discover_builtin_runtime_config(
    runtime_bundle_reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<Option<BuiltinRuntimeConfig>, AppError> {
    let Some(runtime_root) = locate_builtin_runtime_root(runtime_bundle_reporter)? else {
        return Ok(None);
    };
    let python_path = resolve_runtime_executable(&runtime_root, python_executable_candidates())?;
    let node_path = resolve_runtime_executable(&runtime_root, node_executable_candidates())?;
    let python_root = Path::new(&python_path)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "解析内置 Python 目录失败",
                python_path.clone(),
                true,
            )
        })?;
    let node_root = Path::new(&node_path)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "解析内置 Node.js 目录失败",
                node_path.clone(),
                true,
            )
        })?;
    let mut path_entries = Vec::new();
    push_existing_path_entry(
        &mut path_entries,
        runtime_root.join("dependencies").join("bin"),
    );
    push_existing_path_entry(&mut path_entries, python_root.clone());
    push_existing_path_entry(&mut path_entries, python_root.join("Scripts"));
    #[cfg(windows)]
    push_existing_path_entry(&mut path_entries, python_root.join("DLLs"));
    push_existing_path_entry(&mut path_entries, node_root.clone());
    let tools_directory = locate_builtin_tools_directory();
    if let Some(tools_directory) = tools_directory.clone() {
        push_existing_path_entry(&mut path_entries, tools_directory);
    }

    let mut node_module_directories = Vec::new();
    let node_modules = runtime_root
        .join("dependencies")
        .join("node")
        .join("node_modules");
    if node_modules.is_dir() {
        node_module_directories.push(node_modules.display().to_string());
    }

    Ok(Some(BuiltinRuntimeConfig {
        python_executable: python_path,
        node_executable: node_path,
        runtime_root: runtime_root.display().to_string(),
        tools_directory: tools_directory.map(|path| path.display().to_string()),
        node_module_directories,
        path_entries,
    }))
}

/// 构造 app-server 启动时应注入的运行时环境变量集合。
fn build_runtime_environment(runtime: &BuiltinRuntimeConfig) -> Vec<(String, String)> {
    let mut environment = Vec::new();
    environment.push((
        LEX_VAULT_PYTHON_ENV.to_string(),
        runtime.python_executable.clone(),
    ));
    environment.push((
        LEX_VAULT_NODE_ENV.to_string(),
        runtime.node_executable.clone(),
    ));
    environment.push((
        LEX_VAULT_RUNTIME_ROOT_ENV.to_string(),
        runtime.runtime_root.clone(),
    ));
    if let Some(tools_directory) = runtime.tools_directory.as_ref() {
        environment.push((LEX_VAULT_TOOLS_DIR_ENV.to_string(), tools_directory.clone()));
    }
    if !runtime.node_module_directories.is_empty() {
        environment.push((
            NODE_REPL_NODE_MODULE_DIRS_ENV.to_string(),
            join_environment_paths(&runtime.node_module_directories),
        ));
    }
    if let Some(path_value) = prepend_path_entries(&runtime.path_entries) {
        environment.push(("PATH".to_string(), path_value));
    }
    if let Ok(config) = crate::commands::local_data::get_app_config() {
        if !config.workspace_root.trim().is_empty() {
            environment.push((
                LEX_VAULT_WORKSPACE_ROOT_ENV.to_string(),
                config.workspace_root.clone(),
            ));
        }
        if !config.workspace_database.trim().is_empty() {
            environment.push((
                LEX_VAULT_WORKSPACE_DATABASE_ENV.to_string(),
                config.workspace_database,
            ));
        }
    }

    environment
}

/// 将用户配置的运行时目录前置到子进程 PATH，保持系统 PATH 作为回退。
fn prepend_path_entries(entries: &[PathBuf]) -> Option<String> {
    if entries.is_empty() {
        return None;
    }

    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut ordered_entries = Vec::new();
    for entry in entries {
        let value = entry.display().to_string();
        if ordered_entries.iter().any(|existing| existing == &value) {
            continue;
        }
        ordered_entries.push(value);
    }
    let existing = std::env::var("PATH").unwrap_or_default();
    if !existing.trim().is_empty() {
        ordered_entries.extend(
            existing
                .split(separator)
                .filter(|segment| !segment.trim().is_empty())
                .map(str::to_string),
        );
    }
    Some(ordered_entries.join(separator))
}

/// 按当前平台的环境变量分隔符拼接路径列表。
fn join_environment_paths(entries: &[String]) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    entries.join(separator)
}

/// 在开发目录、打包资源目录和兼容缓存目录中查找 Lex Vault 主 runtime 根目录。
fn locate_builtin_runtime_root(
    runtime_bundle_reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<Option<PathBuf>, AppError> {
    if let Some(path) = std::env::var_os(LEX_VAULT_RUNTIME_ROOT_ENV) {
        let candidate = PathBuf::from(path);
        if is_valid_runtime_root(&candidate) {
            return Ok(Some(std::fs::canonicalize(&candidate).unwrap_or(candidate)));
        }
    }
    ensure_primary_runtime_bundle_with_reporter(runtime_bundle_reporter).map(Some)
}

/// 在开发目录和打包资源目录中查找 Lex Vault 内置工具目录。
fn locate_builtin_tools_directory() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("resources")
                .join(BUILTIN_TOOLS_DIRECTORY),
        );
        candidates.push(current_dir.join("resources").join(BUILTIN_TOOLS_DIRECTORY));
        candidates.push(current_dir.join(BUILTIN_TOOLS_DIRECTORY));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("resources").join(BUILTIN_TOOLS_DIRECTORY));
            candidates.push(parent.join(BUILTIN_TOOLS_DIRECTORY));
        }
    }

    candidates
        .into_iter()
        .find(|path| path.is_dir())
        .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
}

/// 解析 runtime bundle 中的指定可执行文件。
fn resolve_runtime_executable(
    runtime_root: &Path,
    relative_candidates: &[&str],
) -> Result<String, AppError> {
    relative_candidates
        .iter()
        .map(|relative| runtime_root.join(relative))
        .find(|candidate| candidate.is_file())
        .map(|path| path.display().to_string())
        .ok_or_else(|| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "内置运行时文件缺失",
                format!(
                    "runtime={} missing any of: {}",
                    runtime_root.display(),
                    relative_candidates.join(", ")
                ),
                true,
            )
        })
}

/// 返回当前平台的 Node.js 可执行文件候选相对路径。
fn node_executable_candidates() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["dependencies/node/bin/node.exe"]
    }
    #[cfg(not(windows))]
    {
        &["dependencies/node/bin/node"]
    }
}

/// 返回当前平台的 Python 可执行文件候选相对路径。
fn python_executable_candidates() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["dependencies/python/python.exe"]
    }
    #[cfg(not(windows))]
    {
        &[
            "dependencies/python/bin/python3",
            "dependencies/python/bin/python",
        ]
    }
}

/// 将存在的目录加入 PATH 前置列表，并保持顺序稳定。
fn push_existing_path_entry(entries: &mut Vec<PathBuf>, candidate: PathBuf) {
    if candidate.is_dir() && !entries.iter().any(|existing| existing == &candidate) {
        entries.push(candidate);
    }
}

/// 判断当前可执行文件名是否已经是独立 app-server sidecar。
fn is_direct_app_server_binary_name(file_stem: &str) -> bool {
    file_stem.contains(AGENT_SERVER_BINARY_PREFIX)
}

/// 返回当前平台优先尝试的 sidecar 文件名列表。
fn current_target_binary_names() -> Vec<String> {
    binary_names_for_target(std::env::consts::OS, std::env::consts::ARCH)
}

/// 根据目标平台和架构生成 sidecar 文件名。
fn binary_names_for_target(target_os: &str, target_arch: &str) -> Vec<String> {
    let Some(target_suffix) = target_suffix_for_platform(target_os, target_arch) else {
        return Vec::new();
    };
    vec![format!("{}-{}", AGENT_SERVER_BINARY_PREFIX, target_suffix)]
}

/// 将给定目录下的候选 sidecar 文件按优先级加入查找列表。
fn push_binary_candidates(
    candidates: &mut Vec<PathBuf>,
    base_dir: PathBuf,
    binary_names: &[String],
) {
    for binary_name in binary_names {
        candidates.push(base_dir.join(binary_name));
    }
}

/// 将运行平台映射为 `resources/binaries/` 中的 sidecar 文件名后缀。
fn target_suffix_for_platform(target_os: &str, target_arch: &str) -> Option<&'static str> {
    match (target_os, target_arch) {
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc.exe"),
        ("windows", "aarch64") => Some("aarch64-pc-windows-msvc.exe"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        _ => None,
    }
}

#[cfg(test)]
#[path = "tests/codex_process_tests.rs"]
mod tests;
