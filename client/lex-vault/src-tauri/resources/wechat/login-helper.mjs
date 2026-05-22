#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EVENT_TYPE = "wechat-login";
const THREAD_REQUEST_TYPE = "wechat-thread-message";
const THREAD_RESPONSE_TYPE = "wechat-thread-response";
const PROACTIVE_MESSAGE_TYPE = "wechat-proactive-message";
const MODULE_ROOTS_ENV = "LEX_VAULT_WECHAT_MODULE_ROOTS";
const OPENCLAW_STATE_DIR_ENV = "OPENCLAW_STATE_DIR";
const BRIDGE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

const CLI_ARGS = new Set(process.argv.slice(2));
const FORCE_LOGIN = CLI_ARGS.has("--force-login");
const RESUME_ONLY = CLI_ARGS.has("--resume-only");
let bridgeRequestSeq = 0;
let bridgeInputInstalled = false;
let bridgeInputBuffer = "";
let activeBot = null;
const bridgePendingResponses = new Map();

/** 输出给 Tauri 捕获的稳定 JSON 行，避免解析 SDK 的普通终端文本。 */
export function createWechatLoginEvent(payload) {
  return {
    type: EVENT_TYPE,
    status: payload.status,
    message: payload.message,
    ...(payload.qrAscii ? { qrAscii: payload.qrAscii } : {}),
    ...(payload.accountId ? { accountId: payload.accountId } : {}),
  };
}

/** 创建 helper 投递给 Rust 的微信消息请求。 */
export function createWechatThreadMessageEvent(payload) {
  return {
    type: THREAD_REQUEST_TYPE,
    requestId: payload.requestId,
    message: payload.message,
  };
}

/** 创建 Rust 投递给 helper 的主动微信消息请求。 */
export function createWechatProactiveMessageEvent(payload) {
  return {
    type: PROACTIVE_MESSAGE_TYPE,
    text: stringOrEmpty(payload.text),
  };
}

/** 把 Rust 桥接响应转换成 weixin-agent-sdk 可消费的 ChatResponse。 */
export function buildWechatChatResponseFromBridgeResponse(response) {
  const mediaList = normalizeWechatReplyMediaList(response);
  const text = stringOrEmpty(response?.text).trim();
  if (mediaList.length === 1) {
    return text ? { text, media: mediaList[0] } : { media: mediaList[0] };
  }
  if (mediaList.length > 1) {
    return text ? { text, mediaList } : { mediaList };
  }
  return {
    text: text || "小隐这次没有生成可发送的回复，请换个问法再试试。",
  };
}

/** 把微信入站消息整理成适合进入 Codex thread 的单条文本。 */
export function buildWechatUserMessage(request) {
  const text = request.text?.trim();
  return text || "";
}

/** 构造 Rust 桥接层需要的稳定消息载荷。 */
export function buildWechatThreadMessage(conversationId, request) {
  const isRoom = Boolean(request.isRoom || request.roomId || request.roomTopic);
  return {
    conversationId: String(conversationId || "wechat-user"),
    messageId: stringOrEmpty(request.messageId || request.id),
    text: buildWechatUserMessage(request),
    rawText: stringOrEmpty(request.text),
    contactName: stringOrEmpty(request.contactName || request.fromName || request.userName),
    senderName: stringOrEmpty(request.senderName || request.fromName || request.contactName),
    roomTopic: stringOrEmpty(request.roomTopic || request.roomName),
    isRoom,
    timestamp: stringOrEmpty(request.timestamp || request.createTime),
    media: normalizeWechatMedia(request.media),
  };
}

/** 判断当前 Node.js 是否满足 weixin-agent-sdk 的最低运行版本。 */
export function isSupportedNodeVersion(version = process.versions.node) {
  const [major] = version.split(".").map((part) => Number.parseInt(part, 10));
  return Number.isFinite(major) && major >= 22;
}

/** 从 SDK 终端文本中提取可映射为前端状态的语义。 */
export function statusFromSdkText(text) {
  if (text.includes("已扫码")) {
    return { status: "scanned", message: "已扫码，请在微信中继续确认。" };
  }
  if (text.includes("二维码已过期")) {
    return { status: "expired", message: "二维码已过期，请重新生成后扫码。" };
  }
  if (text.includes("新二维码已生成")) {
    return { status: "waiting", message: "新二维码已生成，请重新扫描。" };
  }
  if (text.includes("等待扫码")) {
    return { status: "waiting", message: "等待微信扫码确认。" };
  }
  return null;
}

/** 识别 qrcode-terminal 生成的二维码 ASCII 块。 */
export function looksLikeQrAscii(text) {
  const normalized = text.replace(/\u001b\[[0-9;]*m/g, "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.length > 0);
  const qrGlyphCount = (normalized.match(/[█▀▄]/g) ?? []).length;
  return lines.length >= 8 && (normalized.length >= 120 || qrGlyphCount >= 60);
}

/** 规范化微信附件摘要，避免把 SDK 的大对象原样塞进本机协议。 */
function normalizeWechatMedia(media) {
  if (!media || typeof media !== "object") {
    return null;
  }
  return {
    type: stringOrEmpty(media.type || media.kind || "file"),
    fileName: stringOrEmpty(media.fileName || media.name),
    mimeType: stringOrEmpty(media.mimeType || media.contentType),
    size: numberOrNull(media.size || media.fileSize),
    url: stringOrEmpty(media.url || media.downloadUrl || media.previewUrl),
    path: stringOrEmpty(media.path || media.localPath || media.filePath),
    dataBase64: stringOrEmpty(media.dataBase64 || media.base64),
  };
}

/** 把未知输入压成字符串，避免 JSON 协议里出现 SDK 特有对象。 */
function stringOrEmpty(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/** 将大小字段压成 number|null，避免 JSON 协议里出现 NaN。 */
function numberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

/** 归一化 Rust 返回的微信回复文件描述。 */
function normalizeWechatReplyMedia(media) {
  if (!media || typeof media !== "object") {
    return null;
  }
  const path = stringOrEmpty(media.path).trim();
  if (!path) {
    return null;
  }
  const type = stringOrEmpty(media.type || media.kind || "file").trim() || "file";
  const fileName = stringOrEmpty(media.fileName || media.name).trim();
  return {
    type,
    url: path,
    ...(fileName ? { fileName } : {}),
  };
}

/** 归一化 Rust 返回的单文件或多文件回复描述。 */
function normalizeWechatReplyMediaList(response) {
  const declaredList = Array.isArray(response?.mediaList) ? response.mediaList : [];
  const sourceList = declaredList.length > 0 ? declaredList : [response?.media];
  return sourceList
    .map((media) => normalizeWechatReplyMedia(media))
    .filter(Boolean);
}

/** 通过 stdin 监听 Rust 返回的微信 thread 回复。 */
function installBridgeResponseReader() {
  if (bridgeInputInstalled) {
    return;
  }
  bridgeInputInstalled = true;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    bridgeInputBuffer += chunk;
    let lineEndIndex = bridgeInputBuffer.indexOf("\n");
    while (lineEndIndex >= 0) {
      const line = bridgeInputBuffer.slice(0, lineEndIndex).trim();
      bridgeInputBuffer = bridgeInputBuffer.slice(lineEndIndex + 1);
      if (line) {
        handleBridgeInputLine(line);
      }
      lineEndIndex = bridgeInputBuffer.indexOf("\n");
    }
  });
  process.stdin.resume();
}

/** 分发单行 Rust 输入，支持 thread 响应和主动微信通知。 */
function handleBridgeInputLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (parsed?.type === PROACTIVE_MESSAGE_TYPE) {
    void sendProactiveWechatMessage(parsed.text);
    return;
  }
  if (parsed?.type !== THREAD_RESPONSE_TYPE || typeof parsed.requestId !== "string") {
    return;
  }
  const pending = bridgePendingResponses.get(parsed.requestId);
  if (!pending) {
    return;
  }
  bridgePendingResponses.delete(parsed.requestId);
  clearTimeout(pending.timeout);
  if (parsed.ok) {
    pending.resolve(parsed);
    return;
  }
  const error = new Error(parsed.text || parsed.message || "桌面端暂时没有返回微信回复。");
  error.code = parsed.errorCode;
  pending.reject(error);
}

/** 通过当前 bot 尽力主动发送微信消息。 */
async function sendProactiveWechatMessage(text) {
  const message = String(text || "").trim();
  if (!message || !activeBot) {
    return;
  }
  try {
    await activeBot.sendMessage(message);
  } catch (error) {
    console.error(`[wechat] proactive message failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 将微信消息投递到 Rust 桥接层，并等待 app-server thread 生成最终回复。 */
async function requestDesktopThreadResponse(conversationId, request) {
  installBridgeResponseReader();
  const requestId = `wechat-${Date.now()}-${++bridgeRequestSeq}`;
  const message = buildWechatThreadMessage(conversationId, request);
  const event = createWechatThreadMessageEvent({ requestId, message });

  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bridgePendingResponses.delete(requestId);
      reject(new Error("桌面端生成微信回复超时，请稍后重试。"));
    }, BRIDGE_REQUEST_TIMEOUT_MS);
    bridgePendingResponses.set(requestId, { resolve, reject, timeout });
  });

  originalStdoutWrite(`${JSON.stringify(event)}\n`);
  return responsePromise;
}

/** 创建 weixin-agent-sdk 所需的最小 Agent 实现。 */
function createWechatThreadAgent() {
  return {
    async chat(request) {
      const conversationId = request.conversationId || "wechat-user";
      try {
        const response = await requestDesktopThreadResponse(conversationId, request);
        return buildWechatChatResponseFromBridgeResponse(response);
      } catch (error) {
        return {
          text: wechatReadableBridgeError(error),
        };
      }
    },
    clearSession() {
      // Codex thread 历史由桌面端维护；SDK 的清理回调不直接删除本地 thread 映射。
    },
  };
}

/** 将桥接错误压缩为微信端可读提示，详细原因留在桌面端日志。 */
function wechatReadableBridgeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.trim()) {
    return message;
  }
  return "桌面端小隐暂时无法回复微信消息，请确认律隐台正在运行后再试。";
}

/** 输出给 Tauri 捕获的稳定 JSON 行，避免解析 SDK 的普通终端文本。 */
function emit(payload) {
  const event = createWechatLoginEvent(payload);
  originalStdoutWrite(`${JSON.stringify(event)}\n`);
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalConsoleLog = console.log.bind(console);
let lastQrAscii = "";

/** 捕获 SDK 写入 stdout 的状态文本，但不让普通终端输出污染 JSON 协议。 */
function installSdkOutputCapture() {
  console.log = (...args) => {
    const text = args.map((item) => String(item)).join(" ");
    if (looksLikeQrAscii(text)) {
      lastQrAscii = text;
      emit({
        status: "waiting",
        message: "请使用微信扫描二维码完成连接。",
        qrAscii: text,
      });
      return;
    }
    const status = statusFromSdkText(text);
    if (status) {
      emit(status);
    }
  };

  process.stdout.write = (chunk, encoding, callback) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
      : String(chunk);
    const status = statusFromSdkText(text);
    if (status) {
      emit({
        ...status,
        ...(lastQrAscii ? { qrAscii: lastQrAscii } : {}),
      });
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };
}

/** 还原被捕获的输出，主要供异常分支和本地调试使用。 */
function restoreSdkOutputCapture() {
  console.log = originalConsoleLog;
  process.stdout.write = originalStdoutWrite;
  lastQrAscii = "";
}

/** 确保微信 SDK 登录态默认落到 Lex Vault 用户目录，而不是散落到 ~/.openclaw。 */
function ensureOpenClawStateDir() {
  if (!process.env[OPENCLAW_STATE_DIR_ENV]?.trim()) {
    process.env[OPENCLAW_STATE_DIR_ENV] = path.join(os.homedir(), ".lex-vault", "wechat");
  }
  lastQrAscii = "";
}

/** 从 Tauri 传入的候选模块根目录中解析 weixin-agent-sdk。 */
async function importWeixinSdk() {
  const roots = (process.env[MODULE_ROOTS_ENV] ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const root of roots) {
    try {
      const requireFromRoot = createRequire(path.join(root, "package.json"));
      const resolved = requireFromRoot.resolve("weixin-agent-sdk");
      return import(pathToFileURL(resolved).href);
    } catch {
      // 尝试下一个候选根目录。
    }
  }

  return import("weixin-agent-sdk");
}

async function runSelfTest() {
  const qrLikeAscii = Array.from({ length: 10 }, () => "█".repeat(18)).join("\n");
  const bridgeMessage = buildWechatThreadMessage("wx-1", {
    text: "帮我整理一下",
    media: { type: "image", fileName: "evidence.png", mimeType: "image/png" },
  });
  const checks = [
    isSupportedNodeVersion("22.0.0"),
    !isSupportedNodeVersion("21.9.0"),
    statusFromSdkText("已扫码，在微信继续操作")?.status === "scanned",
    statusFromSdkText("二维码已过期，正在刷新")?.status === "expired",
    looksLikeQrAscii(qrLikeAscii),
    createWechatLoginEvent({ status: "connected", message: "ok", accountId: "wx-1" }).type === EVENT_TYPE,
    createWechatThreadMessageEvent({ requestId: "req-1", message: bridgeMessage }).type === THREAD_REQUEST_TYPE,
    bridgeMessage.conversationId === "wx-1",
  ];
  if (checks.some((passed) => !passed)) {
    throw new Error("wechat login helper self test failed");
  }
  originalStdoutWrite("wechat login helper self test passed\n");
}

async function main() {
  if (CLI_ARGS.has("--self-test")) {
    await runSelfTest();
    return;
  }

  ensureOpenClawStateDir();
  if (!isSupportedNodeVersion()) {
    emit({
      status: "failed",
      message: `当前 Node.js ${process.versions.node} 不满足微信连接要求，请使用 Node.js 22 或更高版本。`,
    });
    process.exitCode = 1;
    return;
  }

  emit({ status: "starting", message: "正在启动微信扫码连接..." });
  installBridgeResponseReader();
  installSdkOutputCapture();
  try {
    const { isLoggedIn, login, start } = await importWeixinSdk();
    const loggedIn = Boolean(await isLoggedIn());
    if (RESUME_ONLY && !loggedIn) {
      emit({
        status: "idle",
        message: "未检测到可恢复的微信登录态，请在设置页扫码连接小隐。",
      });
      return;
    }
    let accountId;
    if (FORCE_LOGIN || !loggedIn) {
      accountId = await login({
        log: (message) => {
          const status = statusFromSdkText(message);
          if (status) {
            emit(status);
            return;
          }
          if (message.includes("正在启动")) {
            emit({ status: "starting", message: "正在获取微信二维码..." });
          }
        },
      });
    } else {
      emit({
        status: "starting",
        message: "检测到已连接的微信账号，正在恢复消息监听...",
      });
    }
    const bot = start(createWechatThreadAgent(), {
      ...(accountId ? { accountId } : {}),
    });
    activeBot = bot;
    emit({
      status: "connected",
      message: "微信已连接，小隐现在会通过桌面端对话历史回复普通微信消息。",
      accountId,
    });
    await bot.wait();
  } catch (error) {
    emit({
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    activeBot = null;
    restoreSdkOutputCapture();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    emit({
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
