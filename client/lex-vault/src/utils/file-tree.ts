import type { FileNode } from "@/types/domain";

/** 文件树排序字段，覆盖常见文件管理器的名称、类型、大小和修改时间排序。 */
export type FileSortKey = "name" | "type" | "size" | "modifiedAt";

/** 文件树排序方向，asc 表示升序，desc 表示降序。 */
export type FileSortDirection = "asc" | "desc";

/** 文件树排序状态，目录始终优先于文件，字段只决定同类节点顺序。 */
export type FileSortState = {
  /** 当前排序字段。 */
  key: FileSortKey;
  /** 当前排序方向。 */
  direction: FileSortDirection;
};

/** 按文件名递归过滤文件树，同时保留命中的父级目录链。 */
export function filterFileNodes(nodes: FileNode[], query: string): FileNode[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return nodes;
  }

  return nodes.reduce<FileNode[]>((matched, node) => {
    const children = node.children ? filterFileNodes(node.children, keyword) : [];
    if (node.name.toLowerCase().includes(keyword) || children.length > 0) {
      matched.push({
        ...node,
        ...(children.length > 0 ? { children } : {}),
      });
    }
    return matched;
  }, []);
}

/** 按当前排序状态递归整理文件树，避免改变原始后端返回对象。 */
export function sortFileNodes(nodes: FileNode[], sort: FileSortState): FileNode[] {
  return [...nodes]
    .sort((left, right) => compareFileNodes(left, right, sort))
    .map((node) => ({
      ...node,
      children: node.children ? sortFileNodes(node.children, sort) : node.children,
    }));
}

/** 将树形节点展开为当前可见顺序，供 Shift 范围选择和全选复用。 */
export function visibleFileNodes(nodes: FileNode[], expandedPaths: Set<string>) {
  const result: FileNode[] = [];
  const walk = (items: FileNode[]) => {
    items.forEach((node) => {
      result.push(node);
      if (node.type === "folder" && node.children?.length && expandedPaths.has(node.path)) {
        walk(node.children);
      }
    });
  };
  walk(nodes);
  return result;
}

/** 递归收集树中所有文件夹路径，供“全部展开/全部收起”复用。 */
export function collectFolderPaths(nodes: FileNode[]) {
  const result: string[] = [];
  const walk = (items: FileNode[]) => {
    items.forEach((node) => {
      if (node.type === "folder") {
        result.push(node.path);
        if (node.children?.length) {
          walk(node.children);
        }
      }
    });
  };
  walk(nodes);
  return result;
}

function compareFileNodes(left: FileNode, right: FileNode, sort: FileSortState) {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }

  const direction = sort.direction === "asc" ? 1 : -1;
  if (sort.key === "size") {
    return ((left.size ?? 0) - (right.size ?? 0)) * direction || compareByName(left, right);
  }
  if (sort.key === "modifiedAt") {
    return (Number(left.modifiedAt ?? 0) - Number(right.modifiedAt ?? 0)) * direction || compareByName(left, right);
  }
  if (sort.key === "type") {
    return compareText(left.extension ?? left.type, right.extension ?? right.type) * direction || compareByName(left, right);
  }
  return compareByName(left, right) * direction;
}

function compareByName(left: FileNode, right: FileNode) {
  return compareText(left.name, right.name);
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}
