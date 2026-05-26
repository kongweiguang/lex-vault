import { describe, expect, it } from "vitest";

import { previewKind } from "@/components/files/FilePreviewPanel";

describe("FilePreviewPanel helpers", () => {
  it("maps jit-viewer supported binary formats to unified preview", () => {
    expect(previewKind("docx", false)).toBe("jit-viewer");
    expect(previewKind("pdf", false)).toBe("jit-viewer");
    expect(previewKind("xlsx", false)).toBe("jit-viewer");
    expect(previewKind("pptx", false)).toBe("jit-viewer");
    expect(previewKind("png", false)).toBe("jit-viewer");
    expect(previewKind("mp4", false)).toBe("jit-viewer");
    expect(previewKind("mp3", false)).toBe("jit-viewer");
    expect(previewKind("ofd", false)).toBe("jit-viewer");
    expect(previewKind("dxf", false)).toBe("jit-viewer");
  });

  it("prefers backend preview kind for jit-viewer preview", () => {
    expect(previewKind("docx", false, "jit-viewer")).toBe("jit-viewer");
  });

  it("keeps markdown fallback for text previews when backend kind is absent", () => {
    expect(previewKind("md", true)).toBe("markdown");
  });

  it("keeps plain text fallback for text files without markdown extension", () => {
    expect(previewKind("txt", true)).toBe("text");
    expect(previewKind("html", true)).toBe("text");
    expect(previewKind("csv", true)).toBe("text");
  });

  it("falls back to external for unsupported binary formats", () => {
    expect(previewKind("bin", false)).toBe("external");
  });
});


