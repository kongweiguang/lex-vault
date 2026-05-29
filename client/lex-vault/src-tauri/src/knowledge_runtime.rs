//! Lex Vault 独立知识库运行包与 graphify 适配层。
//!
//! @author kongweiguang

use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::appserver_client::lex_vault_runtime_model_base_url;
use crate::commands::local_data::read_saved_access_token;
use crate::jsonrpc::AppError;
use crate::logging::log_with_details;
use crate::runtime_bundle::{lex_vault_home_dir, RuntimeBundleProgress, RuntimeBundleStatus};

/// 独立知识库运行包目录名。
pub(crate) const KNOWLEDGE_RUNTIME_DIRECTORY: &str = "knowledge-runtime";
/// 独立知识库压缩包缓存文件名。
const KNOWLEDGE_RUNTIME_ARCHIVE_FILE_NAME: &str = "lex-vault-knowledge-runtime.zip";
/// 默认知识库运行包下载地址。
const KNOWLEDGE_RUNTIME_ARCHIVE_URL: &str =
    "https://lex-vault.oss-cn-beijing.aliyuncs.com/v0.1/lex-vault-knowledge-runtime.zip";
/// 已安装知识库运行包来源指纹文件。
const KNOWLEDGE_RUNTIME_SOURCE_METADATA_FILE: &str = "knowledge-runtime-source.json";
/// 允许外部覆盖知识库运行包地址。
const KNOWLEDGE_RUNTIME_ARCHIVE_URL_ENV: &str = "LEX_VAULT_KNOWLEDGE_RUNTIME_ARCHIVE_URL";
/// 允许外部直接覆盖 graphify 命令位置，便于调试或灰度切换。
const GRAPHIFY_COMMAND_ENV: &str = "LEX_VAULT_GRAPHIFY_COMMAND";
/// case 内 graphify 原生产物容器目录。
const CASE_INDEX_CONTAINER_DIRECTORY: &str = ".lex-vault/graphify";
/// case 内隐藏索引目录，保留 graphify 原生 graphify-out 结构以支持增量构建。
const CASE_INDEX_DIRECTORY: &str = ".lex-vault/graphify/graphify-out";
/// 索引构建元数据文件。
const CASE_INDEX_METADATA_FILE: &str = "index-metadata.json";
/// 下载缓存子目录。
const LEX_VAULT_DOWNLOADS_DIRECTORY: &str = "downloads";
/// 临时目录。
const LEX_VAULT_TEMP_DIRECTORY: &str = ".tmp";
/// 本地案件索引的 wiki 入口。
const FALLBACK_WIKI_ENTRY_RELATIVE_PATH: &str = "wiki/index.md";
/// 本地文本索引中单个文件最多保留的正文字符数，避免超大材料拖垮索引。
const FALLBACK_TEXT_FILE_CHAR_LIMIT: usize = 120_000;
/// graphify 接入服务端时固定使用的 Anthropic-compatible backend。
const GRAPHIFY_GATEWAY_BACKEND: &str = "claude";
/// graphify 当前固定走服务端 Anthropic 兼容网关模型名。
const GRAPHIFY_GATEWAY_MODEL: &str = "MiniMax-M2.7";
/// MiniMax Anthropic 兼容网关下的 graphify 语义分块 token 预算。
const GRAPHIFY_GATEWAY_TOKEN_BUDGET: &str = "4096";
/// Anthropic 兼容协议版本。
const GRAPHIFY_GATEWAY_ANTHROPIC_VERSION: &str = "2023-06-01";
/// graphify extract 默认输出目录名。
const GRAPHIFY_OUTPUT_DIRECTORY: &str = "graphify-out";
/// graphify 运行时内部副产物统一收敛到案件目录 .lex-vault 下。
const GRAPHIFY_RUNTIME_DIRECTORY: &str = ".lex-vault/graphify-runtime";
/// 案件源材料扫描时需要排除的目录，避免 graphify 反复吞入自身产物。
const GRAPHIFY_SOURCE_EXCLUDES: &[&str] = &[".lex-vault/", "graphify-out/"];
/// 正常 graphify 索引模式。
const GRAPHIFY_INDEX_MODE_EXTRACT: &str = "graphify-extract";
/// graphify 失败后的本地保底索引模式。
const GRAPHIFY_INDEX_MODE_FALLBACK: &str = "fallback-local-text";
/// Lex Vault 对 graphify runtime 的 MiniMax Anthropic 兼容补丁标记。
const GRAPHIFY_RUNTIME_PATCH_MARKER: &str = "LEX_VAULT_MINIMAX_ANTHROPIC_PATCH";

/// 当前可执行的 graphify 运行时视图。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KnowledgeRuntimeConfig {
    /// 知识库运行包根目录。
    pub runtime_root: PathBuf,
    /// graphify CLI 绝对路径。
    pub graphify_command: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KnowledgeRuntimeArchiveSource {
    url: Url,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct KnowledgeRuntimeSourceFingerprint {
    source_type: String,
    identity: String,
}

/// graphify 索引状态。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphifyIndexStatus {
    pub case_path: String,
    pub index_root: String,
    pub exists: bool,
    pub outdated: bool,
    pub built_at: Option<String>,
    pub source_file_count: usize,
    pub indexed_file_count: Option<usize>,
    pub wiki_entry_path: Option<String>,
    pub index_mode: Option<String>,
}

/// graphify 构建结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphifyBuildResult {
    pub case_path: String,
    pub index_root: String,
    pub built_at: String,
    pub source_file_count: usize,
    pub wiki_entry_path: Option<String>,
    pub index_mode: String,
    pub command: String,
}

/// graphify 搜索命中。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphifySearchHit {
    pub path: String,
    pub score: usize,
    pub snippet: String,
}

/// graphify 读取结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphifyReadResult {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GraphifyIndexMetadata {
    built_at: String,
    source_latest_modified_ms: u128,
    source_file_count: usize,
    indexed_file_count: usize,
    wiki_entry_path: Option<String>,
    #[serde(default = "default_graphify_index_mode")]
    index_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CaseSourceSnapshot {
    latest_modified_ms: u128,
    file_count: usize,
}

fn default_graphify_index_mode() -> String {
    GRAPHIFY_INDEX_MODE_FALLBACK.to_string()
}

/// 确保独立知识库运行包存在，并返回可执行 graphify 入口。
pub(crate) fn ensure_knowledge_runtime() -> Result<KnowledgeRuntimeConfig, AppError> {
    ensure_knowledge_runtime_with_reporter(&mut |_| {})
}

/// 确保独立知识库运行包存在，并允许调用方订阅下载与安装阶段进度。
pub(crate) fn ensure_knowledge_runtime_with_reporter(
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<KnowledgeRuntimeConfig, AppError> {
    if let Some(command) = std::env::var_os(GRAPHIFY_COMMAND_ENV) {
        let command = PathBuf::from(command);
        if command.is_file() {
            reporter(RuntimeBundleProgress {
                status: RuntimeBundleStatus::Ready,
                message: "知识库运行时组件已就绪".to_string(),
                step_current: Some(1),
                step_total: Some(1),
                downloaded_bytes: None,
                total_bytes: None,
            });
            return Ok(KnowledgeRuntimeConfig {
                runtime_root: command
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(PathBuf::new),
                graphify_command: command,
            });
        }
    }

    let lex_vault_home = lex_vault_home_dir()?;
    let runtime_root = lex_vault_home.join(KNOWLEDGE_RUNTIME_DIRECTORY);
    let metadata_path = lex_vault_home.join(KNOWLEDGE_RUNTIME_SOURCE_METADATA_FILE);
    let source = resolve_knowledge_runtime_archive_source()?;
    let fingerprint = knowledge_runtime_archive_source_fingerprint(&source);

    if is_valid_knowledge_runtime_root(&runtime_root)
        && read_installed_knowledge_runtime_fingerprint(&metadata_path)?
            .as_ref()
            .map(|installed| installed == &fingerprint)
            .unwrap_or(false)
    {
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Ready,
            message: "知识库运行时组件已就绪".to_string(),
            step_current: Some(1),
            step_total: Some(1),
            downloaded_bytes: None,
            total_bytes: None,
        });
        let graphify_command = resolve_graphify_command(&runtime_root)?;
        apply_graphify_runtime_patches(&runtime_root)?;
        return Ok(KnowledgeRuntimeConfig {
            runtime_root: std::fs::canonicalize(&runtime_root).unwrap_or(runtime_root),
            graphify_command,
        });
    }

    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Required,
        message: "正在准备案件知识库运行时组件，完成后即可构建 graphify 索引。".to_string(),
        step_current: Some(1),
        step_total: Some(1),
        downloaded_bytes: None,
        total_bytes: None,
    });

    let archive_path = download_knowledge_runtime_archive(
        &source.url,
        &lex_vault_home.join(LEX_VAULT_DOWNLOADS_DIRECTORY),
        reporter,
    )?;
    let installed_root =
        install_knowledge_runtime_from_archive(&archive_path, &lex_vault_home, reporter)?;
    write_installed_knowledge_runtime_fingerprint(&metadata_path, &fingerprint)?;
    let graphify_command = resolve_graphify_command(&installed_root)?;
    apply_graphify_runtime_patches(&installed_root)?;
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Ready,
        message: "知识库运行时组件准备完成".to_string(),
        step_current: Some(1),
        step_total: Some(1),
        downloaded_bytes: None,
        total_bytes: None,
    });
    Ok(KnowledgeRuntimeConfig {
        runtime_root: installed_root,
        graphify_command,
    })
}

/// 返回当前案件默认 graphify 索引目录。
pub(crate) fn case_graphify_index_root(case_path: &Path) -> PathBuf {
    CASE_INDEX_DIRECTORY
        .split('/')
        .fold(case_path.to_path_buf(), |acc, part| acc.join(part))
}

fn case_graphify_index_container_root(case_path: &Path) -> PathBuf {
    CASE_INDEX_CONTAINER_DIRECTORY
        .split('/')
        .fold(case_path.to_path_buf(), |acc, part| acc.join(part))
}

/// 检查当前案件的索引状态。
pub(crate) fn case_graphify_status(case_path: &Path) -> Result<GraphifyIndexStatus, AppError> {
    validate_case_path(case_path)?;
    let index_root = ensure_case_graphify_index_layout(case_path)?;
    let snapshot = collect_case_source_snapshot(case_path)?;
    let metadata = read_case_graphify_metadata(&index_root)?;
    let exists = index_root.is_dir() && metadata.is_some();
    let outdated = metadata
        .as_ref()
        .map(|value| {
            value.source_latest_modified_ms < snapshot.latest_modified_ms
                || value.source_file_count != snapshot.file_count
        })
        .unwrap_or(false);

    Ok(GraphifyIndexStatus {
        case_path: case_path.display().to_string(),
        index_root: index_root.display().to_string(),
        exists,
        outdated,
        built_at: metadata.as_ref().map(|value| value.built_at.clone()),
        source_file_count: snapshot.file_count,
        indexed_file_count: metadata.as_ref().map(|value| value.indexed_file_count),
        wiki_entry_path: metadata
            .as_ref()
            .and_then(|value| value.wiki_entry_path.clone()),
        index_mode: metadata.as_ref().map(|value| value.index_mode.clone()),
    })
}

/// 为当前案件构建或重建 graphify 索引。
pub(crate) fn build_case_graphify_index(
    case_path: &Path,
    force: bool,
) -> Result<GraphifyBuildResult, AppError> {
    validate_case_path(case_path)?;
    let snapshot = collect_case_source_snapshot(case_path)?;
    let runtime = ensure_knowledge_runtime()?;
    let lex_vault_home = lex_vault_home_dir()?;
    let temp_root = lex_vault_home
        .join(LEX_VAULT_TEMP_DIRECTORY)
        .join(format!("graphify-build-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "创建临时 graphify 目录失败",
            err.to_string(),
            true,
        )
    })?;
    prepare_graphify_staging_output(case_path, &temp_root, force)?;

    let build_result = (|| -> Result<GraphifyBuildResult, AppError> {
        let command_summary =
            format_graphify_command(&runtime.graphify_command, case_path, &temp_root);
        let output = build_graphify_extract_command(&runtime, case_path, &temp_root)?
            .output()
            .map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    "执行 graphify extract 失败",
                    err.to_string(),
                    true,
                )
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let index_mode = if output.status.success() {
            let built_root = resolve_graphify_output_root(&temp_root)?;
            move_graphify_output_into_case_index(case_path, &built_root, force)?;
            GRAPHIFY_INDEX_MODE_EXTRACT.to_string()
        } else if should_fallback_to_local_index(&stdout, &stderr) {
            log_with_details(
                "WARN",
                "graphify_index_fallback_started",
                "graphify extract 失败，已切换到本地文本保底索引",
                serde_json::json!({
                    "casePath": case_path.display().to_string(),
                    "status": output.status.code(),
                    "stdout": stdout,
                    "stderr": stderr,
                }),
            );
            let fallback_root = temp_root.join(GRAPHIFY_OUTPUT_DIRECTORY);
            if fallback_root.exists() {
                fs::remove_dir_all(&fallback_root).map_err(|err| {
                    AppError::new(
                        "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                        "清理临时 graphify 增量输出目录失败",
                        err.to_string(),
                        true,
                    )
                })?;
            }
            build_fallback_case_index(&fallback_root, case_path)?;
            move_graphify_output_into_case_index(case_path, &fallback_root, force)?;
            GRAPHIFY_INDEX_MODE_FALLBACK.to_string()
        } else {
            return Err(AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "graphify extract 构建失败",
                format!(
                    "status={:?}; stdout={}; stderr={}",
                    output.status.code(),
                    stdout.trim(),
                    stderr.trim()
                ),
                true,
            ));
        };

        cleanup_legacy_case_graphify_output(case_path)?;
        let final_index_root = case_graphify_index_root(case_path);
        let wiki_entry = detect_graphify_wiki_entry(&final_index_root)?;
        let indexed_file_count = count_index_documents(&final_index_root)?;
        let metadata = GraphifyIndexMetadata {
            built_at: chrono::Local::now().to_rfc3339(),
            source_latest_modified_ms: snapshot.latest_modified_ms,
            source_file_count: snapshot.file_count,
            indexed_file_count,
            wiki_entry_path: wiki_entry
                .as_ref()
                .map(|path| path.display().to_string())
                .map(|value| value.replace('\\', "/")),
            index_mode: index_mode.clone(),
        };
        write_case_graphify_metadata(&final_index_root, &metadata)?;
        log_with_details(
            "INFO",
            "graphify_index_built",
            "案件 graphify 索引构建完成",
            serde_json::json!({
                "casePath": case_path.display().to_string(),
                "indexRoot": final_index_root.display().to_string(),
                "sourceFileCount": snapshot.file_count,
                "indexedFileCount": indexed_file_count,
                "wikiEntryPath": metadata.wiki_entry_path,
                "indexMode": metadata.index_mode,
                "command": command_summary,
            }),
        );
        Ok(GraphifyBuildResult {
            case_path: case_path.display().to_string(),
            index_root: final_index_root.display().to_string(),
            built_at: metadata.built_at,
            source_file_count: snapshot.file_count,
            wiki_entry_path: metadata.wiki_entry_path,
            index_mode,
            command: command_summary,
        })
    })();

    if temp_root.exists() {
        let _ = fs::remove_dir_all(&temp_root);
    }
    build_result
}

/// 在案件 graphify 索引中按关键字搜索。
pub(crate) fn search_case_graphify_index(
    case_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<GraphifySearchHit>, AppError> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_SEARCH_FAILED",
            "检索关键字不能为空",
            "query is blank",
            true,
        ));
    }
    let index_root = ensure_case_graphify_index_ready(case_path)?;
    let query_lower = trimmed_query.to_lowercase();
    let mut hits = WalkDir::new(&index_root)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_searchable_index_file(path))
        .filter_map(|path| {
            let content = fs::read_to_string(&path).ok()?;
            let content_lower = content.to_lowercase();
            let score = content_lower.match_indices(&query_lower).count();
            if score == 0 {
                return None;
            }
            let snippet = build_search_snippet(&content, trimmed_query);
            Some(GraphifySearchHit {
                path: path
                    .strip_prefix(&index_root)
                    .unwrap_or(&path)
                    .display()
                    .to_string()
                    .replace('\\', "/"),
                score,
                snippet,
            })
        })
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
    });
    hits.truncate(limit.max(1));
    Ok(hits)
}

/// 读取案件 graphify 索引中的 wiki 入口或指定文件。
pub(crate) fn read_case_graphify_index(
    case_path: &Path,
    relative_path: Option<&str>,
) -> Result<GraphifyReadResult, AppError> {
    let index_root = ensure_case_graphify_index_ready(case_path)?;
    let target = match relative_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => resolve_graphify_index_path(&index_root, path)?,
        None => detect_graphify_wiki_entry(&index_root)?.ok_or_else(|| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_READ_FAILED",
                "未找到 graphify wiki 入口文件",
                index_root.display().to_string(),
                true,
            )
        })?,
    };
    let content = fs::read_to_string(&target).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_READ_FAILED",
            "读取 graphify 索引文件失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(GraphifyReadResult {
        path: target
            .strip_prefix(&index_root)
            .unwrap_or(&target)
            .display()
            .to_string()
            .replace('\\', "/"),
        content,
    })
}

fn ensure_case_graphify_index_ready(case_path: &Path) -> Result<PathBuf, AppError> {
    let status = case_graphify_status(case_path)?;
    if !status.exists {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_INDEX_MISSING",
            "当前案件还没有知识库索引",
            "请先调用 case_graphify_build",
            true,
        ));
    }
    Ok(case_graphify_index_root(case_path))
}

fn build_graphify_extract_command(
    runtime: &KnowledgeRuntimeConfig,
    case_path: &Path,
    temp_root: &Path,
) -> Result<Command, AppError> {
    let token = read_saved_access_token().map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "读取 law-admin 登录 token 失败",
            err,
            true,
        )
    })?;
    if token.trim().is_empty() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "当前未登录 law-admin，无法构建 graphify 索引",
            "missing access token",
            true,
        ));
    }

    let mut command = build_graphify_cli_command(&runtime.graphify_command);
    command
        .current_dir(&runtime.runtime_root)
        .arg("extract")
        .arg(case_path)
        .arg("--backend")
        .arg(GRAPHIFY_GATEWAY_BACKEND)
        .arg("--model")
        .arg(GRAPHIFY_GATEWAY_MODEL)
        .arg("--token-budget")
        .arg(GRAPHIFY_GATEWAY_TOKEN_BUDGET)
        .args(graphify_source_exclude_args())
        .arg("--out")
        .arg(temp_root)
        .env("ANTHROPIC_BASE_URL", graphify_anthropic_base_url()?)
        .env("ANTHROPIC_API_KEY", token)
        .env("GRAPHIFY_OUT", case_graphify_runtime_root(case_path))
        .env(
            "GRAPHIFY_ANTHROPIC_VERSION",
            GRAPHIFY_GATEWAY_ANTHROPIC_VERSION,
        );
    Ok(command)
}

fn graphify_anthropic_base_url() -> Result<String, AppError> {
    let mut base_url = Url::parse(lex_vault_runtime_model_base_url()).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "解析模型网关地址失败",
            err.to_string(),
            true,
        )
    })?;
    let current_path = base_url.path().trim_end_matches('/');
    let anthropic_path = if let Some(prefix) = current_path.strip_suffix("/v1") {
        format!("{prefix}/anthropic")
    } else {
        format!("{current_path}/anthropic")
    };
    base_url.set_path(&anthropic_path);
    Ok(base_url.to_string())
}

fn format_graphify_command(graphify_command: &Path, case_path: &Path, temp_root: &Path) -> String {
    let launcher = graphify_command_prefix(graphify_command);
    let excludes = GRAPHIFY_SOURCE_EXCLUDES
        .iter()
        .map(|value| format!("--exclude {value}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{} extract \"{}\" --backend {} --model {} --token-budget {} {} --out \"{}\"",
        launcher,
        case_path.display(),
        GRAPHIFY_GATEWAY_BACKEND,
        GRAPHIFY_GATEWAY_MODEL,
        GRAPHIFY_GATEWAY_TOKEN_BUDGET,
        excludes,
        temp_root.display()
    )
}

fn graphify_source_exclude_args() -> Vec<String> {
    GRAPHIFY_SOURCE_EXCLUDES
        .iter()
        .flat_map(|value| ["--exclude".to_string(), (*value).to_string()])
        .collect()
}

fn case_graphify_runtime_root(case_path: &Path) -> PathBuf {
    GRAPHIFY_RUNTIME_DIRECTORY
        .split('/')
        .fold(case_path.to_path_buf(), |acc, part| acc.join(part))
}

fn build_graphify_cli_command(graphify_command: &Path) -> Command {
    if let Some(python_command) = resolve_graphify_python_command(graphify_command) {
        let mut command = Command::new(python_command);
        command.arg("-m").arg("graphify");
        command
    } else {
        Command::new(graphify_command)
    }
}

fn graphify_command_prefix(graphify_command: &Path) -> String {
    if let Some(python_command) = resolve_graphify_python_command(graphify_command) {
        format!("\"{}\" -m graphify", python_command.display())
    } else {
        format!("\"{}\"", graphify_command.display())
    }
}

fn resolve_graphify_python_command(graphify_command: &Path) -> Option<PathBuf> {
    let parent = graphify_command.parent()?;
    let candidates = [
        parent.join("python.exe"),
        parent.join("python"),
        parent
            .parent()
            .map(|value| value.join("bin").join("python"))
            .unwrap_or_default(),
        parent
            .parent()
            .map(|value| value.join("bin").join("python.exe"))
            .unwrap_or_default(),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn apply_graphify_runtime_patches(runtime_root: &Path) -> Result<(), AppError> {
    let llm_path = resolve_graphify_llm_path(runtime_root)?;
    let source = fs::read_to_string(&llm_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "读取 graphify llm.py 失败",
            err.to_string(),
            true,
        )
    })?;
    let patched = patch_graphify_llm_source(&source)?;
    if patched != source {
        fs::write(&llm_path, patched).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "写入 graphify llm.py 补丁失败",
                err.to_string(),
                true,
            )
        })?;
    }
    Ok(())
}

fn resolve_graphify_llm_path(runtime_root: &Path) -> Result<PathBuf, AppError> {
    [
        runtime_root
            .join("Lib")
            .join("site-packages")
            .join("graphify")
            .join("llm.py"),
        runtime_root
            .join("lib")
            .join("site-packages")
            .join("graphify")
            .join("llm.py"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
    .ok_or_else(|| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "未找到 graphify llm.py",
            runtime_root.display().to_string(),
            true,
        )
    })
}

fn patch_graphify_llm_source(source: &str) -> Result<String, AppError> {
    if source.contains(GRAPHIFY_RUNTIME_PATCH_MARKER) {
        return Ok(source.to_string());
    }
    let patched = replace_once(
        source,
        GRAPHIFY_OLD_CLAUDE_FUNCTION,
        GRAPHIFY_NEW_CLAUDE_FUNCTION,
        "graphify _call_claude",
    )?;
    replace_once(
        &patched,
        GRAPHIFY_OLD_CLAUDE_LLM_BRANCH,
        GRAPHIFY_NEW_CLAUDE_LLM_BRANCH,
        "graphify _call_llm claude branch",
    )
}

fn replace_once(source: &str, from: &str, to: &str, label: &str) -> Result<String, AppError> {
    let replaced = source.replacen(from, to, 1);
    if replaced == source {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            format!("未找到 {label} 补丁锚点"),
            label.to_string(),
            true,
        ));
    }
    Ok(replaced)
}

fn resolve_graphify_output_root(temp_root: &Path) -> Result<PathBuf, AppError> {
    let output_root = temp_root.join(GRAPHIFY_OUTPUT_DIRECTORY);
    if output_root.is_dir() {
        return Ok(output_root);
    }
    Err(AppError::new(
        "KNOWLEDGE_RUNTIME_BUILD_FAILED",
        "graphify 输出目录缺失",
        temp_root.display().to_string(),
        true,
    ))
}

fn ensure_case_graphify_index_layout(case_path: &Path) -> Result<PathBuf, AppError> {
    migrate_legacy_case_graphify_index_layout(case_path)?;
    Ok(case_graphify_index_root(case_path))
}

fn migrate_legacy_case_graphify_index_layout(case_path: &Path) -> Result<(), AppError> {
    let legacy_root = case_graphify_index_container_root(case_path);
    let final_index_root = case_graphify_index_root(case_path);
    if final_index_root.exists() || !legacy_case_graphify_index_exists(&legacy_root) {
        return Ok(());
    }
    fs::create_dir_all(&final_index_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "创建新版 graphify 索引目录失败",
            err.to_string(),
            true,
        )
    })?;
    for entry in fs::read_dir(&legacy_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "读取旧版 graphify 索引目录失败",
            err.to_string(),
            true,
        )
    })? {
        let entry = entry.map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "读取旧版 graphify 索引项失败",
                err.to_string(),
                true,
            )
        })?;
        if entry.file_name().to_string_lossy() == GRAPHIFY_OUTPUT_DIRECTORY {
            continue;
        }
        let source = entry.path();
        let target = final_index_root.join(entry.file_name());
        move_path_or_copy(&source, &target)?;
    }
    Ok(())
}

fn legacy_case_graphify_index_exists(legacy_root: &Path) -> bool {
    legacy_root.join("graph.json").is_file()
        || legacy_root.join("GRAPH_REPORT.md").is_file()
        || legacy_root.join(CASE_INDEX_METADATA_FILE).is_file()
        || legacy_root.join("wiki").is_dir()
}

fn prepare_graphify_staging_output(
    case_path: &Path,
    temp_root: &Path,
    force: bool,
) -> Result<(), AppError> {
    if force {
        return Ok(());
    }
    let final_index_root = ensure_case_graphify_index_layout(case_path)?;
    if !final_index_root.is_dir() {
        return Ok(());
    }
    let staging_output_root = temp_root.join(GRAPHIFY_OUTPUT_DIRECTORY);
    if staging_output_root.exists() {
        fs::remove_dir_all(&staging_output_root).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "清理临时 graphify 增量目录失败",
                err.to_string(),
                true,
            )
        })?;
    }
    copy_directory_recursively(&final_index_root, &staging_output_root)
}

fn move_graphify_output_into_case_index(
    case_path: &Path,
    built_root: &Path,
    _force: bool,
) -> Result<(), AppError> {
    let final_index_root = case_graphify_index_root(case_path);
    let parent = final_index_root.parent().ok_or_else(|| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "案件隐藏索引目录非法",
            final_index_root.display().to_string(),
            true,
        )
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "创建案件隐藏索引目录失败",
            err.to_string(),
            true,
        )
    })?;
    let backup_root = if final_index_root.exists() {
        let backup = parent.join(format!(
            ".{}-backup-{}",
            GRAPHIFY_OUTPUT_DIRECTORY,
            Uuid::new_v4()
        ));
        move_directory_or_copy(&final_index_root, &backup, "清理旧索引目录失败")?;
        Some(backup)
    } else {
        None
    };
    let publish_result = move_directory_or_copy(
        built_root,
        &final_index_root,
        "清理临时 graphify 输出目录失败",
    );
    match publish_result {
        Ok(()) => {
            if let Some(backup) = backup_root {
                fs::remove_dir_all(&backup).map_err(|err| {
                    AppError::new(
                        "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                        "清理 graphify 索引备份失败",
                        err.to_string(),
                        true,
                    )
                })?;
            }
            Ok(())
        }
        Err(err) => {
            if final_index_root.exists() {
                let _ = fs::remove_dir_all(&final_index_root);
            }
            if let Some(backup) = backup_root {
                let _ = move_directory_or_copy(&backup, &final_index_root, "恢复旧索引目录失败");
            }
            Err(err)
        }
    }
}

fn move_directory_or_copy(
    source: &Path,
    target: &Path,
    cleanup_title: &str,
) -> Result<(), AppError> {
    if !source.is_dir() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "graphify 输出目录缺失",
            source.display().to_string(),
            true,
        ));
    }
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => copy_directory_recursively(source, target).and_then(|_| {
            fs::remove_dir_all(source).map_err(|cleanup_err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    cleanup_title,
                    cleanup_err.to_string(),
                    true,
                )
            })
        }),
    }
}

fn move_path_or_copy(source: &Path, target: &Path) -> Result<(), AppError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "创建新版 graphify 索引父目录失败",
                err.to_string(),
                true,
            )
        })?;
    }
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) if source.is_dir() => copy_directory_recursively(source, target).and_then(|_| {
            fs::remove_dir_all(source).map_err(|cleanup_err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    "清理旧版 graphify 索引目录失败",
                    cleanup_err.to_string(),
                    true,
                )
            })
        }),
        Err(_) => fs::copy(source, target)
            .map(|_| ())
            .and_then(|_| fs::remove_file(source))
            .map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    "迁移旧版 graphify 索引文件失败",
                    err.to_string(),
                    true,
                )
            }),
    }
}

fn cleanup_legacy_case_graphify_output(case_path: &Path) -> Result<(), AppError> {
    let legacy_output_root = case_path.join(GRAPHIFY_OUTPUT_DIRECTORY);
    if !legacy_output_root.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&legacy_output_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "清理旧版 graphify 输出目录失败",
            err.to_string(),
            true,
        )
    })
}

fn copy_directory_recursively(source: &Path, target: &Path) -> Result<(), AppError> {
    if !source.is_dir() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "复制 graphify 输出目录失败",
            source.display().to_string(),
            true,
        ));
    }
    fs::create_dir_all(target).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "创建案件索引目录失败",
            err.to_string(),
            true,
        )
    })?;
    for entry in WalkDir::new(source).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "计算 graphify 输出相对路径失败",
                err.to_string(),
                true,
            )
        })?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let output_path = target.join(relative);
        if path.is_dir() {
            fs::create_dir_all(&output_path).map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    "创建案件索引子目录失败",
                    err.to_string(),
                    true,
                )
            })?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    AppError::new(
                        "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                        "创建案件索引父目录失败",
                        err.to_string(),
                        true,
                    )
                })?;
            }
            fs::copy(path, &output_path).map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                    "复制 graphify 输出文件失败",
                    err.to_string(),
                    true,
                )
            })?;
        }
    }
    Ok(())
}

fn should_fallback_to_local_index(stdout: &str, stderr: &str) -> bool {
    let combined = format!("{stdout}\n{stderr}").to_lowercase();
    [
        "no llm api key",
        "api key",
        "authentication",
        "unauthorized",
        "forbidden",
        "rate limit",
        "timed out",
        "timeout",
        "connection refused",
        "connection reset",
        "network",
        "upstream",
        "chat/completions",
        "ollama",
        "clientid",
        "401",
        "403",
        "429",
    ]
    .iter()
    .any(|keyword| combined.contains(keyword))
}

fn build_fallback_case_index(output_root: &Path, case_path: &Path) -> Result<(), AppError> {
    let wiki_root = output_root.join("wiki");
    let materials_root = wiki_root.join("materials");
    fs::create_dir_all(&materials_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "创建案件本地索引目录失败",
            err.to_string(),
            true,
        )
    })?;

    let mut index_lines = vec![
        "# 案件本地索引".to_string(),
        "".to_string(),
        "> 当前索引采用文本优先的本地构建策略：可直接读取的文本材料会纳入检索，其他材料先保留路径与元数据供后续继续定位。".to_string(),
        "".to_string(),
        format!("- 案件目录：`{}`", case_path.display()),
        format!("- 构建时间：`{}`", chrono::Local::now().to_rfc3339()),
        "".to_string(),
        "## 材料目录".to_string(),
        "".to_string(),
    ];

    let files = collect_case_source_files(case_path)?;
    for (index, source_path) in files.iter().enumerate() {
        let relative = source_path
            .strip_prefix(case_path)
            .unwrap_or(source_path)
            .display()
            .to_string()
            .replace('\\', "/");
        let target_name = format!("{:04}.md", index + 1);
        let target_path = materials_root.join(&target_name);
        let file_body = render_fallback_material_document(source_path, &relative)?;
        fs::write(&target_path, file_body).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "写入案件本地索引文件失败",
                err.to_string(),
                true,
            )
        })?;
        index_lines.push(format!("- [{}](./materials/{target_name})", relative));
    }

    if files.is_empty() {
        index_lines.push("- 当前案件目录下没有可纳入索引的材料文件。".to_string());
    }

    fs::write(wiki_root.join("index.md"), index_lines.join("\n")).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "写入案件本地索引入口失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(())
}

fn collect_case_source_files(case_path: &Path) -> Result<Vec<PathBuf>, AppError> {
    let files = WalkDir::new(case_path)
        .into_iter()
        .filter_entry(|entry| !should_skip_case_source_path(case_path, entry.path()))
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    Ok(files)
}

fn should_skip_case_source_path(case_path: &Path, path: &Path) -> bool {
    case_source_exclude_roots(case_path)
        .iter()
        .any(|exclude_root| path.starts_with(exclude_root))
}

fn case_source_exclude_roots(case_path: &Path) -> Vec<PathBuf> {
    vec![
        case_path.join(".lex-vault"),
        case_path.join(GRAPHIFY_OUTPUT_DIRECTORY),
    ]
}

fn render_fallback_material_document(
    source_path: &Path,
    relative_path: &str,
) -> Result<String, AppError> {
    let metadata = fs::metadata(source_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "读取案件材料元数据失败",
            err.to_string(),
            true,
        )
    })?;
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let (content_mode, content) = if is_fallback_text_source(&extension) {
        let raw = fs::read(source_path).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_BUILD_FAILED",
                "读取案件材料正文失败",
                err.to_string(),
                true,
            )
        })?;
        let text = String::from_utf8_lossy(&raw).to_string();
        (
            "text",
            truncate_fallback_content(&text, FALLBACK_TEXT_FILE_CHAR_LIMIT),
        )
    } else {
        (
            "metadata-only",
            "该文件当前未做正文抽取，保留文件路径、类型和大小供后续人工或工具继续定位。"
                .to_string(),
        )
    };

    Ok(format!(
        "# {relative_path}\n\n- 原始路径：`{relative_path}`\n- 文件大小：`{}` 字节\n- 提取模式：`{content_mode}`\n\n## 内容\n\n{}\n",
        metadata.len(),
        content
    ))
}

fn is_fallback_text_source(extension: &str) -> bool {
    matches!(
        extension,
        "md" | "markdown" | "txt" | "json" | "html" | "htm" | "csv"
    )
}

fn truncate_fallback_content(content: &str, limit: usize) -> String {
    if content.chars().count() <= limit {
        return content.to_string();
    }
    let truncated = content.chars().take(limit).collect::<String>();
    format!(
        "{truncated}\n\n[内容已截断：原始正文超过 {limit} 个字符，索引仅保留前半部分用于检索。]"
    )
}

fn validate_case_path(case_path: &Path) -> Result<(), AppError> {
    if !case_path.is_dir() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_CASE_PATH_INVALID",
            "案件目录不存在",
            case_path.display().to_string(),
            true,
        ));
    }
    Ok(())
}

fn resolve_knowledge_runtime_archive_source() -> Result<KnowledgeRuntimeArchiveSource, AppError> {
    let url = std::env::var(KNOWLEDGE_RUNTIME_ARCHIVE_URL_ENV)
        .unwrap_or_else(|_| KNOWLEDGE_RUNTIME_ARCHIVE_URL.to_string());
    let parsed = Url::parse(url.trim()).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "知识库运行包地址非法",
            err.to_string(),
            true,
        )
    })?;
    match parsed.scheme() {
        "http" | "https" => Ok(KnowledgeRuntimeArchiveSource { url: parsed }),
        _ => Err(AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "知识库运行包地址非法",
            parsed.to_string(),
            true,
        )),
    }
}

fn knowledge_runtime_archive_source_fingerprint(
    source: &KnowledgeRuntimeArchiveSource,
) -> KnowledgeRuntimeSourceFingerprint {
    KnowledgeRuntimeSourceFingerprint {
        source_type: "remote-url".to_string(),
        identity: source.url.to_string(),
    }
}

fn is_valid_knowledge_runtime_root(path: &Path) -> bool {
    path.is_dir() && resolve_graphify_command(path).is_ok()
}

fn resolve_graphify_command(runtime_root: &Path) -> Result<PathBuf, AppError> {
    graphify_command_candidates()
        .iter()
        .map(|relative| runtime_root.join(relative))
        .find(|candidate| candidate.is_file())
        .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
        .ok_or_else(|| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "知识库运行包缺少 graphify 可执行入口",
                runtime_root.display().to_string(),
                true,
            )
        })
}

fn graphify_command_candidates() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &[
            "bin/graphify.exe",
            "Scripts/graphify.exe",
            "graphify.exe",
            "venv/Scripts/graphify.exe",
        ]
    }
    #[cfg(not(windows))]
    {
        &[
            "bin/graphify",
            "graphify",
            "venv/bin/graphify",
            "scripts/graphify",
        ]
    }
}

fn read_installed_knowledge_runtime_fingerprint(
    metadata_path: &Path,
) -> Result<Option<KnowledgeRuntimeSourceFingerprint>, AppError> {
    if !metadata_path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(metadata_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "读取知识库运行包来源元数据失败",
            err.to_string(),
            true,
        )
    })?;
    let fingerprint =
        serde_json::from_str::<KnowledgeRuntimeSourceFingerprint>(&raw).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "解析知识库运行包来源元数据失败",
                err.to_string(),
                true,
            )
        })?;
    Ok(Some(fingerprint))
}

fn write_installed_knowledge_runtime_fingerprint(
    metadata_path: &Path,
    fingerprint: &KnowledgeRuntimeSourceFingerprint,
) -> Result<(), AppError> {
    let parent = metadata_path.parent().ok_or_else(|| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "写入知识库运行包来源元数据失败",
            metadata_path.display().to_string(),
            true,
        )
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "创建知识库运行包元数据目录失败",
            err.to_string(),
            true,
        )
    })?;
    let raw = serde_json::to_string_pretty(fingerprint).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "序列化知识库运行包来源元数据失败",
            err.to_string(),
            true,
        )
    })?;
    fs::write(metadata_path, raw).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "写入知识库运行包来源元数据失败",
            err.to_string(),
            true,
        )
    })
}

fn download_knowledge_runtime_archive(
    url: &Url,
    downloads_dir: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<PathBuf, AppError> {
    fs::create_dir_all(downloads_dir).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "创建知识库运行包下载目录失败",
            err.to_string(),
            true,
        )
    })?;
    let target_path = downloads_dir.join(KNOWLEDGE_RUNTIME_ARCHIVE_FILE_NAME);
    let temporary_path = downloads_dir.join(format!(
        "{KNOWLEDGE_RUNTIME_ARCHIVE_FILE_NAME}.{}.tmp",
        Uuid::new_v4()
    ));
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "创建知识库运行包下载客户端失败",
                err.to_string(),
                true,
            )
        })?;
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Downloading,
        message: "正在连接知识库运行时下载源，请稍候。".to_string(),
        step_current: None,
        step_total: None,
        downloaded_bytes: Some(0),
        total_bytes: None,
    });
    let mut response = client.get(url.clone()).send().map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "下载知识库运行包失败",
            err.to_string(),
            true,
        )
    })?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "下载知识库运行包失败",
            format!("{} {}", response.status(), url),
            true,
        ));
    }

    log_with_details(
        "INFO",
        "knowledge_runtime_download_started",
        "开始下载知识库运行包",
        serde_json::json!({
            "url": url.as_str(),
            "targetPath": target_path.display().to_string(),
            "contentLength": response.content_length(),
        }),
    );
    let total_bytes = response.content_length();
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Downloading,
        message: "正在下载案件知识库运行时组件，请勿关闭应用。".to_string(),
        step_current: Some(0),
        step_total: total_bytes,
        downloaded_bytes: Some(0),
        total_bytes,
    });

    let file = File::create(&temporary_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "创建知识库运行包缓存文件失败",
            err.to_string(),
            true,
        )
    })?;
    let mut writer = BufWriter::new(file);
    let mut buffer = [0_u8; 64 * 1024];
    let mut downloaded_bytes = 0_u64;
    loop {
        let read = response.read(&mut buffer).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "读取知识库运行包流失败",
                err.to_string(),
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "写入知识库运行包缓存失败",
                err.to_string(),
                true,
            )
        })?;
        downloaded_bytes += read as u64;
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Downloading,
            message: "正在下载案件知识库运行时组件，请勿关闭应用。".to_string(),
            step_current: Some(downloaded_bytes),
            step_total: total_bytes,
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes,
        });
    }
    writer.flush().map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "刷新知识库运行包缓存失败",
            err.to_string(),
            true,
        )
    })?;
    fs::rename(&temporary_path, &target_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "替换知识库运行包缓存失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(target_path)
}

fn install_knowledge_runtime_from_archive(
    archive_path: &Path,
    lex_vault_home: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<PathBuf, AppError> {
    fs::create_dir_all(lex_vault_home).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "创建 Lex Vault 用户目录失败",
            err.to_string(),
            true,
        )
    })?;
    let temp_root = lex_vault_home
        .join(LEX_VAULT_TEMP_DIRECTORY)
        .join(format!("knowledge-runtime-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "创建知识库运行包解压目录失败",
            err.to_string(),
            true,
        )
    })?;

    let install_result = (|| -> Result<PathBuf, AppError> {
        extract_knowledge_runtime_archive(archive_path, &temp_root, reporter)?;
        let extracted_root = resolve_extracted_knowledge_runtime_root(&temp_root)?;
        let final_root = lex_vault_home.join(KNOWLEDGE_RUNTIME_DIRECTORY);
        if final_root.exists() {
            fs::remove_dir_all(&final_root).map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                    "清理旧知识库运行包目录失败",
                    err.to_string(),
                    true,
                )
            })?;
        }
        fs::rename(&extracted_root, &final_root).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "替换知识库运行包目录失败",
                err.to_string(),
                true,
            )
        })?;
        Ok(std::fs::canonicalize(&final_root).unwrap_or(final_root))
    })();
    let _ = fs::remove_dir_all(&temp_root);
    install_result
}

fn extract_knowledge_runtime_archive(
    archive_path: &Path,
    target_root: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<(), AppError> {
    let file = File::open(archive_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "打开知识库运行包失败",
            err.to_string(),
            true,
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
            "解析知识库运行包失败",
            err.to_string(),
            true,
        )
    })?;
    let total_entries = archive.len() as u64;
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Extracting,
        message: "正在解压并安装案件知识库运行时组件，请稍候。".to_string(),
        step_current: Some(0),
        step_total: Some(total_entries),
        downloaded_bytes: None,
        total_bytes: None,
    });
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "读取知识库运行包条目失败",
                err.to_string(),
                true,
            )
        })?;
        let relative_path = sanitize_archive_entry_path(entry.name())?;
        let output_path = target_root.join(&relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                    "创建知识库运行包目录失败",
                    err.to_string(),
                    true,
                )
            })?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppError::new(
                    "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                    "创建知识库运行包父目录失败",
                    err.to_string(),
                    true,
                )
            })?;
        }
        let mut output = File::create(&output_path).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "创建知识库运行包文件失败",
                err.to_string(),
                true,
            )
        })?;
        io::copy(&mut entry, &mut output).map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "写入知识库运行包文件失败",
                err.to_string(),
                true,
            )
        })?;
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Extracting,
            message: "正在解压并安装案件知识库运行时组件，请稍候。".to_string(),
            step_current: Some((index + 1) as u64),
            step_total: Some(total_entries),
            downloaded_bytes: None,
            total_bytes: None,
        });
    }
    Ok(())
}

fn resolve_extracted_knowledge_runtime_root(temp_root: &Path) -> Result<PathBuf, AppError> {
    if is_valid_knowledge_runtime_root(temp_root) {
        return Ok(temp_root.to_path_buf());
    }
    let direct_root = temp_root.join(KNOWLEDGE_RUNTIME_DIRECTORY);
    if is_valid_knowledge_runtime_root(&direct_root) {
        return Ok(direct_root);
    }
    let child_directories = fs::read_dir(temp_root)
        .map_err(|err| {
            AppError::new(
                "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                "读取知识库运行包解压目录失败",
                err.to_string(),
                true,
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    if child_directories.len() == 1 && is_valid_knowledge_runtime_root(&child_directories[0]) {
        return Ok(child_directories[0].clone());
    }
    Err(AppError::new(
        "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
        "知识库运行包结构不正确",
        temp_root.display().to_string(),
        true,
    ))
}

fn sanitize_archive_entry_path(raw_path: &str) -> Result<PathBuf, AppError> {
    let mut sanitized = PathBuf::new();
    for component in Path::new(raw_path).components() {
        match component {
            Component::Normal(value) => sanitized.push(value),
            Component::CurDir => continue,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(AppError::new(
                    "KNOWLEDGE_RUNTIME_PREPARE_FAILED",
                    "知识库运行包包含非法路径",
                    raw_path.to_string(),
                    true,
                ));
            }
        }
    }
    Ok(sanitized)
}

fn collect_case_source_snapshot(case_path: &Path) -> Result<CaseSourceSnapshot, AppError> {
    let mut latest_modified_ms = 0_u128;
    let mut file_count = 0_usize;
    for entry in WalkDir::new(case_path)
        .into_iter()
        .filter_entry(|entry| !should_skip_case_source_path(case_path, entry.path()))
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.is_file() {
            file_count += 1;
            let modified_ms = fs::metadata(path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            if modified_ms > latest_modified_ms {
                latest_modified_ms = modified_ms;
            }
        }
    }
    Ok(CaseSourceSnapshot {
        latest_modified_ms,
        file_count,
    })
}

fn read_case_graphify_metadata(
    index_root: &Path,
) -> Result<Option<GraphifyIndexMetadata>, AppError> {
    let metadata_path = index_root.join(CASE_INDEX_METADATA_FILE);
    if !metadata_path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&metadata_path).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_READ_FAILED",
            "读取案件索引元数据失败",
            err.to_string(),
            true,
        )
    })?;
    let metadata = serde_json::from_str::<GraphifyIndexMetadata>(&raw).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_READ_FAILED",
            "解析案件索引元数据失败",
            err.to_string(),
            true,
        )
    })?;
    Ok(Some(metadata))
}

fn write_case_graphify_metadata(
    index_root: &Path,
    metadata: &GraphifyIndexMetadata,
) -> Result<(), AppError> {
    let raw = serde_json::to_string_pretty(metadata).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "序列化案件索引元数据失败",
            err.to_string(),
            true,
        )
    })?;
    fs::write(index_root.join(CASE_INDEX_METADATA_FILE), raw).map_err(|err| {
        AppError::new(
            "KNOWLEDGE_RUNTIME_BUILD_FAILED",
            "写入案件索引元数据失败",
            err.to_string(),
            true,
        )
    })
}

fn detect_graphify_wiki_entry(index_root: &Path) -> Result<Option<PathBuf>, AppError> {
    for relative in [
        FALLBACK_WIKI_ENTRY_RELATIVE_PATH,
        "wiki/index.md",
        "wiki/README.md",
        "GRAPH_REPORT.md",
        "index.md",
        "README.md",
        "wiki/index.html",
    ] {
        let candidate = relative
            .split('/')
            .fold(index_root.to_path_buf(), |acc, part| acc.join(part));
        if candidate.is_file() {
            return Ok(Some(candidate));
        }
    }
    Ok(WalkDir::new(index_root)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .find(|path| path.is_file() && is_searchable_index_file(path)))
}

fn count_index_documents(index_root: &Path) -> Result<usize, AppError> {
    Ok(WalkDir::new(index_root)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_searchable_index_file(path))
        .count())
}

fn is_searchable_index_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "txt" | "html" | "json")
    )
}

fn build_search_snippet(content: &str, query: &str) -> String {
    let lower_content = content.to_lowercase();
    let lower_query = query.to_lowercase();
    let index = lower_content.find(&lower_query).unwrap_or(0);
    let start = index.saturating_sub(60);
    let end = (index + query.len() + 120).min(content.len());
    content[start..end].replace('\n', " ").trim().to_string()
}

fn resolve_graphify_index_path(
    index_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, AppError> {
    let path = index_root.join(relative_path);
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| index_root.join(relative_path));
    if !normalized.starts_with(index_root) || !normalized.is_file() {
        return Err(AppError::new(
            "KNOWLEDGE_RUNTIME_READ_FAILED",
            "graphify 索引文件路径非法或不存在",
            relative_path.to_string(),
            true,
        ));
    }
    Ok(normalized)
}

const GRAPHIFY_OLD_CLAUDE_FUNCTION: &str = r#"def _call_claude(api_key: str, model: str, user_message: str, max_tokens: int = 8192) -> dict:
    """Call Anthropic Claude directly (not via OpenAI compat layer)."""
    try:
        import anthropic
    except ImportError as exc:
        raise ImportError(
            "Claude direct extraction requires the anthropic package. "
            "Run: pip install anthropic"
        ) from exc

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_EXTRACTION_SYSTEM,
        messages=[{"role": "user", "content": user_message}],
    )
    raw_content = resp.content[0].text if resp.content else None
    result = _parse_llm_json(raw_content or "{}")
    result["input_tokens"] = resp.usage.input_tokens if resp.usage else 0
    result["output_tokens"] = resp.usage.output_tokens if resp.usage else 0
    result["model"] = model
    # Normalise Anthropic's `stop_reason` to the OpenAI-compat `finish_reason`
    # vocabulary so the adaptive-retry layer doesn't have to know which
    # backend produced the result.
    result["finish_reason"] = "length" if resp.stop_reason == "max_tokens" else "stop"
    if _response_is_hollow(raw_content, result) and result["finish_reason"] != "length":
        print(
            "[graphify] claude returned a hollow response; treating as "
            "truncation so adaptive retry can bisect the chunk.",
            file=sys.stderr,
        )
        result["finish_reason"] = "length"
    return result
"#;

const GRAPHIFY_NEW_CLAUDE_FUNCTION: &str = r#"def _anthropic_base_url() -> str:
    return os.environ.get(
        "ANTHROPIC_BASE_URL",
        BACKENDS["claude"].get("base_url", "https://api.anthropic.com"),
    ).rstrip("/")


def _anthropic_timeout_seconds() -> float:
    timeout_raw = os.environ.get("GRAPHIFY_API_TIMEOUT", "").strip()
    timeout_s: float = 600.0
    if timeout_raw:
        try:
            v = float(timeout_raw)
            if v > 0:
                timeout_s = v
        except ValueError:
            pass
    return timeout_s


def _anthropic_headers(api_key: str) -> dict[str, str]:
    headers = {
        "x-api-key": api_key,
        "authorization": f"Bearer {api_key}",
        "anthropic-version": os.environ.get("GRAPHIFY_ANTHROPIC_VERSION", "2023-06-01"),
        "content-type": "application/json",
    }
    anthropic_beta = os.environ.get("GRAPHIFY_ANTHROPIC_BETA", "").strip()
    if anthropic_beta:
        headers["anthropic-beta"] = anthropic_beta
    return headers


def _anthropic_text_from_blocks(blocks: list[dict] | None) -> str:
    parts: list[str] = []
    for block in blocks or []:
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            parts.append(block["text"])
    return "\n".join(parts).strip()


def _anthropic_usage_value(usage: dict | None, field: str) -> int:
    value = (usage or {}).get(field)
    if isinstance(value, (int, float)):
        return int(value)
    return 0


def _anthropic_messages_create(
    api_key: str,
    payload: dict,
    *,
    context_label: str,
) -> dict:
    try:
        import httpx
    except ImportError as exc:
        raise ImportError(
            "Claude direct extraction requires the httpx package. "
            "Run: pip install httpx"
        ) from exc

    base_url = _anthropic_base_url()
    endpoint = f"{base_url}/v1/messages"
    response = httpx.post(
        endpoint,
        headers=_anthropic_headers(api_key),
        json=payload,
        timeout=_anthropic_timeout_seconds(),
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError(f"{context_label} returned a non-object response")
    return data


def _call_claude(api_key: str, model: str, user_message: str, max_tokens: int = 8192) -> dict:
    """Call Anthropic-compatible messages API directly."""
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": _EXTRACTION_SYSTEM,
        "messages": [{"role": "user", "content": user_message}],
    }
    data = _anthropic_messages_create(api_key, payload, context_label="claude")
    raw_content = _anthropic_text_from_blocks(data.get("content"))
    result = _parse_llm_json(raw_content or "{}")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else None
    result["input_tokens"] = _anthropic_usage_value(usage, "input_tokens")
    result["output_tokens"] = _anthropic_usage_value(usage, "output_tokens")
    result["model"] = model
    result["finish_reason"] = "length" if data.get("stop_reason") == "max_tokens" else "stop"
    if _response_is_hollow(raw_content, result) and result["finish_reason"] != "length":
        print(
            "[graphify] LEX_VAULT_MINIMAX_ANTHROPIC_PATCH claude returned a hollow response; "
            "treating as truncation so adaptive retry can bisect the chunk.",
            file=sys.stderr,
        )
        result["finish_reason"] = "length"
    return result
"#;

const GRAPHIFY_OLD_CLAUDE_LLM_BRANCH: &str = r#"    if backend == "claude":
        try:
            import anthropic
        except ImportError as exc:
            raise ImportError("anthropic package required for claude backend") from exc
        client = anthropic.Anthropic(api_key=key)
        resp = client.messages.create(
            model=mdl,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text if resp.content else ""
"#;

const GRAPHIFY_NEW_CLAUDE_LLM_BRANCH: &str = r#"    if backend == "claude":
        payload = {
            "model": mdl,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        data = _anthropic_messages_create(key, payload, context_label="claude")
        return _anthropic_text_from_blocks(data.get("content"))
"#;

#[cfg(test)]
#[path = "tests/knowledge_runtime_tests.rs"]
mod tests;
