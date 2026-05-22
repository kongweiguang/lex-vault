import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsLoginDialog } from "@/features/settings/SettingsLoginDialog";

const baseProps = {
  captcha: { enabled: false, imageBase64: "" },
  isLoggingIn: false,
  isOpen: true,
  isRefreshingCaptcha: false,
  loginButtonDisabled: false,
  loginDialog: { username: "", password: "", code: "", uuid: "" },
  loginError: "",
  onChange: vi.fn(),
  onClose: vi.fn(),
  onRefreshCaptcha: vi.fn(),
  onSubmit: vi.fn(),
};

describe("SettingsLoginDialog", () => {
  it("只保留账号密码登录操作", () => {
    const html = renderToStaticMarkup(<SettingsLoginDialog {...baseProps} />);

    expect(html).toContain("确认登录");
    expect(html).not.toContain("微信扫码连接小隐");
  });

  it("登录中时展示提交中的状态文案", () => {
    const html = renderToStaticMarkup(<SettingsLoginDialog {...baseProps} isLoggingIn />);

    expect(html).toContain("登录中");
  });
});
