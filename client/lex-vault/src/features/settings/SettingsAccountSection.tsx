import { Gauge, LoaderCircle, LogIn, LogOut, Mail, Monitor, MoreHorizontal, Package, QrCode, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/features/settings/settings-panel-primitives";
import type { QuotaProgressItem } from "@/features/settings/settings-panel-helpers";
import type { AuthInfo, UserProfileInfo } from "@/types/domain";

type SettingsAccountSectionProps = {
  authInfo: AuthInfo | null;
  userProfile: UserProfileInfo | null;
  userProfileError: string;
  displayName: string;
  avatarText: string;
  packageLabel: string;
  quotaProgressItems: QuotaProgressItem[];
  userPackageSummaryError: string;
  hasLoggedIn: boolean;
  isWechatLoginRunning: boolean;
  onOpenLoginDialog: () => void;
  onOpenWechatLogin: () => void;
  onLogout: () => void;
};

/** 设置页账户信息区域。 */
export function SettingsAccountSection({
  authInfo,
  userProfile,
  userProfileError,
  displayName,
  avatarText,
  packageLabel,
  quotaProgressItems,
  userPackageSummaryError,
  hasLoggedIn,
  isWechatLoginRunning,
  onOpenLoginDialog,
  onOpenWechatLogin,
  onLogout,
}: SettingsAccountSectionProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-slate-900 text-lg font-semibold text-white">
            {avatarText}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{displayName}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {hasLoggedIn ? userProfile?.deptName || userProfile?.userName || "已登录" : "登录后展示远程账号基础信息"}
            </p>
            {userProfileError ? <p className="mt-1 text-sm text-amber-600">{userProfileError}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {hasLoggedIn ? (
            <>
              <Button
                className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                disabled={isWechatLoginRunning}
                onClick={onOpenWechatLogin}
                type="button"
                variant="outline"
              >
                {isWechatLoginRunning ? <LoaderCircle className="animate-spin" /> : <QrCode />}
                {isWechatLoginRunning ? "微信连接中" : "微信扫码连接小隐"}
              </Button>
              <Button
                className="border-red-200 text-red-600 hover:bg-red-50"
                onClick={onLogout}
                type="button"
                variant="outline"
              >
                <LogOut />
                退出登录
              </Button>
            </>
          ) : (
            <Button className="bg-[#1d4ed8]" onClick={onOpenLoginDialog} type="button">
              <LogIn />
              登录账号
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <StatusPanel icon={Mail} title="账号标识" value={userProfile?.userName || authInfo?.username || "等待登录"} />
        <StatusPanel icon={Package} title="套餐名称" value={packageLabel || "未绑定套餐"} />
        <StatusPanel icon={Monitor} title="最近登录" value={userProfile?.loginDate || "暂无记录"} />
      </div>

      <div className="mt-3 rounded-lg border bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <Gauge className="size-4" />
          额度统计
        </div>
        {quotaProgressItems.length > 0 ? (
          <div className="mt-3 space-y-4">
            {quotaProgressItems.map((item) => (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-700">
                  <span>{item.label}剩余</span>
                  <span className="font-medium text-slate-900">{item.percentText}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-[#1d4ed8] transition-[width]"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">暂无额度信息</p>
        )}
      </div>

      {userPackageSummaryError ? <p className="mt-3 text-sm text-amber-600">{userPackageSummaryError}</p> : null}
    </section>
  );
}

/** 设置页顶部标题栏。 */
export function SettingsHeader() {
  return (
    <header className="flex min-h-[65px] shrink-0 items-center justify-between border-b px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-[#1d4ed8] text-white">
          <Settings className="size-4" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">设置</h1>
      </div>
      <Button aria-label="更多设置操作" size="icon" variant="ghost">
        <MoreHorizontal />
      </Button>
    </header>
  );
}
