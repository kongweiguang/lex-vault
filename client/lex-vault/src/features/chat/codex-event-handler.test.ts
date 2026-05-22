import { describe, expect, it, vi } from "vitest";

import { createCodexEventHandler } from "@/features/chat/codex-event-handler";
import type { CodexApprovalRequest } from "@/types/codex";
import type { ChatMessage, SessionContext } from "@/types/domain";

type MessagesBySession = Record<string, ChatMessage[]>;
type ApprovalsBySession = Record<string, CodexApprovalRequest[]>;
type SetStateAction<T> = T | ((current: T) => T);

function createStateHarness() {
  let messagesBySession: MessagesBySession = {};
  let pendingApprovalsBySession: ApprovalsBySession = {};
  let streamingSessionId: string | null = null;
  const activeTurnBySessionRef = {
    current: {} as Record<string, { threadId: string; turnId: string }>,
  };
  const interruptedTurnIdsRef = {
    current: new Set<string>(),
  };
  const sessionContextsRef = {
    current: {} as Record<string, SessionContext>,
  };
  const selectedSessionIdRef = {
    current: "session-selected",
  };

  const setMessagesBySession = (updater: SetStateAction<MessagesBySession>) => {
    messagesBySession = typeof updater === "function"
      ? updater(messagesBySession)
      : updater;
  };
  const setPendingApprovalsBySession = (updater: SetStateAction<ApprovalsBySession>) => {
    pendingApprovalsBySession = typeof updater === "function"
      ? updater(pendingApprovalsBySession)
      : updater;
  };
  const setStreamingSessionId = (updater: SetStateAction<string | null>) => {
    streamingSessionId = typeof updater === "function"
      ? updater(streamingSessionId)
      : updater;
  };

  return {
    activeTurnBySessionRef,
    getMessagesBySession: () => messagesBySession,
    interruptedTurnIdsRef,
    selectedSessionIdRef,
    sessionContextsRef,
    setMessagesBySession,
    setPendingApprovalsBySession,
    setStreamingSessionId,
    getPendingApprovalsBySession: () => pendingApprovalsBySession,
    getStreamingSessionId: () => streamingSessionId,
  };
}

describe("codex-event-handler", () => {
  it("refreshes the normal history list when an external thread is updated", () => {
    const state = createStateHarness();
    const loadChatHistoryList = vi.fn(async () => {});
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList,
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn(),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "thread_history_updated",
      threadId: "thread-wechat",
      cwd: "C:\\workspace",
    });

    expect(loadChatHistoryList).toHaveBeenCalledTimes(1);
  });

  it("does not inject a failure bubble when runtime fails before any turn starts", () => {
    const state = createStateHarness();
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn(),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "runtime_failed",
      error: {
        code: "CODEX_RUNTIME_START_FAILED",
        title: "Codex app-server 已退出",
        message: "stdout 已关闭",
        recoverable: true,
      },
    });

    expect(state.getMessagesBySession()).toEqual({});
    expect(state.getStreamingSessionId()).toBeNull();
  });

  it("ignores turn_failed events that do not match an active turn", () => {
    const state = createStateHarness();
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn(),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "turn_failed",
      error: {
        code: "APP_SERVER_PROTOCOL_ERROR",
        title: "app-server 返回错误",
        message: "turn failed",
        recoverable: true,
        details: {
          threadId: "thread-stale",
          turnId: "turn-stale",
        },
      },
    });

    expect(state.getMessagesBySession()).toEqual({});
  });

  it("appends tool output delta into the active assistant tool call", () => {
    const state = createStateHarness();
    state.activeTurnBySessionRef.current.session_1 = {
      threadId: "thread-1",
      turnId: "turn-1",
    };
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn((threadId?: string) => (threadId === "thread-1" ? "session_1" : undefined)),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "tool_started",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        kind: "commandExecution",
        title: "执行命令：dir",
        command: "dir",
      },
    });
    handler({
      type: "tool_delta",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        kind: "commandExecution",
        delta: "line 1\n",
      },
    });
    handler({
      type: "tool_delta",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        kind: "commandExecution",
        delta: "line 2\n",
      },
    });

    const messages = state.getMessagesBySession().session_1 ?? [];
    expect(messages[0]?.toolCalls?.[0]?.outputPreview).toBe("line 1\nline 2\n");
    expect(messages[0]?.processItems?.[0]?.toolCall?.outputPreview).toBe("line 1\nline 2\n");
  });

  it("keeps approval requests in session state instead of opening a blocking dialog", () => {
    const state = createStateHarness();
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn((threadId?: string) => (threadId === "thread-1" ? "session_1" : undefined)),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setPendingApprovalsBySession: state.setPendingApprovalsBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "approval_required",
      request: {
        id: "approval-1",
        threadId: "thread-1",
        operationType: "mcp",
        title: "调用日历工具",
        toolName: "calendar_create_event",
        paths: [],
        riskLevel: "medium",
        reason: "创建日历提醒",
        raw: {},
      },
    });

    expect(state.getPendingApprovalsBySession().session_1?.[0]?.id).toBe("approval-1");

    handler({
      type: "approval_completed",
      requestId: "approval-1",
      decision: "allow_once",
    });

    expect(state.getPendingApprovalsBySession()).toEqual({});
  });

  it("keeps final answer outside process area while commentary and commands stay inside", () => {
    const state = createStateHarness();
    state.activeTurnBySessionRef.current.session_1 = {
      threadId: "thread-1",
      turnId: "turn-1",
    };
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn((threadId?: string) => (threadId === "thread-1" ? "session_1" : undefined)),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "assistant_process_delta",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-a",
        kind: "commentary",
        text: "先检索依据",
      },
    });
    handler({
      type: "tool_started",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-a",
        kind: "commandExecution",
        title: "执行命令：rg",
        command: "rg 竞业限制",
      },
    });
    handler({
      type: "assistant_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-b",
      text: "最终答案",
    });
    handler({
      type: "turn_completed",
      turn: {
        id: "turn-1",
        threadId: "thread-1",
        status: "completed",
      },
    });

    const messages = state.getMessagesBySession().session_1 ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("最终答案");
    expect(messages[0]?.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(messages[0]?.processItems?.[0]?.text).toBe("先检索依据");
    expect(messages[0]?.processItems?.[1]?.toolCall?.command).toBe("rg 竞业限制");
  });

  it("drops duplicated process text when a later final delta reuses the same itemId", () => {
    const state = createStateHarness();
    state.activeTurnBySessionRef.current.session_1 = {
      threadId: "thread-1",
      turnId: "turn-1",
    };
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn((threadId?: string) => (threadId === "thread-1" ? "session_1" : undefined)),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "assistant_process_delta",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-a",
        kind: "commentary",
        text: "最终答案",
      },
    });
    handler({
      type: "assistant_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-a",
      text: "最终答案",
    });
    handler({
      type: "assistant_message_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-a",
      text: "最终答案",
    });

    const messages = state.getMessagesBySession().session_1 ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("最终答案");
    expect(messages[0]?.processItems).toEqual([]);
  });

  it("removes commentary text from the final answer when completion reveals the item phase", () => {
    const state = createStateHarness();
    state.activeTurnBySessionRef.current.session_1 = {
      threadId: "thread-1",
      turnId: "turn-1",
    };
    const handler = createCodexEventHandler({
      activeTurnBySessionRef: state.activeTurnBySessionRef,
      getMessagesBySession: state.getMessagesBySession,
      interruptedTurnIdsRef: state.interruptedTurnIdsRef,
      loadCaseChatHistoryList: vi.fn(async () => {}),
      loadChatHistoryList: vi.fn(async () => {}),
      omitRunningThread: vi.fn(),
      resolveEventSessionId: vi.fn((threadId?: string) => (threadId === "thread-1" ? "session_1" : undefined)),
      selectedSessionIdRef: state.selectedSessionIdRef,
      sessionContextsRef: state.sessionContextsRef,
      setMessagesBySession: state.setMessagesBySession,
      setStreamingSessionId: state.setStreamingSessionId,
    });

    handler({
      type: "assistant_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-commentary",
      text: "先读取材料",
    });
    handler({
      type: "assistant_process_delta",
      item: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-commentary",
        kind: "commentary",
        text: "先读取材料",
        snapshot: true,
      },
    });
    handler({
      type: "assistant_delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "msg-final",
      text: "最终答案",
    });

    const messages = state.getMessagesBySession().session_1 ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("最终答案");
    expect(messages[0]?.processItems?.map((item) => item.text)).toEqual(["先读取材料"]);
  });
});
