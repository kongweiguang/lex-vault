import { describe, expect, it } from "vitest";

import { groupChatPluginOptions } from "@/features/chat/components/chat-composer";
import type { ChatPluginOption } from "@/types/domain";

const PLUGIN_OPTIONS: ChatPluginOption[] = [
  {
    id: "custom-docs@local-market",
    name: "Custom Docs",
    mentionPath: "plugin://custom-docs@local-market",
    description: "custom",
    marketplaceName: "local-market",
    sourceGroup: "custom",
  },
  {
    id: "documents@openai-primary-runtime",
    name: "Documents",
    mentionPath: "plugin://documents@openai-primary-runtime",
    description: "system",
    marketplaceName: "openai-primary-runtime",
    sourceGroup: "system",
  },
];

describe("chat-composer plugin groups", () => {
  it("groups plugins by custom first and system second", () => {
    const groups = groupChatPluginOptions(PLUGIN_OPTIONS);

    expect(groups).toHaveLength(2);
    expect(groups[0].sourceGroup).toBe("custom");
    expect(groups[0].label).toBe("自定义插件");
    expect(groups[0].plugins.map((plugin) => plugin.id)).toEqual(["custom-docs@local-market"]);
    expect(groups[1].sourceGroup).toBe("system");
    expect(groups[1].label).toBe("系统预装插件");
    expect(groups[1].plugins.map((plugin) => plugin.id)).toEqual(["documents@openai-primary-runtime"]);
  });

  it("hides empty groups", () => {
    const groups = groupChatPluginOptions([PLUGIN_OPTIONS[1]]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sourceGroup).toBe("system");
  });
});
