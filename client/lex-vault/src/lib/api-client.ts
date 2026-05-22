import CryptoJS from "crypto-js";
import JSEncrypt from "jsencrypt";

import {
  LAW_ADMIN_CLIENT_ID,
  LAW_ADMIN_ENCRYPT_HEADER,
  LAW_ADMIN_REQUEST_PUBLIC_KEY,
} from "@/config/runtime";
import { normalizeAccessToken } from "@/utils/auth-token";

export type ApiClientOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown>;
  /** 是否跳过本机 access_token 认证头。 */
  skipAuth?: boolean;
  /** 是否按 law-admin @ApiEncrypt 约定加密 JSON 请求体。 */
  encrypted?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const isJsonBody = (
  body: ApiClientOptions["body"],
): body is Record<string, unknown> =>
  body !== undefined &&
  typeof body === "object" &&
  !(body instanceof Blob) &&
  !(body instanceof FormData) &&
  !(body instanceof URLSearchParams) &&
  !(body instanceof ArrayBuffer);

export async function apiClient<T>(
  input: RequestInfo | URL,
  { headers, body, skipAuth = false, encrypted = false, ...init }: ApiClientOptions = {},
): Promise<T> {
  const jsonBody = isJsonBody(body);
  let encryptedKey: string | undefined;
  let requestBody: BodyInit | undefined;
  if (jsonBody && encrypted) {
    const encryptedPayload = encryptApiPayload(body);
    requestBody = encryptedPayload.encryptedBody;
    encryptedKey = encryptedPayload.encryptedKey;
  } else if (jsonBody) {
    requestBody = JSON.stringify(body);
  } else {
    requestBody = body;
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  requestHeaders.set("clientid", LAW_ADMIN_CLIENT_ID);
  if (jsonBody) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (encryptedKey) {
    requestHeaders.set(LAW_ADMIN_ENCRYPT_HEADER, encryptedKey);
  }
  if (!skipAuth) {
    const authHeaders = await resolveAuthHeaders();
    for (const [key, value] of Object.entries(authHeaders)) {
      requestHeaders.set(key, value);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers: requestHeaders,
    body: requestBody,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(response.statusText, response.status, payload);
  }

  return payload as T;
}

/** 生成 law-admin @ApiEncrypt 需要的 AES 请求体和 RSA 加密头。 */
function encryptApiPayload(payload: Record<string, unknown>) {
  // 后端先 RSA 解密 header，再 Base64 解出 AES 密钥，最后用 AES 解密请求体。
  const aesPassword = randomAscii(32);
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(LAW_ADMIN_REQUEST_PUBLIC_KEY);
  const encryptedKey = encryptor.encrypt(CryptoJS.enc.Utf8.parse(aesPassword).toString(CryptoJS.enc.Base64));
  if (!encryptedKey) {
    throw new ApiError("请求加密失败", 0);
  }

  return {
    encryptedKey,
    encryptedBody: CryptoJS.AES.encrypt(JSON.stringify(payload), CryptoJS.enc.Utf8.parse(aesPassword), {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).toString(),
  };
}

/** 生成后端 AES 工具可接受的 32 位 ASCII 密钥。 */
function randomAscii(length: number) {
  const source = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => source[Math.floor(Math.random() * source.length)]).join("");
}

/** 从本机认证表读取 access_token 并转换为 law-admin 需要的请求头。 */
async function resolveAuthHeaders() {
  const { getStoredAuthInfo } = await import("@/services/auth-service");
  const auth = await getStoredAuthInfo();
  const accessToken = normalizeAccessToken(auth.accessToken);
  if (!accessToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    clientid: LAW_ADMIN_CLIENT_ID,
  };
}
