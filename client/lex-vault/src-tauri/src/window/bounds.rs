//! 启动窗口尺寸与位置策略。
//!
//! @author kongweiguang

use tauri::{PhysicalPosition, PhysicalSize};

/// 默认开窗宽度占显示器工作区的比例，接近最大化但保留舒适留白。
const DEFAULT_WINDOW_WIDTH_RATIO: f64 = 0.88;

/// 默认开窗高度占显示器工作区的比例，避免完全贴满屏幕底边。
const DEFAULT_WINDOW_HEIGHT_RATIO: f64 = 0.86;

/// 默认顶部留白比例，让窗口视觉中心略微偏上。
const DEFAULT_WINDOW_TOP_MARGIN_RATIO: f64 = 0.06;

/// 历史窗口宽度低于该比例时，认为恢复结果偏小，需要回退到默认大窗口。
const MIN_RESTORED_WINDOW_WIDTH_RATIO: f64 = 0.82;

/// 历史窗口高度低于该比例时，认为恢复结果偏小，需要回退到默认大窗口。
const MIN_RESTORED_WINDOW_HEIGHT_RATIO: f64 = 0.78;

/// 按主显示器工作区设置默认启动窗口：接近最大化、水平居中、垂直略微偏上。
pub fn apply_opening_window_bounds(window: &tauri::WebviewWindow) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        let _ = window.center();
        return;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let width = (monitor_size.width as f64 * DEFAULT_WINDOW_WIDTH_RATIO).round() as u32;
    let height = (monitor_size.height as f64 * DEFAULT_WINDOW_HEIGHT_RATIO).round() as u32;
    let x = monitor_position.x + ((monitor_size.width.saturating_sub(width)) / 2) as i32;
    let y = monitor_position.y
        + (monitor_size.height as f64 * DEFAULT_WINDOW_TOP_MARGIN_RATIO).round() as i32;

    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// 判断当前窗口位置和尺寸是否仍位于可见显示区域内，且没有小到影响主工作台使用。
pub fn window_bounds_look_valid(window: &tauri::WebviewWindow) -> bool {
    let Ok(outer_position) = window.outer_position() else {
        return false;
    };
    let Ok(outer_size) = window.outer_size() else {
        return false;
    };
    if outer_size.width == 0 || outer_size.height == 0 {
        return false;
    }

    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => Some(monitor),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return true;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let min_width = (monitor_size.width as f64 * MIN_RESTORED_WINDOW_WIDTH_RATIO).round() as u32;
    let min_height = (monitor_size.height as f64 * MIN_RESTORED_WINDOW_HEIGHT_RATIO).round() as u32;
    if outer_size.width < min_width || outer_size.height < min_height {
        return false;
    }

    let right = outer_position.x + outer_size.width as i32;
    let bottom = outer_position.y + outer_size.height as i32;
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;

    outer_position.x < monitor_right
        && outer_position.y < monitor_bottom
        && right > monitor_position.x
        && bottom > monitor_position.y
}
