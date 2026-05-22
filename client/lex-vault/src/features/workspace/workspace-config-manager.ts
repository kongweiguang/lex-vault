import type { Dispatch, SetStateAction } from "react";

import {
  clearStoredAuthInfo,
  getCurrentUserInfo,
  getStoredAuthInfo,
  shouldClearStoredAuthOnUserInfoError,
} from "@/services/auth-service";
import { getConfig, updateConfig } from "@/services/config-service";
import { startCodexRuntime } from "@/services/codex-service";
import { showAlert } from "@/services/dialog-service";
import { listNativeFiles, resolveNativeFilePath } from "@/services/native-file-service";
import type { AppConfig, CaseRecord, ChatSessionSummary, FileNode, LibraryKey, NavKey } from "@/types/domain";
import type { PreviewTarget } from "@/components/files/FilePreviewPanel";

type CreateWorkspaceConfigManagerArgs = {
  codeProfileId: string;
  activeNav: NavKey;
  getCaseMasterPath: () => string;
  loadLibraryFiles: (library: LibraryKey) => Promise<void>;
  setActiveNav: Dispatch<SetStateAction<NavKey>>;
  setCases: Dispatch<SetStateAction<CaseRecord[]>>;
  setCaseSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
  setConfig: Dispatch<SetStateAction<AppConfig | null>>;
  setIsCasesLoading: Dispatch<SetStateAction<boolean>>;
  setIsConfigLoaded: Dispatch<SetStateAction<boolean>>;
  setIsWorkspaceSaving: Dispatch<SetStateAction<boolean>>;
  setLoginPromptSignal: Dispatch<SetStateAction<number>>;
  setPreviewTargetsByNav: Dispatch<SetStateAction<Partial<Record<NavKey, PreviewTarget | null>>>>;
  setSelectedCaseId: Dispatch<SetStateAction<string | null>>;
  setSelectedCaseRefPath: Dispatch<SetStateAction<string | null>>;
  setSelectedLawPath: Dispatch<SetStateAction<string | null>>;
  setSelectedTemplatePath: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<ChatSessionSummary[]>>;
};

/** 统一管理工作区配置、启动登录态校验和配置变更后的页面重置流程。 */
export function createWorkspaceConfigManager({
  activeNav,
  codeProfileId,
  getCaseMasterPath,
  loadLibraryFiles,
  setActiveNav,
  setCases,
  setCaseSessions,
  setConfig,
  setIsCasesLoading,
  setIsConfigLoaded,
  setIsWorkspaceSaving,
  setLoginPromptSignal,
  setPreviewTargetsByNav,
  setSelectedCaseId,
  setSelectedCaseRefPath,
  setSelectedLawPath,
  setSelectedTemplatePath,
  setSessions,
}: CreateWorkspaceConfigManagerArgs) {
  /** 读取本机配置，失败时保持空配置但结束加载态。 */
  async function loadConfig() {
    try {
      const payload = await getConfig();
      setConfig(payload);
    } catch {
      setConfig(null);
    } finally {
      setIsConfigLoaded(true);
    }
  }

  /** 应用启动后先校验本机登录信息，再预热 Codex runtime。 */
  async function startRuntimeOnLaunch() {
    try {
      const auth = await getStoredAuthInfo();
      if (!auth.accessToken?.trim()) {
        setActiveNav("设置");
        setLoginPromptSignal((current) => current + 1);
        return;
      }

      // app-server 启动前先用远程用户信息校验 token，避免无效 token 注入后再暴露运行时错误。
      await getCurrentUserInfo(auth.accessToken);
      await startCodexRuntime(codeProfileId);
    } catch (error) {
      console.error("应用启动时校验登录态或启动 Codex runtime 失败", error);
      if (shouldClearStoredAuthOnUserInfoError(error)) {
        await clearStoredAuthInfo().catch((clearError) => {
          console.error("启动登录态失效后清理本机登录信息失败", clearError);
        });
        setActiveNav("设置");
        setLoginPromptSignal((current) => current + 1);
        return;
      }

      try {
        // 远程用户信息接口偶发失败时，保留本机 token 并继续尝试启动 runtime，避免刷新页面后被强制重新登录。
        await startCodexRuntime(codeProfileId);
      } catch (runtimeError) {
        console.error("远程用户信息校验失败后兜底启动 Codex runtime 失败", runtimeError);
      }
    }
  }

  /** 从案件根目录重新装配案件列表，并尽量保留当前选中项。 */
  async function loadCases() {
    const caseMasterPath = getCaseMasterPath();
    if (!caseMasterPath) {
      setCases([]);
      setSelectedCaseId(null);
      return;
    }

    setIsCasesLoading(true);
    try {
      const nodes = await listNativeFiles(caseMasterPath);
      const folderCases = nodes
        .filter((node: FileNode) => node.type === "folder")
        .map((node: FileNode) => ({
          id: node.path,
          name: node.name,
          casePath: resolveNativeFilePath(caseMasterPath, node.path),
          createdAt: node.modifiedAt,
          updatedAt: node.modifiedAt,
        }));
      setCases(folderCases);
      setSelectedCaseId((current) => {
        if (current && folderCases.some((caseItem) => caseItem.id === current)) {
          return current;
        }
        return folderCases[0]?.id ?? null;
      });
    } catch {
      setCases([]);
      setSelectedCaseId(null);
    } finally {
      setIsCasesLoading(false);
    }
  }

  /** 保存配置后同步清空会话、案件和预览缓存，避免旧工作区数据残留。 */
  async function saveConfig(nextConfig: Partial<AppConfig>) {
    const updated = await updateConfig(nextConfig);
    setConfig(updated);
    setSessions([]);
    setCaseSessions([]);
    setCases([]);
    setSelectedCaseId(null);
    setPreviewTargetsByNav({});
    if (activeNav === "模板") {
      setSelectedTemplatePath(null);
      await loadLibraryFiles("templates");
    }
    if (activeNav === "法规") {
      setSelectedLawPath(null);
      await loadLibraryFiles("laws");
    }
    if (activeNav === "案例") {
      setSelectedCaseRefPath(null);
      await loadLibraryFiles("cases");
    }
    await loadCases();
  }

  /** 首次进入时由用户选择工作区目录，并把应用切到案件页继续初始化。 */
  async function chooseInitialWorkspace() {
    let isBusy = false;
    setIsWorkspaceSaving((current) => {
      isBusy = current;
      return current;
    });
    if (isBusy) {
      return;
    }

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择工作空间",
      });
      if (typeof selected !== "string") {
        return;
      }

      setIsWorkspaceSaving(true);
      const updated = await updateConfig({ workspaceRoot: selected });
      setConfig(updated);
      setActiveNav("案件");
    } catch {
      await showAlert({
        title: "工作空间设置失败",
        message: "无法选择或保存工作空间，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setIsWorkspaceSaving(false);
    }
  }

  return {
    chooseInitialWorkspace,
    loadCases,
    loadConfig,
    saveConfig,
    startRuntimeOnLaunch,
  };
}
