import { useContext, useEffect, useState } from "react";
import { AuiIf, AttachmentPrimitive, ComposerPrimitive, type AttachmentAdapter } from "@assistant-ui/react";
import { BookOpen, Check, ChevronDown, CircleAlert, FileText, FileUp, Image, Paperclip, PlugZap, SendHorizontal, Sparkles, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FilePreviewCallbackContext } from "@/features/chat/chat-panel-types";
import type { CodexApprovalDecision, CodexApprovalRequest } from "@/types/codex";
import type { ChatAttachment, ChatPluginOption, ChatSkillOption } from "@/types/domain";
import {
  presentPluginSourceGroupLabel,
  presentMarketplaceName,
  presentPluginDescription,
  presentPluginName,
} from "@/utils/plugin-display";

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "rs",
  "java",
  "py",
  "toml",
  "yaml",
  "yml",
  "ini",
  "log",
]);

type ChatPluginOptionGroup = {
  /** 插件来源分组。 */
  sourceGroup: ChatPluginOption["sourceGroup"];
  /** 分组标题。 */
  label: string;
  /** 当前分组下的插件。 */
  plugins: ChatPluginOption[];
};

/** 将插件选项按“自定义 / 系统预装”顺序分组，供下拉菜单复用。 */
export function groupChatPluginOptions(pluginOptions: ChatPluginOption[]): ChatPluginOptionGroup[] {
  const groups: ChatPluginOptionGroup[] = [];
  for (const sourceGroup of ["custom", "system"] as const) {
    const plugins = pluginOptions.filter((plugin) => plugin.sourceGroup === sourceGroup);
    if (!plugins.length) {
      continue;
    }
    groups.push({
      sourceGroup,
      label: presentPluginSourceGroupLabel(sourceGroup),
      plugins,
    });
  }
  return groups;
}

/** 判断附件是否适合在浏览器侧读取为文本预览。 */
function isReadableTextFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("text/") || TEXT_ATTACHMENT_EXTENSIONS.has(extension);
}

/** assistant-ui 附件适配器负责把浏览器附件转换为可发送的结构化附件。 */
export const chatAttachmentAdapter: AttachmentAdapter = {
  accept: "*",
  async add({ file }) {
    const isImage = file.type.startsWith("image/");
    const thumbnailUrl = isImage ? URL.createObjectURL(file) : undefined;
    return {
      id: `${file.name}-${file.lastModified}-${file.size}`,
      type: isImage ? "image" : isReadableTextFile(file) ? "document" : "file",
      name: file.name,
      contentType: file.type,
      file,
      thumbnailUrl,
      status: { type: "requires-action", reason: "composer-send" } as const,
    };
  },
  async send(attachment) {
    return {
      ...attachment,
      status: { type: "complete" } as const,
      content: [],
    };
  },
  async remove(attachment) {
    const thumbnailUrl = (attachment as { thumbnailUrl?: unknown }).thumbnailUrl;
    if (typeof thumbnailUrl === "string" && thumbnailUrl.startsWith("blob:")) {
      URL.revokeObjectURL(thumbnailUrl);
    }
  },
};

/** 将右键加入的案件材料路径转为 Codex 可理解的上下文片段，只传地址不读取文件内容。 */
export function contextAttachmentToPrompt(attachment: ChatAttachment) {
  if (!attachment.path) {
    return "";
  }

  const nodeLabel = attachment.nodeType === "folder" ? "文件夹" : "文件";
  const sourceLabel = attachment.sourceLabel ?? (attachment.type === "case-path" ? "案件材料" : "知识库");
  const tagName = attachment.type === "case-path" ? "case-material" : "knowledge-reference";
  const relativeLabel = attachment.type === "case-path" ? "案件内相对路径" : "知识库内相对路径";
  const instruction = attachment.type === "case-path"
    ? "请把该路径作为本轮问题的案件材料上下文；如需读取内容，可在当前案件工作目录内使用工具访问该路径。"
    : "请把该路径作为本轮问题的知识库引用；如需读取内容，可使用工具访问该本机路径。";
  return [
    `<${tagName} name="${attachment.name}" kind="${nodeLabel}" source="${sourceLabel}">`,
    `绝对路径：${attachment.path}`,
    attachment.rootPath ? `根目录：${attachment.rootPath}` : "",
    attachment.relativePath ? `${relativeLabel}：${attachment.relativePath}` : "",
    instruction,
    `</${tagName}>`,
  ].filter(Boolean).join("\n");
}

function ComposerAttachmentPreview({
  file,
  name,
  onClose,
}: {
  file?: File;
  name: string;
  onClose: () => void;
}) {
  const [textPreview, setTextPreview] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const readableText = file ? isReadableTextFile(file) : false;
  const image = Boolean(file?.type.startsWith("image/"));
  const pdf = file?.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    if (!file) {
      return undefined;
    }

    if (image || pdf) {
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    if (readableText) {
      let cancelled = false;
      void file.text().then((text) => {
        if (!cancelled) {
          setTextPreview(text.length > 20_000 ? `${text.slice(0, 20_000)}\n\n[预览内容已截断]` : text);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    return undefined;
  }, [file, image, name, pdf, readableText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-xl">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[color:var(--color-card-foreground)]">{name}</h3>
            <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">{file?.type || "未知文件类型"}</p>
          </div>
          <Button aria-label="关闭预览" size="icon" type="button" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="chat-scrollbar min-h-0 flex-1 overflow-auto bg-[color:var(--color-background)] p-4">
          {image && previewUrl ? (
            <img alt={name} className="mx-auto max-h-[70vh] max-w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] object-contain" src={previewUrl} />
          ) : pdf && previewUrl ? (
            <iframe className="h-[70vh] w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)]" src={previewUrl} title={name} />
          ) : readableText ? (
            <pre className="chat-scrollbar max-h-[70vh] overflow-auto rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 text-xs leading-5 text-[color:var(--color-card-foreground)]">
              <code>{textPreview || "正在读取预览"}</code>
            </pre>
          ) : (
            <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-6 text-sm text-[color:var(--color-muted-foreground)]">
              当前文件类型暂不支持直接预览，可以随问题一起发送文件摘要。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerAttachmentChip({ attachment }: { attachment: ChatAttachment & { file?: File } }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = attachment.type === "image" || attachment.contentType?.startsWith("image/");
  const thumbnailUrl = typeof attachment.thumbnailUrl === "string" ? attachment.thumbnailUrl : "";
  return (
    <>
      <AttachmentPrimitive.Root className="group/attachment inline-flex max-w-full items-center gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-xs text-[color:var(--color-muted-foreground)] shadow-sm">
        <button
          className={cn(
            "inline-flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-[color:var(--color-secondary)]",
            isImage ? "p-1.5 pr-2" : "px-3 py-2",
          )}
          title="预览附件"
          type="button"
          onClick={() => setPreviewOpen(true)}
        >
          {isImage ? (
            <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]">
              {thumbnailUrl ? (
                <img alt={attachment.name} className="h-full w-full object-cover" src={thumbnailUrl} />
              ) : (
                <Image className="size-4 text-[color:var(--color-primary)]" />
              )}
            </span>
          ) : (
            <FileText className="size-4 shrink-0 text-[color:var(--color-primary)]" />
          )}
          <span className={cn("truncate font-medium", isImage ? "max-w-36" : "max-w-52")}>
            <AttachmentPrimitive.Name />
          </span>
        </button>
        <AttachmentPrimitive.Remove
          className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-card-foreground)]"
          title="移除附件"
        >
          <X className="size-3.5" />
        </AttachmentPrimitive.Remove>
      </AttachmentPrimitive.Root>
      {previewOpen ? (
        <ComposerAttachmentPreview file={attachment.file} name={attachment.name} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </>
  );
}

/** 右键加入聊天框的案件材料路径卡片。 */
function ContextAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  /** 从当前输入区移除该路径上下文。 */
  onRemove: (attachmentId: string) => void;
}) {
  const onPreviewAttachment = useContext(FilePreviewCallbackContext);
  const isFolder = attachment.nodeType === "folder";
  const sourceLabel = attachment.sourceLabel ?? (attachment.type === "case-path" ? "案件材料" : "知识库引用");
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-[color:color-mix(in_srgb,var(--color-primary)_18%,var(--color-border))] bg-[color:var(--color-secondary)] px-3 py-2 text-xs text-[color:var(--color-card-foreground)]">
      {isFolder ? <FileUp className="size-4 shrink-0 text-[color:var(--color-primary)]" /> : <FileText className="size-4 shrink-0 text-[color:var(--color-primary)]" />}
      <button
        className="min-w-0 text-left hover:text-[color:var(--color-primary)] disabled:hover:text-[color:var(--color-card-foreground)]"
        disabled={!attachment.path || isFolder}
        onClick={() => onPreviewAttachment?.({ ...attachment, sourceLabel: "案件材料" })}
        title={isFolder ? "文件夹会作为上下文发送" : "在右侧预览"}
        type="button"
      >
        <div className="truncate font-medium">{attachment.name}</div>
        <div className="truncate text-[color:var(--color-muted-foreground)]">{sourceLabel} · {attachment.relativePath || attachment.path}</div>
      </button>
      <button
        aria-label={`移除${attachment.name}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-card)] hover:text-[color:var(--color-card-foreground)]"
        onClick={() => onRemove(attachment.id)}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function riskLevelLabel(riskLevel: CodexApprovalRequest["riskLevel"]) {
  if (riskLevel === "critical") {
    return "高危";
  }
  if (riskLevel === "high") {
    return "高风险";
  }
  if (riskLevel === "medium") {
    return "需确认";
  }
  return "低风险";
}

function ApprovalInlineCard({
  approvals,
  onApprovalDecision,
}: {
  approvals: CodexApprovalRequest[];
  onApprovalDecision: (request: CodexApprovalRequest, decision: CodexApprovalDecision) => Promise<void>;
}) {
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);
  const approval = approvals[0];
  if (!approval) {
    return null;
  }

  async function decide(decision: CodexApprovalDecision) {
    setDecidingRequestId(approval.id);
    try {
      await onApprovalDecision(approval, decision);
    } finally {
      setDecidingRequestId(null);
    }
  }

  const deciding = decidingRequestId === approval.id;
  const detail = approval.command || approval.paths[0] || approval.toolName || approval.operationType;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-amber-300/45 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-50">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-300/15 dark:text-amber-200">
            <CircleAlert className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{approval.title || "小隐请求执行操作"}</p>
              <span className="rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-300/15 dark:text-amber-100">
                {riskLevelLabel(approval.riskLevel)}
              </span>
              {approvals.length > 1 ? (
                <span className="text-[11px] text-amber-800/75 dark:text-amber-100/75">还有 {approvals.length - 1} 个待处理</span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
              {approval.reason || "小隐需要你的确认后才能继续当前任务。"}
            </p>
            {detail ? (
              <p className="mt-1 truncate rounded border border-amber-300/35 bg-white/55 px-2 py-1 font-mono text-[11px] text-amber-900 dark:border-amber-300/20 dark:bg-slate-950/25 dark:text-amber-50">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
          <Button
            disabled={deciding}
            onClick={() => void decide("deny")}
            size="sm"
            type="button"
            variant="outline"
          >
            拒绝
          </Button>
          <Button
            disabled={deciding}
            onClick={() => void decide("allow_once")}
            size="sm"
            type="button"
          >
            允许本次
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 输入区封装发送、停止和附件入口，保证键盘发送与运行状态一致。 */
export function ChatComposer({
  agentEnabled,
  contextAttachments,
  isStreaming,
  onRemoveContextAttachment,
  onKnowledgeBaseOpen,
  onApprovalDecision,
  onSkillChange,
  onPluginSelectionChange,
  pluginOptions,
  pendingApprovals,
  selectedPluginIds,
  selectedSkillName,
  skillOptions,
}: {
  agentEnabled: boolean;
  /** 从案件材料右键加入、等待随下一轮问题发送的路径上下文。 */
  contextAttachments: ChatAttachment[];
  /** 当前是否正在生成，生成中禁止切换本次将使用的技能。 */
  isStreaming: boolean;
  /** 移除等待发送的案件材料路径上下文。 */
  onRemoveContextAttachment: (attachmentId: string) => void;
  /** 打开知识库弹层。 */
  onKnowledgeBaseOpen: () => void;
  /** 用户在输入框上方处理 Codex 审批。 */
  onApprovalDecision: (request: CodexApprovalRequest, decision: CodexApprovalDecision) => Promise<void>;
  /** 技能切换回调，案件入口传入后会在发送时注入所选 skill。 */
  onSkillChange?: (skillName: string) => void;
  /** 当前会话插件切换回调。 */
  onPluginSelectionChange?: (pluginIds: string[]) => void;
  /** 当前对话可选插件。 */
  pluginOptions: ChatPluginOption[];
  /** 当前会话等待处理的 Codex 审批请求。 */
  pendingApprovals: CodexApprovalRequest[];
  /** 当前会话已选中的插件 ID。 */
  selectedPluginIds: string[];
  /** 当前选中的 skill 名称。 */
  selectedSkillName?: string | null;
  /** 案件对话预设技能列表。 */
  skillOptions: ChatSkillOption[];
}) {
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false);
  const selectedSkill = skillOptions.find((skill) => skill.name === selectedSkillName) ?? null;
  const selectedPlugins = pluginOptions.filter((plugin) => selectedPluginIds.includes(plugin.id));
  const pluginGroups = groupChatPluginOptions(pluginOptions);
  const canSwitchSkill = agentEnabled && !isStreaming && Boolean(onSkillChange);
  const canSwitchPlugins = agentEnabled && !isStreaming && Boolean(onPluginSelectionChange);

  useEffect(() => {
    if (!isSkillMenuOpen && !isPluginMenuOpen) {
      return;
    }

    const closeMenus = () => {
      setIsSkillMenuOpen(false);
      setIsPluginMenuOpen(false);
    };
    document.addEventListener("click", closeMenus);
    return () => document.removeEventListener("click", closeMenus);
  }, [isPluginMenuOpen, isSkillMenuOpen]);

  return (
    <ComposerPrimitive.AttachmentDropzone
      className="group/dropzone rounded-lg data-[dragging=true]:ring-2 data-[dragging=true]:ring-ring"
      disabled={!agentEnabled}
    >
      <ComposerPrimitive.Attachments>
        {({ attachment }) => (
          <div className="mb-2 inline-flex max-w-full pr-2">
            <ComposerAttachmentChip attachment={attachment} />
          </div>
        )}
      </ComposerPrimitive.Attachments>
      {contextAttachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {contextAttachments.map((attachment) => (
            <ContextAttachmentChip
              attachment={attachment}
              key={attachment.id}
              onRemove={onRemoveContextAttachment}
            />
          ))}
        </div>
      ) : null}
      <ApprovalInlineCard approvals={pendingApprovals} onApprovalDecision={onApprovalDecision} />
      <ComposerPrimitive.Root className="relative rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-sm">
        <div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center bg-[color:color-mix(in_srgb,var(--color-secondary)_86%,transparent)] text-sm font-medium text-[color:var(--color-primary)] group-data-[dragging=true]/dropzone:flex">
          <CircleAlert className="mr-2 size-4" />
          松开后添加到问题
        </div>
        <ComposerPrimitive.Input
          addAttachmentOnPaste
          className="chat-scrollbar max-h-48 min-h-[92px] w-full resize-none rounded-t-lg px-4 py-4 text-sm leading-6 text-[color:var(--color-card-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-muted)]"
          data-lex-vault-chat-input="true"
          disabled={!agentEnabled}
          placeholder={agentEnabled ? "输入问题或任务，可以粘贴文件" : "Agent 当前不可用"}
          rows={3}
          submitMode="enter"
        />
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-b-lg border-t border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <ComposerPrimitive.AddAttachment asChild>
              <Button aria-label="添加附件" disabled={!agentEnabled} size="icon" type="button" variant="ghost">
                <Paperclip />
              </Button>
            </ComposerPrimitive.AddAttachment>
            <Button
              disabled={!agentEnabled}
              onClick={onKnowledgeBaseOpen}
              title="打开知识库"
              type="button"
              variant="outline"
            >
              <BookOpen />
              知识库
            </Button>
            {skillOptions.length ? (
              <div className="relative min-w-0">
                <button
                  aria-expanded={isSkillMenuOpen}
                  aria-haspopup="listbox"
                  className="inline-flex h-9 max-w-[13rem] items-center gap-2 rounded-md border border-[color:color-mix(in_srgb,var(--color-primary)_18%,var(--color-border))] bg-[color:var(--color-card)] px-2.5 text-left text-xs font-medium text-[color:var(--color-card-foreground)] shadow-sm transition hover:border-[color:color-mix(in_srgb,var(--color-primary)_28%,var(--color-border))] hover:bg-[color:var(--color-secondary)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-muted)] disabled:text-[color:var(--color-muted-foreground)]"
                  disabled={!canSwitchSkill}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsSkillMenuOpen((isOpen) => !isOpen);
                  }}
                  title={selectedSkill?.description ?? "请先选择本次案件对话要使用的技能"}
                  type="button"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]">
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate leading-4 text-[color:var(--color-card-foreground)]">{selectedSkill?.label ?? "选择技能"}</span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </button>
                {isSkillMenuOpen ? (
                  <div
                    className="absolute bottom-11 left-0 z-[80] w-64 overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-1 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                    role="listbox"
                  >
                    {skillOptions.map((skill) => {
                      const selected = skill.name === selectedSkill?.name;
                      return (
                        <button
                          aria-selected={selected}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition",
                            selected ? "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]" : "text-[color:var(--color-card-foreground)] hover:bg-[color:var(--color-muted)]",
                          )}
                          key={skill.name}
                          onClick={() => {
                            onSkillChange?.(skill.name);
                            setIsSkillMenuOpen(false);
                          }}
                          role="option"
                          type="button"
                        >
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-[color:var(--color-card)] text-[color:var(--color-primary)] shadow-sm">
                            {selected ? <Check className="size-3.5" /> : <Sparkles className="size-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{skill.label}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{skill.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {pluginOptions.length ? (
              <div className="relative min-w-0">
                <button
                  aria-expanded={isPluginMenuOpen}
                  aria-haspopup="listbox"
                  className="inline-flex h-9 max-w-[15rem] items-center gap-2 rounded-md border border-emerald-300/30 bg-[color:var(--color-card)] px-2.5 text-left text-xs font-medium text-[color:var(--color-card-foreground)] shadow-sm transition hover:border-emerald-300/45 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:bg-[color:var(--color-muted)] disabled:text-[color:var(--color-muted-foreground)]"
                  disabled={!canSwitchPlugins}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsPluginMenuOpen((isOpen) => !isOpen);
                    setIsSkillMenuOpen(false);
                  }}
                  title={selectedPlugins.length ? selectedPlugins.map((plugin) => plugin.name).join("、") : "选择本轮可调用的插件"}
                  type="button"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-emerald-500/10 text-emerald-700">
                    <PlugZap className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate leading-4 text-[color:var(--color-card-foreground)]">
                      {selectedPlugins.length ? `插件 ${selectedPlugins.length} 个` : "选择插件"}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                </button>
                {isPluginMenuOpen ? (
                  <div
                    className="absolute bottom-11 left-0 z-[80] max-h-80 w-72 overflow-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-1 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                    role="listbox"
                  >
                    {pluginGroups.map((group, groupIndex) => (
                      <div key={group.sourceGroup}>
                        {groupIndex > 0 ? (
                          <div className="my-1 border-t border-[color:var(--color-border)]" />
                        ) : null}
                        <div className="px-3 py-2 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">
                          {group.label}
                        </div>
                        {group.plugins.map((plugin) => {
                          const selected = selectedPluginIds.includes(plugin.id);
                          return (
                            <button
                              aria-selected={selected}
                              className={cn(
                                "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition",
                                selected ? "bg-emerald-500/10 text-emerald-700" : "text-[color:var(--color-card-foreground)] hover:bg-[color:var(--color-muted)]",
                              )}
                              key={plugin.id}
                              onClick={() => {
                                const nextPluginIds = selected
                                  ? selectedPluginIds.filter((id) => id !== plugin.id)
                                  : [...selectedPluginIds, plugin.id];
                                onPluginSelectionChange?.(nextPluginIds);
                              }}
                              role="option"
                              type="button"
                            >
                              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-[color:var(--color-card)] text-emerald-700 shadow-sm">
                                {selected ? <Check className="size-3.5" /> : <PlugZap className="size-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold">
                                  {presentPluginName(plugin.id, plugin.name)}
                                </span>
                                <span className="mt-0.5 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                                  {presentMarketplaceName(plugin.marketplaceName)}
                                  {` · ${presentPluginDescription(plugin.id, plugin.description)}`}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <AuiIf condition={({ thread }) => thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button aria-label="停止生成" size="icon" type="button" variant="outline">
                  <Square className="fill-current" />
                </Button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
            <AuiIf condition={({ thread }) => !thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <Button
                  aria-label="发送"
                  disabled={!agentEnabled}
                  size="icon"
                  title="发送"
                  type="submit"
                >
                  <SendHorizontal />
                </Button>
              </ComposerPrimitive.Send>
            </AuiIf>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.AttachmentDropzone>
  );
}
