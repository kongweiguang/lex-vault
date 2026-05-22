import type { FormEvent } from "react";
import { KeyRound, LoaderCircle, LogIn, RefreshCw, ShieldCheck, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogInput } from "@/features/settings/settings-panel-primitives";
import { cn } from "@/lib/utils";

import type { CaptchaState, LoginDialogState } from "@/features/settings/settings-panel-types";

type SettingsLoginDialogProps = {
  isOpen: boolean;
  isLoggingIn: boolean;
  isRefreshingCaptcha: boolean;
  loginDialog: LoginDialogState;
  captcha: CaptchaState;
  loginError: string;
  loginButtonDisabled: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onRefreshCaptcha: () => void;
  onChange: (patch: Partial<LoginDialogState>) => void;
};

/** 设置页登录弹层。 */
export function SettingsLoginDialog({
  isOpen,
  isLoggingIn,
  isRefreshingCaptcha,
  loginDialog,
  captcha,
  loginError,
  loginButtonDisabled,
  onClose,
  onSubmit,
  onRefreshCaptcha,
  onChange,
}: SettingsLoginDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-xl border bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-2">
          <h2 className="text-base font-semibold leading-none text-slate-900">登录</h2>
          <Button aria-label="关闭登录弹窗" onClick={onClose} size="icon" type="button" variant="ghost">
            <X />
          </Button>
        </div>

        <form className="space-y-4 px-5 py-5" onSubmit={onSubmit}>
          <DialogInput
            icon={User}
            label="账号"
            onChange={(value) => onChange({ username: value })}
            placeholder="请输入用户名"
            value={loginDialog.username}
          />
          <DialogInput
            icon={KeyRound}
            label="密码"
            onChange={(value) => onChange({ password: value })}
            placeholder="请输入密码"
            type="password"
            value={loginDialog.password}
          />

          {captcha.enabled ? (
            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">验证码</span>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <DialogInput
                  icon={ShieldCheck}
                  onChange={(value) => onChange({ code: value })}
                  placeholder="请输入验证码"
                  value={loginDialog.code}
                />
                <button
                  className="flex h-11 items-center justify-center overflow-hidden rounded-md border bg-slate-50 text-xs text-slate-500 transition hover:border-slate-300 disabled:cursor-wait"
                  disabled={isRefreshingCaptcha}
                  onClick={onRefreshCaptcha}
                  type="button"
                >
                  {captcha.imageBase64 ? (
                    <img alt="验证码" className="h-full w-full object-cover" src={`data:image/gif;base64,${captcha.imageBase64}`} />
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {isRefreshingCaptcha ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      加载验证码
                    </span>
                  )}
                </button>
              </div>
              <div className="flex justify-end">
                <Button className="h-8 px-2 text-xs" onClick={onRefreshCaptcha} type="button" variant="ghost">
                  <RefreshCw className={cn(isRefreshingCaptcha && "animate-spin")} />
                  刷新验证码
                </Button>
              </div>
            </div>
          ) : null}

          {loginError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{loginError}</div> : null}

          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={onClose} type="button" variant="outline">
              取消
            </Button>
            <Button className="bg-[#1d4ed8]" disabled={loginButtonDisabled} type="submit">
              {isLoggingIn ? <LoaderCircle className="animate-spin" /> : <LogIn />}
              {isLoggingIn ? "登录中" : "确认登录"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
