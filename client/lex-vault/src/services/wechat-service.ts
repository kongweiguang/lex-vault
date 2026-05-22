import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 微信扫码连接状态码。 */
export type WechatLoginStatusCode =
  | "idle"
  | "starting"
  | "waiting"
  | "scanned"
  | "expired"
  | "connected"
  | "failed"
  | "canceled";

/** 微信扫码连接状态。 */
export type WechatLoginStatus = {
  /** 当前状态码。 */
  status: WechatLoginStatusCode;
  /** 用户可读状态说明。 */
  message: string;
  /** qrcode-terminal 生成的二维码 ASCII 文本。 */
  qrAscii?: string;
  /** 微信 SDK 返回的账号 ID。 */
  accountId?: string;
  /** 后端更新时间。 */
  updatedAt: string;
};

/** 判断微信扫码流程是否仍在进行中。 */
export function isWechatLoginRunning(status: WechatLoginStatusCode) {
  return status === "starting" || status === "waiting" || status === "scanned";
}

/** 启动微信扫码连接。 */
export function startWechatLogin(forceLogin = false) {
  return invoke<WechatLoginStatus>("wechat_login_start", {
    req: {
      forceLogin,
    },
  });
}

/** 取消微信扫码连接。 */
export function cancelWechatLogin() {
  return invoke<WechatLoginStatus>("wechat_login_cancel");
}

/** 读取当前微信扫码连接状态。 */
export function readWechatLoginStatus() {
  return invoke<WechatLoginStatus>("wechat_status_read");
}

/** 通过已连接的微信 helper 尽力主动发送文本消息。 */
export function sendWechatMessage(text: string) {
  return invoke<boolean>("wechat_send_message", { text });
}

/** 监听微信扫码连接状态事件。 */
export function listenWechatLoginEvents(handler: (status: WechatLoginStatus) => void) {
  return listen<WechatLoginStatus>("lex-vault://wechat-login", (event) => {
    handler(event.payload);
  });
}

/** 微信扫码连接默认状态。 */
export const DEFAULT_WECHAT_LOGIN_STATUS: WechatLoginStatus = {
  status: "idle",
  message: "微信尚未连接。",
  updatedAt: "",
};
