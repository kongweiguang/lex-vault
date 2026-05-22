import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWechatThreadMessage,
  buildWechatChatResponseFromBridgeResponse,
  buildWechatUserMessage,
  createWechatLoginEvent,
  createWechatProactiveMessageEvent,
  createWechatThreadMessageEvent,
  isSupportedNodeVersion,
  looksLikeQrAscii,
  statusFromSdkText,
} from "../resources/wechat/login-helper.mjs";

test("wechat helper validates Node.js 22 or newer", () => {
  assert.equal(isSupportedNodeVersion("22.0.0"), true);
  assert.equal(isSupportedNodeVersion("21.9.0"), false);
});

test("wechat helper maps SDK status text to stable frontend states", () => {
  assert.equal(statusFromSdkText("等待扫码，请打开微信")?.status, "waiting");
  assert.equal(statusFromSdkText("已扫码，请继续确认")?.status, "scanned");
  assert.equal(statusFromSdkText("二维码已过期，请刷新")?.status, "expired");
});

test("wechat helper keeps success and failure events in JSON-line shape", () => {
  assert.deepEqual(createWechatLoginEvent({ status: "connected", message: "ok", accountId: "wx-1" }), {
    type: "wechat-login",
    status: "connected",
    message: "ok",
    accountId: "wx-1",
  });
  assert.deepEqual(createWechatLoginEvent({ status: "failed", message: "boom" }), {
    type: "wechat-login",
    status: "failed",
    message: "boom",
  });
});

test("wechat helper keeps thread bridge requests in JSON-line shape", () => {
  const message = buildWechatThreadMessage("wx-room-1", {
    text: "帮我整理一下",
    roomTopic: "案件讨论群",
    senderName: "张三",
  });

  assert.deepEqual(createWechatThreadMessageEvent({ requestId: "req-1", message }), {
    type: "wechat-thread-message",
    requestId: "req-1",
    message: {
      conversationId: "wx-room-1",
      messageId: "",
      text: "帮我整理一下",
      rawText: "帮我整理一下",
      contactName: "",
      senderName: "张三",
      roomTopic: "案件讨论群",
      isRoom: true,
      timestamp: "",
      media: null,
    },
  });
});

test("wechat helper keeps proactive message requests in JSON-line shape", () => {
  assert.deepEqual(createWechatProactiveMessageEvent({ text: "日历提醒：明天开庭" }), {
    type: "wechat-proactive-message",
    text: "日历提醒：明天开庭",
  });
});

test("wechat helper detects terminal QR ascii blocks", () => {
  const qrLikeAscii = Array.from({ length: 10 }, () => "█".repeat(18)).join("\n");
  const qrTerminalLikeAscii = [
    "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
    "█ ▄▄▄▄▄ █▀▀▄█ ▄▄▄▄▄ █",
    "█ █   █ █▄▀██ █   █ █",
    "█ █▄▄▄█ █ ▄██ █▄▄▄█ █",
    "█▄▄▄▄▄▄▄█ █ █▄▄▄▄▄▄▄█",
    "█ ▄▄  ▄▄ ▀▀▄ █▀█ ▄▀▄█",
    "█▀ ▀▄▀▄█▄█▀▄ ▄ ▀ ▄▀██",
    "█ ▄▄▄▄▄ █▄ ▄▄▀█▄█ ▄▄█",
    "█ █   █ █▀▄█  ▄▀▄█▄▄█",
    "█▄▄▄▄▄▄▄█▄▄█▄██▄█▄▄▄█",
  ].join("\n");

  assert.equal(looksLikeQrAscii(qrLikeAscii), true);
  assert.equal(looksLikeQrAscii(qrTerminalLikeAscii), true);
  assert.equal(looksLikeQrAscii("等待扫码"), false);
});

test("wechat helper builds readable user message for text and media", () => {
  assert.equal(
    buildWechatUserMessage({
      text: "帮我整理一下",
      media: {
        type: "image",
        fileName: "evidence.png",
        mimeType: "image/png",
      },
    }),
    "帮我整理一下",
  );
});

test("wechat helper normalizes media access fields without parsing content", () => {
  const message = buildWechatThreadMessage("wx-user-1", {
    text: "看下这张图",
    media: {
      type: "image",
      name: "evidence.png",
      contentType: "image/png",
      localPath: "C:\\temp\\evidence.png",
      size: "128",
    },
  });

  assert.deepEqual(message.media, {
    type: "image",
    fileName: "evidence.png",
    mimeType: "image/png",
    size: 128,
    url: "",
    path: "C:\\temp\\evidence.png",
    dataBase64: "",
  });
});

test("wechat helper converts bridge media response into sdk chat response", () => {
  assert.deepEqual(
    buildWechatChatResponseFromBridgeResponse({
      text: "材料已经整理好了，请查收。",
      media: {
        type: "file",
        path: "C:\\temp\\reply.docx",
        fileName: "案件材料.docx",
      },
    }),
    {
      text: "材料已经整理好了，请查收。",
      media: {
        type: "file",
        url: "C:\\temp\\reply.docx",
        fileName: "案件材料.docx",
      },
    },
  );
});

test("wechat helper keeps media-only response without forcing fallback text", () => {
  assert.deepEqual(
    buildWechatChatResponseFromBridgeResponse({
      text: "",
      media: {
        type: "image",
        path: "C:\\temp\\evidence.png",
        fileName: "evidence.png",
      },
    }),
    {
      media: {
        type: "image",
        url: "C:\\temp\\evidence.png",
        fileName: "evidence.png",
      },
    },
  );
});

test("wechat helper converts bridge mediaList response into sdk multi-media chat response", () => {
  assert.deepEqual(
    buildWechatChatResponseFromBridgeResponse({
      text: "这些材料直接发你。",
      mediaList: [
        {
          type: "file",
          path: "C:\\temp\\a.pdf",
          fileName: "a.pdf",
        },
        {
          type: "file",
          path: "C:\\temp\\b.docx",
          fileName: "b.docx",
        },
      ],
    }),
    {
      text: "这些材料直接发你。",
      mediaList: [
        {
          type: "file",
          url: "C:\\temp\\a.pdf",
          fileName: "a.pdf",
        },
        {
          type: "file",
          url: "C:\\temp\\b.docx",
          fileName: "b.docx",
        },
      ],
    },
  );
});
