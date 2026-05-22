import type { FileNode } from "@/types/domain";
import type { FileSortState } from "@/utils/file-tree";

/** 案件材料右键菜单状态。 */
export type CaseFileContextMenu = {
  /** 菜单左上角视口横坐标。 */
  x: number;
  /** 菜单左上角视口纵坐标。 */
  y: number;
  /** 右键命中的文件树节点，空白区域菜单为 null。 */
  node: FileNode | null;
};

/** 读取案件文件树排序设置。 */
export function readCaseSortState(): FileSortState {
  try {
    const value = JSON.parse(window.localStorage.getItem("lex-vault-file-sort-case") ?? "");
    if (isFileSortState(value)) {
      return value;
    }
  } catch {
    // localStorage 中的旧值无法解析时使用默认排序。
  }
  return { key: "name", direction: "asc" };
}

/** 校验案件文件树排序配置。 */
export function isFileSortState(value: unknown): value is FileSortState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    ["name", "type", "size", "modifiedAt"].includes(String(record.key)) &&
    ["asc", "desc"].includes(String(record.direction))
  );
}

/** 按可见顺序生成 Shift 多选区间。 */
export function rangePaths(nodes: FileNode[], fromPath: string, toPath: string) {
  const fromIndex = nodes.findIndex((node) => node.path === fromPath);
  const toIndex = nodes.findIndex((node) => node.path === toPath);
  if (fromIndex < 0 || toIndex < 0) {
    return [toPath];
  }
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return nodes.slice(start, end + 1).map((node) => node.path);
}

/** 提取相对路径最后一段。 */
export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 校验拖放目标不会形成自包含目录。 */
export function canDropPath(path: string, parent: string | null) {
  return !parent || (path !== parent && !parent.startsWith(`${path}/`));
}

/** 根据路径查找当前可见节点。 */
export function nodeFromPath(nodes: FileNode[], path: string) {
  return nodes.find((node) => node.path === path) ?? null;
}
