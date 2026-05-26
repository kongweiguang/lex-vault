//! 微信扫码连接命令回归测试。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};
use std::process::Stdio;

use super::{
    build_wechat_turn_prompt, is_login_in_progress, parse_wechat_helper_status,
    parse_wechat_reply_content, parse_wechat_thread_request,
    should_auto_resume_wechat_from_state_dir, should_keep_running_wechat_child,
    terminate_wechat_child, update_wechat_status, wechat_helper_args, wechat_login_environment,
    wechat_reply_file_developer_instructions, wechat_state_directory_from_home,
    wechat_user_message_for_error, WechatLoginState, WechatLoginStatus, WechatProactiveMessageLine,
    WechatThreadBridgeResponseLine,
};
use crate::jsonrpc::AppError;
use tokio::process::Command;

/// 验证扫码状态目录固定落在 Lex Vault 用户目录下，避免散落到默认 OpenClaw 目录。
#[test]
fn wechat_state_directory_uses_lex_vault_home() {
    let home = Path::new("demo-home");

    let path = wechat_state_directory_from_home(home);

    assert_eq!(
        path,
        PathBuf::from("demo-home").join(".lex-vault").join("wechat")
    );
}

/// 验证只有存在微信 SDK 状态内容时，桌面端启动才会尝试自动恢复监听。
#[test]
fn wechat_auto_resume_requires_existing_state_content() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-wechat-autostart-{}", std::process::id()));
    let state_dir = temp_root.join(".lex-vault").join("wechat");

    std::fs::remove_dir_all(&temp_root).ok();
    assert!(!should_auto_resume_wechat_from_state_dir(&state_dir));

    std::fs::create_dir_all(&state_dir).expect("state dir should be created");
    assert!(!should_auto_resume_wechat_from_state_dir(&state_dir));

    std::fs::write(state_dir.join("session.json"), "{}").expect("state marker should be written");
    assert!(should_auto_resume_wechat_from_state_dir(&state_dir));

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证 helper 环境变量会显式写入 OPENCLAW_STATE_DIR。
#[test]
fn wechat_login_environment_injects_openclaw_state_dir() {
    let state_dir = Path::new("demo-home").join(".lex-vault").join("wechat");

    let environment = wechat_login_environment(&state_dir, &[]).expect("environment should build");

    assert!(environment.iter().any(|(key, value)| {
        key == "OPENCLAW_STATE_DIR" && value == &state_dir.display().to_string()
    }));
    assert!(!environment
        .iter()
        .any(|(key, _)| key == "LEX_VAULT_WECHAT_AUTH_FILE"));
}

/// 验证自定义 helper 参数放在脚本路径之后，避免被 Node.js 当成自身启动选项。
#[test]
fn wechat_helper_args_place_script_before_custom_flags() {
    let helper_path = Path::new("resources/wechat/login-helper.mjs");
    let args = wechat_helper_args(
        &super::WechatLoginStartRequest {
            force_login: Some(true),
            resume_only: Some(true),
        },
        helper_path,
    );

    assert_eq!(args[0], helper_path.as_os_str());
    assert_eq!(args[1], "--force-login");
    assert_eq!(args[2], "--resume-only");
}

/// 验证正在扫码时会被识别为进行中，用于保护单实例登录流程。
#[test]
fn wechat_login_in_progress_statuses_are_protected() {
    for status in ["starting", "waiting", "scanned"] {
        assert!(is_login_in_progress(&WechatLoginStatus {
            status: status.to_string(),
            message: String::new(),
            qr_ascii: None,
            account_id: None,
            updated_at: String::new(),
        }));
    }

    for status in ["idle", "expired", "connected", "failed", "canceled"] {
        assert!(!is_login_in_progress(&WechatLoginStatus {
            status: status.to_string(),
            message: String::new(),
            qr_ascii: None,
            account_id: None,
            updated_at: String::new(),
        }));
    }
}

/// 验证只有扫码中或已连接状态会复用已有 helper，其他状态会清理旧进程后再启动。
#[test]
fn wechat_single_receiver_reuses_only_active_child() {
    for status in ["starting", "waiting", "scanned", "connected"] {
        assert!(should_keep_running_wechat_child(&WechatLoginStatus {
            status: status.to_string(),
            message: String::new(),
            qr_ascii: None,
            account_id: None,
            updated_at: String::new(),
        }));
    }

    for status in ["idle", "expired", "failed", "canceled"] {
        assert!(!should_keep_running_wechat_child(&WechatLoginStatus {
            status: status.to_string(),
            message: String::new(),
            qr_ascii: None,
            account_id: None,
            updated_at: String::new(),
        }));
    }
}

/// 验证 helper JSON 行能稳定转换为前端状态。
#[test]
fn wechat_helper_status_line_is_parsed() {
    let status = parse_wechat_helper_status(
        r#"{"type":"wechat-login","status":"connected","message":"微信已连接","accountId":"wx-1"}"#,
    )
    .expect("status should parse");

    assert_eq!(status.status, "connected");
    assert_eq!(status.message, "微信已连接");
    assert_eq!(status.account_id.as_deref(), Some("wx-1"));
}

/// 验证 helper 投递的微信消息请求可以按稳定协议解析。
#[test]
fn wechat_thread_request_line_is_parsed() {
    let request = parse_wechat_thread_request(
        r#"{"type":"wechat-thread-message","requestId":"req-1","message":{"conversationId":"wx-1","text":"你好","senderName":"张三","media":{"type":"image","fileName":"a.png","mimeType":"image/png","path":"C:\\temp\\a.png","size":128}}}"#,
    )
    .expect("request should parse");

    assert_eq!(request.request_id, "req-1");
    assert_eq!(request.message.conversation_id, "wx-1");
    assert_eq!(request.message.text, "你好");
    assert_eq!(request.message.sender_name, "张三");
    assert_eq!(
        request
            .message
            .media
            .as_ref()
            .map(|media| media.kind.as_str()),
        Some("image")
    );
    assert_eq!(
        request
            .message
            .media
            .as_ref()
            .map(|media| media.path.as_str()),
        Some("C:\\temp\\a.png")
    );
}

/// 验证主动微信消息行保持稳定 JSON 协议。
#[test]
fn wechat_proactive_message_line_is_serialized() {
    let line = WechatProactiveMessageLine {
        event_type: "wechat-proactive-message".to_string(),
        text: "日历提醒：明天开庭".to_string(),
    };

    let json = serde_json::to_string(&line).expect("line should serialize");

    assert_eq!(
        json,
        r#"{"type":"wechat-proactive-message","text":"日历提醒：明天开庭"}"#
    );
}

/// 验证微信来源上下文不会覆盖模型 instructions，只作为本轮用户输入的一部分。
#[test]
fn wechat_turn_prompt_contains_lightweight_source_context() {
    let request = parse_wechat_thread_request(
        r#"{"type":"wechat-thread-message","requestId":"req-1","message":{"conversationId":"room-1","text":"请总结要点","roomTopic":"案件群","senderName":"李四","isRoom":true}}"#,
    )
    .expect("request should parse");

    let prompt = build_wechat_turn_prompt(&request.message, "room-1");

    assert!(prompt.contains("来源：微信普通会话。"));
    assert!(prompt.contains("会话类型：群聊。"));
    assert!(prompt.contains("群聊名称：案件群。"));
    assert!(prompt.contains("发言人：李四。"));
    assert!(prompt.contains("请总结要点"));
    assert!(!prompt.contains("developer_instructions"));
}

/// 验证已有可访问路径的微信附件不会再退化为“只读摘要”提示。
#[test]
fn wechat_turn_prompt_omits_summary_when_media_is_accessible() {
    let request = parse_wechat_thread_request(
        r#"{"type":"wechat-thread-message","requestId":"req-1","message":{"conversationId":"wx-1","text":"看附件","media":{"type":"image","fileName":"a.png","mimeType":"image/png","path":"C:\\temp\\a.png"}}}"#,
    )
    .expect("request should parse");

    let prompt = build_wechat_turn_prompt(&request.message, "wx-1");

    assert!(!prompt.contains("当前入口只提供了附件摘要"));
}

/// 验证微信隐藏 developer instructions 会声明回文件结构化标签规则。
#[test]
fn wechat_reply_file_developer_instructions_declare_structured_tag() {
    let instructions = wechat_reply_file_developer_instructions();

    assert!(instructions.contains("<wechat-send-file"));
    assert!(instructions.contains("本机绝对路径"));
}

/// 验证纯文本回复不会被误解析成微信文件回复。
#[test]
fn wechat_reply_content_keeps_plain_text_when_no_file_tag() {
    let parsed = parse_wechat_reply_content("这是正常文本回复。");

    assert_eq!(parsed.text, "这是正常文本回复。");
    assert_eq!(parsed.media, None);
}

/// 验证单个合法回文件标签会被拆成用户可见文本和本机文件路径。
#[test]
fn wechat_reply_content_extracts_single_file_tag() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-reply-file-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let file_path = temp_root.join("reply.txt");
    std::fs::write(&file_path, "hello").expect("reply file should be written");

    let reply = format!(
        "材料已经整理好了，请查收。\n<wechat-send-file path=\"{}\" fileName=\"案件摘要.txt\" />",
        file_path.display()
    );
    let parsed = parse_wechat_reply_content(&reply);

    assert_eq!(parsed.text, "材料已经整理好了，请查收。");
    let media = parsed.media.expect("media should be parsed");
    assert_eq!(media.kind, "file");
    assert_eq!(media.path, file_path.display().to_string());
    assert_eq!(media.file_name, "案件摘要.txt");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证历史兼容标签 `<attach_file ... />` 也会被识别成微信回复文件。
#[test]
fn wechat_reply_content_accepts_legacy_attach_file_tag() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-legacy-attach-file-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let file_path = temp_root.join("reply.pdf");
    std::fs::write(&file_path, "pdf").expect("reply file should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "发你材料。\n<attach_file path=\"{}\" />",
        file_path.display()
    ));

    assert_eq!(parsed.text, "发你材料。");
    let media = parsed.media.expect("media should be parsed");
    assert_eq!(media.kind, "file");
    assert_eq!(media.path, file_path.display().to_string());
    assert_eq!(media.file_name, "reply.pdf");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证模型实际输出过的 `<send_file ... />` 也会被识别成微信回复文件。
#[test]
fn wechat_reply_content_accepts_send_file_tag() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-wechat-send-file-{}", std::process::id()));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let file_path = temp_root.join("证据材料（脱敏版） (1).pdf");
    std::fs::write(&file_path, "pdf").expect("reply file should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "再发你一次。\n<send_file path=\"{}\" />",
        file_path.display()
    ));

    assert_eq!(parsed.text, "再发你一次。");
    let media = parsed.media.expect("media should be parsed");
    assert_eq!(media.kind, "file");
    assert_eq!(media.path, file_path.display().to_string());
    assert_eq!(media.file_name, "证据材料（脱敏版） (1).pdf");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证模型声明路径里多出空格时，会在同目录内唯一纠偏到真实文件。
#[test]
fn wechat_reply_content_corrects_unique_whitespace_filename_mismatch() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-whitespace-file-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let actual_file_path = temp_root.join("证据材料（脱敏版）(1).pdf");
    let requested_file_path = temp_root.join("证据材料（脱敏版） (1).pdf");
    std::fs::write(&actual_file_path, "pdf").expect("reply file should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "发你材料。\n<send_file path=\"{}\" />",
        requested_file_path.display()
    ));

    assert_eq!(parsed.text, "发你材料。");
    let media = parsed.media.expect("media should be parsed");
    assert_eq!(media.kind, "file");
    assert_eq!(media.path, actual_file_path.display().to_string());
    assert_eq!(media.file_name, "证据材料（脱敏版）(1).pdf");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证目录路径默认会展开为多个直接子文件，并跳过子目录。
#[test]
fn wechat_reply_content_expands_direct_files_when_path_is_directory() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-wechat-folder-{}", std::process::id()));
    let folder = temp_root.join("证据材料");
    let preview_dir = folder.join("_pages_preview");
    std::fs::create_dir_all(&preview_dir).expect("preview dir should exist");
    std::fs::write(folder.join("a.pdf"), "a").expect("a should be written");
    std::fs::write(folder.join("b.docx"), "b").expect("b should be written");
    std::fs::write(preview_dir.join("preview.png"), "preview").expect("preview should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "这些材料直接发你。\n<send_file path=\"{}\" />",
        folder.display()
    ));

    assert_eq!(parsed.text, "这些材料直接发你。");
    assert_eq!(parsed.media, None);
    assert_eq!(parsed.media_list.len(), 2);
    assert_eq!(parsed.media_list[0].file_name, "a.pdf");
    assert_eq!(parsed.media_list[1].file_name, "b.docx");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证用户明确要求打包时，目录会被压成单个 zip。
#[test]
fn wechat_reply_content_archives_directory_when_archive_mode_requested() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-folder-archive-{}",
        std::process::id()
    ));
    let folder = temp_root.join("证据材料");
    let preview_dir = folder.join("_pages_preview");
    std::fs::create_dir_all(&preview_dir).expect("preview dir should exist");
    std::fs::write(folder.join("a.pdf"), "a").expect("a should be written");
    std::fs::write(folder.join("b.docx"), "b").expect("b should be written");
    std::fs::write(preview_dir.join("preview.png"), "preview").expect("preview should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "这些材料打包发你。\n<send_file path=\"{}\" mode=\"archive\" />",
        folder.display()
    ));

    assert_eq!(parsed.text, "这些材料打包发你。");
    let media = parsed.media.expect("media should be parsed");
    assert_eq!(media.kind, "file");
    assert!(media.file_name.ends_with(".zip"));
    assert!(media.path.ends_with(".zip"));

    let archive_file = std::fs::File::open(&media.path).expect("archive should exist");
    let mut archive = zip::ZipArchive::new(archive_file).expect("archive should open");
    let mut names = (0..archive.len())
        .map(|index| {
            archive
                .by_index(index)
                .expect("zip entry should exist")
                .name()
                .to_string()
        })
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(names, vec!["a.pdf".to_string(), "b.docx".to_string()]);

    std::fs::remove_file(&media.path).ok();
    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证非法路径会降级为纯文本回复，不冒险给微信发送错误文件。
#[test]
fn wechat_reply_content_ignores_non_absolute_or_missing_paths() {
    let non_absolute = parse_wechat_reply_content(
        "说明\n<wechat-send-file path=\"reply.txt\" fileName=\"reply.txt\" />",
    );
    assert_eq!(non_absolute.text, "说明");
    assert_eq!(non_absolute.media, None);

    let missing = parse_wechat_reply_content(
        "说明\n<wechat-send-file path=\"C:\\\\definitely-missing\\\\reply.txt\" fileName=\"reply.txt\" />",
    );
    assert_eq!(missing.text, "说明");
    assert_eq!(missing.media, None);
}

/// 验证多个回文件标签会按顺序生成多文件发送列表。
#[test]
fn wechat_reply_content_accepts_multiple_file_tags() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-multiple-files-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let a_path = temp_root.join("a.txt");
    let b_path = temp_root.join("b.txt");
    std::fs::write(&a_path, "a").expect("a should be written");
    std::fs::write(&b_path, "b").expect("b should be written");

    let parsed = parse_wechat_reply_content(&format!(
        "请看附件。\n<wechat-send-file path=\"{}\" />\n<wechat-send-file path=\"{}\" />",
        a_path.display(),
        b_path.display()
    ));

    assert_eq!(parsed.text, "请看附件。");
    assert_eq!(parsed.media, None);
    assert_eq!(parsed.media_list.len(), 2);
    assert_eq!(parsed.media_list[0].file_name, "a.txt");
    assert_eq!(parsed.media_list[1].file_name, "b.txt");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证回复协议在带文件时会稳定序列化可选 media 字段。
#[test]
fn wechat_thread_response_line_serializes_optional_media() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-wechat-response-media-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_root).expect("temp dir should exist");
    let file_path = temp_root.join("reply.pdf");
    std::fs::write(&file_path, "pdf").expect("reply file should be written");

    let line = WechatThreadBridgeResponseLine {
        event_type: "wechat-thread-response".to_string(),
        request_id: "req-1".to_string(),
        ok: true,
        thread_id: Some("thread-1".to_string()),
        turn_id: Some("turn-1".to_string()),
        text: "请查收。".to_string(),
        media: parse_wechat_reply_content(&format!(
            "请查收。\n<wechat-send-file path=\"{}\" fileName=\"reply.pdf\" />",
            file_path.display()
        ))
        .media,
        media_list: Vec::new(),
        error_code: None,
    };

    let json = serde_json::to_value(&line).expect("response should serialize");
    assert_eq!(json["type"], "wechat-thread-response");
    assert_eq!(json["media"]["type"], "file");
    assert_eq!(json["media"]["path"], file_path.display().to_string());
    assert_eq!(json["media"]["fileName"], "reply.pdf");

    std::fs::remove_dir_all(&temp_root).ok();
}

/// 验证模型过载时，微信端会收到更明确的稳定提示，而不是笼统失败文案。
#[test]
fn wechat_user_message_maps_model_overload_error() {
    let error = AppError::new(
        "TURN_RUNTIME_ERROR",
        "Codex turn 执行出错",
        "Selected model is at capacity. Please try a different model.",
        true,
    )
    .with_details(serde_json::json!({
        "error": {
            "message": "Selected model is at capacity. Please try a different model.",
            "codexErrorInfo": "serverOverloaded"
        }
    }));

    let message = wechat_user_message_for_error(&error);

    assert!(message.contains("当前模型通道正忙"));
}

/// 验证插件市场初始化失败时，微信端能直接看到本机运行环境异常提示。
#[test]
fn wechat_user_message_maps_plugin_install_error() {
    let error = AppError::new(
        "PLUGIN_INSTALL_FAILED",
        "清理旧版预装插件市场失败",
        "拒绝访问。 (os error 5)",
        true,
    );

    let message = wechat_user_message_for_error(&error);

    assert!(message.contains("运行环境初始化失败"));
}

/// 验证常见额度或限流错误会直接映射为用户可理解的提示。
#[test]
fn wechat_user_message_maps_rate_limit_error() {
    let error = AppError::new(
        "TURN_RUNTIME_ERROR",
        "Codex turn 执行出错",
        "429 rate limit exceeded for current project",
        true,
    );

    let message = wechat_user_message_for_error(&error);

    assert!(message.contains("额度或调用频率已达上限"));
}

/// 验证常见网络异常会直接映射为用户可理解的提示。
#[test]
fn wechat_user_message_maps_network_error() {
    let error = AppError::new(
        "TURN_RUNTIME_ERROR",
        "Codex turn 执行出错",
        "upstream request timed out while connecting to provider",
        true,
    );

    let message = wechat_user_message_for_error(&error);

    assert!(message.contains("网络异常"));
}

/// 验证取消登录时会终止当前 helper 子进程，避免后台残留扫码流程。
#[tokio::test]
async fn wechat_cancel_terminates_child_process() {
    let mut child = long_running_child();

    terminate_wechat_child(&mut child)
        .await
        .expect("child should be killed");

    let status = child.wait().await.expect("child should exit after kill");
    assert!(!status.success());
}

/// 验证状态推进时不会把已经拿到的二维码清掉。
#[tokio::test]
async fn wechat_status_update_preserves_existing_qr_ascii() {
    let state = WechatLoginState::default();

    update_wechat_status(
        &state,
        WechatLoginStatus {
            status: "waiting".to_string(),
            message: "请扫码".to_string(),
            qr_ascii: Some("QR-CODE".to_string()),
            account_id: None,
            updated_at: String::new(),
        },
    )
    .await;

    let next_status = update_wechat_status(
        &state,
        WechatLoginStatus {
            status: "scanned".to_string(),
            message: "已扫码".to_string(),
            qr_ascii: None,
            account_id: None,
            updated_at: String::new(),
        },
    )
    .await;

    assert_eq!(next_status.qr_ascii.as_deref(), Some("QR-CODE"));
}

/// 验证扫码命令不会为了找 Node runtime 而触发 runtime 下载，只复用已经存在的本地目录。
#[test]
fn wechat_runtime_lookup_requires_existing_runtime_directory() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-wechat-runtime-{}", std::process::id()));
    let runtime_root = temp_root.join("agent-primary-runtime");

    std::fs::remove_dir_all(&temp_root).ok();
    std::fs::create_dir_all(&temp_root).expect("temp root should exist");
    unsafe {
        std::env::set_var("LEX_VAULT_RUNTIME_ROOT", &runtime_root);
    }

    assert!(
        super::runtime_root_from_env_or_common_locations().is_none(),
        "missing runtime dir should not be synthesized during wechat login"
    );

    std::fs::create_dir_all(runtime_root.join("dependencies"))
        .expect("minimal runtime dir should be created");
    assert_eq!(
        super::runtime_root_from_env_or_common_locations(),
        Some(runtime_root.clone())
    );

    unsafe {
        std::env::remove_var("LEX_VAULT_RUNTIME_ROOT");
    }
    std::fs::remove_dir_all(&temp_root).ok();
}

/// 构造一个跨平台的长时间运行子进程，用于模拟微信 helper。
fn long_running_child() -> tokio::process::Child {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("cmd.exe");
        command.args(["/C", "timeout", "/T", "30", "/NOBREAK"]);
        command
    };

    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("long running child should spawn")
}
