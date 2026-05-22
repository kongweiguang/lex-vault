//! Codex 运行时与预装插件压缩包管理。
//!
//! @author kongweiguang

use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};

use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zip::ZipArchive;

use crate::jsonrpc::AppError;
use crate::logging::log_with_details;

/// 前端监听 runtime 包准备状态的事件名。
pub(crate) const RUNTIME_BUNDLE_EVENT_NAME: &str = "lex-vault://runtime-bundle";

/// Lex Vault 用户级数据目录名。
pub(crate) const LEX_VAULT_HOME_DIRECTORY: &str = ".lex-vault";
/// 统一主 runtime 目录名。
pub(crate) const PRIMARY_RUNTIME_DIRECTORY: &str = "codex-primary-runtime";
/// 用户级缓存中预期存在的 runtime zip 文件名。
const PRIMARY_RUNTIME_ARCHIVE_FILE_NAME: &str = "codex-primary-runtime.zip";
/// 云端 runtime zip 默认下载地址。
const PRIMARY_RUNTIME_ARCHIVE_URL: &str =
    "https://lex-vault.oss-cn-beijing.aliyuncs.com/v0.1/codex-primary-runtime.zip";
/// 下载后的 runtime zip 在 Lex Vault 家目录中的缓存子目录。
const LEX_VAULT_DOWNLOADS_DIRECTORY: &str = "downloads";
/// 解压阶段使用的临时目录。
const LEX_VAULT_TEMP_DIRECTORY: &str = ".tmp";
/// 当前已安装 runtime 源信息元数据文件名。
const PRIMARY_RUNTIME_SOURCE_METADATA_FILE: &str = "codex-primary-runtime-source.json";
/// 覆盖云端 runtime zip 地址的环境变量名，便于切换灰度包。
const RUNTIME_ARCHIVE_URL_ENV: &str = "LEX_VAULT_RUNTIME_ARCHIVE_URL";

/// 当前 runtime 实际采用的压缩包来源。
#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeArchiveSource {
    /// 当前代码指定的远端 zip 地址；它同时承担版本标识角色。
    url: Url,
}

/// 已安装 runtime 的来源指纹，用于判断是否需要重新下载、重新解压。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct RuntimeBundleSourceFingerprint {
    /// 来源类型，当前固定为 remote-url。
    source_type: String,
    /// 来源标识，当前使用代码中的远端 URL 作为版本标识。
    identity: String,
}

/// runtime 包准备阶段的稳定状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeBundleStatus {
    /// 需要先准备 runtime，当前会阻断用户继续使用助手。
    Required,
    /// 正在下载 runtime 压缩包。
    Downloading,
    /// 正在解压或安装 runtime。
    Extracting,
    /// runtime 已准备完成。
    Ready,
    /// runtime 准备失败。
    Failed,
}

/// runtime 包准备状态载荷，供前端展示阻断弹框和进度条。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeBundleProgress {
    /// 当前阶段状态。
    pub status: RuntimeBundleStatus,
    /// 当前状态对应的中文说明。
    pub message: String,
    /// 当前阶段已完成进度，仅用于当前步骤自己的进度条。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_current: Option<u64>,
    /// 当前阶段总进度，仅用于当前步骤自己的进度条。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_total: Option<u64>,
    /// 已下载字节数，仅下载阶段可能存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_bytes: Option<u64>,
    /// 需要下载的总字节数，仅下载阶段可能存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
}

/// 返回 Lex Vault 用户级根目录。
pub(crate) fn lex_vault_home_dir() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "无法定位用户目录",
            "dirs::home_dir 返回空",
            true,
        )
    })?;
    Ok(home.join(LEX_VAULT_HOME_DIRECTORY))
}

/// 确保 `~/.lex-vault/codex-primary-runtime` 已从当前代码指定的云端 zip 解压完成，并返回根目录。
pub(crate) fn ensure_primary_runtime_bundle() -> Result<PathBuf, AppError> {
    ensure_primary_runtime_bundle_with_reporter(&mut |_| {})
}

/// 确保 `~/.lex-vault/codex-primary-runtime` 已从当前代码指定的云端 zip 解压完成，并允许调用方订阅阶段进度。
pub(crate) fn ensure_primary_runtime_bundle_with_reporter(
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<PathBuf, AppError> {
    let lex_vault_home = lex_vault_home_dir()?;
    let runtime_root = lex_vault_home.join(PRIMARY_RUNTIME_DIRECTORY);
    let metadata_path = lex_vault_home.join(PRIMARY_RUNTIME_SOURCE_METADATA_FILE);
    let source = resolve_runtime_archive_source()?;
    let fingerprint = runtime_archive_source_fingerprint(&source)?;

    if is_valid_runtime_root(&runtime_root)
        && read_installed_runtime_fingerprint(&metadata_path)?
            .as_ref()
            .map(|installed| installed == &fingerprint)
            .unwrap_or(false)
    {
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Ready,
            message: "运行时组件已就绪".to_string(),
            step_current: Some(1),
            step_total: Some(1),
            downloaded_bytes: None,
            total_bytes: None,
        });
        return Ok(std::fs::canonicalize(&runtime_root).unwrap_or(runtime_root));
    }

    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Required,
        message: "首次使用需要下载助手运行时组件，完成后即可继续使用。".to_string(),
        step_current: Some(1),
        step_total: Some(1),
        downloaded_bytes: None,
        total_bytes: None,
    });

    let archive_path = download_runtime_archive(
        &source.url,
        &lex_vault_home.join(LEX_VAULT_DOWNLOADS_DIRECTORY),
        reporter,
    )?;
    let installed_root =
        install_runtime_bundle_from_archive(&archive_path, &lex_vault_home, reporter)?;
    write_installed_runtime_fingerprint(&metadata_path, &fingerprint)?;
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Ready,
        message: "运行时组件准备完成".to_string(),
        step_current: Some(1),
        step_total: Some(1),
        downloaded_bytes: None,
        total_bytes: None,
    });
    Ok(installed_root)
}

/// 根据当前已安装 runtime 包内容，定位包含 marketplace 列表的根目录。
pub(crate) fn locate_runtime_plugin_marketplaces_directory() -> Result<Option<PathBuf>, AppError> {
    let runtime_root = ensure_primary_runtime_bundle()?;
    let lex_vault_home = lex_vault_home_dir()?;
    let candidates = [
        runtime_root.join("plugins"),
        runtime_root.join("marketplaces"),
        lex_vault_home.join("plugins"),
        lex_vault_home.join("marketplaces"),
    ];
    Ok(candidates
        .into_iter()
        .find(|path| contains_marketplace_directories(path))
        .map(|path| std::fs::canonicalize(&path).unwrap_or(path)))
}

/// 将指定 zip 解压并安装到 `~/.lex-vault/codex-primary-runtime`，供测试和运行时共用。
pub(crate) fn install_runtime_bundle_from_archive(
    archive_path: &Path,
    lex_vault_home: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<PathBuf, AppError> {
    if !archive_path.is_file() {
        return Err(AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "运行时压缩包不存在",
            archive_path.display().to_string(),
            true,
        ));
    }

    fs::create_dir_all(lex_vault_home).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建 Lex Vault 用户目录失败",
            err.to_string(),
            true,
        )
    })?;

    let temp_root = lex_vault_home
        .join(LEX_VAULT_TEMP_DIRECTORY)
        .join(format!("{PRIMARY_RUNTIME_DIRECTORY}-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建运行时解压临时目录失败",
            err.to_string(),
            true,
        )
    })?;

    let install_result = (|| -> Result<PathBuf, AppError> {
        extract_runtime_archive(archive_path, &temp_root, reporter)?;
        let extracted_root = resolve_extracted_runtime_root(&temp_root)?;
        let final_root = lex_vault_home.join(PRIMARY_RUNTIME_DIRECTORY);
        if final_root.exists() {
            fs::remove_dir_all(&final_root).map_err(|err| {
                AppError::new(
                    "CODEX_RUNTIME_START_FAILED",
                    "清理旧版运行时目录失败",
                    format!("{}: {err}", final_root.display()),
                    true,
                )
            })?;
        }
        fs::rename(&extracted_root, &final_root).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "替换运行时目录失败",
                format!(
                    "{} -> {}: {err}",
                    extracted_root.display(),
                    final_root.display()
                ),
                true,
            )
        })?;
        Ok(std::fs::canonicalize(&final_root).unwrap_or(final_root))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    install_result
}

/// 判断目录是否满足运行时最小结构约束。
pub(crate) fn is_valid_runtime_root(path: &Path) -> bool {
    path.is_dir() && (path.join("runtime.json").is_file() || path.join("dependencies").is_dir())
}

/// 解析当前应使用的运行时压缩包来源。
fn resolve_runtime_archive_source() -> Result<RuntimeArchiveSource, AppError> {
    let url = std::env::var(RUNTIME_ARCHIVE_URL_ENV)
        .unwrap_or_else(|_| PRIMARY_RUNTIME_ARCHIVE_URL.to_string());
    let parsed = Url::parse(url.trim()).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "运行时压缩包地址非法",
            err.to_string(),
            true,
        )
    })?;
    match parsed.scheme() {
        "http" | "https" => Ok(RuntimeArchiveSource { url: parsed }),
        _ => Err(AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "运行时压缩包地址非法",
            parsed.to_string(),
            true,
        )),
    }
}

/// 基于当前来源构造稳定指纹，便于判断是否需要重装。
fn runtime_archive_source_fingerprint(
    source: &RuntimeArchiveSource,
) -> Result<RuntimeBundleSourceFingerprint, AppError> {
    Ok(RuntimeBundleSourceFingerprint {
        source_type: "remote-url".to_string(),
        identity: source.url.to_string(),
    })
}

/// 下载远端 runtime zip 到本机缓存目录。
fn download_runtime_archive(
    url: &Url,
    downloads_dir: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<PathBuf, AppError> {
    fs::create_dir_all(downloads_dir).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建运行时下载目录失败",
            err.to_string(),
            true,
        )
    })?;
    log_with_details(
        "INFO",
        "runtime_bundle_download_prepare",
        "开始准备下载 runtime 压缩包",
        serde_json::json!({
            "url": url.as_str(),
            "downloadsDir": downloads_dir,
        }),
    );
    let target_path = downloads_dir.join(PRIMARY_RUNTIME_ARCHIVE_FILE_NAME);
    let temporary_path = downloads_dir.join(format!(
        "{PRIMARY_RUNTIME_ARCHIVE_FILE_NAME}.{}.tmp",
        Uuid::new_v4()
    ));
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "创建运行时下载客户端失败",
                err.to_string(),
                true,
            )
        })?;
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Downloading,
        message: "正在连接运行时下载源，请稍候。".to_string(),
        step_current: None,
        step_total: None,
        downloaded_bytes: Some(0),
        total_bytes: None,
    });
    let mut response = client.get(url.clone()).send().map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "下载运行时压缩包失败",
            err.to_string(),
            true,
        )
    })?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "下载运行时压缩包失败",
            format!("{} {}", response.status(), url),
            true,
        ));
    }

    let total_bytes = response.content_length();
    log_with_details(
        "INFO",
        "runtime_bundle_download_started",
        "runtime 压缩包下载已开始",
        serde_json::json!({
            "url": url.as_str(),
            "contentLength": total_bytes,
            "targetPath": target_path,
        }),
    );
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Downloading,
        message: "正在下载助手运行时组件，请勿关闭应用。".to_string(),
        step_current: Some(0),
        step_total: total_bytes,
        downloaded_bytes: Some(0),
        total_bytes,
    });

    let file = File::create(&temporary_path).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建运行时压缩包缓存文件失败",
            err.to_string(),
            true,
        )
    })?;
    let mut writer = BufWriter::new(file);
    let mut downloaded_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = response.read(&mut buffer).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "读取运行时压缩包流失败",
                err.to_string(),
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "写入运行时压缩包缓存失败",
                err.to_string(),
                true,
            )
        })?;
        downloaded_bytes += read as u64;
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Downloading,
            message: "正在下载助手运行时组件，请勿关闭应用。".to_string(),
            step_current: Some(downloaded_bytes),
            step_total: total_bytes,
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes,
        });
    }
    writer.flush().map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "刷新运行时压缩包缓存失败",
            err.to_string(),
            true,
        )
    })?;
    log_with_details(
        "INFO",
        "runtime_bundle_download_completed",
        "runtime 压缩包下载完成",
        serde_json::json!({
            "targetPath": target_path,
            "downloadedBytes": downloaded_bytes,
        }),
    );
    fs::rename(&temporary_path, &target_path).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "替换运行时压缩包缓存失败",
            format!(
                "{} -> {}: {err}",
                temporary_path.display(),
                target_path.display()
            ),
            true,
        )
    })?;
    Ok(target_path)
}

/// 读取当前已安装 runtime 的来源指纹。
fn read_installed_runtime_fingerprint(
    metadata_path: &Path,
) -> Result<Option<RuntimeBundleSourceFingerprint>, AppError> {
    if !metadata_path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(metadata_path).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "读取运行时来源元数据失败",
            err.to_string(),
            true,
        )
    })?;
    let fingerprint =
        serde_json::from_str::<RuntimeBundleSourceFingerprint>(&raw).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "解析运行时来源元数据失败",
                err.to_string(),
                true,
            )
        })?;
    Ok(Some(fingerprint))
}

/// 写入当前已安装 runtime 的来源指纹。
fn write_installed_runtime_fingerprint(
    metadata_path: &Path,
    fingerprint: &RuntimeBundleSourceFingerprint,
) -> Result<(), AppError> {
    let parent = metadata_path.parent().ok_or_else(|| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "写入运行时来源元数据失败",
            metadata_path.display().to_string(),
            true,
        )
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "创建运行时来源元数据目录失败",
            err.to_string(),
            true,
        )
    })?;
    let raw = serde_json::to_string_pretty(fingerprint).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "序列化运行时来源元数据失败",
            err.to_string(),
            true,
        )
    })?;
    fs::write(metadata_path, raw).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "写入运行时来源元数据失败",
            err.to_string(),
            true,
        )
    })
}

/// 解压 runtime zip，并阻止越界路径写入。
fn extract_runtime_archive(
    archive_path: &Path,
    target_root: &Path,
    reporter: &mut dyn FnMut(RuntimeBundleProgress),
) -> Result<(), AppError> {
    let file = File::open(archive_path).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "打开运行时压缩包失败",
            format!("{}: {err}", archive_path.display()),
            true,
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|err| {
        AppError::new(
            "CODEX_RUNTIME_START_FAILED",
            "解析运行时压缩包失败",
            err.to_string(),
            true,
        )
    })?;
    let total_entries = archive.len() as u64;
    log_with_details(
        "INFO",
        "runtime_bundle_extract_started",
        "开始解压 runtime 压缩包",
        serde_json::json!({
            "archivePath": archive_path,
            "targetRoot": target_root,
            "entryCount": total_entries,
        }),
    );
    reporter(RuntimeBundleProgress {
        status: RuntimeBundleStatus::Extracting,
        message: "正在解压并安装运行时组件，请稍候。".to_string(),
        step_current: Some(0),
        step_total: Some(total_entries),
        downloaded_bytes: None,
        total_bytes: None,
    });

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "读取运行时压缩包条目失败",
                err.to_string(),
                true,
            )
        })?;
        let relative_path = sanitize_archive_entry_path(entry.name())?;
        let output_path = target_root.join(&relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|err| {
                AppError::new(
                    "CODEX_RUNTIME_START_FAILED",
                    "创建运行时目录失败",
                    format!("{}: {err}", output_path.display()),
                    true,
                )
            })?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppError::new(
                    "CODEX_RUNTIME_START_FAILED",
                    "创建运行时父目录失败",
                    format!("{}: {err}", parent.display()),
                    true,
                )
            })?;
        }
        let mut output = File::create(&output_path).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "创建运行时文件失败",
                format!("{}: {err}", output_path.display()),
                true,
            )
        })?;
        io::copy(&mut entry, &mut output).map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "写入运行时文件失败",
                format!("{}: {err}", output_path.display()),
                true,
            )
        })?;
        reporter(RuntimeBundleProgress {
            status: RuntimeBundleStatus::Extracting,
            message: "正在解压并安装运行时组件，请稍候。".to_string(),
            step_current: Some((index + 1) as u64),
            step_total: Some(total_entries),
            downloaded_bytes: None,
            total_bytes: None,
        });
    }
    log_with_details(
        "INFO",
        "runtime_bundle_extract_completed",
        "runtime 压缩包解压完成",
        serde_json::json!({
            "archivePath": archive_path,
            "targetRoot": target_root,
            "entryCount": total_entries,
        }),
    );
    Ok(())
}

/// 从解压临时目录中找到真正的 runtime 根目录。
fn resolve_extracted_runtime_root(temp_root: &Path) -> Result<PathBuf, AppError> {
    if is_valid_runtime_root(temp_root) {
        return Ok(temp_root.to_path_buf());
    }

    let direct_runtime_root = temp_root.join(PRIMARY_RUNTIME_DIRECTORY);
    if is_valid_runtime_root(&direct_runtime_root) {
        return Ok(direct_runtime_root);
    }

    let child_directories = fs::read_dir(temp_root)
        .map_err(|err| {
            AppError::new(
                "CODEX_RUNTIME_START_FAILED",
                "读取运行时解压目录失败",
                err.to_string(),
                true,
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    if child_directories.len() == 1 && is_valid_runtime_root(&child_directories[0]) {
        return Ok(child_directories[0].clone());
    }

    Err(AppError::new(
        "CODEX_RUNTIME_START_FAILED",
        "运行时压缩包结构不正确",
        temp_root.display().to_string(),
        true,
    ))
}

/// 清洗 zip 条目路径，阻止 `..`、绝对路径和盘符注入。
fn sanitize_archive_entry_path(raw_path: &str) -> Result<PathBuf, AppError> {
    let mut sanitized = PathBuf::new();
    for component in Path::new(raw_path).components() {
        match component {
            Component::Normal(value) => sanitized.push(value),
            Component::CurDir => continue,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(AppError::new(
                    "CODEX_RUNTIME_START_FAILED",
                    "运行时压缩包包含非法路径",
                    raw_path.to_string(),
                    true,
                ));
            }
        }
    }
    Ok(sanitized)
}

/// 判断一个目录下是否直接包含 marketplace 根目录集合。
fn contains_marketplace_directories(root: &Path) -> bool {
    if !root.is_dir() {
        return false;
    }
    fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .any(|path| {
            path.is_dir()
                && path
                    .join(".agents")
                    .join("plugins")
                    .join("marketplace.json")
                    .is_file()
        })
}

#[cfg(test)]
#[path = "tests/runtime_bundle_tests.rs"]
mod tests;
