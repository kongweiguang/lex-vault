//! 原生窗口生命周期、尺寸、主题和标题栏入口编排。
//!
//! @author kongweiguang

pub mod theme;

mod bounds;
mod icon_draw;
mod platform;
mod sidebar;

use tauri::{AppHandle, Manager, Theme, WindowEvent};

/// 显示并聚焦主窗口，供启动流程和托盘菜单复用。
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        ensure_visible_with_fallback(&window);
        let _ = window.set_focus();
    }
}

/// 初始化主窗口的尺寸、系统标题栏、图标和关闭行为。
pub fn initialize_main_window(app: &mut tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    theme::customize_system_title_bar(&window, Theme::Light);
    ensure_visible_with_fallback(&window);

    let default_window_icon = app
        .default_window_icon()
        .cloned()
        .map(|icon| icon.to_owned());
    // Windows 任务栏继续使用产品 logo，标题栏小图标单独表达侧栏开合入口。
    platform::set_window_icons(
        &window,
        sidebar::create_sidebar_icon(1.0),
        default_window_icon,
    );
    sidebar::store_toggle_app(app.handle().clone());
    platform::install_sidebar_subclass(&window);
    platform::hide_visible_title_preserve_system_name(&window, "Lex Vault");
    hide_instead_of_closing(&window);

    let _ = window.show();
    let _ = window.set_focus();
}

/// 关闭按钮只隐藏窗口，避免用户误关后台托盘应用。
fn hide_instead_of_closing(window: &tauri::WebviewWindow) {
    let window_to_hide = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
    });
}

/// 窗口状态插件恢复异常时，安全回退到当前约定的 opening bounds。
fn ensure_visible_with_fallback(window: &tauri::WebviewWindow) {
    if !bounds::window_bounds_look_valid(window) {
        bounds::apply_opening_window_bounds(window);
    }
}
