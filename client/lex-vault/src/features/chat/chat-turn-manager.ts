import type { MutableRefObject } from "react";

import {
  finalizeLatestAssistantProcess,
  upsertAssistantFailure,
} from "@/features/chat/app-chat-helpers";
import { showAlert } from "@/services/dialog-service";
import { getStoredAuthInfo } from "@/services/auth-service";
import {
  compactCodexThread,
  describeCodexInvokeError,
  interruptCodexTurn,
  resumeCodexThread,
  startCodexRuntime,
  startCodexThread,
  startLegalTurn,
} from "@/services/codex-service";
import type { CodexTurnAttachmentInput } from "@/types/codex";
import type {
  ChatAttachment,
  ChatMessage,
  ChatPluginOption,
  NavKey,
  SessionContext,
} from "@/types/domain";
import { createSessionId } from "@/utils/session";

type ActiveTurnRecord = Record<string, { threadId: string; turnId: string }>;

type CreateChatTurnManagerArgs = {
  /** Codex runtime profile ID。 */
  codeProfileId: string;
  /** 当前左侧导航页签。 */
  getActiveNav: () => NavKey;
  /** 当前聊天作用域对应的路径。 */
  getActiveCasePath: () => string;
  /** 当前选中的案件目录，不受左侧导航是否停留在案件页影响。 */
  getSelectedCasePath: () => string;
  /** 当前选中的案件专项技能。 */
  getSelectedCaseSkillName: () => string | null;
  /** 当前会话已选中的插件。 */
  getSelectedPluginsForSession: (sessionId: string) => ChatPluginOption[];
  /** 当前选中的会话 ID。 */
  getSelectedSessionId: () => string;
  /** 读取会话上下文。 */
  getSessionContexts: () => Record<string, SessionContext>;
  /** 读取会话到 thread 的映射。 */
  getThreadBySession: () => Record<string, string>;
  /** 读取当前工作区根目录。 */
  getWorkspaceRoot: () => string;
  /** 记住当前作用域下的新会话。 */
  rememberSelectedSession: (sessionId: string, context: SessionContext) => void;
  /** 切到指定导航页签。 */
  setActiveNav: (nav: NavKey) => void;
  /** 触发登录提醒信号。 */
  setLoginPromptSignal: (updater: (current: number) => number) => void;
  /** 写入会话消息列表。 */
  setMessagesBySession: (updater: (current: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) => void;
  /** 写入运行中 thread 对应的会话映射。 */
  setRunningSessionByThread: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  /** 写入会话上下文。 */
  setSessionContexts: (updater: (current: Record<string, SessionContext>) => Record<string, SessionContext>) => void;
  /** 写入当前流式输出中的会话 ID。 */
  setStreamingSessionId: (sessionId: string | null) => void;
  /** 写入会话到 thread 的映射。 */
  setThreadBySession: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  /** 当前运行 turn 跟踪表。 */
  activeTurnBySessionRef: MutableRefObject<ActiveTurnRecord>;
  /** 已被用户主动中断的 turn 集合。 */
  interruptedTurnIdsRef: MutableRefObject<Set<string>>;
};

type SendChatTurnOptions = {
  /** 是否先把用户消息写入前端消息列表。 */
  appendUserMessage?: boolean;
  /** 显式覆盖当前发送所使用的会话上下文。 */
  contextOverride?: SessionContext;
  /** 显式覆盖当前发送所使用的 skill。 */
  skillNameOverride?: string;
  /** 显式覆盖当前发送所使用的插件 mention 列表。 */
  pluginMentionsOverride?: ChatPluginOption[];
};

/**
 * 统一封装会话创建、发送和中断逻辑，避免主应用壳继续承接 Codex turn 编排细节。
 */
export function createChatTurnManager({
  activeTurnBySessionRef,
  codeProfileId,
  getActiveCasePath,
  getActiveNav,
  getSelectedCasePath,
  getSelectedCaseSkillName,
  getSelectedPluginsForSession,
  getSelectedSessionId,
  getSessionContexts,
  getThreadBySession,
  getWorkspaceRoot,
  interruptedTurnIdsRef,
  rememberSelectedSession,
  setActiveNav,
  setLoginPromptSignal,
  setMessagesBySession,
  setRunningSessionByThread,
  setSessionContexts,
  setStreamingSessionId,
  setThreadBySession,
}: CreateChatTurnManagerArgs) {
  /** 新建普通对话，并把作用域绑定到当前工作区。 */
  function createConversation() {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      setActiveNav("设置");
      return;
    }

    const nextSessionId = createSessionId();
    rememberSelectedSession(nextSessionId, { agentType: "default", casePath: workspaceRoot });
    setActiveNav("对话");
  }

  /** 新建案件对话，并沿用当前选中的案件目录作为工作路径。 */
  async function createCaseConversation() {
    const selectedCasePath = getSelectedCasePath();
    if (!selectedCasePath) {
      setActiveNav("案件");
      await showAlert({
        title: "请先选择案件",
        message: "案件会话需要绑定到一个具体案件后才能创建。",
        description: "先在案件页左侧选中一个案件，再继续新建案件会话即可。",
        confirmText: "我知道了",
        intent: "warning",
      });
      return;
    }

    const nextSessionId = createSessionId();
    rememberSelectedSession(nextSessionId, { agentType: "case", casePath: selectedCasePath });
    setActiveNav("案件");
  }

  /** 发送当前输入，必要时自动恢复 thread 或新建 thread。 */
  async function handleSendToSession(
    sessionId: string,
    prompt: string,
    visiblePrompt = prompt,
    attachments: ChatAttachment[] = [],
    inputAttachments: CodexTurnAttachmentInput[] = [],
    options: SendChatTurnOptions = {},
  ) {
    const auth = await getStoredAuthInfo().catch(() => null);
    if (!auth?.accessToken?.trim()) {
      setActiveNav("设置");
      setLoginPromptSignal((current) => current + 1);
      return;
    }

    const activeNav = getActiveNav();
    const activeCasePath = getActiveCasePath();
    const workspaceRoot = getWorkspaceRoot();
    const sessionContexts = getSessionContexts();
    const threadBySession = getThreadBySession();
    const context = options.contextOverride ?? sessionContexts[sessionId] ?? {
      agentType: activeNav === "案件" ? "case" : "default",
      casePath: activeCasePath,
    };
    const skillName = options.skillNameOverride
      ?? (context.agentType === "case" ? getSelectedCaseSkillName() : null);
    const pluginMentions = (options.pluginMentionsOverride ?? getSelectedPluginsForSession(sessionId)).map((plugin) => ({
      name: plugin.name,
      path: plugin.mentionPath,
    }));

    if (options.appendUserMessage !== false) {
      const createdAt = new Date().toISOString();
      setMessagesBySession((current) => ({
        ...current,
        [sessionId]: [
          ...(current[sessionId] ?? []),
          {
            id: `user-${Date.now()}`,
            role: "user",
            content: visiblePrompt,
            attachments,
            createdAt,
          },
        ],
      }));
    }
    setStreamingSessionId(sessionId);

    try {
      setSessionContexts((current) => ({ ...current, [sessionId]: context }));
      const cwd = context.casePath || workspaceRoot;
      await startCodexRuntime(codeProfileId);
      const existingThreadId = threadBySession[sessionId];
      const threadId = existingThreadId
        ? await resumeCodexThread(existingThreadId, cwd)
            .then((thread) => thread.id)
            .catch(async (error) => {
              console.warn("恢复 Codex thread 失败，改为创建新 thread", error);
              return (await startCodexThread(cwd, false)).id;
            })
        : (await startCodexThread(cwd, false)).id;
      setThreadBySession((current) => ({ ...current, [sessionId]: threadId }));
      setRunningSessionByThread((current) => ({ ...current, [threadId]: sessionId }));
      const turn = await startLegalTurn({
        threadId,
        cwd,
        userPrompt: prompt,
        attachments: inputAttachments,
        skillName: skillName ?? undefined,
        pluginMentions,
      });
      activeTurnBySessionRef.current[sessionId] = {
        threadId,
        turnId: turn.id,
      };
    } catch (error) {
      setStreamingSessionId(null);
      setMessagesBySession((current) => ({
        ...current,
        [sessionId]: upsertAssistantFailure(
          current[sessionId] ?? [],
          activeTurnBySessionRef.current[sessionId]?.turnId,
          describeCodexInvokeError(error),
        ),
      }));
    }
  }

  /** 发送当前输入，必要时自动恢复 thread 或新建 thread。 */
  async function handleSend(
    prompt: string,
    visiblePrompt = prompt,
    attachments: ChatAttachment[] = [],
    inputAttachments: CodexTurnAttachmentInput[] = [],
    options: SendChatTurnOptions = {},
  ) {
    const sessionId = getSelectedSessionId();
    await handleSendToSession(sessionId, prompt, visiblePrompt, attachments, inputAttachments, options);
  }

  /** 中断当前 turn，并把前端过程态收口到可读的完成状态。 */
  async function handleCancelTurn() {
    const sessionId = getSelectedSessionId();
    const activeTurn = activeTurnBySessionRef.current[sessionId];
    setStreamingSessionId(null);
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: finalizeLatestAssistantProcess(current[sessionId] ?? []),
    }));

    if (!activeTurn?.turnId || !activeTurn.threadId) {
      return;
    }

    interruptedTurnIdsRef.current.add(activeTurn.turnId);
    try {
      await interruptCodexTurn(activeTurn.threadId, activeTurn.turnId);
    } catch (error) {
      interruptedTurnIdsRef.current.delete(activeTurn.turnId);
      setMessagesBySession((current) => ({
        ...current,
        [sessionId]: upsertAssistantFailure(current[sessionId] ?? [], activeTurn.turnId, describeCodexInvokeError(error)),
      }));
    }
  }

  /** 对当前已有 thread 发起 app-server 原生上下文压缩。 */
  async function handleCompactCurrentSession() {
    const sessionId = getSelectedSessionId();
    const threadId = getThreadBySession()[sessionId];
    if (!threadId) {
      await showAlert({
        title: "暂无可压缩上下文",
        message: "当前会话还没有生成过上下文，先发送一轮问题后再压缩即可。",
        confirmText: "我知道了",
        intent: "warning",
      });
      return;
    }

    const auth = await getStoredAuthInfo().catch(() => null);
    if (!auth?.accessToken?.trim()) {
      setActiveNav("设置");
      setLoginPromptSignal((current) => current + 1);
      return;
    }

    const context = getSessionContexts()[sessionId] ?? {
      agentType: getActiveNav() === "案件" ? "case" : "default",
      casePath: getActiveCasePath(),
    };
    const cwd = context.casePath || getWorkspaceRoot();
    setStreamingSessionId(sessionId);

    try {
      setSessionContexts((current) => ({ ...current, [sessionId]: context }));
      await startCodexRuntime(codeProfileId);
      const resumedThread = await resumeCodexThread(threadId, cwd);
      setThreadBySession((current) => ({ ...current, [sessionId]: resumedThread.id }));
      setRunningSessionByThread((current) => ({ ...current, [resumedThread.id]: sessionId }));
      await compactCodexThread({ threadId: resumedThread.id });
    } catch (error) {
      setStreamingSessionId(null);
      setMessagesBySession((current) => ({
        ...current,
        [sessionId]: upsertAssistantFailure(
          current[sessionId] ?? [],
          activeTurnBySessionRef.current[sessionId]?.turnId,
          describeCodexInvokeError(error),
        ),
      }));
    }
  }

  return {
    createCaseConversation,
    createConversation,
    handleCompactCurrentSession,
    handleCancelTurn,
    handleSend,
    handleSendToSession,
  };
}
