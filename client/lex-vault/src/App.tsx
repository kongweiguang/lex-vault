import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, Download, FileText, Gavel, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FileImportProgressDialog } from "@/components/files/FileImportProgressDialog";
import { AppDialogHost } from "@/components/ui/AppDialogHost";
import { Sidebar } from "@/components/layout/Sidebar";
import { FilePreviewPanel, type PreviewTarget } from "@/components/files/FilePreviewPanel";
import { THEME_STORAGE_KEY } from "@/config/runtime";
import {
  bindAppShellEvents,
} from "@/features/app-shell/app-shell-events";
import {
  CalendarWorkspaceSection,
  CaseWorkspaceSection,
  ChatWorkspaceSection,
  ExtensionsWorkspaceSection,
  LibraryWorkspaceSection,
  SettingsWorkspaceSection,
} from "@/features/app-shell/app-shell-panels";
import { createPreviewManager } from "@/features/app-shell/preview-manager";
import { createCaseWorkspaceManager } from "@/features/cases/case-workspace-manager";
import {
  chatScopeKey,
  sessionMatchesContext,
  sortSessionSummariesByUpdatedAt,
} from "@/features/chat/app-chat-helpers";
import { createChatHistoryManager } from "@/features/chat/chat-history-manager";
import { createCodexEventHandler } from "@/features/chat/codex-event-handler";
import { createChatTurnManager } from "@/features/chat/chat-turn-manager";
import { createLibraryWorkspaceManager } from "@/features/library/library-workspace-manager";
import { WorkspaceSetup } from "@/features/workspace/WorkspaceSetup";
import { RuntimeBundleBlockingDialog } from "@/features/workspace/RuntimeBundleBlockingDialog";
import { createWorkspaceConfigManager } from "@/features/workspace/workspace-config-manager";
import { startCalendarReminderWatcher } from "@/services/calendar-reminder-service";
import { notifyWhenWindowInactive } from "@/services/notification-service";
import {
  initializeWindowActivityTracking,
} from "@/services/window-activity-service";
import {
  ensureRuntimeBundleEventBinding,
  getRuntimeBundleState,
  subscribeRuntimeBundleState,
} from "@/services/runtime-bundle-service";
import {
  checkForUpdates,
  getUpdaterState,
  installAvailableUpdate,
  loadAppVersionInfo,
  silentCheckForUpdates,
  subscribeUpdaterState,
} from "@/services/updater-service";
import {
  installCodexPlugin,
  listCodexPlugins,
  prepareCodexRuntimeBundle,
  listenCodexEvents,
  respondCodexApproval,
  setCodexPluginEnabled,
  startCodexRuntime,
} from "@/services/codex-service";
import {
  listNativeFiles,
  openNativeFile,
} from "@/services/native-file-service";
import { showAlert } from "@/services/dialog-service";
import { getStoredAuthInfo } from "@/services/auth-service";
import type {
  AppConfig,
  AppFileImportState,
  AppRuntimeBundleState,
  AppUpdaterState,
  AppVersionInfo,
  CaseRecord,
  ChatAttachment,
  ChatMessage,
  ChatPluginOption,
  ChatSessionSummary,
  FileNode,
  NavKey,
  SessionContext,
  ThemeMode,
} from "@/types/domain";
import type { CodexApprovalDecision, CodexApprovalRequest, CodexPluginListResult, CodexTurnAttachmentInput } from "@/types/codex";
import { dateLabel } from "@/utils/chat-mappers";
import { classifyPluginMarketplace, shouldExposePluginInUi } from "@/utils/plugin-display";
import { createSessionId } from "@/utils/session";
import { shouldPreventWindowRefreshShortcut } from "@/utils/keyboard-shortcuts";
import { readStoredThemeMode, resolveThemeMode, syncNativeWindowTheme } from "@/utils/theme";

/** Codex app-server 已作为新的 Agent runtime 接入。 */
const AGENT_ENABLED = true;

/** 默认 Codex profile ID。 */
const CODEX_PROFILE_ID = "lex-vault";

/** 每个左侧工作区独立保存右侧预览目标，避免切换 tab 后沿用其他工作区的文件。 */
type PreviewTargetByNav = Partial<Record<NavKey, PreviewTarget | null>>;

function App() {
  const [fileImportState, setFileImportState] = useState<AppFileImportState>({
    visible: false,
    status: "success",
    sourceLabel: "",
    targetLabel: "",
    completedCount: 0,
    totalCount: 0,
    importedPaths: [],
    failedItems: [],
  });
  const [activeNav, setActiveNav] = useState<NavKey>("案件");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [resolvedThemeMode, setResolvedThemeMode] = useState<"light" | "dark">(
    () => resolveThemeMode(readStoredThemeMode()),
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseFileNodes, setCaseFileNodes] = useState<FileNode[]>([]);
  const [templateFileNodes, setTemplateFileNodes] = useState<FileNode[]>([]);
  const [lawFileNodes, setLawFileNodes] = useState<FileNode[]>([]);
  const [caseRefFileNodes, setCaseRefFileNodes] = useState<FileNode[]>([]);
  const [selectedTemplatePath, setSelectedTemplatePath] = useState<string | null>(null);
  const [selectedLawPath, setSelectedLawPath] = useState<string | null>(null);
  const [selectedCaseRefPath, setSelectedCaseRefPath] = useState<string | null>(null);
  const [previewTargetsByNav, setPreviewTargetsByNav] = useState<PreviewTargetByNav>({});
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(true);
  const [isCasesLoading, setIsCasesLoading] = useState(false);
  const [isCaseFilesLoading, setIsCaseFilesLoading] = useState(false);
  const [isTemplateFilesLoading, setIsTemplateFilesLoading] = useState(false);
  const [isLawFilesLoading, setIsLawFilesLoading] = useState(false);
  const [isCaseRefFilesLoading, setIsCaseRefFilesLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(createSessionId);
  // 按普通对话或案件目录记住当前会话，切换案件时聊天框立即切到对应历史或空白草稿。
  const [selectedSessionIdByScope, setSelectedSessionIdByScope] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [caseSessions, setCaseSessions] = useState<ChatSessionSummary[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [sessionContexts, setSessionContexts] = useState<Record<string, SessionContext>>({});
  const [threadBySession, setThreadBySession] = useState<Record<string, string>>({});
  const [runningSessionByThread, setRunningSessionByThread] = useState<Record<string, string>>({});
  // 案件材料右键加入聊天框后，先挂在当前会话草稿上，发送时再进入 prompt。
  const [contextAttachmentsBySession, setContextAttachmentsBySession] = useState<Record<string, ChatAttachment[]>>({});
  /** 案件对话当前不再暴露项目内置专项 skill，未选择时按通用律师任务发送。 */
  const [selectedCaseSkillName, setSelectedCaseSkillName] = useState<string | null>(null);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [hydratingHistorySessionId, setHydratingHistorySessionId] = useState<string | null>(null);
  const [selectedPluginIdsBySession, setSelectedPluginIdsBySession] = useState<Record<string, string[]>>({});
  const [pendingApprovalsBySession, setPendingApprovalsBySession] = useState<Record<string, CodexApprovalRequest[]>>({});
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isCaseHistoryLoading, setIsCaseHistoryLoading] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [caseHistoryLoadError, setCaseHistoryLoadError] = useState<string | null>(null);
  const [loadedChatScopes, setLoadedChatScopes] = useState<Record<string, boolean>>({});
  const [loginPromptSignal, setLoginPromptSignal] = useState(0);
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo>({ currentVersion: "" });
  const [updaterState, setUpdaterState] = useState<AppUpdaterState>(getUpdaterState());
  const [runtimeBundleState, setRuntimeBundleState] = useState<AppRuntimeBundleState>(getRuntimeBundleState());
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [pluginList, setPluginList] = useState<CodexPluginListResult | null>(null);
  const [isPluginLoading, setIsPluginLoading] = useState(false);
  const [pluginNotice, setPluginNotice] = useState<string | null>(null);
  const isSettings = activeNav === "设置";
  const isCaseTab = activeNav === "案件";
  const isCalendarTab = activeNav === "日历";
  const isChatTab = activeNav === "对话";
  const isTemplateTab = activeNav === "模板";
  const isLawTab = activeNav === "法规";
  const isCaseRefTab = activeNav === "案例";
  const isToolsTab = activeNav === "工具";
  const isPluginsTab = activeNav === "插件";
  const isLibraryTab = isTemplateTab || isLawTab || isCaseRefTab;
  /** 右侧通用预览面板只在对话、案件和文件资料类工作区展示。 */
  const showPreviewPanel = isChatTab || isCaseTab || isLibraryTab;
  const previewTarget = previewTargetsByNav[activeNav] ?? null;
  const selectedMessages = messagesBySession[selectedSessionId] ?? [];
  const selectedContextAttachments = contextAttachmentsBySession[selectedSessionId] ?? [];
  const selectedPluginIds = selectedPluginIdsBySession[selectedSessionId] ?? [];
  const selectedPendingApprovals = pendingApprovalsBySession[selectedSessionId] ?? [];
  const isStreaming = streamingSessionId === selectedSessionId;
  const canCompactCurrentSession = Boolean(threadBySession[selectedSessionId]);
  const selectedCase = cases.find((caseItem) => caseItem.id === selectedCaseId) ?? null;
  const workspaceRoot = config?.workspaceRoot ?? "";
  const caseMasterPath = config?.caseMaster ?? "";
  const selectedCasePath = selectedCase?.casePath ?? "";
  const activeCasePath = activeNav === "案件" ? selectedCasePath : workspaceRoot;
  const isWorkspaceConfigured = Boolean(workspaceRoot.trim());
  const selectedSessionIdRef = useRef(selectedSessionId);
  const threadBySessionRef = useRef(threadBySession);
  const sessionContextsRef = useRef(sessionContexts);
  const messagesBySessionRef = useRef(messagesBySession);
  const runningSessionByThreadRef = useRef(runningSessionByThread);
  const configRef = useRef<AppConfig | null>(config);
  const templateFileNodesRef = useRef(templateFileNodes);
  const lawFileNodesRef = useRef(lawFileNodes);
  const caseRefFileNodesRef = useRef(caseRefFileNodes);
  const isTemplateFilesLoadingRef = useRef(isTemplateFilesLoading);
  const isLawFilesLoadingRef = useRef(isLawFilesLoading);
  const isCaseRefFilesLoadingRef = useRef(isCaseRefFilesLoading);
  const selectedTemplatePathRef = useRef(selectedTemplatePath);
  const selectedLawPathRef = useRef(selectedLawPath);
  const selectedCaseRefPathRef = useRef(selectedCaseRefPath);
  // 当前运行中的 turn 只在内存中跟踪，用于停止输出时调用 app-server 的 turn/interrupt。
  const activeTurnBySessionRef = useRef<Record<string, { threadId: string; turnId: string }>>({});
  const interruptedTurnIdsRef = useRef<Set<string>>(new Set());
  // 应用启动阶段只执行一次“准备 runtime 包 -> 校验登录态 -> 预热 runtime”的串行流程。
  const startupRuntimeBootstrapRef = useRef(false);
  const shownUpdateDialogVersionRef = useRef<string | null>(null);
  const selectedPluginIdsBySessionRef = useRef(selectedPluginIdsBySession);
  const workspaceRootRef = useRef(workspaceRoot);
  const selectedCasePathRef = useRef(selectedCasePath);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    threadBySessionRef.current = threadBySession;
  }, [threadBySession]);

  useEffect(() => {
    sessionContextsRef.current = sessionContexts;
  }, [sessionContexts]);

  useEffect(() => {
    messagesBySessionRef.current = messagesBySession;
  }, [messagesBySession]);

  useEffect(() => {
    runningSessionByThreadRef.current = runningSessionByThread;
  }, [runningSessionByThread]);

  useEffect(() => {
    selectedPluginIdsBySessionRef.current = selectedPluginIdsBySession;
  }, [selectedPluginIdsBySession]);

  workspaceRootRef.current = workspaceRoot;
  selectedCasePathRef.current = selectedCasePath;
  configRef.current = config;
  templateFileNodesRef.current = templateFileNodes;
  lawFileNodesRef.current = lawFileNodes;
  caseRefFileNodesRef.current = caseRefFileNodes;
  isTemplateFilesLoadingRef.current = isTemplateFilesLoading;
  isLawFilesLoadingRef.current = isLawFilesLoading;
  isCaseRefFilesLoadingRef.current = isCaseRefFilesLoading;
  selectedTemplatePathRef.current = selectedTemplatePath;
  selectedLawPathRef.current = selectedLawPath;
  selectedCaseRefPathRef.current = selectedCaseRefPath;

  useEffect(() => {
    initializeWindowActivityTracking();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ensureRuntimeBundleEventBinding().then(() => {
      if (cancelled) {
        return;
      }
      setRuntimeBundleState(getRuntimeBundleState());
    });
    const unsubscribe = subscribeRuntimeBundleState((state) => {
      if (!cancelled) {
        setRuntimeBundleState(state);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAppVersionInfo().then((info) => {
      if (!cancelled) {
        setVersionInfo(info);
      }
    });
    const unsubscribe = subscribeUpdaterState((state) => {
      if (!cancelled) {
        setUpdaterState(state);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (updaterState.status === "available" && !updaterState.silent) {
      return;
    }
    if (updaterState.status === "available") {
      void notifyWhenWindowInactive({
        kind: "update-available",
        title: "Lex Vault 发现新版本",
        body: updaterState.nextVersion
          ? `检测到新版本 ${updaterState.nextVersion}，可在设置页下载并安装。`
          : "检测到可用新版本，可在设置页下载并安装。",
      });
    }
  }, [updaterState]);

  useEffect(() => {
    if (updaterState.status !== "available") {
      return;
    }
    const versionKey = updaterState.nextVersion ?? "__unknown__";
    if (shownUpdateDialogVersionRef.current === versionKey) {
      return;
    }
    shownUpdateDialogVersionRef.current = versionKey;
    setIsUpdateDialogOpen(true);
  }, [updaterState.nextVersion, updaterState.status]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const syncTheme = () => {
      const nextTheme = resolveThemeMode(themeMode);
      setResolvedThemeMode(nextTheme);
      // 同步到 HTML 根元素，确保挂载在 body 节点下的 React Portal 组件（如 Radix UI 下拉框弹层）能够正确匹配深色模式样式
      document.documentElement.setAttribute("data-theme", nextTheme);
      void syncNativeWindowTheme(nextTheme);
    };

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    syncTheme();
    media.addEventListener("change", syncTheme);

    return () => {
      media.removeEventListener("change", syncTheme);
    };
  }, [themeMode]);

  useEffect(() => {
    const handleGlobalContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest("[data-file-drop-path]")) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      document.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      if (!shouldPreventWindowRefreshShortcut(event)) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
    };
  }, []);

  const normalizedSessions = useMemo(() => {
    const known = new Set(sessions.flatMap((session) => [session.id, session.threadId].filter(Boolean) as string[]));
    const localSessions = Object.entries(messagesBySession)
      .filter(([sessionId]) => {
        const context = sessionContexts[sessionId];
        return !known.has(sessionId) && !known.has(threadBySession[sessionId] ?? "") && context?.agentType !== "case";
      })
      .map(([sessionId, messages]) => {
        const context = sessionContexts[sessionId];
        const firstUserMessage = messages.find((message) => message.role === "user");
        const lastMessage = messages[messages.length - 1];
        return {
          id: sessionId,
          title: firstUserMessage?.content.slice(0, 24) || "新会话",
          preview: lastMessage?.content.slice(0, 48) || "等待开始对话",
          time: dateLabel(lastMessage?.createdAt),
          agentType: context?.agentType,
          casePath: context?.casePath,
          updatedAt: lastMessage?.createdAt,
        };
      });

    return sortSessionSummariesByUpdatedAt([...localSessions, ...sessions]);
  }, [messagesBySession, sessionContexts, sessions, threadBySession]);

  const normalizedCaseSessions = useMemo(() => {
    const scopedCaseSessions = caseSessions.filter((session) => session.casePath === activeCasePath);
    const known = new Set(scopedCaseSessions.flatMap((session) => [session.id, session.threadId].filter(Boolean) as string[]));
    const localSessions = Object.entries(messagesBySession)
      .filter(([sessionId]) => {
        const context = sessionContexts[sessionId];
        return (
          !known.has(sessionId) &&
          !known.has(threadBySession[sessionId] ?? "") &&
          context?.agentType === "case" &&
          context.casePath === activeCasePath
        );
      })
      .map(([sessionId, messages]) => {
        const context = sessionContexts[sessionId];
        const firstUserMessage = messages.find((message) => message.role === "user");
        const lastMessage = messages[messages.length - 1];
        return {
          id: sessionId,
          title: firstUserMessage?.content.slice(0, 24) || "新会话",
          preview: lastMessage?.content.slice(0, 48) || "等待开始对话",
          time: dateLabel(lastMessage?.createdAt),
          agentType: context?.agentType,
          casePath: context?.casePath,
          updatedAt: lastMessage?.createdAt,
        };
      });

    return sortSessionSummariesByUpdatedAt([...localSessions, ...scopedCaseSessions]);
  }, [activeCasePath, caseSessions, messagesBySession, sessionContexts, threadBySession]);

  const activeSessions = isCaseTab ? normalizedCaseSessions : normalizedSessions;
  const selectedSessionTitle =
    activeSessions.find((session) => session.id === selectedSessionId)?.title ?? "新会话";
  const activeSessionContext = useMemo<SessionContext | null>(() => {
    if (!isWorkspaceConfigured) {
      return null;
    }
    if (isCaseTab) {
      return selectedCasePath ? { agentType: "case", casePath: selectedCasePath } : null;
    }
    if (isChatTab) {
      return workspaceRoot ? { agentType: "default", casePath: workspaceRoot } : null;
    }
    return null;
  }, [isCaseTab, isChatTab, isWorkspaceConfigured, selectedCasePath, workspaceRoot]);
  /** 对话框知识库弹层展示的三类本机资料来源。 */
  const knowledgeBaseSources = useMemo(() => [
    {
      key: "templates" as const,
      label: "模板",
      rootPath: config?.docTemplate ?? "",
      nodes: templateFileNodes,
      loading: isTemplateFilesLoading,
    },
    {
      key: "laws" as const,
      label: "法规",
      rootPath: config?.lawDirectory ?? "",
      nodes: lawFileNodes,
      loading: isLawFilesLoading,
    },
    {
      key: "cases" as const,
      label: "案例",
      rootPath: config?.caseRef ?? "",
      nodes: caseRefFileNodes,
      loading: isCaseRefFilesLoading,
    },
  ], [
    caseRefFileNodes,
    config?.caseRef,
    config?.docTemplate,
    config?.lawDirectory,
    isCaseRefFilesLoading,
    isLawFilesLoading,
    isTemplateFilesLoading,
    lawFileNodes,
    templateFileNodes,
  ]);
  /** 当前可供聊天直接注入的插件，只保留已安装项。 */
  const pluginOptions = useMemo<ChatPluginOption[]>(() =>
    (pluginList?.plugins ?? [])
      .filter((plugin) => shouldExposePluginInUi(plugin.marketplaceName) && plugin.installed)
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        mentionPath: plugin.mentionPath,
        description: plugin.description,
        marketplaceName: plugin.marketplaceName,
        sourceGroup: classifyPluginMarketplace(plugin.marketplaceName) === "system" ? "system" : "custom",
      })), [pluginList?.plugins]);
  const activeScopeKey = activeSessionContext ? chatScopeKey(activeSessionContext) : "";
  const chatPanelKey = `${activeScopeKey}:${selectedSessionId}`;
  /** 写入指定工作区的预览目标，让切换左侧 tab 时右侧预览也同步切换。 */
  const setPreviewForNav = useCallback((nav: NavKey, target: PreviewTarget | null) => {
    setPreviewTargetsByNav((current) => ({
      ...current,
      [nav]: target,
    }));
  }, []);
  const chatHistoryManager = useMemo(() => createChatHistoryManager({
    codeProfileId: CODEX_PROFILE_ID,
    getMessagesBySession: () => messagesBySessionRef.current,
    getSelectedCasePath: () => selectedCasePathRef.current,
    getSessionContexts: () => sessionContextsRef.current,
    getThreadBySession: () => threadBySessionRef.current,
    getWorkspaceRoot: () => workspaceRootRef.current,
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
  }), [selectedCasePath, workspaceRoot]);
  const libraryWorkspaceManager = useMemo(() => createLibraryWorkspaceManager({
    getCaseRefFileNodes: () => caseRefFileNodesRef.current,
    getConfig: () => configRef.current,
    getIsCaseRefFilesLoading: () => isCaseRefFilesLoadingRef.current,
    getIsLawFilesLoading: () => isLawFilesLoadingRef.current,
    getIsTemplateFilesLoading: () => isTemplateFilesLoadingRef.current,
    getLawFileNodes: () => lawFileNodesRef.current,
    getSelectedCaseRefPath: () => selectedCaseRefPathRef.current,
    getSelectedLawPath: () => selectedLawPathRef.current,
    getSelectedTemplatePath: () => selectedTemplatePathRef.current,
    getTemplateFileNodes: () => templateFileNodesRef.current,
    setCaseRefFileNodes,
    setIsCaseRefFilesLoading,
    setIsLawFilesLoading,
    setIsPreviewCollapsed,
    setIsTemplateFilesLoading,
    setLawFileNodes,
    setFileImportState,
    setPreviewForNav,
    setSelectedCaseRefPath,
    setSelectedLawPath,
    setSelectedTemplatePath,
    setTemplateFileNodes,
  }), [setPreviewForNav]);
  const workspaceConfigManager = useMemo(() => createWorkspaceConfigManager({
    activeNav,
    codeProfileId: CODEX_PROFILE_ID,
    getCaseMasterPath: () => caseMasterPath,
    loadLibraryFiles: (library) => libraryWorkspaceManager.loadLibraryFiles(library),
    setActiveNav,
    setCases,
    setCaseSessions,
    setConfig,
    setIsCasesLoading,
    setIsConfigLoaded,
    setIsWorkspaceSaving,
    setLoginPromptSignal,
    setPreviewTargetsByNav,
    setSelectedCaseId,
    setSelectedCaseRefPath,
    setSelectedLawPath,
    setSelectedTemplatePath,
    setSessions,
  }), [activeNav, caseMasterPath, libraryWorkspaceManager]);
  const caseWorkspaceManager = useMemo(() => createCaseWorkspaceManager({
    getCaseMasterPath: () => caseMasterPath,
    getSelectedCase: () => selectedCase,
    getSelectedSessionId: () => selectedSessionId,
    loadCaseFiles,
    loadCases: workspaceConfigManager.loadCases,
    setActiveNav,
    setCaseFileNodes,
    setContextAttachmentsBySession,
    setFileImportState,
    setIsPreviewCollapsed,
    setPreviewForNav,
    setSelectedCaseId,
  }), [caseMasterPath, selectedCase, selectedSessionId, workspaceConfigManager]);
  const previewManager = useMemo(() => createPreviewManager({
    getActiveNav: () => activeNav,
    setIsPreviewCollapsed,
    setPreviewForNav,
  }), [activeNav]);
  const chatTurnManager = useMemo(() => createChatTurnManager({
    activeTurnBySessionRef,
    codeProfileId: CODEX_PROFILE_ID,
    getActiveCasePath: () => activeCasePath,
    getActiveNav: () => activeNav,
    getSelectedCasePath: () => selectedCasePath,
    getSelectedCaseSkillName: () => selectedCaseSkillName,
    getSelectedPluginsForSession: (sessionId) => {
      const pluginIds = selectedPluginIdsBySessionRef.current[sessionId] ?? [];
      return pluginOptions.filter((plugin) => pluginIds.includes(plugin.id));
    },
    getSelectedSessionId: () => selectedSessionId,
    getSessionContexts: () => sessionContexts,
    getThreadBySession: () => threadBySession,
    getWorkspaceRoot: () => workspaceRoot,
    interruptedTurnIdsRef,
    rememberSelectedSession: chatHistoryManager.rememberSelectedSession,
    setActiveNav,
    setLoginPromptSignal,
    setMessagesBySession,
    setRunningSessionByThread,
    setSessionContexts,
    setStreamingSessionId,
    setThreadBySession,
  }), [
    activeCasePath,
    activeNav,
    chatHistoryManager,
    pluginOptions,
    selectedCasePath,
    selectedCaseSkillName,
    selectedSessionId,
    sessionContexts,
    threadBySession,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeSessionContext) {
      return;
    }

    const scopeKey = chatScopeKey(activeSessionContext);
    if (!loadedChatScopes[scopeKey]) {
      return;
    }

    const scopedSessionId = selectedSessionIdByScope[scopeKey];
    if (scopedSessionId && sessionMatchesContext(sessionContexts[scopedSessionId], activeSessionContext)) {
      if (selectedSessionId !== scopedSessionId) {
        setSelectedSessionId(scopedSessionId);
      }
      return;
    }

    const firstSession = activeSessions.find((session) =>
      sessionMatchesContext(
        {
          agentType: session.agentType ?? activeSessionContext.agentType,
          casePath: session.casePath ?? activeSessionContext.casePath,
        },
        activeSessionContext,
      ),
    );
    if (firstSession) {
      chatHistoryManager.rememberSelectedSession(firstSession.id, activeSessionContext);
      void chatHistoryManager.hydrateCodexThread(firstSession.id, activeSessionContext);
      return;
    }

    const nextSessionId = createSessionId();
    chatHistoryManager.rememberSelectedSession(nextSessionId, activeSessionContext);
  }, [activeSessionContext, activeSessions, chatHistoryManager, loadedChatScopes, selectedSessionId, selectedSessionIdByScope, sessionContexts]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindTrayEvents() {
      unlisten = await bindAppShellEvents({
        onNewChat: () => {
          chatTurnManager.createConversation();
        },
        onNewCaseChat: () => {
          if (!selectedCasePath) {
            setActiveNav("案件");
            return;
          }
          chatTurnManager.createCaseConversation();
        },
        onToggleSidebar: () => {
          setIsCollapsed((prev) => !prev);
        },
      });
      if (cancelled) {
        unlisten?.();
      }
    }

    void bindTrayEvents();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [chatTurnManager, selectedCasePath]);

  const bootstrapRuntimeOnLaunch = useCallback(async () => {
    try {
      // 启动应用先独立校验 runtime 包，避免未登录时完全看不到下载进度。
      await prepareCodexRuntimeBundle();
    } catch (error) {
      console.error("应用启动时准备 Codex runtime 依赖包失败", error);
      return;
    }
    await workspaceConfigManager.startRuntimeOnLaunch();
  }, [workspaceConfigManager]);

  useEffect(() => {
    void workspaceConfigManager.loadConfig();
  }, [workspaceConfigManager]);

  useEffect(() => {
    if (!isConfigLoaded || startupRuntimeBootstrapRef.current) {
      return;
    }

    startupRuntimeBootstrapRef.current = true;
    void bootstrapRuntimeOnLaunch();
  }, [bootstrapRuntimeOnLaunch, isConfigLoaded]);

  useEffect(() => {
    if (!isConfigLoaded) {
      return;
    }
    void silentCheckForUpdates();
  }, [isConfigLoaded]);

  useEffect(() => {
    if (!isWorkspaceConfigured) {
      return;
    }
    return startCalendarReminderWatcher();
  }, [isWorkspaceConfigured]);

  useEffect(() => {
    if (activeNav === "模板") {
      void libraryWorkspaceManager.loadLibraryFiles("templates");
    } else if (activeNav === "法规") {
      void libraryWorkspaceManager.loadLibraryFiles("laws");
    } else if (activeNav === "案例") {
      void libraryWorkspaceManager.loadLibraryFiles("cases");
    }
  }, [activeNav, config?.docTemplate, config?.lawDirectory, config?.caseRef, libraryWorkspaceManager]);

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseFileNodes([]);
      return;
    }

    void loadCaseFiles(selectedCaseId);
  }, [selectedCaseId]);

  async function loadCaseFiles(caseId: string) {
    setIsCaseFilesLoading(true);
    try {
      const targetCase = cases.find((caseItem) => caseItem.id === caseId);
      setCaseFileNodes(targetCase?.casePath ? await listNativeFiles(targetCase.casePath) : []);
    } catch {
      setCaseFileNodes([]);
    } finally {
      setIsCaseFilesLoading(false);
    }
  }

  async function refreshCaseFiles() {
    if (!selectedCaseId) {
      return;
    }
    await loadCaseFiles(selectedCaseId);
  }

  async function handleRemoteLawDownloaded(path: string) {
    await libraryWorkspaceManager.loadLibraryFiles("laws");
    const rootPath = libraryWorkspaceManager.libraryRootPath("laws");
    if (!rootPath) {
      return;
    }
    const name = path.split(/[\\/]/).pop() || path;
    const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
    setSelectedLawPath(path);
    setPreviewForNav("法规", {
      rootPath,
      path,
      name,
      extension,
      sourceLabel: "法规",
    });
    setIsPreviewCollapsed(false);
  }

  /** 刷新对话框知识库弹层所需的全部本地文件库。 */
  async function refreshKnowledgeBase() {
    await Promise.all([
      libraryWorkspaceManager.loadLibraryFiles("templates"),
      libraryWorkspaceManager.loadLibraryFiles("laws"),
      libraryWorkspaceManager.loadLibraryFiles("cases"),
    ]);
  }

  /** 直接读取 app-server 当前插件清单，供插件中心和聊天输入区复用。 */
  const refreshPlugins = useCallback(async (successNotice?: string | null) => {
    if (!isWorkspaceConfigured) {
      setPluginList(null);
      return;
    }
    const auth = await getStoredAuthInfo().catch(() => null);
    if (!auth?.accessToken?.trim()) {
      setPluginList(null);
      setPluginNotice("当前未登录，插件中心会在登录并启动助手运行环境后显示。");
      return;
    }

    setIsPluginLoading(true);
    try {
      await startCodexRuntime(CODEX_PROFILE_ID);
      const nextPluginList = await listCodexPlugins();
      setPluginList(nextPluginList);
      setPluginNotice(successNotice ?? null);
      setSelectedPluginIdsBySession((current) => {
        const validIds = new Set(nextPluginList.plugins.filter((plugin) => plugin.installed).map((plugin) => plugin.id));
        return Object.fromEntries(
          Object.entries(current).map(([sessionKey, pluginIds]) => [
            sessionKey,
            pluginIds.filter((pluginId) => validIds.has(pluginId)),
          ]),
        );
      });
    } catch (error) {
      setPluginNotice("插件列表加载失败，请确认助手运行环境已启动并检查插件分组配置。");
      console.error("加载插件列表失败", error);
    } finally {
      setIsPluginLoading(false);
    }
  }, [isWorkspaceConfigured]);

  /** 安装单个插件并刷新当前插件视图。 */
  const installPlugin = useCallback(async (marketplacePath: string, pluginName: string) => {
    await startCodexRuntime(CODEX_PROFILE_ID);
    const result = await installCodexPlugin(marketplacePath, pluginName);
    await refreshPlugins(result.message);
  }, [refreshPlugins]);

  /** 切换单个插件在当前 profile 下的启用状态，并刷新页面状态。 */
  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    await startCodexRuntime(CODEX_PROFILE_ID);
    const result = await setCodexPluginEnabled(pluginId, enabled);
    await refreshPlugins(result.message);
  }, [refreshPlugins]);

  /** 把插件加入或移出当前会话，供发送链路自动注入 mention。 */
  const setSelectedPluginsForCurrentSession = useCallback((pluginIds: string[]) => {
    setSelectedPluginIdsBySession((current) => ({
      ...current,
      [selectedSessionIdRef.current]: pluginIds,
    }));
  }, []);

  /** 将知识库文件加入当前会话草稿引用区，发送本轮问题时再写入 prompt。 */
  function addKnowledgeBaseReference(attachment: ChatAttachment) {
    setContextAttachmentsBySession((current) => {
      const attachments = current[selectedSessionId] ?? [];
      if (attachments.some((item) => item.id === attachment.id)) {
        return current;
      }
      return {
        ...current,
        [selectedSessionId]: [...attachments, attachment],
      };
    });
  }

  async function openCaseFile(node: FileNode) {
    if (!selectedCase?.casePath) {
      return;
    }

      try {
        await openNativeFile(selectedCase.casePath, node.path);
      } catch {
        await showAlert({
          title: "打开失败",
          message: "无法通过系统默认程序打开当前材料。",
          intent: "warning",
        });
      }
    }

  useEffect(() => {
    if (!isWorkspaceConfigured) {
      setCases([]);
      setSelectedCaseId(null);
      setSessions([]);
      setCaseSessions([]);
      setHistoryLoadError(null);
      setCaseHistoryLoadError(null);
      return;
    }
    void workspaceConfigManager.loadCases();
  }, [isWorkspaceConfigured, caseMasterPath, workspaceConfigManager]);

  useEffect(() => {
    if (!isWorkspaceConfigured) {
      setPluginList(null);
      setPluginNotice(null);
      return;
    }
    void refreshPlugins();
  }, [isWorkspaceConfigured, refreshPlugins]);

  useEffect(() => {
    if (!isWorkspaceConfigured || activeNav !== "插件") {
      return;
    }
    void refreshPlugins();
  }, [activeNav, isWorkspaceConfigured, refreshPlugins]);

  useEffect(() => {
    if (!isWorkspaceConfigured || !workspaceRoot || activeNav !== "对话") {
      return;
    }
    const scopeKey = chatScopeKey({ agentType: "default", casePath: workspaceRoot });
    if (loadedChatScopes[scopeKey]) {
      return;
    }
    void chatHistoryManager.loadChatHistoryList();
  }, [activeNav, chatHistoryManager, isWorkspaceConfigured, loadedChatScopes, workspaceRoot]);

  useEffect(() => {
    const casePath = selectedCase?.casePath ?? "";
    if (!isWorkspaceConfigured) {
      setCaseSessions([]);
      setCaseHistoryLoadError(null);
      setIsCaseHistoryLoading(false);
      return;
    }
    if (activeNav !== "案件") {
      return;
    }
    if (!casePath) {
      setCaseSessions([]);
      setCaseHistoryLoadError(null);
      setIsCaseHistoryLoading(false);
      return;
    }
    const scopeKey = chatScopeKey({ agentType: "case", casePath });
    if (loadedChatScopes[scopeKey]) {
      return;
    }
    void chatHistoryManager.loadCaseChatHistoryList(casePath);
  }, [activeNav, chatHistoryManager, isWorkspaceConfigured, loadedChatScopes, selectedCase?.casePath]);

  const resolveEventSessionId = useCallback((threadId?: string) => {
    if (!threadId) {
      return selectedSessionIdRef.current;
    }
    return (
      runningSessionByThreadRef.current[threadId]
      ?? findSessionIdByThread(threadBySessionRef.current, threadId)
    );
  }, []);

  /** 回写当前会话的 Codex 审批决策，并在成功后从输入区待处理条移除。 */
  const handleApprovalDecision = useCallback(async (request: CodexApprovalRequest, decision: CodexApprovalDecision) => {
    try {
      await respondCodexApproval({
        requestId: request.id,
        decision,
      });
    } catch (error) {
      console.error("Codex 审批回写失败", error);
      await showAlert({
        title: "审批提交失败",
        message: "这次审批结果没有成功提交，请稍后再试。",
        intent: "danger",
      });
      return;
    }
    setPendingApprovalsBySession((current) => {
      const sessionId = resolveEventSessionId(request.threadId);
      if (!sessionId) {
        return current;
      }
      const currentApprovals = current[sessionId] ?? [];
      const nextApprovals = currentApprovals.filter((approval) => approval.id !== request.id);
      if (nextApprovals.length === currentApprovals.length) {
        return current;
      }
      if (!nextApprovals.length) {
        const { [sessionId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [sessionId]: nextApprovals,
      };
    });
  }, [resolveEventSessionId]);

  const handleCodexEvent = useMemo(() => createCodexEventHandler({
    activeTurnBySessionRef,
    getMessagesBySession: () => messagesBySessionRef.current,
    interruptedTurnIdsRef,
    loadCaseChatHistoryList: chatHistoryManager.loadCaseChatHistoryList,
    loadChatHistoryList: chatHistoryManager.loadChatHistoryList,
    omitRunningThread: (threadId) => {
      setRunningSessionByThread((current) => omitRecordKey(current, threadId));
    },
    resolveEventSessionId,
    selectedSessionIdRef,
    sessionContextsRef,
    setMessagesBySession,
    setPendingApprovalsBySession,
    setStreamingSessionId,
  }), [chatHistoryManager, resolveEventSessionId]);

  /** 用户点击历史列表失败提示中的重试时，直接重新读取普通对话作用域。 */
  const retryChatHistoryList = useCallback(() => {
    if (!workspaceRoot.trim()) {
      return;
    }
    void chatHistoryManager.loadChatHistoryList();
  }, [chatHistoryManager, workspaceRoot]);

  /** 用户点击历史列表失败提示中的重试时，直接重新读取当前案件作用域。 */
  const retryCaseHistoryList = useCallback(() => {
    const casePath = selectedCase?.casePath ?? "";
    if (!casePath.trim()) {
      return;
    }
    void chatHistoryManager.loadCaseChatHistoryList(casePath);
  }, [chatHistoryManager, selectedCase?.casePath]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindCodexEvents() {
      try {
        const unlistenFn = await listenCodexEvents(handleCodexEvent);
        if (cancelled) {
          unlistenFn();
          return;
        }
        unlisten = unlistenFn;
      } catch (error) {
        console.error("监听 Codex runtime 事件失败", error);
      }
    }

    void bindCodexEvents();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleCodexEvent]);

  const handleCheckUpdate = useCallback(async () => {
    await checkForUpdates();
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    await installAvailableUpdate();
  }, []);

  const handleInstallUpdateFromDialog = useCallback(async () => {
    await installAvailableUpdate();
  }, []);

  const handleRetryRuntimeBundle = useCallback(() => {
    void bootstrapRuntimeOnLaunch();
  }, [bootstrapRuntimeOnLaunch]);

  const handleSend = useCallback(async (
    prompt: string,
    visiblePrompt = prompt,
    attachments: ChatAttachment[] = [],
    inputAttachments: CodexTurnAttachmentInput[] = [],
  ) => {
    await chatTurnManager.handleSend(prompt, visiblePrompt, attachments, inputAttachments);
  }, [chatTurnManager]);

  const handleCancelTurn = useCallback(async () => {
    await chatTurnManager.handleCancelTurn();
  }, [chatTurnManager]);

  const isRuntimeBundleBlocking = ["required", "downloading", "extracting", "failed"].includes(
    runtimeBundleState.status,
  );
  const runtimeBundleBlockingDialog = isRuntimeBundleBlocking ? (
    <RuntimeBundleBlockingDialog
      onRetry={handleRetryRuntimeBundle}
      state={runtimeBundleState}
    />
  ) : null;

  if (!isConfigLoaded) {
    return (
      <>
        <main
          className="flex min-h-svh items-center justify-center bg-background text-foreground"
          data-theme={resolvedThemeMode}
        >
          <div className="text-sm text-slate-500">正在加载配置</div>
        </main>
        {runtimeBundleBlockingDialog}
      </>
    );
  }

  if (!isWorkspaceConfigured) {
    return (
      <>
        <WorkspaceSetup
          isSaving={isWorkspaceSaving}
          onChooseWorkspace={() => void workspaceConfigManager.chooseInitialWorkspace()}
          resolvedThemeMode={resolvedThemeMode}
        />
        {runtimeBundleBlockingDialog}
      </>
    );
  }

  return (
    <main
      className="min-h-svh overflow-auto bg-background text-foreground lg:h-svh lg:overflow-hidden"
      data-theme={resolvedThemeMode}
    >
      <div className="flex min-h-svh min-w-0 flex-col gap-3 sm:gap-4 lg:h-full lg:flex-row">
        <Sidebar
          activeNav={activeNav}
          isCollapsed={isCollapsed}
          onCreateCaseConversation={chatTurnManager.createCaseConversation}
          onCreateConversation={chatTurnManager.createConversation}
          onNavigate={setActiveNav}
        />
        {isCaseTab ? (
          <CaseWorkspaceSection
            agentEnabled={AGENT_ENABLED}
            cases={cases}
            chatPanelKey={chatPanelKey}
            contextAttachments={selectedContextAttachments}
            canCompactContext={canCompactCurrentSession}
            fileNodes={caseFileNodes}
            historyLoadError={caseHistoryLoadError}
            isFilesLoading={isCaseFilesLoading}
            isHistoryLoading={isCaseHistoryLoading}
            isLoading={isCasesLoading}
            isPreviewCollapsed={isPreviewCollapsed}
            isStreaming={isStreaming}
            isHydratingHistory={hydratingHistorySessionId === selectedSessionId}
            knowledgeBaseSources={knowledgeBaseSources}
            messages={selectedMessages}
            onAddKnowledgeBaseReference={addKnowledgeBaseReference}
            onAddCaseFileToChat={caseWorkspaceManager.addCaseFileToChat}
            onCancel={handleCancelTurn}
            onCompactContext={chatTurnManager.handleCompactCurrentSession}
            onClearContextAttachments={caseWorkspaceManager.clearContextAttachments}
            onCopyCaseFile={caseWorkspaceManager.copyCaseFile}
            onCreateCase={caseWorkspaceManager.createCase}
            onCreateCaseFile={caseWorkspaceManager.createCaseFile}
            onCreateCaseFolder={caseWorkspaceManager.createCaseFolder}
            onCreateConversation={chatTurnManager.createCaseConversation}
            onDeleteCase={caseWorkspaceManager.deleteCase}
            onDeleteCaseFile={caseWorkspaceManager.deleteCaseFile}
            onImportCasePaths={caseWorkspaceManager.importCasePaths}
            onOpenCaseFile={(node) => void openCaseFile(node)}
            onPreviewCaseFile={caseWorkspaceManager.previewCaseFile}
            onPreviewFile={previewManager.previewFile}
            onPreviewPanelToggle={previewManager.togglePreviewPanel}
            onOpenUrl={(url) => void previewManager.openUrlExternal(url)}
            onApprovalDecision={handleApprovalDecision}
            onPluginSelectionChange={setSelectedPluginsForCurrentSession}
            onRefreshKnowledgeBase={refreshKnowledgeBase}
            onRefreshFiles={refreshCaseFiles}
            onRemoveContextAttachment={caseWorkspaceManager.removeContextAttachment}
            onRetryHistory={retryCaseHistoryList}
            onRenameCase={caseWorkspaceManager.renameCase}
            onRenameCaseFile={caseWorkspaceManager.renameCaseFile}
            onRevealCasePath={(node) => void caseWorkspaceManager.revealCasePath(node)}
            onSelectCase={setSelectedCaseId}
            onSelectConversation={chatHistoryManager.loadCaseHistory}
            onSend={handleSend}
            onSkillChange={setSelectedCaseSkillName}
            onUploadCaseFiles={caseWorkspaceManager.uploadCaseFiles}
            pluginOptions={pluginOptions}
            pendingApprovals={selectedPendingApprovals}
            selectedCaseId={selectedCaseId}
            selectedPluginIds={selectedPluginIds}
            selectedSessionId={selectedSessionId}
            selectedSkillName={selectedCaseSkillName}
            sessionId={selectedSessionId}
            sessions={normalizedCaseSessions}
            skillOptions={[]}
            title={selectedSessionTitle}
          />
        ) : isChatTab ? (
          <ChatWorkspaceSection
            agentEnabled={AGENT_ENABLED}
            chatPanelKey={chatPanelKey}
            contextAttachments={selectedContextAttachments}
            canCompactContext={canCompactCurrentSession}
            historyLoadError={historyLoadError}
            isHistoryLoading={isHistoryLoading}
            isPreviewCollapsed={isPreviewCollapsed}
            isStreaming={isStreaming}
            isHydratingHistory={hydratingHistorySessionId === selectedSessionId}
            knowledgeBaseSources={knowledgeBaseSources}
            messages={selectedMessages}
            onAddKnowledgeBaseReference={addKnowledgeBaseReference}
            onCancel={handleCancelTurn}
            onCompactContext={chatTurnManager.handleCompactCurrentSession}
            onClearContextAttachments={caseWorkspaceManager.clearContextAttachments}
            onCreateConversation={chatTurnManager.createConversation}
            onPreviewFile={previewManager.previewFile}
            onPreviewPanelToggle={previewManager.togglePreviewPanel}
            onOpenUrl={(url) => void previewManager.openUrlExternal(url)}
            onApprovalDecision={handleApprovalDecision}
            onPluginSelectionChange={setSelectedPluginsForCurrentSession}
            onRefreshKnowledgeBase={refreshKnowledgeBase}
            onRemoveContextAttachment={caseWorkspaceManager.removeContextAttachment}
            onRetryHistory={retryChatHistoryList}
            onSelectConversation={chatHistoryManager.loadHistory}
            onSend={handleSend}
            pluginOptions={pluginOptions}
            pendingApprovals={selectedPendingApprovals}
            selectedPluginIds={selectedPluginIds}
            selectedSessionId={selectedSessionId}
            sessionId={selectedSessionId}
            sessions={normalizedSessions}
            title={selectedSessionTitle}
          />
        ) : isCalendarTab ? (
          <CalendarWorkspaceSection
            cases={cases}
            onSelectCase={setSelectedCaseId}
            resolvedThemeMode={resolvedThemeMode}
            selectedCaseId={selectedCaseId}
          />
        ) : isTemplateTab ? (
          <LibraryWorkspaceSection
            directory={libraryWorkspaceManager.getLibraryState("templates").directory}
            fileNodes={libraryWorkspaceManager.getLibraryState("templates").fileNodes}
            icon={FileText}
            isFilesLoading={libraryWorkspaceManager.getLibraryState("templates").isFilesLoading}
            onCopyFile={(path, newPath) => libraryWorkspaceManager.copyLibraryFile("templates", path, newPath)}
            onCreateFile={(path) => libraryWorkspaceManager.createLibraryFile("templates", path)}
            onCreateFolder={(path) => libraryWorkspaceManager.createLibraryFolder("templates", path)}
            onDeleteFile={(path) => libraryWorkspaceManager.deleteLibraryFile("templates", path)}
            onImportPaths={(parentPath, sourcePaths) => libraryWorkspaceManager.importLibraryPaths("templates", parentPath, sourcePaths)}
            onMoveFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("templates", path, newPath)}
            onOpenDirectory={() => void libraryWorkspaceManager.openLibraryDirectory("templates")}
            onOpenFile={(node) => void libraryWorkspaceManager.openLibraryFile("templates", node)}
            onRefreshFiles={() => libraryWorkspaceManager.loadLibraryFiles("templates")}
            onRenameFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("templates", path, newPath)}
            onRevealPath={(node) => void libraryWorkspaceManager.revealLibraryPath("templates", node)}
            onSelectFile={(node) => void libraryWorkspaceManager.loadLibraryContent("templates", node)}
            onUploadFiles={(parentPath, files) => libraryWorkspaceManager.uploadLibraryFiles("templates", parentPath, files)}
            selectedPath={libraryWorkspaceManager.getLibraryState("templates").selectedPath}
            title="模板"
          />
        ) : isLawTab ? (
          <LibraryWorkspaceSection
            directory={libraryWorkspaceManager.getLibraryState("laws").directory}
            fileNodes={libraryWorkspaceManager.getLibraryState("laws").fileNodes}
            icon={Gavel}
            isFilesLoading={libraryWorkspaceManager.getLibraryState("laws").isFilesLoading}
            onCopyFile={(path, newPath) => libraryWorkspaceManager.copyLibraryFile("laws", path, newPath)}
            onCreateFile={(path) => libraryWorkspaceManager.createLibraryFile("laws", path)}
            onCreateFolder={(path) => libraryWorkspaceManager.createLibraryFolder("laws", path)}
            onDeleteFile={(path) => libraryWorkspaceManager.deleteLibraryFile("laws", path)}
            onImportPaths={(parentPath, sourcePaths) => libraryWorkspaceManager.importLibraryPaths("laws", parentPath, sourcePaths)}
            onMoveFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("laws", path, newPath)}
            onOpenDirectory={() => void libraryWorkspaceManager.openLibraryDirectory("laws")}
            onOpenFile={(node) => void libraryWorkspaceManager.openLibraryFile("laws", node)}
            onRefreshFiles={() => libraryWorkspaceManager.loadLibraryFiles("laws")}
            onRenameFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("laws", path, newPath)}
            onRevealPath={(node) => void libraryWorkspaceManager.revealLibraryPath("laws", node)}
            onSelectFile={(node) => void libraryWorkspaceManager.loadLibraryContent("laws", node)}
            onUploadFiles={(parentPath, files) => libraryWorkspaceManager.uploadLibraryFiles("laws", parentPath, files)}
            onRemoteLawDownloaded={handleRemoteLawDownloaded}
            selectedPath={libraryWorkspaceManager.getLibraryState("laws").selectedPath}
            title="法规"
          />
        ) : isCaseRefTab ? (
          <LibraryWorkspaceSection
            directory={libraryWorkspaceManager.getLibraryState("cases").directory}
            fileNodes={libraryWorkspaceManager.getLibraryState("cases").fileNodes}
            icon={BookOpenCheck}
            isFilesLoading={libraryWorkspaceManager.getLibraryState("cases").isFilesLoading}
            onCopyFile={(path, newPath) => libraryWorkspaceManager.copyLibraryFile("cases", path, newPath)}
            onCreateFile={(path) => libraryWorkspaceManager.createLibraryFile("cases", path)}
            onCreateFolder={(path) => libraryWorkspaceManager.createLibraryFolder("cases", path)}
            onDeleteFile={(path) => libraryWorkspaceManager.deleteLibraryFile("cases", path)}
            onImportPaths={(parentPath, sourcePaths) => libraryWorkspaceManager.importLibraryPaths("cases", parentPath, sourcePaths)}
            onMoveFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("cases", path, newPath)}
            onOpenDirectory={() => void libraryWorkspaceManager.openLibraryDirectory("cases")}
            onOpenFile={(node) => void libraryWorkspaceManager.openLibraryFile("cases", node)}
            onRefreshFiles={() => libraryWorkspaceManager.loadLibraryFiles("cases")}
            onRenameFile={(path, newPath) => libraryWorkspaceManager.renameLibraryFile("cases", path, newPath)}
            onRevealPath={(node) => void libraryWorkspaceManager.revealLibraryPath("cases", node)}
            onSelectFile={(node) => void libraryWorkspaceManager.loadLibraryContent("cases", node)}
            onUploadFiles={(parentPath, files) => libraryWorkspaceManager.uploadLibraryFiles("cases", parentPath, files)}
            selectedPath={libraryWorkspaceManager.getLibraryState("cases").selectedPath}
            title="案例"
          />
        ) : isToolsTab ? (
          <ExtensionsWorkspaceSection
            cases={cases}
            isPluginLoading={isPluginLoading}
            mode="工具"
            onInstallPlugin={installPlugin}
            onRefreshPlugins={refreshPlugins}
            onSetPluginEnabled={setPluginEnabled}
            pluginList={pluginList}
            pluginNotice={pluginNotice}
          />
        ) : isPluginsTab ? (
          <ExtensionsWorkspaceSection
            cases={cases}
            isPluginLoading={isPluginLoading}
            mode="插件"
            onInstallPlugin={installPlugin}
            onRefreshPlugins={refreshPlugins}
            onSetPluginEnabled={setPluginEnabled}
            pluginList={pluginList}
            pluginNotice={pluginNotice}
          />
        ) : isSettings ? (
          <SettingsWorkspaceSection
            config={config}
            loginPromptSignal={loginPromptSignal}
            onCheckUpdate={handleCheckUpdate}
            onInstallUpdate={handleInstallUpdate}
            onSaveConfig={workspaceConfigManager.saveConfig}
            onThemeModeChange={setThemeMode}
            themeMode={themeMode}
            updaterState={updaterState}
            versionInfo={versionInfo}
          />
        ) : null}
        {showPreviewPanel ? (
          <FilePreviewPanel
            className={isLibraryTab ? "flex-1 shrink lg:w-auto" : undefined}
            collapsed={isLibraryTab ? !previewTarget : isPreviewCollapsed}
            onOpenExternal={(target) => void previewManager.openPreviewExternal(target)}
            resizable={!isLibraryTab}
            target={previewTarget}
          />
        ) : null}
      </div>
      {runtimeBundleBlockingDialog}
      <FileImportProgressDialog
        onClose={() => setFileImportState((current) => ({ ...current, visible: false }))}
        state={fileImportState}
      />
      {isUpdateDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
          onClick={() => {
            if (updaterState.status !== "downloading") {
              setIsUpdateDialogOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-5 py-3">
              <div>
                <h2 className="text-base font-semibold text-[color:var(--color-card-foreground)]">发现新版本</h2>
                <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
                  {updaterState.nextVersion
                    ? `检测到新版本 ${updaterState.nextVersion}`
                    : "检测到可用新版本"}
                </p>
              </div>
              <Button
                aria-label="关闭更新提醒弹框"
                disabled={updaterState.status === "downloading"}
                onClick={() => setIsUpdateDialogOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4 text-sm text-[color:var(--color-muted-foreground)]">
                <p>当前版本：{versionInfo.currentVersion || updaterState.currentVersion || "读取中"}</p>
                <p className="mt-2">目标版本：{updaterState.nextVersion || "待确认"}</p>
                <p className="mt-2">{updaterState.statusText}</p>
              </div>
              {updaterState.releaseNotes ? (
                <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
                  <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">版本说明</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--color-muted-foreground)]">{updaterState.releaseNotes}</p>
                </div>
              ) : null}
              {updaterState.errorMessage ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {updaterState.errorMessage}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)] px-5 py-4">
              <Button
                disabled={updaterState.status === "downloading"}
                onClick={() => setIsUpdateDialogOpen(false)}
                type="button"
                variant="outline"
              >
                稍后再说
              </Button>
              <Button
                disabled={updaterState.status === "downloading"}
                onClick={() => void handleInstallUpdateFromDialog()}
                type="button"
              >
                {updaterState.status === "downloading" ? <LoaderCircle className="animate-spin" /> : <Download />}
                {updaterState.status === "downloading" ? "下载中" : "下载并安装"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <AppDialogHost />
    </main>
  );
}

export default App;

function findSessionIdByThread(threadBySession: Record<string, string>, threadId: string) {
  const matched = Object.entries(threadBySession).find(([, value]) => value === threadId)?.[0];
  return matched;
}

/** 返回移除指定键后的新对象，用于清理 thread 到会话的临时运行映射。 */
function omitRecordKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
