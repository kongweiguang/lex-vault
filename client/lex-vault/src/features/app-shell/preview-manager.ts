import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  FilePreviewTarget,
  PreviewTarget,
} from "@/components/files/FilePreviewPanel";
import { showAlert } from "@/services/dialog-service";
import { openNativeFile } from "@/services/native-file-service";
import type { NavKey } from "@/types/domain";

type CreatePreviewManagerArgs = {
  /** 当前左侧导航页签。 */
  getActiveNav: () => NavKey;
  /** 写入指定工作区的预览目标。 */
  setPreviewForNav: (nav: NavKey, target: PreviewTarget | null) => void;
  /** 切换右侧预览面板折叠状态。 */
  setIsPreviewCollapsed: (updater: boolean | ((collapsed: boolean) => boolean)) => void;
};

/**
 * 统一管理右侧文件/链接预览动作，保持不同工作区共用同一套预览编排。
 */
export function createPreviewManager({
  getActiveNav,
  setIsPreviewCollapsed,
  setPreviewForNav,
}: CreatePreviewManagerArgs) {
  /** 打开文件预览，并展开右侧面板。 */
  function previewFile(target: FilePreviewTarget) {
    setPreviewForNav(getActiveNav(), target);
    setIsPreviewCollapsed(false);
  }

  /** 打开聊天中的外部链接预览，并展开右侧面板。 */
  function previewUrl(url: string, title?: string) {
    setPreviewForNav(getActiveNav(), {
      kind: "url",
      sourceLabel: "聊天链接",
      title,
      url,
    });
    setIsPreviewCollapsed(false);
  }

  /** 在当前工作区切换右侧预览面板显示状态。 */
  function togglePreviewPanel() {
    setIsPreviewCollapsed((collapsed) => !collapsed);
  }

  /** 把聊天中的网页链接交给系统默认浏览器打开。 */
  async function openUrlExternal(url: string) {
    try {
      await openUrl(url);
    } catch {
      await showAlert({
        title: "打开失败",
        message: "无法通过系统浏览器打开当前链接。",
        intent: "warning",
      });
    }
  }

  /** 把当前预览文件交给系统默认程序打开。 */
  async function openPreviewExternal(target: PreviewTarget) {
    try {
      if (target.kind === "url") {
        await openUrl(target.url);
        return;
      }
      await openNativeFile(target.rootPath, target.path);
    } catch {
      await showAlert({
        title: "打开失败",
        message: target.kind === "url" ? "无法通过系统浏览器打开当前链接。" : "无法通过系统默认程序打开当前文件。",
        intent: "warning",
      });
    }
  }

  return {
    openUrlExternal,
    openPreviewExternal,
    previewFile,
    previewUrl,
    togglePreviewPanel,
  };
}
