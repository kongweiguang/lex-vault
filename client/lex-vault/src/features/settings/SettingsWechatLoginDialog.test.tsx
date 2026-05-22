import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsWechatLoginDialog } from "@/features/settings/SettingsWechatLoginDialog";
import type { WechatLoginStatus } from "@/services/wechat-service";

const waitingStatus: WechatLoginStatus = {
  status: "waiting",
  message: "等待微信扫码确认。",
  qrAscii: "████████\n█      █\n█ ████ █\n█      █\n████████",
  updatedAt: "2026-05-19T00:00:00Z",
};

const baseProps = {
  hasLoggedIn: false,
  isBusy: false,
  isOpen: true,
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  status: waitingStatus,
};

describe("SettingsWechatLoginDialog", () => {
  it("未完成账号登录时提示微信只能先连接", () => {
    const html = renderToStaticMarkup(<SettingsWechatLoginDialog {...baseProps} />);

    expect(html).toContain("微信扫码连接小隐");
    expect(html).toContain("微信可以先连接");
    expect(html).toContain("等待微信扫码确认。");
  });

  it("展示 helper 返回的二维码 ASCII", () => {
    const html = renderToStaticMarkup(<SettingsWechatLoginDialog {...baseProps} />);

    expect(html).toContain("████████");
  });

  it("已登录且连接成功时展示微信会进入桌面端对话历史", () => {
    const html = renderToStaticMarkup(
      <SettingsWechatLoginDialog
        {...baseProps}
        hasLoggedIn
        status={{
          status: "connected",
          message: "微信已连接，小隐会通过桌面端对话历史回复微信消息。",
          updatedAt: "2026-05-19T00:00:00Z",
        }}
      />,
    );

    expect(html).toContain("微信已连接，小隐会通过桌面端对话历史回复微信消息。");
    expect(html).not.toContain("微信可以先连接");
  });
});
