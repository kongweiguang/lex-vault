import type { MutableRefObject } from "react";

import {
  appendAssistantDelta,
  appendAssistantToolOutputDelta,
  asRecord,
  codexStatusMessage,
  completeAssistantMessage,
  completeToolMessage,
  finalizeAssistantProcess,
  finalizeLatestAssistantProcess,
  isUserVisibleCodexStatus,
  removeRuntimeStatus,
  upsertAssistantFailure,
  upsertAssistantProcessDelta,
  upsertAssistantStatus,
  upsertAssistantToolCall,
} from "@/features/chat/app-chat-helpers";
import { notifyWhenWindowHidden, notifyWhenWindowInactive } from "@/services/notification-service";
import { formatCodexDeveloperError, formatCodexUserFacingError } from "@/services/codex-service";
import type { CodexApprovalRequest, CodexUiEvent } from "@/types/codex";
import type { ChatMessage, SessionContext } from "@/types/domain";
import { compactText } from "@/utils/chat-mappers";

type MessagesBySession = Record<string, ChatMessage[]>;
type ApprovalsBySession = Record<string, CodexApprovalRequest[]>;

type EventHandlerArgs = {
  activeTurnBySessionRef: MutableRefObject<Record<string, { threadId: string; turnId: string }>>;
  getMessagesBySession: () => MessagesBySession;
  interruptedTurnIdsRef: MutableRefObject<Set<string>>;
  loadCaseChatHistoryList: (casePath: string) => Promise<void>;
  loadChatHistoryList: () => Promise<void>;
  omitRunningThread: (threadId: string) => void;
  resolveEventSessionId: (threadId?: string) => string | undefined;
  selectedSessionIdRef: MutableRefObject<string>;
  sessionContextsRef: MutableRefObject<Record<string, SessionContext>>;
  setMessagesBySession: React.Dispatch<React.SetStateAction<MessagesBySession>>;
  setPendingApprovalsBySession?: React.Dispatch<React.SetStateAction<ApprovalsBySession>>;
  setStreamingSessionId: React.Dispatch<React.SetStateAction<string | null>>;
};

/** 构造 Codex 运行时事件处理器，让 App 只负责注入状态和副作用依赖。 */
export function createCodexEventHandler({
  activeTurnBySessionRef,
  getMessagesBySession,
  interruptedTurnIdsRef,
  loadCaseChatHistoryList,
  loadChatHistoryList,
  omitRunningThread,
  resolveEventSessionId,
  selectedSessionIdRef,
  sessionContextsRef,
  setMessagesBySession,
  setPendingApprovalsBySession = () => undefined,
  setStreamingSessionId,
}: EventHandlerArgs) {
  /** 只把完成或失败事件归到真实进行中的 turn，避免旧 runtime 异常污染当前空白会话。 */
  function findActiveSessionIdByTurn(threadId?: string, turnId?: string) {
    return Object.entries(activeTurnBySessionRef.current).find(([, activeTurn]) =>
      (turnId && activeTurn.turnId === turnId) || (threadId && activeTurn.threadId === threadId),
    )?.[0];
  }

  function removeApprovalsForSession(sessionId?: string) {
    if (!sessionId) {
      return;
    }
    setPendingApprovalsBySession((current) => {
      if (!current[sessionId]?.length) {
        return current;
      }
      const { [sessionId]: _removed, ...rest } = current;
      return rest;
    });
  }

  return (event: CodexUiEvent) => {
    if (event.type === "thread_history_updated") {
      void loadChatHistoryList();
      return;
    }

    if (event.type === "turn_started") {
      const sessionId = resolveEventSessionId(event.turn.threadId);
      if (sessionId && event.turn.id) {
        activeTurnBySessionRef.current[sessionId] = {
          threadId: event.turn.threadId,
          turnId: event.turn.id,
        };
      }
      return;
    }

    if (event.type === "assistant_delta") {
      if (event.turnId && interruptedTurnIdsRef.current.has(event.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.threadId);
        if (!sessionId) {
          return current;
        }
        const messages = removeRuntimeStatus(current[sessionId] ?? []);
        return {
          ...current,
          [sessionId]: appendAssistantDelta(messages, event.turnId, event.itemId, event.text),
        };
      });
      return;
    }

    if (event.type === "assistant_process_delta") {
      if (event.item.turnId && interruptedTurnIdsRef.current.has(event.item.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.item.threadId);
        if (!sessionId) {
          return current;
        }
        return {
          ...current,
          [sessionId]: upsertAssistantProcessDelta(
            current[sessionId] ?? [],
            event.item.turnId,
            event.item.kind,
            event.item.text,
            {
              itemId: event.item.itemId,
              segmentKey: event.item.segmentKey,
              promotableAnswer: event.item.promotableAnswer,
              snapshot: event.item.snapshot,
            },
          ),
        };
      });
      return;
    }

    if (event.type === "assistant_message_completed") {
      if (event.turnId && interruptedTurnIdsRef.current.has(event.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.threadId);
        if (!sessionId) {
          return current;
        }
        return {
          ...current,
          [sessionId]: completeAssistantMessage(current[sessionId] ?? [], event.turnId, event.itemId, event.text),
        };
      });
      return;
    }

    if (event.type === "tool_started") {
      if (interruptedTurnIdsRef.current.has(event.item.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.item.threadId);
        if (!sessionId) {
          return current;
        }
        return {
          ...current,
          [sessionId]: upsertAssistantToolCall(current[sessionId] ?? [], event.item),
        };
      });
      return;
    }

    if (event.type === "tool_delta") {
      if (interruptedTurnIdsRef.current.has(event.item.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.item.threadId);
        if (!sessionId) {
          return current;
        }
        return {
          ...current,
          [sessionId]: appendAssistantToolOutputDelta(current[sessionId] ?? [], event.item),
        };
      });
      return;
    }

    if (event.type === "tool_completed") {
      if (interruptedTurnIdsRef.current.has(event.item.turnId)) {
        return;
      }
      setMessagesBySession((current) => {
        const sessionId = resolveEventSessionId(event.item.threadId);
        if (!sessionId) {
          return current;
        }
        const messages = current[sessionId] ?? [];
        return {
          ...current,
          [sessionId]: completeToolMessage(messages, event.item),
        };
      });
      return;
    }

    if (event.type === "turn_completed" || event.type === "turn_failed") {
      setStreamingSessionId(null);
      if (event.type === "turn_completed") {
        const completedSessionId = findActiveSessionIdByTurn(event.turn.threadId, event.turn.id);
        if (!completedSessionId) {
          return;
        }
        if (completedSessionId) {
          delete activeTurnBySessionRef.current[completedSessionId];
        }
        removeApprovalsForSession(completedSessionId);
        const completedMessages = completedSessionId
          ? getMessagesBySession()[completedSessionId] ?? []
          : [];
        const lastAssistantMessage = [...completedMessages].reverse().find((message) => message.role === "assistant");
        setMessagesBySession((current) => {
          const sessionId = completedSessionId;
          if (!sessionId) {
            return current;
          }
          return {
            ...current,
            [sessionId]: finalizeAssistantProcess(current[sessionId] ?? [], event.turn.id),
          };
        });
        omitRunningThread(event.turn.threadId);
        interruptedTurnIdsRef.current.delete(event.turn.id);
        const context = completedSessionId ? sessionContextsRef.current[completedSessionId] : undefined;
        void notifyWhenWindowInactive({
          kind: "turn-completed",
          title: context?.agentType === "case" ? "案件对话已完成" : "对话已完成",
          body: compactText(lastAssistantMessage?.content || "小隐已完成本轮回复。"),
        });
        const scheduleHistoryRefresh =
          typeof window === "undefined" ? globalThis.setTimeout : window.setTimeout.bind(window);
        scheduleHistoryRefresh(() => {
          if (context?.agentType === "case") {
            void loadCaseChatHistoryList(context.casePath);
          } else {
            void loadChatHistoryList();
          }
        }, 300);
      }
      if (event.type === "turn_failed") {
        console.error("Codex turn 执行失败", formatCodexDeveloperError(event.error), event.error.details);
        const errorDetails = asRecord(event.error.details);
        const failedThreadId = typeof errorDetails?.threadId === "string" ? errorDetails.threadId : undefined;
        const failedTurnId = typeof errorDetails?.turnId === "string" ? errorDetails.turnId : undefined;
        const failedSessionId = findActiveSessionIdByTurn(failedThreadId, failedTurnId);
        if (!failedSessionId) {
          return;
        }
        if (failedSessionId) {
          delete activeTurnBySessionRef.current[failedSessionId];
        }
        removeApprovalsForSession(failedSessionId);
        if (failedTurnId && interruptedTurnIdsRef.current.has(failedTurnId)) {
          interruptedTurnIdsRef.current.delete(failedTurnId);
          return;
        }
        setMessagesBySession((current) => {
          const messages = current[failedSessionId] ?? [];
          const finalizedMessages = failedTurnId
            ? finalizeAssistantProcess(messages, failedTurnId)
            : finalizeLatestAssistantProcess(messages);
          return {
            ...current,
            [failedSessionId]: upsertAssistantFailure(
              finalizedMessages,
              failedTurnId,
              formatCodexUserFacingError(event.error),
            ),
          };
        });
      }
      return;
    }

    if (event.type === "runtime_failed") {
      console.error("Codex runtime 失败", formatCodexDeveloperError(event.error), event.error.details);
      setStreamingSessionId(null);
      const activeSessions = Object.entries(activeTurnBySessionRef.current);
      if (activeSessions.length === 0) {
        return;
      }
      setMessagesBySession((current) => {
        const next = { ...current };
        activeSessions.forEach(([sessionId, activeTurn]) => {
          next[sessionId] = upsertAssistantFailure(
            current[sessionId] ?? [],
            activeTurn.turnId,
            formatCodexUserFacingError(event.error),
          );
        });
        return next;
      });
      activeTurnBySessionRef.current = {};
      setPendingApprovalsBySession({});
      return;
    }

    if (event.type === "warning") {
      if (isUserVisibleCodexStatus(event.message)) {
        const sessionId = selectedSessionIdRef.current;
        const activeTurnId = activeTurnBySessionRef.current[sessionId]?.turnId;
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: upsertAssistantStatus(current[sessionId] ?? [], activeTurnId, codexStatusMessage(event.message)),
        }));
      }
      return;
    }

    if (event.type === "approval_required") {
      const sessionId = resolveEventSessionId(event.request.threadId);
      if (sessionId) {
        setPendingApprovalsBySession((current) => {
          const approvals = current[sessionId] ?? [];
          if (approvals.some((approval) => approval.id === event.request.id)) {
            return current;
          }
          return {
            ...current,
            [sessionId]: [...approvals, event.request],
          };
        });
      }
      void notifyWhenWindowHidden({
        kind: "approval-required",
        title: "Lex Vault 需要你的确认",
        body: event.request.title,
      });
      return;
    }

    if (event.type === "approval_completed") {
      setPendingApprovalsBySession((current) => {
        let changed = false;
        const next: ApprovalsBySession = {};
        Object.entries(current).forEach(([sessionId, approvals]) => {
          const filtered = approvals.filter((approval) => approval.id !== event.requestId);
          if (filtered.length !== approvals.length) {
            changed = true;
          }
          if (filtered.length) {
            next[sessionId] = filtered;
          }
        });
        return changed ? next : current;
      });
    }
  };
}
