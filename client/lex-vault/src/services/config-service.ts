import { invoke } from "@tauri-apps/api/core";

import type { AppConfig } from "@/types/domain";

/** 读取本机应用配置。 */
export function getConfig() {
  return invoke<AppConfig>("get_app_config");
}

/** 保存本机应用配置，支持只提交被修改的字段。 */
export function updateConfig(config: Partial<AppConfig>) {
  return invoke<AppConfig>("update_app_config", { config });
}

