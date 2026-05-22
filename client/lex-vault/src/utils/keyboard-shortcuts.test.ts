import { describe, expect, it } from "vitest";

import { shouldPreventWindowRefreshShortcut } from "@/utils/keyboard-shortcuts";

describe("shouldPreventWindowRefreshShortcut", () => {
  it("会拦截 Ctrl+R 刷新", () => {
    expect(
      shouldPreventWindowRefreshShortcut({
        key: "r",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(true);
  });

  it("会兼容拦截大写 R 和 Command+R", () => {
    expect(
      shouldPreventWindowRefreshShortcut({
        key: "R",
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(true);
  });

  it("不会误伤其他按键", () => {
    expect(
      shouldPreventWindowRefreshShortcut({
        key: "k",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(false);
  });
});
