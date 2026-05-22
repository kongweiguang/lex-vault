/**
 * 判断当前键盘事件是否需要拦截整页刷新快捷键。
 * 桌面端使用 Tauri 承载业务界面，整页刷新会打断当前工作流，因此统一禁用。
 */
export function shouldPreventWindowRefreshShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  const normalizedKey = event.key.trim().toLowerCase();
  if (normalizedKey !== "r") {
    return false;
  }
  return event.ctrlKey || event.metaKey;
}
