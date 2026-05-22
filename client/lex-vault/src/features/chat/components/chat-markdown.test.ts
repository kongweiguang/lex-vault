import { describe, expect, it } from "vitest";

import {
  markdownPathPreviewAttachment,
  normalizeExternalUrl,
  normalizeMarkdownFilePath,
} from "@/features/chat/components/chat-markdown";

describe("chat-markdown helpers", () => {
  it("keeps local file links on the native preview path", () => {
    expect(normalizeMarkdownFilePath("file:///C:/workspace/demo.txt")).toBe("C:/workspace/demo.txt");
    expect(markdownPathPreviewAttachment("/C:/workspace/demo.txt", "演示文件")?.name).toBe("演示文件");
  });

  it("normalizes external http links for the system browser", () => {
    expect(normalizeExternalUrl("https://www.npc.gov.cn/example")).toBe("https://www.npc.gov.cn/example");
    expect(normalizeExternalUrl("mailto:test@example.com")).toBeNull();
  });

  it("keeps markdown http links normalized for direct browser opening", () => {
    expect(normalizeExternalUrl("https://wenshu.court.gov.cn/")).toBe("https://wenshu.court.gov.cn/");
  });
});
