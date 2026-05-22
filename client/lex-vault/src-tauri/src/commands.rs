//! 前端可调用的 Tauri 命令集合。
//!
//! @author kongweiguang

use tauri::Theme;

use crate::{notification_center, update_manager, window};

pub mod codex;
pub mod file_manager;
pub mod local_data;
pub mod wechat;

/// 设置窗口原生主题，让系统标题栏和前端深浅色模式保持一致。
#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, theme: String) {
    let native_theme = if theme == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    };

    let _ = window.set_theme(Some(native_theme));
    window::theme::customize_system_title_bar(&window, native_theme);
}

/// 触发桌面系统通知，统一通过 Rust 侧场景枚举映射文案。
#[tauri::command]
pub fn notify_desktop(
    app: tauri::AppHandle,
    scenario: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), crate::jsonrpc::AppError> {
    let scenario = match scenario.as_str() {
        "conversation_completed" => {
            notification_center::NotificationScenario::ConversationCompleted
        }
        "approval_required" => notification_center::NotificationScenario::ApprovalRequired,
        "update_available" => notification_center::NotificationScenario::UpdateAvailable,
        "calendar_reminder" => notification_center::NotificationScenario::CalendarReminder {
            title: title
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "日历提醒".to_string()),
            body: body
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "有日历事项即将到期。".to_string()),
        },
        _ => {
            return Err(crate::jsonrpc::AppError::new(
                "DESKTOP_NOTIFICATION_SCENARIO_INVALID",
                "通知场景不支持",
                format!("未知通知场景：{scenario}"),
                true,
            ));
        }
    };
    notification_center::notify(&app, scenario)
}

/// 读取桌面端当前版本和最近一次更新状态。
#[tauri::command]
pub async fn get_app_update_status(
    app: tauri::AppHandle,
    store: tauri::State<'_, update_manager::AppUpdateStateStore>,
) -> Result<update_manager::AppUpdateStatusResponse, crate::jsonrpc::AppError> {
    update_manager::get_app_update_status(app, store).await
}

/// 主动检查是否存在可用更新。
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    store: tauri::State<'_, update_manager::AppUpdateStateStore>,
) -> Result<update_manager::AppUpdateStatusResponse, crate::jsonrpc::AppError> {
    update_manager::check_app_update(app, store).await
}

/// 下载并安装已发现的更新。
#[tauri::command]
pub async fn download_and_install_app_update(
    app: tauri::AppHandle,
    store: tauri::State<'_, update_manager::AppUpdateStateStore>,
) -> Result<update_manager::AppUpdateStatusResponse, crate::jsonrpc::AppError> {
    update_manager::download_and_install_app_update(app, store).await
}
