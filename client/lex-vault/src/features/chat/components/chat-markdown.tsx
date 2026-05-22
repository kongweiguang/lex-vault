import { useContext, type AnchorHTMLAttributes, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import type { TextMessagePartProps } from "@assistant-ui/react";

import type { FilePreviewTarget } from "@/components/files/FilePreviewPanel";
import {
  FilePreviewCallbackContext,
  type PreviewAttachmentPayload,
  UrlOpenCallbackContext,
} from "@/features/chat/chat-panel-types";

const WINDOWS_MARKDOWN_PATH_PATTERN = /^\/?[a-zA-Z]:[\\/]/;
const UNC_MARKDOWN_PATH_PATTERN = /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

/** 解码 Markdown 链接中的本机文件路径，兼容 Codex 输出的 </c:/...> 和 file:///c:/...。 */
export function normalizeMarkdownFilePath(href?: string) {
  const rawHref = href?.trim();
  if (!rawHref) {
    return null;
  }

  if (rawHref.startsWith("file:")) {
    try {
      const parsed = new URL(rawHref);
      if (parsed.hostname && parsed.hostname !== "localhost") {
        return `\\\\${parsed.hostname}${decodeURIComponent(parsed.pathname).replace(/\//g, "\\")}`;
      }
      const decodedPath = decodeURIComponent(parsed.pathname);
      return decodedPath.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
    } catch {
      return null;
    }
  }

  let decodedHref = rawHref;
  try {
    decodedHref = decodeURI(rawHref);
  } catch {
    decodedHref = rawHref;
  }

  if (WINDOWS_MARKDOWN_PATH_PATTERN.test(decodedHref)) {
    return decodedHref.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
  }
  if (UNC_MARKDOWN_PATH_PATTERN.test(decodedHref)) {
    return decodedHref;
  }
  return null;
}

/** 将本机文件路径包装成附件预览载荷，复用既有 Tauri 文件读取链路。 */
export function markdownPathPreviewAttachment(href?: string, label?: string): PreviewAttachmentPayload | null {
  const path = normalizeMarkdownFilePath(href);
  if (!path) {
    return null;
  }
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = label?.trim() || parts[parts.length - 1] || path;
  return {
    id: `markdown-file-${path}`,
    name,
    nodeType: "file",
    path,
    sourceLabel: "聊天链接文件",
    type: "document",
  };
}

/** 将 Markdown 链接规范化为可交给系统浏览器打开的 http/https URL。 */
export function normalizeExternalUrl(href?: string) {
  if (!href) {
    return null;
  }
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    try {
      if (typeof window === "undefined") {
        return null;
      }
      const parsed = new URL(href, window.location.href);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }
}

/** 没有 rootPath 的绝对路径附件退化为父目录 + 文件名，继续复用本机文件命令。 */
export function previewTargetFromAttachment(attachment: PreviewAttachmentPayload): FilePreviewTarget | null {
  if (attachment.nodeType === "folder" || !attachment.path) {
    return null;
  }
  if (attachment.rootPath && attachment.relativePath) {
    return {
      rootPath: attachment.rootPath,
      path: attachment.relativePath,
      name: attachment.name,
      sourceLabel: attachment.sourceLabel ?? "对话附件",
    };
  }

  const separatorIndex = Math.max(attachment.path.lastIndexOf("\\"), attachment.path.lastIndexOf("/"));
  if (separatorIndex < 0) {
    return null;
  }
  return {
    rootPath: attachment.path.slice(0, separatorIndex),
    path: attachment.path.slice(separatorIndex + 1),
    name: attachment.name,
    sourceLabel: attachment.sourceLabel ?? "对话附件",
  };
}

/** 聊天正文中的网页链接默认交给系统浏览器，避免受 iframe/embed 策略限制。 */
export function MarkdownLink({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onPreviewAttachment = useContext(FilePreviewCallbackContext);
  const onOpenUrl = useContext(UrlOpenCallbackContext);
  const externalUrl = normalizeExternalUrl(href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    const label = event.currentTarget.textContent ?? undefined;
    const fileAttachment = markdownPathPreviewAttachment(href, label);
    if (fileAttachment && onPreviewAttachment) {
      event.preventDefault();
      onPreviewAttachment(fileAttachment);
      return;
    }

    if (!externalUrl || !onOpenUrl) {
      return;
    }
    event.preventDefault();
    onOpenUrl(externalUrl, label);
  };

  return (
    <a {...props} href={href} onClick={handleClick}>
      {children}
    </a>
  );
}

/** 渲染 assistant-ui 文本 part，统一支持 Markdown、GFM 表格和安全 HTML 过滤。 */
export function MarkdownTextPart({ text, status }: TextMessagePartProps) {
  return (
    <div className="chat-markdown">
      {text ? (
        <ReactMarkdown components={{ a: MarkdownLink }} rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
          {text}
        </ReactMarkdown>
      ) : null}
      {status.type === "running" ? (
        <span className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          正在思考
        </span>
      ) : null}
    </div>
  );
}
