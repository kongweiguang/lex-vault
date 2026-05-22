//! update_manager 模块回归测试。
//!
//! @author kongweiguang

use super::{available_state, failed_state, up_to_date_state, AppUpdateState, AppUpdateStatus};

/// 验证发现新版本时会带上稳定状态码、版本号和可读提示。
#[test]
fn available_state_contains_latest_version_and_message() {
    let state = available_state("0.1.2".to_string(), "0.2.0".to_string());

    assert_eq!(state.status, AppUpdateStatus::Available);
    assert_eq!(state.current_version, "0.1.2");
    assert_eq!(state.latest_version.as_deref(), Some("0.2.0"));
    assert!(state.message.contains("0.2.0"));
}

/// 验证未发现更新时会清空 latestVersion，避免前端误展示旧版本号。
#[test]
fn up_to_date_state_clears_latest_version() {
    let state = up_to_date_state("0.1.2".to_string());

    assert_eq!(state.status, AppUpdateStatus::UpToDate);
    assert_eq!(state.current_version, "0.1.2");
    assert_eq!(state.latest_version, None);
}

/// 验证失败状态会保留原始可读说明，方便设置页直接提示用户。
#[test]
fn failed_state_keeps_readable_message() {
    let state = failed_state("0.1.2".to_string(), "未配置更新源".to_string());

    assert_eq!(state.status, AppUpdateStatus::Failed);
    assert_eq!(state.current_version, "0.1.2");
    assert_eq!(state.latest_version, None);
    assert_eq!(state.message, "未配置更新源");
}

/// 验证默认空闲状态保持“尚未检查”的语义。
#[test]
fn idle_state_defaults_to_not_checked() {
    let state = AppUpdateState::idle("0.1.2".to_string());

    assert_eq!(state.status, AppUpdateStatus::Idle);
    assert_eq!(state.current_version, "0.1.2");
    assert_eq!(state.latest_version, None);
    assert_eq!(state.message, "尚未检查更新");
}
