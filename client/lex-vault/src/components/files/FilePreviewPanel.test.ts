import { describe, expect, it } from "vitest";

import { previewKind } from "@/components/files/FilePreviewPanel";

describe("FilePreviewPanel helpers", () => {
  it("keeps docx extension mapped to docx preview fallback", () => {
    expect(previewKind("docx", false)).toBe("docx");
  });

  it("prefers backend preview kind for docx preview", () => {
    expect(previewKind("docx", false, "docx")).toBe("docx");
  });

  it("keeps markdown fallback for text previews when backend kind is absent", () => {
    expect(previewKind("md", true)).toBe("markdown");
  });

  it("falls back to external for unsupported binary formats", () => {
    expect(previewKind("bin", false)).toBe("external");
  });
});


