//! 标题栏侧栏入口图标的像素绘制工具。
//!
//! @author kongweiguang

use tauri::image::Image;

/// 创建标题栏侧栏入口小图标，open_amount 为 0 时关门，为 1 时开门。
pub fn create_sidebar_icon(open_amount: f32) -> Image<'static> {
    let width = 32u32;
    let height = 32u32;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);

    for y in 0..height {
        for x in 0..width {
            let mut color = [0, 0, 0, 0];
            let samples = 4.0;

            for sy in 0..4 {
                for sx in 0..4 {
                    let px = x as f32 + (sx as f32 + 0.5) / samples;
                    let py = y as f32 + (sy as f32 + 0.5) / samples;
                    blend_sidebar_sample(px, py, open_amount, &mut color);
                }
            }

            rgba.extend_from_slice(&color);
        }
    }

    Image::new_owned(rgba, width, height)
}

/// 将一次子采样命中的图形元素合成到目标像素。
fn blend_sidebar_sample(px: f32, py: f32, open_amount: f32, color: &mut [u8; 4]) {
    let frame = outline_rounded_rect(px, py, 4.2, 4.0, 21.4, 27.6, 3.2, 2.0);
    let hinge = distance_to_segment(px, py, 7.0, 7.4, 7.0, 24.2) <= 1.05;
    let closed_door = [(9.0, 7.5), (20.8, 7.5), (20.8, 24.5), (9.0, 24.5)];
    let open_door = [(9.6, 8.0), (27.2, 4.6), (27.2, 27.4), (9.6, 24.0)];
    let closed_inner = [(11.2, 10.1), (18.6, 10.1), (18.6, 21.9), (11.2, 21.9)];
    let open_inner = [(12.4, 10.8), (24.2, 8.6), (24.2, 23.4), (12.4, 21.2)];
    let door_points = interpolate_points(&closed_door, &open_door, open_amount);
    let inner_points = interpolate_points(&closed_inner, &open_inner, open_amount);
    let handle_center = (17.2 + (22.7 - 17.2) * open_amount, 16.0);
    let door = point_in_polygon(px, py, &door_points);
    let door_inner = point_in_polygon(px, py, &inner_points);
    let door_edge = polygon_outline(px, py, &door_points) <= 1.05;
    let handle = distance_to_point(px, py, handle_center.0, handle_center.1) <= 1.55;
    let light_halo = frame
        || hinge
        || polygon_outline(px, py, &door_points) <= 1.7
        || distance_to_point(px, py, handle_center.0, handle_center.1) <= 2.05;

    // 深浅双层描边让系统标题栏在浅色和暗色主题下都能保持可读。
    if light_halo {
        blend_sample(color, [0xf8, 0xfa, 0xfc, 210]);
    }
    if door {
        blend_sample(color, [0x94, 0xa3, 0xb8, 96]);
    }
    if door_inner {
        blend_sample(color, [0xff, 0xff, 0xff, 34]);
    }
    if frame || hinge || door_edge {
        blend_sample(color, [0x0f, 0x17, 0x2a, 236]);
    }
    if handle {
        blend_sample(color, [0x1d, 0x4e, 0xd8, 255]);
    }
}

/// 对两组等长点位做线性插值，用于生成开关门过渡帧。
fn interpolate_points<const N: usize>(
    start: &[(f32, f32); N],
    end: &[(f32, f32); N],
    ratio: f32,
) -> [(f32, f32); N] {
    std::array::from_fn(|index| {
        (
            start[index].0 + (end[index].0 - start[index].0) * ratio,
            start[index].1 + (end[index].1 - start[index].1) * ratio,
        )
    })
}

/// 将一次子采样颜色按 alpha 合成到目标像素中。
fn blend_sample(target: &mut [u8; 4], source: [u8; 4]) {
    let source_alpha = source[3] as f32 / 255.0 / 16.0;
    let target_alpha = target[3] as f32 / 255.0;
    let next_alpha = source_alpha + target_alpha * (1.0 - source_alpha);

    if next_alpha <= f32::EPSILON {
        return;
    }

    for channel in 0..3 {
        let source_value = source[channel] as f32 / 255.0;
        let target_value = target[channel] as f32 / 255.0;
        let next_value = (source_value * source_alpha
            + target_value * target_alpha * (1.0 - source_alpha))
            / next_alpha;
        target[channel] = (next_value * 255.0).round() as u8;
    }
    target[3] = (next_alpha * 255.0).round() as u8;
}

/// 判断采样点是否落在圆角矩形描边范围内。
fn outline_rounded_rect(
    x: f32,
    y: f32,
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
    radius: f32,
    stroke: f32,
) -> bool {
    let cx = x.clamp(left + radius, right - radius);
    let cy = y.clamp(top + radius, bottom - radius);
    let distance = distance_to_point(x, y, cx, cy) - radius;
    distance.abs() <= stroke / 2.0
}

/// 判断采样点是否落在多边形内部，用于绘制开关状态下的门板。
fn point_in_polygon(x: f32, y: f32, points: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let mut previous = points.len() - 1;

    for current in 0..points.len() {
        let (current_x, current_y) = points[current];
        let (previous_x, previous_y) = points[previous];
        let crosses = (current_y > y) != (previous_y > y);

        if crosses
            && x < (previous_x - current_x) * (y - current_y) / (previous_y - current_y) + current_x
        {
            inside = !inside;
        }
        previous = current;
    }

    inside
}

/// 计算采样点到多边形轮廓的最短距离。
fn polygon_outline(x: f32, y: f32, points: &[(f32, f32)]) -> f32 {
    let mut min_distance = f32::MAX;

    for index in 0..points.len() {
        let (start_x, start_y) = points[index];
        let (end_x, end_y) = points[(index + 1) % points.len()];
        min_distance = min_distance.min(distance_to_segment(x, y, start_x, start_y, end_x, end_y));
    }

    min_distance
}

/// 计算采样点到线段的最短距离。
fn distance_to_segment(x: f32, y: f32, start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> f32 {
    let dx = end_x - start_x;
    let dy = end_y - start_y;
    let length_squared = dx * dx + dy * dy;

    if length_squared <= f32::EPSILON {
        return distance_to_point(x, y, start_x, start_y);
    }

    let ratio = (((x - start_x) * dx + (y - start_y) * dy) / length_squared).clamp(0.0, 1.0);
    distance_to_point(x, y, start_x + ratio * dx, start_y + ratio * dy)
}

/// 计算两个二维点之间的距离。
fn distance_to_point(x: f32, y: f32, target_x: f32, target_y: f32) -> f32 {
    ((x - target_x).powi(2) + (y - target_y).powi(2)).sqrt()
}
