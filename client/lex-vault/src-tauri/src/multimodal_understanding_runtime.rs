//! 本地多模态理解 MCP 工具运行时。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use reqwest::blocking::{Client, Request};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::appserver_client::{
    lex_vault_runtime_law_admin_client_id, lex_vault_runtime_model_base_url,
};
use crate::commands::local_data::read_saved_access_token;
use crate::jsonrpc::AppError;

/// 小米多模态 Base64 入参限制约 50 MB，这里按编码前文件大小预留安全余量。
pub(crate) const MAX_MULTIMODAL_UNDERSTANDING_FILE_BYTES: u64 = 37 * 1024 * 1024;
/// 多模态理解接口相对模型网关 `/v1` 的路径。
const MULTIMODAL_UNDERSTANDING_ENDPOINT_PATH: &str = "multimodal/understandings";
/// 多模态理解调用超时，音视频理解可能比图片更慢。
const MULTIMODAL_UNDERSTANDING_TIMEOUT: Duration = Duration::from_secs(180);

/// 多模态媒体类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MultimodalMediaKind {
    /// 图片。
    Image,
    /// 音频。
    Audio,
    /// 视频。
    Video,
}

/// 本地多模态理解请求。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MultimodalUnderstandingRequest {
    /// 本机媒体文件绝对路径。
    pub path: PathBuf,
    /// 解析重点提示词，必填。
    pub prompt: String,
    /// 最大输出 token；为空时由服务端 YAML 默认值控制。
    pub max_completion_tokens: Option<u32>,
    /// 视频抽帧帧率，仅视频有效，默认由服务端控制。
    pub fps: Option<f32>,
    /// 视频解析分辨率档位，仅视频有效，支持 `default` 和 `max`。
    pub media_resolution: Option<String>,
}

/// 发送给服务端的多模态理解请求体。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MultimodalUnderstandingServerRequest {
    /// 媒体内容。
    pub media: MultimodalUnderstandingMediaPayload,
    /// 解析重点提示词。
    pub prompt: String,
    /// 最大输出 token。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_completion_tokens: Option<u32>,
    /// 视频抽帧帧率。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f32>,
    /// 视频解析分辨率档位。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_resolution: Option<String>,
}

/// 多模态媒体字节负载。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MultimodalUnderstandingMediaPayload {
    /// 媒体类型。
    pub kind: MultimodalMediaKind,
    /// 纯 Base64 媒体内容，不包含 data URL 前缀。
    pub data_base64: String,
    /// 媒体 MIME 类型。
    pub mime_type: String,
    /// 原始文件名。
    pub file_name: String,
}

/// 多模态理解响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MultimodalUnderstandingResult {
    /// 模型返回的理解文本。
    pub text: String,
    /// 实际使用的上游模型。
    pub model: String,
    /// 媒体类型。
    pub media_kind: Option<String>,
    /// 上游结束原因。
    pub finish_reason: Option<String>,
    /// 上游 usage，服务端负责从原始响应解析并记账。
    pub usage: Option<MultimodalUnderstandingUsage>,
}

/// 多模态理解 usage。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MultimodalUnderstandingUsage {
    /// 输入 token。
    pub input_tokens: Option<u64>,
    /// 输出 token。
    pub output_tokens: Option<u64>,
    /// 总 token。
    pub total_tokens: Option<u64>,
}

/// 调用服务端多模态理解接口。
pub(crate) fn run_multimodal_understanding(
    request: MultimodalUnderstandingRequest,
) -> Result<MultimodalUnderstandingResult, AppError> {
    let server_request = prepare_multimodal_understanding_server_request(&request)?;
    let token = read_saved_access_token().map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_AUTH_READ_FAILED",
            "读取登录信息失败",
            err,
            true,
        )
    })?;
    if token.trim().is_empty() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_AUTH_MISSING",
            "登录信息不存在",
            "多模态理解需要先完成 law-admin 登录",
            true,
        ));
    }

    let body = serde_json::to_string(&server_request).map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_REQUEST_BUILD_FAILED",
            "构造多模态理解请求失败",
            err.to_string(),
            true,
        )
    })?;
    let endpoint = multimodal_understanding_endpoint_url(lex_vault_runtime_model_base_url())?;
    let client = Client::builder()
        .timeout(MULTIMODAL_UNDERSTANDING_TIMEOUT)
        .build()
        .map_err(|err| {
            AppError::new(
                "MULTIMODAL_UNDERSTANDING_CLIENT_BUILD_FAILED",
                "创建多模态理解 HTTP 客户端失败",
                err.to_string(),
                true,
            )
        })?;

    let upstream_request = build_multimodal_understanding_http_request(
        &client,
        endpoint,
        &token,
        lex_vault_runtime_law_admin_client_id(),
        body,
    )?;
    let response = client.execute(upstream_request).map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_REQUEST_FAILED",
            "调用多模态理解服务失败",
            err.to_string(),
            true,
        )
    })?;

    let status = response.status();
    let response_text = response.text().map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_RESPONSE_READ_FAILED",
            "读取多模态理解响应失败",
            err.to_string(),
            true,
        )
    })?;
    if !status.is_success() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_SERVICE_REJECTED",
            "多模态理解服务返回错误",
            format!("HTTP {}: {}", status.as_u16(), response_text),
            true,
        ));
    }

    serde_json::from_str::<MultimodalUnderstandingResult>(&response_text).map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_RESPONSE_PARSE_FAILED",
            "解析多模态理解响应失败",
            err.to_string(),
            true,
        )
        .with_details(json!({ "response": response_text }))
    })
}

/// 构造多模态理解 HTTP 请求，便于独立验证认证头和业务头。
pub(crate) fn build_multimodal_understanding_http_request(
    client: &Client,
    endpoint: String,
    token: &str,
    client_id: &str,
    body: String,
) -> Result<Request, AppError> {
    client
        .post(endpoint)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, bearer_authorization_header(token))
        .header("clientid", client_id)
        .body(body)
        .build()
        .map_err(|err| {
            AppError::new(
                "MULTIMODAL_UNDERSTANDING_REQUEST_BUILD_FAILED",
                "构造多模态理解 HTTP 请求失败",
                err.to_string(),
                true,
            )
        })
}

/// 读取本机媒体并构造服务端多模态理解请求体。
pub(crate) fn prepare_multimodal_understanding_server_request(
    request: &MultimodalUnderstandingRequest,
) -> Result<MultimodalUnderstandingServerRequest, AppError> {
    let media = read_media_payload(&request.path)?;
    let (fps, media_resolution) =
        normalize_video_options(media.kind, request.fps, request.media_resolution.as_deref())?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_PROMPT_REQUIRED",
            "多模态解析重点不能为空",
            "请通过 prompt 说明需要提取或分析的重点",
            true,
        ));
    }

    Ok(MultimodalUnderstandingServerRequest {
        media,
        prompt: prompt.to_string(),
        max_completion_tokens: request.max_completion_tokens,
        fps,
        media_resolution,
    })
}

/// 由模型网关基础地址组装多模态理解接口地址。
pub(crate) fn multimodal_understanding_endpoint_url(
    model_base_url: &str,
) -> Result<String, AppError> {
    let base_url = model_base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_ENDPOINT_MISSING",
            "多模态理解服务地址缺失",
            "LEX_VAULT_MODEL_BASE_URL 为空",
            true,
        ));
    }
    Ok(format!(
        "{base_url}/{MULTIMODAL_UNDERSTANDING_ENDPOINT_PATH}"
    ))
}

/// 根据媒体扩展名识别 MIME 类型和媒体类型。
pub(crate) fn media_descriptor(path: &Path) -> Option<(MultimodalMediaKind, &'static str)> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some((MultimodalMediaKind::Image, "image/png")),
        Some("jpg" | "jpeg") => Some((MultimodalMediaKind::Image, "image/jpeg")),
        Some("webp") => Some((MultimodalMediaKind::Image, "image/webp")),
        Some("gif") => Some((MultimodalMediaKind::Image, "image/gif")),
        Some("bmp") => Some((MultimodalMediaKind::Image, "image/bmp")),
        Some("mp3") => Some((MultimodalMediaKind::Audio, "audio/mpeg")),
        Some("wav") => Some((MultimodalMediaKind::Audio, "audio/wav")),
        Some("flac") => Some((MultimodalMediaKind::Audio, "audio/flac")),
        Some("m4a") => Some((MultimodalMediaKind::Audio, "audio/mp4")),
        Some("ogg") => Some((MultimodalMediaKind::Audio, "audio/ogg")),
        Some("mp4") => Some((MultimodalMediaKind::Video, "video/mp4")),
        Some("mov") => Some((MultimodalMediaKind::Video, "video/quicktime")),
        Some("avi") => Some((MultimodalMediaKind::Video, "video/x-msvideo")),
        Some("wmv") => Some((MultimodalMediaKind::Video, "video/x-ms-wmv")),
        _ => None,
    }
}

fn read_media_payload(path: &Path) -> Result<MultimodalUnderstandingMediaPayload, AppError> {
    let path = validate_media_path(path)?;
    let metadata = fs::metadata(&path).map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_FILE_STAT_FAILED",
            "读取媒体文件信息失败",
            err.to_string(),
            true,
        )
    })?;
    if metadata.len() > MAX_MULTIMODAL_UNDERSTANDING_FILE_BYTES {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_FILE_TOO_LARGE",
            "媒体文件过大",
            format!(
                "当前文件大小 {} 字节，超过本地 Base64 理解上限 {} 字节",
                metadata.len(),
                MAX_MULTIMODAL_UNDERSTANDING_FILE_BYTES
            ),
            true,
        ));
    }
    let (kind, mime_type) = media_descriptor(&path).ok_or_else(|| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_UNSUPPORTED_TYPE",
            "不支持的媒体格式",
            format!(
                "当前仅支持图片 png、jpg、jpeg、webp、gif、bmp，音频 mp3、wav、flac、m4a、ogg，视频 mp4、mov、avi、wmv：{}",
                path.display()
            ),
            true,
        )
    })?;
    let bytes = fs::read(&path).map_err(|err| {
        AppError::new(
            "MULTIMODAL_UNDERSTANDING_FILE_READ_FAILED",
            "读取媒体文件失败",
            err.to_string(),
            true,
        )
    })?;
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "media".to_string());

    Ok(MultimodalUnderstandingMediaPayload {
        kind,
        data_base64: BASE64_STANDARD.encode(bytes),
        mime_type: mime_type.to_string(),
        file_name,
    })
}

fn normalize_video_options(
    kind: MultimodalMediaKind,
    fps: Option<f32>,
    media_resolution: Option<&str>,
) -> Result<(Option<f32>, Option<String>), AppError> {
    if kind != MultimodalMediaKind::Video {
        if fps.is_some() || media_resolution.is_some() {
            return Err(AppError::new(
                "MULTIMODAL_UNDERSTANDING_VIDEO_OPTION_NOT_ALLOWED",
                "视频参数只能用于视频文件",
                "fps 和 mediaResolution 仅在媒体类型为视频时生效",
                true,
            ));
        }
        return Ok((None, None));
    }

    let normalized_fps = match fps {
        Some(value) if (0.1..=10.0).contains(&value) => Some(value),
        Some(value) => {
            return Err(AppError::new(
                "MULTIMODAL_UNDERSTANDING_INVALID_FPS",
                "视频 fps 参数无效",
                format!("fps 必须在 0.1 到 10 之间，当前为 {value}"),
                true,
            ));
        }
        None => None,
    };
    let normalized_resolution = media_resolution
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .map(|value| match value.as_str() {
            "default" | "max" => Ok(value),
            _ => Err(AppError::new(
                "MULTIMODAL_UNDERSTANDING_INVALID_MEDIA_RESOLUTION",
                "视频解析分辨率参数无效",
                "mediaResolution 仅支持 default 或 max",
                true,
            )),
        })
        .transpose()?;
    Ok((normalized_fps, normalized_resolution))
}

fn validate_media_path(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_PATH_NOT_ABSOLUTE",
            "媒体路径必须是绝对路径",
            path.display().to_string(),
            true,
        ));
    }
    if !path.is_file() {
        return Err(AppError::new(
            "MULTIMODAL_UNDERSTANDING_FILE_NOT_FOUND",
            "媒体文件不存在",
            path.display().to_string(),
            true,
        ));
    }
    Ok(path.to_path_buf())
}

fn bearer_authorization_header(token: &str) -> String {
    let trimmed = token.trim();
    let bearer_prefix_len = "Bearer ".len();
    if trimmed
        .get(..bearer_prefix_len)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("Bearer "))
    {
        format!(
            "Bearer {}",
            trimmed.get(bearer_prefix_len..).unwrap_or_default().trim()
        )
    } else {
        format!("Bearer {trimmed}")
    }
}

#[cfg(test)]
#[path = "tests/multimodal_understanding_runtime_tests.rs"]
mod tests;
