import { describe, expect, it } from "vitest";

import { buildPluginCreatorPrompt } from "@/features/extensions/plugin-creation";

describe("plugin-creation", () => {
  it("builds a plugin-creator prompt with the home-local defaults", () => {
    const prompt = buildPluginCreatorPrompt("创建一个用于案件归档的插件");

    expect(prompt).toContain("$plugin-creator");
    expect(prompt).toContain("用户需求：创建一个用于案件归档的插件");
    expect(prompt).toContain("~/plugins");
    expect(prompt).toContain("~/.agents/plugins/marketplace.json");
  });
});
