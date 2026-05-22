//! 桌面端更新状态、命令和事件封装。
//!
//! @author kongweiguang

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::RwLock;

use crate::jsonrpc::AppError;
use crate::notification_center::{self, NotificationScenario};

/// 前端订阅更新状态使用的 Tauri 事件名称。
pub const APP_UPDATE_EVENT_NAME: &str = "lex-vault://app-update";

/// 桌面端更新状态机。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateState {
    /// 当前更新状态代码，供前端做稳定判断。
    pub status: AppUpdateStatus,
    /// 当前桌面端版本号。
    pub current_version: String,
    /// 检测到的新版本号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    /// 面向用户的说明文案。
    pub message: String,
}

/// 更新状态枚举。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppUpdateStatus {
    /// 尚未执行检查。
    Idle,
    /// 正在检查远程更新。
    Checking,
    /// 已发现可更新版本。
    Available,
    /// 正在下载安装包。
    Downloading,
    /// 当前已是最新版本。
    UpToDate,
    /// 下载失败或检查失败。
    Failed,
    /// 已下载完成，准备重启安装。
    ReadyToInstall,
}

impl AppUpdateState {
    /// 构造默认空闲状态。
    pub fn idle(current_version: String) -> Self {
        Self {
            status: AppUpdateStatus::Idle,
            current_version,
            latest_version: None,
            message: "尚未检查更新".to_string(),
        }
    }
}

/// 构造“已发现更新”的状态快照，便于统一测试与事件输出。
fn available_state(current_version: String, latest_version: String) -> AppUpdateState {
    AppUpdateState {
        status: AppUpdateStatus::Available,
        current_version,
        latest_version: Some(latest_version.clone()),
        message: format!("检测到新版本 {}，可开始下载。", latest_version),
    }
}

/// 构造“已是最新版本”的状态快照。
fn up_to_date_state(current_version: String) -> AppUpdateState {
    AppUpdateState {
        status: AppUpdateStatus::UpToDate,
        current_version,
        latest_version: None,
        message: "当前已经是最新版本".to_string(),
    }
}

/// 构造“更新失败”的状态快照，保证前端始终收到稳定状态和值得展示的文案。
fn failed_state(current_version: String, message: String) -> AppUpdateState {
    AppUpdateState {
        status: AppUpdateStatus::Failed,
        current_version,
        latest_version: None,
        message,
    }
}

/// 桌面端更新状态仓库。
#[derive(Default)]
pub struct AppUpdateStateStore {
    /// 最近一次更新状态快照。
    pub state: RwLock<Option<AppUpdateState>>,
}

/// 前端读取的更新状态响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatusResponse {
    /// 当前更新状态。
    pub state: AppUpdateState,
}

/// 对外暴露给前端的更新检查命令。
pub async fn check_app_update(
    app: AppHandle,
    store: State<'_, AppUpdateStateStore>,
) -> Result<AppUpdateStatusResponse, AppError> {
    let current_version = app.package_info().version.to_string();
    let checking = AppUpdateState {
        status: AppUpdateStatus::Checking,
        current_version: current_version.clone(),
        latest_version: None,
        message: "正在检查更新".to_string(),
    };
    publish_state(&app, &store, checking.clone()).await?;

    let updater = app.updater().map_err(|err| {
        AppError::new(
            "APP_UPDATE_CHECK_FAILED",
            "检查更新失败",
            format!("初始化更新器失败：{err}"),
            true,
        )
    })?;
    let update = updater.check().await.map_err(|err| {
        AppError::new(
            "APP_UPDATE_CHECK_FAILED",
            "检查更新失败",
            format!("当前未配置可用的更新源或更新检查失败：{err}"),
            true,
        )
    })?;

    let next_state = if let Some(update) = update {
        let state = available_state(current_version.clone(), update.version.clone());
        let _ = notification_center::notify(&app, NotificationScenario::UpdateAvailable);
        state
    } else {
        up_to_date_state(current_version)
    };

    publish_state(&app, &store, next_state.clone()).await?;
    Ok(AppUpdateStatusResponse { state: next_state })
}

/// 对外暴露给前端的更新下载命令。
pub async fn download_and_install_app_update(
    app: AppHandle,
    store: State<'_, AppUpdateStateStore>,
) -> Result<AppUpdateStatusResponse, AppError> {
    let current_version = app.package_info().version.to_string();
    let downloading = AppUpdateState {
        status: AppUpdateStatus::Downloading,
        current_version: current_version.clone(),
        latest_version: None,
        message: "正在下载并安装更新".to_string(),
    };
    publish_state(&app, &store, downloading).await?;

    let updater = app.updater().map_err(|err| {
        AppError::new(
            "APP_UPDATE_DOWNLOAD_FAILED",
            "下载安装更新失败",
            format!("初始化更新器失败：{err}"),
            true,
        )
    })?;
    let update = updater.check().await.map_err(|err| {
        AppError::new(
            "APP_UPDATE_DOWNLOAD_FAILED",
            "下载安装更新失败",
            format!("当前未配置可用的更新源或更新检查失败：{err}"),
            true,
        )
    })?;
    let Some(update) = update else {
        let mut state = up_to_date_state(current_version);
        state.message = "当前已经是最新版本，无需下载安装。".to_string();
        publish_state(&app, &store, state.clone()).await?;
        return Ok(AppUpdateStatusResponse { state });
    };

    let latest_version = update.version.clone();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| {
            AppError::new(
                "APP_UPDATE_DOWNLOAD_FAILED",
                "下载安装更新失败",
                format!("版本 {latest_version} 下载或安装失败：{err}"),
                true,
            )
        })?;

    let ready = AppUpdateState {
        status: AppUpdateStatus::ReadyToInstall,
        current_version,
        latest_version: Some(latest_version),
        message: "更新已下载完成，应用将准备重启安装。".to_string(),
    };
    publish_state(&app, &store, ready.clone()).await?;
    Ok(AppUpdateStatusResponse { state: ready })
}

/// 读取当前缓存的更新状态，没有缓存时返回默认空闲状态。
pub async fn get_app_update_status(
    app: AppHandle,
    store: State<'_, AppUpdateStateStore>,
) -> Result<AppUpdateStatusResponse, AppError> {
    let current_version = app.package_info().version.to_string();
    let existing = store.state.read().await.clone();
    Ok(AppUpdateStatusResponse {
        state: existing.unwrap_or_else(|| AppUpdateState::idle(current_version)),
    })
}

/// 启动后可异步静默执行一次更新检查；失败只下发可读状态，不阻断应用启动。
pub fn spawn_silent_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppUpdateStateStore>();
        if let Err(error) = check_app_update(app.clone(), state).await {
            let failed_state = failed_state(
                app.package_info().version.to_string(),
                error.message.clone(),
            );
            let state = app.state::<AppUpdateStateStore>();
            let _ = publish_state(&app, &state, failed_state).await;
        }
    });
}

async fn publish_state(
    app: &AppHandle,
    store: &AppUpdateStateStore,
    state: AppUpdateState,
) -> Result<(), AppError> {
    *store.state.write().await = Some(state.clone());
    app.emit(APP_UPDATE_EVENT_NAME, state).map_err(|err| {
        AppError::new(
            "APP_UPDATE_EVENT_EMIT_FAILED",
            "发送更新事件失败",
            err.to_string(),
            true,
        )
    })
}

#[cfg(test)]
#[path = "tests/update_manager_tests.rs"]
mod tests;
