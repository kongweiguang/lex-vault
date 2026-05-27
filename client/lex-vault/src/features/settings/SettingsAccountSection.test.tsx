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
  quotaAvailableAt: "",
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

  it("额度受限时展示恢复可用时间", () => {
    const html = renderToStaticMarkup(
      <SettingsAccountSection
        {...baseProps}
        quotaAvailableAt="2026-05-27 18:00:00"
        quotaProgressItems={[
          {
            label: "5小时",
            percent: 0,
            percentText: "0%",
            nextRefreshAt: "2026-05-27 18:00:00",
            refreshText: "下次刷新 2026-05-27 18:00:00",
          },
        ]}
      />,
    );

    expect(html).toContain("当前额度受限，预计 2026-05-27 18:00:00 后恢复可用");
    expect(html).toContain("下次刷新 2026-05-27 18:00:00");
  });
});
