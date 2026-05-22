import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { renderAsync } from "docx-preview";
import {
  ExternalLink,
  FileArchive,
  FileImage,
  FileText,
  Music,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readNativeFile, resolveNativeFilePath } from "@/services/native-file-service";
import type { FileContent } from "@/types/domain";

/** 右侧预览面板支持的文件来源，rootPath 与 path 由本机命令校验边界。 */
export type FilePreviewTarget = {
  /** 目标类型，缺省按本机文件兼容旧入口。 */
  kind?: "file";
  /** 预览来源根目录，通常是工作空间、案件目录或文件库目录。 */
  rootPath: string;
  /** 相对 rootPath 的文件路径。 */
  path: string;
  /** 文件展示名称，缺省时根据 path 解析。 */
  name?: string;
  /** 已知文件扩展名，用于未读取元数据前判断预览类型。 */
  extension?: string;
  /** 已知文件大小，单位为字节。 */
  size?: number;
  /** 文件来源说明，显示在标题下方帮助用户识别上下文。 */
  sourceLabel?: string;
};

/** 右侧预览面板支持的网页 URL 来源，来自聊天 Markdown 链接点击。 */
export type UrlPreviewTarget = {
  /** 目标类型，用于和本机文件预览区分。 */
  kind: "url";
  /** 需要在右侧预览面板中加载的完整 http/https 地址。 */
  url: string;
  /** 链接展示文本，用于标题栏兜底显示。 */
  title?: string;
  /** 来源说明，显示在标题下方帮助用户识别上下文。 */
  sourceLabel?: string;
};

/** 右侧通用预览目标，统一承载本机文件和聊天链接。 */
export type PreviewTarget = FilePreviewTarget | UrlPreviewTarget;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);
const DOCX_EXTENSIONS = new Set(["docx"]);
const DEFAULT_PREVIEW_WIDTH = 560;
const MIN_PREVIEW_WIDTH = 360;
const MAX_PREVIEW_WIDTH = 900;
/** 预览正文的最大可读宽度，宽屏时通过左右留白保持阅读节奏。 */
const READER_MAX_WIDTH_CLASS = "max-w-5xl";

/** 从文件名或后端字段中提取扩展名，保证不同入口的文件类型判断一致。 */
function previewExtension(target?: FilePreviewTarget | null, content?: FileContent | null) {
  const explicitExtension = content?.extension || target?.extension;
  if (explicitExtension) {
    return explicitExtension.toLowerCase();
  }
  const name = content?.name || target?.name || target?.path || "";
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toLowerCase() : "";
}

/** 判断预览目标是否为聊天链接 URL。 */
function isUrlPreviewTarget(target: PreviewTarget | null | undefined): target is UrlPreviewTarget {
  return target?.kind === "url";
}

/** 生成适合标题栏显示的文件名。 */
function previewName(target?: PreviewTarget | null, content?: FileContent | null) {
  if (isUrlPreviewTarget(target)) {
    return target.title || target.url;
  }
  if (content?.name) {
    return content.name;
  }
  if (target?.name) {
    return target.name;
  }
  const parts = (target?.path ?? "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "文件预览";
}

/** 让尺寸展示紧凑可扫，避免长数字挤占预览标题。 */
function formatFileSize(size?: number) {
  if (!size) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 根据后端返回或扩展名选择预览策略，DOCX 走内置渲染，其余复杂办公格式交给系统默认程序。 */
export function previewKind(extension: string, text: boolean, serverKind?: FileContent["previewKind"]) {
  if (serverKind) {
    return serverKind;
  }
  if (text && MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (text) {
    return "text";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive";
  }
  if (DOCX_EXTENSIONS.has(extension)) {
    return "docx";
  }
  return "external";
}

/** 通用文件预览面板，文件树、案件材料和对话附件都通过它展示右侧预览。 */
export function FilePreviewPanel({
  className,
  collapsed,
  onOpenExternal,
  resizable = false,
  target,
}: {
  className?: string;
  /** 是否折叠为窄工具条。 */
  collapsed: boolean;
  /** 调用系统默认程序或浏览器打开当前预览目标。 */
  onOpenExternal: (target: PreviewTarget) => void;
  /** 是否允许通过左侧拖拽手柄调整预览面板宽度。 */
  resizable?: boolean;
  /** 当前预览目标，空值展示占位。 */
  target: PreviewTarget | null;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const [content, setContent] = useState<FileContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const isUrlTarget = isUrlPreviewTarget(target);
  const fileTarget = target && !isUrlTarget ? target : null;
  const absolutePath = fileTarget ? resolveNativeFilePath(fileTarget.rootPath, fileTarget.path) : "";
  const previewAssetPath = content?.assetPath || absolutePath;
  const assetUrl = useMemo(
    () => (previewAssetPath ? convertFileSrc(previewAssetPath) : ""),
    [previewAssetPath],
  );
  const extension = previewExtension(fileTarget, content);
  const name = previewName(target, content);
  const sizeLabel = formatFileSize(content?.size ?? fileTarget?.size);
  const kind = previewKind(extension, Boolean(content?.text), content?.previewKind);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setErrorText("");
    if (!fileTarget) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void readNativeFile(fileTarget.rootPath, fileTarget.path)
      .then((payload) => {
        if (!cancelled) {
          setContent(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorText("无法读取文件信息");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileTarget?.rootPath, fileTarget?.path]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizable) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? panelWidth;

    /** 拖拽左侧边缘时，鼠标向左扩大、向右缩小。 */
    const resize = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(MAX_PREVIEW_WIDTH, Math.max(window.innerWidth - 520, MIN_PREVIEW_WIDTH));
      const nextWidth = Math.min(Math.max(startWidth + startX - moveEvent.clientX, MIN_PREVIEW_WIDTH), maxWidth);
      setPanelWidth(nextWidth);
    };
    const stopResize = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize, { once: true });
  }, [panelWidth, resizable]);

  if (collapsed) {
    return null;
  }

  return (
    <aside
      className={cn(
        "relative flex min-h-[520px] min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-white shadow-sm lg:min-h-0 lg:w-[min(42vw,640px)]",
        className,
      )}
      ref={panelRef}
      style={resizable ? { width: panelWidth } : undefined}
    >
      {resizable ? (
        <div
          aria-label="调整预览宽度"
          className="absolute bottom-0 left-0 top-0 z-20 w-2 cursor-col-resize touch-none bg-transparent transition hover:bg-blue-200/70"
          onPointerDown={startResize}
          role="separator"
        />
      ) : null}
      <header className="flex min-h-[65px] shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">{target ? name : "文件预览"}</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {target
              ? [target.sourceLabel, isUrlTarget ? target.url : target.path, sizeLabel].filter(Boolean).join(" · ")
              : "点击聊天附件、聊天链接或左侧文件后在这里查看"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {target ? (
            <Button aria-label="使用系统默认程序打开" onClick={() => onOpenExternal(target)} size="icon" type="button" variant="ghost">
              <ExternalLink />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-[#f8fafc] p-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">正在读取文件</div>
        ) : errorText ? (
          <div className="flex h-full items-center justify-center text-sm text-rose-600">{errorText}</div>
        ) : isUrlTarget ? (
          <UrlPreviewBody target={target} />
        ) : target ? (
          <FilePreviewBody
            absolutePath={absolutePath}
            assetUrl={assetUrl}
            content={content}
            externalReason={content?.externalReason}
            extension={extension}
            kind={kind}
            name={name}
            onOpenExternal={() => onOpenExternal(target)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">请选择要查看的文件或链接</div>
        )}
      </div>
    </aside>
  );
}

/** 在右侧面板内承载聊天链接，避免普通点击替换整个 Tauri WebView。 */
function UrlPreviewBody({ target }: { target: UrlPreviewTarget }) {
  return (
    <div className={cn("mx-auto h-full w-full", READER_MAX_WIDTH_CLASS)}>
      <iframe
        className="h-full min-h-[480px] w-full rounded-md border bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
        src={target.url}
        title={target.title || target.url}
      />
    </div>
  );
}

function FilePreviewBody({
  absolutePath,
  assetUrl,
  content,
  externalReason,
  extension,
  kind,
  name,
  onOpenExternal,
}: {
  absolutePath: string;
  assetUrl: string;
  content: FileContent | null;
  externalReason?: string;
  extension: string;
  kind: string;
  name: string;
  onOpenExternal: () => void;
}) {
  if (kind === "text") {
    return (
      <div className={cn("mx-auto min-h-full w-full py-2", READER_MAX_WIDTH_CLASS)}>
        <pre className="min-h-full w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-white p-5 text-left text-sm leading-6 text-slate-800 shadow-sm">
          {content?.content || "文件为空"}
        </pre>
      </div>
    );
  }

  if (kind === "markdown") {
    return (
      <div className={cn("mx-auto min-h-full w-full py-2", READER_MAX_WIDTH_CLASS)}>
        <article className="chat-markdown min-h-full rounded-lg border bg-white p-5 text-left text-slate-800 shadow-sm">
          {content?.content ? (
            <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
              {content.content}
            </ReactMarkdown>
          ) : (
            "文件为空"
          )}
        </article>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="flex h-full items-start justify-center py-2">
        <img alt={name} className="max-h-full max-w-full rounded-md border bg-white object-contain shadow-sm" src={assetUrl} />
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <div className={cn("mx-auto h-full w-full", READER_MAX_WIDTH_CLASS)}>
        <iframe className="h-full min-h-[480px] w-full rounded-md border bg-white" src={assetUrl} title={name} />
      </div>
    );
  }

  if (kind === "docx") {
    return <DocxPreviewBody assetUrl={assetUrl} name={name} onOpenExternal={onOpenExternal} />;
  }

  if (kind === "audio") {
    return (
      <UnsupportedPreview
        actionLabel="播放"
        description={absolutePath}
        icon={<Music className="size-8" />}
        onOpenExternal={onOpenExternal}
        title="音频文件"
      >
        <audio className="mt-4 w-full" controls src={assetUrl} />
      </UnsupportedPreview>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex h-full items-start justify-center py-2">
        <video className="max-h-full max-w-full rounded-md border bg-black shadow-sm" controls src={assetUrl} />
      </div>
    );
  }

  return (
    <UnsupportedPreview
      actionLabel="系统打开"
      description={externalReason || (extension ? `${extension.toUpperCase()} 文件` : absolutePath)}
      icon={kind === "archive" ? <FileArchive className="size-8" /> : extension ? <FileText className="size-8" /> : <FileImage className="size-8" />}
      onOpenExternal={onOpenExternal}
      title="暂不支持内置预览"
    />
  );
}

/** 使用 docx-preview 在右侧面板内渲染 DOCX，避免依赖本机 Office 转换器。 */
function DocxPreviewBody({
  assetUrl,
  name,
  onOpenExternal,
}: {
  assetUrl: string;
  name: string;
  onOpenExternal: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || !assetUrl) {
      return;
    }

    container.innerHTML = "";
    setErrorText("");

    void fetch(assetUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        await renderAsync(buffer, containerRef.current, undefined, {
          className: "docx-preview-render",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setErrorText("DOCX 预览加载失败，请使用系统默认程序打开");
        }
      });

    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [assetUrl]);

  if (errorText) {
    return (
      <UnsupportedPreview
        actionLabel="系统打开"
        description={errorText}
        icon={<FileText className="size-8" />}
        onOpenExternal={onOpenExternal}
        title={`${name} 预览失败`}
      />
    );
  }

  return (
    <div className={cn("mx-auto min-h-full w-full py-2", READER_MAX_WIDTH_CLASS)}>
      <div className="overflow-auto rounded-lg border bg-white p-4 shadow-sm">
        <div className="docx-preview-host min-h-[480px]" ref={containerRef} />
      </div>
    </div>
  );
}

function UnsupportedPreview({
  actionLabel,
  children,
  description,
  icon,
  onOpenExternal,
  title,
}: {
  actionLabel: string;
  children?: ReactNode;
  description: string;
  icon: ReactNode;
  onOpenExternal: () => void;
  title: string;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-lg bg-blue-50 text-[#1d4ed8]">
          {icon}
        </div>
        <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 truncate text-sm text-slate-500">{description}</p>
        {children}
        <Button className="mt-5 bg-[#1d4ed8]" onClick={onOpenExternal} type="button">
          <ExternalLink />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
