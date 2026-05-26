import type { LucideIcon } from "lucide-react";

import type { FilePreviewTarget } from "@/components/files/FilePreviewPanel";
import { CalendarPanel } from "@/features/calendar/CalendarPanel";
import { CasePanel } from "@/features/cases/CasePanel";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { ConversationHistoryPanel } from "@/features/chat/ConversationHistoryPanel";
import type { KnowledgeBaseSource } from "@/features/chat/components/knowledge-base-helpers";
import { ExtensionsPanel, type ExtensionPanelMode } from "@/features/extensions/ExtensionsPanel";
import { LibraryPanel } from "@/features/library/LibraryPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import type { CodexApprovalDecision, CodexApprovalRequest, CodexTurnAttachmentInput, CodexPluginListResult } from "@/types/codex";
import type {
  AppConfig,
  AppUpdaterState,
  AppVersionInfo,
  CaseRecord,
  ChatAttachment,
  ChatMessage,
  ChatPluginOption,
  ChatSessionSummary,
  ChatSkillOption,
  FileNode,
  ThemeMode,
} from "@/types/domain";

type SharedChatPanelProps = {
  /** Agent 能力是否已接入。 */
  agentEnabled: boolean;
  /** 当前聊天面板等待发送的附件上下文。 */
  contextAttachments: ChatAttachment[];
  /** 当前会话是否仍在流式输出。 */
  isStreaming: boolean;
  /** 当前会话是否已经绑定到可压缩的 Codex thread。 */
  canCompactContext: boolean;
  /** 当前是否正在回填选中历史会话的完整内容。 */
  isHydratingHistory: boolean;
  /** 当前聊天面板对应的 React key。 */
  chatPanelKey: string;
  /** 当前会话的消息列表。 */
  messages: ChatMessage[];
  /** 右侧预览面板是否折叠。 */
  isPreviewCollapsed: boolean;
  /** 对话框知识库弹层展示的文件库来源。 */
  knowledgeBaseSources: KnowledgeBaseSource[];
  /** 当前会话 ID。 */
  sessionId: string;
  /** 当前会话标题。 */
  title: string;
  /** 停止当前 turn。 */
  onCancel: () => Promise<void>;
  /** 触发当前单个会话的上下文压缩。 */
  onCompactContext: () => Promise<void>;
  /** 清空待发送的上下文附件。 */
  onClearContextAttachments: () => void;
  /** 从待发送列表移除单个上下文附件。 */
  onRemoveContextAttachment: (attachmentId: string) => void;
  /** 打开右侧文件预览。 */
  onPreviewFile: (target: FilePreviewTarget) => void;
  /** 聊天网页链接默认交给系统浏览器打开。 */
  onOpenUrl: (url: string, title?: string, openExternally?: boolean) => void;
  /** 切换右侧预览面板。 */
  onPreviewPanelToggle: () => void;
  /** 将知识库文件加入当前输入区引用。 */
  onAddKnowledgeBaseReference: (attachment: ChatAttachment) => void;
  /** 刷新对话框知识库弹层展示的全部文件库。 */
  onRefreshKnowledgeBase: () => Promise<void>;
  /** 当前会话等待用户处理的 Codex 审批请求。 */
  pendingApprovals: CodexApprovalRequest[];
  /** 用户在输入框上方处理 Codex 审批。 */
  onApprovalDecision: (request: CodexApprovalRequest, decision: CodexApprovalDecision) => Promise<void>;
  /** 发送当前输入。 */
  onSend: (
    prompt: string,
    visiblePrompt?: string,
    attachments?: ChatAttachment[],
    inputAttachments?: CodexTurnAttachmentInput[],
  ) => Promise<void>;
  /** 当前可选插件。 */
  pluginOptions: ChatPluginOption[];
  /** 当前已选中的插件 ID 列表。 */
  selectedPluginIds: string[];
  /** 切换当前会话插件选择。 */
  onPluginSelectionChange: (pluginIds: string[]) => void;
};

type CaseWorkspaceSectionProps = SharedChatPanelProps & {
  /** 案件列表。 */
  cases: CaseRecord[];
  /** 当前案件文件树。 */
  fileNodes: FileNode[];
  /** 案件历史是否仍在加载。 */
  isHistoryLoading: boolean;
  /** 案件历史最近一次加载失败的用户可见提示。 */
  historyLoadError?: string | null;
  /** 案件文件树是否仍在加载。 */
  isFilesLoading: boolean;
  /** 案件列表是否仍在加载。 */
  isLoading: boolean;
  /** 新建案件，并按用户勾选的材料目录模板创建子目录。 */
  onCreateCase: (name: string, folderNames: readonly string[]) => Promise<void>;
  /** 新建案件对话。 */
  onCreateConversation: () => void;
  /** 用户主动重新加载当前案件历史。 */
  onRetryHistory: () => void;
  /** 新建案件文件。 */
  onCreateCaseFile: (path: string) => Promise<void>;
  /** 新建案件文件夹。 */
  onCreateCaseFolder: (path: string) => Promise<void>;
  /** 复制案件文件。 */
  onCopyCaseFile: (path: string, newPath: string) => Promise<void>;
  /** 删除案件。 */
  onDeleteCase: (caseId: string) => Promise<void>;
  /** 删除案件文件。 */
  onDeleteCaseFile: (path: string) => Promise<void>;
  /** 导入外部路径到案件目录。 */
  onImportCasePaths: (parentPath: string | null, sourcePaths: string[]) => Promise<void>;
  /** 将案件材料加入当前聊天上下文。 */
  onAddCaseFileToChat: (node: FileNode) => void;
  /** 使用系统默认程序打开案件文件。 */
  onOpenCaseFile: (node: FileNode) => void;
  /** 在右侧预览案件文件。 */
  onPreviewCaseFile: (node: FileNode) => void;
  /** 刷新案件文件树。 */
  onRefreshFiles: () => Promise<void>;
  /** 在系统文件管理器中定位案件路径。 */
  onRevealCasePath: (node: FileNode) => void;
  /** 重命名案件。 */
  onRenameCase: (caseId: string, name: string) => Promise<void>;
  /** 重命名案件文件。 */
  onRenameCaseFile: (path: string, newPath: string) => Promise<void>;
  /** 打开指定案件历史会话。 */
  onSelectConversation: (sessionId: string) => Promise<void>;
  /** 切换当前选中的案件。 */
  onSelectCase: (caseId: string | null) => void;
  /** 上传文件到案件目录。 */
  onUploadCaseFiles: (parentPath: string | null, files: FileList) => Promise<void>;
  /** 当前选中的会话 ID。 */
  selectedSessionId: string;
  /** 当前选中的案件 ID。 */
  selectedCaseId: string | null;
  /** 当前案件会话列表。 */
  sessions: ChatSessionSummary[];
  /** 案件模式可选技能。 */
  skillOptions: ChatSkillOption[];
  /** 当前选中的技能名称。 */
  selectedSkillName: string | null;
  /** 切换当前技能。 */
  onSkillChange: (skillName: string) => void;
};

type ChatWorkspaceSectionProps = SharedChatPanelProps & {
  /** 普通对话历史是否仍在加载。 */
  isHistoryLoading: boolean;
  /** 普通对话历史最近一次加载失败的用户可见提示。 */
  historyLoadError?: string | null;
  /** 新建普通对话。 */
  onCreateConversation: () => void;
  /** 用户主动重新加载普通对话历史。 */
  onRetryHistory: () => void;
  /** 打开指定普通对话。 */
  onSelectConversation: (sessionId: string) => Promise<void>;
  /** 当前选中的会话 ID。 */
  selectedSessionId: string;
  /** 普通对话会话列表。 */
  sessions: ChatSessionSummary[];
};

type LibraryWorkspaceSectionProps = {
  /** 文件库标题。 */
  title: string;
  /** 当前文件库根目录。 */
  directory: string;
  /** 当前文件树。 */
  fileNodes: FileNode[];
  /** 当前选中的相对路径。 */
  selectedPath: string | null;
  /** 文件树是否仍在加载。 */
  isFilesLoading: boolean;
  /** 文件库图标。 */
  icon: LucideIcon;
  /** 复制文件库节点。 */
  onCopyFile: (path: string, newPath: string) => Promise<void>;
  /** 新建文件。 */
  onCreateFile: (path: string) => Promise<void>;
  /** 新建文件夹。 */
  onCreateFolder: (path: string) => Promise<void>;
  /** 删除文件。 */
  onDeleteFile: (path: string) => Promise<void>;
  /** 导入外部路径。 */
  onImportPaths: (parentPath: string | null, sourcePaths: string[]) => Promise<void>;
  /** 移动文件。 */
  onMoveFile: (path: string, newPath: string) => Promise<void>;
  /** 打开文件库根目录。 */
  onOpenDirectory: () => void;
  /** 用系统默认程序打开文件。 */
  onOpenFile: (node: FileNode) => void;
  /** 刷新文件树。 */
  onRefreshFiles: () => Promise<void>;
  /** 在系统文件管理器中定位文件。 */
  onRevealPath: (node: FileNode) => void;
  /** 重命名文件。 */
  onRenameFile: (path: string, newPath: string) => Promise<void>;
  /** 选中并预览文件。 */
  onSelectFile: (node: FileNode) => void;
  /** 上传文件。 */
  onUploadFiles: (parentPath: string | null, files: FileList) => Promise<void>;
  /** 远程法规下载完成后的刷新与预览回调，仅法规页传入。 */
  onRemoteLawDownloaded?: (path: string) => Promise<void>;
};

type SettingsWorkspaceSectionProps = {
  /** 当前应用配置。 */
  config: AppConfig | null;
  /** 登录提醒信号。 */
  loginPromptSignal: number;
  /** 手动检查更新。 */
  onCheckUpdate: () => Promise<void>;
  /** 安装已下载的更新。 */
  onInstallUpdate: () => Promise<void>;
  /** 保存应用配置。 */
  onSaveConfig: (nextConfig: Partial<AppConfig>) => Promise<void>;
  /** 切换主题模式。 */
  onThemeModeChange: (mode: ThemeMode) => void;
  /** 当前主题模式。 */
  themeMode: ThemeMode;
  /** 当前更新状态。 */
  updaterState: AppUpdaterState;
  /** 当前版本信息。 */
  versionInfo: AppVersionInfo;
};

type CalendarWorkspaceSectionProps = {
  /** 当前工作空间下的案件列表。 */
  cases: CaseRecord[];
  /** 当前选中的案件 ID。 */
  selectedCaseId: string | null;
  /** 切换当前选中的案件。 */
  onSelectCase: (caseId: string | null) => void;
  /** 当前解析后的系统主题模式（light | dark）。 */
  resolvedThemeMode?: "light" | "dark";
};

type ExtensionsWorkspaceSectionProps = {
  /** 当前模式。 */
  mode: ExtensionPanelMode;
  /** 当前工作空间下的案件列表。 */
  cases: CaseRecord[];
  /** 插件列表数据。 */
  pluginList: CodexPluginListResult | null;
  /** 是否正在加载插件数据。 */
  isPluginLoading: boolean;
  /** 当前插件页提示消息。 */
  pluginNotice: string | null;
  /** 刷新插件列表。 */
  onRefreshPlugins: () => Promise<void>;
  /** 安装单个插件。 */
  onInstallPlugin: (marketplacePath: string, pluginName: string) => Promise<void>;
  /** 切换插件启用状态。 */
  onSetPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
};

/** 扩展页装配入口，按左侧导航模式展示工具或插件页面。 */
export function ExtensionsWorkspaceSection({
  mode,
  cases,
  pluginList,
  isPluginLoading,
  pluginNotice,
  onRefreshPlugins,
  onInstallPlugin,
  onSetPluginEnabled,
}: ExtensionsWorkspaceSectionProps) {
  return (
    <ExtensionsPanel
      cases={cases}
      isPluginLoading={isPluginLoading}
      mode={mode}
      onInstallPlugin={onInstallPlugin}
      onRefreshPlugins={onRefreshPlugins}
      onSetPluginEnabled={onSetPluginEnabled}
      pluginList={pluginList}
      pluginNotice={pluginNotice}
    />
  );
}

/** 日历页装配入口，统一承接律师日历面板。 */
export function CalendarWorkspaceSection({
  cases,
  selectedCaseId,
  onSelectCase,
  resolvedThemeMode,
}: CalendarWorkspaceSectionProps) {
  return (
    <CalendarPanel
      cases={cases}
      onSelectCase={onSelectCase}
      resolvedThemeMode={resolvedThemeMode}
      selectedCaseId={selectedCaseId}
    />
  );
}

/** 案件页装配入口，统一承接案件面板和案件聊天面板的编排。 */
export function CaseWorkspaceSection({
  cases,
  fileNodes,
  historyLoadError,
  isHistoryLoading,
  isFilesLoading,
  isLoading,
  onAddCaseFileToChat,
  onCancel,
  onCompactContext,
  onClearContextAttachments,
  onCopyCaseFile,
  onCreateCase,
  onCreateCaseFile,
  onCreateCaseFolder,
  onCreateConversation,
  onDeleteCase,
  onDeleteCaseFile,
  onImportCasePaths,
  onOpenCaseFile,
  onPreviewCaseFile,
  onPreviewFile,
  onPreviewPanelToggle,
  onOpenUrl,
  onAddKnowledgeBaseReference,
  onApprovalDecision,
  onRefreshKnowledgeBase,
  onRefreshFiles,
  onRetryHistory,
  onRemoveContextAttachment,
  onRenameCase,
  onRenameCaseFile,
  onRevealCasePath,
  onSelectCase,
  onSelectConversation,
  onSend,
  onSkillChange,
  pendingApprovals,
  pluginOptions,
  selectedPluginIds,
  onPluginSelectionChange,
  onUploadCaseFiles,
  agentEnabled,
  chatPanelKey,
  contextAttachments,
  isPreviewCollapsed,
  isStreaming,
  canCompactContext,
  isHydratingHistory,
  knowledgeBaseSources,
  messages,
  selectedCaseId,
  selectedSessionId,
  selectedSkillName,
  sessionId,
  sessions,
  skillOptions,
  title,
}: CaseWorkspaceSectionProps) {
  return (
    <>
      <CasePanel
        agentEnabled={agentEnabled}
        cases={cases}
        fileNodes={fileNodes}
        historyLoadError={historyLoadError}
        isFilesLoading={isFilesLoading}
        isHistoryLoading={isHistoryLoading}
        isLoading={isLoading}
        onAddCaseFileToChat={onAddCaseFileToChat}
        onCopyCaseFile={onCopyCaseFile}
        onCreateCase={onCreateCase}
        onCreateCaseFile={onCreateCaseFile}
        onCreateCaseFolder={onCreateCaseFolder}
        onCreateConversation={onCreateConversation}
        onDeleteCase={onDeleteCase}
        onDeleteCaseFile={onDeleteCaseFile}
        onImportCasePaths={onImportCasePaths}
        onOpenCaseFile={onOpenCaseFile}
        onPreviewCaseFile={onPreviewCaseFile}
        onRefreshFiles={onRefreshFiles}
        onRetryHistory={onRetryHistory}
        onRenameCase={onRenameCase}
        onRenameCaseFile={onRenameCaseFile}
        onRevealCasePath={onRevealCasePath}
        onSelectCase={onSelectCase}
        onSelectConversation={onSelectConversation}
        onUploadCaseFiles={onUploadCaseFiles}
        selectedCaseId={selectedCaseId}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />
      <ChatPanel
        agentEnabled={agentEnabled}
        contextAttachments={contextAttachments}
        isHydratingHistory={isHydratingHistory}
        isPreviewCollapsed={isPreviewCollapsed}
        isStreaming={isStreaming}
        canCompactContext={canCompactContext}
        key={chatPanelKey}
        knowledgeBaseSources={knowledgeBaseSources}
        messages={messages}
        mode="case"
        onCancel={onCancel}
        onCompactContext={onCompactContext}
        onClearContextAttachments={onClearContextAttachments}
        onPreviewFile={onPreviewFile}
        onPreviewPanelToggle={onPreviewPanelToggle}
        onOpenUrl={onOpenUrl}
        onAddKnowledgeBaseReference={onAddKnowledgeBaseReference}
        onApprovalDecision={onApprovalDecision}
        onPluginSelectionChange={onPluginSelectionChange}
        pendingApprovals={pendingApprovals}
        onRefreshKnowledgeBase={onRefreshKnowledgeBase}
        onRemoveContextAttachment={onRemoveContextAttachment}
        onSend={onSend}
        onSkillChange={onSkillChange}
        pluginOptions={pluginOptions}
        selectedPluginIds={selectedPluginIds}
        selectedSkillName={selectedSkillName}
        sessionId={sessionId}
        skillOptions={skillOptions}
        title={title}
      />
    </>
  );
}

/** 普通对话页装配入口，统一承接历史列表和聊天面板。 */
export function ChatWorkspaceSection({
  historyLoadError,
  isHistoryLoading,
  onCancel,
  onCompactContext,
  onClearContextAttachments,
  onCreateConversation,
  onPreviewFile,
  onPreviewPanelToggle,
  onOpenUrl,
  onAddKnowledgeBaseReference,
  onApprovalDecision,
  onRefreshKnowledgeBase,
  onRetryHistory,
  onRemoveContextAttachment,
  onSelectConversation,
  onSend,
  pendingApprovals,
  pluginOptions,
  selectedPluginIds,
  onPluginSelectionChange,
  agentEnabled,
  chatPanelKey,
  contextAttachments,
  isPreviewCollapsed,
  isStreaming,
  canCompactContext,
  isHydratingHistory,
  knowledgeBaseSources,
  messages,
  selectedSessionId,
  sessionId,
  sessions,
  title,
}: ChatWorkspaceSectionProps) {
  return (
    <>
      <ConversationHistoryPanel
        agentEnabled={agentEnabled}
        isLoading={isHistoryLoading}
        loadError={historyLoadError}
        onCreateConversation={onCreateConversation}
        onSelectConversation={onSelectConversation}
        onRetry={onRetryHistory}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />
      <ChatPanel
        agentEnabled={agentEnabled}
        contextAttachments={contextAttachments}
        isHydratingHistory={isHydratingHistory}
        isPreviewCollapsed={isPreviewCollapsed}
        isStreaming={isStreaming}
        canCompactContext={canCompactContext}
        key={chatPanelKey}
        knowledgeBaseSources={knowledgeBaseSources}
        messages={messages}
        mode="chat"
        onCancel={onCancel}
        onCompactContext={onCompactContext}
        onClearContextAttachments={onClearContextAttachments}
        onPreviewFile={onPreviewFile}
        onPreviewPanelToggle={onPreviewPanelToggle}
        onOpenUrl={onOpenUrl}
        onAddKnowledgeBaseReference={onAddKnowledgeBaseReference}
        onApprovalDecision={onApprovalDecision}
        onPluginSelectionChange={onPluginSelectionChange}
        pendingApprovals={pendingApprovals}
        onRefreshKnowledgeBase={onRefreshKnowledgeBase}
        onRemoveContextAttachment={onRemoveContextAttachment}
        onSend={onSend}
        pluginOptions={pluginOptions}
        selectedPluginIds={selectedPluginIds}
        sessionId={sessionId}
        title={title}
      />
    </>
  );
}

/** 文件库页装配入口，负责把不同文件库的命令接到统一面板。 */
export function LibraryWorkspaceSection({
  directory,
  fileNodes,
  icon,
  isFilesLoading,
  onCopyFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onImportPaths,
  onMoveFile,
  onOpenDirectory,
  onOpenFile,
  onRefreshFiles,
  onRenameFile,
  onRevealPath,
  onSelectFile,
  onUploadFiles,
  onRemoteLawDownloaded,
  selectedPath,
  title,
}: LibraryWorkspaceSectionProps) {
  return (
    <LibraryPanel
      directory={directory}
      fileNodes={fileNodes}
      icon={icon}
      isFilesLoading={isFilesLoading}
      onCopyFile={onCopyFile}
      onCreateFile={onCreateFile}
      onCreateFolder={onCreateFolder}
      onDeleteFile={onDeleteFile}
      onImportPaths={onImportPaths}
      onMoveFile={onMoveFile}
      onOpenDirectory={onOpenDirectory}
      onOpenFile={onOpenFile}
      onRefreshFiles={onRefreshFiles}
      onRenameFile={onRenameFile}
      onRevealPath={onRevealPath}
      onSelectFile={onSelectFile}
      onUploadFiles={onUploadFiles}
      onRemoteLawDownloaded={onRemoteLawDownloaded}
      selectedPath={selectedPath}
      title={title}
    />
  );
}

/** 设置页装配入口，避免主应用壳继续直接拼接设置面板参数。 */
export function SettingsWorkspaceSection({
  config,
  loginPromptSignal,
  onCheckUpdate,
  onInstallUpdate,
  onSaveConfig,
  onThemeModeChange,
  themeMode,
  updaterState,
  versionInfo,
}: SettingsWorkspaceSectionProps) {
  return (
    <SettingsPanel
      config={config}
      loginPromptSignal={loginPromptSignal}
      onCheckUpdate={onCheckUpdate}
      onInstallUpdate={onInstallUpdate}
      onSaveConfig={onSaveConfig}
      onThemeModeChange={onThemeModeChange}
      themeMode={themeMode}
      updaterState={updaterState}
      versionInfo={versionInfo}
    />
  );
}
