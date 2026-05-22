import type { Dispatch, SetStateAction } from "react";

import type { PreviewTarget } from "@/components/files/FilePreviewPanel";
import {
  copyNativePath,
  createNativeFile,
  createNativeFolder,
  deleteNativePath,
  importNativePaths,
  renameNativePath,
  resolveNativeFilePath,
  revealNativePath,
  uploadNativeFile,
} from "@/services/native-file-service";
import { showAlert } from "@/services/dialog-service";
import type { AppFileImportState, CaseRecord, ChatAttachment, FileNode, NavKey } from "@/types/domain";
import { joinFilePath } from "@/utils/file-path";

type CreateCaseWorkspaceManagerArgs = {
  getCaseMasterPath: () => string;
  getSelectedCase: () => CaseRecord | null;
  getSelectedSessionId: () => string;
  loadCaseFiles: (caseId: string) => Promise<void>;
  loadCases: () => Promise<void>;
  setActiveNav: Dispatch<SetStateAction<NavKey>>;
  setCaseFileNodes: Dispatch<SetStateAction<FileNode[]>>;
  setContextAttachmentsBySession: Dispatch<SetStateAction<Record<string, ChatAttachment[]>>>;
  setIsPreviewCollapsed: Dispatch<SetStateAction<boolean>>;
  setFileImportState: Dispatch<SetStateAction<AppFileImportState>>;
  setPreviewForNav: (nav: NavKey, target: PreviewTarget | null) => void;
  setSelectedCaseId: Dispatch<SetStateAction<string | null>>;
};

/** 新建案件弹框提供勾选的标准材料目录，默认全选但允许用户按案件需要取消。 */
export const DEFAULT_CASE_FOLDERS = [
  "当事人信息",
  "案件事实",
  "证据材料",
  "法律检索",
  "诉讼文书",
  "庭审准备",
  "沟通记录",
  "案件进度",
  "交付成果",
] as const;

/**
 * 统一封装案件工作区中的案件目录、材料文件和聊天上下文动作。
 *
 * @author kongweiguang
 */
export function createCaseWorkspaceManager({
  getCaseMasterPath,
  getSelectedCase,
  getSelectedSessionId,
  loadCaseFiles,
  loadCases,
  setActiveNav,
  setCaseFileNodes,
  setContextAttachmentsBySession,
  setIsPreviewCollapsed,
  setFileImportState,
  setPreviewForNav,
  setSelectedCaseId,
}: CreateCaseWorkspaceManagerArgs) {
  function buildCaseImportTargetLabel(parentPath: string | null) {
    const selectedCase = getSelectedCase();
    const caseName = selectedCase?.name ?? "案件材料";
    return parentPath?.trim() ? `${caseName} / ${parentPath}` : `${caseName} 根目录`;
  }

  /** 点击案件材料时优先在右侧预览，复杂格式仍可从预览标题栏交给系统打开。 */
  function previewCaseFile(node: FileNode) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath || node.type !== "file") {
      return;
    }

    setPreviewForNav("案件", {
      rootPath: selectedCase.casePath,
      path: node.path,
      name: node.name,
      extension: node.extension,
      size: node.size,
      sourceLabel: "案件材料",
    });
    setIsPreviewCollapsed(false);
  }

  /** 在系统文件管理器中打开案件材料节点，文件会定位到所在目录。 */
  async function revealCasePath(node: FileNode) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    try {
      await revealNativePath(selectedCase.casePath, node.path);
    } catch (error) {
      console.error("在文件管理器中打开案件材料失败", error);
      await showAlert({
        title: "定位失败",
        message: "无法在资源管理器中显示当前材料。",
        intent: "warning",
      });
    }
  }

  /** 创建案件目录后按用户勾选补齐材料子目录，并切回案件页加载新案件。 */
  async function createCase(name: string, folderNames: readonly string[] = DEFAULT_CASE_FOLDERS) {
    const caseMasterPath = getCaseMasterPath();
    if (!caseMasterPath) {
      return;
    }

    // 目录来自固定模板勾选项，这里仍去重和过滤空值，避免重复创建导致体验抖动。
    const selectedFolders = Array.from(new Set(folderNames.map((folder) => folder.trim()).filter(Boolean)));
    await createNativeFolder(caseMasterPath, name);
    for (const folder of selectedFolders) {
      await createNativeFolder(caseMasterPath, joinFilePath(name, folder));
    }
    await loadCases();
    setSelectedCaseId(name);
    setCaseFileNodes([]);
    setActiveNav("案件");
  }

  /** 案件重命名后重新装配列表，并保留新的选中项。 */
  async function renameCase(caseId: string, name: string) {
    const caseMasterPath = getCaseMasterPath();
    if (!caseMasterPath) {
      return;
    }

    await renameNativePath(caseMasterPath, caseId, name);
    await loadCases();
    setSelectedCaseId(name);
  }

  /** 删除案件索引目录后刷新列表，磁盘材料目录删除策略保持不变。 */
  async function deleteCase(caseId: string) {
    const caseMasterPath = getCaseMasterPath();
    if (!caseMasterPath) {
      return;
    }

    await deleteNativePath(caseMasterPath, caseId);
    await loadCases();
  }

  /** 在当前案件下创建空文件后刷新树。 */
  async function createCaseFile(path: string) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    await createNativeFile(selectedCase.casePath, path);
    await loadCaseFiles(selectedCase.id);
  }

  /** 在当前案件下创建目录后刷新树。 */
  async function createCaseFolder(path: string) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    await createNativeFolder(selectedCase.casePath, path);
    await loadCaseFiles(selectedCase.id);
  }

  /** 重命名当前案件材料后刷新树。 */
  async function renameCaseFile(path: string, newPath: string) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    await renameNativePath(selectedCase.casePath, path, newPath);
    await loadCaseFiles(selectedCase.id);
  }

  /** 复制当前案件材料后刷新树。 */
  async function copyCaseFile(path: string, newPath: string) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    await copyNativePath(selectedCase.casePath, path, newPath);
    await loadCaseFiles(selectedCase.id);
  }

  /** 删除当前案件材料后刷新树。 */
  async function deleteCaseFile(path: string) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    await deleteNativePath(selectedCase.casePath, path);
    await loadCaseFiles(selectedCase.id);
  }

  /** 逐个上传文件到当前案件目录，保持既有串行写入顺序。 */
  async function uploadCaseFiles(parentPath: string | null, files: FileList) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    for (const file of Array.from(files)) {
      await uploadNativeFile(selectedCase.casePath, parentPath, file);
    }
    await loadCaseFiles(selectedCase.id);
  }

  /** 从本机导入多个现有路径到当前案件目录。 */
  async function importCasePaths(parentPath: string | null, sourcePaths: string[]) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }
    const normalizedPaths = sourcePaths.map((path) => path.trim()).filter(Boolean);
    if (normalizedPaths.length === 0) {
      return;
    }

    const importedPaths: string[] = [];
    const failedItems: AppFileImportState["failedItems"] = [];
    setFileImportState({
      visible: true,
      status: "running",
      sourceLabel: "案件材料",
      targetLabel: buildCaseImportTargetLabel(parentPath),
      currentPath: normalizedPaths[0],
      completedCount: 0,
      totalCount: normalizedPaths.length,
      importedPaths: [],
      failedItems: [],
    });

    for (let index = 0; index < normalizedPaths.length; index += 1) {
      const sourcePath = normalizedPaths[index];
      setFileImportState({
        visible: true,
        status: "running",
        sourceLabel: "案件材料",
        targetLabel: buildCaseImportTargetLabel(parentPath),
        currentPath: sourcePath,
        completedCount: index,
        totalCount: normalizedPaths.length,
        importedPaths: [...importedPaths],
        failedItems: [...failedItems],
      });
      try {
        const result = await importNativePaths(selectedCase.casePath, parentPath, [sourcePath]);
        importedPaths.push(...result);
      } catch (error) {
        failedItems.push({
          sourcePath,
          reason: error instanceof Error ? error.message : "导入失败",
        });
      }
    }

    setFileImportState({
      visible: true,
      status: failedItems.length > 0 ? "failed" : "success",
      sourceLabel: "案件材料",
      targetLabel: buildCaseImportTargetLabel(parentPath),
      currentPath: undefined,
      completedCount: normalizedPaths.length,
      totalCount: normalizedPaths.length,
      importedPaths,
      failedItems,
    });
    await loadCaseFiles(selectedCase.id);
    if (failedItems.length > 0 && importedPaths.length === 0) {
      await showAlert({
        title: "导入失败",
        message: "外部文件没有成功导入，请查看进度弹框中的失败原因。",
        intent: "warning",
      });
    }
  }

  /** 将案件材料挂到当前会话草稿附件区，发送时再参与 prompt 组装。 */
  function addCaseFileToChat(node: FileNode) {
    const selectedCase = getSelectedCase();
    if (!selectedCase?.casePath) {
      return;
    }

    const selectedSessionId = getSelectedSessionId();
    const attachment: ChatAttachment = {
      id: `case-path:${selectedCase.casePath}:${node.path}`,
      name: node.name,
      type: "case-path",
      contentType: "text/x-lex-vault-path",
      path: resolveNativeFilePath(selectedCase.casePath, node.path),
      rootPath: selectedCase.casePath,
      relativePath: node.path,
      nodeType: node.type,
      sourceLabel: "案件材料",
    };
    setContextAttachmentsBySession((current) => {
      const attachments = current[selectedSessionId] ?? [];
      if (attachments.some((item) => item.id === attachment.id)) {
        return current;
      }
      return {
        ...current,
        [selectedSessionId]: [...attachments, attachment],
      };
    });
    setActiveNav("案件");
  }

  /** 从当前会话草稿附件区移除单个案件上下文。 */
  function removeContextAttachment(attachmentId: string) {
    const selectedSessionId = getSelectedSessionId();
    setContextAttachmentsBySession((current) => ({
      ...current,
      [selectedSessionId]: (current[selectedSessionId] ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
  }

  /** 清空当前会话草稿附件区的全部案件上下文。 */
  function clearContextAttachments() {
    const selectedSessionId = getSelectedSessionId();
    setContextAttachmentsBySession((current) => ({
      ...current,
      [selectedSessionId]: [],
    }));
  }

  return {
    addCaseFileToChat,
    clearContextAttachments,
    copyCaseFile,
    createCase,
    createCaseFile,
    createCaseFolder,
    deleteCase,
    deleteCaseFile,
    importCasePaths,
    previewCaseFile,
    removeContextAttachment,
    renameCase,
    renameCaseFile,
    revealCasePath,
    uploadCaseFiles,
  };
}
