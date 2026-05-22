import { THEME_STORAGE_KEY } from "@/config/runtime";
import type { ThemeMode } from "@/types/domain";

/** 从本地存储读取主题模式，非法值会回退到跟随系统。 */
export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

/** 将用户选择的主题模式解析为当前真正生效的明暗色。 */
export function resolveThemeMode(mode: ThemeMode) {
  if (mode !== "system" || typeof window === "undefined") {
    return mode === "dark" ? "dark" : "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 同步 Tauri 原生窗口主题；浏览器调试环境会静默跳过。 */
export async function syncNativeWindowTheme(theme: "light" | "dark") {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_theme", { theme });
  } catch {
    // 浏览器预览没有 Tauri 命令，前端主题正常生效即可。
  }
}
