import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  ChevronDown,
  FileText,
  Folder,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Upload,
} from "lucide-react";

import { FileSortPicker, FileTreeExpandToggle } from "@/components/files/FileTreeControls";
import { useNativeFileDrop, useResizableFilePanel } from "@/components/files/file-manager-hooks";
import { Button } from "@/components/ui/button";
import { LibraryFileTreePane } from "@/features/library/LibraryFileTreePane";
import { RemoteLawRepositoryPanel } from "@/features/library/RemoteLawRepositoryPanel";
import {
  canDropPath,
  fileNameFromPath,
  LibraryFileContextMenu,
  nodeFromPath,
  rangePaths,
  readLibrarySortState,
} from "@/features/library/library-panel-helpers";
import { showConfirm, showPrompt } from "@/services/dialog-service";
import { readClipboardFilePaths, resolveNativeFilePath } from "@/services/native-file-service";
import type { FileNode } from "@/types/domain";
import { joinFilePath, parentPath } from "@/utils/file-path";
import { collectFolderPaths, filterFileNodes, sortFileNodes, visibleFileNodes, type FileSortState } from "@/utils/file-tree";

export function LibraryPanel({
  title,
  icon: Icon,
  directory,
  fileNodes,
  selectedPath,
  isFilesLoading,
  onOpenDirectory,
  onSelectFile,
  onOpenFile,
  onRevealPath,
  onRefreshFiles,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onDeleteFile,
  onUploadFiles,
  onMoveFile,
  onCopyFile,
  onImportPaths,
  onRemoteLawDownloaded,
}: {
  title: string;
  icon: typeof FileText;
  directory: string;
  fileNodes: FileNode[];
  selectedPath: string | null;
  isFilesLoading: boolean;
  onOpenDirectory: () => void;
  onSelectFile: (node: FileNode) => void;
  onOpenFile: (node: FileNode) => void;
  /** 在系统文件管理器中打开或定位文件库节点。 */
  onRevealPath: (node: FileNode) => void;
  /** 刷新当前文件库树。 */
  onRefreshFiles: () => Promise<void>;
  onCreateFile: (path: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRenameFile: (path: string, newPath: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onUploadFiles: (parentPath: string | null, files: FileList) => Promise<void>;
  /** 移动文件库节点到新的相对路径。 */
  onMoveFile: (path: string, newPath: string) => Promise<void>;
  /** 复制文件库节点到新的相对路径。 */
  onCopyFile: (path: string, newPath: string) => Promise<void>;
  /** 导入系统文件管理器拖入或粘贴的外部本机路径。 */
  onImportPaths: (parentPath: string | null, sourcePaths: string[]) => Promise<void>;
  /** 远程法规下载完成后的刷新与预览回调，仅法规页传入。 */
  onRemoteLawDownloaded?: (path: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isRemoteLawOpen, setIsRemoteLawOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<LibraryFileContextMenu | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sortState, setSortState] = useState<FileSortState>(() => readLibrarySortState(title));
  const dragPathsRef = useRef<string[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetPathRef = useRef<string | null>(null);
  const { panelRef, resetWidth, startResize, width } = useResizableFilePanel("lex-vault-side-panel-width-v3", 480);
  const filteredNodes = useMemo(
    () => sortFileNodes(filterFileNodes(fileNodes, query), sortState),
    [fileNodes, query, sortState],
  );
  const visibleNodes = useMemo(() => visibleFileNodes(filteredNodes, expandedPaths), [expandedPaths, filteredNodes]);
  const folderPaths = useMemo(() => collectFolderPaths(filteredNodes), [filteredNodes]);
  const areAllFoldersExpanded = folderPaths.length > 0 && folderPaths.every((path) => expandedPaths.has(path));
  const supportsRemoteLaw = title === "法规" && Boolean(onRemoteLawDownloaded);

  useEffect(() => {
    window.localStorage.setItem(`lex-vault-file-sort-${title}`, JSON.stringify(sortState));
  }, [sortState, title]);

  useNativeFileDrop(panelRef, useCallback((parentPath, sourcePaths) => {
    void onImportPaths(parentPath, sourcePaths);
  }, [onImportPaths]));

  function closeContextMenu() {
    setContextMenu(null);
  }

  function selectedOrSinglePath(node: FileNode) {
    return selectedPaths.has(node.path) ? Array.from(selectedPaths) : [node.path];
  }

  /** 统一切换当前文件树的全部文件夹展开状态。 */
  function toggleAllFolders() {
    setExpandedPaths(areAllFoldersExpanded ? new Set() : new Set(folderPaths));
  }

  /** 切换单个文件夹的展开状态。 */
  function toggleFolder(node: FileNode) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
      }
      return next;
    });
  }

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeOnOutsideInteraction = () => closeContextMenu();
    document.addEventListener("click", closeOnOutsideInteraction);
    document.addEventListener("contextmenu", closeOnOutsideInteraction);
    return () => {
      document.removeEventListener("click", closeOnOutsideInteraction);
      document.removeEventListener("contextmenu", closeOnOutsideInteraction);
    };
  }, [contextMenu]);

  function contextFolderPath(node: FileNode | null) {
    if (!node) {
      return null;
    }
    return node.type === "folder" ? node.path : parentPath(node.path);
  }

  async function createFile(target: FileNode | null) {
    closeContextMenu();
    setIsCreateMenuOpen(false);
    const name = (await showPrompt({
      title: `新建${title}文件`,
      message: "请输入要创建的文件名。",
      inputLabel: "文件名",
      placeholder: "例如：新建文件.md",
      defaultValue: "新建文件.md",
      confirmText: "创建文件",
    }))?.trim();
    if (!name) {
      return;
    }
    await onCreateFile(joinFilePath(contextFolderPath(target), name));
  }

  async function createFolder(target: FileNode | null) {
    closeContextMenu();
    setIsCreateMenuOpen(false);
    const name = (await showPrompt({
      title: `新建${title}文件夹`,
      message: "请输入要创建的文件夹名称。",
      inputLabel: "文件夹名",
      placeholder: "例如：分类目录",
      defaultValue: "新建文件夹",
      confirmText: "创建文件夹",
    }))?.trim();
    if (!name) {
      return;
    }
    await onCreateFolder(joinFilePath(contextFolderPath(target), name));
  }

  async function renameNode(node: FileNode) {
    closeContextMenu();
    const name = (await showPrompt({
      title: "重命名",
      message: `请输入“${node.name}”的新名称。`,
      inputLabel: "新名称",
      defaultValue: node.name,
      confirmText: "保存名称",
    }))?.trim();
    if (!name || name === node.name) {
      return;
    }
    await onRenameFile(node.path, joinFilePath(parentPath(node.path), name));
  }

  async function deleteNode(node: FileNode) {
    closeContextMenu();
    const paths = selectedOrSinglePath(node);
    const confirmed = await showConfirm({
      title: `删除${title}文件`,
      message: paths.length > 1 ? `确认删除选中的 ${paths.length} 个项目？` : `确认删除“${node.name}”？`,
      description: "删除后将直接影响当前本机文件库内容，请谨慎操作。",
      confirmText: "确认删除",
      cancelText: "取消",
      intent: "danger",
    });
    if (!confirmed) {
      return;
    }
    for (const path of paths) {
      await onDeleteFile(path);
    }
    setSelectedPaths(new Set());
  }

  function chooseUploadFiles(target: FileNode | null) {
    closeContextMenu();
    setIsCreateMenuOpen(false);
    uploadTargetPathRef.current = contextFolderPath(target);
    uploadInputRef.current?.click();
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    await onUploadFiles(uploadTargetPathRef.current, files);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  /** 根据用户选择复制文件库节点的相对路径或本机绝对路径。 */
  function copyNodePath(node: FileNode, mode: "relative" | "absolute") {
    closeContextMenu();
    const path = mode === "absolute" ? resolveNativeFilePath(directory, node.path) : node.path;
    void navigator.clipboard?.writeText(path);
  }

  function handleBlankContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node: null,
    });
  }

  function handleNodeClick(event: MouseEvent, node: FileNode) {
    setSelectedPaths((current) => {
      if (event.shiftKey && lastSelectedPath) {
        const paths = rangePaths(visibleNodes, lastSelectedPath, node.path);
        return new Set(paths);
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      }
      return new Set([node.path]);
    });
    setLastSelectedPath(node.path);
  }

  async function moveOrCopyNodes(paths: string[], parent: string | null, copy: boolean) {
    for (const path of paths) {
      if (!canDropPath(path, parent)) {
        continue;
      }
      const newPath = joinFilePath(parent, fileNameFromPath(path));
      if (copy) {
        await onCopyFile(path, newPath);
      } else if (newPath !== path) {
        await onMoveFile(path, newPath);
      }
    }
  }

  function handleDragStart(event: DragEvent, node: FileNode) {
    const paths = selectedOrSinglePath(node);
    dragPathsRef.current = paths;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-lex-vault-file-paths", JSON.stringify(paths));
    event.dataTransfer.setData(
      "text/plain",
      paths.map((path) => resolveNativeFilePath(directory, path)).join("\n"),
    );
    event.dataTransfer.setData(
      "text/uri-list",
      paths.map((path) => `file:///${resolveNativeFilePath(directory, path).replace(/\\/g, "/")}`).join("\n"),
    );
  }

  function handleDragOverNode(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = isExternalFileDrop(event) || event.ctrlKey ? "copy" : "move";
  }

  function handleDropOnNode(event: DragEvent, node: FileNode) {
    event.preventDefault();
    event.stopPropagation();
    if (isExternalFileDrop(event)) {
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        void onUploadFiles(contextFolderPath(node), files);
      }
      return;
    }
    const parent = contextFolderPath(node);
    void moveOrCopyNodes(dragPathsRef.current, parent, event.ctrlKey);
  }

  function handleDropOnBlank(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isExternalFileDrop(event)) {
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        void onUploadFiles(null, files);
      }
      return;
    }
    void moveOrCopyNodes(dragPathsRef.current, null, event.ctrlKey);
  }

  function handleFileTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const paths = Array.from(selectedPaths);
    if ((event.target as HTMLElement).tagName === "INPUT") {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedPaths(new Set(visibleNodes.map((node) => node.path)));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      const absolute = event.shiftKey;
      void navigator.clipboard?.writeText(
        paths.map((path) => (absolute ? resolveNativeFilePath(directory, path) : path)).join("\n"),
      );
      return;
    }
    if (event.key === "Delete" && paths.length > 0) {
      event.preventDefault();
      void deleteNode(nodeFromPath(visibleNodes, paths[0]) ?? { name: "选中项目", path: paths[0], type: "file" });
      return;
    }
    if (event.key === "F2" && paths.length === 1) {
      event.preventDefault();
      const node = nodeFromPath(visibleNodes, paths[0]);
      if (node) {
        void renameNode(node);
      }
      return;
    }
    if (event.key === "Enter" && paths.length === 1) {
      event.preventDefault();
      const node = nodeFromPath(visibleNodes, paths[0]);
      if (node?.type === "file") {
        onSelectFile(node);
      }
    }
  }

  async function handleFileTreePaste(event: ClipboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName === "INPUT") {
      return;
    }

    event.preventDefault();
    const clipboardPaths = await readClipboardFilePaths().catch(() => []);
    if (clipboardPaths.length > 0) {
      await onImportPaths(null, clipboardPaths);
      return;
    }

    const files = event.clipboardData.files;
    if (files.length > 0) {
      await onUploadFiles(null, files);
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    const sourcePaths = text.split(/\r?\n/).map((line) => line.trim()).filter(isLikelyNativePath);
    if (sourcePaths.length > 0) {
      await onImportPaths(null, sourcePaths);
    }
  }

  return (
    <section
      className="relative flex w-full min-w-0 shrink-0 flex-col rounded-xl border bg-white p-px shadow-sm lg:h-full"
      ref={panelRef}
      style={{ width }}
    >
        <div
          aria-label={`调整${title}文件管理宽度`}
          className="absolute bottom-0 right-0 top-0 z-20 hidden w-2 cursor-col-resize touch-none bg-transparent transition hover:bg-blue-200/70 lg:block"
          onDoubleClick={resetWidth}
          onPointerDown={startResize}
          role="separator"
        />
        <div className="border-b p-4">
          <div className="mb-4 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-md bg-blue-50 text-[#1d4ed8]">
                    <Icon className="size-4" />
                  </div>
                  <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
                </div>
                {supportsRemoteLaw ? (
                  <Button disabled={!directory} onClick={() => setIsRemoteLawOpen(true)} type="button" variant="outline">
                    <ScrollText />
                    法规库
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 truncate text-xs text-slate-500" title={directory}>
                {directory || "未配置文件夹"}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_92px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-md border bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-ring"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={`检索${title}文件`}
                value={query}
              />
            </div>
            <Button disabled={!directory} onClick={onOpenDirectory} type="button" variant="outline">
              <Folder />
              位置
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Button disabled={!directory} onClick={() => chooseUploadFiles(null)} type="button" variant="outline">
              <Upload />
              上传
            </Button>
            <input
              className="hidden"
              multiple
              onChange={(event) => void handleUploadFiles(event.currentTarget.files)}
              ref={uploadInputRef}
              type="file"
            />
            <div className="relative">
              <Button
                className="w-full"
                disabled={!directory}
                onClick={() => setIsCreateMenuOpen((isOpen) => !isOpen)}
                type="button"
                variant="outline"
              >
                <Plus />
                新建
                <ChevronDown className="size-3" />
              </Button>
              {isCreateMenuOpen ? (
                <div className="absolute left-0 right-0 top-11 z-20 rounded-md border bg-white p-1 shadow-lg">
                  <button
                    className="flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => void createFile(null)}
                    type="button"
                  >
                    <FileText className="size-4 text-[#2563eb]" />
                    文件
                  </button>
                  <button
                    className="flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => void createFolder(null)}
                    type="button"
                  >
                    <Folder className="size-4 text-[#3b82f6]" />
                    文件夹
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                disabled={!directory || isFilesLoading}
                onClick={() => void onRefreshFiles()}
                size="icon"
                type="button"
                variant="outline"
              >
                <RefreshCw className={isFilesLoading ? "size-4 animate-spin" : "size-4"} />
              </Button>
              <FileSortPicker ariaLabel={`${title}文件排序`} onSortChange={setSortState} sortState={sortState} />
            </div>
            <FileTreeExpandToggle
              disabled={!directory || folderPaths.length === 0}
              expanded={areAllFoldersExpanded}
              onToggle={toggleAllFolders}
            />
          </div>
        </div>

        <LibraryFileTreePane
          contextMenu={contextMenu}
          directory={directory}
          expandedPaths={expandedPaths}
          filteredNodes={filteredNodes}
          isFilesLoading={isFilesLoading}
          onBlankContextMenu={handleBlankContextMenu}
          onChooseUploadFiles={chooseUploadFiles}
          onCloseContextMenu={closeContextMenu}
          onContextMenuChange={setContextMenu}
          onCopyNodePath={copyNodePath}
          onCreateFile={createFile}
          onCreateFolder={createFolder}
          onDeleteNode={deleteNode}
          onDragOverNode={handleDragOverNode}
          onDragStart={handleDragStart}
          onDropOnBlank={handleDropOnBlank}
          onDropOnNode={handleDropOnNode}
          onFileTreeKeyDown={handleFileTreeKeyDown}
          onFileTreePaste={handleFileTreePaste}
          onNodeClick={handleNodeClick}
          onOpenFile={onOpenFile}
          onRenameNode={renameNode}
          onRevealPath={onRevealPath}
          onSelectFile={onSelectFile}
          onToggleFolder={toggleFolder}
          selectedPath={selectedPath}
          selectedPaths={selectedPaths}
          title={title}
        />
        {isRemoteLawOpen && supportsRemoteLaw ? (
          <RemoteLawRepositoryPanel
            directory={directory}
            fileNodes={fileNodes}
            onClose={() => setIsRemoteLawOpen(false)}
            onDownloaded={onRemoteLawDownloaded!}
          />
        ) : null}
    </section>
  );
}

function isExternalFileDrop(event: DragEvent) {
  const types = Array.from(event.dataTransfer.types);
  return types.includes("Files") && !types.includes("application/x-lex-vault-file-paths");
}

function isLikelyNativePath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}
