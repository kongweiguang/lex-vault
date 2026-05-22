import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChatTurnManager } from "@/features/chat/chat-turn-manager";

vi.mock("@/services/dialog-service", () => ({
  showAlert: vi.fn(async () => undefined),
}));

vi.mock("@/services/auth-service", () => ({
  getStoredAuthInfo: vi.fn(async () => ({ accessToken: "token" })),
}));

vi.mock("@/services/codex-service", () => ({
  compactCodexThread: vi.fn(async () => undefined),
  describeCodexInvokeError: vi.fn(() => "error"),
  interruptCodexTurn: vi.fn(async () => undefined),
  resumeCodexThread: vi.fn(async () => ({ id: "thread-existing" })),
  startCodexRuntime: vi.fn(async () => undefined),
  startCodexThread: vi.fn(async () => ({ id: "thread-new" })),
  startLegalTurn: vi.fn(async () => ({ id: "turn-new" })),
}));

vi.mock("@/utils/session", () => ({
  createSessionId: vi.fn(() => "session-created"),
}));

import { showAlert } from "@/services/dialog-service";
import { compactCodexThread, resumeCodexThread, startLegalTurn } from "@/services/codex-service";

describe("chat-turn-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a case conversation from the currently selected case even outside the case tab", async () => {
    const rememberSelectedSession = vi.fn();
    const setActiveNav = vi.fn();

    const manager = createChatTurnManager({
      activeTurnBySessionRef: { current: {} },
      codeProfileId: "profile",
      getActiveCasePath: () => "C:\\workspace",
      getActiveNav: () => "对话",
      getSelectedCasePath: () => "C:\\workspace\\master\\案件A",
      getSelectedCaseSkillName: () => null,
      getSelectedPluginsForSession: () => [],
      getSelectedSessionId: () => "session-current",
      getSessionContexts: () => ({}),
      getThreadBySession: () => ({}),
      getWorkspaceRoot: () => "C:\\workspace",
      interruptedTurnIdsRef: { current: new Set<string>() },
      rememberSelectedSession,
      setActiveNav,
      setLoginPromptSignal: vi.fn(),
      setMessagesBySession: vi.fn(),
      setRunningSessionByThread: vi.fn(),
      setSessionContexts: vi.fn(),
      setStreamingSessionId: vi.fn(),
      setThreadBySession: vi.fn(),
    });

    await manager.createCaseConversation();

    expect(rememberSelectedSession).toHaveBeenCalledWith("session-created", {
      agentType: "case",
      casePath: "C:\\workspace\\master\\案件A",
    });
    expect(setActiveNav).toHaveBeenCalledWith("案件");
    expect(showAlert).not.toHaveBeenCalled();
  });

  it("navigates to the case workspace and shows a prompt when no case is selected", async () => {
    const rememberSelectedSession = vi.fn();
    const setActiveNav = vi.fn();

    const manager = createChatTurnManager({
      activeTurnBySessionRef: { current: {} },
      codeProfileId: "profile",
      getActiveCasePath: () => "C:\\workspace",
      getActiveNav: () => "对话",
      getSelectedCasePath: () => "",
      getSelectedCaseSkillName: () => null,
      getSelectedPluginsForSession: () => [],
      getSelectedSessionId: () => "session-current",
      getSessionContexts: () => ({}),
      getThreadBySession: () => ({}),
      getWorkspaceRoot: () => "C:\\workspace",
      interruptedTurnIdsRef: { current: new Set<string>() },
      rememberSelectedSession,
      setActiveNav,
      setLoginPromptSignal: vi.fn(),
      setMessagesBySession: vi.fn(),
      setRunningSessionByThread: vi.fn(),
      setSessionContexts: vi.fn(),
      setStreamingSessionId: vi.fn(),
      setThreadBySession: vi.fn(),
    });

    await manager.createCaseConversation();

    expect(setActiveNav).toHaveBeenCalledWith("案件");
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: "请先选择案件",
      intent: "warning",
    }));
    expect(rememberSelectedSession).not.toHaveBeenCalled();
  });

  it("keeps user prompt clean when sending a turn", async () => {
    const setMessagesBySession = vi.fn((updater) => updater({}));
    const setSessionContexts = vi.fn((updater) => updater({}));
    const setThreadBySession = vi.fn((updater) => updater({}));
    const setRunningSessionByThread = vi.fn((updater) => updater({}));

    const manager = createChatTurnManager({
      activeTurnBySessionRef: { current: {} },
      codeProfileId: "profile",
      getActiveCasePath: () => "C:\\workspace",
      getActiveNav: () => "对话",
      getSelectedCasePath: () => "",
      getSelectedCaseSkillName: () => null,
      getSelectedPluginsForSession: () => [],
      getSelectedSessionId: () => "session-current",
      getSessionContexts: () => ({}),
      getThreadBySession: () => ({}),
      getWorkspaceRoot: () => "C:\\workspace",
      interruptedTurnIdsRef: { current: new Set<string>() },
      rememberSelectedSession: vi.fn(),
      setActiveNav: vi.fn(),
      setLoginPromptSignal: vi.fn(),
      setMessagesBySession,
      setRunningSessionByThread,
      setSessionContexts,
      setStreamingSessionId: vi.fn(),
      setThreadBySession,
    });

    await manager.handleSend("请整理今日待办", "请整理今日待办");

    expect(startLegalTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: "请整理今日待办",
      }),
    );
    expect(startLegalTurn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        developerInstructions: expect.any(String),
      }),
    );
  });

  it("allows a one-off skill override when sending a turn", async () => {
    const setMessagesBySession = vi.fn((updater) => updater({}));
    const setSessionContexts = vi.fn((updater) => updater({}));
    const setThreadBySession = vi.fn((updater) => updater({}));
    const setRunningSessionByThread = vi.fn((updater) => updater({}));

    const manager = createChatTurnManager({
      activeTurnBySessionRef: { current: {} },
      codeProfileId: "profile",
      getActiveCasePath: () => "C:\\workspace",
      getActiveNav: () => "对话",
      getSelectedCasePath: () => "",
      getSelectedCaseSkillName: () => null,
      getSelectedPluginsForSession: () => [],
      getSelectedSessionId: () => "session-current",
      getSessionContexts: () => ({}),
      getThreadBySession: () => ({}),
      getWorkspaceRoot: () => "C:\\workspace",
      interruptedTurnIdsRef: { current: new Set<string>() },
      rememberSelectedSession: vi.fn(),
      setActiveNav: vi.fn(),
      setLoginPromptSignal: vi.fn(),
      setMessagesBySession,
      setRunningSessionByThread,
      setSessionContexts,
      setStreamingSessionId: vi.fn(),
      setThreadBySession,
    });

    await manager.handleSend("创建一个本地插件", "创建一个本地插件", [], [], {
      skillNameOverride: "plugin-creator",
    });

    expect(startLegalTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        skillName: "plugin-creator",
      }),
    );
  });

  it("compacts the selected existing thread without creating a new user message", async () => {
    const setMessagesBySession = vi.fn((updater) => updater({}));
    const setSessionContexts = vi.fn((updater) => updater({}));
    const setThreadBySession = vi.fn((updater) => updater({ "session-current": "thread-existing" }));
    const setRunningSessionByThread = vi.fn((updater) => updater({}));
    const setStreamingSessionId = vi.fn();

    const manager = createChatTurnManager({
      activeTurnBySessionRef: { current: {} },
      codeProfileId: "profile",
      getActiveCasePath: () => "C:\\workspace",
      getActiveNav: () => "对话",
      getSelectedCasePath: () => "",
      getSelectedCaseSkillName: () => null,
      getSelectedPluginsForSession: () => [],
      getSelectedSessionId: () => "session-current",
      getSessionContexts: () => ({ "session-current": { agentType: "default", casePath: "C:\\workspace" } }),
      getThreadBySession: () => ({ "session-current": "thread-existing" }),
      getWorkspaceRoot: () => "C:\\workspace",
      interruptedTurnIdsRef: { current: new Set<string>() },
      rememberSelectedSession: vi.fn(),
      setActiveNav: vi.fn(),
      setLoginPromptSignal: vi.fn(),
      setMessagesBySession,
      setRunningSessionByThread,
      setSessionContexts,
      setStreamingSessionId,
      setThreadBySession,
    });

    await manager.handleCompactCurrentSession();

    expect(resumeCodexThread).toHaveBeenCalledWith("thread-existing", "C:\\workspace");
    expect(compactCodexThread).toHaveBeenCalledWith({ threadId: "thread-existing" });
    expect(setStreamingSessionId).toHaveBeenCalledWith("session-current");
    expect(setMessagesBySession).not.toHaveBeenCalled();
    expect(startLegalTurn).not.toHaveBeenCalled();
  });
});
