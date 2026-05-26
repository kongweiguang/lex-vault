import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, type AppendMessage, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { Bot, Archive, Info, LoaderCircle, PanelRightClose, PanelRightOpen } from "lucide-react";

import type { FilePreviewTarget } from "@/components/files/FilePreviewPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatComposer, chatAttachmentAdapter, contextAttachmentToPrompt } from "@/features/chat/components/chat-composer";
import { EmptyChat } from "@/features/chat/components/chat-empty-state";
import { KnowledgeBaseDialog } from "@/features/chat/components/KnowledgeBaseDialog";
import type { KnowledgeBaseSource } from "@/features/chat/components/knowledge-base-helpers";
import { AssistantMessage, UserMessage } from "@/features/chat/components/chat-message-parts";
import { previewTargetFromAttachment } from "@/features/chat/components/chat-markdown";
import { ThreadScrollShortcut } from "@/features/chat/components/thread-scroll-shortcut";
import {
  FilePreviewCallbackContext,
  type ChatPanelMode,
  type PreviewAttachmentPayload,
  UrlOpenCallbackContext,
} from "@/features/chat/chat-panel-types";
import type { CodexApprovalDecision, CodexApprovalRequest, CodexTurnAttachmentInput } from "@/types/codex";
import type { ChatAttachment, ChatMessage, ChatPluginOption, ChatSkillOption } from "@/types/domain";
import {
  appendMessageToAttachments,
  appendMessageToInputAttachments,
  appendMessageToText,
  appendMessageToVisibleText,
  chatMessageToThreadMessage,
  latestAssistantIdAfterLatestUser,
} from "@/utils/chat-mappers";

export function ChatPanel({
  mode = "chat",
  contextAttachments = [],
  isPreviewCollapsed,
  sessionId,
  transientNotice,
  title,
  messages,
  isStreaming,
  isHydratingHistory,
  onCancel,
  onCompactContext,
  onClearContextAttachments,
  onRemoveContextAttachment,
  onPreviewFile,
  onOpenUrl,
  onPreviewPanelToggle,
  onAddKnowledgeBaseReference,
  onApprovalDecision,
  onRefreshKnowledgeBase,
  onSend,
  agentEnabled,
  canCompactContext = false,
  knowledgeBaseSources = [],
  skillOptions = [],
  selectedSkillName,
  onSkillChange,
  pluginOptions = [],
  pendingApprovals = [],
  selectedPluginIds = [],
  onPluginSelectionChange,
}: {
  /** 当前聊天面板属于普通对话还是案件对话。 */
  mode?: ChatPanelMode;
  sessionId: string;
  transientNotice?: { id: string; message: string } | null;
  title: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** 当前选中的历史会话是否仍在异步回填完整内容。 */
  isHydratingHistory: boolean;
  /** 从案件材料右键加入、等待随下一轮问题发送的路径上下文。 */
  contextAttachments?: ChatAttachment[];
  /** 右侧文件预览面板是否折叠。 */
  isPreviewCollapsed: boolean;
  onCancel: () => Promise<void>;
  /** 触发当前单个会话的上下文压缩。 */
  onCompactContext?: () => Promise<void>;
  /** 清空已经随本轮发送进入 prompt 的案件材料路径上下文。 */
  onClearContextAttachments?: () => void;
  /** 移除单个等待发送的案件材料路径上下文。 */
  onRemoveContextAttachment?: (attachmentId: string) => void;
  /** 用户点击消息附件或案件材料时打开右侧预览。 */
  onPreviewFile: (target: FilePreviewTarget) => void;
  /** 用户点击聊天 Markdown URL 时交给系统浏览器打开。 */
  onOpenUrl: (url: string, title?: string, openExternally?: boolean) => void;
  /** 折叠或展开右侧文件预览面板。 */
  onPreviewPanelToggle: () => void;
  /** 将知识库文件加入当前输入区引用。 */
  onAddKnowledgeBaseReference: (attachment: ChatAttachment) => void;
  /** 用户在输入框上方处理 Codex 审批。 */
  onApprovalDecision: (request: CodexApprovalRequest, decision: CodexApprovalDecision) => Promise<void>;
  /** 刷新对话框知识库弹层展示的全部文件库。 */
  onRefreshKnowledgeBase: () => Promise<void>;
  onSend: (
    prompt: string,
    visiblePrompt?: string,
    attachments?: ChatAttachment[],
    inputAttachments?: CodexTurnAttachmentInput[],
  ) => Promise<void>;
  /** Agent 能力是否已经接入。 */
  agentEnabled: boolean;
  /** 当前会话是否已经绑定到可压缩的 Codex thread。 */
  canCompactContext?: boolean;
  /** 对话框底部知识库按钮展示的文件库来源。 */
  knowledgeBaseSources?: KnowledgeBaseSource[];
  /** 当前对话可选技能；为空时隐藏技能选择。 */
  skillOptions?: ChatSkillOption[];
  /** 当前选中的 skill 名称。 */
  selectedSkillName?: string | null;
  /** 切换技能时通知上层，下一次发送案件对话会使用新技能。 */
  onSkillChange?: (skillName: string) => void;
  /** 当前对话可选插件。 */
  pluginOptions?: ChatPluginOption[];
  /** 当前会话等待处理的 Codex 审批请求。 */
  pendingApprovals?: CodexApprovalRequest[];
  /** 当前会话已选中的插件 ID。 */
  selectedPluginIds?: string[];
  /** 切换当前会话插件选择。 */
  onPluginSelectionChange?: (pluginIds: string[]) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] = useState(false);
  const [visibleTransientNotice, setVisibleTransientNotice] = useState(transientNotice);
  const latestAssistantId = latestAssistantIdAfterLatestUser(messages);
  const scrollShortcutRefreshKey = `${messages.length}-${isStreaming}-${latestAssistantId ?? "none"}`;
  const loadingHistoryTitle = messages.length ? "正在刷新历史记录" : "正在加载历史记录";
  const loadingHistoryDescription = messages.length
    ? "正在读取完整过程链路和最终结果，请稍等一下。"
    : "正在回填这条会话的完整内容，请稍等一下。";

  useEffect(() => {
    setVisibleTransientNotice(transientNotice);
  }, [transientNotice]);

  useEffect(() => {
    if (!visibleTransientNotice) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setVisibleTransientNotice((current) => (current?.id === visibleTransientNotice.id ? null : current));
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [visibleTransientNotice]);

  const convertMessage = useCallback(
    (message: ChatMessage, index: number) =>
      chatMessageToThreadMessage(message, index, isStreaming, latestAssistantId),
    [isStreaming, latestAssistantId],
  );

  const handleNewMessage = useCallback(
    async (message: AppendMessage) => {
      const prompt = appendMessageToText(message);
      const visiblePrompt = appendMessageToVisibleText(message);
      const inputAttachments = await appendMessageToInputAttachments(message);
      const messageAttachments = appendMessageToAttachments(message);
      const contextText = contextAttachments.map(contextAttachmentToPrompt).filter(Boolean).join("\n\n");
      const nextPrompt = [prompt, contextText].filter(Boolean).join("\n\n");
      const attachments = [...messageAttachments, ...contextAttachments];
      if (nextPrompt || inputAttachments.length) {
        await onSend(nextPrompt, visiblePrompt || prompt, attachments, inputAttachments);
        onClearContextAttachments?.();
      }
    },
    [contextAttachments, onClearContextAttachments, onSend],
  );

  /** 空态推荐问题不经过 composer 状态同步，直接复用同一条业务发送链路。 */
  const handleRecommendedQuestionSend = useCallback(
    async (prompt: string, visiblePrompt: string) => {
      await onSend(prompt, visiblePrompt, contextAttachments);
      onClearContextAttachments?.();
    },
    [contextAttachments, onClearContextAttachments, onSend],
  );

  const runtime = useExternalStoreRuntime({
    isRunning: isStreaming,
    // 对话消息由业务状态维护，assistant-ui 负责交互语义、滚动和 part 渲染。
    messages,
    convertMessage,
    onCancel,
    onNew: handleNewMessage,
    adapters: {
      attachments: chatAttachmentAdapter,
    },
  });

  const handlePreviewAttachment = useCallback(
    (attachment: PreviewAttachmentPayload) => {
      const target = previewTargetFromAttachment(attachment);
      if (!target) {
        return;
      }
      onPreviewFile(target);
    },
    [onPreviewFile],
  );

  return (
    <FilePreviewCallbackContext.Provider value={handlePreviewAttachment}>
      <UrlOpenCallbackContext.Provider value={onOpenUrl}>
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[#f8fafc] shadow-sm lg:min-h-0">
            <header className="flex min-h-[66px] shrink-0 items-center justify-between gap-3 border-b bg-white px-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-[#1d4ed8] text-white">
                  <Bot className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-slate-900">AI 法律助手</h1>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{agentEnabled ? title || sessionId : "Agent 未启用"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="压缩当前会话上下文"
                  disabled={!agentEnabled || !canCompactContext || isStreaming}
                  onClick={() => void onCompactContext?.()}
                  size="icon"
                  title={canCompactContext ? "压缩当前会话上下文" : "发送一轮问题后才能压缩上下文"}
                  type="button"
                  variant="ghost"
                >
                  <Archive />
                </Button>
                <Button
                  aria-label={isPreviewCollapsed ? "展开文件预览" : "折叠文件预览"}
                  onClick={onPreviewPanelToggle}
                  size="icon"
                  title={isPreviewCollapsed ? "展开文件预览" : "折叠文件预览"}
                  type="button"
                  variant="ghost"
                >
                  {isPreviewCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
                </Button>
              </div>
            </header>

            <div className="relative min-h-0 flex-1">
              {visibleTransientNotice ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
                  <div className="flex max-w-2xl items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/96 px-4 py-3 text-sm text-amber-900 shadow-lg shadow-amber-100/80 backdrop-blur-sm">
                    <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <p className="leading-6">{visibleTransientNotice.message}</p>
                  </div>
                </div>
              ) : null}
              {isHydratingHistory ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-50/72 px-6 py-10 backdrop-blur-[2px]">
                  <div className="flex w-full max-w-sm animate-in fade-in zoom-in-95 duration-200 flex-col items-center rounded-2xl border border-slate-200 bg-white/96 px-6 py-8 text-center shadow-lg shadow-slate-200/70">
                    <div className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-[#1d4ed8]">
                      <LoaderCircle className="size-5 animate-spin" />
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-slate-900">{loadingHistoryTitle}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{loadingHistoryDescription}</p>
                    <div className="mt-5 flex w-40 items-center gap-1.5">
                      <span className="h-1.5 flex-1 animate-pulse rounded-full bg-blue-200" />
                      <span className="h-1.5 flex-1 animate-pulse rounded-full bg-blue-300 [animation-delay:120ms]" />
                      <span className="h-1.5 flex-1 animate-pulse rounded-full bg-blue-400 [animation-delay:240ms]" />
                    </div>
                  </div>
                </div>
              ) : null}
              <ThreadPrimitive.Viewport
                autoScroll
                className="chat-scrollbar flex h-full flex-col overflow-x-hidden overflow-y-auto"
                ref={viewportRef}
              >
                <EmptyChat
                  agentEnabled={agentEnabled}
                  contextAttachments={contextAttachments}
                  hidden={isHydratingHistory && messages.length === 0}
                  mode={mode}
                  onQuestionSelect={handleRecommendedQuestionSend}
                />
                <div className={cn("mx-auto w-full max-w-5xl", messages.length ? "py-2" : "")}>
                  <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
                </div>
              </ThreadPrimitive.Viewport>
              <div className="pointer-events-none absolute bottom-4 right-4 z-20">
                <ThreadScrollShortcut refreshKey={scrollShortcutRefreshKey} viewportRef={viewportRef} />
              </div>
            </div>

            <footer className="relative z-30 shrink-0 border-t bg-white p-3 sm:p-4">
              <ChatComposer
                agentEnabled={agentEnabled}
                contextAttachments={contextAttachments}
                isStreaming={isStreaming}
                onKnowledgeBaseOpen={() => setIsKnowledgeBaseOpen(true)}
                onApprovalDecision={onApprovalDecision}
                onPluginSelectionChange={onPluginSelectionChange}
                onRemoveContextAttachment={onRemoveContextAttachment ?? (() => undefined)}
                onSkillChange={onSkillChange}
                pluginOptions={pluginOptions}
                pendingApprovals={pendingApprovals}
                selectedPluginIds={selectedPluginIds}
                selectedSkillName={selectedSkillName}
                skillOptions={skillOptions}
              />
            </footer>
            {isKnowledgeBaseOpen ? (
              <KnowledgeBaseDialog
                onClose={() => setIsKnowledgeBaseOpen(false)}
                onAddReference={onAddKnowledgeBaseReference}
                onRefresh={onRefreshKnowledgeBase}
                sources={knowledgeBaseSources}
              />
            ) : null}
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </UrlOpenCallbackContext.Provider>
    </FilePreviewCallbackContext.Provider>
  );
}

export type { ChatPanelMode } from "@/features/chat/chat-panel-types";
