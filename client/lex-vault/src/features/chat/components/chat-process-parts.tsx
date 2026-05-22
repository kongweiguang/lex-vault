import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { AlertCircle, ChevronRight, FileText, Loader2, PencilLine, Search, TerminalSquare, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { AGENT_DISPLAY_NAME, AGENT_PROCESS_TOOL_NAME } from "@/constants/agent";
import { MarkdownLink } from "@/features/chat/components/chat-markdown";
import type { ProcessItem, ProcessMeta, ProcessPayload, ProcessStep } from "@/features/chat/chat-panel-types";

/** 将毫秒耗时压缩为适合过程区展示的短耗时标签。 */
function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 1000) {
    return "";
  }
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 1);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** 从聚合 tool-call 参数中恢复过程正文、耗时和步骤，兼容运行中 args 和完成后 result 两种来源。 */
function processPayloadFromPart(args: unknown, result: unknown): ProcessPayload {
  const source = result && typeof result === "object" ? result : args;
  const processText =
    source && typeof source === "object" && typeof (source as { processText?: unknown }).processText === "string"
      ? (source as { processText: string }).processText
      : "";
  const processMeta =
    source && typeof source === "object" && typeof (source as { processMeta?: unknown }).processMeta === "object"
      ? (source as { processMeta?: ProcessMeta }).processMeta
      : undefined;
  const steps =
    source && typeof source === "object" && Array.isArray((source as { steps?: unknown }).steps)
      ? (source as { steps: ProcessStep[] }).steps
      : [];
  const processItems =
    source && typeof source === "object" && Array.isArray((source as { processItems?: unknown }).processItems)
      ? (source as { processItems: ProcessItem[] }).processItems
      : [];
  return { processText, processMeta, processItems, steps };
}

/** 根据底层 item 类型生成面向用户的过程文案。 */
function processStepLabel(step: ProcessStep) {
  const rawTarget = step.command || step.path || step.name || step.kind || "工具调用";
  const target = rawTarget.replace(/\bCodex\b/gi, AGENT_DISPLAY_NAME);
  if (step.kind === "commandExecution") {
    return `${step.status === "running" ? "正在运行" : "已运行"} ${target}`;
  }
  if (step.kind === "fileChange") {
    return `${step.status === "running" ? "正在编辑" : "已编辑"} ${target}`;
  }
  if (step.kind === "webSearch") {
    return `${AGENT_DISPLAY_NAME}${step.status === "running" ? "正在搜索" : "已完成搜索"} ${target}`;
  }
  if (step.kind === "contextCompaction") {
    return step.status === "running" ? "正在压缩当前会话上下文" : "已压缩当前会话上下文";
  }
  return `${step.status === "running" ? "正在调用" : "已调用"} ${target}`;
}

/** 过程步骤图标保持低噪声，帮助用户快速区分命令、文件和搜索。 */
function ProcessStepIcon({ step }: { step: ProcessStep }) {
  if (step.status === "running") {
    return <Loader2 className="size-3.5 animate-spin text-[color:var(--color-primary)]" />;
  }
  if (step.status === "error") {
    return <AlertCircle className="size-3.5 text-rose-600" />;
  }
  if (step.kind === "fileChange") {
    return <PencilLine className="size-3.5 text-[color:var(--color-primary)]" />;
  }
  if (step.kind === "webSearch") {
    return <Search className="size-3.5 text-[color:var(--color-primary)]" />;
  }
  if (step.kind === "commandExecution") {
    return <TerminalSquare className="size-3.5 text-[color:var(--color-primary)]" />;
  }
  return <Wrench className="size-3.5 text-[color:var(--color-primary)]" />;
}

/** 过程区单个工具步骤卡片，历史和实时过程共用这一套展示。 */
function ProcessStepCard({ step }: { step: ProcessStep }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-card)_92%,transparent)] px-3 py-2.5 text-xs text-[color:var(--color-muted-foreground)] shadow-sm">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <ProcessStepIcon step={step} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[color:var(--color-card-foreground)]">{processStepLabel(step)}</div>
          {step.path && step.path !== step.command ? (
            <div className="mt-1 truncate text-[color:var(--color-muted-foreground)]">{step.path}</div>
          ) : null}
          {step.outputPreview ? (
            <pre className="chat-scrollbar mt-2 max-h-28 overflow-auto rounded border bg-slate-950 p-2 text-[11px] leading-5 text-slate-100">
              <code>{step.outputPreview}</code>
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 小隐单块处理过程，运行中展开，完成后折叠。 */
function ProcessGroupPart({
  args,
  result,
  isError,
  status,
}: {
  args: unknown;
  result: unknown;
  isError?: boolean;
  status: ToolCallMessagePartProps["status"];
}) {
  const { processText, processMeta, processItems, steps } = processPayloadFromPart(args, result);
  const orderedItems = processItems.length
    ? [...processItems].sort((left, right) => left.order - right.order)
    : [
        ...(processText.trim() ? [{ id: "process-text", type: "text" as const, order: 0, text: processText }] : []),
        ...steps.map((step, index) => ({
          id: `process-step-${step.id}`,
          type: "tool" as const,
          order: index + 1,
          toolCall: step,
        })),
      ];
  const running = status.type === "running" || steps.some((step) => step.status === "running");
  const commandCount = steps.filter((step) => step.kind === "commandExecution").length;
  const fileCount = steps.filter((step) => step.kind === "fileChange").length;
  const otherCount = Math.max(steps.length - commandCount - fileCount, 0);
  const durationLabel = formatDuration(processMeta?.durationMs);
  const stats = [
    fileCount ? `已编辑 ${fileCount} 个文件` : "",
    commandCount ? `已运行 ${commandCount} 个命令` : "",
    otherCount ? `${AGENT_DISPLAY_NAME}处理 ${otherCount} 个工具` : "",
  ].filter(Boolean).join("，") || (running ? `${AGENT_DISPLAY_NAME}正在处理` : `${AGENT_DISPLAY_NAME}已处理`);
  const title = running
    ? durationLabel
      ? `${AGENT_DISPLAY_NAME}处理中 ${durationLabel}`
      : `${AGENT_DISPLAY_NAME}正在处理`
    : durationLabel
      ? `${AGENT_DISPLAY_NAME}已处理 ${durationLabel}`
      : `${AGENT_DISPLAY_NAME}已处理`;

  return (
    <details className="mb-5 overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-muted)_86%,transparent)] shadow-sm" open={running || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:color-mix(in_srgb,var(--color-card)_76%,transparent)] hover:text-[color:var(--color-card-foreground)] [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : isError ? (
            <AlertCircle className="size-3.5 shrink-0 text-rose-600" />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--color-muted-foreground)]" />
          )}
          <span className="truncate">{title}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {steps.length ? <span className="hidden truncate text-xs text-[color:var(--color-muted-foreground)] sm:block">{stats}</span> : null}
          <ChevronRight className="size-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        </div>
      </summary>

      <div className="space-y-3 border-t border-[color:var(--color-border)] px-4 py-4">
        {orderedItems.length ? (
          <div className="chat-scrollbar max-h-72 space-y-2 overflow-auto pr-1">
            {orderedItems.map((item) => (
              item.type === "text" ? (
                <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:color-mix(in_srgb,var(--color-card)_92%,transparent)] px-3 py-2.5 shadow-sm" key={item.id}>
                  <div className="chat-markdown text-sm text-[color:var(--color-card-foreground)]">
                    <ReactMarkdown components={{ a: MarkdownLink }} rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
                      {item.text ?? ""}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : item.toolCall ? (
                <ProcessStepCard key={item.id} step={item.toolCall} />
              ) : null
            ))}
          </div>
        ) : null}
        {!orderedItems.length ? (
          <div className="inline-flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
            {running ? <Loader2 className="size-3.5 animate-spin text-[color:var(--color-primary)]" /> : null}
            {running ? "正在思考" : "无额外过程记录"}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** 运行中还没有文本和工具时的占位，避免用户看到空响应框。 */
export function EmptyResponsePart() {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
      <Loader2 className="size-3.5 animate-spin text-[color:var(--color-primary)]" />
      正在思考
    </div>
  );
}

/** 渲染 assistant-ui tool-call part，展示工具名称、输入、输出和执行状态。 */
export function ToolCallPart({
  toolName,
  args,
  argsText,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  if (toolName === AGENT_PROCESS_TOOL_NAME || toolName === "codex_process") {
    return <ProcessGroupPart args={args} isError={isError} result={result} status={status} />;
  }

  const title = String(args?.title || toolName || "工具调用");
  const command = typeof args?.command === "string" ? args.command : "";
  const path = typeof args?.path === "string" ? args.path : "";
  const kind = typeof args?.kind === "string" ? args.kind : toolName;
  const resultData = result && typeof result === "object" ? (result as { outputPreview?: unknown }) : undefined;
  const outputPreview = typeof resultData?.outputPreview === "string" ? resultData.outputPreview : "";
  const running = status.type === "running";

  return (
    <details className="my-3 overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--color-primary)_16%,var(--color-border))] bg-[color:color-mix(in_srgb,var(--color-secondary)_72%,transparent)]" open={running || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[color:var(--color-card)] px-3 py-2 hover:bg-[color:var(--color-secondary)] [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              isError ? "bg-rose-100 text-rose-700" : "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]",
            )}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <TerminalSquare className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[color:var(--color-card-foreground)]">{title}</p>
            <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">{kind}</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-medium",
            isError ? "bg-rose-100 text-rose-700" : running ? "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]" : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
          )}
        >
          {isError ? "失败" : running ? "执行中" : "已完成"}
        </span>
      </summary>

      <div className="space-y-3 border-t border-[color:color-mix(in_srgb,var(--color-primary)_16%,var(--color-border))] px-3 py-3">
        {command ? (
          <pre className="chat-scrollbar max-h-44 overflow-auto rounded-md border bg-slate-950 p-3 text-xs leading-5 text-slate-100">
            <code>{command}</code>
          </pre>
        ) : null}
        {path ? (
          <p className="flex min-w-0 items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
            <FileText className="size-3.5 shrink-0 text-[color:var(--color-primary)]" />
            <span className="truncate">{path}</span>
          </p>
        ) : null}
        {outputPreview ? (
          <pre className="chat-scrollbar max-h-48 overflow-auto rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 text-xs leading-5 text-[color:var(--color-card-foreground)]">
            <code>{outputPreview}</code>
          </pre>
        ) : null}
        {!command && !path && !outputPreview && argsText ? (
          <pre className="chat-scrollbar max-h-40 overflow-auto rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            <code>{argsText}</code>
          </pre>
        ) : null}
      </div>
    </details>
  );
}
