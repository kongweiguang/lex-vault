import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsAccountSection } from "@/features/settings/SettingsAccountSection";

const baseProps = {
  authInfo: null,
  avatarText: "LX",
  displayName: "Lex Vault",
  hasLoggedIn: false,
  isWechatLoginRunning: false,
  onLogout: vi.fn(),
  onOpenLoginDialog: vi.fn(),
  onOpenWechatLogin: vi.fn(),
  packageLabel: "",
  quotaProgressItems: [],
  userPackageSummaryError: "",
  userProfile: null,
  userProfileError: "",
};

describe("SettingsAccountSection", () => {
  it("未登录时只渲染登录按钮", () => {
    const html = renderToStaticMarkup(<SettingsAccountSection {...baseProps} />);

    expect(html).toContain("登录账号");
    expect(html).not.toContain("微信扫码连接小隐");
    expect(html).not.toContain("退出登录");
  });

  it("已登录且扫码进行中时展示连接中状态", () => {
    const html = renderToStaticMarkup(
      <SettingsAccountSection {...baseProps} hasLoggedIn isWechatLoginRunning />,
    );

    expect(html).toContain("微信连接中");
    expect(html).toContain("disabled");
    expect(html).toContain("退出登录");
  });
});
