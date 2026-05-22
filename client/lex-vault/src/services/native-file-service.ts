import { invoke } from "@tauri-apps/api/core";

import type { FileContent, FileNode, RemoteLawDownloadResult, RemoteLawIndexPayload } from "@/types/domain";
import { joinFilePath } from "@/utils/file-path";

/** Windows 盘符绝对路径匹配。 */
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

/** UNC 网络路径匹配。 */
const UNC_PATH_PATTERN = /^\\\\/;

/** 路径分隔符匹配，用于兼容后端返回的正斜杠和 Windows 反斜杠。 */
const PATH_SEPARATOR_PATTERN = /[\\/]+/;

/** 判断路径是否已经是本机绝对路径。 */
function isAbsolutePath(path: string) {
  return (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(path) ||
    UNC_PATH_PATTERN.test(path) ||
    path.startsWith("/")
  );
}

/** 移除路径末尾分隔符，避免拼接时出现重复分隔。 */
function trimTrailingSeparators(path: string) {
  return path.replace(/[\\/]+$/, "");
}

/** 移除相对路径开头分隔符，确保拼接结果仍位于业务根目录下。 */
function trimLeadingSeparators(path: string) {
  return path.replace(/^[\\/]+/, "");
}

/** 根据业务根目录和文件相对路径解析为可交给系统打开的本机路径。 */
export function resolveNativeFilePath(rootPath: string, filePath: string) {
  const normalizedFilePath = filePath.trim();
  if (isAbsolutePath(normalizedFilePath)) {
    return normalizedFilePath;
  }

  const normalizedRoot = trimTrailingSeparators(rootPath.trim());
  const normalizedRelativePath = trimLeadingSeparators(normalizedFilePath);
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  return [normalizedRoot, ...normalizedRelativePath.split(PATH_SEPARATOR_PATTERN)]
    .filter(Boolean)
    .join(separator);
}

/** 调用桌面端命令，让操作系统使用默认程序打开本机文件。 */
export async function openNativeFile(rootPath: string, filePath: string) {
  return invoke<void>("open_native_file", { rootPath, path: filePath });
}

/** 调用桌面端命令，让当前平台文件管理器打开本机目录。 */
export async function openNativeDirectory(directoryPath: string) {
  return invoke<void>("open_native_directory", { directoryPath });
}

/** 调用桌面端命令，让当前平台文件管理器打开文件夹或定位文件。 */
export async function revealNativePath(rootPath: string, filePath: string) {
  return invoke<void>("reveal_native_path", { rootPath, path: filePath });
}

/** 读取本机目录文件树。 */
export function listNativeFiles(rootPath: string) {
  return invoke<FileNode[]>("list_native_files", { rootPath });
}

/** 读取本机文件预览内容。 */
export function readNativeFile(rootPath: string, path: string) {
  return invoke<FileContent>("read_native_file", { rootPath, path });
}

/** 创建本机文本文件。 */
export function createNativeFile(rootPath: string, path: string, content = "") {
  return invoke<void>("create_native_file", { rootPath, path, content });
}

/** 创建本机文件夹。 */
export function createNativeFolder(rootPath: string, path: string) {
  return invoke<void>("create_native_folder", { rootPath, path });
}

/** 重命名或移动本机文件/文件夹。 */
export function renameNativePath(rootPath: string, path: string, newPath: string) {
  return invoke<void>("rename_native_path", { rootPath, path, newPath });
}

/** 复制本机文件/文件夹，后端会在目标重名时自动生成可用名称。 */
export function copyNativePath(rootPath: string, path: string, newPath: string) {
  return invoke<string>("copy_native_path", { rootPath, path, newPath });
}

/** 删除本机文件或文件夹。 */
export function deleteNativePath(rootPath: string, path: string) {
  return invoke<void>("delete_native_path", { rootPath, path });
}

/** 将浏览器 File 对象写入本机目录。 */
export async function uploadNativeFile(
  rootPath: string,
  parentPath: string | null,
  file: File,
) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<void>("write_native_file", {
    rootPath,
    path: joinFilePath(parentPath, file.name),
    bytes,
  });
}

/** 将系统文件管理器拖入的本机文件或文件夹复制到业务目录。 */
export function importNativePaths(
  rootPath: string,
  parentPath: string | null,
  sourcePaths: string[],
) {
  return invoke<string[]>("import_native_paths", { rootPath, parentPath, sourcePaths });
}

/** 读取系统剪贴板中的文件列表，支持资源管理器复制文件后直接粘贴。 */
export function readClipboardFilePaths() {
  return invoke<string[]>("read_clipboard_file_paths");
}

/** 通过 Tauri 本机命令读取远程法规库索引，避免 WebView 跨域限制。 */
export function fetchRemoteLawIndex(indexUrl: string, forceRefresh = false) {
  return invoke<RemoteLawIndexPayload>("fetch_remote_law_index", { indexUrl, forceRefresh });
}

/** 从远程法规镜像下载单个法规文件到本机法规目录。 */
export function downloadRemoteFileToLibrary(
  rootPath: string,
  targetPath: string,
  downloadUrl: string,
) {
  return invoke<RemoteLawDownloadResult>("download_remote_file_to_library", {
    rootPath,
    targetPath,
    downloadUrl,
  });
}
