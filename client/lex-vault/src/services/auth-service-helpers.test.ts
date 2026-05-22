import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";
import { shouldClearStoredAuthOnUserInfoError } from "@/services/auth-service-helpers";

describe("auth-service helpers", () => {
  it("当 HTTP 状态是 401 时应清空本机登录态", () => {
    const error = new ApiError("Unauthorized", 401);

    expect(shouldClearStoredAuthOnUserInfoError(error)).toBe(true);
  });

  it("当业务 code 是 403 时应清空本机登录态", () => {
    const error = new ApiError("无权限", 200, { code: 403, msg: "未登录" });

    expect(shouldClearStoredAuthOnUserInfoError(error)).toBe(true);
  });

  it("当只是网络或服务异常时不应清空本机登录态", () => {
    const error = new ApiError("服务暂时不可用", 500, { code: 500, msg: "系统繁忙" });

    expect(shouldClearStoredAuthOnUserInfoError(error)).toBe(false);
  });
});
