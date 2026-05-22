//! 平台相关窗口能力适配，优先隔离 Windows 原生 API 细节。
//!
//! @author kongweiguang

use tauri::image::Image;

#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateIcon, SendMessageW, HTSYSMENU, ICON_BIG, ICON_SMALL, WM_GETICON, WM_GETTEXT,
            WM_GETTEXTLENGTH, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_SETICON, WM_SETTEXT,
        },
    },
};

#[cfg(windows)]
const SIDEBAR_SUBCLASS_ID: usize = 1;

#[cfg(windows)]
static SYSTEM_WINDOW_TITLE: Mutex<Option<Vec<u16>>> = Mutex::new(None);

#[cfg(windows)]
/// 拦截 Windows 标题栏左上角图标点击，把系统菜单入口转为侧栏折叠入口。
unsafe extern "system" fn sidebar_subclass_proc(
    _hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uidsubclass: usize,
    _dwrefdata: usize,
) -> LRESULT {
    if msg == WM_GETICON {
        if let Some(icon_handle) = super::sidebar::taskbar_logo_icon_handle() {
            return LRESULT(icon_handle);
        }
    }

    if msg == WM_GETTEXTLENGTH {
        if let Some(title) = system_window_title() {
            return LRESULT(title.len().saturating_sub(1) as isize);
        }
    }

    if msg == WM_GETTEXT {
        if let Some(title) = system_window_title() {
            let buffer_capacity = wparam.0;
            if buffer_capacity == 0 {
                return LRESULT(0);
            }

            let title_len = title.len().saturating_sub(1);
            let copy_len = title_len.min(buffer_capacity.saturating_sub(1));
            let target = lparam.0 as *mut u16;
            if !target.is_null() {
                std::ptr::copy_nonoverlapping(title.as_ptr(), target, copy_len);
                *target.add(copy_len) = 0;
                return LRESULT(copy_len as isize);
            }
        }
    }

    if msg == WM_NCLBUTTONDOWN || msg == WM_NCLBUTTONDBLCLK {
        if (wparam.0 as u32) == HTSYSMENU {
            super::sidebar::handle_title_bar_icon_event();
            return LRESULT(0);
        }
    }

    DefSubclassProc(_hwnd, msg, wparam, lparam)
}

#[cfg(windows)]
/// 获取供任务栏、Alt-Tab 和系统缩略图读取的窗口标题。
fn system_window_title() -> Option<Vec<u16>> {
    SYSTEM_WINDOW_TITLE
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

#[cfg(windows)]
/// 保存系统可见的窗口标题副本，末尾保留 0 终止符以便响应 WM_GETTEXT。
fn store_system_window_title(title: &str) {
    let mut wide: Vec<u16> = title.encode_utf16().collect();
    wide.push(0);

    if let Ok(mut guard) = SYSTEM_WINDOW_TITLE.lock() {
        *guard = Some(wide);
    }
}

#[cfg(windows)]
/// 隐藏原生标题栏文字，同时让系统读取窗口标题时仍能得到产品名。
pub fn hide_visible_title_preserve_system_name(window: &tauri::WebviewWindow, title: &str) {
    store_system_window_title(title);

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let empty_title = [0u16];
        let _ = SendMessageW(
            hwnd,
            WM_SETTEXT,
            Some(WPARAM(0)),
            Some(LPARAM(empty_title.as_ptr() as isize)),
        );
    }
}

#[cfg(not(windows))]
/// 非 Windows 平台使用 Tauri 配置中的 hiddenTitle 隐藏可见标题，系统标题保留在窗口元数据中。
pub fn hide_visible_title_preserve_system_name(_window: &tauri::WebviewWindow, _title: &str) {}

#[cfg(windows)]
/// 安装 Windows 子类化回调，用于接管标题栏左上角图标点击。
pub fn install_sidebar_subclass(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(sidebar_subclass_proc), SIDEBAR_SUBCLASS_ID, 0);
    }
}

#[cfg(not(windows))]
/// 非 Windows 平台无需安装标题栏子类化回调。
pub fn install_sidebar_subclass(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
/// 将 Tauri Image 转为 Windows 原生 HICON 句柄。
fn create_hicon(icon: Image<'static>) -> Option<isize> {
    let width = icon.width() as i32;
    let height = icon.height() as i32;
    let rgba = icon.rgba();
    let mut bgra = Vec::with_capacity(rgba.len());

    for pixel in rgba.chunks_exact(4) {
        bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }

    // 小图标透明度由 BGRA alpha 控制，AND 掩码保持不额外遮挡像素。
    let and_mask = vec![0x00; ((width * height + 7) / 8) as usize];

    unsafe {
        CreateIcon(None, width, height, 1, 32, and_mask.as_ptr(), bgra.as_ptr())
            .ok()
            .map(|icon_handle| icon_handle.0 as isize)
    }
}

#[cfg(windows)]
/// 仅替换 Windows 标题栏小图标，避免点击动画影响任务栏产品 logo。
pub fn set_title_bar_small_icon(window: &tauri::WebviewWindow, icon: Image<'static>) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    if let Some(icon_handle) = create_hicon(icon) {
        unsafe {
            let _ = SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(ICON_SMALL as usize)),
                Some(LPARAM(icon_handle)),
            );
            let _ = SendMessageW(hwnd, WM_SETICON, Some(WPARAM(2)), Some(LPARAM(icon_handle)));
        }
    }
}

#[cfg(windows)]
/// 初始化 Windows 窗口图标：标题栏小图标用折叠入口，任务栏大图标固定产品 logo。
pub fn set_window_icons(
    window: &tauri::WebviewWindow,
    title_bar_icon: Image<'static>,
    taskbar_icon: Option<Image<'static>>,
) {
    set_title_bar_small_icon(window, title_bar_icon);

    let Some(taskbar_icon) = taskbar_icon else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    if let Some(icon_handle) = create_hicon(taskbar_icon) {
        super::sidebar::store_taskbar_logo_icon(icon_handle);
        unsafe {
            let _ = SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(ICON_BIG as usize)),
                Some(LPARAM(icon_handle)),
            );
        }
    }
}

#[cfg(not(windows))]
/// 非 Windows 平台没有单独标题栏小图标入口，退回到窗口图标设置。
pub fn set_title_bar_small_icon(window: &tauri::WebviewWindow, icon: Image<'static>) {
    let _ = window.set_icon(icon);
}

#[cfg(not(windows))]
/// 非 Windows 平台没有标题栏和任务栏图标分离能力，优先保持产品 logo。
pub fn set_window_icons(
    window: &tauri::WebviewWindow,
    title_bar_icon: Image<'static>,
    taskbar_icon: Option<Image<'static>>,
) {
    let _ = window.set_icon(taskbar_icon.unwrap_or(title_bar_icon));
}
