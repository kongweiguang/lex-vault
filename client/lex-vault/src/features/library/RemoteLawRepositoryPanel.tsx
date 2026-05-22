import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Download, FileText, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { showAlert } from "@/services/dialog-service";
import {
  downloadLawToLibrary,
  fetchLawIndex,
  isRemoteLawDownloaded,
  normalizeLawDownloadResult,
} from "@/services/law-repository-service";
import type { FileNode, RemoteLawDirectory, RemoteLawEntry, RemoteLawIndex } from "@/types/domain";

type RemoteLawRepositoryPanelProps = {
  /** 当前本地法规目录，用于下载落盘。 */
  directory: string;
  /** 当前本地法规文件树，用于判断远程法规是否已下载。 */
  fileNodes: FileNode[];
  /** 关闭远程法规库，返回本地法规文件树。 */
  onClose: () => void;
  /** 下载成功后刷新本地法规目录。 */
  onDownloaded: (path: string) => Promise<void>;
};

/** 远程法规库浏览、检索和按需下载弹框。 */
export function RemoteLawRepositoryPanel({
  directory,
  fileNodes,
  onClose,
  onDownloaded,
}: RemoteLawRepositoryPanelProps) {
  const [index, setIndex] = useState<RemoteLawIndex | null>(null);
  const [query, setQuery] = useState("");
  const [selectedDirectory, setSelectedDirectory] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadingDirectoryPath, setDownloadingDirectoryPath] = useState<string | null>(null);
  const [downloadedPaths, setDownloadedPaths] = useState<Set<string>>(new Set());

  const directoryTree = useMemo(() => index?.directoryTree ?? [], [index?.directoryTree]);

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (index?.entries ?? []).filter((entry) => {
      const directoryMatched = !selectedDirectory || entry.path === selectedDirectory || entry.path.startsWith(`${selectedDirectory}/`);
      const keywordMatched = !keyword || [entry.name, entry.category, entry.path]
        .some((value) => value.toLowerCase().includes(keyword));
      return directoryMatched && keywordMatched;
    });
  }, [index?.entries, query, selectedDirectory]);

  const selectedDirectoryNode = useMemo(
    () => findDirectoryNode(directoryTree, selectedDirectory),
    [directoryTree, selectedDirectory],
  );

  const visibleChildDirectories = useMemo(() => {
    if (query.trim()) {
      return [];
    }
    return selectedDirectoryNode?.children ?? directoryTree;
  }, [directoryTree, query, selectedDirectoryNode?.children]);

  const visibleDirectEntries = useMemo(() => {
    const keyword = query.trim();
    if (keyword) {
      return filteredEntries;
    }
    return filteredEntries.filter((entry) => parentDirectoryPath(entry.path) === selectedDirectory);
  }, [filteredEntries, query, selectedDirectory]);

  const hasQuery = query.trim().length > 0;
  const selectedDirectoryEntries = useMemo(
    () => (selectedDirectory ? entriesInDirectory(selectedDirectory, hasQuery ? filteredEntries : undefined) : []),
    [filteredEntries, hasQuery, selectedDirectory],
  );
  const selectedDirectoryDownloaded = selectedDirectoryEntries.length > 0 && selectedDirectoryEntries.every(isDownloaded);

  const cacheStatusText = useMemo(() => {
    if (!index) {
      return "";
    }
    const sourceText = index.cached ? "本地缓存" : "服务器同步";
    const timeText = formatCacheTime(index.cachedAt || index.generatedAt);
    return timeText ? `${sourceText}：${timeText}` : sourceText;
  }, [index]);

  useEffect(() => {
    void loadIndex(false);
  }, []);

  async function loadIndex(forceRefresh: boolean) {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextIndex = await fetchLawIndex(forceRefresh);
      setIndex(nextIndex);
      setSelectedDirectory("");
      setExpandedDirectories(new Set(nextIndex.directoryTree?.map((directory) => directory.path) ?? []));
    } catch (error) {
      console.error("读取远程法规库失败", error);
      setErrorMessage(forceRefresh && index ? "刷新法规库失败，已保留当前列表" : "法规库暂时无法访问");
    } finally {
      setIsLoading(false);
    }
  }

  async function downloadEntry(entry: RemoteLawEntry) {
    if (!directory) {
      await showAlert({
        title: "缺少法规目录",
        message: "请先配置法规资料目录。",
        description: "配置完成后才能将远程法规下载到本机工作区。",
        intent: "warning",
      });
      return;
    }
    setDownloadingPath(entry.path);
    try {
      const result = await downloadLawToLibrary(directory, entry);
      const localPath = normalizeLawDownloadResult(result);
      setDownloadedPaths((current) => new Set(current).add(localPath));
      await onDownloaded(localPath);
    } catch (error) {
      console.error("下载法规失败", error);
      await showAlert({
        title: "下载失败",
        message: "下载法规失败，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setDownloadingPath(null);
    }
  }

  async function downloadDirectory(targetDirectory: RemoteLawDirectory, scopedEntries?: RemoteLawEntry[]) {
    if (!directory) {
      await showAlert({
        title: "缺少法规目录",
        message: "请先配置法规资料目录。",
        description: "配置完成后才能批量下载远程法规。",
        intent: "warning",
      });
      return;
    }

    const entries = entriesInDirectory(targetDirectory.path, scopedEntries).filter((entry) => !isDownloaded(entry));
    if (entries.length === 0) {
      await showAlert({
        title: "无需下载",
        message: "该文件夹内的法规已全部下载。",
        intent: "success",
      });
      return;
    }

    setDownloadingDirectoryPath(targetDirectory.path);
    let lastLocalPath = "";
    try {
      for (const entry of entries) {
        setDownloadingPath(entry.path);
        const result = await downloadLawToLibrary(directory, entry);
        const localPath = normalizeLawDownloadResult(result);
        lastLocalPath = localPath;
        setDownloadedPaths((current) => new Set(current).add(localPath));
      }
      if (lastLocalPath) {
        await onDownloaded(lastLocalPath);
      }
    } catch (error) {
      console.error("下载法规文件夹失败", error);
      await showAlert({
        title: "下载失败",
        message: "下载文件夹失败，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setDownloadingPath(null);
      setDownloadingDirectoryPath(null);
    }
  }

  function isDownloaded(entry: RemoteLawEntry) {
    return downloadedPaths.has(entry.path) || isRemoteLawDownloaded(fileNodes, entry);
  }

  /** 按目录收敛法规条目；传入 scopedEntries 时用于保留当前搜索筛选后的下载范围。 */
  function entriesInDirectory(path: string, scopedEntries?: RemoteLawEntry[]) {
    return (scopedEntries ?? index?.entries ?? []).filter((entry) => entry.path.startsWith(`${path}/`));
  }

  function isDirectoryDownloaded(path: string, scopedEntries?: RemoteLawEntry[]) {
    const entries = entriesInDirectory(path, scopedEntries);
    return entries.length > 0 && entries.every(isDownloaded);
  }

  function selectDirectory(path: string) {
    setSelectedDirectory(path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }

  function toggleDirectory(path: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="flex h-[86vh] max-h-[86vh] w-full max-w-4xl min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                  <FileText className="size-4" />
                </div>
                <h1 className="text-lg font-semibold text-slate-800">法规库</h1>
              </div>
              <p className="mt-2 truncate text-xs text-slate-500" title={directory}>
                {directory || "未配置法规资料目录"}
              </p>
              {cacheStatusText ? (
                <p className="mt-1 truncate text-xs text-slate-400" title={cacheStatusText}>
                  {cacheStatusText}
                </p>
              ) : null}
            </div>
            <Button aria-label="关闭法规库弹框" onClick={onClose} size="icon" type="button" variant="ghost">
              <X />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_44px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-md border bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-ring"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="检索法规库"
                value={query}
              />
            </div>
            <Button disabled={isLoading} onClick={() => void loadIndex(true)} size="icon" type="button" variant="outline">
              <RefreshCw className={isLoading ? "animate-spin" : undefined} />
            </Button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-slate-500" title={selectedDirectory || "全部法规"}>
              当前目录：{selectedDirectory || "全部法规"} · {filteredEntries.length} 项
            </p>
            {selectedDirectoryNode ? (
              <Button
                disabled={downloadingDirectoryPath === selectedDirectory || selectedDirectoryEntries.length === 0 || selectedDirectoryDownloaded}
                onClick={() => void downloadDirectory(selectedDirectoryNode, selectedDirectoryEntries)}
                size="sm"
                type="button"
                variant="outline"
              >
                {selectedDirectoryDownloaded ? <Check /> : <Download />}
                {downloadingDirectoryPath === selectedDirectory
                  ? "下载中"
                  : selectedDirectoryDownloaded
                    ? "已下载"
                    : "下载当前文件夹"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 border-r bg-slate-50/50 p-2">
            <div className="chat-scrollbar h-full overflow-auto pr-1">
              <DirectoryTreeButton
                active={!selectedDirectory}
                count={index?.entries.length ?? 0}
                depth={0}
                expanded
                label="全部法规"
                onClick={() => selectDirectory("")}
              />
              {directoryTree.map((directory) => (
                <DirectoryTreeNode
                  directory={directory}
                  expandedDirectories={expandedDirectories}
                  key={directory.path}
                  onSelect={selectDirectory}
                  onToggle={toggleDirectory}
                  selectedPath={selectedDirectory}
                />
              ))}
            </div>
          </aside>

          <main className="chat-scrollbar min-h-0 overflow-auto p-3">
            {errorMessage ? (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}
            {!errorMessage && isLoading ? (
              <div className="px-3 py-8 text-center text-sm text-slate-500">正在加载法规库</div>
            ) : null}
            {!errorMessage && !isLoading && filteredEntries.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-500">没有匹配的法规</div>
            ) : null}
            <div className="space-y-2">
              {visibleChildDirectories.map((directory) => (
                <div
                  className="flex w-full items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-blue-50/60"
                  key={directory.path}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => selectDirectory(directory.path)}
                    type="button"
                  >
                    <Folder className="size-4 shrink-0 text-blue-600" />
                    <span className="truncate text-sm font-medium text-slate-800" title={directory.path}>
                      {directory.name}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{directory.count} 项</span>
                    <Button
                      disabled={downloadingDirectoryPath === directory.path || isDirectoryDownloaded(directory.path)}
                      onClick={() => void downloadDirectory(directory)}
                      size="sm"
                      type="button"
                      variant={isDirectoryDownloaded(directory.path) ? "secondary" : "outline"}
                    >
                      {isDirectoryDownloaded(directory.path) ? <Check /> : <Download />}
                      {downloadingDirectoryPath === directory.path ? "下载中" : isDirectoryDownloaded(directory.path) ? "已下载" : "下载"}
                    </Button>
                  </span>
                </div>
              ))}
              {visibleDirectEntries.map((entry) => {
                const downloaded = isDownloaded(entry);
                return (
                  <div className="rounded-lg border bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/30" key={entry.path}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800" title={entry.name}>{entry.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500" title={entry.path}>{entry.path}</p>
                      </div>
                      <Button
                        disabled={downloaded || downloadingPath === entry.path}
                        onClick={() => void downloadEntry(entry)}
                        size="sm"
                        type="button"
                        variant={downloaded ? "secondary" : "outline"}
                      >
                        {downloaded ? <Check /> : <Download />}
                        {downloaded ? "已下载" : downloadingPath === entry.path ? "下载中" : "下载"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}

function formatCacheTime(value?: string) {
  if (!value) {
    return "";
  }
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DirectoryTreeNode({
  directory,
  depth = 0,
  expandedDirectories,
  onSelect,
  onToggle,
  selectedPath,
}: {
  directory: RemoteLawDirectory;
  depth?: number;
  expandedDirectories: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  selectedPath: string;
}) {
  const hasChildren = Boolean(directory.children?.length);
  const expanded = expandedDirectories.has(directory.path);

  return (
    <div>
      <DirectoryTreeButton
        active={selectedPath === directory.path}
        count={directory.count}
        depth={depth}
        expanded={expanded}
        hasChildren={hasChildren}
        label={directory.name}
        onClick={() => onSelect(directory.path)}
        onToggle={hasChildren ? () => onToggle(directory.path) : undefined}
      />
      {expanded && directory.children?.map((child) => (
        <DirectoryTreeNode
          depth={depth + 1}
          directory={child}
          expandedDirectories={expandedDirectories}
          key={child.path}
          onSelect={onSelect}
          onToggle={onToggle}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

function DirectoryTreeButton({
  active,
  count,
  depth,
  expanded,
  hasChildren = false,
  label,
  onClick,
  onToggle,
}: {
  active: boolean;
  count: number;
  depth: number;
  expanded: boolean;
  hasChildren?: boolean;
  label: string;
  onClick: () => void;
  onToggle?: () => void;
}) {
  return (
    <div
      className={`group flex h-8 items-center gap-1 rounded-md pr-2 text-sm transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-white"}`}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      <button
        aria-label={expanded ? "收起文件夹" : "展开文件夹"}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-0"
        disabled={!hasChildren}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
        type="button"
      >
        <ChevronRight className={`size-3.5 transition ${expanded ? "rotate-90" : ""}`} />
      </button>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onClick} type="button">
        {expanded ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />}
        <span className="truncate" title={label}>{label}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-400">{count}</span>
      </button>
    </div>
  );
}

function findDirectoryNode(nodes: RemoteLawDirectory[], path: string): RemoteLawDirectory | null {
  if (!path) {
    return null;
  }
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const child = findDirectoryNode(node.children ?? [], path);
    if (child) {
      return child;
    }
  }
  return null;
}

function parentDirectoryPath(path: string) {
  const segments = path.split("/");
  segments.pop();
  return segments.join("/");
}
