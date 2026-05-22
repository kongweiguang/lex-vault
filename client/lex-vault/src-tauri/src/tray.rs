//! 系统托盘菜单与托盘交互。
//!
//! @author kongweiguang

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use crate::window;

/// 创建主托盘入口，负责窗口显隐和前端新建对话事件转发。
pub fn create_main_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let tray_menu = MenuBuilder::new(app)
        .text("show", "显示主窗口")
        .text("new_chat", "新建对话")
        .text("new_case_chat", "新建案件对话")
        .separator()
        .text("hide", "隐藏窗口")
        .text("quit", "退出")
        .build()?;

    let tray_icon = app
        .default_window_icon()
        .cloned()
        .map(|icon| icon.to_owned());
    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&tray_menu)
        .tooltip("律隐台 AI 办案助手")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => window::show_main_window(app),
            "new_chat" => emit_tray_shortcut(app, "tray-new-chat"),
            "new_case_chat" => emit_tray_shortcut(app, "tray-new-case-chat"),
            "hide" => hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => window::show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = tray_icon {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

/// 隐藏主窗口，保留托盘后台运行状态。
fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// 先唤起主窗口，再向前端发送托盘快捷入口事件。
fn emit_tray_shortcut(app: &AppHandle, event: &str) {
    window::show_main_window(app);
    let _ = app.emit(event, ());
}
