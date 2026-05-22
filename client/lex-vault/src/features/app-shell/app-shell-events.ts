type AppShellEventBinderOptions = {
  /** 新建普通对话动作。 */
  onNewChat: () => void;
  /** 新建案件对话动作。 */
  onNewCaseChat: () => void;
  /** 切换侧栏折叠状态。 */
  onToggleSidebar: () => void;
};

/**
 * 统一绑定托盘和标题栏折叠入口事件，避免主应用壳重复维护 Tauri 事件总线细节。
 */
export async function bindAppShellEvents({
  onNewCaseChat,
  onNewChat,
  onToggleSidebar,
}: AppShellEventBinderOptions) {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenChat = await listen("tray-new-chat", onNewChat);
    const unlistenCaseChat = await listen("tray-new-case-chat", onNewCaseChat);
    const unlistenSidebar = await listen("toggle-sidebar", onToggleSidebar);
    return () => {
      unlistenChat();
      unlistenCaseChat();
      unlistenSidebar();
    };
  } catch {
    // 浏览器预览没有 Tauri 事件总线，忽略即可。
    return () => {};
  }
}
