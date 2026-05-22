/**
 * 构造发给 plugin-creator 的任务提示，固定说明 home-local 创建位置。
 */
export function buildPluginCreatorPrompt(request: string) {
  const normalizedRequest = request.trim();
  return [
    "请使用 $plugin-creator 创建一个新的本地插件。",
    `用户需求：${normalizedRequest}`,
    "默认创建方式使用 home-local：",
    "- 插件目录父路径：~/plugins",
    "- marketplace 文件：~/.agents/plugins/marketplace.json",
    "如果插件名称、目录结构或 marketplace 细节仍不明确，请先追问用户后再生成。",
  ].join("\n");
}
