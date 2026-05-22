import { listen } from "@tauri-apps/api/event";

import type { AppRuntimeBundleState, AppRuntimeBundleStatus } from "@/types/domain";

/** runtime 安装状态监听器。 */
type RuntimeBundleStateListener = (state: AppRuntimeBundleState) => void;

/** 当前 runtime 安装状态缓存。 */
let currentState: AppRuntimeBundleState = {
  status: "idle",
  statusText: "运行时未开始准备",
};

/** 当前 runtime 安装状态订阅列表。 */
const listeners = new Set<RuntimeBundleStateListener>();

/** 是否已绑定 Rust 侧 runtime 安装事件。 */
let isRuntimeBundleEventBound = false;

/** Rust 侧 runtime 安装事件载荷。 */
type RustRuntimeBundlePayload = {
  /** Rust 侧安装阶段状态。 */
  status: "required" | "downloading" | "extracting" | "ready" | "failed";
  /** Rust 侧直接返回的中文文案。 */
  message: string;
  /** 当前步骤已完成进度。 */
  stepCurrent?: number;
  /** 当前步骤总进度。 */
  stepTotal?: number;
  /** 当前已下载字节数。 */
  downloadedBytes?: number;
  /** 下载总字节数。 */
  totalBytes?: number;
};

/** 返回当前 runtime 安装状态快照。 */
export function getRuntimeBundleState() {
  return currentState;
}

/** 订阅 runtime 安装状态变化。 */
export function subscribeRuntimeBundleState(listener: RuntimeBundleStateListener) {
  void ensureRuntimeBundleEventBinding();
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/** 首次使用时绑定 Rust 侧 runtime 安装事件。 */
export async function ensureRuntimeBundleEventBinding() {
  if (isRuntimeBundleEventBound) {
    return;
  }
  isRuntimeBundleEventBound = true;
  await listen<RustRuntimeBundlePayload>("lex-vault://runtime-bundle", (event) => {
    applyRustRuntimeBundleState(event.payload);
  });
}

/** 将 Rust 侧状态统一映射为前端稳定状态。 */
function applyRustRuntimeBundleState(payload: RustRuntimeBundlePayload) {
  setRuntimeBundleState(mapRustRuntimeBundleStatus(payload.status), {
    stepCurrent: payload.stepCurrent,
    stepTotal: payload.stepTotal,
    downloadedBytes: payload.downloadedBytes,
    totalBytes: payload.totalBytes,
    errorMessage: payload.status === "failed" ? payload.message : undefined,
    statusText: payload.message || runtimeBundleStatusText(mapRustRuntimeBundleStatus(payload.status)),
  });
}

/** 统一 runtime 安装中文状态文案。 */
function runtimeBundleStatusText(status: AppRuntimeBundleStatus) {
  switch (status) {
    case "required":
      return "需要先下载助手运行时组件";
    case "downloading":
      return "正在下载助手运行时组件";
    case "extracting":
      return "正在解压并安装助手运行时组件";
    case "ready":
      return "助手运行时组件已就绪";
    case "failed":
      return "助手运行时组件准备失败";
    case "idle":
    default:
      return "运行时未开始准备";
  }
}

/** 将 Rust 侧状态翻译成前端稳定状态码。 */
function mapRustRuntimeBundleStatus(status: RustRuntimeBundlePayload["status"]): AppRuntimeBundleStatus {
  switch (status) {
    case "required":
      return "required";
    case "downloading":
      return "downloading";
    case "extracting":
      return "extracting";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

/** 更新当前 runtime 安装状态并通知订阅者。 */
function setRuntimeBundleState(status: AppRuntimeBundleStatus, extra: Partial<AppRuntimeBundleState> = {}) {
  currentState = {
    ...currentState,
    ...extra,
    status,
    statusText: extra.statusText ?? runtimeBundleStatusText(status),
  };
  if (status === "ready") {
    currentState = {
      status: "ready",
      statusText: currentState.statusText,
    };
  }
  listeners.forEach((listener) => listener(currentState));
}
