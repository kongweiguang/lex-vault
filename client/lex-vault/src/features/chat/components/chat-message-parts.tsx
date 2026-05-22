import { useContext, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ActionBarPrimitive, AuiIf, BranchPickerPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Image as ImageIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { FilePreviewCallbackContext, UrlOpenCallbackContext } from "@/features/chat/chat-panel-types";
import { EmptyResponsePart, ToolCallPart } from "@/features/chat/components/chat-process-parts";
import { MarkdownTextPart } from "@/features/chat/components/chat-markdown";
import type { ChatAttachment } from "@/types/domain";

/** 消息时间与动作条，采用紧凑行内样式贴近常见聊天工具。 */
function MessageMetaActions({ align = "left" }: { align?: "left" | "right" }) {
  const label = useAuiState((state) =>
    typeof state.message.metadata.custom.createdAtLabel === "string"
      ? state.message.metadata.custom.createdAtLabel
      : "",
  );
  const title = useAuiState((state) =>
    typeof state.message.metadata.custom.createdAtTitle === "string"
      ? state.message.metadata.custom.createdAtTitle
      : label,
  );
  return (
    <div
      className={cn(
        "mt-1 flex h-6 items-center gap-2 text-xs text-slate-400",
        align === "right" ? "justify-end pr-1" : "justify-start pl-1",
      )}
    >
      {label ? <span className="select-none" title={title}>{label}</span> : null}
      <ActionBarPrimitive.Root
        autohide="not-last"
        className="flex items-center gap-1 opacity-75 transition-opacity group-hover:opacity-100"
        hideWhenRunning
      >
        <ActionBarPrimitive.Copy
          className="inline-flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          copiedDuration={1600}
          title="复制"
        >
          <AuiIf condition={({ message }) => message.isCopied}>
            <Check className="size-3.5 text-emerald-600" />
          </AuiIf>
          <AuiIf condition={({ message }) => !message.isCopied}>
            <Copy className="size-3.5" />
          </AuiIf>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </div>
  );
}

/** 判断当前附件是否应该按图片缩略图展示。 */
function isImageAttachment(attachment: Pick<ChatAttachment, "type" | "contentType">) {
  return attachment.type === "image" || attachment.contentType?.startsWith("image/");
}

/** 为图片附件选择最小可用缩略图来源，优先使用运行期缩略图，再退回远程 URL 或本机路径。 */
function imageThumbnailSrc(attachment: ChatAttachment) {
  if (attachment.thumbnailUrl) {
    return attachment.thumbnailUrl;
  }
  if (attachment.url) {
    return attachment.url;
  }
  if (attachment.path) {
    return convertFileSrc(attachment.path);
  }
  return "";
}

/** 图片附件点击后的放大预览层，避免小缩略图承载细节查看。 */
function ImageAttachmentPreview({
  name,
  onClose,
  src,
}: {
  /** 图片展示名称。 */
  name: string;
  /** 关闭预览层。 */
  onClose: () => void;
  /** 可直接展示的图片地址。 */
  src: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-2xl">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-4">
          <h3 className="min-w-0 truncate text-sm font-semibold text-[color:var(--color-card-foreground)]">{name}</h3>
          <button
            aria-label="关闭图片预览"
            className="inline-flex size-8 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-card-foreground)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="chat-scrollbar min-h-0 flex-1 overflow-auto bg-[color:var(--color-background)] p-4">
          <img alt={name} className="mx-auto max-h-[78vh] max-w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] object-contain" src={src} />
        </div>
      </div>
    </div>
  );
}

/** 附件小卡片只展示摘要，图片使用缩略图，避免用户问题气泡被大文件正文撑开。 */
function AttachmentChip({ attachment }: { attachment: ChatAttachment }) {
  const onPreviewAttachment = useContext(FilePreviewCallbackContext);
  const onOpenUrl = useContext(UrlOpenCallbackContext);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const previewAttachment = attachment as ChatAttachment;
  const isImage = isImageAttachment(attachment);
  const thumbnailSrc = isImage ? imageThumbnailSrc(previewAttachment) : "";
  const canPreview = Boolean(previewAttachment.path && onPreviewAttachment);
  const canOpenImage = Boolean(isImage && thumbnailSrc);
  const canOpenRemoteUrl = Boolean(!isImage && previewAttachment.url && onOpenUrl);
  const interactive = canPreview || canOpenImage || canOpenRemoteUrl;
  const openAttachment = () => {
    if (canOpenImage) {
      setImagePreviewOpen(true);
      return;
    }
    if (canPreview) {
      onPreviewAttachment?.({ ...previewAttachment, sourceLabel: "对话附件" });
      return;
    }
    if (canOpenRemoteUrl && previewAttachment.url) {
      onOpenUrl?.(previewAttachment.url, previewAttachment.name, false);
    }
  };

  if (isImage) {
    return (
      <>
        <button
          className={cn(
            "group/thumbnail relative flex size-18 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm",
            interactive ? "hover:border-blue-300 hover:shadow-md" : "cursor-default",
          )}
          disabled={!interactive}
          onClick={openAttachment}
          title={interactive ? "查看图片" : attachment.name}
          type="button"
        >
          {thumbnailSrc ? (
            <img alt={attachment.name} className="h-full w-full object-cover transition duration-150 group-hover/thumbnail:scale-105" src={thumbnailSrc} />
          ) : (
            <ImageIcon className="size-5 text-[#2563eb]" />
          )}
          <span className="absolute inset-x-0 bottom-0 truncate bg-slate-950/58 px-1.5 py-0.5 text-[10px] leading-4 text-white">
            {attachment.name}
          </span>
        </button>
        {imagePreviewOpen && thumbnailSrc ? (
          <ImageAttachmentPreview name={attachment.name} src={thumbnailSrc} onClose={() => setImagePreviewOpen(false)} />
        ) : null}
      </>
    );
  }

  return (
    <button
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-sm",
        interactive ? "hover:border-blue-200 hover:bg-blue-50 hover:text-[#1d4ed8]" : "cursor-default",
      )}
      disabled={!interactive}
      onClick={openAttachment}
      title={interactive ? "预览附件" : attachment.name}
      type="button"
    >
      <FileText className="size-3.5 shrink-0 text-[#2563eb]" />
      <span className="truncate">{attachment.name}</span>
    </button>
  );
}

/** 分支切换器用于展示历史消息存在多分支时的切换入口。 */
function BranchPicker() {
  return (
    <AuiIf condition={({ message }) => message.branchCount > 1}>
      <BranchPickerPrimitive.Root>
        <div className="mt-2 inline-flex items-center gap-1 rounded-md border bg-white p-1 text-xs text-slate-500">
          <BranchPickerPrimitive.Previous className="inline-flex size-6 items-center justify-center rounded hover:bg-slate-100">
            <ChevronLeft className="size-3.5" />
          </BranchPickerPrimitive.Previous>
          <span className="min-w-10 text-center">
            <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
          </span>
          <BranchPickerPrimitive.Next className="inline-flex size-6 items-center justify-center rounded hover:bg-slate-100">
            <ChevronRight className="size-3.5" />
          </BranchPickerPrimitive.Next>
        </div>
      </BranchPickerPrimitive.Root>
    </AuiIf>
  );
}

/** 用户消息气泡，保持紧凑右对齐，适合高频输入与复制。 */
export function UserMessage() {
  return (
    <MessagePrimitive.Root className="group flex justify-end px-4 py-4 sm:px-7">
      <article className="min-w-0 max-w-[min(720px,100%)] flex-1">
        <div className="chat-user-bubble rounded-2xl border px-4 py-3.5 text-sm leading-6 shadow-sm sm:px-5">
          <MessagePrimitive.Attachments>
            {({ attachment }) => (
              <div className="mb-2 inline-flex max-w-full pr-2 align-top">
                <AttachmentChip attachment={attachment as ChatAttachment} />
              </div>
            )}
          </MessagePrimitive.Attachments>
          <MessagePrimitive.Parts components={{ Text: MarkdownTextPart }} />
        </div>
        <MessageMetaActions align="right" />
        <BranchPicker />
      </article>
    </MessagePrimitive.Root>
  );
}

/** 助手消息采用文档阅读布局，承载 Markdown、工具卡和错误状态。 */
export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group flex px-4 py-4 sm:px-7">
      <article className="min-w-0 max-w-[min(920px,100%)] flex-1">
        <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium tracking-[0.14em] text-slate-400 uppercase">
          <span className="size-1.5 rounded-full bg-[#2563eb]" />
          <span>小隐</span>
        </div>
        <div className="chat-assistant-panel rounded-3xl px-5 py-5 sm:px-6">
          <MessagePrimitive.Error>
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              当前回复生成失败，请查看下方原因后重试。
            </div>
          </MessagePrimitive.Error>
          <div className="chat-assistant-body">
            <MessagePrimitive.Parts
              components={{
                Empty: EmptyResponsePart,
                Text: MarkdownTextPart,
                tools: { Fallback: ToolCallPart },
              }}
            />
          </div>
        </div>
        <MessageMetaActions />
        <BranchPicker />
      </article>
    </MessagePrimitive.Root>
  );
}
