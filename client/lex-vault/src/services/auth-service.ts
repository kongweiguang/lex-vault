import { invoke } from "@tauri-apps/api/core";

import { API_BASE_URL, LAW_ADMIN_CLIENT_ID, LAW_ADMIN_TENANT_ID } from "@/config/runtime";
import { apiClient, ApiError } from "@/lib/api-client";
import { shouldClearStoredAuthOnUserInfoError } from "@/services/auth-service-helpers";
import type { AuthInfo, UserPackageSummary, UserProfileInfo } from "@/types/domain";
import { normalizeAccessToken } from "@/utils/auth-token";

/** law-admin password 登录请求。 */
export type PasswordLoginInput = {
  /** 登录用户名。 */
  username: string;
  /** 登录密码。 */
  password: string;
  /** 租户 ID，默认使用 law-admin 初始化租户。 */
  tenantId?: string;
  /** 验证码文本，启用验证码时由后端校验。 */
  code?: string;
  /** 验证码 UUID，启用验证码时由后端返回。 */
  uuid?: string;
  /** 记住登录状态标记，保持和 law-admin 前端登录参数兼容。 */
  rememberMe?: boolean;
  /** 客户端 ID，未传时使用桌面端固定 pc 客户端。 */
  clientId?: string;
  /** 授权类型，未传时使用 password。 */
  grantType?: string;
};

/** law-admin 通用 R 响应结构。 */
type R<T> = {
  /** 业务状态码。 */
  code?: number;
  /** 业务提示消息。 */
  msg?: string;
  /** 业务数据。 */
  data?: T;
};

/** law-admin 登录返回数据。 */
type LoginVo = {
  /** 访问令牌。 */
  access_token?: string;
  /** 客户端 ID。 */
  client_id?: string;
};

/** law-admin 验证码返回数据。 */
type VerifyCodeVo = {
  /** 是否启用验证码。 */
  captchaEnabled?: boolean;
  /** 验证码关联 UUID。 */
  uuid?: string;
  /** Base64 验证码图片内容。 */
  img?: string;
};

/** law-admin 当前登录用户信息返回数据。 */
type UserInfoVo = {
  /** 当前登录用户基础信息。 */
  user?: UserProfileInfo;
  /** 当前用户权限标识列表。 */
  permissions?: string[];
  /** 当前用户角色权限标识列表。 */
  roles?: string[];
};

/** AI 套餐汇总接口返回数据。 */
type UserPackageSummaryVo = UserPackageSummary;

/** 读取本机保存的登录会话。 */
export function getStoredAuthInfo() {
  return invoke<AuthInfo>("get_auth_info");
}

/** 清空本机保存的登录会话。 */
export function clearStoredAuthInfo() {
  return invoke<void>("clear_auth_info");
}

/** 读取当前登录页验证码。 */
export async function getLoginCode() {
  const body = await apiClient<R<VerifyCodeVo>>(`${API_BASE_URL}/auth/code`, {
    method: "GET",
    skipAuth: true,
  });
  return {
    captchaEnabled: body.data?.captchaEnabled !== false,
    uuid: body.data?.uuid ?? "",
    imageBase64: body.data?.img ?? "",
  };
}

/** 获取当前登录用户基础信息，用于设置页账号卡片展示。 */
export async function getCurrentUserInfo(accessToken?: string) {
  const body = await apiClient<R<UserInfoVo>>(`${API_BASE_URL}/system/user/getInfo`, {
    method: "GET",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    skipAuth: Boolean(accessToken),
  });
  if (body.code !== 200 || !body.data?.user) {
    throw new ApiError(body.msg || "获取用户信息失败", 200, body);
  }

  return body.data.user;
}

/** 获取当前登录用户的 AI 套餐与额度摘要。 */
export async function getCurrentUserPackageSummary(accessToken?: string) {
  const body = await apiClient<R<UserPackageSummaryVo>>(`${API_BASE_URL}/system/ai/user-package/current`, {
    method: "GET",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    skipAuth: Boolean(accessToken),
  });
  if (body.code !== 200 || !body.data) {
    throw new ApiError(body.msg || "获取套餐信息失败", 200, body);
  }

  return body.data;
}

/** 判断读取远程用户信息失败后，是否应该清空本机登录态。 */
export { shouldClearStoredAuthOnUserInfoError };

/** 使用 law-admin password 方式登录，并将 access_token 保存为后续 API token。 */
export async function loginWithPassword(input: PasswordLoginInput) {
  const username = input.username.trim();
  const tenantId = input.tenantId?.trim() || LAW_ADMIN_TENANT_ID;
  const payload = {
    ...input,
    tenantId,
    username,
    password: input.password,
    clientId: input.clientId || LAW_ADMIN_CLIENT_ID,
    grantType: input.grantType || "password",
  };
  const body = await apiClient<R<LoginVo>>(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    body: payload,
    encrypted: true,
    skipAuth: true,
  });
  if (body.code !== 200 || !body.data?.access_token) {
    throw new ApiError(body.msg || "登录失败", 200, body);
  }

  return invoke<AuthInfo>("update_auth_info", {
    auth: {
      username,
      accessToken: normalizeAccessToken(body.data.access_token),
    },
  });
}
