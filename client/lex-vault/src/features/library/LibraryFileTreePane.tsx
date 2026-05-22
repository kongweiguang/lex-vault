import type { ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent } from "react";
import { useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Copy,
  FileText,
  Folder,
  FolderOpen,
  PenLine,
  Upload,
  Trash2,
} from "lucide-react";

import { FileTreeItem } from "@/components/files/FileTree";
import type { FileNode } from "@/types/domain";

import type { LibraryFileContextMenu } from "@/features/library/library-panel-helpers";

type LibraryFileTreePaneProps = {
  title: string;
  directory: string;
  filteredNodes: FileNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  selectedPaths: Set<string>;
  contextMenu: LibraryFileContextMenu | null;
  isFilesLoading: boolean;
  onCloseContextMenu: () => void;
  onBlankContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onDragOverNode: (event: DragEvent) => void;
  onDropOnBlank: (event: DragEvent<HTMLDivElement>) => void;
  onFileTreeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFileTreePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onOpenFile: (node: FileNode) => void;
  onSelectFile: (node: FileNode) => void;
  onToggleFolder: (node: FileNode) => void;
  onNodeClick: (event: MouseEvent, node: FileNode) => void;
  onContextMenuChange: (menu: LibraryFileContextMenu) => void;
  onDragStart: (event: DragEvent, node: FileNode) => void;
  onDropOnNode: (event: DragEvent, node: FileNode) => void;
  onRevealPath: (node: FileNode) => void;
  onCreateFile: (node: FileNode | null) => Promise<void>;
  onCreateFolder: (node: FileNode | null) => Promise<void>;
  onChooseUploadFiles: (node: FileNode | null) => void;
  onCopyNodePath: (node: FileNode, mode: "relative" | "absolute") => void;
  onRenameNode: (node: FileNode) => Promise<void>;
  onDeleteNode: (node: FileNode) => Promise<void>;
};

/** 文件库文件树与右键菜单区域。 */
export function LibraryFileTreePane({
  title,
  directory,
  filteredNodes,
  expandedPaths,
  selectedPath,
  selectedPaths,
  contextMenu,
  isFilesLoading,
  onCloseContextMenu,
  onBlankContextMenu,
  onDragOverNode,
  onDropOnBlank,
  onFileTreeKeyDown,
  onFileTreePaste,
  onOpenFile,
  onSelectFile,
  onToggleFolder,
  onNodeClick,
  onContextMenuChange,
  onDragStart,
  onDropOnNode,
  onRevealPath,
  onCreateFile,
  onCreateFolder,
  onChooseUploadFiles,
  onCopyNodePath,
  onRenameNode,
  onDeleteNode,
}: LibraryFileTreePaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="flex-1 overflow-auto p-2 outline-none"
      data-file-drop-path=""
      onClick={onCloseContextMenu}
      onContextMenu={onBlankContextMenu}
      onDragOver={onDragOverNode}
      onDrop={onDropOnBlank}
      onKeyDown={onFileTreeKeyDown}
      onMouseDownCapture={() => paneRef.current?.focus()}
      onPaste={onFileTreePaste}
      ref={paneRef}
      tabIndex={0}
    >
      <div className="space-y-1">
        {filteredNodes.length > 0 ? (
          filteredNodes.map((node) => (
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
              onDragOverNode={onDragOverNode}
              onDragStart={onDragStart}
              onDropOnNode={onDropOnNode}
              onNodeClick={onNodeClick}
              onOpenFile={onOpenFile}
              onSelectFile={onSelectFile}
              onToggleFolder={onToggleFolder}
              selectedPath={selectedPath}
              selectedPaths={selectedPaths}
            />
          ))
        ) : (
          <div className="px-3 py-8 text-center text-sm text-slate-500">
            {isFilesLoading ? `正在加载${title}文件` : directory ? "当前文件夹暂无文件" : "未配置文件夹"}
          </div>
        )}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 w-56 rounded-md border bg-white p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.node?.type === "file" ? (
            <ContextMenuButton
              icon={<FileText className="size-4 text-[#2563eb]" />}
              label="打开"
              onClick={() => {
                onCloseContextMenu();
                onOpenFile(contextMenu.node!);
              }}
            />
          ) : null}
          {contextMenu.node ? (
            <ContextMenuButton
              icon={<FolderOpen className="size-4 text-[#3b82f6]" />}
              label="在资源管理器中显示"
              onClick={() => {
                onCloseContextMenu();
                onRevealPath(contextMenu.node!);
              }}
            />
          ) : null}
          <ContextMenuButton
            icon={<FileText className="size-4 text-[#2563eb]" />}
            label="新建文件"
            onClick={() => void onCreateFile(contextMenu.node)}
          />
          <ContextMenuButton
            icon={<Folder className="size-4 text-[#3b82f6]" />}
            label="新建文件夹"
            onClick={() => void onCreateFolder(contextMenu.node)}
          />
          <ContextMenuButton
            icon={<Upload className="size-4 text-[#1d4ed8]" />}
            label="上传到此处"
            onClick={() => onChooseUploadFiles(contextMenu.node)}
          />
          {contextMenu.node ? (
            <>
              <div className="my-1 h-px bg-slate-100" />
              <ContextMenuButton
                icon={<Copy className="size-4 text-slate-500" />}
                label="复制路径"
                onClick={() => onCopyNodePath(contextMenu.node!, "absolute")}
              />
              <ContextMenuButton
                icon={<Copy className="size-4 text-slate-500" />}
                label="复制相对路径"
                onClick={() => onCopyNodePath(contextMenu.node!, "relative")}
              />
              <ContextMenuButton
                icon={<PenLine className="size-4 text-[#1d4ed8]" />}
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      className={`flex h-9 w-full items-center gap-2 rounded px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 ${className ?? ""}`.trim()}
      type="button"
      {...props}
    >
      {icon}
      {label}
    </button>
  );
}
