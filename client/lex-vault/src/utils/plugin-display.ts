/**
 * 预设 marketplace 的用户可见中文展示信息。
 */
const MARKETPLACE_DISPLAY: Record<string, { title: string; description: string }> = {
  "openai-primary-runtime": {
    title: "Agent 文档能力",
    description: "面向文档、表格和演示材料的内置能力。",
  },
  "openai-curated": {
    title: "Agent 扩展市场",
    description: "可按需启用的扩展能力集合。",
  },
};

/**
 * 普通用户界面中不展示的底层 marketplace。
 */
const HIDDEN_MARKETPLACES = new Set(["openai-curated"]);

/**
 * 系统预装插件所在的 marketplace。
 */
const SYSTEM_MARKETPLACES = new Set(["openai-primary-runtime"]);

/**
 * 预设插件的用户可见中文展示信息。
 */
const PLUGIN_DISPLAY: Record<string, { title: string; description: string; category?: string }> = {
  "documents@openai-primary-runtime": {
    title: "文档处理",
    description: "用于起草、整理和编辑文档内容，适合合同、函件和说明材料。",
    category: "文档",
  },
  "spreadsheets@openai-primary-runtime": {
    title: "表格处理",
    description: "用于整理表格、统计数据和生成电子表格内容。",
    category: "表格",
  },
  "presentations@openai-primary-runtime": {
    title: "演示文稿",
    description: "用于整理汇报材料、生成演示页和优化展示结构。",
    category: "演示",
  },
};

/**
 * 返回 marketplace 的用户可见标题，避免在界面上直接暴露底层 `openai-*` 标识。
 */
export function presentMarketplaceName(marketplaceName: string) {
  return MARKETPLACE_DISPLAY[marketplaceName]?.title ?? marketplaceName.replace(/^openai-/, "Agent ");
}

/**
 * 返回 marketplace 的补充说明，用于右侧状态区或卡片辅助文案。
 */
export function presentMarketplaceDescription(marketplaceName: string) {
  return MARKETPLACE_DISPLAY[marketplaceName]?.description ?? "系统已接入的插件能力分组。";
}

/**
 * 返回插件的中文标题；未命中映射时回退后端返回名称。
 */
export function presentPluginName(pluginId: string, fallbackName: string) {
  return PLUGIN_DISPLAY[pluginId]?.title ?? fallbackName;
}

/**
 * 返回插件的中文说明；未命中映射时回退后端返回说明。
 */
export function presentPluginDescription(pluginId: string, fallbackDescription?: string) {
  return PLUGIN_DISPLAY[pluginId]?.description ?? fallbackDescription ?? "该能力已接入当前助手，可在会话中直接调用。";
}

/**
 * 返回插件分类的中文标签。
 */
export function presentPluginCategory(
  pluginId: string,
  fallbackCategory?: string,
) {
  return PLUGIN_DISPLAY[pluginId]?.category ?? fallbackCategory ?? "通用";
}

/**
 * 插件在普通用户界面的来源分组。
 */
export type PluginSourceGroup = "custom" | "system";

/**
 * marketplace 在普通用户界面的可见性分类。
 */
export type PluginMarketplaceVisibility = PluginSourceGroup | "hidden";

/**
 * 统一判断 marketplace 在界面上的来源归属。
 */
export function classifyPluginMarketplace(marketplaceName: string): PluginMarketplaceVisibility {
  if (HIDDEN_MARKETPLACES.has(marketplaceName)) {
    return "hidden";
  }
  if (SYSTEM_MARKETPLACES.has(marketplaceName)) {
    return "system";
  }
  return "custom";
}

/**
 * 返回插件来源分组的中文标题。
 */
export function presentPluginSourceGroupLabel(sourceGroup: PluginSourceGroup) {
  return sourceGroup === "custom" ? "自定义插件" : "系统预装插件";
}

/**
 * 判断某个 marketplace 是否应该出现在普通用户界面。
 */
export function shouldExposeMarketplaceInUi(marketplaceName: string) {
  return classifyPluginMarketplace(marketplaceName) !== "hidden";
}

/**
 * 判断某个插件是否应该出现在普通用户界面。
 */
export function shouldExposePluginInUi(marketplaceName: string) {
  return shouldExposeMarketplaceInUi(marketplaceName);
}
