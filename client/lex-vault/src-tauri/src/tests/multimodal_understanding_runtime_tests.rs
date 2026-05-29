//! 多模态理解运行时测试。
//!
//! @author kongweiguang

use std::fs;
use std::path::PathBuf;

use reqwest::blocking::Client;

use super::{
    build_multimodal_understanding_http_request, media_descriptor,
    multimodal_understanding_endpoint_url, prepare_multimodal_understanding_server_request,
    MultimodalMediaKind, MultimodalUnderstandingRequest, MAX_MULTIMODAL_UNDERSTANDING_FILE_BYTES,
};

/// 验证模型网关 `/v1` 基础地址会追加多模态理解路径。
#[test]
fn multimodal_understanding_endpoint_url_appends_multimodal_path() {
    let endpoint = multimodal_understanding_endpoint_url("https://law.ktestai.cn/prod-api/v1/")
        .expect("endpoint should build");

    assert_eq!(
        endpoint,
        "https://law.ktestai.cn/prod-api/v1/multimodal/understandings"
    );
}

/// 验证常见图片、音频和视频扩展名会映射到稳定媒体类型和 MIME。
#[test]
fn media_descriptor_detects_supported_media() {
    assert_eq!(
        media_descriptor(&PathBuf::from("a.png")),
        Some((MultimodalMediaKind::Image, "image/png"))
    );
    assert_eq!(
        media_descriptor(&PathBuf::from("a.mp3")),
        Some((MultimodalMediaKind::Audio, "audio/mpeg"))
    );
    assert_eq!(
        media_descriptor(&PathBuf::from("a.mp4")),
        Some((MultimodalMediaKind::Video, "video/mp4"))
    );
    assert_eq!(media_descriptor(&PathBuf::from("a.txt")), None);
}

/// 验证图片文件会被转成服务端所需的 Base64 请求体，并保留解析重点 prompt。
#[test]
fn prepare_multimodal_understanding_server_request_accepts_image() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let image_path = temp_dir.path().join("demo.png");
    fs::write(&image_path, [1_u8, 2, 3]).expect("image should write");

    let request =
        prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
            path: image_path,
            prompt: "提取图片里的全部文字".to_string(),
            max_completion_tokens: None,
            fps: None,
            media_resolution: None,
        })
        .expect("server request should prepare");

    assert_eq!(request.media.kind, MultimodalMediaKind::Image);
    assert_eq!(request.media.data_base64, "AQID");
    assert_eq!(request.media.mime_type, "image/png");
    assert_eq!(request.media.file_name, "demo.png");
    assert_eq!(request.prompt, "提取图片里的全部文字");
}

/// 验证音频文件会进入通用多模态请求体。
#[test]
fn prepare_multimodal_understanding_server_request_accepts_audio() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let audio_path = temp_dir.path().join("demo.mp3");
    fs::write(&audio_path, [1_u8, 2, 3, 4]).expect("audio should write");

    let request =
        prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
            path: audio_path,
            prompt: "总结音频中的发言要点".to_string(),
            max_completion_tokens: None,
            fps: None,
            media_resolution: None,
        })
        .expect("server request should prepare");

    assert_eq!(request.media.kind, MultimodalMediaKind::Audio);
    assert_eq!(request.media.mime_type, "audio/mpeg");
    assert_eq!(request.media.data_base64, "AQIDBA==");
    assert_eq!(request.prompt, "总结音频中的发言要点");
}

/// 验证视频文件会保留 fps、mediaResolution 和最大输出 token。
#[test]
fn prepare_multimodal_understanding_server_request_accepts_video_options() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let video_path = temp_dir.path().join("demo.mp4");
    fs::write(&video_path, [9_u8]).expect("video should write");

    let request =
        prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
            path: video_path,
            prompt: "总结视频时间线".to_string(),
            max_completion_tokens: Some(512),
            fps: Some(1.5),
            media_resolution: Some("MAX".to_string()),
        })
        .expect("server request should prepare");

    assert_eq!(request.media.kind, MultimodalMediaKind::Video);
    assert_eq!(request.media.mime_type, "video/mp4");
    assert_eq!(request.prompt, "总结视频时间线");
    assert_eq!(request.max_completion_tokens, Some(512));
    assert_eq!(request.fps, Some(1.5));
    assert_eq!(request.media_resolution.as_deref(), Some("max"));
}

/// 验证服务端请求会带上多模态接口、登录 token 与 law-admin clientid。
#[test]
fn build_multimodal_understanding_http_request_sets_headers() {
    let client = Client::new();
    let request = build_multimodal_understanding_http_request(
        &client,
        "https://law.ktestai.cn/prod-api/v1/multimodal/understandings".to_string(),
        " Bearer abc-token ",
        "law-admin-client",
        "{}".to_string(),
    )
    .expect("http request should build");

    assert_eq!(
        request.url().as_str(),
        "https://law.ktestai.cn/prod-api/v1/multimodal/understandings"
    );
    assert_eq!(
        request.headers().get("authorization").unwrap(),
        "Bearer abc-token"
    );
    assert_eq!(
        request.headers().get("clientid").unwrap(),
        "law-admin-client"
    );
    assert_eq!(
        request.headers().get("content-type").unwrap(),
        "application/json"
    );
    assert_eq!(request.headers().get("accept").unwrap(), "application/json");
}

/// 验证相对路径会被拒绝，避免 MCP 工具在不明确目录上下文时读取错误文件。
#[test]
fn prepare_multimodal_understanding_server_request_rejects_relative_path() {
    let error = prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
        path: PathBuf::from("demo.png"),
        prompt: "提取文字".to_string(),
        max_completion_tokens: None,
        fps: None,
        media_resolution: None,
    })
    .expect_err("relative path should fail");

    assert_eq!(error.code, "MULTIMODAL_UNDERSTANDING_PATH_NOT_ABSOLUTE");
}

/// 验证 prompt 为空会被拒绝。
#[test]
fn prepare_multimodal_understanding_server_request_rejects_blank_prompt() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let image_path = temp_dir.path().join("demo.png");
    fs::write(&image_path, [1_u8]).expect("image should write");

    let error = prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
        path: image_path,
        prompt: "  ".to_string(),
        max_completion_tokens: None,
        fps: None,
        media_resolution: None,
    })
    .expect_err("blank prompt should fail");

    assert_eq!(error.code, "MULTIMODAL_UNDERSTANDING_PROMPT_REQUIRED");
}

/// 验证非媒体扩展名会被拒绝。
#[test]
fn prepare_multimodal_understanding_server_request_rejects_unsupported_type() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let text_path = temp_dir.path().join("demo.txt");
    fs::write(&text_path, "not media").expect("file should write");

    let error = prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
        path: text_path,
        prompt: "提取内容".to_string(),
        max_completion_tokens: None,
        fps: None,
        media_resolution: None,
    })
    .expect_err("unsupported type should fail");

    assert_eq!(error.code, "MULTIMODAL_UNDERSTANDING_UNSUPPORTED_TYPE");
}

/// 验证视频参数不能用于非视频文件。
#[test]
fn prepare_multimodal_understanding_server_request_rejects_video_options_for_image() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let image_path = temp_dir.path().join("demo.png");
    fs::write(&image_path, [1_u8]).expect("image should write");

    let error = prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
        path: image_path,
        prompt: "提取文字".to_string(),
        max_completion_tokens: None,
        fps: Some(2.0),
        media_resolution: None,
    })
    .expect_err("video option should fail for image");

    assert_eq!(
        error.code,
        "MULTIMODAL_UNDERSTANDING_VIDEO_OPTION_NOT_ALLOWED"
    );
}

/// 验证超出 Base64 安全上限的媒体会在本地提前失败。
#[test]
fn prepare_multimodal_understanding_server_request_rejects_large_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir should create");
    let video_path = temp_dir.path().join("large.mp4");
    let file = fs::File::create(&video_path).expect("file should create");
    file.set_len(MAX_MULTIMODAL_UNDERSTANDING_FILE_BYTES + 1)
        .expect("file size should set");

    let error = prepare_multimodal_understanding_server_request(&MultimodalUnderstandingRequest {
        path: video_path,
        prompt: "总结视频".to_string(),
        max_completion_tokens: None,
        fps: None,
        media_resolution: None,
    })
    .expect_err("large file should fail");

    assert_eq!(error.code, "MULTIMODAL_UNDERSTANDING_FILE_TOO_LARGE");
}
