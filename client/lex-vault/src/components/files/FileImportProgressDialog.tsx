import { CheckCircle2, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AppFileImportState } from "@/types/domain";

type FileImportProgressDialogProps = {
  state: AppFileImportState;
  onClose: () => void;
};

/** 文件管理导入外部路径时的全局进度弹框。 */
export function FileImportProgressDialog({
  state,
  onClose,
}: FileImportProgressDialogProps) {
  if (!state.visible) {
    return null;
  }

  const progressPercent = state.totalCount > 0
    ? Math.min(100, Math.round((state.completedCount / state.totalCount) * 100))
    : 0;
  const isRunning = state.status === "running";
  const isSuccess = state.status === "success";
  const hasFailures = state.failedItems.length > 0;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg overflow-hidden rounded-[28px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[0_32px_96px_rgba(15,23,42,0.28)]">
        <div className="ui-dialog-header-gradient px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                isRunning
                  ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100"
                  : hasFailures
                    ? "bg-amber-50 text-amber-600 ring-1 ring-amber-100"
                    : "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
              }`}
              >
                {isRunning ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : hasFailures ? (
                  <TriangleAlert className="size-5" />
                ) : (
                  <CheckCircle2 className="size-5" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">
                  {isRunning ? "正在导入文件" : hasFailures ? "导入已完成，部分失败" : "导入完成"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                  {state.sourceLabel} 正在导入到 {state.targetLabel}。
                </p>
              </div>
            </div>
            {!isRunning ? (
              <Button aria-label="关闭导入进度弹框" onClick={onClose} size="icon" type="button" variant="ghost">
                <X />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[color:var(--color-card-foreground)]">
                {isRunning ? "正在处理导入项" : "导入结果"}
              </span>
              <span className="text-[color:var(--color-muted-foreground)]">
                {state.completedCount} / {state.totalCount}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  hasFailures && !isRunning
                    ? "bg-[linear-gradient(90deg,#f59e0b,#f97316)]"
                    : isSuccess
                      ? "bg-emerald-500"
                      : "bg-[linear-gradient(90deg,#2563eb,#38bdf8)]"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              {state.currentPath
                ? `当前项：${state.currentPath}`
                : hasFailures
                  ? `成功 ${state.importedPaths.length} 项，失败 ${state.failedItems.length} 项。`
                  : `成功导入 ${state.importedPaths.length} 项。`}
            </div>
          </div>

          {state.importedPaths.length > 0 ? (
            <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4">
              <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">已导入</p>
              <div className="mt-2 max-h-32 space-y-1 overflow-auto text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {state.importedPaths.map((path) => (
                  <p key={path}>{path}</p>
                ))}
              </div>
            </div>
          ) : null}

          {state.failedItems.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">失败项</p>
              <div className="mt-2 max-h-36 space-y-2 overflow-auto text-xs leading-5 text-amber-700">
                {state.failedItems.map((item) => (
                  <div key={`${item.sourcePath}:${item.reason}`}>
                    <p>{item.sourcePath}</p>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)] px-6 py-4">
          <Button disabled={isRunning} onClick={onClose} type="button" variant={isRunning ? "outline" : "default"}>
            {isRunning ? "导入中" : "关闭"}
          </Button>
        </div>
      </section>
    </div>
  );
}
