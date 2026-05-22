import { Download, LoaderCircle, RefreshCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AppRuntimeBundleState } from "@/types/domain";

type RuntimeBundleBlockingDialogProps = {
  /** 当前 runtime 安装状态。 */
  state: AppRuntimeBundleState;
  /** 失败后重新触发下载。 */
  onRetry: () => void;
};

/** 首次准备 Codex runtime 时的阻断安装弹框。 */
export function RuntimeBundleBlockingDialog({
  onRetry,
  state,
}: RuntimeBundleBlockingDialogProps) {
  const isFailed = state.status === "failed";
  const isDownloading = state.status === "downloading";
  const isExtracting = state.status === "extracting";
  const stepProgressPercent =
    typeof state.stepTotal === "number" && state.stepTotal > 0 && typeof state.stepCurrent === "number"
      ? Math.min(100, Math.round((state.stepCurrent / state.stepTotal) * 100))
      : null;
  const downloadProgressPercent =
    typeof state.totalBytes === "number" && state.totalBytes > 0 && typeof state.downloadedBytes === "number"
      ? Math.min(100, Math.round((state.downloadedBytes / state.totalBytes) * 100))
      : stepProgressPercent;
  const steps = buildRuntimeBundleSteps(state, stepProgressPercent, downloadProgressPercent);
  const currentStepIndex = steps.findIndex((step) => step.state === "current");

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md">
      <section className="w-full max-w-lg overflow-hidden rounded-[28px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[0_32px_96px_rgba(15,23,42,0.32)]">
        <div className="ui-dialog-header-gradient px-6 pb-5 pt-6">
          <div className="flex items-start gap-4">
            <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
              isFailed
                ? "bg-rose-50 text-rose-600 ring-1 ring-rose-100"
                : "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
            }`}
            >
              {isFailed ? <TriangleAlert className="size-5" /> : <Download className="size-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">正在准备助手运行环境</h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                首次进入或本机缺少运行时组件时，需要先完成下载和安装，完成后才能继续使用小隐。
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {isFailed ? (
                  <TriangleAlert className="size-4 text-rose-600" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-blue-600" />
                )}
                <div>
                  <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">{state.statusText}</p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                    {isFailed
                      ? "安装未完成，请重新下载后继续。"
                      : `当前步骤：${currentStepIndex >= 0 ? currentStepIndex + 1 : 1} / ${steps.length}`}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {steps.map((step, index) => (
                <div className="flex items-start gap-3" key={step.key}>
                  <div
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      step.state === "done"
                        ? "bg-emerald-500 text-white"
                        : step.state === "current"
                          ? "bg-blue-600 text-white"
                          : step.state === "error"
                            ? "bg-rose-100 text-rose-600 ring-1 ring-rose-200"
                            : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        step.state === "pending"
                          ? "text-[color:var(--color-muted-foreground)]"
                          : "text-[color:var(--color-card-foreground)]"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{step.description}</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          step.progressPercent === null && step.state === "current"
                            ? "w-1/2 animate-pulse bg-[linear-gradient(90deg,#60a5fa,#38bdf8)]"
                            : step.state === "error"
                              ? "bg-rose-400"
                              : step.state === "done"
                                ? "bg-emerald-500"
                                : "bg-[linear-gradient(90deg,#2563eb,#38bdf8)]"
                        }`}
                        style={step.progressPercent !== null ? { width: `${step.progressPercent}%` } : undefined}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--color-muted-foreground)]">
                      <span>
                        {step.progressPercent !== null ? `${step.progressPercent}%` : step.state === "current" ? "处理中" : "待开始"}
                      </span>
                      {step.key === "download" && state.status === "downloading" && typeof state.totalBytes === "number" && state.totalBytes > 0 ? (
                        <span>
                          已下载 {formatBytes(state.downloadedBytes ?? 0)} / {formatBytes(state.totalBytes)}
                        </span>
                      ) : step.key === "extract" && state.status === "extracting" && typeof state.stepTotal === "number" && state.stepTotal > 0 ? (
                        <span>
                          已处理 {state.stepCurrent ?? 0} / {state.stepTotal} 项
                        </span>
                      ) : step.state === "done" ? (
                        <span>已完成</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {!isFailed ? (
              <p className="mt-4 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                下载完成后还会继续解压、校验并安装内置依赖，请耐心等待，不要关闭应用。
              </p>
            ) : null}
          </div>

          {state.errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
              {state.errorMessage}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)] px-6 py-4">
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            安装完成前，助手相关功能会暂时不可用。
          </p>
          {isFailed ? (
            <Button className="bg-[#1d4ed8] hover:bg-[#1e40af]" onClick={onRetry} type="button">
              <RefreshCcw className="size-4" />
              重新下载
            </Button>
          ) : (
            <Button disabled type="button" variant="outline">
              {isDownloading || isExtracting ? "准备中" : "请稍候"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

type RuntimeBundleStepState = "done" | "current" | "pending" | "error";

type RuntimeBundleStep = {
  key: "detect" | "download" | "extract" | "ready";
  title: string;
  description: string;
  state: RuntimeBundleStepState;
  progressPercent: number | null;
};

/** 根据当前 runtime 安装状态，构建用户可见的步骤列表。 */
function buildRuntimeBundleSteps(
  state: AppRuntimeBundleState,
  stepProgressPercent: number | null,
  downloadProgressPercent: number | null,
): RuntimeBundleStep[] {
  const isDownloadFinished = state.status === "extracting" || state.status === "ready";
  const isReady = state.status === "ready";
  const isFailed = state.status === "failed";
  const currentDownloadDescription =
    downloadProgressPercent !== null
      ? `正在获取运行时压缩包，当前下载进度 ${downloadProgressPercent}%。`
      : "正在获取运行时压缩包，请保持网络畅通。";

  return [
    {
      key: "detect",
      title: "检测运行环境",
      description: "检查本机是否已经存在可用的助手运行时，以及版本是否和当前程序一致。",
      state: state.status === "required" || state.status === "downloading" || isDownloadFinished || isFailed
        ? "done"
        : state.status === "idle"
          ? "current"
          : "pending",
      progressPercent: state.status === "idle" ? null : 100,
    },
    {
      key: "download",
      title: "下载运行时组件",
      description: state.status === "downloading"
        ? currentDownloadDescription
        : state.status === "required"
          ? "已确认本机缺少运行时组件，正在准备开始下载。"
          : "从预设地址下载当前版本的运行时组件压缩包。",
      state: state.status === "downloading" || state.status === "required"
        ? "current"
        : isDownloadFinished
          ? "done"
          : isFailed
            ? "error"
            : "pending",
      progressPercent: state.status === "downloading"
        ? downloadProgressPercent
        : state.status === "required"
          ? null
        : isDownloadFinished
          ? 100
          : 0,
    },
    {
      key: "extract",
      title: "解压并安装",
      description: "解压运行时文件，完成结构校验，并把内置依赖安装到本机目录。",
      state: state.status === "extracting"
        ? "current"
        : isReady
          ? "done"
          : isFailed
            ? "error"
            : "pending",
      progressPercent: state.status === "extracting"
        ? stepProgressPercent
        : isReady
          ? 100
          : 0,
    },
    {
      key: "ready",
      title: "准备完成",
      description: "运行环境就绪后，助手相关功能会自动恢复可用。",
      state: isReady ? "done" : "pending",
      progressPercent: isReady ? 100 : 0,
    },
  ];
}
