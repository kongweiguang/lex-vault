import { ApiError } from "@/lib/api-client";

type ErrorPayload = {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
};

/** 只有在明确识别为未授权或 token 失效时，才清空本机登录态。 */
export function shouldClearStoredAuthOnUserInfoError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === 401 || error.status === 403) {
    return true;
  }

  const payload = isErrorPayload(error.details) ? error.details : null;
  const bodyCode = normalizeNumberCode(payload?.code);
  if (bodyCode === 401 || bodyCode === 403) {
    return true;
  }

  const message = [error.message, stringifyPayloadMessage(payload)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return ["unauthorized", "token", "expired", "登录", "未认证", "令牌", "过期"]
    .some((keyword) => message.includes(keyword.toLowerCase()));
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return Boolean(value) && typeof value === "object";
}

function normalizeNumberCode(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function stringifyPayloadMessage(payload: ErrorPayload | null) {
  if (!payload) {
    return "";
  }
  if (typeof payload.msg === "string") {
    return payload.msg;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return "";
}
