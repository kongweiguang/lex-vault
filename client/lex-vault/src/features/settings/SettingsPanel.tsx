import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api-client";
import {
  clearStoredAuthInfo,
  getCurrentUserInfo,
  getCurrentUserPackageSummary,
  getLoginCode,
  getStoredAuthInfo,
  loginWithPassword,
  shouldClearStoredAuthOnUserInfoError,
} from "@/services/auth-service";
import { startCodexRuntime, stopCodexRuntime } from "@/services/codex-service";
import {
  cancelWechatLogin,
  DEFAULT_WECHAT_LOGIN_STATUS,
  isWechatLoginRunning,
  listenWechatLoginEvents,
  readWechatLoginStatus,
  startWechatLogin,
  type WechatLoginStatus,
} from "@/services/wechat-service";
import { SettingsAccountSection, SettingsHeader } from "@/features/settings/SettingsAccountSection";
import {
  CODEX_PROFILE_ID,
  defaultLoginDialogState,
  isLoginButtonDisabled,
  resolveAvatarText,
  resolveDisplayName,
  resolveQuotaAvailableAt,
  resolvePackageLabel,
  resolveQuotaProgressItems,
} from "@/features/settings/settings-panel-helpers";
import { SettingsLoginDialog } from "@/features/settings/SettingsLoginDialog";
import { SettingsPathsSection } from "@/features/settings/SettingsPathsSection";
import { SettingsWechatLoginDialog } from "@/features/settings/SettingsWechatLoginDialog";
import type { CaptchaState, LoginDialogState } from "@/features/settings/settings-panel-types";
import { SettingsThemeSection } from "@/features/settings/SettingsThemeSection";
import { SettingsUpdateSection } from "@/features/settings/SettingsUpdateSection";
import type { AppConfig, AppUpdaterState, AppVersionInfo, AuthInfo, ThemeMode, UserPackageSummary, UserProfileInfo } from "@/types/domain";

export function SettingsPanel({
  config,
  updaterState,
  versionInfo,
  loginPromptSignal = 0,
  onCheckUpdate,
  onInstallUpdate,
  onSaveConfig,
  onThemeModeChange,
  themeMode,
}: {
  config: AppConfig | null;
  /** 当前应用版本信息。 */
  versionInfo: AppVersionInfo;
  /** 当前更新状态。 */
  updaterState: AppUpdaterState;
  /** 对话入口发现未登录时递增该信号，设置页自动打开登录弹层。 */
  loginPromptSignal?: number;
  /** 手动检查更新。 */
  onCheckUpdate: () => Promise<void>;
  /** 安装已发现的新版本。 */
  onInstallUpdate: () => Promise<void>;
  onSaveConfig: (config: Partial<AppConfig>) => Promise<void>;
  onThemeModeChange: (mode: ThemeMode) => void;
  themeMode: ThemeMode;
}) {
  const [draftConfig, setDraftConfig] = useState<AppConfig | null>(config);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [isAuthInfoLoaded, setIsAuthInfoLoaded] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfileInfo | null>(null);
  const [userProfileError, setUserProfileError] = useState("");
  const [userPackageSummary, setUserPackageSummary] = useState<UserPackageSummary | null>(null);
  const [userPackageSummaryError, setUserPackageSummaryError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
  const [isRefreshingCaptcha, setIsRefreshingCaptcha] = useState(false);
  const [loginDialog, setLoginDialog] = useState<LoginDialogState>(defaultLoginDialogState);
  const [captcha, setCaptcha] = useState<CaptchaState>({ enabled: true, imageBase64: "" });
  const [loginError, setLoginError] = useState("");
  const [isWechatDialogOpen, setIsWechatDialogOpen] = useState(false);
  const [isWechatBusy, setIsWechatBusy] = useState(false);
  const [wechatLoginStatus, setWechatLoginStatus] = useState<WechatLoginStatus>(DEFAULT_WECHAT_LOGIN_STATUS);

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  useEffect(() => {
    setIsAuthInfoLoaded(false);
    getStoredAuthInfo()
      .then((storedAuthInfo) => {
        setAuthInfo(storedAuthInfo);
        if (storedAuthInfo.accessToken) {
          void refreshUserProfile(storedAuthInfo.accessToken);
        }
      })
      .catch(() => {
        setAuthInfo(null);
        setUserProfile(null);
        setUserPackageSummary(null);
      })
      .finally(() => {
        setIsAuthInfoLoaded(true);
      });
  }, []);

  useEffect(() => {
    // 设置页会在切换导航时重新挂载，必须等本机 SQLite 登录态读取完成后再判断是否需要登录。
    if (loginPromptSignal > 0 && isAuthInfoLoaded && !authInfo?.accessToken) {
      void openLoginDialog();
    }
  }, [authInfo?.accessToken, isAuthInfoLoaded, loginPromptSignal]);

  useEffect(() => {
    void readWechatLoginStatus()
      .then(setWechatLoginStatus)
      .catch((error) => {
        console.error("读取微信连接状态失败", error);
      });
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenWechatLoginEvents((status) => {
      setWechatLoginStatus(status);
      setIsWechatBusy(false);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isWechatDialogOpen || !isWechatLoginRunning(wechatLoginStatus.status) || wechatLoginStatus.qrAscii) {
      return;
    }

    const timer = window.setTimeout(() => {
      void readWechatLoginStatus()
        .then((latestStatus) => {
          setWechatLoginStatus((currentStatus) => {
            if (
              currentStatus.updatedAt &&
              latestStatus.updatedAt &&
              new Date(latestStatus.updatedAt).getTime() < new Date(currentStatus.updatedAt).getTime()
            ) {
              return currentStatus;
            }
            return latestStatus;
          });
        })
        .catch((error) => {
          console.error("轮询微信连接状态失败", error);
        });
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isWechatDialogOpen, wechatLoginStatus.qrAscii, wechatLoginStatus.status, wechatLoginStatus.updatedAt]);

  async function refreshUserProfile(accessToken?: string) {
    setUserProfileError("");
    setUserPackageSummaryError("");
    try {
      const nextUserProfile = await getCurrentUserInfo(accessToken);
      setUserProfile(nextUserProfile);
      await refreshUserPackageSummary(accessToken);
      return true;
    } catch (error) {
      if (shouldClearStoredAuthOnUserInfoError(error)) {
        await clearStoredAuthInfo();
        await restartRuntimeAfterAuthChange(false);
        setAuthInfo(null);
        setUserProfile(null);
        setUserPackageSummary(null);
        setUserProfileError("登录已失效，请重新登录");
        void openLoginDialog();
        return false;
      }

      setUserProfileError("账号信息刷新失败，请稍后重试");
      return true;
    }
  }

  async function refreshUserPackageSummary(accessToken?: string) {
    try {
      const nextUserPackageSummary = await getCurrentUserPackageSummary(accessToken);
      setUserPackageSummary(nextUserPackageSummary);
      setUserPackageSummaryError("");
    } catch (error) {
      if (shouldClearStoredAuthOnUserInfoError(error)) {
        await clearStoredAuthInfo();
        await restartRuntimeAfterAuthChange(false);
        setAuthInfo(null);
        setUserProfile(null);
        setUserPackageSummary(null);
        setUserPackageSummaryError("");
        setUserProfileError("登录已失效，请重新登录");
        void openLoginDialog();
        throw error;
      }

      setUserPackageSummary(null);
      setUserPackageSummaryError("套餐信息刷新失败，请稍后重试");
    }
  }

  async function chooseDirectory(title: string) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      if (typeof selected === "string") {
        return selected;
      }
    } catch {
      // 浏览器调试环境没有 Tauri dialog 时，保留输入框手动填写。
    }
    return null;
  }

  function updateWorkspaceRoot(value: string) {
    setDraftConfig((current) =>
      current
        ? {
            ...current,
            workspaceRoot: value,
            workspaceDatabase: "",
            docTemplate: "",
            lawDirectory: "",
            caseRef: "",
            caseMaster: "",
          }
        : current,
    );
  }

  function updateConfigField(field: "docTemplate" | "lawDirectory" | "caseRef" | "caseMaster", value: string) {
    setDraftConfig((current) => (current ? { ...current, [field]: value } : current));
  }

  async function chooseWorkspaceRoot() {
    const selected = await chooseDirectory("选择工作空间");
    if (selected) {
      updateWorkspaceRoot(selected);
    }
  }

  async function chooseConfigDirectory(
    title: string,
    field: "docTemplate" | "lawDirectory" | "caseRef" | "caseMaster",
  ) {
    const selected = await chooseDirectory(title);
    if (selected) {
      updateConfigField(field, selected);
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!draftConfig || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      await onSaveConfig({
        workspaceRoot: draftConfig.workspaceRoot,
        docTemplate: draftConfig.docTemplate,
        lawDirectory: draftConfig.lawDirectory,
        caseRef: draftConfig.caseRef,
        caseMaster: draftConfig.caseMaster,
      });
    } catch (error) {
      console.error("保存工作空间配置失败", error);
    } finally {
      setIsSaving(false);
    }
  }

  async function openLoginDialog() {
    setIsLoginDialogOpen(true);
    setLoginError("");
    setCaptcha({ enabled: true, imageBase64: "" });
    setLoginDialog((current) => ({
      ...defaultLoginDialogState,
      username: authInfo?.username ?? current.username,
    }));
    await refreshCaptcha();
  }

  function closeLoginDialog() {
    if (isLoggingIn) {
      return;
    }
    setIsLoginDialogOpen(false);
    setLoginError("");
    setLoginDialog(defaultLoginDialogState);
  }

  async function refreshCaptcha() {
    setIsRefreshingCaptcha(true);
    setLoginError("");
    try {
      const nextCaptcha = await getLoginCode();
      setCaptcha({
        enabled: nextCaptcha.captchaEnabled,
        imageBase64: nextCaptcha.imageBase64,
      });
      setLoginDialog((current) => ({
        ...current,
        code: "",
        uuid: nextCaptcha.uuid,
      }));
    } catch {
      setLoginError("验证码获取失败，请检查网络后重试");
    } finally {
      setIsRefreshingCaptcha(false);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (isLoggingIn) {
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");
    try {
      const nextAuth = await loginWithPassword({
        username: loginDialog.username,
        password: loginDialog.password,
        code: captcha.enabled ? loginDialog.code : undefined,
        uuid: captcha.enabled ? loginDialog.uuid : undefined,
      });
      setAuthInfo(nextAuth);
      const profileRefreshed = await refreshUserProfile(nextAuth.accessToken);
      if (!profileRefreshed) {
        return;
      }
      setIsLoginDialogOpen(false);
      setLoginDialog(defaultLoginDialogState);
      void restartRuntimeAfterAuthChange(true);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "登录失败，请检查账号、密码、验证码或网络连接";
      setLoginError(message);
      await refreshCaptcha();
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function openWechatLoginDialog() {
    if (!hasLoggedIn) {
      return;
    }
    setIsWechatDialogOpen(true);
    setIsWechatBusy(true);
    try {
      const currentStatus = await readWechatLoginStatus();
      setWechatLoginStatus(currentStatus);
      if (isWechatLoginRunning(currentStatus.status)) {
        setWechatLoginStatus(currentStatus);
        return;
      }
      await startWechatLogin(false);
      const latestStatus = await readWechatLoginStatus();
      setWechatLoginStatus(latestStatus);
    } catch (error) {
      console.error("启动微信扫码连接失败", error);
      setWechatLoginStatus({
        status: "failed",
        message: "启动微信扫码连接失败，请检查 Node.js 运行时和网络后重试。",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setIsWechatBusy(false);
    }
  }

  async function refreshWechatLoginQr() {
    setIsWechatBusy(true);
    try {
      await cancelWechatLogin().catch(() => null);
      await startWechatLogin(true);
      const latestStatus = await readWechatLoginStatus();
      setWechatLoginStatus(latestStatus);
    } catch (error) {
      console.error("重新生成微信二维码失败", error);
      setWechatLoginStatus({
        status: "failed",
        message: "重新生成微信二维码失败，请稍后重试。",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setIsWechatBusy(false);
    }
  }

  async function closeWechatLoginDialog() {
    if (isWechatLoginRunning(wechatLoginStatus.status)) {
      setIsWechatBusy(true);
      try {
        const nextStatus = await cancelWechatLogin();
        setWechatLoginStatus(nextStatus);
      } catch (error) {
        console.error("取消微信扫码连接失败", error);
      } finally {
        setIsWechatBusy(false);
      }
    }
    setIsWechatDialogOpen(false);
  }

  async function logout() {
    if (isWechatLoginRunning(wechatLoginStatus.status)) {
      try {
        await cancelWechatLogin();
      } catch (error) {
        console.error("退出登录时取消微信扫码连接失败", error);
      }
    }
    setIsWechatDialogOpen(false);
    setWechatLoginStatus(DEFAULT_WECHAT_LOGIN_STATUS);
    await clearStoredAuthInfo();
    await restartRuntimeAfterAuthChange(false);
    setAuthInfo(null);
    setUserProfile(null);
    setUserPackageSummary(null);
    setUserProfileError("");
    setUserPackageSummaryError("");
  }

  async function restartRuntimeAfterAuthChange(shouldStart: boolean) {
    try {
      await stopCodexRuntime();
      if (shouldStart) {
        await startCodexRuntime(CODEX_PROFILE_ID);
      }
    } catch (error) {
      // 登录态已经切换时，旧 runtime 不能继续复用；失败原因仅保留给开发者排查。
      console.error("登录态变更后重启 Codex runtime 失败", error);
    }
  }

  const hasLoggedIn = Boolean(authInfo?.accessToken);
  const displayName = resolveDisplayName(authInfo, userProfile);
  const avatarText = resolveAvatarText(displayName);
  const packageLabel = resolvePackageLabel(userPackageSummary);
  const quotaAvailableAt = resolveQuotaAvailableAt(userPackageSummary);
  const quotaProgressItems = resolveQuotaProgressItems(userPackageSummary);

  return (
    <>
      <section className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-sm lg:min-h-0">
        <SettingsHeader />
        <div className="flex-1 overflow-auto bg-[#f8fafc] p-4 sm:p-6">
          <div className="mx-auto max-w-4xl space-y-4">
            <SettingsAccountSection
              authInfo={authInfo}
              avatarText={avatarText}
              displayName={displayName}
              hasLoggedIn={hasLoggedIn}
              isWechatLoginRunning={isWechatLoginRunning(wechatLoginStatus.status)}
              onLogout={() => void logout()}
              onOpenLoginDialog={() => void openLoginDialog()}
              onOpenWechatLogin={() => void openWechatLoginDialog()}
              packageLabel={packageLabel}
              quotaAvailableAt={quotaAvailableAt}
              quotaProgressItems={quotaProgressItems}
              userPackageSummaryError={userPackageSummaryError}
              userProfile={userProfile}
              userProfileError={userProfileError}
            />
            <SettingsUpdateSection
              onCheckUpdate={() => void onCheckUpdate()}
              onInstallUpdate={() => void onInstallUpdate()}
              updaterState={updaterState}
              versionInfo={versionInfo}
            />
            <SettingsThemeSection onThemeModeChange={onThemeModeChange} themeMode={themeMode} />
            <SettingsPathsSection
              draftConfig={draftConfig}
              isSaving={isSaving}
              onChooseFieldDirectory={(title, field) => void chooseConfigDirectory(title, field)}
              onChooseWorkspaceRoot={() => void chooseWorkspaceRoot()}
              onSubmit={saveConfig}
              onUpdateField={updateConfigField}
              onUpdateWorkspaceRoot={updateWorkspaceRoot}
            />
          </div>
        </div>
      </section>

      <SettingsLoginDialog
        captcha={captcha}
        isLoggingIn={isLoggingIn}
        isOpen={isLoginDialogOpen}
        isRefreshingCaptcha={isRefreshingCaptcha}
        loginButtonDisabled={isLoginButtonDisabled(loginDialog, captcha.enabled, isLoggingIn)}
        loginDialog={loginDialog}
        loginError={loginError}
        onChange={(patch) => setLoginDialog((current) => ({ ...current, ...patch }))}
        onClose={closeLoginDialog}
        onRefreshCaptcha={() => void refreshCaptcha()}
        onSubmit={submitLogin}
      />
      <SettingsWechatLoginDialog
        hasLoggedIn={hasLoggedIn}
        isBusy={isWechatBusy}
        isOpen={isWechatDialogOpen}
        onClose={() => void closeWechatLoginDialog()}
        onRefresh={() => void refreshWechatLoginQr()}
        status={wechatLoginStatus}
      />
    </>
  );
}
