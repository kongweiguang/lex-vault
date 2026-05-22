import { LoaderCircle, QrCode, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isWechatLoginRunning, type WechatLoginStatus } from "@/services/wechat-service";

type SettingsWechatLoginDialogProps = {
  /** 是否展示微信扫码连接弹层。 */
  isOpen: boolean;
  /** 当前 law-admin 是否已登录。 */
  hasLoggedIn: boolean;
  /** 当前微信扫码状态。 */
  status: WechatLoginStatus;
  /** 是否正在请求后端启动或刷新二维码。 */
  isBusy: boolean;
  /** 关闭或取消弹层。 */
  onClose: () => void;
  /** 重新生成二维码。 */
  onRefresh: () => void;
};

/** 微信扫码连接状态弹层。 */
export function SettingsWechatLoginDialog({
  hasLoggedIn,
  isBusy,
  isOpen,
  onClose,
  onRefresh,
  status,
}: SettingsWechatLoginDialogProps) {
  if (!isOpen) {
    return null;
  }

  const running = isWechatLoginRunning(status.status);
  const connected = status.status === "connected";
  const failed = status.status === "failed" || status.status === "expired";
  const statusText = wechatStatusText(status);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-lg rounded-xl border bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <QrCode className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold leading-none text-slate-900">微信扫码连接小隐</h2>
              <p className="mt-1 text-xs text-slate-500">连接个人微信 Bot，不替代 律隐台 账号登录。</p>
            </div>
          </div>
          <Button aria-label="关闭微信扫码连接弹窗" onClick={onClose} size="icon" type="button" variant="ghost">
            <X />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              connected && "border-emerald-200 bg-emerald-50 text-emerald-700",
              failed && "border-amber-200 bg-amber-50 text-amber-700",
              !connected && !failed && "border-blue-100 bg-blue-50 text-blue-700",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {running || isBusy ? <LoaderCircle className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              {statusText}
            </span>
          </div>

          {!hasLoggedIn ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              微信可以先连接；完成 Lex Vault 账号登录后，小隐会通过桌面端对话历史回复微信消息。
            </div>
          ) : null}

          {status.qrAscii ? (
            <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-slate-900 bg-slate-950 p-6">
              <pre className="mx-auto w-fit whitespace-pre font-mono text-[7px] leading-[7px] text-white sm:text-[8px] sm:leading-[8px]">
                {status.qrAscii.trim()}
              </pre>
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed bg-slate-50 text-center text-sm text-slate-500">
              <QrCode className="mb-3 size-10 text-slate-300" />
              {connected ? "微信已连接，无需重复扫码。" : "正在准备微信二维码..."}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <Button onClick={onClose} type="button" variant="outline">
              {running ? "取消" : "关闭"}
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={isBusy} onClick={onRefresh} type="button">
              {isBusy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              重新生成二维码
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 将微信状态码转换为用户可读文案。 */
function wechatStatusText(status: WechatLoginStatus) {
  if (status.message) {
    return status.message;
  }

  switch (status.status) {
    case "starting":
      return "正在启动微信扫码连接...";
    case "waiting":
      return "等待微信扫码确认。";
    case "scanned":
      return "已扫码，请在微信中继续确认。";
    case "expired":
      return "二维码已过期，请重新生成。";
    case "connected":
      return "微信已连接。";
    case "failed":
      return "微信连接失败，请重试。";
    case "canceled":
      return "已取消微信扫码连接。";
    default:
      return "微信尚未连接。";
  }
}
