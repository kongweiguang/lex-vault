//! 本机文件管理命令，供前端直接管理模板、法规、案例和案件材料目录。
//!
//! @author kongweiguang

use crate::logging::log_with_details;
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;
#[cfg(target_os = "windows")]
use std::slice;
use std::time::{SystemTime, UNIX_EPOCH};

use path_clean::PathClean;
use reqwest::Url;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HANDLE;
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Ole::CF_HDROP;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
/// 允许直接读取文本内容的文件大小上限。
const TEXT_PREVIEW_SIZE_LIMIT: u64 = 1024 * 1024;

/// 允许在前端直接展示文本预览的扩展名。
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "xml", "html", "htm", "csv", "yml", "yaml", "java", "ts", "tsx", "js", "jsx",
    "css", "rs", "toml",
];

/// 统一交给前端 JitViewer 渲染的扩展名。
const JIT_VIEWER_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "html", "htm", "txt", "md",
    "markdown", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "mp3", "wav", "ogg",
    "m4a", "flac", "mp4", "webm", "mov", "mkv", "avi", "ofd", "dxf", "xml", "yml", "yaml",
    "java", "ts", "tsx", "js", "jsx", "css", "rs", "toml",
];

/// Lex Vault 用户级缓存目录名。
const USER_CACHE_DIRECTORY: &str = ".lex-vault/cache";

/// 远程法规库索引缓存文件名。
const REMOTE_LAW_INDEX_CACHE_FILE: &str = "remote-laws-index.json";

/// 前端文件树节点，字段名与 TypeScript FileNode 保持一致。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileNode {
    /// 文件或文件夹展示名称。
    name: String,
    /// 相对业务根目录的路径。
    path: String,
    /// 节点类型，folder 表示目录，file 表示普通文件。
    r#type: String,
    /// 文件扩展名，目录节点为空。
    extension: Option<String>,
    /// 文件大小，单位为字节。
    size: Option<u64>,
    /// 最后修改时间，使用毫秒时间戳字符串便于前端展示和比较。
    modified_at: Option<String>,
    /// 子节点列表，仅目录节点存在。
    children: Option<Vec<NativeFileNode>>,
}

/// 前端文件内容预览结构，字段名与 TypeScript FileContent 保持一致。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileContent {
    /// 文件名称。
    name: String,
    /// 文件相对路径。
    path: String,
    /// 文件扩展名。
    extension: Option<String>,
    /// 文件大小，单位为字节。
    size: Option<u64>,
    /// 前端应使用的预览类型。
    preview_kind: String,
    /// 是否为可直接预览的文本文件。
    text: bool,
    /// 可通过 Tauri asset protocol 读取的真实文件路径。
    asset_path: Option<String>,
    /// 文本文件内容。
    content: Option<String>,
    /// 当前仅能走系统默认程序打开时的原因说明。
    external_reason: Option<String>,
    /// 本次预览实际使用的转换器。
    converter: String,
}

/// 文件预览策略结果，字段名与 TypeScript 约定保持一致。
#[derive(Debug)]
struct FilePreviewResult {
    /// 当前预览类型。
    preview_kind: String,
    /// 可通过 Tauri asset protocol 读取的真实文件路径。
    asset_path: Option<String>,
    /// 转换器类型。
    converter: String,
    /// 无法内置预览时的原因。
    external_reason: Option<String>,
}

/// 远程文件下载结果，字段名与 TypeScript RemoteLawDownloadResult 保持一致。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileDownloadResult {
    /// 下载后实际写入业务目录的相对路径，重名时可能自动追加序号。
    path: String,
}

/// 远程法规索引读取结果，字段名与 TypeScript RemoteLawIndexPayload 保持一致。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLawIndexPayload {
    /// 远程索引 JSON 原文，由前端继续按现有类型解析和兼容补齐。
    content: String,
    /// 本次返回是否直接来自本机缓存。
    cached: bool,
    /// 缓存写入时间，毫秒时间戳字符串；远程返回但缓存写入失败时为空。
    cached_at: Option<String>,
}

/// 列出本机目录下的可见文件树。
#[tauri::command]
pub fn list_native_files(root_path: String) -> Result<Vec<NativeFileNode>, String> {
    let root = normalize_root(&root_path)?;
    fs::create_dir_all(&root).map_err(|err| format!("创建目录失败：{err}"))?;
    list_children(&root, &root).map_err(|err| format!("读取目录失败：{err}"))
}

/// 读取本机文件内容，用于前端预览。
#[tauri::command]
pub async fn read_native_file(
    root_path: String,
    path: String,
) -> Result<NativeFileContent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_root(&root_path)?;
        let file = resolve_inside(&root, &path)?;
        if !file.is_file() {
            return Err("文件不存在".to_string());
        }

        let metadata = fs::metadata(&file).map_err(|err| format!("读取文件信息失败：{err}"))?;
        let extension = extension(&file);
        let preview = preview_file(&file, extension.as_deref(), metadata.len());
        let text = preview.preview_kind == "text" || preview.preview_kind == "markdown";
        let content = if text {
            Some(fs::read_to_string(&file).map_err(|err| format!("读取文件失败：{err}"))?)
        } else {
            None
        };
        let relative = relative_path(&root, &file);
        log_with_details(
            "INFO",
            "native_file_preview_resolved",
            "解析本机文件预览策略",
            json!({
                "path": relative,
                "extension": extension,
                "size": metadata.len(),
                "previewKind": preview.preview_kind,
                "converter": preview.converter,
                "assetPath": preview.asset_path,
                "text": text,
                "externalReason": preview.external_reason,
            }),
        );

        Ok(NativeFileContent {
            name: file_name(&file),
            path: relative,
            extension,
            size: Some(metadata.len()),
            preview_kind: preview.preview_kind,
            text,
            asset_path: preview.asset_path,
            content,
            external_reason: preview.external_reason,
            converter: preview.converter,
        })
    })
    .await
    .map_err(|err| format!("读取文件任务失败：{err}"))?
}

/// 在本机目录内创建文本文件。
#[tauri::command]
pub fn create_native_file(
    root_path: String,
    path: String,
    content: Option<String>,
) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let file = resolve_inside(&root, &path)?;
    if file.exists() {
        return Err("文件已存在".to_string());
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建父目录失败：{err}"))?;
    }
    fs::write(&file, content.unwrap_or_default()).map_err(|err| format!("创建文件失败：{err}"))
}

/// 在本机目录内创建文件夹。
#[tauri::command]
pub fn create_native_folder(root_path: String, path: String) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let folder = resolve_inside(&root, &path)?;
    if folder.exists() {
        return Err("文件夹已存在".to_string());
    }
    fs::create_dir_all(&folder).map_err(|err| format!("创建文件夹失败：{err}"))
}

/// 重命名或移动本机目录内的文件或文件夹。
#[tauri::command]
pub fn rename_native_path(root_path: String, path: String, new_path: String) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let source = resolve_inside(&root, &path)?;
    let target = resolve_inside(&root, &new_path)?;
    if !source.exists() {
        return Err("原路径不存在".to_string());
    }
    if source.is_dir() && target.starts_with(&source) {
        return Err("不能将文件夹移动到自身或子目录".to_string());
    }
    if target.exists() {
        return Err("目标路径已存在".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建目标目录失败：{err}"))?;
    }
    fs::rename(&source, &target).map_err(|err| format!("重命名失败：{err}"))
}

/// 复制本机目录内的文件或文件夹，目标重名时自动追加序号。
#[tauri::command]
pub fn copy_native_path(
    root_path: String,
    path: String,
    new_path: String,
) -> Result<String, String> {
    let root = normalize_root(&root_path)?;
    let source = resolve_inside(&root, &path)?;
    let target = resolve_inside(&root, &new_path)?;
    if !source.exists() {
        return Err("原路径不存在".to_string());
    }
    if source.is_dir() && target.starts_with(&source) {
        return Err("不能将文件夹复制到自身或子目录".to_string());
    }

    let final_target = unique_available_path(&target);
    copy_path_recursively(&source, &final_target).map_err(|err| format!("复制失败：{err}"))?;
    Ok(relative_path(&root, &final_target))
}

/// 删除本机目录内的文件或文件夹。
#[tauri::command]
pub fn delete_native_path(root_path: String, path: String) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let target = resolve_inside(&root, &path)?;
    if !target.exists() {
        return Ok(());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|err| format!("删除文件夹失败：{err}"))
    } else {
        fs::remove_file(&target).map_err(|err| format!("删除文件失败：{err}"))
    }
}

/// 写入上传文件到本机目录内。
#[tauri::command]
pub fn write_native_file(root_path: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let file = resolve_inside(&root, &path)?;
    if file.exists() {
        return Err("文件已存在".to_string());
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建父目录失败：{err}"))?;
    }
    fs::write(&file, bytes).map_err(|err| format!("写入文件失败：{err}"))
}

/// 通过 Tauri 本机命令读取远程法规索引，避免 WebView 跨域策略阻断静态镜像访问。
#[tauri::command]
pub fn fetch_remote_law_index(
    index_url: String,
    force_refresh: bool,
) -> Result<RemoteLawIndexPayload, String> {
    let cache_path = remote_law_index_cache_path()?;
    fetch_remote_law_index_with_cache(
        &index_url,
        force_refresh,
        &cache_path,
        download_remote_law_index_content,
    )
}

/// 从远程 URL 下载文件到本机业务目录内，目标重名时自动追加序号。
#[tauri::command]
pub fn download_remote_file_to_library(
    root_path: String,
    target_path: String,
    download_url: String,
) -> Result<RemoteFileDownloadResult, String> {
    let root = normalize_root(&root_path)?;
    let target = resolve_inside(&root, &target_path)?;
    let final_target = unique_available_path(&target);
    if let Some(parent) = final_target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建目标目录失败：{err}"))?;
    }

    let response = Client::new()
        .get(download_url.trim())
        .send()
        .map_err(|err| format!("下载法规失败：{err}"))?;
    if !response.status().is_success() {
        return Err(format!("下载法规失败：{}", response.status()));
    }
    let bytes = response
        .bytes()
        .map_err(|err| format!("读取法规内容失败：{err}"))?;
    fs::write(&final_target, bytes).map_err(|err| format!("写入法规文件失败：{err}"))?;

    Ok(RemoteFileDownloadResult {
        path: relative_path(&root, &final_target),
    })
}

/// 将业务根目录外部的本机文件或文件夹导入到指定目录，目标重名时自动追加序号。
#[tauri::command]
pub fn import_native_paths(
    root_path: String,
    parent_path: Option<String>,
    source_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let root = normalize_root(&root_path)?;
    let parent = resolve_directory_inside(&root, parent_path.as_deref())?;
    fs::create_dir_all(&parent).map_err(|err| format!("创建目标目录失败：{err}"))?;

    source_paths
        .iter()
        .map(|source_path| import_single_native_path(&root, &parent, source_path))
        .collect()
}

/// 读取 Windows 系统剪贴板中的文件列表，供资源管理器复制文件后直接粘贴到文件树。
#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    read_clipboard_file_paths_impl()
}

/// 使用系统默认程序打开本机目录内的文件。
#[tauri::command]
pub fn open_native_file(root_path: String, path: String) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let file = resolve_inside(&root, &path)?;
    if !file.is_file() {
        return Err("文件不存在".to_string());
    }

    open_file_with_default_program(&file)
}

/// 使用当前平台文件管理器打开本机目录。
#[tauri::command]
pub fn open_native_directory(directory_path: String) -> Result<(), String> {
    let directory = normalize_root(&directory_path)?;
    if !directory.is_dir() {
        return Err("目录不存在".to_string());
    }

    open_directory_with_system_manager(&directory)
}

fn open_file_with_default_program(file: &Path) -> Result<(), String> {
    // 默认打开动作交给 open crate 适配平台差异，避免手写 cmd/open/xdg-open 分支。
    open::that(file).map_err(|err| format!("打开文件失败：{err}"))
}

/// 使用当前平台文件管理器打开目录，或定位到指定文件。
#[tauri::command]
pub fn reveal_native_path(root_path: String, path: String) -> Result<(), String> {
    let root = normalize_root(&root_path)?;
    let target = resolve_inside(&root, &path)?;
    if !target.exists() {
        return Err("路径不存在".to_string());
    }

    reveal_path_with_system_manager(&target)
}

fn open_directory_with_system_manager(directory: &Path) -> Result<(), String> {
    // 普通打开目录交给 open crate，保持各平台默认文件管理器语义。
    open::that(directory).map_err(|err| format!("打开文件管理器失败：{err}"))
}

#[cfg(target_os = "windows")]
fn reveal_path_with_system_manager(target: &Path) -> Result<(), String> {
    // 文件使用 /select 定位，目录直接打开，保持“文件管理器”语义稳定。
    if target.is_file() {
        Command::new("explorer")
            .arg("/select,")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("定位文件失败：{err}"))
    } else {
        open_directory_with_system_manager(target)
    }
}

#[cfg(target_os = "macos")]
fn reveal_path_with_system_manager(target: &Path) -> Result<(), String> {
    // Finder 支持 reveal 文件；目录直接打开更符合用户预期。
    if target.is_file() {
        Command::new("open")
            .arg("-R")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("定位文件失败：{err}"))
    } else {
        open_directory_with_system_manager(target)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path_with_system_manager(target: &Path) -> Result<(), String> {
    // Linux 通用桌面环境没有稳定的 reveal 协议，文件退回打开父目录。
    if target.is_file() {
        target
            .parent()
            .ok_or_else(|| "文件父目录不存在".to_string())
            .and_then(open_directory_with_system_manager)
    } else {
        open_directory_with_system_manager(target)
    }
}

fn preview_file(file: &Path, extension: Option<&str>, size: u64) -> FilePreviewResult {
    if is_markdown_file(extension, size) {
        return FilePreviewResult {
            preview_kind: "markdown".to_string(),
            asset_path: None,
            converter: "none".to_string(),
            external_reason: None,
        };
    }

    if is_text_file(extension, size) {
        return FilePreviewResult {
            preview_kind: "text".to_string(),
            asset_path: None,
            converter: "none".to_string(),
            external_reason: None,
        };
    }

    if is_jit_viewer_file(extension) {
        return FilePreviewResult {
            preview_kind: "jit-viewer".to_string(),
            asset_path: Some(file.to_string_lossy().to_string()),
            converter: "jit-viewer".to_string(),
            external_reason: None,
        };
    }
    if is_archive_file(extension) {
        return FilePreviewResult {
            preview_kind: "archive".to_string(),
            asset_path: None,
            converter: "none".to_string(),
            external_reason: Some("压缩包暂不支持内置预览，请使用系统默认程序打开".to_string()),
        };
    }
    FilePreviewResult {
        preview_kind: "external".to_string(),
        asset_path: None,
        converter: "none".to_string(),
        external_reason: Some("当前格式暂不支持内置预览，请使用系统默认程序打开".to_string()),
    }
}

fn normalize_root(root_path: &str) -> Result<PathBuf, String> {
    if root_path.trim().is_empty() {
        return Err("根目录不能为空".to_string());
    }
    Ok(normalize_path(Path::new(root_path)))
}

#[cfg(target_os = "windows")]
fn read_clipboard_file_paths_impl() -> Result<Vec<String>, String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err() {
            return Ok(Vec::new());
        }
        OpenClipboard(None).map_err(|err| format!("打开系统剪贴板失败：{err}"))?;
    }

    let _guard = ClipboardGuard;
    let handle = unsafe {
        GetClipboardData(CF_HDROP.0 as u32).map_err(|err| format!("读取系统剪贴板失败：{err}"))?
    };
    extract_file_paths_from_hdrop(handle)
}

#[cfg(not(target_os = "windows"))]
fn read_clipboard_file_paths_impl() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn extract_file_paths_from_hdrop(handle: HANDLE) -> Result<Vec<String>, String> {
    let hdrop = HDROP(handle.0);
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, None) };
    let mut paths = Vec::with_capacity(count as usize);

    for index in 0..count {
        let length = unsafe { DragQueryFileW(hdrop, index, None) };
        if length == 0 {
            continue;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let written = unsafe { DragQueryFileW(hdrop, index, Some(buffer.as_mut_slice())) };
        if written == 0 {
            continue;
        }
        let path = String::from_utf16_lossy(unsafe {
            slice::from_raw_parts(buffer.as_ptr(), written as usize)
        });
        if !path.trim().is_empty() {
            paths.push(path);
        }
    }

    Ok(paths)
}

#[cfg(target_os = "windows")]
struct ClipboardGuard;

#[cfg(target_os = "windows")]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

fn parse_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "远程地址无效".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("远程地址只支持 http 或 https".to_string()),
    }
}

fn fetch_remote_law_index_with_cache<F>(
    index_url: &str,
    force_refresh: bool,
    cache_path: &Path,
    fetcher: F,
) -> Result<RemoteLawIndexPayload, String>
where
    F: FnOnce(&str) -> Result<String, String>,
{
    parse_http_url(index_url)?;
    if !force_refresh && cache_path.is_file() {
        let content =
            fs::read_to_string(cache_path).map_err(|err| format!("读取法规库缓存失败：{err}"))?;
        return Ok(RemoteLawIndexPayload {
            content,
            cached: true,
            cached_at: cached_at_from_metadata(cache_path),
        });
    }

    let content = fetcher(index_url)?;
    let cached_at = match write_remote_law_index_cache(cache_path, &content) {
        Ok(cached_at) => Some(cached_at),
        Err(error) => {
            eprintln!("写入法规库索引缓存失败：{error}");
            None
        }
    };

    Ok(RemoteLawIndexPayload {
        content,
        cached: false,
        cached_at,
    })
}

fn download_remote_law_index_content(index_url: &str) -> Result<String, String> {
    let url = parse_http_url(index_url)?;
    let response = Client::new()
        .get(url)
        .send()
        .map_err(|err| format!("读取法规库索引失败：{err}"))?;
    if !response.status().is_success() {
        return Err(format!("读取法规库索引失败：{}", response.status()));
    }

    response
        .text()
        .map_err(|err| format!("解析法规库索引失败：{err}"))
}

fn remote_law_index_cache_path() -> Result<PathBuf, String> {
    user_home_directory().map(|home| {
        home.join(USER_CACHE_DIRECTORY)
            .join(REMOTE_LAW_INDEX_CACHE_FILE)
    })
}

fn user_home_directory() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取当前用户目录".to_string())
}

fn write_remote_law_index_cache(cache_path: &Path, content: &str) -> Result<String, String> {
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建法规库缓存目录失败：{err}"))?;
    }

    let temporary_path = cache_path.with_extension("json.tmp");
    fs::write(&temporary_path, content).map_err(|err| format!("写入法规库临时缓存失败：{err}"))?;
    fs::rename(&temporary_path, cache_path).map_err(|err| format!("替换法规库缓存失败：{err}"))?;
    cached_at_from_metadata(cache_path).ok_or_else(|| "读取法规库缓存时间失败".to_string())
}

fn cached_at_from_metadata(cache_path: &Path) -> Option<String> {
    fs::metadata(cache_path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_millis)
}

fn system_time_millis(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().to_string())
}

fn resolve_inside(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.trim().is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    let resolved = normalize_path(&root.join(relative_path));
    if !resolved.starts_with(root) || resolved == root {
        return Err("非法文件路径".to_string());
    }
    Ok(resolved)
}

fn resolve_directory_inside(root: &Path, relative_path: Option<&str>) -> Result<PathBuf, String> {
    match relative_path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => {
            let directory = resolve_inside(root, path)?;
            if directory.exists() && !directory.is_dir() {
                return Err("目标目录不是文件夹".to_string());
            }
            Ok(directory)
        }
        None => Ok(root.to_path_buf()),
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    // 使用 path-clean 只做语法级路径规整，不要求目标文件提前存在。
    absolute.clean()
}

fn import_single_native_path(
    root: &Path,
    parent: &Path,
    source_path: &str,
) -> Result<String, String> {
    if source_path.trim().is_empty() {
        return Err("导入路径不能为空".to_string());
    }
    let source = normalize_path(Path::new(source_path));
    if !source.exists() {
        return Err("导入路径不存在".to_string());
    }
    if source.starts_with(root) {
        return Err("导入路径已经位于当前业务目录内".to_string());
    }

    let name = source
        .file_name()
        .ok_or_else(|| "导入路径名称无效".to_string())?;
    let target = unique_available_path(&parent.join(name));
    copy_path_recursively(&source, &target).map_err(|err| format!("导入失败：{err}"))?;
    Ok(relative_path(root, &target))
}

fn copy_path_recursively(source: &Path, target: &Path) -> io::Result<()> {
    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let child_source = entry.path();
            let child_target = target.join(entry.file_name());
            copy_path_recursively(&child_source, &child_target)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, target).map(|_| ())
}

fn unique_available_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let file_name = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| file_name(path));
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string());

    for index in 1.. {
        let candidate_name = match &extension {
            Some(extension) if !extension.is_empty() => {
                format!("{file_name} ({index}).{extension}")
            }
            _ => format!("{file_name} ({index})"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path.to_path_buf()
}

fn list_children(root: &Path, directory: &Path) -> io::Result<Vec<NativeFileNode>> {
    let mut entries = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| is_visible(entry.path().as_path()))
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        let left_path = left.path();
        let right_path = right.path();
        let left_dir = left_path.is_dir();
        let right_dir = right_path.is_dir();
        left_dir.cmp(&right_dir).reverse().then_with(|| {
            file_name(&left_path)
                .to_lowercase()
                .cmp(&file_name(&right_path).to_lowercase())
        })
    });

    entries
        .into_iter()
        .map(|entry| to_file_node(root, entry.path().as_path()))
        .collect()
}

fn to_file_node(root: &Path, path: &Path) -> io::Result<NativeFileNode> {
    let metadata = fs::metadata(path)?;
    let directory = metadata.is_dir();
    Ok(NativeFileNode {
        name: file_name(path),
        path: relative_path(root, path),
        r#type: if directory { "folder" } else { "file" }.to_string(),
        extension: if directory { None } else { extension(path) },
        size: if directory {
            None
        } else {
            Some(metadata.len())
        },
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().to_string()),
        children: if directory {
            Some(list_children(root, path)?)
        } else {
            None
        },
    })
}

fn is_visible(path: &Path) -> bool {
    !file_name(path).starts_with('.')
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn is_markdown_file(extension: Option<&str>, size: u64) -> bool {
    size <= TEXT_PREVIEW_SIZE_LIMIT && matches!(extension, Some("md" | "markdown"))
}

fn is_text_file(extension: Option<&str>, size: u64) -> bool {
    size <= TEXT_PREVIEW_SIZE_LIMIT
        && extension
            .map(|value| TEXT_EXTENSIONS.contains(&value))
            .unwrap_or(false)
}

fn is_jit_viewer_file(extension: Option<&str>) -> bool {
    extension
        .map(|value| JIT_VIEWER_EXTENSIONS.contains(&value))
        .unwrap_or(false)
}

fn is_archive_file(extension: Option<&str>) -> bool {
    matches!(extension, Some("zip" | "rar" | "7z" | "tar" | "gz"))
}

#[cfg(test)]
#[path = "../tests/commands_file_manager_tests.rs"]
mod tests;
