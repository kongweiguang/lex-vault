import { invoke } from "@tauri-apps/api/core";

import { isWindowInactive, isWindowInForeground } from "@/services/window-activity-service";

/** 统一通知类型。 */
export type AppNotificationKind = "turn-completed" | "approval-required" | "update-available" | "calendar-reminder";

/** 统一通知载荷。 */
export type AppNotificationPayload = {
  /** 通知类型，用于区分文案和去重策略。 */
  kind: AppNotificationKind;
  /** 通知标题。 */
  title: string;
  /** 通知正文。 */
  body: string;
};

/** 在满足窗口不活跃前提时发送系统通知。 */
export async function notifyWhenWindowInactive(payload: AppNotificationPayload) {
  if (!isWindowInactive()) {
    return false;
  }
  return notify(payload);
}

/** 在窗口不可见时发送系统通知。 */
export async function notifyWhenWindowHidden(payload: AppNotificationPayload) {
  if (isWindowInForeground()) {
    return false;
  }
  return notify(payload);
}

/** 发送统一系统通知。 */
export async function notify(payload: AppNotificationPayload) {
  try {
    await invoke("notify_desktop", {
      scenario: mapNotificationKind(payload.kind),
      title: payload.title,
      body: payload.body,
    });
    return true;
  } catch (error) {
    console.error("发送系统通知失败", error);
    return false;
  }
}

/** 将前端通知类型映射为 Rust 侧稳定场景值。 */
function mapNotificationKind(kind: AppNotificationKind) {
  switch (kind) {
    case "turn-completed":
      return "conversation_completed";
    case "approval-required":
      return "approval_required";
    case "update-available":
      return "update_available";
    case "calendar-reminder":
      return "calendar_reminder";
    default:
      return "conversation_completed";
  }
}
