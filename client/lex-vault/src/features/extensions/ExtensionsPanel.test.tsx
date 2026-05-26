import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExtensionsPanel } from "@/features/extensions/ExtensionsPanel";
import type { CodexPluginListResult } from "@/types/codex";

const PLUGIN_LIST: CodexPluginListResult = {
  marketplaces: [
    {
      name: "custom-market",
      path: "C:\\Users\\24052\\plugins\\custom-market",
      source: "local",
      pluginCount: 1,
    },
    {
      name: "openai-primary-runtime",
      path: "C:\\runtime\\plugins\\openai-primary-runtime",
      source: "local",
      pluginCount: 2,
    },
  ],
  plugins: [
    {
      id: "custom-plugin@custom-market",
      name: "Custom Plugin",
      pluginName: "custom-plugin",
      marketplaceName: "custom-market",
      marketplacePath: "C:\\Users\\24052\\plugins\\custom-market",
      mentionPath: "plugin://custom-plugin@custom-market",
      description: "custom",
      category: "Productivity",
      availability: "AVAILABLE",
      installed: true,
      enabled: true,
    },
    {
      id: "documents@openai-primary-runtime",
      name: "Documents",
      pluginName: "documents",
      marketplaceName: "openai-primary-runtime",
      marketplacePath: "C:\\runtime\\plugins\\openai-primary-runtime",
      mentionPath: "plugin://documents@openai-primary-runtime",
      description: "system",
      category: "Productivity",
      availability: "AVAILABLE",
      installed: true,
      enabled: true,
    },
    {
      id: "browser@openai-primary-runtime",
      name: "Browser",
      pluginName: "browser",
      marketplaceName: "openai-primary-runtime",
      marketplacePath: "C:\\runtime\\plugins\\openai-primary-runtime",
      mentionPath: "plugin://browser@openai-primary-runtime",
      description: "browser",
      category: "Engineering",
      availability: "AVAILABLE",
      installed: false,
      enabled: false,
    },
  ],
  marketplaceLoadErrors: [],
  featuredPluginIds: [],
};

describe("ExtensionsPanel", () => {
  it("renders custom plugins before system plugins and hides empty sections", () => {
    const markup = renderToStaticMarkup(
      <ExtensionsPanel
        mode="插件"
        onRefreshPlugins={async () => undefined}
        pluginList={PLUGIN_LIST}
      />,
    );

    expect(markup).toContain("刷新插件");
    expect(markup).toContain("自定义插件");
    expect(markup).toContain("系统预装插件");
    expect(markup).toContain("安装");
    expect(markup).toContain("启用");
    expect(markup.indexOf("自定义插件")).toBeLessThan(markup.indexOf("系统预装插件"));
  });
});
