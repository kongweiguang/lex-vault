//! 标题栏侧栏入口状态机和图标动画。
//!
//! @author kongweiguang

use std::{sync::Mutex, thread::sleep, time::Duration};

use tauri::{image::Image, AppHandle, Emitter, Manager};

use super::{icon_draw, platform};

static SIDEBAR_TOGGLE_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static SIDEBAR_COLLAPSED: Mutex<bool> = Mutex::new(false);
static TASKBAR_LOGO_ICON: Mutex<Option<isize>> = Mutex::new(None);

/// 创建标题栏侧栏入口小图标，open_amount 为 0 时关门，为 1 时开门。
pub fn create_sidebar_icon(open_amount: f32) -> Image<'static> {
    icon_draw::create_sidebar_icon(open_amount)
}

/// 保存应用句柄，供 Windows 标题栏子类化回调触发前端事件。
pub fn store_toggle_app(app: AppHandle) {
    if let Ok(mut guard) = SIDEBAR_TOGGLE_APP.lock() {
        *guard = Some(app);
    }
}

/// 记录任务栏产品 logo 的原生句柄，让外部图标查询始终返回产品 logo。
pub fn store_taskbar_logo_icon(icon_handle: isize) {
    if let Ok(mut guard) = TASKBAR_LOGO_ICON.lock() {
        *guard = Some(icon_handle);
    }
}

/// 读取任务栏产品 logo 的原生句柄。
pub fn taskbar_logo_icon_handle() -> Option<isize> {
    TASKBAR_LOGO_ICON.lock().ok().and_then(|guard| *guard)
}

/// 处理 Windows 标题栏左上角图标点击，转为侧栏折叠事件。
pub fn handle_title_bar_icon_event() {
    if let Ok(guard) = SIDEBAR_TOGGLE_APP.lock() {
        if let Some(app) = guard.as_ref() {
            toggle_sidebar_icon(app);
            let _ = app.emit("toggle-sidebar", ());
        }
    }
}

/// 切换侧栏折叠状态，并让标题栏小图标同步呈现开门或关门状态。
fn toggle_sidebar_icon(app: &AppHandle) {
    let Ok(mut collapsed) = SIDEBAR_COLLAPSED.lock() else {
        return;
    };

    let next_collapsed = !*collapsed;
    let (start_open_amount, end_open_amount) = if next_collapsed {
        (1.0, 0.0)
    } else {
        (0.0, 1.0)
    };

    if let Some(window) = app.get_webview_window("main") {
        for step in 0..=4 {
            let ratio = step as f32 / 4.0;
            let open_amount = start_open_amount + (end_open_amount - start_open_amount) * ratio;
            platform::set_title_bar_small_icon(&window, create_sidebar_icon(open_amount));
            sleep(Duration::from_millis(14));
        }
    }

    *collapsed = next_collapsed;
}
