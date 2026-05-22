import { describe, expect, it } from "vitest";

import {
  classifyPluginMarketplace,
  presentPluginSourceGroupLabel,
  shouldExposeMarketplaceInUi,
} from "@/utils/plugin-display";

describe("plugin-display", () => {
  it("classifies system, custom and hidden marketplaces", () => {
    expect(classifyPluginMarketplace("openai-primary-runtime")).toBe("system");
    expect(classifyPluginMarketplace("my-local-market")).toBe("custom");
    expect(classifyPluginMarketplace("openai-curated")).toBe("hidden");
  });

  it("keeps hidden marketplaces out of the user interface", () => {
    expect(shouldExposeMarketplaceInUi("openai-primary-runtime")).toBe(true);
    expect(shouldExposeMarketplaceInUi("my-local-market")).toBe(true);
    expect(shouldExposeMarketplaceInUi("openai-curated")).toBe(false);
  });

  it("returns user-facing labels for plugin source groups", () => {
    expect(presentPluginSourceGroupLabel("custom")).toBe("自定义插件");
    expect(presentPluginSourceGroupLabel("system")).toBe("系统预装插件");
  });
});
