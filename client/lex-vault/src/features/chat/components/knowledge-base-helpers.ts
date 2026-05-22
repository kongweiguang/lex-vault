import type { FileNode, LibraryKey } from "@/types/domain";

/** 知识库文件来源，保持与本地文件库配置项一致。 */
export type KnowledgeBaseSource = {
  /** 文件库稳定标识。 */
  key: LibraryKey;
  /** 文件库用户可见名称。 */
  label: string;
  /** 文件库根目录绝对路径。 */
  rootPath: string;
  /** 文件库当前文件树。 */
  nodes: FileNode[];
  /** 文件库是否正在刷新。 */
  loading: boolean;
};

/** 知识库检索结果，保留来源和原始文件节点。 */
export type KnowledgeBaseSearchItem = {
  /** 文件库稳定标识。 */
  sourceKey: LibraryKey;
  /** 文件库用户可见名称。 */
  sourceLabel: string;
  /** 文件库根目录绝对路径。 */
  rootPath: string;
  /** 文件节点展示名称。 */
  name: string;
  /** 文件节点相对路径。 */
  path: string;
  /** 文件节点类型。 */
  type: FileNode["type"];
  /** 文件扩展名。 */
  extension?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
};

/** 知识库当前文件夹下可直接展示的节点。 */
export type KnowledgeBaseBrowseItem = {
  /** 文件库稳定标识。 */
  sourceKey: LibraryKey;
  /** 文件库用户可见名称。 */
  sourceLabel: string;
  /** 文件库根目录绝对路径。 */
  rootPath: string;
  /** 文件节点展示名称。 */
  name: string;
  /** 文件节点相对路径。 */
  path: string;
  /** 文件节点类型。 */
  type: FileNode["type"];
  /** 文件扩展名。 */
  extension?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
  /** 原始文件树节点。 */
  node: FileNode;
};

/** 将三个文件库的树形结构拍平成可检索列表。 */
export function flattenKnowledgeBaseSources(sources: KnowledgeBaseSource[]) {
  const items: KnowledgeBaseSearchItem[] = [];

  const walk = (source: KnowledgeBaseSource, nodes: FileNode[]) => {
    nodes.forEach((node) => {
      items.push({
        sourceKey: source.key,
        sourceLabel: source.label,
        rootPath: source.rootPath,
        name: node.name,
        path: node.path,
        type: node.type,
        extension: node.extension,
        size: node.size,
      });
      if (node.children?.length) {
        walk(source, node.children);
      }
    });
  };

  sources.forEach((source) => walk(source, source.nodes));
  return items;
}

/** 按来源、名称和相对路径检索知识库条目。 */
export function filterKnowledgeBaseItems(items: KnowledgeBaseSearchItem[], query: string, sourceKey: LibraryKey | "all") {
  const keyword = query.trim().toLowerCase();
  return items.filter((item) => {
    if (sourceKey !== "all" && item.sourceKey !== sourceKey) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return (
      item.name.toLowerCase().includes(keyword) ||
      item.path.toLowerCase().includes(keyword) ||
      item.sourceLabel.toLowerCase().includes(keyword)
    );
  });
}

/** 在文件树中按相对路径查找文件夹节点。 */
export function findKnowledgeBaseNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const matched = node.children ? findKnowledgeBaseNode(node.children, path) : null;
    if (matched) {
      return matched;
    }
  }
  return null;
}

/** 读取某个知识库来源指定文件夹下的直接子项。 */
export function listKnowledgeBaseFolderItems(source: KnowledgeBaseSource, folderPath: string | null) {
  const nodes = folderPath
    ? findKnowledgeBaseNode(source.nodes, folderPath)?.children ?? []
    : source.nodes;

  return [...nodes]
    .sort(compareKnowledgeBaseNodes)
    .map<KnowledgeBaseBrowseItem>((node) => ({
      sourceKey: source.key,
      sourceLabel: source.label,
      rootPath: source.rootPath,
      name: node.name,
      path: node.path,
      type: node.type,
      extension: node.extension,
      size: node.size,
      node,
    }));
}

function compareKnowledgeBaseNodes(left: FileNode, right: FileNode) {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
}
