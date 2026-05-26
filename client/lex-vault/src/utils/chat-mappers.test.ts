import { describe, expect, it } from "vitest";

import {
  appendMessageToAttachments,
  appendMessageToInputAttachments,
  appendMessageToText,
  latestAssistantIdAfterLatestUser,
} from "@/utils/chat-mappers";

describe("chat-mappers", () => {
  it("keeps prompt text clean and converts browser files into structured attachment payloads", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const message = {
      content: [{ type: "text", text: "请看附件" }],
      attachments: [{
        id: "attachment-1",
        name: "note.txt",
        type: "document",
        contentType: "text/plain",
        file,
        status: { type: "complete" },
        content: [],
      }],
    } as unknown as Parameters<typeof appendMessageToText>[0];

    expect(appendMessageToText(message)).toBe("请看附件");

    const attachments = await appendMessageToInputAttachments(message);
    expect(attachments).toEqual([{
      id: "attachment-1",
      name: "note.txt",
      kind: "document",
      source: "composer",
      mimeType: "text/plain",
      size: 5,
      path: undefined,
      url: undefined,
      bytes: Array.from(new TextEncoder().encode("hello")),
    }]);

    expect(appendMessageToAttachments(message)).toEqual([{
      id: "attachment-1",
      name: "note.txt",
      type: "document",
      contentType: "text/plain",
      size: 5,
      url: undefined,
      thumbnailUrl: undefined,
      path: undefined,
      rootPath: undefined,
      relativePath: undefined,
      nodeType: undefined,
      sourceLabel: undefined,
    }]);
  });

  it("keeps runtime image thumbnail urls only in the visible attachment summary", () => {
    const message = {
      content: [{ type: "text", text: "图中是什么" }],
      attachments: [{
        id: "image-1",
        name: "image.png",
        type: "image",
        contentType: "image/png",
        thumbnailUrl: "blob:lex-vault-image",
        status: { type: "complete" },
        content: [],
      }],
    } as unknown as Parameters<typeof appendMessageToText>[0];

    expect(appendMessageToAttachments(message)).toEqual([{
      id: "image-1",
      name: "image.png",
      type: "image",
      contentType: "image/png",
      size: undefined,
      url: undefined,
      thumbnailUrl: "blob:lex-vault-image",
      path: undefined,
      rootPath: undefined,
      relativePath: undefined,
      nodeType: undefined,
      sourceLabel: undefined,
    }]);
  });

  it("does not treat the previous assistant message as the active running reply for a new round", () => {
    expect(latestAssistantIdAfterLatestUser([
      {
        id: "user-1",
        role: "user",
        content: "上一轮问题",
        createdAt: "2026-05-26T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "上一轮回答",
        createdAt: "2026-05-26T10:00:05.000Z",
      },
      {
        id: "user-2",
        role: "user",
        content: "下一轮问题",
        createdAt: "2026-05-26T10:01:00.000Z",
      },
    ] as never[])).toBeUndefined();

    expect(latestAssistantIdAfterLatestUser([
      {
        id: "user-1",
        role: "user",
        content: "上一轮问题",
        createdAt: "2026-05-26T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "上一轮回答",
        createdAt: "2026-05-26T10:00:05.000Z",
      },
      {
        id: "user-2",
        role: "user",
        content: "下一轮问题",
        createdAt: "2026-05-26T10:01:00.000Z",
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "",
        createdAt: "2026-05-26T10:01:02.000Z",
      },
    ] as never[])).toBe("assistant-2");
  });
});
