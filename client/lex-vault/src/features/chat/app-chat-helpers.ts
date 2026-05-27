import type { CodexThreadRecord, CodexToolCallInfo, CodexToolCallResult } from "@/types/codex";
import type {
  ChatAttachment,
  ChatMessage,
  ChatProcessItem,
  ChatSessionSummary,
  ChatTextSegment,
  ChatToolCall,
  SessionContext,
} from "@/types/domain";
import { compactText, dateLabel } from "@/utils/chat-mappers";

/** 将同一个 Codex turn 的 assistant 增量直接写入正文，保持 Codex/GPT 风格的原位流式回复。 */
export function appendAssistantDelta(
  messages: ChatMessage[],
  turnId: string | undefined,
  itemId: string | undefined,
  text: string,
) {
  const targetIndex = findAssistantMessageIndex(messages, turnId);
  if (targetIndex >= 0) {
    return messages.map((message, index) =>
      index === targetIndex
        ? {
            ...message,
            ...withAssistantTextDelta(removeLiveProcessTextByItemId(message, itemId), turnId, itemId, text),
          }
        : message,
    );
  }

  const createdAt = new Date().toISOString();
  const initialSegments = appendAssistantTextSegments([], turnId, itemId, text);
  return [
    ...messages,
    {
      id: `assistant-${turnId ?? Date.now()}`,
      role: "assistant" as const,
      turnId,
      assistantTextSegments: initialSegments,
      content: joinAssistantTextSegments(initialSegments),
      createdAt,
    },
  ];
}

/** 完整 assistant 消息用于修正最终正文；工具和过程仍保留在同一响应框顶部。 */
export function completeAssistantMessage(
  messages: ChatMessage[],
  turnId: string | undefined,
  itemId: string | undefined,
  text: string | undefined,
) {
  const cleanedMessages = removeRuntimeStatus(messages);
  const targetIndex = findAssistantMessageIndex(cleanedMessages, turnId);
  const completedAt = new Date().toISOString();
  const finalText = text?.trim();
  if (targetIndex < 0) {
    if (!finalText) {
      return cleanedMessages;
    }
    const initialSegments = completeAssistantTextSegments([], turnId, itemId, finalText);
    return [
      ...cleanedMessages,
      {
        id: `assistant-completed-${turnId ?? Date.now()}`,
        role: "assistant" as const,
        turnId,
        assistantTextSegments: initialSegments,
        content: joinAssistantTextSegments(initialSegments),
        processMeta: { startedAt: completedAt, completedAt, durationMs: 0 },
        createdAt: completedAt,
      },
    ];
  }

  const target = cleanedMessages[targetIndex];
  const content = finalText ?? target.content ?? "";

  return cleanedMessages.map((message, index) =>
    index === targetIndex
      ? (() => {
          const cleanedMessage = removeLiveProcessTextByItemId(message, itemId);
          const nextSegments = finalText
            ? completeAssistantTextSegments(existingAssistantTextSegments(cleanedMessage), turnId, itemId, finalText)
            : existingAssistantTextSegments(cleanedMessage);
          return {
            ...cleanedMessage,
            assistantTextSegments: nextSegments,
            content: nextSegments?.length ? joinAssistantTextSegments(nextSegments) : content,
            processMeta: hasAssistantProcess(cleanedMessage)
              ? completeProcessMeta(cleanedMessage, completedAt)
              : cleanedMessage.processMeta,
          };
        })()
      : message,
  );
}

export function removeRuntimeStatus(messages: ChatMessage[]) {
  return messages.filter((message) => !message.id.startsWith("runtime-status-"));
}

/** 生成稳定工具调用 ID，保证同一个工具开始和完成事件能合并到同一过程项。 */
function toolMessageId(itemId: string | undefined, turnId: string | undefined, kind: string) {
  return `tool-${itemId || `${turnId || "unknown"}-${kind}`}`;
}

/** 把底层工具类型和可选 toolName 转成面向用户的短标题，避免直接暴露内部事件名。 */
function toolDisplayName(kind: string, toolName?: string) {
  const normalizedToolName = toolName?.trim();
  if (kind === "mcpToolCall") {
    return normalizedToolName ? `调用工具：${normalizedToolName}工具` : "调用工具";
  }
  return `小隐工具：${kind}`;
}

/** 把工具开始事件挂到同一轮 assistant 回复上，保持一问一答只有一个响应框。 */
export function upsertAssistantToolCall(messages: ChatMessage[], item: CodexToolCallInfo) {
  const toolCall: ChatToolCall = {
    id: toolMessageId(item.itemId, item.turnId, item.kind),
    name: item.title,
    kind: item.kind,
    status: "running",
    command: item.command,
    path: item.path,
  };
  const targetIndex = findAssistantMessageIndex(messages, item.turnId);

  if (targetIndex >= 0) {
    return messages.map((message, index) =>
      index === targetIndex
        ? {
            ...message,
            processMeta: ensureProcessStarted(message),
            toolCalls: upsertToolCall(message.toolCalls ?? [], toolCall),
            processItems: upsertProcessToolItem(message.processItems, toolCall),
          }
        : message,
    );
  }

  const createdAt = new Date().toISOString();
  return [
    ...messages,
    {
      id: `assistant-${item.turnId ?? Date.now()}`,
      role: "assistant" as const,
      turnId: item.turnId,
      content: "",
      processMeta: { startedAt: createdAt },
      createdAt,
      toolCalls: [toolCall],
      processItems: [processToolItem(toolCall, 0)],
    },
  ];
}

/** 将命令输出增量实时追加到同一轮 assistant 的工具过程里，避免只能在 completed 时整块替换。 */
export function appendAssistantToolOutputDelta(
  messages: ChatMessage[],
  item: { turnId: string; itemId?: string; kind: string; delta: string },
) {
  if (!item.delta) {
    return messages;
  }
  const toolId = toolMessageId(item.itemId, item.turnId, item.kind);
  const targetIndex = findAssistantMessageIndex(messages, item.turnId);

  if (targetIndex < 0) {
    const createdAt = new Date().toISOString();
    const toolCall: ChatToolCall = {
      id: toolId,
      name: item.kind,
      kind: item.kind,
      status: "running",
      outputPreview: item.delta,
    };
    return [
      ...messages,
      {
        id: `assistant-${item.turnId ?? Date.now()}`,
        role: "assistant" as const,
        turnId: item.turnId,
        content: "",
        processMeta: { startedAt: createdAt },
        createdAt,
        toolCalls: [toolCall],
        processItems: [processToolItem(toolCall, 0)],
      },
    ];
  }

  return messages.map((message, index) =>
    index === targetIndex
      ? (() => {
          const nextToolCalls = appendToolOutputDelta(message.toolCalls ?? [], toolId, item.kind, item.delta);
          const nextToolCall = ensureToolCallForDelta(nextToolCalls, toolId, item.kind, item.delta);
          return {
            ...message,
            processMeta: ensureProcessStarted(message),
            toolCalls: nextToolCalls,
            processItems: upsertProcessToolItem(message.processItems, nextToolCall),
          };
        })()
      : message,
  );
}

/** 将工具完成事件回填到同一个 assistant 响应框，缺少开始事件时也能兜底显示。 */
export function completeToolMessage(messages: ChatMessage[], item: CodexToolCallResult) {
  const id = toolMessageId(item.itemId, item.turnId, item.kind);
  const targetIndex = findAssistantMessageIndex(messages, item.turnId);
  const toolStatus: ChatToolCall["status"] =
    item.status === "failed" || item.status === "error" ? "error" : "complete";
  const toolCall: ChatToolCall = {
    id,
    name: item.kind,
    kind: item.kind,
    status: toolStatus,
    outputPreview: item.outputPreview,
  };

  if (targetIndex < 0) {
    const createdAt = new Date().toISOString();
    return [
      ...messages,
      {
        id: `assistant-${item.turnId ?? Date.now()}`,
        role: "assistant" as const,
        turnId: item.turnId,
        content: "",
        processMeta: { startedAt: createdAt },
        createdAt,
        toolCalls: [toolCall],
        processItems: [processToolItem(toolCall, 0)],
      },
    ];
  }

  return messages.map((message, index) =>
    index === targetIndex
      ? {
          ...message,
          processMeta: ensureProcessStarted(message),
          toolCalls: upsertToolCall(message.toolCalls ?? [], toolCall),
          processItems: upsertProcessToolItem(message.processItems, toolCall),
        }
      : message,
  );
}

/** 按 ID 更新工具过程，保留开始事件中的命令和路径等输入信息。 */
function upsertToolCall(toolCalls: ChatToolCall[], nextToolCall: ChatToolCall) {
  const targetIndex = toolCalls.findIndex((toolCall) => toolCall.id === nextToolCall.id);
  if (targetIndex < 0) {
    return [...toolCalls, nextToolCall];
  }

  return toolCalls.map((toolCall, index) =>
    index === targetIndex
      ? {
          ...toolCall,
          ...nextToolCall,
          command: nextToolCall.command ?? toolCall.command,
          path: nextToolCall.path ?? toolCall.path,
          name: toolCall.name || nextToolCall.name,
        }
      : toolCall,
  );
}

/** 将工具生命周期同步进有序过程项，保证过程按 Codex item 到达顺序展示。 */
function upsertProcessToolItem(processItems: ChatProcessItem[] | undefined, toolCall: ChatToolCall, order?: number) {
  const items = processItems ?? [];
  const targetIndex = items.findIndex((item) => item.type === "tool" && item.toolCall?.id === toolCall.id);
  if (targetIndex < 0) {
    return [...items, processToolItem(toolCall, order ?? items.length)];
  }

  return items.map((item, index) =>
    index === targetIndex
      ? {
          ...item,
          toolCall: {
            ...item.toolCall,
            ...toolCall,
            command: toolCall.command ?? item.toolCall?.command,
            path: toolCall.path ?? item.toolCall?.path,
            name: item.toolCall?.name || toolCall.name,
          },
        }
      : item,
  );
}

/** 创建工具过程项，order 固化首次出现位置，后续完成事件只更新内容不改变顺序。 */
function processToolItem(toolCall: ChatToolCall, order: number): ChatProcessItem {
  return {
    id: `process-${toolCall.id}`,
    type: "tool",
    order,
    toolCall,
  };
}

/** 创建模型过程说明项，用于把 commentary 按原始顺序写入同一个回答框。 */
function processTextItem(id: string, text: string, order: number, promotableAnswer = false): ChatProcessItem {
  return {
    id,
    type: "text",
    order,
    text,
    promotableAnswer,
  };
}

/** 当同一个 agentMessage item 被识别为最终正文时，移除过程区里同 itemId 的直播文本，避免正文和折叠框重复显示。 */
function removeLiveProcessTextByItemId(message: ChatMessage, itemId: string | undefined) {
  if (!itemId || !message.processItems?.length) {
    return message;
  }
  const processItemIdPrefix = `process-live-commentary-${itemId}`;
  const nextProcessItems = message.processItems.filter((item) =>
    !(item.type === "text" && item.id.startsWith(processItemIdPrefix))
  );
  if (nextProcessItems.length === message.processItems.length) {
    return message;
  }
  return {
    ...message,
    processItems: nextProcessItems,
    processText: processTextFromItems(nextProcessItems),
  };
}

/** 当后续完成事件确认某个 agentMessage 属于过程说明时，从正文分段中剔除同 itemId 的误写内容。 */
function removeAssistantTextByItemId(message: ChatMessage, itemId: string | undefined) {
  if (!itemId || !message.assistantTextSegments?.length) {
    return message;
  }
  const textSegmentId = `assistant-text-${itemId}`;
  const nextSegments = message.assistantTextSegments.filter((segment) => segment.id !== textSegmentId);
  if (nextSegments.length === message.assistantTextSegments.length) {
    return message;
  }
  return {
    ...message,
    assistantTextSegments: nextSegments,
    content: joinAssistantTextSegments(nextSegments),
  };
}

/** turn 结束时兜底收口仍处于 running 的过程项，避免折叠状态被未完成事件卡住。 */
export function finalizeAssistantProcess(messages: ChatMessage[], turnId: string | undefined) {
  const targetIndex = findAssistantMessageIndex(messages, turnId);
  if (targetIndex < 0) {
    return messages;
  }

  return messages.map((message, index) =>
    index === targetIndex
      ? promoteTrailingProcessTextToAnswer({
          ...message,
          content: message.content || "",
          processMeta: hasAssistantProcess(message) ? completeProcessMeta(message, new Date().toISOString()) : message.processMeta,
          toolCalls: message.toolCalls?.map((toolCall) =>
            toolCall.status === "running" ? { ...toolCall, status: "complete" as const } : toolCall,
          ),
          processItems: completeRunningProcessItems(message.processItems),
        })
      : message,
  );
}

/** 用户主动停止时按最近一条 assistant 回复收口，避免工具过程一直保持 running。 */
export function finalizeLatestAssistantProcess(messages: ChatMessage[]) {
  const targetIndex = findLatestAssistantMessageIndex(messages);
  if (targetIndex < 0) {
    return messages;
  }

  return messages.map((message, index) =>
    index === targetIndex
      ? promoteTrailingProcessTextToAnswer({
          ...message,
          content: message.content || "",
          processMeta: hasAssistantProcess(message) ? completeProcessMeta(message, new Date().toISOString()) : message.processMeta,
          toolCalls: message.toolCalls?.map((toolCall) =>
            toolCall.status === "running" ? { ...toolCall, status: "complete" as const } : toolCall,
          ),
          processItems: completeRunningProcessItems(message.processItems),
        })
      : message,
  );
}

/** 判断当前 assistant 回复是否真的包含工具或过程信息，避免纯文本回复被渲染成过程块。 */
function hasAssistantProcess(message: ChatMessage) {
  return Boolean(message.processItems?.length || message.processText?.trim() || message.processMeta || message.toolCalls?.length);
}

/** turn 完成或停止时收口有序过程项内仍处于运行态的工具。 */
function completeRunningProcessItems(processItems: ChatProcessItem[] | undefined) {
  return processItems?.map((item) =>
    item.type === "tool" && item.toolCall?.status === "running"
      ? { ...item, toolCall: { ...item.toolCall, status: "complete" as const } }
      : item,
  );
}

/** turn 结束时把最后一段过程文字提升为最终答案，其余文字和命令继续保留在折叠过程里。 */
function promoteTrailingProcessTextToAnswer(message: ChatMessage) {
  if (message.content.trim()) {
    return message;
  }
  const items = [...(message.processItems ?? [])].sort((left, right) => left.order - right.order);
  const lastItem = items[items.length - 1];
  if (lastItem?.type !== "text" || !lastItem.text?.trim() || !lastItem.promotableAnswer) {
    return message;
  }
  const nextProcessItems = items.slice(0, -1);
  return {
    ...message,
    content: lastItem.text.trim(),
    processItems: nextProcessItems,
    processText: processTextFromItems(nextProcessItems),
  };
}

/** 确保过程区有稳定开始时间，后续完成事件才能准确计算耗时。 */
function ensureProcessStarted(message: ChatMessage) {
  return {
    ...message.processMeta,
    startedAt: message.processMeta?.startedAt ?? message.createdAt ?? new Date().toISOString(),
  };
}

/** 补齐过程完成时间和耗时；重复完成事件不会覆盖已完成耗时。 */
function completeProcessMeta(message: ChatMessage, completedAt: string) {
  const startedAt = message.processMeta?.startedAt ?? message.createdAt ?? completedAt;
  const startedTime = new Date(startedAt).getTime();
  const completedTime = new Date(completedAt).getTime();
  const durationMs =
    message.processMeta?.durationMs ??
    (Number.isNaN(startedTime) || Number.isNaN(completedTime)
      ? undefined
      : Math.max(completedTime - startedTime, 0));
  return {
    ...message.processMeta,
    startedAt,
    completedAt: message.processMeta?.completedAt ?? completedAt,
    durationMs,
  };
}

/** 将运行时重连提示写回当前 assistant 响应，避免状态另起一个消息框。 */
export function upsertAssistantStatus(messages: ChatMessage[], turnId: string | undefined, content: string) {
  const targetIndex = findAssistantMessageIndex(messages, turnId);
  const createdAt = new Date().toISOString();

  if (targetIndex < 0) {
    return [
      ...messages,
      {
        id: `assistant-status-${turnId ?? Date.now()}`,
        role: "assistant" as const,
        turnId,
        content: "",
        processText: content,
        processMeta: { startedAt: createdAt },
        processItems: [processTextItem(`process-status-${turnId ?? Date.now()}`, content, 0)],
        createdAt,
      },
    ];
  }

  const target = messages[targetIndex];
  const existingItems = target.processItems ?? [];
  const statusItemId = `process-status-${turnId ?? target.id}`;
  const statusIndex = existingItems.findIndex((item) => item.id === statusItemId);
  const nextOrder = existingItems.length;
  const nextStatusItem = processTextItem(
    statusItemId,
    content,
    statusIndex >= 0 ? existingItems[statusIndex].order : nextOrder,
  );

  const nextProcessItems =
    statusIndex >= 0
      ? existingItems.map((item, index) => (index === statusIndex ? nextStatusItem : item))
      : [...existingItems, nextStatusItem];
  const nextProcessText = [target.processText, content].filter(Boolean).join("\n\n");

  return messages.map((message, index) =>
    index === targetIndex
      ? {
          ...message,
          processMeta: ensureProcessStarted(message),
          processText: nextProcessText,
          processItems: nextProcessItems,
        }
      : message,
  );
}

/** 将失败提示合并进当前 assistant 响应，同一个框里展示过程和错误。 */
export function upsertAssistantFailure(messages: ChatMessage[], turnId: string | undefined, content: string) {
  const targetIndex = findAssistantMessageIndex(messages, turnId);
  const createdAt = new Date().toISOString();
  const errorContent = content.trim();

  if (targetIndex < 0) {
    return [
      ...messages,
      {
        id: `assistant-error-${turnId ?? Date.now()}`,
        role: "error" as const,
        turnId,
        content: errorContent,
        processMeta: { startedAt: createdAt, completedAt: createdAt, durationMs: 0 },
        createdAt,
      },
    ];
  }

  return messages.map((message, index) =>
    index === targetIndex
      ? {
          ...message,
          role: "error" as const,
          content: message.content.trim()
            ? `${message.content.trim()}\n\n当前回复未完成：${errorContent}`
            : errorContent,
          processMeta: hasAssistantProcess(message) ? completeProcessMeta(message, createdAt) : message.processMeta,
          processItems: completeRunningProcessItems(message.processItems),
          toolCalls: message.toolCalls?.map((toolCall) =>
            toolCall.status === "running" ? { ...toolCall, status: "error" as const } : toolCall,
          ),
        }
      : message,
  );
}

/** 将输出增量追加到同一个工具项，保持和 Codex 原生终端类似的逐段增长体验。 */
function appendToolOutputDelta(
  toolCalls: ChatToolCall[],
  toolId: string,
  kind: string,
  delta: string,
) {
  const targetIndex = toolCalls.findIndex((toolCall) => toolCall.id === toolId);
  if (targetIndex < 0) {
    return [{
      id: toolId,
      name: kind,
      kind,
      status: "running" as const,
      outputPreview: delta,
    }];
  }

  return toolCalls.map((toolCall, index) =>
    index === targetIndex
      ? {
          ...toolCall,
          outputPreview: `${toolCall.outputPreview ?? ""}${delta}`,
        }
      : toolCall,
  );
}

function ensureToolCallForDelta(
  toolCalls: ChatToolCall[],
  toolId: string,
  kind: string,
  delta: string,
) {
  return toolCalls.find((toolCall) => toolCall.id === toolId) ?? {
    id: toolId,
    name: kind,
    kind,
    status: "running" as const,
    outputPreview: delta,
  };
}

/** 将同一条 assistant 回复中的多个 agentMessage item 维护成稳定正文分段，避免后续 completed 覆盖前文。 */
function withAssistantTextDelta(
  message: ChatMessage,
  turnId: string | undefined,
  itemId: string | undefined,
  text: string,
) {
  const nextSegments = appendAssistantTextSegments(existingAssistantTextSegments(message), turnId, itemId, text);
  return {
    assistantTextSegments: nextSegments,
    content: joinAssistantTextSegments(nextSegments),
  };
}

/** 追加正文增量：同 item 继续累加，不同 item 作为新的正文段落追加。 */
function appendAssistantTextSegments(
  segments: ChatTextSegment[] | undefined,
  turnId: string | undefined,
  itemId: string | undefined,
  text: string,
) {
  const current = normalizeAssistantTextSegments(segments);
  const segmentId = assistantTextSegmentId(turnId, itemId, current.length);
  const targetIndex = current.findIndex((segment) => segment.id === segmentId);
  if (targetIndex < 0) {
    return [
      ...current,
      {
        id: segmentId,
        order: current.length,
        text,
      },
    ];
  }
  return current.map((segment, index) =>
    index === targetIndex
      ? {
          ...segment,
          text: `${segment.text}${text}`,
        }
      : segment,
  );
}

/** 完成快照只修正对应 item 的正文片段，不覆盖同一 turn 里其他已显示片段。 */
function completeAssistantTextSegments(
  segments: ChatTextSegment[] | undefined,
  turnId: string | undefined,
  itemId: string | undefined,
  text: string,
) {
  const current = normalizeAssistantTextSegments(segments);
  const segmentId = assistantTextSegmentId(turnId, itemId, current.length);
  const targetIndex = current.findIndex((segment) => segment.id === segmentId);
  if (targetIndex < 0) {
    return [
      ...current,
      {
        id: segmentId,
        order: current.length,
        text,
      },
    ];
  }
  return current.map((segment, index) =>
    index === targetIndex
      ? {
          ...segment,
          text,
        }
      : segment,
  );
}

/** 规范化旧数据：没有显式正文分段时，把整个 content 视为同一段，兼容历史会话和既有状态。 */
function normalizeAssistantTextSegments(segments: ChatTextSegment[] | undefined) {
  return [...(segments ?? [])].sort((left, right) => left.order - right.order);
}

/** 兼容旧消息：还没有显式正文分段时，把当前 content 当成第一段继续维护。 */
function existingAssistantTextSegments(message: ChatMessage) {
  if (message.assistantTextSegments?.length) {
    return normalizeAssistantTextSegments(message.assistantTextSegments);
  }
  if (message.content.trim()) {
    return [
      {
        id: `assistant-text-legacy-${message.id}`,
        order: 0,
        text: message.content,
      },
    ];
  }
  return [];
}

/** 统一生成正文片段 ID；缺失 itemId 时回退到 turn 级别，保持旧协议可用。 */
function assistantTextSegmentId(turnId: string | undefined, itemId: string | undefined, fallbackIndex: number) {
  if (itemId) {
    return `assistant-text-${itemId}`;
  }
  return `assistant-text-${turnId ?? "current"}-${fallbackIndex}`;
}

/** 将正文分段拼回展示文本：不同 item 之间保留换段，单 item 内仍保持原始流式拼接。 */
function joinAssistantTextSegments(segments: ChatTextSegment[] | undefined) {
  const normalized = normalizeAssistantTextSegments(segments);
  return normalized.map((segment) => segment.text).filter(Boolean).join("\n\n");
}

/** 将 reasoning/commentary 实时增量挂到当前 assistant 过程区，保证对话时能看到完整处理信息。 */
export function upsertAssistantProcessDelta(
  messages: ChatMessage[],
  turnId: string | undefined,
  kind: "reasoning" | "commentary",
  text: string,
  options: { itemId?: string; segmentKey?: string; snapshot?: boolean; promotableAnswer?: boolean } = {},
) {
  if (!text.trim()) {
    return messages;
  }
  const normalizedText = kind === "reasoning" ? text : text.trim();

  const targetIndex = findAssistantMessageIndex(messages, turnId);
  const createdAt = new Date().toISOString();

  if (targetIndex < 0) {
    const processItemId = options.itemId
      ? `process-live-${kind}-${options.itemId}${options.segmentKey ? `-${options.segmentKey}` : ""}`
      : `process-live-${kind}-${turnId ?? "current"}-0`;
    const initialProcessItems = normalizedText
      ? [processTextItem(processItemId, normalizedText, 0, options.promotableAnswer)]
      : [];
    return [
      ...messages,
      {
        id: `assistant-process-${turnId ?? Date.now()}`,
        role: "assistant" as const,
        turnId,
        content: "",
        processText: normalizedText || undefined,
        processMeta: { startedAt: createdAt },
        processItems: initialProcessItems,
        createdAt,
      },
    ];
  }

  const target = removeAssistantTextByItemId(messages[targetIndex], options.itemId);
  const existingItems = target.processItems ?? [];
  const processItemId = resolveProcessTextItemId(existingItems, kind, turnId, options.itemId, options.segmentKey);
  const processItemIndex = existingItems.findIndex((item) => item.id === processItemId);
  const previousText =
    processItemIndex >= 0 && existingItems[processItemIndex].type === "text"
      ? existingItems[processItemIndex].text ?? ""
      : "";
  const promotableAnswer = Boolean(
    options.promotableAnswer || existingItems[processItemIndex]?.promotableAnswer,
  );
  const mergedText = options.snapshot ? normalizedText : `${previousText}${normalizedText}`;
  const nextProcessItems = normalizedText
    ? (() => {
        const nextItem = processTextItem(
          processItemId,
          mergedText,
          processItemIndex >= 0 ? existingItems[processItemIndex].order : existingItems.length,
          promotableAnswer,
        );
        return processItemIndex >= 0
          ? existingItems.map((item, index) => (index === processItemIndex ? nextItem : item))
          : [...existingItems, nextItem];
      })()
    : existingItems;

  return messages.map((message, index) =>
    index === targetIndex
      ? {
          ...target,
          processMeta: ensureProcessStarted(target),
          processText: processTextFromItems(nextProcessItems),
          processItems: nextProcessItems,
        }
      : message,
  );
}

/** 没有稳定 itemId 时，优先续写尾部文字块；若过程中已插入工具，则新建下一段文字过程项，避免视觉上被整块替换。 */
function resolveProcessTextItemId(
  processItems: ChatProcessItem[],
  kind: "reasoning" | "commentary",
  turnId: string | undefined,
  itemId?: string,
  segmentKey?: string,
) {
  if (itemId) {
    return `process-live-${kind}-${itemId}${segmentKey ? `-${segmentKey}` : ""}`;
  }

  const lastItem = processItems[processItems.length - 1];
  if (lastItem?.type === "text") {
    return lastItem.id;
  }

  return `process-live-${kind}-${turnId ?? "current"}-${processItems.length}`;
}

/** 从有序过程项派生兼容旧字段的过程文本，避免流式增量和完成快照重复堆叠。 */
function processTextFromItems(processItems: ChatProcessItem[] | undefined) {
  const text = (processItems ?? [])
    .filter((item) => item.type === "text")
    .sort((left, right) => left.order - right.order)
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
}

/** 生成会话作用域键，保证普通对话和每个案件都有独立的当前会话。 */
export function chatScopeKey(context: SessionContext) {
  return `${context.agentType}:${context.casePath}`;
}

/** 判断一个会话上下文是否属于当前聊天作用域。 */
export function sessionMatchesContext(context: SessionContext | undefined, target: SessionContext) {
  return context?.agentType === target.agentType && context.casePath === target.casePath;
}

/** 将 Codex app-server 原生 thread 转成左侧列表摘要。 */
export function codexThreadToSummary(record: CodexThreadRecord, context: SessionContext): ChatSessionSummary {
  const createdAt = codexTimeToIso(record.createdAt);
  const updatedAt = codexTimeToIso(record.updatedAt);
  const firstQuestion = firstUserQuestionFromThread(record);
  const title = displayTextFromCodexPrompt(record.title) || firstQuestion;
  const preview = displayTextFromCodexPrompt(record.preview);
  const displayTime = updatedAt ?? createdAt;
  return {
    id: record.id,
    title: title || preview || "新会话",
    preview: preview || "等待继续对话",
    time: dateLabel(displayTime),
    agentType: context.agentType,
    casePath: context.casePath,
    threadId: record.id,
    createdAt,
    updatedAt,
  };
}

/** 历史列表标题优先使用 Codex 原生 thread 标题，缺失时再回退首条用户问题。 */
function firstUserQuestionFromThread(record: CodexThreadRecord) {
  for (let index = 0; index < record.turns.length; index += 1) {
    const messages = codexTurnToMessages(record.turns[index], record.id, index);
    const userMessage = messages.find((message) => message.role === "user" && isVisibleHistoryUserMessage(message.content));
    if (userMessage?.content.trim()) {
      return userMessage.content.trim();
    }
  }

  return "";
}

/** 使用当前查询作用域解释 Codex thread 的 UI 上下文。 */
export function codexThreadContext(record: CodexThreadRecord, agentType: SessionContext["agentType"], fallbackPath: string): SessionContext {
  return {
    agentType,
    casePath: record.cwd || fallbackPath,
  };
}

/** 按会话最新修改时间倒序排序，保证最近继续追问的会话优先显示。 */
export function sortSessionSummariesByUpdatedAt(sessions: ChatSessionSummary[]) {
  return [...sessions].sort((left, right) => {
    const leftTime = left.updatedAt ?? left.createdAt;
    const rightTime = right.updatedAt ?? right.createdAt;
    const leftTimestamp = leftTime ? new Date(leftTime).getTime() : 0;
    const rightTimestamp = rightTime ? new Date(rightTime).getTime() : 0;
    return rightTimestamp - leftTimestamp;
  });
}

/** 将 Codex thread/read 的 turn/item 历史尽量恢复为前端聊天消息。 */
export function codexThreadToMessages(record: CodexThreadRecord): ChatMessage[] {
  return dedupeChatMessages(record.turns.flatMap((turn, turnIndex) => codexTurnToMessages(turn, record.id, turnIndex)));
}

/** 兼容 app-server 不同版本的 turn 历史结构，优先读取标准 items。 */
function codexTurnToMessages(turnValue: unknown, threadId: string, turnIndex: number): ChatMessage[] {
  const turn = asRecord(turnValue);
  if (!turn) {
    return [];
  }
  const turnBody = asRecord(turn.turn) ?? turn;
  const turnId = textFromKeys(turnBody, ["id", "turnId"]) || `turn-${threadId}-${turnIndex}`;
  const createdAt = codexTimeToIso(numberFromKeys(turnBody, ["createdAt", "created_at", "updatedAt", "updated_at"])) ?? new Date().toISOString();
  const rawItems = [
    ...arrayFromKeys(turnBody, ["items", "messages", "events", "responseItems", "inputItems", "outputItems"]),
    ...arrayFromKeys(asRecord(turnBody.output) ?? {}, ["items", "messages", "events"]),
    ...arrayFromKeys(asRecord(turnBody.response) ?? {}, ["items", "messages", "events"]),
  ];
  if (rawItems.length > 0) {
    return codexItemsToMessages(rawItems, turnId, createdAt);
  }

  const messages: ChatMessage[] = [];
  const userText = textFromKeys(turnBody, ["userPrompt", "prompt", "input", "userMessage", "request"]);
  const assistantText = textFromKeys(turnBody, ["assistantMessage", "response", "output", "answer"]);
  if (userText) {
    messages.push({
      id: `${turnId}-user`,
      role: "user",
      content: displayTextFromCodexPrompt(userText),
      createdAt,
    });
  }
  if (assistantText) {
    messages.push({
      id: `${turnId}-assistant`,
      role: "assistant",
      turnId,
      content: assistantText,
      createdAt,
    });
  }
  return messages;
}

/** 将 Codex item 列表聚合为一问一答，同时恢复实时对话里的有序过程链路。 */
function codexItemsToMessages(items: unknown[], turnId: string, fallbackCreatedAt: string): ChatMessage[] {
  let userMessage: ChatMessage | null = null;
  let finalAssistant: ChatMessage | null = null;
  let lastOtherAssistant: ChatMessage | null = null;
  let processStartedAt: string | undefined;
  let processCompletedAt: string | undefined;
  let toolCalls: ChatToolCall[] = [];
  let processItems: ChatProcessItem[] = [];
  let nextProcessOrder = 0;
  const processTextCandidates: Array<{ id: string; text: string; order: number; messageId: string; promotable?: boolean }> = [];

  items.forEach((itemValue, itemIndex) => {
    const itemCreatedAt = codexItemCreatedAt(itemValue, fallbackCreatedAt);
    const toolCall = codexToolCallFromItem(itemValue, turnId, itemIndex);
    if (toolCall) {
      const isNewProcessTool = !processItems.some((item) => item.type === "tool" && item.toolCall?.id === toolCall.id);
      processStartedAt = processStartedAt ?? itemCreatedAt;
      processCompletedAt = itemCreatedAt;
      toolCalls = upsertToolCall(toolCalls, toolCall);
      processItems = upsertProcessToolItem(processItems, toolCall, nextProcessOrder);
      if (isNewProcessTool) {
        nextProcessOrder += 1;
      }
      return;
    }

    const reasoningText = codexReasoningTextFromItem(itemValue);
    if (reasoningText) {
      processStartedAt = processStartedAt ?? itemCreatedAt;
      processCompletedAt = itemCreatedAt;
      processTextCandidates.push({
        id: `${turnId}-process-reasoning-${itemIndex}`,
        text: reasoningText,
        order: nextProcessOrder,
        messageId: `${turnId}-reasoning`,
        promotable: false,
      });
      nextProcessOrder += 1;
      return;
    }

    const message = codexItemToMessage(itemValue, turnId, fallbackCreatedAt, itemIndex);
    if (!message) {
      return;
    }
    if (message.role === "user" && !userMessage && isVisibleHistoryUserMessage(message.content)) {
      userMessage = message;
      return;
    }
    if (message.role === "assistant") {
      const phase = codexItemPhase(itemValue);
      if (phase === "final_answer" || !phase) {
        finalAssistant = message;
      } else if (phase === "commentary" && message.content.trim()) {
        processStartedAt = processStartedAt ?? message.createdAt;
        processCompletedAt = message.createdAt;
        processTextCandidates.push({
          id: `${turnId}-process-text-${itemIndex}`,
          text: message.content.trim(),
          order: nextProcessOrder,
          messageId: message.id,
          promotable: false,
        });
        nextProcessOrder += 1;
      } else if (message.content.trim()) {
        lastOtherAssistant = message;
      }
    }
  });

  const result: ChatMessage[] = [];
  if (userMessage) {
    result.push(userMessage);
  }
  const assistantMessage = (finalAssistant ?? lastOtherAssistant ?? buildProcessOnlyAssistantMessage(
    turnId,
    fallbackCreatedAt,
    processStartedAt,
  )) as ChatMessage | null;
  if (assistantMessage) {
    const assistantMessageId = assistantMessage.id;
    const processTexts = processTextCandidates
      .filter((candidate) => candidate.messageId !== assistantMessageId)
      .map((candidate) => candidate.text);
    const textProcessItems = processTextCandidates
      .filter((candidate) => candidate.messageId !== assistantMessageId)
      .map((candidate) => processTextItem(candidate.id, candidate.text, candidate.order, candidate.promotable));
    const orderedProcessItems = [...processItems, ...textProcessItems].sort((left, right) => left.order - right.order);
    result.push(promoteTrailingProcessTextToAnswer(
      attachHistoricalProcess(assistantMessage, processTexts, orderedProcessItems, toolCalls, processStartedAt, processCompletedAt),
    ));
  }
  return result;
}

/** 历史 turn 只有 commentary、reasoning 或工具过程时，补一条空正文 assistant 消息承载完整过程。 */
function buildProcessOnlyAssistantMessage(
  turnId: string,
  fallbackCreatedAt: string,
  processStartedAt: string | undefined,
): ChatMessage | null {
  if (!processStartedAt) {
    return null;
  }
  return {
    id: `${turnId}-assistant-process`,
    role: "assistant",
    turnId,
    content: "",
    createdAt: processStartedAt || fallbackCreatedAt,
  };
}

/** 将历史中的 commentary、命令和文件变更重新挂回 assistant 有序过程链路。 */
function attachHistoricalProcess(
  assistantMessage: ChatMessage,
  processTexts: string[],
  processItems: ChatProcessItem[],
  toolCalls: ChatToolCall[],
  processStartedAt: string | undefined,
  processCompletedAt: string | undefined,
) {
  const uniqueProcessText = Array.from(new Set(processTexts)).join("\n\n").trim();
  if (!uniqueProcessText && processItems.length === 0 && toolCalls.length === 0) {
    return assistantMessage;
  }

  const startedAt = processStartedAt ?? assistantMessage.createdAt;
  const completedAt = processCompletedAt ?? assistantMessage.createdAt;
  return {
    ...assistantMessage,
    processText: uniqueProcessText || undefined,
    processItems,
    processMeta: completeProcessMeta(
      {
        ...assistantMessage,
        processMeta: { startedAt, completedAt },
      },
      completedAt,
    ),
    toolCalls,
  };
}

/** 将一个 Codex item 还原成用户或 assistant 消息，工具 item 由历史过程聚合逻辑单独处理。 */
function codexItemToMessage(itemValue: unknown, turnId: string, fallbackCreatedAt: string, itemIndex: number): ChatMessage | null {
  const item = codexHistoryItemRecord(itemValue);
  if (!item) {
    return null;
  }

  const kind = codexHistoryItemKind(itemValue, item);
  const createdAt = codexItemCreatedAt(itemValue, fallbackCreatedAt);
  const content = codexHistoryItemText(itemValue, item);
  if (!content) {
    return null;
  }

  if (kind === "userMessage" || kind === "user") {
    const attachments = codexUserAttachmentsFromItem(itemValue, item, turnId, itemIndex);
    return {
      id: textFromKeys(item, ["id"]) || `${turnId}-user-${itemIndex}`,
      role: "user",
      content: displayTextFromCodexPrompt(content),
      attachments,
      createdAt,
    };
  }
  if (kind === "agentMessage" || kind === "assistant") {
    return {
      id: textFromKeys(item, ["id"]) || `${turnId}-assistant-${itemIndex}`,
      role: "assistant",
      turnId,
      content,
      createdAt,
    };
  }
  return null;
}

/** 从历史 item 中恢复工具步骤，保证回显时也能展示“已处理”折叠块。 */
function codexToolCallFromItem(itemValue: unknown, turnId: string, itemIndex: number): ChatToolCall | null {
  const item = codexHistoryItemRecord(itemValue);
  if (!item) {
    return null;
  }

  const kind = codexHistoryItemKind(itemValue, item);
  if (!isCodexToolItemKind(kind)) {
    return null;
  }

  const itemId = textFromKeys(item, ["id"]) || `${turnId}-history-tool-${itemIndex}`;
  const command = textFromKeys(item, ["command"]) || undefined;
  const path = textFromKeys(item, ["path", "cwd"]) || undefined;
  const toolName = textFromKeys(item, ["toolName", "tool_name"]) || undefined;
  const statusText = textFromKeys(item, ["status"]);
  const failed = statusText === "failed" || statusText === "error";
  const running = statusText === "running" || statusText === "in_progress";
  return {
    id: toolMessageId(itemId, turnId, kind),
    name: command ? `执行命令：${command}` : toolDisplayName(kind, toolName),
    kind,
    status: failed ? "error" : running ? "running" : "complete",
    command,
    path,
    outputPreview: outputPreviewFromCodexItem(item),
  };
}

/** 从完整历史 item 中提取 reasoning 文本，补回历史“处理过程”里缺失的思考信息。 */
function codexReasoningTextFromItem(itemValue: unknown) {
  const item = codexHistoryItemRecord(itemValue);
  if (!item) {
    return "";
  }

  const kind = codexHistoryItemKind(itemValue, item);
  if (kind !== "reasoning") {
    return "";
  }

  return [
    extractCodexNestedText(item.summary),
    extractCodexNestedText(item.content),
    textFromKeys(item, ["text", "content", "message"]),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n")
    .trim();
}

/** 兼容 app-server 历史里数组、对象、字符串混合的文本结构。 */
function extractCodexNestedText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractCodexNestedText(item))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      textFromKeys(record, ["text", "content", "message", "value"]),
      extractCodexNestedText(record.content),
      extractCodexNestedText(record.summary),
      extractCodexNestedText(record.parts),
    ]
      .filter((item): item is string => Boolean(item?.trim()))
      .join("\n")
      .trim();
  }
  return "";
}

/** Codex 历史和实时事件中需要进入有序过程链路的 item 类型。 */
function isCodexToolItemKind(kind: string) {
  return [
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "webSearch",
    "imageView",
    "imageGeneration",
  ].includes(kind);
}

/** 历史 item 时间可能在 wrapper 或 item 内，统一兼容两种位置。 */
function codexItemCreatedAt(itemValue: unknown, fallbackCreatedAt: string) {
  const wrapper = asRecord(itemValue);
  const item = codexHistoryItemRecord(itemValue);
  const params = codexHistoryEventParams(itemValue);
  return (
    codexTimeToIso(numberFromKeys(item ?? {}, ["createdAt", "created_at", "updatedAt", "updated_at"]))
    ?? codexTimeToIso(numberFromKeys(wrapper ?? {}, ["createdAt", "created_at", "updatedAt", "updated_at"]))
    ?? codexTimeToIso(numberFromKeys(asRecord(wrapper?.payload) ?? {}, ["createdAt", "created_at", "updatedAt", "updated_at", "completed_at"]))
    ?? codexTimeToIso(numberFromKeys(params ?? {}, ["createdAt", "created_at", "updatedAt", "updated_at", "completed_at"]))
    ?? fallbackCreatedAt
  );
}

/** 输出预览限制长度，避免历史回显把完整工具输出塞进消息树。 */
function outputPreviewFromCodexItem(item: Record<string, unknown>) {
  const preview = textFromKeys(item, ["output", "text", "content", "delta", "message"]);
  return preview ? preview.slice(0, 600) : undefined;
}

/** 判断历史里的用户消息是否是用户真实提问，而不是环境、skill 或内部协议注入。 */
function isVisibleHistoryUserMessage(content: string) {
  const text = displayTextFromCodexPrompt(content).trim();
  return Boolean(text)
    && !text.startsWith("You are ")
    && !text.startsWith("Filesystem sandboxing")
    && !text.startsWith("Knowledge cutoff:")
    && !/^legal-[a-z-]+$/u.test(text)
    && !text.includes("<environment_context>")
    && !text.includes("<permissions instructions>")
    && !text.includes("<skills_instructions>");
}

/** 读取 Codex response_item 的 phase，用于优先选择最终回答。 */
function codexItemPhase(itemValue: unknown) {
  const wrapper = asRecord(itemValue);
  const item = codexHistoryItemRecord(itemValue);
  const params = codexHistoryEventParams(itemValue);
  const payload = asRecord(wrapper?.payload);
  const phase = item?.phase ?? asRecord(params?.item)?.phase ?? params?.phase ?? payload?.phase;
  return typeof phase === "string" ? phase : "";
}

/** 兼容 thread/read 回填里的原生 item、response_item 和 event_msg 三种结构。 */
function codexHistoryItemRecord(itemValue: unknown) {
  const wrapper = asRecord(itemValue);
  if (!wrapper) {
    return null;
  }
  const payload = asRecord(wrapper.payload);
  const params = codexHistoryEventParams(itemValue);
  return asRecord(params?.item) ?? asRecord(payload?.item) ?? asRecord(wrapper.item) ?? payload ?? wrapper;
}

/** 统一读取历史 item 的稳定类型，兼容 response_item/event_msg 包装。 */
function codexHistoryItemKind(itemValue: unknown, item: Record<string, unknown>) {
  const payloadType = textFromKeys(item, ["type", "kind"]);
  const payloadRole = textFromKeys(item, ["role"]);
  if (payloadType === "message") {
    if (payloadRole === "user") {
      return "userMessage";
    }
    if (payloadRole === "assistant") {
      return "agentMessage";
    }
    return payloadRole || payloadType;
  }
  const typedRole = payloadRole;
  if (typedRole && !payloadType) {
    return typedRole;
  }
  if (payloadType) {
    return payloadType;
  }
  const method = codexHistoryEventMethod(itemValue);
  if (method.includes("agentMessage")) {
    return "agentMessage";
  }
  if (method.includes("reasoning")) {
    return "reasoning";
  }
  if (method.includes("commandExecution")) {
    return "commandExecution";
  }
  return payloadType;
}

/** 从真实落盘结构中提取文本，兼容 content[]、event_msg.message 和旧版扁平字段。 */
function codexHistoryItemText(itemValue: unknown, item: Record<string, unknown>) {
  const wrapper = asRecord(itemValue);
  const payload = asRecord(wrapper?.payload);
  const params = codexHistoryEventParams(itemValue);
  return dedupeCodexTextParts([
    extractCodexMessageContentText(item.content),
    extractCodexMessageContentText(payload?.content),
    textFromKeys(params ?? {}, ["delta", "message", "text", "content", "last_agent_message"]),
    textFromKeys(payload ?? {}, ["message", "text", "content", "last_agent_message"]),
    textFromKeys(item, ["text", "content", "message", "input", "output", "value"]),
  ]);
}

/** 历史可能以 event_msg 包装 method + params，统一取出原始 params 便于复用实时解析逻辑。 */
function codexHistoryEventParams(itemValue: unknown) {
  const wrapper = asRecord(itemValue);
  const payload = asRecord(wrapper?.payload);
  return asRecord(payload?.params) ?? asRecord(wrapper?.params);
}

/** 读取 event_msg 的原始 notification method，用于缺少 item.type 时兜底识别。 */
function codexHistoryEventMethod(itemValue: unknown) {
  const wrapper = asRecord(itemValue);
  const payload = asRecord(wrapper?.payload);
  return textFromKeys(payload ?? {}, ["method"]) || textFromKeys(wrapper ?? {}, ["method"]);
}

/** 解析 Responses 风格 content 数组里的 input/output 文本片段。 */
function extractCodexMessageContentText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part.trim();
      }
      const record = asRecord(part);
      if (!record) {
        return "";
      }
      return textFromKeys(record, ["text", "content", "message"]);
    })
    .filter((text): text is string => Boolean(text?.trim()))
    .join("\n\n")
    .trim();
}

/** 从历史 userMessage 的 content 数组中恢复图片附件摘要。 */
function codexUserAttachmentsFromItem(
  itemValue: unknown,
  item: Record<string, unknown>,
  turnId: string,
  itemIndex: number,
): ChatAttachment[] {
  const wrapper = asRecord(itemValue);
  const payload = asRecord(wrapper?.payload);
  const itemId = textFromKeys(item, ["id"]) || `${turnId}-user-${itemIndex}`;
  const sources = [item.content, payload?.content].filter((source, index, array) =>
    array.findIndex((candidate) => candidate === source) === index,
  );
  return sources.flatMap((source) => extractCodexUserInputAttachments(source, itemId));
}

/** 从 app-server `UserInput[]` 中提取适合前端展示的附件摘要。 */
function extractCodexUserInputAttachments(value: unknown, itemId: string): ChatAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: ChatAttachment[] = [];
  value.forEach((part, index) => {
    const record = asRecord(part);
    if (!record) {
      return;
    }
    const type = textFromKeys(record, ["type"]);
    if (type === "localImage") {
      const path = textFromKeys(record, ["path"]);
      if (!path) {
        return;
      }
      attachments.push({
        id: `${itemId}-attachment-${index}`,
        name: fileNameFromPathOrUrl(path),
        type: "image",
        path,
        nodeType: "file",
        sourceLabel: "对话附件",
      });
      return;
    }
    if (type === "image") {
      const url = textFromKeys(record, ["url", "imageUrl"]);
      if (!url) {
        return;
      }
      attachments.push({
        id: `${itemId}-attachment-${index}`,
        name: fileNameFromPathOrUrl(url),
        type: "image",
        url,
        sourceLabel: "对话附件",
      });
      return;
    }
  });
  return attachments;
}

/** 从绝对路径或 URL 中推导适合 UI 展示的附件名称。 */
function fileNameFromPathOrUrl(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "图片附件";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const lastSegment = parts[parts.length - 1];
  if (!lastSegment) {
    return normalized;
  }
  return lastSegment.split("?")[0] || lastSegment;
}

/** 历史 item 常会在 content、message 等多个字段重复落同一段文本，界面只保留去重后的展示内容。 */
function dedupeCodexTextParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  const uniqueParts: string[] = [];

  parts.forEach((part) => {
    const normalized = part?.replace(/\r\n/g, "\n").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    uniqueParts.push(normalized);
  });

  return uniqueParts.join("\n\n").trim();
}

/** 去重历史消息，避免 app-server 同时返回 event_msg 和 response_item 时重复展示。 */
function dedupeChatMessages(messages: ChatMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.role}:${message.turnId ?? ""}:${message.content.trim()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** 从 Codex 原生历史中剥离附件和案件材料上下文，只保留用户在聊天框里实际看到的问题。 */
export function displayTextFromCodexPrompt(text: string) {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  const wechatVisibleText = extractWechatVisibleMessage(normalizedText);
  if (wechatVisibleText) {
    return wechatVisibleText;
  }
  const displayText = stripPromptContextBlocks(normalizedText).trim();
  if (looksLikeInternalPrompt(displayText)) {
    return "";
  }
  return displayText;
}

/** 从微信桥接协议块中提取真实用户提问，避免 Markdown 把 XML 风格标签当 HTML 吞掉。 */
function extractWechatVisibleMessage(text: string) {
  const match = text.match(/<wechat-message\b[^>]*>([\s\S]*?)<\/wechat-message>/iu);
  if (!match) {
    return "";
  }
  const body = match[1].trim();
  const userMessageMatch = body.match(/(?:^|\n)用户消息：\s*\n?([\s\S]*)$/u);
  const userMessage = (userMessageMatch?.[1] ?? "").trim();
  if (!userMessage || userMessage === "用户发送了一条空白消息。") {
    return "";
  }
  return userMessage;
}

/** 识别不应出现在用户界面标题或问题气泡里的内部提示词片段。 */
function looksLikeInternalPrompt(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return false;
  }

  return [
    "You are ",
    "Filesystem sandboxing",
    "Knowledge cutoff:",
  ].some((marker) => normalizedText.includes(marker));
}

/** 附件正文和案件材料路径只属于模型上下文，历史气泡不直接展示这些内部片段。 */
function stripPromptContextBlocks(text: string) {
  return text
    .replace(/^\$[^\s]+\s*/u, "")
    .replace(/^(?:@[a-z0-9-]+\s+)+/iu, "")
    .replace(/^legal-[a-z-]+\s+/u, "")
    .replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, "")
    .replace(/<attachment-file\b[^>]*>[\s\S]*?<\/attachment-file>/gi, "")
    .replace(/<case-material\b[^>]*>[\s\S]*?<\/case-material>/gi, "")
    .replace(/<knowledge-reference\b[^>]*>[\s\S]*?<\/knowledge-reference>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayFromKeys(record: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => {
    const value = record[key];
    return Array.isArray(value) ? value : [];
  });
}

function textFromKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const text = extractCodexText(record[key]);
    if (text) {
      return text;
    }
  }
  return "";
}

function numberFromKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

/** 从 app-server 原始 message/content 结构中提取可展示文本。 */
function extractCodexText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(extractCodexText).filter(Boolean).join("\n").trim();
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  const structuredPartType = typeof record.type === "string" ? record.type : "";
  if (["image", "localImage", "skill", "mention"].includes(structuredPartType)) {
    return "";
  }
  for (const key of ["text", "content", "message", "value", "input", "output"]) {
    const nested = extractCodexText(record[key]);
    if (nested) {
      return nested;
    }
  }
  return compactText(value);
}

function codexTimeToIso(value?: number) {
  if (!value) {
    return undefined;
  }
  const millis = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isUserVisibleCodexStatus(message: string) {
  return (
    message.includes("Codex 正在重连模型通道")
    || message.includes("Reconnecting")
    || message.includes("Falling server")
    || message.includes("WebSockets")
  );
}

export function codexStatusMessage(message: string) {
  if (message.includes("Falling server") || message.includes("WebSockets")) {
    return "模型连接不稳定，正在切换到 HTTPS 通道，请稍等。";
  }
  return "模型连接不稳定，小隐正在自动重连，请稍等。";
}

/** 优先按 turnId 定位；缺少 turnId 时只在最近一轮用户提问之后复用 assistant 块。 */
function findAssistantMessageIndex(messages: ChatMessage[], turnId: string | undefined) {
  if (turnId) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if ((message.role === "assistant" || message.role === "error") && message.turnId === turnId) {
        return index;
      }
    }
    return -1;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if ((messages[index].role === "assistant" || messages[index].role === "error") && !messages[index].turnId) {
      return index;
    }
  }
  return -1;
}

/** 查找最近一轮用户问题之后的最后一条 assistant 回复，用于用户主动停止时做 UI 收口。 */
function findLatestAssistantMessageIndex(messages: ChatMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index].role === "assistant" || messages[index].role === "error") {
      return index;
    }
  }
  return -1;
}
