import type { Dispatch, SetStateAction } from "react";

import {
  chatScopeKey,
  codexThreadContext,
  codexThreadToMessages,
  codexThreadToSummary,
} from "@/features/chat/app-chat-helpers";
import { listCodexThreads, readCodexThread, startCodexRuntime, stopCodexRuntime } from "@/services/codex-service";
import type { CodexThreadRecord } from "@/types/codex";
import type { ChatMessage, ChatSessionSummary, SessionContext } from "@/types/domain";

type MessagesBySession = Record<string, ChatMessage[]>;

type CreateChatHistoryManagerArgs = {
  codeProfileId: string;
  getMessagesBySession: () => MessagesBySession;
  getSessionContexts: () => Record<string, SessionContext>;
  getThreadBySession: () => Record<string, string>;
  getWorkspaceRoot: () => string;
  getSelectedCasePath: () => string;
  setHydratingHistorySessionId: Dispatch<SetStateAction<string | null>>;
  setMessagesBySession: Dispatch<SetStateAction<MessagesBySession>>;
  setSessionContexts: Dispatch<SetStateAction<Record<string, SessionContext>>>;
  setThreadBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedSessionId: Dispatch<SetStateAction<string>>;
  setSelectedSessionIdByScope: Dispatch<SetStateAction<Record<string, string>>>;
  setLoadedChatScopes: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryLoadError: Dispatch<SetStateAction<string | null>>;
  setCaseHistoryLoadError: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setCaseSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setIsHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setIsCaseHistoryLoading: Dispatch<SetStateAction<boolean>>;
};

const HISTORY_LOAD_ERROR_MESSAGE = "历史会话暂时没加载出来，已保留上一次成功加载的列表。";

/** 构造聊天历史管理器，统一承接 thread 列表、详情回填和会话作用域记忆。 */
export function createChatHistoryManager({
  codeProfileId,
  getSelectedCasePath,
  getSessionContexts,
  getThreadBySession,
  getWorkspaceRoot,
  setHydratingHistorySessionId,
  setMessagesBySession,
  setSessionContexts,
  setThreadBySession,
  setSelectedSessionId,
  setSelectedSessionIdByScope,
  setLoadedChatScopes,
  setHistoryLoadError,
  setCaseHistoryLoadError,
  setSessions,
  setCaseSessions,
  setIsHistoryLoading,
  setIsCaseHistoryLoading,
}: CreateChatHistoryManagerArgs) {
  /** 记录历史链路最近一次已确认可用的 runtime，避免每次读列表都重复触发重量级启动检查。 */
  let historyRuntimeReady = false;
  /** 普通历史列表请求序号，用于避免慢返回覆盖新列表。 */
  let chatHistoryListRequestSeq = 0;
  /** 案件历史列表请求序号，用于避免切换案件后的旧请求覆盖新列表。 */
  let caseHistoryListRequestSeq = 0;

  /** 统一输出历史加载耗时，方便在控制台定位是读 thread 慢还是前端解析慢。 */
  function logHistoryTiming(stage: string, payload: Record<string, unknown>) {
    console.info("[history-perf]", stage, payload);
  }

  /** 只在历史链路尚未确认 runtime 可用时才主动预热；后续直接复用已就绪 runtime。 */
  async function ensureHistoryRuntimeReady() {
    if (historyRuntimeReady) {
      return;
    }
    await startCodexRuntime(codeProfileId);
    historyRuntimeReady = true;
  }

  /** 历史读取遇到旧 runtime 残留或首轮初始化抖动时，自动重启一次后重试。 */
  async function withRuntimeRetry<T>(action: () => Promise<T>) {
    const startedAt = performance.now();
    try {
      await ensureHistoryRuntimeReady();
      const result = await action();
      logHistoryTiming("runtime-ready", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      console.warn("Codex 历史读取首次失败，尝试重启 runtime 后重试", error);
      historyRuntimeReady = false;
      await stopCodexRuntime().catch((stopError) => {
        console.warn("历史读取恢复前停止旧 runtime 失败，继续尝试重新启动", stopError);
      });
      await ensureHistoryRuntimeReady();
      try {
        const result = await action();
        logHistoryTiming("runtime-retried", {
          durationMs: Math.round(performance.now() - startedAt),
        });
        return result;
      } catch (retryError) {
        historyRuntimeReady = false;
        throw retryError;
      }
    }
  }

  function rememberSelectedSession(sessionId: string, context: SessionContext) {
    const scopeKey = chatScopeKey(context);
    setSelectedSessionId(sessionId);
    setSelectedSessionIdByScope((current) => ({ ...current, [scopeKey]: sessionId }));
    setSessionContexts((current) => ({ ...current, [sessionId]: context }));
  }

  function mergeCodexThreads(records: CodexThreadRecord[], fallbackContext: SessionContext, includeMessages = false) {
    setMessagesBySession((current) => {
      const next = { ...current };
      records.forEach((record) => {
        const messages = codexThreadToMessages(record);
        if (includeMessages && messages.length > 0) {
          next[record.id] = messages;
        }
      });
      return next;
    });
    setSessionContexts((current) => {
      const next = { ...current };
      records.forEach((record) => {
        next[record.id] = codexThreadContext(record, fallbackContext.agentType, fallbackContext.casePath);
      });
      return next;
    });
    setThreadBySession((current) => {
      const next = { ...current };
      records.forEach((record) => {
        next[record.id] = record.id;
      });
      return next;
    });
    setSelectedSessionIdByScope((current) => {
      const next = { ...current };
      records.forEach((record) => {
        const scopeKey = chatScopeKey(codexThreadContext(record, fallbackContext.agentType, fallbackContext.casePath));
        next[scopeKey] ??= record.id;
      });
      return next;
    });
  }

  async function loadChatHistoryList() {
    const workspaceRoot = getWorkspaceRoot();
    const scopeKey = chatScopeKey({ agentType: "default", casePath: workspaceRoot });
    const requestSeq = ++chatHistoryListRequestSeq;
    setIsHistoryLoading(true);
    setHistoryLoadError(null);
    try {
      const startedAt = performance.now();
      const result = await withRuntimeRetry(() => listCodexThreads({ cwd: workspaceRoot }));
      if (requestSeq !== chatHistoryListRequestSeq || workspaceRoot !== getWorkspaceRoot()) {
        return;
      }
      const context = { agentType: "default", casePath: workspaceRoot } as const;
      setSessions(result.data.map((record) => codexThreadToSummary(record, context)));
      mergeCodexThreads(result.data, context);
      setLoadedChatScopes((current) => ({ ...current, [scopeKey]: true }));
      logHistoryTiming("list-default", {
        scope: workspaceRoot,
        count: result.data.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (requestSeq === chatHistoryListRequestSeq && workspaceRoot === getWorkspaceRoot()) {
        console.error("加载 Codex 普通历史失败", error);
        setHistoryLoadError(HISTORY_LOAD_ERROR_MESSAGE);
      }
    } finally {
      if (requestSeq === chatHistoryListRequestSeq) {
        setIsHistoryLoading(false);
      }
    }
  }

  async function loadCaseChatHistoryList(casePath: string) {
    const scopeKey = chatScopeKey({ agentType: "case", casePath });
    const requestSeq = ++caseHistoryListRequestSeq;
    setIsCaseHistoryLoading(true);
    setCaseHistoryLoadError(null);
    try {
      const startedAt = performance.now();
      const result = await withRuntimeRetry(() => listCodexThreads({ cwd: casePath }));
      if (requestSeq !== caseHistoryListRequestSeq || casePath !== getSelectedCasePath()) {
        return;
      }
      const context = { agentType: "case", casePath } as const;
      const nextCaseSessions = result.data.map((record) => codexThreadToSummary(record, context));
      setCaseSessions((current) => [
        ...current.filter((session) => session.casePath !== casePath),
        ...nextCaseSessions,
      ]);
      mergeCodexThreads(result.data, context);
      setLoadedChatScopes((current) => ({ ...current, [scopeKey]: true }));
      logHistoryTiming("list-case", {
        scope: casePath,
        count: result.data.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (requestSeq === caseHistoryListRequestSeq && casePath === getSelectedCasePath()) {
        console.error("加载 Codex 案件历史失败", error);
        setCaseHistoryLoadError(HISTORY_LOAD_ERROR_MESSAGE);
      }
    } finally {
      if (requestSeq === caseHistoryListRequestSeq) {
        setIsCaseHistoryLoading(false);
      }
    }
  }

  async function hydrateCodexThread(sessionId: string, fallbackContext: SessionContext) {
    try {
      const threadId = getThreadBySession()[sessionId] ?? sessionId;
      const readStartedAt = performance.now();
      const record = await withRuntimeRetry(() => readCodexThread(threadId, true));
      const readCompletedAt = performance.now();
      mergeCodexThreads([record], fallbackContext, true);
      logHistoryTiming("hydrate-thread", {
        sessionId,
        threadId,
        turnCount: record.turns.length,
        readDurationMs: Math.round(readCompletedAt - readStartedAt),
        parseDurationMs: Math.round(performance.now() - readCompletedAt),
        totalDurationMs: Math.round(performance.now() - readStartedAt),
      });
      return record;
    } catch (error) {
      console.error("加载 Codex thread 详情失败", error);
      return null;
    }
  }

  async function loadHistory(sessionId: string) {
    const workspaceRoot = getWorkspaceRoot();
    const fallbackContext = getSessionContexts()[sessionId] ?? { agentType: "default", casePath: workspaceRoot };
    rememberSelectedSession(sessionId, fallbackContext);
    setHydratingHistorySessionId(sessionId);
    const startedAt = performance.now();
    try {
      const record = await hydrateCodexThread(sessionId, fallbackContext);
      const context = record ? codexThreadContext(record, "default", workspaceRoot) : fallbackContext;
      rememberSelectedSession(sessionId, context);
    } finally {
      setHydratingHistorySessionId((current) => (current === sessionId ? null : current));
      logHistoryTiming("select-default", {
        sessionId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  async function loadCaseHistory(sessionId: string) {
    const selectedCasePath = getSelectedCasePath();
    const fallbackContext = getSessionContexts()[sessionId] ?? { agentType: "case", casePath: selectedCasePath };
    rememberSelectedSession(sessionId, fallbackContext);
    setHydratingHistorySessionId(sessionId);
    const startedAt = performance.now();
    try {
      const record = await hydrateCodexThread(sessionId, fallbackContext);
      const context = record ? codexThreadContext(record, "case", selectedCasePath) : fallbackContext;
      rememberSelectedSession(sessionId, context);
    } finally {
      setHydratingHistorySessionId((current) => (current === sessionId ? null : current));
      logHistoryTiming("select-case", {
        sessionId,
        casePath: selectedCasePath,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  return {
    hydrateCodexThread,
    loadCaseChatHistoryList,
    loadCaseHistory,
    loadChatHistoryList,
    loadHistory,
    rememberSelectedSession,
  };
}
