import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  BriefcaseBusiness,
  Check,
  ChevronDown,
  FileText,
  Folder,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { FileSortPicker, FileTreeExpandToggle } from "@/components/files/FileTreeControls";
import { useNativeFileDrop, useResizableFilePanel } from "@/components/files/file-manager-hooks";
import { Button } from "@/components/ui/button";
import { DEFAULT_CASE_FOLDERS } from "@/features/cases/case-workspace-manager";
import { CaseMaterialsPane } from "@/features/cases/CaseMaterialsPane";
import {
  canDropPath,
  CaseFileContextMenu,
  fileNameFromPath,
  nodeFromPath,
  rangePaths,
  readCaseSortState,
} from "@/features/cases/case-panel-helpers";
import { CaseSessionsList, CaseSessionsToolbar } from "@/features/cases/CaseSessionsPane";
import { cn } from "@/lib/utils";
import { showConfirm, showPrompt } from "@/services/dialog-service";
import { readClipboardFilePaths, resolveNativeFilePath } from "@/services/native-file-service";
import type { CaseRecord, ChatSessionSummary, FileNode } from "@/types/domain";
import { joinFilePath, parentPath } from "@/utils/file-path";
import { collectFolderPaths, sortFileNodes, visibleFileNodes, type FileSortState } from "@/utils/file-tree";

export function CasePanel({
  cases,
  selectedCaseId,
  fileNodes,
  isLoading,
  isFilesLoading,
  sessions,
  selectedSessionId,
  isHistoryLoading,
  historyLoadError,
  onSelectCase,
  onCreateCase,
  onRenameCase,
  onDeleteCase,
  onCreateCaseFile,
  onCreateCaseFolder,
  onRenameCaseFile,
  onCopyCaseFile,
  onDeleteCaseFile,
  onRefreshFiles,
  onUploadCaseFiles,
  onImportCasePaths,
  onOpenCaseFile,
  onPreviewCaseFile,
  onAddCaseFileToChat,
  onRevealCasePath,
  onSelectConversation,
  onRetryHistory,
  onCreateConversation,
  agentEnabled,
}: {
  cases: CaseRecord[];
  selectedCaseId: string | null;
  fileNodes: FileNode[];
  isLoading: boolean;
  isFilesLoading: boolean;
  sessions: ChatSessionSummary[];
  selectedSessionId: string;
  isHistoryLoading: boolean;
  /** 案件历史列表最近一次加载失败的用户可见提示。 */
  historyLoadError?: string | null;
  onSelectCase: (caseId: string) => void;
  /** 新建案件，并按勾选的材料目录模板创建子目录。 */
  onCreateCase: (name: string, folderNames: readonly string[]) => Promise<void>;
  onRenameCase: (caseId: string, name: string) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
  onCreateCaseFile: (path: string) => Promise<void>;
  onCreateCaseFolder: (path: string) => Promise<void>;
  onRenameCaseFile: (path: string, newPath: string) => Promise<void>;
  /** 复制案件材料节点到新的相对路径。 */
  onCopyCaseFile: (path: string, newPath: string) => Promise<void>;
  onDeleteCaseFile: (path: string) => Promise<void>;
  /** 刷新当前案件材料文件树。 */
  onRefreshFiles: () => Promise<void>;
  onUploadCaseFiles: (parentPath: string | null, files: FileList) => Promise<void>;
  /** 导入系统文件管理器拖入或粘贴的外部本机路径。 */
  onImportCasePaths: (parentPath: string | null, sourcePaths: string[]) => Promise<void>;
  onOpenCaseFile: (node: FileNode) => void;
  /** 单击案件材料时在右侧预览面板打开。 */
  onPreviewCaseFile: (node: FileNode) => void;
  /** 将案件材料节点作为路径上下文加入当前案件聊天框。 */
  onAddCaseFileToChat: (node: FileNode) => void;
  /** 在系统文件管理器中打开或定位案件材料节点。 */
  onRevealCasePath: (node: FileNode) => void;
  onSelectConversation: (conversationId: string) => void;
  /** 用户主动重新加载当前案件历史列表。 */
  onRetryHistory?: () => void;
  onCreateConversation: () => void;
  /** Agent 能力是否已经接入。 */
  agentEnabled: boolean;
}) {
  const [activePanel, setActivePanel] = useState<"materials" | "sessions">("materials");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isCaseMenuOpen, setIsCaseMenuOpen] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [caseQuery, setCaseQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [newCaseName, setNewCaseName] = useState("");
  const [selectedNewCaseFolders, setSelectedNewCaseFolders] = useState<string[]>(() => [...DEFAULT_CASE_FOLDERS]);
  const [renameCaseName, setRenameCaseName] = useState("");
  const [isRenamingCase, setIsRenamingCase] = useState(false);
  const [isSavingCase, setIsSavingCase] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<CaseFileContextMenu | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [sortState, setSortState] = useState<FileSortState>(() => readCaseSortState());
  const dragPathsRef = useRef<string[]>([]);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isRenameCancelingRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetPathRef = useRef<string | null>(null);
  const { panelRef, resetWidth, startResize, width } = useResizableFilePanel("lex-vault-side-panel-width-v3", 480);
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const sortedFileNodes = useMemo(() => sortFileNodes(fileNodes, sortState), [fileNodes, sortState]);
  const folderPaths = useMemo(() => collectFolderPaths(sortedFileNodes), [sortedFileNodes]);
  const areAllFoldersExpanded = folderPaths.length > 0 && folderPaths.every((path) => expandedPaths.has(path));
  const visibleMaterialNodes = useMemo(
    () => visibleFileNodes(sortedFileNodes, expandedPaths),
    [expandedPaths, sortedFileNodes],
  );
  const filteredCases = cases.filter((caseItem) =>
    caseItem.name.toLowerCase().includes(caseQuery.trim().toLowerCase()),
  );
  const filteredSessions = sessions.filter((conversation) =>
    conversation.title.toLowerCase().includes(sessionQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    setRenameCaseName(selectedCase?.name ?? "");
  }, [selectedCase?.name]);

  useEffect(() => {
    if (isRenamingCase) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenamingCase]);

  useEffect(() => {
    window.localStorage.setItem("lex-vault-file-sort-case", JSON.stringify(sortState));
  }, [sortState]);

  useNativeFileDrop(panelRef, useCallback((parentPath, sourcePaths) => {
    void onImportCasePaths(parentPath, sourcePaths);
  }, [onImportCasePaths]));

  function resetCreateCaseForm() {
    setNewCaseName("");
    setSelectedNewCaseFolders([...DEFAULT_CASE_FOLDERS]);
    setIsCreateDialogOpen(false);
  }

  /** 切换新建案件时需要初始化的单个材料目录。 */
  function toggleNewCaseFolder(folderName: string) {
    setSelectedNewCaseFolders((current) =>
      current.includes(folderName)
        ? current.filter((item) => item !== folderName)
        : [...current, folderName],
    );
  }

  /** 一次性切换新建案件的全部标准材料目录，便于快速清空后重新选择。 */
  function setAllNewCaseFolders(checked: boolean) {
    setSelectedNewCaseFolders(checked ? [...DEFAULT_CASE_FOLDERS] : []);
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function selectedOrSinglePath(node: FileNode) {
    return selectedPaths.has(node.path) ? Array.from(selectedPaths) : [node.path];
  }

  /** 统一切换当前案件文件树的全部文件夹展开状态。 */
  function toggleAllFolders() {
    setExpandedPaths(areAllFoldersExpanded ? new Set() : new Set(folderPaths));
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

  function contextFolderPath(node: FileNode | null) {
    if (!node) {
      return null;
    }
    return node.type === "folder" ? node.path : parentPath(node.path);
  }

  async function createMaterialFile(target: FileNode | null) {
    closeContextMenu();
    setIsCreateMenuOpen(false);
    const name = (await showPrompt({
      title: "新建文件",
      message: "请输入要创建的文件名。",
      inputLabel: "文件名",
      placeholder: "例如：新建文件.md",
      defaultValue: "新建文件.md",
      confirmText: "创建文件",
    }))?.trim();
    if (!name) {
      return;
    }
    await onCreateCaseFile(joinFilePath(contextFolderPath(target), name));
  }

  async function createMaterialFolder(target: FileNode | null) {
    closeContextMenu();
    setIsCreateMenuOpen(false);
    const name = (await showPrompt({
      title: "新建文件夹",
      message: "请输入要创建的文件夹名称。",
      inputLabel: "文件夹名",
      placeholder: "例如：证据目录",
      defaultValue: "新建文件夹",
      confirmText: "创建文件夹",
    }))?.trim();
    if (!name) {
      return;
    }
    await onCreateCaseFolder(joinFilePath(contextFolderPath(target), name));
  }

  async function renameMaterialNode(node: FileNode) {
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
    await onRenameCaseFile(node.path, joinFilePath(parentPath(node.path), name));
  }

  async function deleteMaterialNode(node: FileNode) {
    closeContextMenu();
    const paths = selectedOrSinglePath(node);
    const confirmed = await showConfirm({
      title: "删除材料",
      message: paths.length > 1 ? `确认删除选中的 ${paths.length} 个项目？` : `确认删除“${node.name}”？`,
      description: "删除后将直接影响当前案件目录中的本机文件，请谨慎操作。",
      confirmText: "确认删除",
      cancelText: "再想想",
      intent: "danger",
    });
    if (!confirmed) {
      return;
    }
    for (const path of paths) {
      await onDeleteCaseFile(path);
    }
    setSelectedPaths(new Set());
  }

  function chooseUploadFiles(target: FileNode | null) {
    closeContextMenu();
    uploadTargetPathRef.current = contextFolderPath(target);
    uploadInputRef.current?.click();
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    await onUploadCaseFiles(uploadTargetPathRef.current, files);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  /** 根据用户选择复制案件材料的相对路径或本机绝对路径。 */
  function copyMaterialPath(node: FileNode, mode: "relative" | "absolute") {
    closeContextMenu();
    const paths = selectedOrSinglePath(node);
    void navigator.clipboard?.writeText(
      paths
        .map((path) =>
          mode === "absolute" && selectedCase?.casePath
            ? resolveNativeFilePath(selectedCase.casePath, path)
            : path,
        )
        .join("\n"),
    );
  }

  function handleMaterialNodeClick(event: MouseEvent, node: FileNode) {
    setSelectedPaths((current) => {
      if (event.shiftKey && lastSelectedPath) {
        return new Set(rangePaths(visibleMaterialNodes, lastSelectedPath, node.path));
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

  async function moveOrCopyMaterialNodes(paths: string[], parent: string | null, copy: boolean) {
    for (const path of paths) {
      if (!canDropPath(path, parent)) {
        continue;
      }
      const newPath = joinFilePath(parent, fileNameFromPath(path));
      if (copy) {
        await onCopyCaseFile(path, newPath);
      } else if (newPath !== path) {
        await onRenameCaseFile(path, newPath);
      }
    }
  }

  function handleMaterialDragStart(event: DragEvent, node: FileNode) {
    const paths = selectedOrSinglePath(node);
    dragPathsRef.current = paths;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/x-lex-vault-file-paths", JSON.stringify(paths));
    if (selectedCase?.casePath) {
      event.dataTransfer.setData(
        "text/plain",
        paths.map((path) => resolveNativeFilePath(selectedCase.casePath, path)).join("\n"),
      );
      event.dataTransfer.setData(
        "text/uri-list",
        paths.map((path) => `file:///${resolveNativeFilePath(selectedCase.casePath, path).replace(/\\/g, "/")}`).join("\n"),
      );
    }
  }

  function handleMaterialDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = isExternalFileDrop(event) || event.ctrlKey ? "copy" : "move";
  }

  function handleMaterialDropOnNode(event: DragEvent, node: FileNode) {
    event.preventDefault();
    event.stopPropagation();
    if (isExternalFileDrop(event)) {
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        void onUploadCaseFiles(contextFolderPath(node), files);
      }
      return;
    }
    void moveOrCopyMaterialNodes(dragPathsRef.current, contextFolderPath(node), event.ctrlKey);
  }

  function handleMaterialDropOnBlank(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isExternalFileDrop(event)) {
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        void onUploadCaseFiles(null, files);
      }
      return;
    }
    void moveOrCopyMaterialNodes(dragPathsRef.current, null, event.ctrlKey);
  }

  function handleMaterialKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const paths = Array.from(selectedPaths);
    if ((event.target as HTMLElement).tagName === "INPUT") {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedPaths(new Set(visibleMaterialNodes.map((node) => node.path)));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      const absolute = event.shiftKey;
      void navigator.clipboard?.writeText(
        paths.map((path) => (absolute && selectedCase?.casePath ? resolveNativeFilePath(selectedCase.casePath, path) : path)).join("\n"),
      );
      return;
    }
    if (event.key === "Delete" && paths.length > 0) {
      event.preventDefault();
      const node = nodeFromPath(visibleMaterialNodes, paths[0]) ?? { name: "选中项目", path: paths[0], type: "file" as const };
      void deleteMaterialNode(node);
      return;
    }
    if (event.key === "F2" && paths.length === 1) {
      event.preventDefault();
      const node = nodeFromPath(visibleMaterialNodes, paths[0]);
      if (node) {
        void renameMaterialNode(node);
      }
      return;
    }
    if (event.key === "Enter" && paths.length === 1) {
      event.preventDefault();
      const node = nodeFromPath(visibleMaterialNodes, paths[0]);
      if (node?.type === "file") {
        onPreviewCaseFile(node);
      }
    }
  }

  async function handleMaterialPaste(event: ClipboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName === "INPUT") {
      return;
    }

    event.preventDefault();
    const clipboardPaths = await readClipboardFilePaths().catch(() => []);
    if (clipboardPaths.length > 0) {
      await onImportCasePaths(null, clipboardPaths);
      return;
    }

    const files = event.clipboardData.files;
    if (files.length > 0) {
      await onUploadCaseFiles(null, files);
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    const sourcePaths = text.split(/\r?\n/).map((line) => line.trim()).filter(isLikelyNativePath);
    if (sourcePaths.length > 0) {
      await onImportCasePaths(null, sourcePaths);
    }
  }

  async function handleCreateCase(event: FormEvent) {
    event.preventDefault();
    const name = newCaseName.trim();
    if (!name || isSavingCase) {
      return;
    }

    setIsSavingCase(true);
    try {
      await onCreateCase(name, selectedNewCaseFolders);
      resetCreateCaseForm();
      setIsActionMenuOpen(false);
    } finally {
      setIsSavingCase(false);
    }
  }

  function startRenameCase() {
    if (!selectedCase) {
      return;
    }

    setRenameCaseName(selectedCase.name);
    setIsRenamingCase(true);
    setIsActionMenuOpen(false);
    setIsCaseMenuOpen(false);
  }

  async function commitRenameCase(nextName = renameCaseName) {
    const name = nextName.trim();
    if (!selectedCase || isSavingCase) {
      setIsRenamingCase(false);
      return;
    }

    if (!name || name === selectedCase.name) {
      setRenameCaseName(selectedCase.name);
      setIsRenamingCase(false);
      return;
    }

    setIsSavingCase(true);
    try {
      await onRenameCase(selectedCase.id, name);
    } finally {
      setIsSavingCase(false);
      setIsRenamingCase(false);
    }
  }

  return (
    <section
      className="relative flex w-full min-w-0 shrink-0 flex-col rounded-xl border bg-white p-px shadow-sm lg:h-full"
      ref={panelRef}
      style={{ width }}
    >
      <div
        aria-label="调整案件文件管理宽度"
        className="absolute bottom-0 right-0 top-0 z-20 hidden w-2 cursor-col-resize touch-none bg-transparent transition hover:bg-blue-200/70 lg:block"
        onDoubleClick={resetWidth}
        onPointerDown={startResize}
        role="separator"
      />
      <div className="border-b p-4">
        <div className="relative mb-4 flex items-center justify-between gap-2">
          {isRenamingCase && selectedCase ? (
            <input
              aria-label="案件名称"
              className="h-9 min-w-0 flex-1 rounded-md border bg-white px-2 text-lg font-semibold text-slate-800 outline-none transition focus:ring-2 focus:ring-ring"
              disabled={isSavingCase}
              onBlur={(event) => {
                if (isRenameCancelingRef.current) {
                  isRenameCancelingRef.current = false;
                  return;
                }
                void commitRenameCase(event.currentTarget.value);
              }}
              onChange={(event) => setRenameCaseName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  isRenameCancelingRef.current = true;
                  setRenameCaseName(selectedCase.name);
                  setIsRenamingCase(false);
                }
              }}
              ref={renameInputRef}
              value={renameCaseName}
            />
          ) : (
            <button
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-lg font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setIsCaseMenuOpen((isOpen) => !isOpen)}
              type="button"
            >
              <span className="truncate">{selectedCase?.name ?? (isLoading ? "正在加载案件" : "暂无案件")}</span>
              <ChevronDown className="size-4 shrink-0 text-slate-500" />
            </button>
          )}
          <Button
            aria-label="更多案件操作"
            onClick={() => setIsActionMenuOpen((isOpen) => !isOpen)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal />
          </Button>

          {isCaseMenuOpen ? (
            <div className="absolute left-0 right-0 top-10 z-30 rounded-lg border bg-white p-2 shadow-xl">
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-9 w-full rounded-md border bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-ring"
                  onChange={(event) => setCaseQuery(event.currentTarget.value)}
                  placeholder="检索案件"
                  value={caseQuery}
                />
              </div>

              <div className="max-h-64 overflow-auto">
                {filteredCases.length > 0 ? (
                  filteredCases.map((caseItem) => (
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                      key={caseItem.id}
                      onClick={() => {
                        onSelectCase(caseItem.id);
                        setIsCaseMenuOpen(false);
                        setCaseQuery("");
                      }}
                      type="button"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {caseItem.id === selectedCase?.id ? (
                          <Check className="size-4 text-[#1d4ed8]" />
                        ) : null}
                      </span>
                      <span className="truncate">{caseItem.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">
                    {isLoading ? "正在加载案件" : "未找到匹配案件"}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isActionMenuOpen ? (
            <div className="absolute right-0 top-10 z-40 w-44 rounded-lg border bg-white p-1 shadow-xl">
              <button
                className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => {
                  setIsCreateDialogOpen(true);
                  setIsActionMenuOpen(false);
                }}
                type="button"
              >
                <Plus className="size-4 text-[#1d4ed8]" />
                添加案件
              </button>
              {selectedCase ? (
                <>
                  <div className="my-1 h-px bg-slate-100" />
                  <button
                    className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                    disabled={isSavingCase}
                    onClick={startRenameCase}
                    type="button"
                  >
                    <PenLine className="size-4 text-[#1d4ed8]" />
                    重命名
                  </button>
                  <button
                    className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    disabled={isSavingCase}
                    onClick={async () => {
                      const confirmed = await showConfirm({
                        title: "删除案件",
                        message: `确认删除案件“${selectedCase.name}”？`,
                        description: "案件目录及其下材料会一并删除，此操作不可撤销。",
                        confirmText: "确认删除",
                        cancelText: "取消",
                        intent: "danger",
                      });
                      if (!confirmed) {
                        return;
                      }
                      setIsSavingCase(true);
                      try {
                        await onDeleteCase(selectedCase.id);
                        setIsActionMenuOpen(false);
                      } finally {
                        setIsSavingCase(false);
                      }
                    }}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                    删除案件
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {isCreateDialogOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
            <form
              className="w-full max-w-lg rounded-xl border bg-white shadow-2xl"
              onSubmit={handleCreateCase}
            >
              <div className="flex h-14 items-center justify-between border-b px-5">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-md bg-blue-50 text-[#1d4ed8]">
                    <BriefcaseBusiness className="size-4" />
                  </div>
                  <h2 className="text-base font-semibold text-slate-900">添加案件</h2>
                </div>
                <Button
                  aria-label="关闭添加案件弹框"
                  onClick={resetCreateCaseForm}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>

              <div className="space-y-4 p-5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">案件名称</span>
                  <input
                    autoFocus
                    className="mt-2 h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                    onChange={(event) => setNewCaseName(event.currentTarget.value)}
                    placeholder="新案件会创建为案件目录下的文件夹"
                    value={newCaseName}
                  />
                </label>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-700">初始材料目录</span>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        className="rounded px-2 py-1 font-medium text-[#1d4ed8] hover:bg-blue-50"
                        onClick={() => setAllNewCaseFolders(true)}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        className="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100"
                        onClick={() => setAllNewCaseFolders(false)}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DEFAULT_CASE_FOLDERS.map((folderName) => (
                      <label
                        className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm text-slate-700 transition hover:bg-slate-50"
                        key={folderName}
                      >
                        <input
                          checked={selectedNewCaseFolders.includes(folderName)}
                          className="size-4 accent-[#1d4ed8]"
                          onChange={() => toggleNewCaseFolder(folderName)}
                          type="checkbox"
                        />
                        <span className="truncate">{folderName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t bg-slate-50 px-5 py-4">
                <Button
                  onClick={resetCreateCaseForm}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
                <Button className="bg-[#1d4ed8]" disabled={!newCaseName.trim() || isSavingCase} type="submit">
                  <Plus />
                  创建案件
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Button
            className="h-[54px]"
            disabled={!selectedCase}
            onClick={() => chooseUploadFiles(null)}
            type="button"
            variant="outline"
          >
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
              className="h-[54px] w-full"
              disabled={!selectedCase}
              onClick={() => setIsCreateMenuOpen((isOpen) => !isOpen)}
              type="button"
              variant="outline"
            >
              <Folder />
              新建
              <ChevronDown className="size-3" />
            </Button>

            {isCreateMenuOpen ? (
              <div className="absolute left-0 right-0 top-[62px] z-20 rounded-md border bg-white p-1 shadow-lg">
                <button
                  className="flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => void createMaterialFile(null)}
                  type="button"
                >
                  <FileText className="size-4 text-[#2563eb]" />
                  文件
                </button>
                <button
                  className="flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => void createMaterialFolder(null)}
                  type="button"
                >
                  <Folder className="size-4 text-[#3b82f6]" />
                  文件夹
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex h-10 items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            className={cn(
              "flex h-8 flex-1 items-center justify-center rounded-md text-sm font-medium text-slate-600 outline-none transition focus-visible:ring-2 focus-visible:ring-[#1d4ed8]",
              activePanel === "materials" && "bg-white text-[#1d4ed8] shadow-sm",
            )}
            onClick={() => setActivePanel("materials")}
            type="button"
          >
            材料
          </button>
          <button
            className={cn(
              "flex h-8 flex-1 items-center justify-center rounded-md text-sm font-medium text-slate-600 outline-none transition focus-visible:ring-2 focus-visible:ring-[#1d4ed8]",
              activePanel === "sessions" && "bg-white text-[#1d4ed8] shadow-sm",
            )}
            onClick={() => setActivePanel("sessions")}
            type="button"
          >
            会话
          </button>
        </div>

        {activePanel === "sessions" ? (
          <CaseSessionsToolbar
            agentEnabled={agentEnabled}
            hasSelectedCase={Boolean(selectedCase)}
            onCreateConversation={onCreateConversation}
            onRetryHistory={onRetryHistory}
            onSessionQueryChange={setSessionQuery}
            sessionQuery={sessionQuery}
          />
        ) : null}
        {activePanel === "materials" ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                disabled={!selectedCase || isFilesLoading}
                onClick={() => void onRefreshFiles()}
                size="icon"
                type="button"
                variant="outline"
              >
                <RefreshCw className={cn("size-4", isFilesLoading && "animate-spin")} />
              </Button>
              <FileSortPicker ariaLabel="文件排序" onSortChange={setSortState} sortState={sortState} />
            </div>
            <FileTreeExpandToggle
              disabled={!selectedCase || folderPaths.length === 0}
              expanded={areAllFoldersExpanded}
              onToggle={toggleAllFolders}
            />
          </div>
        ) : null}
      </div>

      {activePanel === "materials" ? (
        <CaseMaterialsPane
          contextMenu={contextMenu}
          expandedPaths={expandedPaths}
          hasSelectedCase={Boolean(selectedCase)}
          isFilesLoading={isFilesLoading}
          onAddCaseFileToChat={onAddCaseFileToChat}
          onBlankContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              node: null,
            });
          }}
          onChooseUploadFiles={chooseUploadFiles}
          onCloseContextMenu={closeContextMenu}
          onContextMenuChange={setContextMenu}
          onCopyMaterialPath={copyMaterialPath}
          onCreateFile={createMaterialFile}
          onCreateFolder={createMaterialFolder}
          onDeleteNode={deleteMaterialNode}
          onDragOver={handleMaterialDragOver}
          onDragStart={handleMaterialDragStart}
          onDropOnBlank={handleMaterialDropOnBlank}
          onDropOnNode={handleMaterialDropOnNode}
          onKeyDown={handleMaterialKeyDown}
          onPaste={handleMaterialPaste}
          onNodeClick={handleMaterialNodeClick}
          onOpenFile={onOpenCaseFile}
          onPreviewFile={onPreviewCaseFile}
          onRenameNode={renameMaterialNode}
          onRevealCasePath={onRevealCasePath}
          onToggleFolder={toggleFolder}
          selectedPaths={selectedPaths}
          sortedFileNodes={sortedFileNodes}
        />
      ) : (
        <div className="flex-1 overflow-auto p-2">
          <CaseSessionsList
            agentEnabled={agentEnabled}
            hasSelectedCase={Boolean(selectedCase)}
            historyLoadError={historyLoadError}
            isHistoryLoading={isHistoryLoading}
            onSelectConversation={onSelectConversation}
            onRetryHistory={onRetryHistory}
            selectedSessionId={selectedSessionId}
            sessions={filteredSessions}
          />
        </div>
      )}
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
