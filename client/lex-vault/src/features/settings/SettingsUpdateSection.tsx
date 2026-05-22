import { Check, LoaderCircle, Monitor, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/features/settings/settings-panel-primitives";
import { formatBytes } from "@/features/settings/settings-panel-helpers";
import type { AppUpdaterState, AppVersionInfo } from "@/types/domain";

type SettingsUpdateSectionProps = {
  updaterState: AppUpdaterState;
  versionInfo: AppVersionInfo;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
};

/** 设置页应用更新区域。 */
export function SettingsUpdateSection({
  updaterState,
  versionInfo,
  onCheckUpdate,
  onInstallUpdate,
}: SettingsUpdateSectionProps) {
  const isCheckingUpdate = updaterState.status === "checking";
  const isInstallingUpdate = updaterState.status === "downloading";
  const shouldShowInstallButton = updaterState.status === "available" || updaterState.status === "downloading";

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">应用更新</h2>
          <p className="mt-1 text-sm text-slate-500">当前版本 {versionInfo.currentVersion || "读取中"}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            className="bg-[#1d4ed8]"
            disabled={isCheckingUpdate || isInstallingUpdate}
            onClick={onCheckUpdate}
            type="button"
          >
            {isCheckingUpdate ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {isCheckingUpdate ? "检查中" : "检查更新"}
          </Button>
          {shouldShowInstallButton ? (
            <Button
              disabled={isCheckingUpdate || isInstallingUpdate}
              onClick={onInstallUpdate}
              type="button"
              variant="outline"
            >
              {isInstallingUpdate ? <LoaderCircle className="animate-spin" /> : <Check />}
              {isInstallingUpdate ? "下载中" : "下载并安装"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusPanel icon={Monitor} title="当前版本" value={versionInfo.currentVersion || "读取中"} />
        <StatusPanel
          icon={RefreshCw}
          title="更新状态"
          value={updaterState.statusText}
          valueClassName={
            updaterState.status === "check-failed" || updaterState.status === "download-failed"
              ? "text-red-600"
              : undefined
          }
        />
        <StatusPanel icon={Check} title="目标版本" value={updaterState.nextVersion || "暂无"} />
      </div>

      {typeof updaterState.totalBytes === "number" && updaterState.totalBytes > 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          已下载 {formatBytes(updaterState.downloadedBytes ?? 0)} / {formatBytes(updaterState.totalBytes)}
        </p>
      ) : null}
      {updaterState.errorMessage ? <p className="mt-3 text-sm text-red-600">{updaterState.errorMessage}</p> : null}
      {updaterState.releaseNotes ? (
        <div className="mt-4 rounded-lg border bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">版本说明</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{updaterState.releaseNotes}</p>
        </div>
      ) : null}
    </section>
  );
}
