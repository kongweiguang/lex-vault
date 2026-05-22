import { LAW_REPOSITORY_BASE_URL, LAW_REPOSITORY_INDEX_URL } from "@/config/runtime";
import { downloadRemoteFileToLibrary, fetchRemoteLawIndex } from "@/services/native-file-service";
import type { FileNode, RemoteLawDirectory, RemoteLawDownloadResult, RemoteLawEntry, RemoteLawIndex } from "@/types/domain";

/** 远程法规索引原始条目，兼容服务端生成脚本可能省略 downloadUrl 的情况。 */
type RawRemoteLawEntry = Omit<RemoteLawEntry, "downloadUrl"> & {
  /** 可直接下载法规正文的绝对或相对地址。 */
  downloadUrl?: string;
};

/** 远程法规索引原始结构，读取后会统一补齐下载地址和分类计数。 */
type RawRemoteLawIndex = Omit<RemoteLawIndex, "entries"> & {
  /** 可下载法规条目列表。 */
  entries: RawRemoteLawEntry[];
  /** 远程法规目录树，旧索引可能没有该字段。 */
  directoryTree?: RemoteLawDirectory[];
};

/** 读取远程法规库索引，并补齐前端展示需要的稳定字段。 */
export async function fetchLawIndex(forceRefresh = false): Promise<RemoteLawIndex> {
  const payload = await fetchRemoteLawIndex(LAW_REPOSITORY_INDEX_URL, forceRefresh);
  const rawIndex = JSON.parse(payload.content) as RawRemoteLawIndex;
  const baseUrl = trimTrailingSlash(rawIndex.baseUrl || LAW_REPOSITORY_BASE_URL);
  const entries = (rawIndex.entries ?? []).map((entry) => normalizeLawEntry(entry, baseUrl));
  const categoryCount = entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    return counts;
  }, {});
  const categories = (rawIndex.categories ?? []).map((category) => ({
    ...category,
    count: category.count ?? categoryCount[category.name] ?? 0,
  }));

  return {
    version: rawIndex.version,
    generatedAt: rawIndex.generatedAt,
    baseUrl,
    categories,
    directoryTree: rawIndex.directoryTree ?? buildDirectoryTree(entries),
    entries,
    cached: payload.cached,
    cachedAt: payload.cachedAt,
  };
}

/** 下载远程法规到当前本地法规目录，默认保留远程分类目录结构。 */
export function downloadLawToLibrary(rootPath: string, entry: RemoteLawEntry) {
  return downloadRemoteFileToLibrary(rootPath, entry.path, entry.downloadUrl);
}

/** 判断本地法规文件树中是否已经存在远程法规条目。 */
export function isRemoteLawDownloaded(fileNodes: FileNode[], entry: RemoteLawEntry) {
  return collectFilePaths(fileNodes).has(normalizeRelativePath(entry.path));
}

/** 将下载结果归一化为法规目录内的相对路径。 */
export function normalizeLawDownloadResult(result: RemoteLawDownloadResult) {
  return normalizeRelativePath(result.path);
}

function normalizeLawEntry(entry: RawRemoteLawEntry, baseUrl: string): RemoteLawEntry {
  const path = normalizeRelativePath(entry.path);
  return {
    ...entry,
    path,
    fileType: entry.fileType || fileTypeFromPath(path),
    downloadUrl: absoluteDownloadUrl(entry.downloadUrl || path, baseUrl),
  };
}

/** 旧版索引没有 directoryTree 时，根据 path 还原目录结构以保持浏览体验一致。 */
function buildDirectoryTree(entries: RemoteLawEntry[]) {
  type MutableDirectory = RemoteLawDirectory & {
    children: MutableDirectory[];
    childMap: Map<string, MutableDirectory>;
  };

  const root: MutableDirectory = {
    name: "",
    path: "",
    count: 0,
    children: [],
    childMap: new Map(),
  };

  entries.forEach((entry) => {
    const parts = normalizeRelativePath(entry.path).split("/").slice(0, -1);
    let current = root;
    current.count += 1;

    parts.forEach((part, index) => {
      let child = current.childMap.get(part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          count: 0,
          children: [],
          childMap: new Map(),
        };
        current.childMap.set(part, child);
        current.children.push(child);
      }
      child.count += 1;
      current = child;
    });
  });

  const serialize = (node: MutableDirectory): RemoteLawDirectory => ({
    name: node.name,
    path: node.path,
    count: node.count,
    children: node.children
      .sort((first, second) => first.name.localeCompare(second.name, "zh-CN"))
      .map(serialize),
  });

  return root.children
    .sort((first, second) => first.name.localeCompare(second.name, "zh-CN"))
    .map(serialize);
}

function collectFilePaths(nodes: FileNode[]) {
  const paths = new Set<string>();
  const visit = (node: FileNode) => {
    if (node.type === "file") {
      paths.add(normalizeRelativePath(node.path));
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

function absoluteDownloadUrl(url: string, baseUrl: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${trimTrailingSlash(baseUrl)}/${encodeRelativeUrlPath(url)}`;
}

function encodeRelativeUrlPath(path: string) {
  return normalizeRelativePath(path).split("/").map(encodeURIComponent).join("/");
}

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function fileTypeFromPath(path: string) {
  return path.split(".").pop()?.toLowerCase();
}
