import { describe, expect, it } from "vitest";

import { resolvePackageLabel, resolveQuotaProgressItems, resolveQuotaSummary } from "@/features/settings/settings-panel-helpers";

describe("settings-panel helpers", () => {
  it("优先展示套餐名称", () => {
    expect(resolvePackageLabel({ packageName: "基础套餐", packageCode: "plus" })).toBe("基础套餐");
  });

  it("兼容后端只返回其他命名的套餐字段", () => {
    expect(
      resolvePackageLabel({
        currentPackageName: "专业套餐",
        currentPackageCode: "pro",
      } as never),
    ).toBe("专业套餐");
  });

  it("把后端返回的百分比摘要格式化为三个额度窗口", () => {
    expect(
      resolveQuotaSummary({
        fiveHourQuotaPercent: 12.5,
        weeklyQuotaPercent: "36",
        monthlyQuotaPercent: "88%",
      }),
    ).toBe("5小时 剩余 87.5% / 7天 剩余 64% / 月 剩余 12%");
  });

  it("兼容 sevenDay 和 usagePercent 命名", () => {
    expect(
      resolveQuotaSummary({
        fiveHourUsagePercent: "8.00",
        sevenDayUsagePercent: 20,
        monthlyUsagePercent: 65.25,
      } as never),
    ).toBe("5小时 剩余 92% / 7天 剩余 80% / 月 剩余 34.75%");
  });

  it("把后端返回的已用百分比转换为剩余额度进度条数据", () => {
    expect(
      resolveQuotaProgressItems({
        fiveHourQuotaPercent: 12.5,
        weeklyQuotaPercent: "36",
        monthlyQuotaPercent: "188%",
      }),
    ).toEqual([
      { label: "5小时", percent: 87.5, percentText: "87.5%" },
      { label: "7天", percent: 64, percentText: "64%" },
      { label: "月", percent: 0, percentText: "0%" },
    ]);
  });
});
