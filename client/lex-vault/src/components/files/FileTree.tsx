import type { DragEvent, MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { FileNode } from "@/types/domain";

export function FileIcon({ node, expanded }: { node: FileNode; expanded?: boolean }) {
  const extension = node.extension?.toLowerCase();

  if (node.type === "folder") {
    const FolderIcon = expanded ? FolderOpen : Folder;
    return <FolderIcon className="size-4 text-[#3b82f6]" />;
  }

  if (extension === "xlsx" || extension === "xls" || extension === "csv") {
    return <FileSpreadsheet className="size-4 text-emerald-600" />;
  }

  return <FileText className="size-4 text-[#2563eb]" />;
}


export function FileTreeItem({
  node,
  depth = 0,
  selectedPath,
  selectedPaths,
  onSelectFile,
  onOpenFile,
  expandedPaths,
  onToggleFolder,
  onContextMenu,
  onNodeClick,
  onDragStart,
  onDragOverNode,
  onDropOnNode,
}: {
  node: FileNode;
  depth?: number;
  selectedPath?: string | null;
  selectedPaths?: Set<string>;
  onSelectFile?: (node: FileNode) => void;
  onOpenFile?: (node: FileNode) => void;
  expandedPaths: Set<string>;
  onToggleFolder?: (node: FileNode) => void;
  onContextMenu?: (event: MouseEvent, node: FileNode) => void;
  onNodeClick?: (event: MouseEvent, node: FileNode) => void;
  onDragStart?: (event: DragEvent, node: FileNode) => void;
  onDragOverNode?: (event: DragEvent, node: FileNode) => void;
  onDropOnNode?: (event: DragEvent, node: FileNode) => void;
}) {
  const isFolder = node.type === "folder";
  const hasChildren = Boolean(node.children?.length);
  const expanded = isFolder && expandedPaths.has(node.path);
  const isSelected = selectedPaths?.has(node.path) ?? (!isFolder && node.path === selectedPath);
  const dropPath = isFolder ? node.path : node.path.includes("/") ? node.path.replace(/[/\\][^/\\]+$/, "") : "";

  return (
    <div className="relative">
      <button
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50",
          isSelected && "bg-blue-50 text-[#1d4ed8]",
        )}
        onClick={(event) => {
          onNodeClick?.(event, node);
          if (isFolder) {
            onToggleFolder?.(node);
            return;
          }
          onSelectFile?.(node);
        }}
        onContextMenu={(event) => onContextMenu?.(event, node)}
        onDoubleClick={() => {
          if (!isFolder) {
            onOpenFile?.(node);
          }
        }}
        data-file-node-path={node.path}
        data-file-drop-path={dropPath}
        draggable
        onDragOver={(event) => onDragOverNode?.(event, node)}
        onDragStart={(event) => onDragStart?.(event, node)}
        onDrop={(event) => onDropOnNode?.(event, node)}
        style={{ paddingLeft: 8 + depth * 24 }}
        type="button"
      >
        {isFolder ? (
          expanded ? (
            <ChevronDown className="size-3 text-slate-500" />
          ) : (
            <ChevronRight className="size-3 text-slate-500" />
          )
        ) : null}
        <FileIcon expanded={expanded} node={node} />
        <span className="truncate">{node.name}</span>
      </button>

      {expanded && hasChildren ? (
        <div className="relative">
          <div
            className="absolute bottom-1 top-0 w-px bg-slate-200"
            style={{ left: 11 + depth * 24 }}
          />
          <div className="space-y-1 py-1">
            {node.children?.map((child) => (
              <FileTreeItem
                depth={depth + 1}
                key={child.path}
                node={child}
                expandedPaths={expandedPaths}
                onContextMenu={onContextMenu}
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
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
