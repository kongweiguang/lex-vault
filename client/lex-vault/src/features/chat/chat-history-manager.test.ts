import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";

import { createChatHistoryManager } from "@/features/chat/chat-history-manager";
import { listCodexThreads, readCodexThread, startCodexRuntime } from "@/services/codex-service";
import { AGENT_PROCESS_TOOL_NAME } from "@/constants/agent";
import type { CodexThreadRecord } from "@/types/codex";
import type { ChatMessage, ChatSessionSummary, SessionContext } from "@/types/domain";
import { chatMessageToThreadMessage } from "@/utils/chat-mappers";

vi.mock("@/services/codex-service", () => ({
  listCodexThreads: vi.fn(),
  readCodexThread: vi.fn(),
  startCodexRuntime: vi.fn(async () => undefined),
  stopCodexRuntime: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function applyState<T>(value: T, updater: SetStateAction<T>) {
  return typeof updater === "function"
    ? (updater as (current: T) => T)(value)
    : updater;
}

describe("chat-history-manager", () => {
  it("reuses a ready runtime when loading history lists repeatedly", async () => {
    const listRecord: CodexThreadRecord = {
      id: "thr_list",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "普通历史",
      preview: "preview",
      turns: [],
    };
    vi.mocked(listCodexThreads).mockResolvedValue({
      data: [listRecord],
      nextCursor: undefined,
      backwardsCursor: undefined,
    });
    vi.mocked(startCodexRuntime).mockResolvedValue(undefined);

    let messagesBySession: Record<string, ChatMessage[]> = {};
    let sessionContexts: Record<string, SessionContext> = {};
    let threadBySession: Record<string, string> = {};
    let selectedSessionId = "";
    let selectedSessionIdByScope: Record<string, string> = {};
    let loadedChatScopes: Record<string, boolean> = {};
    let historyLoadError: string | null = null;
    let caseHistoryLoadError: string | null = null;
    let sessions: ChatSessionSummary[] = [];
    let caseSessions: ChatSessionSummary[] = [];
    let hydratingHistorySessionId: string | null = null;
    let isHistoryLoading = false;
    let isCaseHistoryLoading = false;

    const manager = createChatHistoryManager({
      codeProfileId: "profile",
      getMessagesBySession: () => messagesBySession,
      getSelectedCasePath: () => "C:\\case",
      getSessionContexts: () => sessionContexts,
      getThreadBySession: () => threadBySession,
      getWorkspaceRoot: () => "C:\\demo",
      setMessagesBySession: ((updater) => {
        messagesBySession = applyState(messagesBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, ChatMessage[]>>>,
      setSessionContexts: ((updater) => {
        sessionContexts = applyState(sessionContexts, updater);
      }) as Dispatch<SetStateAction<Record<string, SessionContext>>>,
      setThreadBySession: ((updater) => {
        threadBySession = applyState(threadBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setSelectedSessionId: ((updater) => {
        selectedSessionId = applyState(selectedSessionId, updater);
      }) as Dispatch<SetStateAction<string>>,
      setSelectedSessionIdByScope: ((updater) => {
        selectedSessionIdByScope = applyState(selectedSessionIdByScope, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setLoadedChatScopes: ((updater) => {
        loadedChatScopes = applyState(loadedChatScopes, updater);
      }) as Dispatch<SetStateAction<Record<string, boolean>>>,
      setHistoryLoadError: ((updater) => {
        historyLoadError = applyState(historyLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setCaseHistoryLoadError: ((updater) => {
        caseHistoryLoadError = applyState(caseHistoryLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setSessions: ((updater) => {
        sessions = applyState(sessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setCaseSessions: ((updater) => {
        caseSessions = applyState(caseSessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setHydratingHistorySessionId: ((updater) => {
        hydratingHistorySessionId = applyState(hydratingHistorySessionId, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setIsHistoryLoading: ((updater) => {
        isHistoryLoading = applyState(isHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
      setIsCaseHistoryLoading: ((updater) => {
        isCaseHistoryLoading = applyState(isCaseHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
    });

    await manager.loadChatHistoryList();
    await manager.loadChatHistoryList();

    expect(startCodexRuntime).toHaveBeenCalledTimes(1);
    expect(listCodexThreads).toHaveBeenCalledTimes(2);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe("thr_list");
    expect(threadBySession).toEqual({ thr_list: "thr_list" });
    expect(loadedChatScopes).toEqual({ "default:C:\\demo": true });
    expect(selectedSessionId).toBe("");
    expect(selectedSessionIdByScope).toEqual({ "default:C:\\demo": "thr_list" });
    expect(caseSessions).toEqual([]);
    expect(hydratingHistorySessionId).toBeNull();
    expect(isHistoryLoading).toBe(false);
    expect(isCaseHistoryLoading).toBe(false);
    expect(historyLoadError).toBeNull();
    expect(caseHistoryLoadError).toBeNull();
  });

  it("keeps the last successful list visible when history refresh fails", async () => {
    vi.mocked(listCodexThreads).mockRejectedValue(new Error("runtime unavailable"));
    vi.mocked(startCodexRuntime).mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let messagesBySession: Record<string, ChatMessage[]> = {};
    let sessionContexts: Record<string, SessionContext> = {};
    let threadBySession: Record<string, string> = { thr_cached: "thr_cached" };
    let selectedSessionId = "";
    let selectedSessionIdByScope: Record<string, string> = {};
    let loadedChatScopes: Record<string, boolean> = {};
    let historyLoadError: string | null = null;
    let caseHistoryLoadError: string | null = null;
    let sessions: ChatSessionSummary[] = [
      {
        id: "thr_cached",
        title: "上次加载的历史",
        preview: "cached",
        time: "10:00",
        agentType: "default",
        casePath: "C:\\demo",
        threadId: "thr_cached",
      },
    ];
    let caseSessions: ChatSessionSummary[] = [];
    let hydratingHistorySessionId: string | null = null;
    let isHistoryLoading = false;
    let isCaseHistoryLoading = false;

    const manager = createChatHistoryManager({
      codeProfileId: "profile",
      getMessagesBySession: () => messagesBySession,
      getSelectedCasePath: () => "C:\\case",
      getSessionContexts: () => sessionContexts,
      getThreadBySession: () => threadBySession,
      getWorkspaceRoot: () => "C:\\demo",
      setMessagesBySession: ((updater) => {
        messagesBySession = applyState(messagesBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, ChatMessage[]>>>,
      setSessionContexts: ((updater) => {
        sessionContexts = applyState(sessionContexts, updater);
      }) as Dispatch<SetStateAction<Record<string, SessionContext>>>,
      setThreadBySession: ((updater) => {
        threadBySession = applyState(threadBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setSelectedSessionId: ((updater) => {
        selectedSessionId = applyState(selectedSessionId, updater);
      }) as Dispatch<SetStateAction<string>>,
      setSelectedSessionIdByScope: ((updater) => {
        selectedSessionIdByScope = applyState(selectedSessionIdByScope, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setLoadedChatScopes: ((updater) => {
        loadedChatScopes = applyState(loadedChatScopes, updater);
      }) as Dispatch<SetStateAction<Record<string, boolean>>>,
      setHistoryLoadError: ((updater) => {
        historyLoadError = applyState(historyLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setCaseHistoryLoadError: ((updater) => {
        caseHistoryLoadError = applyState(caseHistoryLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setSessions: ((updater) => {
        sessions = applyState(sessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setCaseSessions: ((updater) => {
        caseSessions = applyState(caseSessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setHydratingHistorySessionId: ((updater) => {
        hydratingHistorySessionId = applyState(hydratingHistorySessionId, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setIsHistoryLoading: ((updater) => {
        isHistoryLoading = applyState(isHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
      setIsCaseHistoryLoading: ((updater) => {
        isCaseHistoryLoading = applyState(isCaseHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
    });

    try {
      await manager.loadChatHistoryList();

      expect(startCodexRuntime).toHaveBeenCalledTimes(2);
      expect(listCodexThreads).toHaveBeenCalledTimes(2);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe("thr_cached");
      expect(loadedChatScopes).toEqual({});
      expect(historyLoadError).toContain("保留上一次");
      expect(caseHistoryLoadError).toBeNull();
      expect(selectedSessionId).toBe("");
      expect(selectedSessionIdByScope).toEqual({});
      expect(caseSessions).toEqual([]);
      expect(hydratingHistorySessionId).toBeNull();
      expect(isHistoryLoading).toBe(false);
      expect(isCaseHistoryLoading).toBe(false);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("keeps loaded case histories when switching between cases", async () => {
    const caseOneRecord: CodexThreadRecord = {
      id: "thr_case_one",
      cwd: "C:\\case-one",
      ephemeral: false,
      title: "案件一历史",
      preview: "case one",
      turns: [],
    };
    const caseTwoRecord: CodexThreadRecord = {
      id: "thr_case_two",
      cwd: "C:\\case-two",
      ephemeral: false,
      title: "案件二历史",
      preview: "case two",
      turns: [],
    };
    vi.mocked(listCodexThreads)
      .mockResolvedValueOnce({
        data: [caseOneRecord],
        nextCursor: undefined,
        backwardsCursor: undefined,
      })
      .mockResolvedValueOnce({
        data: [caseTwoRecord],
        nextCursor: undefined,
        backwardsCursor: undefined,
      });
    vi.mocked(startCodexRuntime).mockResolvedValue(undefined);

    let selectedCasePath = "C:\\case-one";
    let messagesBySession: Record<string, ChatMessage[]> = {};
    let sessionContexts: Record<string, SessionContext> = {};
    let threadBySession: Record<string, string> = {};
    let selectedSessionId = "";
    let selectedSessionIdByScope: Record<string, string> = {};
    let loadedChatScopes: Record<string, boolean> = {};
    let historyLoadError: string | null = null;
    let caseHistoryLoadError: string | null = null;
    let sessions: ChatSessionSummary[] = [];
    let caseSessions: ChatSessionSummary[] = [];
    let hydratingHistorySessionId: string | null = null;
    let isHistoryLoading = false;
    let isCaseHistoryLoading = false;

    const manager = createChatHistoryManager({
      codeProfileId: "profile",
      getMessagesBySession: () => messagesBySession,
      getSelectedCasePath: () => selectedCasePath,
      getSessionContexts: () => sessionContexts,
      getThreadBySession: () => threadBySession,
      getWorkspaceRoot: () => "C:\\demo",
      setMessagesBySession: ((updater) => {
        messagesBySession = applyState(messagesBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, ChatMessage[]>>>,
      setSessionContexts: ((updater) => {
        sessionContexts = applyState(sessionContexts, updater);
      }) as Dispatch<SetStateAction<Record<string, SessionContext>>>,
      setThreadBySession: ((updater) => {
        threadBySession = applyState(threadBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setSelectedSessionId: ((updater) => {
        selectedSessionId = applyState(selectedSessionId, updater);
      }) as Dispatch<SetStateAction<string>>,
      setSelectedSessionIdByScope: ((updater) => {
        selectedSessionIdByScope = applyState(selectedSessionIdByScope, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setLoadedChatScopes: ((updater) => {
        loadedChatScopes = applyState(loadedChatScopes, updater);
      }) as Dispatch<SetStateAction<Record<string, boolean>>>,
      setHistoryLoadError: ((updater) => {
        historyLoadError = applyState(historyLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setCaseHistoryLoadError: ((updater) => {
        caseHistoryLoadError = applyState(caseHistoryLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setSessions: ((updater) => {
        sessions = applyState(sessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setCaseSessions: ((updater) => {
        caseSessions = applyState(caseSessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setHydratingHistorySessionId: ((updater) => {
        hydratingHistorySessionId = applyState(hydratingHistorySessionId, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setIsHistoryLoading: ((updater) => {
        isHistoryLoading = applyState(isHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
      setIsCaseHistoryLoading: ((updater) => {
        isCaseHistoryLoading = applyState(isCaseHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
    });

    await manager.loadCaseChatHistoryList("C:\\case-one");
    selectedCasePath = "C:\\case-two";
    await manager.loadCaseChatHistoryList("C:\\case-two");

    expect(startCodexRuntime).toHaveBeenCalledTimes(1);
    expect(listCodexThreads).toHaveBeenCalledTimes(2);
    expect(caseSessions.map((session) => session.id).sort()).toEqual(["thr_case_one", "thr_case_two"]);
    expect(caseSessions.find((session) => session.id === "thr_case_one")?.casePath).toBe("C:\\case-one");
    expect(caseSessions.find((session) => session.id === "thr_case_two")?.casePath).toBe("C:\\case-two");
    expect(loadedChatScopes).toEqual({
      "case:C:\\case-one": true,
      "case:C:\\case-two": true,
    });
    expect(threadBySession).toEqual({
      thr_case_one: "thr_case_one",
      thr_case_two: "thr_case_two",
    });
    expect(selectedSessionId).toBe("");
    expect(selectedSessionIdByScope).toEqual({
      "case:C:\\case-one": "thr_case_one",
      "case:C:\\case-two": "thr_case_two",
    });
    expect(sessions).toEqual([]);
    expect(hydratingHistorySessionId).toBeNull();
    expect(isHistoryLoading).toBe(false);
    expect(isCaseHistoryLoading).toBe(false);
    expect(historyLoadError).toBeNull();
    expect(caseHistoryLoadError).toBeNull();
  });

  it("hydrates messages when the session key already exists with an empty array", async () => {
    const record: CodexThreadRecord = {
      id: "thr_history",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "历史会话",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_history",
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_history",
                  type: "userMessage",
                  text: "历史问题",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "assistant_history",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "历史回答",
                },
              },
            ],
          },
        },
      ],
    };
    vi.mocked(readCodexThread).mockResolvedValue(record);
    vi.mocked(startCodexRuntime).mockResolvedValue(undefined);

    let messagesBySession: Record<string, ChatMessage[]> = { thr_history: [] };
    let sessionContexts: Record<string, SessionContext> = {};
    let threadBySession: Record<string, string> = { thr_history: "thr_history" };
    let selectedSessionId = "";
    let selectedSessionIdByScope: Record<string, string> = {};
    let loadedChatScopes: Record<string, boolean> = {};
    let historyLoadError: string | null = null;
    let caseHistoryLoadError: string | null = null;
    let sessions: ChatSessionSummary[] = [];
    let caseSessions: ChatSessionSummary[] = [];
    let hydratingHistorySessionId: string | null = null;
    let isHistoryLoading = false;
    let isCaseHistoryLoading = false;

    const manager = createChatHistoryManager({
      codeProfileId: "profile",
      getMessagesBySession: () => messagesBySession,
      getSelectedCasePath: () => "C:\\case",
      getSessionContexts: () => sessionContexts,
      getThreadBySession: () => threadBySession,
      getWorkspaceRoot: () => "C:\\demo",
      setMessagesBySession: ((updater) => {
        messagesBySession = applyState(messagesBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, ChatMessage[]>>>,
      setSessionContexts: ((updater) => {
        sessionContexts = applyState(sessionContexts, updater);
      }) as Dispatch<SetStateAction<Record<string, SessionContext>>>,
      setThreadBySession: ((updater) => {
        threadBySession = applyState(threadBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setSelectedSessionId: ((updater) => {
        selectedSessionId = applyState(selectedSessionId, updater);
      }) as Dispatch<SetStateAction<string>>,
      setSelectedSessionIdByScope: ((updater) => {
        selectedSessionIdByScope = applyState(selectedSessionIdByScope, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setLoadedChatScopes: ((updater) => {
        loadedChatScopes = applyState(loadedChatScopes, updater);
      }) as Dispatch<SetStateAction<Record<string, boolean>>>,
      setHistoryLoadError: ((updater) => {
        historyLoadError = applyState(historyLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setCaseHistoryLoadError: ((updater) => {
        caseHistoryLoadError = applyState(caseHistoryLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setSessions: ((updater) => {
        sessions = applyState(sessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setCaseSessions: ((updater) => {
        caseSessions = applyState(caseSessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setHydratingHistorySessionId: ((updater) => {
        hydratingHistorySessionId = applyState(hydratingHistorySessionId, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setIsHistoryLoading: ((updater) => {
        isHistoryLoading = applyState(isHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
      setIsCaseHistoryLoading: ((updater) => {
        isCaseHistoryLoading = applyState(isCaseHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
    });

    await manager.loadHistory("thr_history");

    expect(readCodexThread).toHaveBeenCalledWith("thr_history", true);
    expect(messagesBySession.thr_history).toHaveLength(2);
    expect(messagesBySession.thr_history?.[0]?.content).toBe("历史问题");
    expect(messagesBySession.thr_history?.[1]?.content).toBe("历史回答");
    expect(selectedSessionId).toBe("thr_history");
    expect(hydratingHistorySessionId).toBeNull();
    expect(loadedChatScopes).toEqual({});
    expect(sessions).toEqual([]);
    expect(caseSessions).toEqual([]);
    expect(isHistoryLoading).toBe(false);
    expect(isCaseHistoryLoading).toBe(false);
    expect(historyLoadError).toBeNull();
    expect(caseHistoryLoadError).toBeNull();
  });

  it("refreshes cached final-only history so full process items become visible", async () => {
    const record: CodexThreadRecord = {
      id: "thr_process",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "历史会话",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_process",
            items: [
              {
                type: "response_item",
                payload: {
                  id: "msg_process",
                  type: "agentMessage",
                  phase: "commentary",
                  text: "先检查目录",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "tool_process",
                  type: "commandExecution",
                  command: "dir",
                  status: "completed",
                  output: "done",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "assistant_process",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "历史回答",
                },
              },
            ],
          },
        },
      ],
    };
    vi.mocked(readCodexThread).mockResolvedValue(record);
    vi.mocked(startCodexRuntime).mockResolvedValue(undefined);

    let messagesBySession: Record<string, ChatMessage[]> = {
      thr_process: [
        {
          id: "cached-assistant",
          role: "assistant",
          turnId: "turn_process",
          content: "历史回答",
          createdAt: "2026-05-18T10:00:00.000Z",
        },
      ],
    };
    let sessionContexts: Record<string, SessionContext> = {};
    let threadBySession: Record<string, string> = { thr_process: "thr_process" };
    let selectedSessionId = "";
    let selectedSessionIdByScope: Record<string, string> = {};
    let loadedChatScopes: Record<string, boolean> = {};
    let historyLoadError: string | null = null;
    let caseHistoryLoadError: string | null = null;
    let sessions: ChatSessionSummary[] = [];
    let caseSessions: ChatSessionSummary[] = [];
    let hydratingHistorySessionId: string | null = null;
    let isHistoryLoading = false;
    let isCaseHistoryLoading = false;

    const manager = createChatHistoryManager({
      codeProfileId: "profile",
      getMessagesBySession: () => messagesBySession,
      getSelectedCasePath: () => "C:\\case",
      getSessionContexts: () => sessionContexts,
      getThreadBySession: () => threadBySession,
      getWorkspaceRoot: () => "C:\\demo",
      setMessagesBySession: ((updater) => {
        messagesBySession = applyState(messagesBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, ChatMessage[]>>>,
      setSessionContexts: ((updater) => {
        sessionContexts = applyState(sessionContexts, updater);
      }) as Dispatch<SetStateAction<Record<string, SessionContext>>>,
      setThreadBySession: ((updater) => {
        threadBySession = applyState(threadBySession, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setSelectedSessionId: ((updater) => {
        selectedSessionId = applyState(selectedSessionId, updater);
      }) as Dispatch<SetStateAction<string>>,
      setSelectedSessionIdByScope: ((updater) => {
        selectedSessionIdByScope = applyState(selectedSessionIdByScope, updater);
      }) as Dispatch<SetStateAction<Record<string, string>>>,
      setLoadedChatScopes: ((updater) => {
        loadedChatScopes = applyState(loadedChatScopes, updater);
      }) as Dispatch<SetStateAction<Record<string, boolean>>>,
      setHistoryLoadError: ((updater) => {
        historyLoadError = applyState(historyLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setCaseHistoryLoadError: ((updater) => {
        caseHistoryLoadError = applyState(caseHistoryLoadError, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setSessions: ((updater) => {
        sessions = applyState(sessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setCaseSessions: ((updater) => {
        caseSessions = applyState(caseSessions, updater);
      }) as Dispatch<SetStateAction<ChatSessionSummary[]>>,
      setHydratingHistorySessionId: ((updater) => {
        hydratingHistorySessionId = applyState(hydratingHistorySessionId, updater);
      }) as Dispatch<SetStateAction<string | null>>,
      setIsHistoryLoading: ((updater) => {
        isHistoryLoading = applyState(isHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
      setIsCaseHistoryLoading: ((updater) => {
        isCaseHistoryLoading = applyState(isCaseHistoryLoading, updater);
      }) as Dispatch<SetStateAction<boolean>>,
    });

    await manager.loadHistory("thr_process");

    expect(readCodexThread).toHaveBeenCalledWith("thr_process", true);
    expect(messagesBySession.thr_process).toHaveLength(1);
    expect(messagesBySession.thr_process?.[0]?.content).toBe("历史回答");
    expect(messagesBySession.thr_process?.[0]?.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(messagesBySession.thr_process?.[0]?.processItems?.[0]?.text).toBe("先检查目录");
    expect(messagesBySession.thr_process?.[0]?.processItems?.[1]?.toolCall?.command).toBe("dir");
    const threadMessage = chatMessageToThreadMessage(messagesBySession.thr_process?.[0] as ChatMessage, 0, false, "assistant_process");
    const content = threadMessage.content as Array<{
      type: string;
      text?: string;
      toolName?: string;
      args?: { processItems?: Array<{ type: string }> };
    }>;
    expect(content.map((part) => part.type)).toEqual(["tool-call", "text"]);
    expect(content[0]?.toolName).toBe(AGENT_PROCESS_TOOL_NAME);
    expect(content[0]?.args?.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(content[1]?.text).toBe("历史回答");
    expect(selectedSessionId).toBe("thr_process");
    expect(hydratingHistorySessionId).toBeNull();
    expect(loadedChatScopes).toEqual({});
    expect(sessions).toEqual([]);
    expect(caseSessions).toEqual([]);
    expect(isHistoryLoading).toBe(false);
    expect(isCaseHistoryLoading).toBe(false);
    expect(historyLoadError).toBeNull();
    expect(caseHistoryLoadError).toBeNull();
  });
});
