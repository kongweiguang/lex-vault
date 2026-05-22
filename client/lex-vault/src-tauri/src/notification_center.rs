//! 桌面端系统通知封装，统一收敛通知文案和调用入口。
//!
//! @author kongweiguang

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::jsonrpc::AppError;

/// Lex Vault 桌面通知场景。
#[derive(Debug, Clone)]
pub enum NotificationScenario {
    /// 对话回答完成，且窗口当前不在前台。
    ConversationCompleted,
    /// 收到审批请求，且主窗口当前处于隐藏状态。
    ApprovalRequired,
    /// 检测到可用更新。
    UpdateAvailable,
    /// 日历事项提醒。
    CalendarReminder { title: String, body: String },
}

impl NotificationScenario {
    /// 返回场景对应的通知标题和正文，避免调用方散落文案。
    fn content(&self) -> (String, String) {
        match self {
            Self::ConversationCompleted => (
                "Lex Vault".to_string(),
                "小隐已完成当前回答，点击返回工作台继续查看。".to_string(),
            ),
            Self::ApprovalRequired => (
                "Lex Vault".to_string(),
                "有新的审批等待处理，请返回工作台确认。".to_string(),
            ),
            Self::UpdateAvailable => (
                "Lex Vault".to_string(),
                "检测到新版本可更新，可前往设置页执行更新。".to_string(),
            ),
            Self::CalendarReminder { title, body } => (title.clone(), body.clone()),
        }
    }
}

/// 发送桌面系统通知。
pub fn notify(app: &AppHandle, scenario: NotificationScenario) -> Result<(), AppError> {
    let (title, body) = scenario.content();
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|err| {
            AppError::new(
                "DESKTOP_NOTIFICATION_FAILED",
                "系统通知发送失败",
                err.to_string(),
                true,
            )
        })
}
