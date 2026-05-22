import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, ChevronRight, FileText, Folder, Gavel, RefreshCw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveNativeFilePath } from "@/services/native-file-service";
import type { ChatAttachment, LibraryKey } from "@/types/domain";
import {
  filterKnowledgeBaseItems,
  flattenKnowledgeBaseSources,
  listKnowledgeBaseFolderItems,
  type KnowledgeBaseBrowseItem,
  type KnowledgeBaseSearchItem,
  type KnowledgeBaseSource,
} from "@/features/chat/components/knowledge-base-helpers";
import { parentPath } from "@/utils/file-path";

/** 知识库来源到图标的映射，保持弹层筛选标签和结果标识一致。 */
const SOURCE_ICONS = {
  templates: FileText,
  laws: Gavel,
  cases: BookOpenCheck,
} satisfies Record<LibraryKey, typeof FileText>;

/** 对话框中的知识库弹层，集中展示模板、法规和案例文件。 */
export function KnowledgeBaseDialog({
  onClose,
  onAddReference,
  onRefresh,
  sources,
}: {
  /** 关闭知识库弹层。 */
  onClose: () => void;
  /** 点击文件时加入本轮对话引用。 */
  onAddReference: (attachment: ChatAttachment) => void;
  /** 刷新全部知识库文件树。 */
  onRefresh: () => Promise<void>;
  /** 当前可展示的知识库来源。 */
  sources: KnowledgeBaseSource[];
}) {
  const [query, setQuery] = useState("");
  const [currentSourceKey, setCurrentSourceKey] = useState<LibraryKey | null>(null);
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const currentSource = useMemo(
    () => sources.find((source) => source.key === currentSourceKey) ?? null,
    [currentSourceKey, sources],
  );
  const items = useMemo(() => flattenKnowledgeBaseSources(sources), [sources]);
  const filteredItems = useMemo(
    () => filterKnowledgeBaseItems(items, query, currentSourceKey ?? "all"),
    [currentSourceKey, items, query],
  );
  const folderItems = useMemo(
    () => currentSource ? listKnowledgeBaseFolderItems(currentSource, currentFolderPath) : [],
    [currentFolderPath, currentSource],
  );
  const hasLoadingSource = sources.some((source) => source.loading);
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (items.length > 0 || hasLoadingSource) {
      return;
    }
    void refreshKnowledgeBase();
    // 首次打开弹层时补齐尚未进入过的文件库树。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshKnowledgeBase() {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  function addReference(item: KnowledgeBaseSearchItem | KnowledgeBaseBrowseItem) {
    onAddReference({
      id: `knowledge:${item.sourceKey}:${item.rootPath}:${item.path}`,
      name: item.name,
      type: "knowledge-reference",
      contentType: "text/x-lex-vault-path",
      path: resolveNativeFilePath(item.rootPath, item.path),
      rootPath: item.rootPath,
      relativePath: item.path,
      nodeType: item.type,
      sourceLabel: item.sourceLabel,
    });
  }

  /** 进入知识库来源或子文件夹时，只展示当前层级的直接子项。 */
  function openFolder(sourceKey: LibraryKey, path: string | null) {
    setCurrentSourceKey(sourceKey);
    setCurrentFolderPath(path);
    setQuery("");
  }

  function openParentFolder() {
    if (!currentFolderPath) {
      setCurrentSourceKey(null);
      return;
    }
    setCurrentFolderPath(parentPath(currentFolderPath));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 px-3 pb-4 pt-12 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <section
        className="flex h-[min(720px,82vh)] w-[min(960px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">知识库</h2>
            <p className="truncate text-xs text-slate-500">模板、法规和案例资料</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={isRefreshing || hasLoadingSource}
              onClick={() => void refreshKnowledgeBase()}
              size="icon"
              title="刷新知识库"
              type="button"
              variant="outline"
            >
              <RefreshCw className={cn("size-4", (isRefreshing || hasLoadingSource) && "animate-spin")} />
            </Button>
            <Button aria-label="关闭知识库" onClick={onClose} size="icon" type="button" variant="ghost">
              <X />
            </Button>
          </div>
        </header>

        <div className="border-b bg-slate-50 px-4 py-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="检索文件名、路径或资料类型"
                value={query}
              />
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <SourceFilterButton
                active={!currentSourceKey}
                label="全部"
                onClick={() => {
                  setCurrentSourceKey(null);
                  setCurrentFolderPath(null);
                }}
              />
              {sources.map((source) => (
                <SourceFilterButton
                  active={currentSourceKey === source.key}
                  key={source.key}
                  label={source.label}
                  onClick={() => openFolder(source.key, null)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="chat-scrollbar min-h-0 flex-1 overflow-auto p-3">
          <KnowledgeBaseBreadcrumb
            currentFolderPath={currentFolderPath}
            currentSource={currentSource}
            onBack={openParentFolder}
            onRoot={() => {
              setCurrentSourceKey(null);
              setCurrentFolderPath(null);
            }}
            onSourceRoot={() => setCurrentFolderPath(null)}
          />
          {searching ? (
            <SearchResultList
              filteredItems={filteredItems}
              onOpenFolder={(item) => openFolder(item.sourceKey, item.path)}
              onAddReference={addReference}
            />
          ) : currentSource ? (
            <FolderBrowseList
              folderItems={folderItems}
              isEmptyLoading={hasLoadingSource || isRefreshing}
              onOpenFolder={(item) => openFolder(item.sourceKey, item.path)}
              onAddReference={addReference}
            />
          ) : sources.length ? (
            <div className="divide-y rounded-md border bg-white">
              {sources.map((source) => {
                const SourceIcon = SOURCE_ICONS[source.key];
                return (
                  <button
                    className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition hover:bg-blue-50"
                    key={source.key}
                    onClick={() => openFolder(source.key, null)}
                    title={`进入${source.label}`}
                    type="button"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#1d4ed8]">
                      <SourceIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{source.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{source.rootPath || "未配置目录"}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {hasLoadingSource || isRefreshing ? "正在加载知识库内容" : "没有找到匹配的知识库内容"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function KnowledgeBaseBreadcrumb({
  currentFolderPath,
  currentSource,
  onBack,
  onRoot,
  onSourceRoot,
}: {
  /** 当前浏览的文件夹相对路径。 */
  currentFolderPath: string | null;
  /** 当前浏览的知识库来源。 */
  currentSource: KnowledgeBaseSource | null;
  /** 返回上一级目录。 */
  onBack: () => void;
  /** 返回全部知识库入口。 */
  onRoot: () => void;
  /** 返回当前知识库来源根目录。 */
  onSourceRoot: () => void;
}) {
  const pathParts = currentFolderPath?.split(/[\\/]/).filter(Boolean) ?? [];
  return (
    <div className="mb-3 flex min-h-9 items-center gap-2 rounded-md border bg-slate-50 px-3 text-sm text-slate-600">
      <button className="font-medium text-[#1d4ed8] hover:underline" onClick={onRoot} type="button">
        全部知识库
      </button>
      {currentSource ? (
        <>
          <ChevronRight className="size-3.5 text-slate-400" />
          <button className="font-medium text-[#1d4ed8] hover:underline" onClick={onSourceRoot} type="button">
            {currentSource.label}
          </button>
        </>
      ) : null}
      {pathParts.map((part, index) => (
        <span className="inline-flex min-w-0 items-center gap-2" key={`${part}-${index}`}>
          <ChevronRight className="size-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{part}</span>
        </span>
      ))}
      {currentSource ? (
        <button className="ml-auto shrink-0 text-xs font-medium text-slate-500 hover:text-[#1d4ed8]" onClick={onBack} type="button">
          上一级
        </button>
      ) : null}
    </div>
  );
}

function SearchResultList({
  filteredItems,
  onOpenFolder,
  onAddReference,
}: {
  /** 搜索命中的知识库文件和文件夹。 */
  filteredItems: KnowledgeBaseSearchItem[];
  /** 打开搜索命中的文件夹。 */
  onOpenFolder: (item: KnowledgeBaseSearchItem) => void;
  /** 将搜索命中的文件加入本轮对话引用。 */
  onAddReference: (item: KnowledgeBaseSearchItem) => void;
}) {
  if (!filteredItems.length) {
    return (
      <div className="rounded-md border bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        没有找到匹配的知识库内容
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border bg-white">
      {filteredItems.map((item) => {
        const SourceIcon = SOURCE_ICONS[item.sourceKey];
        const isFile = item.type === "file";
        return (
          <button
            className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition hover:bg-blue-50"
            key={`${item.sourceKey}:${item.path}`}
            onClick={() => isFile ? onAddReference(item) : onOpenFolder(item)}
            title={isFile ? "加入本次对话引用" : "进入文件夹"}
            type="button"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#1d4ed8]">
              {isFile ? <FileText className="size-4" /> : <Folder className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{item.name}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{item.path}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs text-slate-500">
              <SourceIcon className="size-3.5 text-[#1d4ed8]" />
              {item.sourceLabel}
            </span>
            {!isFile ? <ChevronRight className="size-4 shrink-0 text-slate-400" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function FolderBrowseList({
  folderItems,
  isEmptyLoading,
  onOpenFolder,
  onAddReference,
}: {
  /** 当前文件夹直接子项。 */
  folderItems: KnowledgeBaseBrowseItem[];
  /** 空状态是否展示加载文案。 */
  isEmptyLoading: boolean;
  /** 打开子文件夹。 */
  onOpenFolder: (item: KnowledgeBaseBrowseItem) => void;
  /** 将文件加入本轮对话引用。 */
  onAddReference: (item: KnowledgeBaseBrowseItem) => void;
}) {
  if (!folderItems.length) {
    return (
      <div className="rounded-md border bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        {isEmptyLoading ? "正在加载知识库内容" : "当前文件夹暂无内容"}
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border bg-white">
      {folderItems.map((item) => {
        const isFile = item.type === "file";
        return (
          <button
            className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition hover:bg-blue-50"
            key={`${item.sourceKey}:${item.path}`}
            onClick={() => isFile ? onAddReference(item) : onOpenFolder(item)}
            title={isFile ? "加入本次对话引用" : "进入文件夹"}
            type="button"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#1d4ed8]">
              {isFile ? <FileText className="size-4" /> : <Folder className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{item.name}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{item.path}</span>
            </span>
            {!isFile ? <ChevronRight className="size-4 shrink-0 text-slate-400" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SourceFilterButton({
  active,
  label,
  onClick,
}: {
  /** 当前筛选项是否被选中。 */
  active: boolean;
  /** 筛选项展示名称。 */
  label: string;
  /** 点击筛选项的处理函数。 */
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "h-10 rounded-md border px-3 text-sm font-medium transition",
        active
          ? "border-[#1d4ed8] bg-[#1d4ed8] text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
