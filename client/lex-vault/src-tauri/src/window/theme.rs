//! 系统标题栏主题同步。
//!
//! @author kongweiguang

use tauri::Theme;

#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
};

#[cfg(windows)]
/// 设置 Windows 原生标题栏颜色，使其和前端深浅色外观保持一致。
pub fn customize_system_title_bar(window: &tauri::WebviewWindow, theme: Theme) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let (caption_color, text_color): (u32, u32) = match theme {
        Theme::Dark => (0x002a170f, 0x00e7e5e4),
        Theme::Light => (0x00f6f4f3, 0x00271811),
        _ => (0x00f6f4f3, 0x00271811),
    };

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption_color as *const u32 as *const _,
            std::mem::size_of_val(&caption_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &caption_color as *const u32 as *const _,
            std::mem::size_of_val(&caption_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text_color as *const u32 as *const _,
            std::mem::size_of_val(&text_color) as u32,
        );
    }
}

#[cfg(not(windows))]
/// 非 Windows 平台暂不调整系统标题栏颜色。
pub fn customize_system_title_bar(_window: &tauri::WebviewWindow, _theme: Theme) {}
