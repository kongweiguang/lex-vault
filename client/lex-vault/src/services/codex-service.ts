import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  CodexApprovalDecision,
  CodexAppError,
  CompactCodexThreadInput,
  CodexOperationResult,
  CodexPluginDetails,
  CodexPluginListResult,
  CodexThreadMemoryMode,
  CodexThreadListResult,
  CodexThreadInfo,
  CodexThreadRecord,
  CodexTurnInfo,
  CodexUiEvent,
  StartLegalTurnInput,
} from "@/types/codex";

/** 启动 Codex app-server runtime。 */
export function startCodexRuntime(profileId: string) {
  return invoke<void>("codex_start_runtime", { profileId });
}

/** 仅准备 Codex runtime 与知识库 graphify 依赖包，供桌面端启动阶段提前检测和下载。 */
export function prepareCodexRuntimeBundle() {
  return invoke<void>("codex_prepare_runtime_bundle");
}

/** 停止 Codex app-server runtime。 */
export function stopCodexRuntime() {
  return invoke<void>("codex_stop_runtime");
}

/** 创建 Codex thread。 */
export function startCodexThread(cwd: string, ephemeral = false) {
  return invoke<CodexThreadInfo>("codex_start_thread", {
    req: { cwd, ephemeral },
  });
}

/** 恢复已有 Codex thread。 */
export function resumeCodexThread(threadId: string, cwd?: string) {
  return invoke<CodexThreadInfo>("codex_resume_thread", {
    req: { threadId, cwd },
  });
}

/** 查询 Codex app-server 原生 thread 历史。 */
export function listCodexThreads(input: { cwd?: string; limit?: number } = {}) {
  return invoke<CodexThreadListResult>("codex_list_threads", {
    req: input,
  });
}

/** 读取 Codex app-server 原生 thread 详情。 */
export function readCodexThread(threadId: string, includeTurns = false) {
  return invoke<CodexThreadRecord>("codex_read_thread", {
    req: { threadId, includeTurns },
  });
}

/** 发起律师助手 turn。 */
export function startLegalTurn(input: StartLegalTurnInput) {
  return invoke<CodexTurnInfo>("codex_start_legal_turn", { req: input });
}

/** 中断正在运行的 Codex turn，保留 app-server runtime。 */
export function interruptCodexTurn(threadId: string, turnId: string) {
  return invoke<void>("codex_interrupt_turn", {
    req: { threadId, turnId },
  });
}

/** 触发单个 Codex thread 的上下文压缩。 */
export function compactCodexThread(input: CompactCodexThreadInput) {
  return invoke<void>("codex_compact_thread", { req: input });
}

/** 显式切换单个 Codex thread 的记忆模式。 */
export function setCodexThreadMemoryMode(threadId: string, mode: CodexThreadMemoryMode) {
  return invoke<void>("codex_set_thread_memory_mode", {
    req: { threadId, mode },
  });
}

/** 清空当前 Codex runtime 的 memory 产物。 */
export function resetCodexMemory() {
  return invoke<void>("codex_reset_memory");
}

/** 回传 Codex 审批决策。 */
export function respondCodexApproval(input: {
  requestId: string;
  decision: CodexApprovalDecision;
  reason?: string;
}) {
  return invoke<void>("codex_respond_approval", { req: input });
}

/** 查询插件市场和插件清单。 */
export function listCodexPlugins() {
  return invoke<CodexPluginListResult>("codex_list_plugins");
}

/** 读取单个插件详情。 */
export function readCodexPlugin(marketplacePath: string, pluginName: string) {
  return invoke<CodexPluginDetails>("codex_read_plugin", {
    req: { marketplacePath, pluginName },
  });
}

/** 安装单个插件。 */
export function installCodexPlugin(marketplacePath: string, pluginName: string) {
  return invoke<CodexOperationResult>("codex_install_plugin", {
    req: { marketplacePath, pluginName },
  });
}

/** 切换单个插件是否启用。 */
export function setCodexPluginEnabled(pluginId: string, enabled: boolean) {
  return invoke<CodexOperationResult>("codex_set_plugin_enabled", {
    req: { pluginId, enabled },
  });
}

/** 卸载单个插件。 */
export function uninstallCodexPlugin(pluginId: string) {
  return invoke<CodexOperationResult>("codex_uninstall_plugin", {
    req: { pluginId },
  });
}

/** 添加远程插件市场。 */
export function addCodexMarketplace(source: string) {
  return invoke<CodexOperationResult>("codex_add_marketplace", {
    req: { source },
  });
}

/** 移除插件市场。 */
export function removeCodexMarketplace(name: string) {
  return invoke<CodexOperationResult>("codex_remove_marketplace", {
    req: { name },
  });
}

/** 升级一个或全部插件市场。 */
export function upgradeCodexMarketplace(marketplaceName?: string) {
  return invoke<CodexOperationResult>("codex_upgrade_marketplace", {
    req: { marketplaceName },
  });
}

/** 监听后端归一化后的 Codex runtime 事件。 */
export function listenCodexEvents(handler: (event: CodexUiEvent) => void) {
  return listen<CodexUiEvent>("codex://event", (event) => {
    handler(event.payload);
  });
}

/** 判断 Tauri invoke reject 的值是否是 Rust 侧序列化出来的 Codex AppError。 */
function isCodexAppError(value: unknown): value is CodexAppError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CodexAppError>;
  return typeof candidate.code === "string"
    && typeof candidate.title === "string"
    && typeof candidate.message === "string";
}

/** 用户可见的统一 Codex 失败提示，避免把底层配置、路径或协议细节暴露给普通用户。 */
export const CODEX_USER_FACING_ERROR_MESSAGE = "小助手出问题了，请联系开发者处理。";

/** 桌面端常见 Codex 错误翻译为用户可直接理解的文案。 */
export function formatCodexUserFacingError(error: CodexAppError) {
  switch (error.code) {
    case "CODEX_AUTH_NOT_FOUND":
      return "当前律隐台账号还没登录，请先到设置页完成登录后再继续。";
    case "WORKSPACE_NOT_FOUND":
    case "WECHAT_WORKSPACE_NOT_READY":
      return "当前还没有可用工作空间，请先在律隐台里选择工作空间。";
    case "TURN_COMPLETION_TIMEOUT":
      return "这次回复生成超时了，请稍后重试。";
    case "PLUGIN_INSTALL_FAILED":
      return "桌面端运行环境初始化失败，请先重启律隐台；如果仍然失败，再联系开发者处理。";
    case "CODEX_RUNTIME_START_FAILED":
    case "APP_SERVER_NOT_RUNNING":
      return "桌面端运行环境还没准备好，请稍后再试。";
    case "TURN_RUNTIME_ERROR":
    case "TURN_START_FAILED":
    case "APP_SERVER_PROTOCOL_ERROR":
      return formatCodexRuntimeLikeError(error);
    default:
      return CODEX_USER_FACING_ERROR_MESSAGE;
  }
}

/** 将结构化 Codex 错误压缩为开发者调试文本，只用于 console 或日志。 */
export function formatCodexDeveloperError(error: CodexAppError) {
  const parts = [error.title, error.message].filter(Boolean);
  const message = parts.join("：");
  return error.code ? `[${error.code}] ${message}` : message;
}

function formatCodexRuntimeLikeError(error: CodexAppError) {
  if (isModelOverloadedError(error)) {
    return "当前模型通道正忙，请稍后再试；如果连续多次出现，可以稍后重试或切换其他模型。";
  }
  if (isQuotaOrRateLimitError(error)) {
    return "当前 AI 套餐额度或调用频率已达上限，请稍后重试或检查套餐状态。";
  }
  if (isAuthenticationError(error)) {
    return "当前 AI 模型认证信息不可用，请检查账号登录状态或模型配置。";
  }
  if (isNetworkError(error)) {
    return "连接 AI 服务时网络异常，本次回复没有成功生成，请稍后重试。";
  }
  return "这次回复执行出错了，请稍后重试或联系开发者查看详情。";
}

function runtimeErrorMessage(error: CodexAppError) {
  const nested = (
    error.details && typeof error.details === "object"
      ? (error.details as { error?: { message?: unknown } }).error?.message
      : undefined
  );
  return typeof nested === "string" && nested.trim() ? nested : error.message;
}

function isModelOverloadedError(error: CodexAppError) {
  const runtimeMessage = runtimeErrorMessage(error);
  const runtimeCode = (
    error.details && typeof error.details === "object"
      ? (error.details as { error?: { codexErrorInfo?: unknown } }).error?.codexErrorInfo
      : undefined
  );
  return containsTextIgnoreCase(runtimeMessage, "Selected model is at capacity")
    || runtimeCode === "serverOverloaded";
}

function isQuotaOrRateLimitError(error: CodexAppError) {
  const patterns = ["429", "rate limit", "quota", "credits", "额度", "频率限制"];
  return containsAnyTextIgnoreCase(runtimeErrorMessage(error), patterns);
}

function isAuthenticationError(error: CodexAppError) {
  const patterns = ["unauthorized", "forbidden", "authentication", "invalid api key", "api key", "401", "403"];
  return containsAnyTextIgnoreCase(runtimeErrorMessage(error), patterns);
}

function isNetworkError(error: CodexAppError) {
  const patterns = ["timed out", "timeout", "network", "connection", "connect", "econn", "socket", "dns", "unreachable"];
  return containsAnyTextIgnoreCase(runtimeErrorMessage(error), patterns);
}

function containsTextIgnoreCase(text: string, pattern: string) {
  return text.toLowerCase().includes(pattern.toLowerCase());
}

function containsAnyTextIgnoreCase(text: string, patterns: string[]) {
  return patterns.some((pattern) => containsTextIgnoreCase(text, pattern));
}

/** 从 Tauri invoke 抛出的 unknown 中提取可读错误，避免丢失 Rust 返回的详细原因。 */
export function describeCodexInvokeError(error: unknown, fallback = CODEX_USER_FACING_ERROR_MESSAGE) {
  if (isCodexAppError(error)) {
    console.error("Codex runtime 调用失败", formatCodexDeveloperError(error), error.details);
    return formatCodexUserFacingError(error);
  }

  if (error instanceof Error && error.message.trim()) {
    console.error("Codex runtime 调用失败", error);
    return CODEX_USER_FACING_ERROR_MESSAGE;
  }

  if (typeof error === "string" && error.trim()) {
    console.error("Codex runtime 调用失败", error);
    return CODEX_USER_FACING_ERROR_MESSAGE;
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; title?: unknown; code?: unknown };
    const message = typeof candidate.message === "string" ? candidate.message : "";
    const title = typeof candidate.title === "string" ? candidate.title : "";
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const body = [title, message].filter(Boolean).join("：");
    if (body) {
      console.error("Codex runtime 调用失败", code ? `[${code}] ${body}` : body, error);
      return fallback;
    }
  }

  console.error("Codex runtime 调用失败", error);
  return fallback;
}
