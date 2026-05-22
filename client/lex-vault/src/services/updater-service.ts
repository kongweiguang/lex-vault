import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { AppUpdaterState, AppUpdaterStatus, AppVersionInfo } from "@/types/domain";

/** updater 状态监听器。 */
type UpdaterStateListener = (state: AppUpdaterState) => void;

/** 当前 updater 状态缓存。 */
let currentState: AppUpdaterState = {
  status: "idle",
  statusText: "未检查",
};

/** 当前应用版本缓存。 */
let versionInfo: AppVersionInfo = {
  currentVersion: "",
};

/** updater 状态订阅列表。 */
const listeners = new Set<UpdaterStateListener>();

/** 是否已经绑定 Rust 侧更新事件。 */
let isUpdateEventBound = false;

/** Rust 侧更新状态载荷。 */
type RustUpdaterPayload = {
  /** Rust 更新状态代码。 */
  status: "idle" | "checking" | "available" | "downloading" | "up_to_date" | "failed" | "ready_to_install";
  /** 当前应用版本。 */
  currentVersion: string;
  /** 检测到的新版本。 */
  latestVersion?: string;
  /** Rust 侧直接返回的中文状态文案。 */
  message: string;
};

/** Rust 侧更新状态响应。 */
type RustUpdaterStatusResponse = {
  /** 当前更新状态快照。 */
  state: RustUpdaterPayload;
};

/** 读取当前应用版本。 */
export async function loadAppVersionInfo() {
  await ensureUpdaterEventBinding();
  const state = await getRustUpdaterState().catch((error) => {
    console.error("读取应用版本失败", error);
    return null;
  });
  if (state?.currentVersion) {
    versionInfo = {
      currentVersion: state.currentVersion,
    };
  }
  return versionInfo;
}

/** 获取当前 updater 状态快照。 */
export function getUpdaterState() {
  return currentState;
}

/** 订阅 updater 状态变化。 */
export function subscribeUpdaterState(listener: UpdaterStateListener) {
  void ensureUpdaterEventBinding();
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/** 启动静默更新检查，仅更新语义状态，不主动安装。 */
export async function silentCheckForUpdates() {
  return checkForUpdates({ silent: true });
}

/** 手动检查更新。 */
export async function checkForUpdates(options: { silent?: boolean } = {}) {
  await ensureUpdaterEventBinding();
  await loadAppVersionInfo();
  setUpdaterState("checking", { silent: options.silent });
  try {
    const response = await invoke<RustUpdaterStatusResponse>("check_app_update");
    applyRustUpdaterState(response.state, options.silent);
    return currentState;
  } catch (error) {
    console.error("检查更新失败", error);
    setUpdaterState("check-failed", {
      currentVersion: versionInfo.currentVersion,
      errorMessage: "检查更新失败，请稍后重试",
    });
    return currentState;
  }
}

/** 下载并安装已发现的新版本。 */
export async function installAvailableUpdate() {
  await ensureUpdaterEventBinding();
  try {
    const response = await invoke<RustUpdaterStatusResponse>("download_and_install_app_update");
    applyRustUpdaterState(response.state);
  } catch (error) {
    console.error("下载或安装更新失败", error);
    setUpdaterState("download-failed", {
      currentVersion: currentState.currentVersion ?? versionInfo.currentVersion,
      nextVersion: currentState.nextVersion,
      errorMessage: "下载更新失败，请检查网络或稍后重试",
    });
  }
  return currentState;
}

/** 根据语义状态生成统一文案并通知订阅者。 */
function setUpdaterState(status: AppUpdaterStatus, extra: Partial<AppUpdaterState> = {}) {
  const nextState: AppUpdaterState = {
    ...currentState,
    ...extra,
    status,
    statusText: updaterStatusText(status, extra.nextVersion),
  };
  currentState = nextState;
  listeners.forEach((listener) => listener(nextState));
}

/** 统一 updater 中文状态文案。 */
function updaterStatusText(status: AppUpdaterStatus, nextVersion?: string) {
  switch (status) {
    case "idle":
      return "未检查";
    case "checking":
      return "检查中";
    case "up-to-date":
      return "当前已是最新版本";
    case "available":
      return nextVersion ? `发现新版本 ${nextVersion}` : "发现新版本";
    case "downloading":
      return "下载中";
    case "check-failed":
      return "检查失败";
    case "download-failed":
      return "下载失败";
    case "ready-to-restart":
      return "准备重启安装";
    default:
      return "未检查";
  }
}

/** 读取 Rust 侧当前更新状态。 */
async function getRustUpdaterState() {
  const response = await invoke<RustUpdaterStatusResponse>("get_app_update_status");
  applyRustUpdaterState(response.state);
  return response.state;
}

/** 首次使用时绑定 Rust 侧更新状态事件。 */
async function ensureUpdaterEventBinding() {
  if (isUpdateEventBound) {
    return;
  }
  isUpdateEventBound = true;
  await listen<RustUpdaterPayload>("lex-vault://app-update", (event) => {
    applyRustUpdaterState(event.payload);
  });
}

/** 将 Rust 更新状态统一映射为前端语义状态。 */
function applyRustUpdaterState(payload: RustUpdaterPayload, silent = currentState.silent) {
  versionInfo = {
    currentVersion: payload.currentVersion,
  };
  setUpdaterState(mapRustUpdaterStatus(payload.status), {
    currentVersion: payload.currentVersion,
    nextVersion: payload.latestVersion,
    errorMessage: payload.status === "failed" ? payload.message : undefined,
    silent,
    statusText: payload.message || updaterStatusText(mapRustUpdaterStatus(payload.status), payload.latestVersion),
  });
}

/** 将 Rust 更新状态码翻译成前端稳定状态码。 */
function mapRustUpdaterStatus(status: RustUpdaterPayload["status"]): AppUpdaterStatus {
  switch (status) {
    case "idle":
      return "idle";
    case "checking":
      return "checking";
    case "available":
      return "available";
    case "downloading":
      return "downloading";
    case "up_to_date":
      return "up-to-date";
    case "failed":
      return currentState.status === "downloading" ? "download-failed" : "check-failed";
    case "ready_to_install":
      return "ready-to-restart";
    default:
      return "idle";
  }
}
