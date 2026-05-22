import { createContext } from "react";

import type { ChatAttachment } from "@/types/domain";

/** 小隐处理过程的起止时间和耗时摘要。 */
export type ProcessMeta = {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

/** 处理过程中的单个工具步骤。 */
export type ProcessStep = {
  id: string;
  name: string;
  kind?: string;
  status: "running" | "complete" | "error";
  command?: string;
  path?: string;
  outputPreview?: string;
};

/** 处理过程区里按顺序展示的文本或工具项。 */
export type ProcessItem = {
  id: string;
  type: "text" | "tool";
  order: number;
  text?: string;
  toolCall?: ProcessStep;
};

/** assistant-ui 工具卡片中回传的小隐处理过程聚合载荷。 */
export type ProcessPayload = {
  processText: string;
  processMeta?: ProcessMeta;
  processItems: ProcessItem[];
  steps: ProcessStep[];
};

/** 右侧预览面板需要的附件扩展信息。 */
export type PreviewAttachmentPayload = ChatAttachment & {
  /** 本次点击来自持久化消息附件还是输入区案件材料路径。 */
  sourceLabel?: string;
};

/** 聊天面板场景类型，用于区分普通对话与案件对话的空状态文案。 */
export type ChatPanelMode = "chat" | "case";

/** 根据当前滚动位置决定显示的快捷按钮类型。 */
export type ScrollShortcutMode = "bottom" | "top" | null;

/** 消息附件点击后，通过上下文把预览能力传给子组件。 */
export const FilePreviewCallbackContext = createContext<((attachment: PreviewAttachmentPayload) => void) | null>(null);

/** Markdown 链接点击后，通过上下文把系统浏览器打开动作传给子组件。 */
export const UrlOpenCallbackContext = createContext<((url: string, title?: string, openExternally?: boolean) => void) | null>(null);
