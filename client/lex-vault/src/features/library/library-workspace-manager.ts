import {
  copyNativePath,
  createNativeFile,
  createNativeFolder,
  deleteNativePath,
  importNativePaths,
  listNativeFiles,
  openNativeDirectory,
  openNativeFile,
  renameNativePath,
  revealNativePath,
  uploadNativeFile,
} from "@/services/native-file-service";
import { showAlert } from "@/services/dialog-service";
import type { PreviewTarget } from "@/components/files/FilePreviewPanel";
import type { AppConfig, AppFileImportState, FileNode, LibraryKey, NavKey } from "@/types/domain";

/**
 * 文件库面板需要的只读状态快照。
 */
export type LibraryWorkspaceState = {
  /** 当前文件库根目录。 */
  directory: string;
  /** 当前文件树节点。 */
  fileNodes: FileNode[];
  /** 当前文件树是否处于刷新中。 */
  isFilesLoading: boolean;
  /** 当前高亮选中的文件相对路径。 */
  selectedPath: string | null;
};

/**
 * 文件库管理器依赖集合，由 App 壳层注入状态读写能力。
 */
type LibraryWorkspaceManagerOptions = {
  /** 获取当前应用配置，用于解析模板/法规/案例根目录。 */
  getConfig: () => AppConfig | null;
  /** 设置模板文件树。 */
  setTemplateFileNodes: (nodes: FileNode[]) => void;
  /** 设置法规文件树。 */
  setLawFileNodes: (nodes: FileNode[]) => void;
  /** 设置案例文件树。 */
  setCaseRefFileNodes: (nodes: FileNode[]) => void;
  /** 设置模板文件树加载态。 */
  setIsTemplateFilesLoading: (loading: boolean) => void;
  /** 设置法规文件树加载态。 */
  setIsLawFilesLoading: (loading: boolean) => void;
  /** 设置案例文件树加载态。 */
  setIsCaseRefFilesLoading: (loading: boolean) => void;
  /** 设置模板选中文件。 */
  setSelectedTemplatePath: (path: string | null) => void;
  /** 设置法规选中文件。 */
  setSelectedLawPath: (path: string | null) => void;
  /** 设置案例选中文件。 */
  setSelectedCaseRefPath: (path: string | null) => void;
  /** 读取模板文件树。 */
  getTemplateFileNodes: () => FileNode[];
  /** 读取法规文件树。 */
  getLawFileNodes: () => FileNode[];
  /** 读取案例文件树。 */
  getCaseRefFileNodes: () => FileNode[];
  /** 读取模板加载态。 */
  getIsTemplateFilesLoading: () => boolean;
  /** 读取法规加载态。 */
  getIsLawFilesLoading: () => boolean;
  /** 读取案例加载态。 */
  getIsCaseRefFilesLoading: () => boolean;
  /** 读取模板选中文件。 */
  getSelectedTemplatePath: () => string | null;
  /** 读取法规选中文件。 */
  getSelectedLawPath: () => string | null;
  /** 读取案例选中文件。 */
  getSelectedCaseRefPath: () => string | null;
  /** 写入指定导航页签的预览目标。 */
  setPreviewForNav: (nav: NavKey, target: PreviewTarget | null) => void;
  /** 展开右侧预览面板。 */
  setIsPreviewCollapsed: (collapsed: boolean) => void;
  /** 更新全局文件导入进度。 */
  setFileImportState: (state: AppFileImportState) => void;
};

/**
 * 文件库根目录到文件树、选中态和系统命令的统一编排器。
 */
export function createLibraryWorkspaceManager(options: LibraryWorkspaceManagerOptions) {
  /**
   * 将文件库类型稳定映射到左侧导航页签，保证右侧预览状态按工作区隔离。
   */
  function libraryNavKey(library: LibraryKey): NavKey {
    return library === "templates" ? "模板" : library === "laws" ? "法规" : "案例";
  }

  /**
   * 文件库预览来源标签，帮助用户识别右侧面板当前内容来自哪个目录。
   */
  function libraryPreviewLabel(library: LibraryKey) {
    return library === "templates" ? "模板" : library === "laws" ? "法规" : "案例";
  }

  function buildImportTargetLabel(library: LibraryKey, parentPath: string | null) {
    const libraryLabel = libraryPreviewLabel(library);
    return parentPath?.trim() ? `${libraryLabel} / ${parentPath}` : `${libraryLabel} 根目录`;
  }

  /**
   * 解析模板、法规或案例库在当前配置下对应的根目录。
   */
  function libraryRootPath(library: LibraryKey) {
    const config = options.getConfig();
    return library === "templates"
      ? config?.docTemplate
      : library === "laws"
        ? config?.lawDirectory
        : config?.caseRef;
  }

  /**
   * 返回指定文件库当前需要渲染的只读状态。
   */
  function getLibraryState(library: LibraryKey): LibraryWorkspaceState {
    if (library === "templates") {
      return {
        directory: libraryRootPath(library) ?? "",
        fileNodes: options.getTemplateFileNodes(),
        isFilesLoading: options.getIsTemplateFilesLoading(),
        selectedPath: options.getSelectedTemplatePath(),
      };
    }
    if (library === "laws") {
      return {
        directory: libraryRootPath(library) ?? "",
        fileNodes: options.getLawFileNodes(),
        isFilesLoading: options.getIsLawFilesLoading(),
        selectedPath: options.getSelectedLawPath(),
      };
    }
    return {
      directory: libraryRootPath(library) ?? "",
      fileNodes: options.getCaseRefFileNodes(),
      isFilesLoading: options.getIsCaseRefFilesLoading(),
      selectedPath: options.getSelectedCaseRefPath(),
    };
  }

  /**
   * 选择指定文件库的状态写入器，避免 App 中重复分支。
   */
  function resolveLibraryMutations(library: LibraryKey) {
    if (library === "templates") {
      return {
        setLoading: options.setIsTemplateFilesLoading,
        setNodes: options.setTemplateFileNodes,
        setSelectedPath: options.setSelectedTemplatePath,
      };
    }
    if (library === "laws") {
      return {
        setLoading: options.setIsLawFilesLoading,
        setNodes: options.setLawFileNodes,
        setSelectedPath: options.setSelectedLawPath,
      };
    }
    return {
      setLoading: options.setIsCaseRefFilesLoading,
      setNodes: options.setCaseRefFileNodes,
      setSelectedPath: options.setSelectedCaseRefPath,
    };
  }

  /**
   * 刷新文件库文件树，目录缺失或命令失败时回退为空列表。
   */
  async function loadLibraryFiles(library: LibraryKey) {
    const { setLoading, setNodes } = resolveLibraryMutations(library);
    setLoading(true);
    try {
      const rootPath = libraryRootPath(library);
      setNodes(rootPath ? await listNativeFiles(rootPath) : []);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * 选中文件库文件时更新选中态并驱动右侧预览。
   */
  async function loadLibraryContent(library: LibraryKey, node: FileNode) {
    const rootPath = libraryRootPath(library);
    if (!rootPath || node.type !== "file") {
      return;
    }
    const { setSelectedPath } = resolveLibraryMutations(library);
    setSelectedPath(node.path);
    options.setPreviewForNav(libraryNavKey(library), {
      rootPath,
      path: node.path,
      name: node.name,
      extension: node.extension,
      size: node.size,
      sourceLabel: libraryPreviewLabel(library),
    });
    options.setIsPreviewCollapsed(false);
  }

  /**
   * 使用系统默认程序打开文件库中的文件。
   */
  async function openLibraryFile(library: LibraryKey, node: FileNode) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }

    try {
      await openNativeFile(rootPath, node.path);
    } catch {
      await showAlert({
        title: "打开失败",
        message: "无法通过系统默认程序打开当前文件。",
        intent: "warning",
      });
    }
  }

  /**
   * 使用系统文件管理器打开指定文件库根目录。
   */
  async function openLibraryDirectory(library: LibraryKey) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }

    try {
      await openNativeDirectory(rootPath);
    } catch (error) {
      console.error("打开文件库目录失败", error);
      await showAlert({
        title: "打开失败",
        message: "无法通过文件资源管理器打开当前文件夹。",
        intent: "warning",
      });
    }
  }

  /**
   * 在系统文件管理器中定位文件库节点，文件会显示其所在目录。
   */
  async function revealLibraryPath(library: LibraryKey, node: FileNode) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }

    try {
      await revealNativePath(rootPath, node.path);
    } catch (error) {
      console.error("在文件管理器中打开文件库路径失败", error);
      await showAlert({
        title: "定位失败",
        message: "无法在资源管理器中显示当前路径。",
        intent: "warning",
      });
    }
  }

  /**
   * 在文件库中新建空文件后刷新文件树。
   */
  async function createLibraryFile(library: LibraryKey, path: string) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    await createNativeFile(rootPath, path);
    await loadLibraryFiles(library);
  }

  /**
   * 在文件库中新建目录后刷新文件树。
   */
  async function createLibraryFolder(library: LibraryKey, path: string) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    await createNativeFolder(rootPath, path);
    await loadLibraryFiles(library);
  }

  /**
   * 重命名文件库节点后刷新文件树。
   */
  async function renameLibraryFile(library: LibraryKey, path: string, newPath: string) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    await renameNativePath(rootPath, path, newPath);
    await loadLibraryFiles(library);
  }

  /**
   * 复制文件库节点后刷新文件树。
   */
  async function copyLibraryFile(library: LibraryKey, path: string, newPath: string) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    await copyNativePath(rootPath, path, newPath);
    await loadLibraryFiles(library);
  }

  /**
   * 删除文件库节点后刷新文件树。
   */
  async function deleteLibraryFile(library: LibraryKey, path: string) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    await deleteNativePath(rootPath, path);
    await loadLibraryFiles(library);
  }

  /**
   * 上传本地文件到指定文件库目录后刷新文件树。
   */
  async function uploadLibraryFiles(library: LibraryKey, parentPath: string | null, files: FileList) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    for (const file of Array.from(files)) {
      await uploadNativeFile(rootPath, parentPath, file);
    }
    await loadLibraryFiles(library);
  }

  /**
   * 导入外部文件或目录到指定文件库后刷新文件树。
   */
  async function importLibraryPaths(library: LibraryKey, parentPath: string | null, sourcePaths: string[]) {
    const rootPath = libraryRootPath(library);
    if (!rootPath) {
      return;
    }
    const normalizedPaths = sourcePaths.map((path) => path.trim()).filter(Boolean);
    if (normalizedPaths.length === 0) {
      return;
    }

    const importedPaths: string[] = [];
    const failedItems: AppFileImportState["failedItems"] = [];
    options.setFileImportState({
      visible: true,
      status: "running",
      sourceLabel: libraryPreviewLabel(library),
      targetLabel: buildImportTargetLabel(library, parentPath),
      currentPath: normalizedPaths[0],
      completedCount: 0,
      totalCount: normalizedPaths.length,
      importedPaths: [],
      failedItems: [],
    });

    for (let index = 0; index < normalizedPaths.length; index += 1) {
      const sourcePath = normalizedPaths[index];
      options.setFileImportState({
        visible: true,
        status: "running",
        sourceLabel: libraryPreviewLabel(library),
        targetLabel: buildImportTargetLabel(library, parentPath),
        currentPath: sourcePath,
        completedCount: index,
        totalCount: normalizedPaths.length,
        importedPaths: [...importedPaths],
        failedItems: [...failedItems],
      });
      try {
        const result = await importNativePaths(rootPath, parentPath, [sourcePath]);
        importedPaths.push(...result);
      } catch (error) {
        failedItems.push({
          sourcePath,
          reason: error instanceof Error ? error.message : "导入失败",
        });
      }
    }

    options.setFileImportState({
      visible: true,
      status: failedItems.length > 0 ? "failed" : "success",
      sourceLabel: libraryPreviewLabel(library),
      targetLabel: buildImportTargetLabel(library, parentPath),
      currentPath: undefined,
      completedCount: normalizedPaths.length,
      totalCount: normalizedPaths.length,
      importedPaths,
      failedItems,
    });
    await loadLibraryFiles(library);
    if (failedItems.length > 0 && importedPaths.length === 0) {
      await showAlert({
        title: "导入失败",
        message: "外部文件没有成功导入，请查看进度弹框中的失败原因。",
        intent: "warning",
      });
    }
  }

  return {
    copyLibraryFile,
    createLibraryFile,
    createLibraryFolder,
    deleteLibraryFile,
    getLibraryState,
    importLibraryPaths,
    libraryRootPath,
    loadLibraryContent,
    loadLibraryFiles,
    openLibraryDirectory,
    openLibraryFile,
    renameLibraryFile,
    revealLibraryPath,
    uploadLibraryFiles,
  };
}
