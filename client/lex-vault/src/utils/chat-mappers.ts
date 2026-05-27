import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";

import { AGENT_PROCESS_TOOL_NAME } from "@/constants/agent";
import type { CodexTurnAttachmentInput } from "@/types/codex";
import type { ChatAttachment, ChatMessage, ChatProcessItem, ChatToolCall } from "@/types/domain";

type ThreadContentPart = Extract<ThreadMessageLike["content"], readonly unknown[]>[number];

/** 将任意值压缩为适合 UI 展示和协议发送的文本。 */
export function compactText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 将时间格式化为当天会话列表和消息底部使用的短时间。 */
export function shortTimeLabel(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 将时间格式化为会话列表展示标签。 */
export function dateLabel(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) {
    return shortTimeLabel(value);
  }

  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

/** 将 assistant-ui 的附件压缩成可持久化的前端摘要，避免历史记录保存大文件正文。 */
export function appendMessageToAttachments(message: AppendMessage): ChatAttachment[] {
  return (message.attachments ?? []).map((attachment) => {
    const extendedAttachment = attachment as unknown as {
      file?: File;
      size?: unknown;
      url?: unknown;
      thumbnailUrl?: unknown;
      previewUrl?: unknown;
      path?: unknown;
      rootPath?: unknown;
      relativePath?: unknown;
      nodeType?: unknown;
      sourceLabel?: unknown;
    };
    return {
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      contentType: attachment.contentType,
      size:
        typeof extendedAttachment.size === "number"
          ? extendedAttachment.size
          : typeof extendedAttachment.file?.size === "number"
            ? extendedAttachment.file.size
            : undefined,
      url: typeof extendedAttachment.url === "string" ? extendedAttachment.url : undefined,
      thumbnailUrl:
        typeof extendedAttachment.thumbnailUrl === "string"
          ? extendedAttachment.thumbnailUrl
          : typeof extendedAttachment.previewUrl === "string"
            ? extendedAttachment.previewUrl
            : undefined,
      path: typeof extendedAttachment.path === "string" ? extendedAttachment.path : undefined,
      rootPath: typeof extendedAttachment.rootPath === "string" ? extendedAttachment.rootPath : undefined,
      relativePath: typeof extendedAttachment.relativePath === "string" ? extendedAttachment.relativePath : undefined,
      nodeType:
        extendedAttachment.nodeType === "folder" || extendedAttachment.nodeType === "file"
          ? extendedAttachment.nodeType
          : undefined,
      sourceLabel: typeof extendedAttachment.sourceLabel === "string" ? extendedAttachment.sourceLabel : undefined,
    };
  });
}

/** 将消息时间格式化为悬浮完整时间。 */
export function fullDateTimeLabel(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 只把最新一条用户消息之后的 assistant 视为当前轮次回复，避免新一轮开始时误点亮上一轮“正在思考”。 */
export function latestAssistantIdAfterLatestUser(messages: ChatMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index]?.id;
    }
  }

  return undefined;
}

/** 发送已开始但首条 assistant 事件尚未返回时，补一个临时空消息占位，避免线程区完全空白。 */
export function withStreamingAssistantPlaceholder(messages: ChatMessage[], isStreaming: boolean) {
  if (!isStreaming || latestAssistantIdAfterLatestUser(messages)) {
    return messages;
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return messages;
  }

  return [
    ...messages,
    {
      id: `assistant-pending-${lastMessage.id}`,
      role: "assistant" as const,
      content: "",
      createdAt: new Date().toISOString(),
    },
  ];
}

/** 将 assistant-ui 的结构化发送消息还原为后端需要的纯文本 message。 */
export function appendMessageToText(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** 将用户可见问题文本和附件正文拆开，保证气泡只展示用户输入本身。 */
export function appendMessageToVisibleText(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** 将输入区中的浏览器附件转换为发给 Rust 桥接层的结构化载荷。 */
export async function appendMessageToInputAttachments(message: AppendMessage): Promise<CodexTurnAttachmentInput[]> {
  const attachments = message.attachments ?? [];
  const results = await Promise.all(attachments.map(async (attachment) => {
    const extendedAttachment = attachment as unknown as {
      file?: File;
      path?: unknown;
      url?: unknown;
    };
    const file = extendedAttachment.file;
    const kind = attachment.type === "image" ? "image" : attachment.type === "document" ? "document" : "file";
    return {
      id: attachment.id,
      name: attachment.name,
      kind,
      source: "composer" as const,
      mimeType: attachment.contentType || file?.type || undefined,
      size: typeof file?.size === "number" ? file.size : undefined,
      path: typeof extendedAttachment.path === "string" ? extendedAttachment.path : undefined,
      url: typeof extendedAttachment.url === "string" ? extendedAttachment.url : undefined,
      bytes: file ? Array.from(new Uint8Array(await file.arrayBuffer())) : undefined,
    } satisfies CodexTurnAttachmentInput;
  }));
  return results;
}

/** 将持久化附件摘要恢复为 assistant-ui 用户消息附件，历史区只展示名称不携带大正文。 */
function chatAttachmentsToThreadAttachments(attachments?: ChatAttachment[]) {
  return (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    contentType: attachment.contentType,
    size: attachment.size,
    url: attachment.url,
    thumbnailUrl: attachment.thumbnailUrl,
    path: attachment.path,
    rootPath: attachment.rootPath,
    relativePath: attachment.relativePath,
    nodeType: attachment.nodeType,
    sourceLabel: attachment.sourceLabel,
    status: { type: "complete" as const },
    content: [
      {
        type: "text" as const,
        text: `<attachment name="${attachment.name}">\n附件内容已随提问发送，历史记录仅保留附件摘要。\n</attachment>`,
      },
    ],
  }));
}

/** 没有显式有序过程项时，用旧字段构造兼容序列，避免历史数据出现空过程。 */
function normalizedProcessItems(
  processItems: ChatProcessItem[] | undefined,
  processText: string | undefined,
  toolCalls: ChatToolCall[],
) {
  if (processItems?.length) {
    return [...processItems].sort((left, right) => left.order - right.order);
  }

  const fallbackItems: ChatProcessItem[] = [];
  if (processText?.trim()) {
    fallbackItems.push({
      id: "process-text",
      type: "text",
      order: 0,
      text: processText,
    });
  }
  toolCalls.forEach((toolCall, index) => {
    fallbackItems.push({
      id: `process-tool-${toolCall.id}`,
      type: "tool",
      order: index + 1,
      toolCall,
    });
  });
  return fallbackItems;
}

/** 将单个工具过程转成 assistant-ui tool-call part，保持它在原始过程链路中的位置。 */
function toolCallToPart(toolCall: ChatToolCall, messageId: string): ThreadContentPart {
  const running = toolCall.status === "running";
  const args = JSON.parse(JSON.stringify({
    title: toolCall.name || toolCall.kind || "工具调用",
    kind: toolCall.kind || "tool",
    command: toolCall.command,
    path: toolCall.path,
  }));
  const resultPayload = JSON.parse(JSON.stringify({
    status: toolCall.status,
    outputPreview: toolCall.outputPreview,
  }));

  return {
    type: "tool-call" as const,
    toolCallId: toolCall.id || `tool-${messageId}`,
    toolName: toolCall.kind || toolCall.name || "tool",
    args,
    argsText: JSON.stringify(args),
    result: running ? undefined : resultPayload,
    isError: toolCall.status === "error",
  };
}

/** 把 Codex 原始 item 顺序包装成一个可折叠过程区，内部继续按文字、命令、文字展示。 */
function chatProcessToPart(
  message: ChatMessage,
  toolCalls: ChatToolCall[],
  running: boolean,
): ThreadContentPart {
  const visibleProcessText =
    message.content.trim() && message.processText?.trim() === message.content.trim()
      ? ""
      : message.processText;
  const items = normalizedProcessItems(message.processItems, visibleProcessText, toolCalls);
  const processText = items
    .filter((item) => item.type === "text")
    .sort((left, right) => left.order - right.order)
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  const args = JSON.parse(JSON.stringify({
    processText,
    processMeta: message.processMeta,
    processItems: items,
    steps: toolCalls,
    stepCount: toolCalls.length,
  }));
  const resultPayload = JSON.parse(JSON.stringify({
    ...args,
    status: toolCalls.some((toolCall) => toolCall.status === "error") ? "error" : "complete",
  }));

  return {
    type: "tool-call" as const,
    toolCallId: `process-${message.id}`,
    toolName: AGENT_PROCESS_TOOL_NAME,
    args,
    argsText: JSON.stringify(args),
    result: running ? undefined : resultPayload,
    isError: toolCalls.some((toolCall) => toolCall.status === "error"),
  };
}

/** 将现有本机会话消息桥接为 assistant-ui 可识别的线程消息。 */
export function chatMessageToThreadMessage(
  message: ChatMessage,
  index: number,
  isRunning: boolean,
  latestAssistantId?: string,
): ThreadMessageLike {
  const createdAt = new Date(message.createdAt);
  const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
  const isAssistantRunning =
    (isRunning && message.role === "assistant" && message.id === latestAssistantId)
    || Boolean(message.toolCalls?.some((toolCall) => toolCall.status === "running"));
  const assistantContent =
    message.role === "error" ? "【执行出错】" + message.content : message.content;
  const hasDistinctProcessText = Boolean(
    message.processText?.trim() && message.processText.trim() !== assistantContent.trim(),
  );
  const assistantParts: ThreadContentPart[] = [
    ...(message.processItems?.length || message.toolCalls?.length || hasDistinctProcessText
      ? [chatProcessToPart(message, message.toolCalls ?? [], isAssistantRunning)]
      : []),
    ...(assistantContent.trim()
      ? [
          {
            type: "text" as const,
            text: assistantContent,
          },
        ]
      : []),
  ];
  const assistantStatus =
    message.role === "tool" && message.toolStatus === "running"
      ? { type: "running" as const }
      : isAssistantRunning
        ? { type: "running" as const }
        : message.role === "error"
          ? { type: "incomplete" as const, reason: "error" as const, error: message.content }
          : { type: "complete" as const, reason: "stop" as const };

  return {
    id: message.id || "message-" + index,
    role: message.role === "user" ? "user" : "assistant",
    content:
      message.role === "user"
        ? message.content
        : message.role === "tool"
          ? [
              toolCallToPart(
                {
                  id: message.toolId || message.id,
                  name: message.toolName || message.content,
                  kind: message.toolKind,
                  status: message.toolStatus || "complete",
                  command: message.command,
                  path: message.path,
                  outputPreview: message.outputPreview,
                },
                message.id,
              ),
            ]
        : assistantParts,
    createdAt: safeCreatedAt,
    metadata: {
      custom: {
        createdAtLabel: shortTimeLabel(message.createdAt),
        createdAtTitle: fullDateTimeLabel(message.createdAt),
      },
    },
    ...(message.role === "user" ? { attachments: chatAttachmentsToThreadAttachments(message.attachments) } : {}),
    ...(message.role !== "user"
      ? {
          status: assistantStatus,
        }
      : {}),
  };
}
