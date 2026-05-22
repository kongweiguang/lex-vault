/** 获取业务相对路径的父级路径，根级文件返回 null。 */
export function parentPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? null : normalized.slice(0, index);
}

/** 拼接业务相对路径，并清理用户输入中的多余分隔符。 */
export function joinFilePath(parent: string | null, name: string) {
  const safeName = name.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  return parent ? parent + "/" + safeName : safeName;
}
