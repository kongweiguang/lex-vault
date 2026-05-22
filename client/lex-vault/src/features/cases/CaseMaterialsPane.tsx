import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent } from "react";
import { useRef } from "react";
import type { ReactNode } from "react";
import {
  Copy,
  FileText,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  PenLine,
  Trash2,
  Upload,
} from "lucide-react";

import { FileTreeItem } from "@/components/files/FileTree";
import type { FileNode } from "@/types/domain";

import type { CaseFileContextMenu } from "@/features/cases/case-panel-helpers";

type CaseMaterialsPaneProps = {
  sortedFileNodes: FileNode[];
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  contextMenu: CaseFileContextMenu | null;
  isFilesLoading: boolean;
  hasSelectedCase: boolean;
  onCloseContextMenu: () => void;
  onBlankContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent) => void;
  onDropOnBlank: (event: DragEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onContextMenuChange: (menu: CaseFileContextMenu) => void;
  onDragStart: (event: DragEvent, node: FileNode) => void;
  onDropOnNode: (event: DragEvent, node: FileNode) => void;
  onNodeClick: (event: MouseEvent, node: FileNode) => void;
  onOpenFile: (node: FileNode) => void;
  onPreviewFile: (node: FileNode) => void;
  onToggleFolder: (node: FileNode) => void;
  onRevealCasePath: (node: FileNode) => void;
  onAddCaseFileToChat: (node: FileNode) => void;
  onCreateFile: (node: FileNode | null) => Promise<void>;
  onCreateFolder: (node: FileNode | null) => Promise<void>;
  onChooseUploadFiles: (node: FileNode | null) => void;
  onCopyMaterialPath: (node: FileNode, mode: "relative" | "absolute") => void;
  onRenameNode: (node: FileNode) => Promise<void>;
  onDeleteNode: (node: FileNode) => Promise<void>;
};

/** 案件材料文件树与右键菜单区域。 */
export function CaseMaterialsPane({
  sortedFileNodes,
  expandedPaths,
  selectedPaths,
  contextMenu,
  isFilesLoading,
  hasSelectedCase,
  onCloseContextMenu,
  onBlankContextMenu,
  onDragOver,
  onDropOnBlank,
  onKeyDown,
  onPaste,
  onContextMenuChange,
  onDragStart,
  onDropOnNode,
  onNodeClick,
  onOpenFile,
  onPreviewFile,
  onToggleFolder,
  onRevealCasePath,
  onAddCaseFileToChat,
  onCreateFile,
  onCreateFolder,
  onChooseUploadFiles,
  onCopyMaterialPath,
  onRenameNode,
  onDeleteNode,
}: CaseMaterialsPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="flex-1 overflow-auto p-2 outline-none"
      data-file-drop-path=""
      onClick={onCloseContextMenu}
      onContextMenu={onBlankContextMenu}
      onDragOver={onDragOver}
      onDrop={onDropOnBlank}
      onKeyDown={onKeyDown}
      onMouseDownCapture={() => paneRef.current?.focus()}
      onPaste={onPaste}
      ref={paneRef}
      tabIndex={0}
    >
      <div className="space-y-1">
        {sortedFileNodes.length > 0 ? (
          sortedFileNodes.map((node) => (
            <FileTreeItem
              expandedPaths={expandedPaths}
              key={node.path}
              node={node}
              onContextMenu={(event, currentNode) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenuChange({
                  x: event.clientX,
                  y: event.clientY,
                  node: currentNode,
                });
              }}
              onDragOverNode={onDragOver}
              onDragStart={onDragStart}
              onDropOnNode={onDropOnNode}
              onNodeClick={onNodeClick}
              onOpenFile={onOpenFile}
              onSelectFile={onPreviewFile}
              onToggleFolder={onToggleFolder}
              selectedPaths={selectedPaths}
            />
          ))
        ) : (
          <div className="px-3 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
            {isFilesLoading ? "正在加载案件材料" : hasSelectedCase ? "当前案件暂无文件" : "请先选择案件"}
          </div>
        )}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 w-56 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.node?.type === "file" ? (
            <ContextMenuButton
              icon={<FileText className="size-4 text-[color:var(--color-primary)]" />}
              label="打开"
              onClick={() => {
                onCloseContextMenu();
                onOpenFile(contextMenu.node!);
              }}
            />
          ) : null}
          {contextMenu.node ? (
            <ContextMenuButton
              icon={<FolderOpen className="size-4 text-[color:var(--color-primary)]" />}
              label="在资源管理器中显示"
              onClick={() => {
                onCloseContextMenu();
                onRevealCasePath(contextMenu.node!);
              }}
            />
          ) : null}
          {contextMenu.node ? (
            <ContextMenuButton
              icon={<MessageSquarePlus className="size-4 text-[color:var(--color-primary)]" />}
              label="添加到聊天框"
              onClick={() => {
                onCloseContextMenu();
                onAddCaseFileToChat(contextMenu.node!);
              }}
            />
          ) : null}
          <ContextMenuButton
            icon={<FileText className="size-4 text-[color:var(--color-primary)]" />}
            label="新建文件"
            onClick={() => void onCreateFile(contextMenu.node)}
          />
          <ContextMenuButton
            icon={<Folder className="size-4 text-[color:var(--color-primary)]" />}
            label="新建文件夹"
            onClick={() => void onCreateFolder(contextMenu.node)}
          />
          <ContextMenuButton
            icon={<Upload className="size-4 text-[color:var(--color-primary)]" />}
            label="上传到此处"
            onClick={() => onChooseUploadFiles(contextMenu.node)}
          />
          {contextMenu.node ? (
            <>
              <div className="my-1 h-px bg-[color:var(--color-muted)]" />
              <ContextMenuButton
                icon={<Copy className="size-4 text-[color:var(--color-muted-foreground)]" />}
                label="复制路径"
                onClick={() => onCopyMaterialPath(contextMenu.node!, "absolute")}
              />
              <ContextMenuButton
                icon={<Copy className="size-4 text-[color:var(--color-muted-foreground)]" />}
                label="复制相对路径"
                onClick={() => onCopyMaterialPath(contextMenu.node!, "relative")}
              />
              <ContextMenuButton
                icon={<PenLine className="size-4 text-[color:var(--color-primary)]" />}
                label="重命名"
                onClick={() => void onRenameNode(contextMenu.node!)}
              />
              <ContextMenuButton
                className="text-red-600 hover:bg-red-50"
                icon={<Trash2 className="size-4" />}
                label="删除"
                onClick={() => void onDeleteNode(contextMenu.node!)}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContextMenuButton({
  icon,
  label,
  className,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-[color:var(--color-card-foreground)] hover:bg-[color:var(--color-muted)] ${className ?? ""}`.trim()}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}
