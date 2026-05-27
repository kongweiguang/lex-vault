import { describe, expect, it } from "vitest";

import {
  resolvePackageLabel,
  resolveQuotaAvailableAt,
  resolveQuotaProgressItems,
  resolveQuotaSummary,
} from "@/features/settings/settings-panel-helpers";

describe("settings-panel helpers", () => {
  it("优先展示套餐名称", () => {
    expect(resolvePackageLabel({ packageName: "基础套餐", packageCode: "plus" })).toBe("基础套餐");
  });

  it("套餐名称后追加到期时间", () => {
    expect(resolvePackageLabel({ packageName: "基础套餐", packageCode: "plus", packageEffectiveTo: "2026-06-26 10:00:00" })).toBe(
      "基础套餐（到期：2026-06-26 10:00:00）",
    );
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
      }),
    ).toBe("5小时 剩余 87.5% / 7天 剩余 64%");
  });

  it("兼容 sevenDay 和 usagePercent 命名", () => {
    expect(
      resolveQuotaSummary({
        fiveHourUsagePercent: "8.00",
        sevenDayUsagePercent: 20,
      } as never),
    ).toBe("5小时 剩余 92% / 7天 剩余 80%");
  });

  it("把后端返回的已用百分比转换为剩余额度进度条数据", () => {
    expect(
      resolveQuotaProgressItems({
        fiveHourQuotaPercent: 12.5,
        weeklyQuotaPercent: "36",
      }),
    ).toEqual([
      { label: "5小时", percent: 87.5, percentText: "87.5%", refreshText: "暂无待刷新时间" },
      { label: "7天", percent: 64, percentText: "64%", refreshText: "暂无待刷新时间" },
    ]);
  });

  it("保留后端返回的下次刷新时间", () => {
    expect(
      resolveQuotaProgressItems({
        fiveHourQuotaPercent: 100,
        weeklyQuotaPercent: 36,
        fiveHourNextRefreshAt: "2026-05-27 18:00:00",
      }),
    ).toEqual([
      {
        label: "5小时",
        percent: 0,
        percentText: "0%",
        nextRefreshAt: "2026-05-27 18:00:00",
        refreshText: "下次刷新 2026-05-27 18:00:00",
      },
      { label: "7天", percent: 64, percentText: "64%", refreshText: "暂无待刷新时间" },
    ]);
  });

  it("忽略历史 monthly 字段", () => {
    expect(
      resolveQuotaProgressItems({
        monthlyQuotaPercent: 10,
        packageEffectiveTo: "2026-06-01 00:00:00",
      } as never),
    ).toEqual([]);
  });

  it("返回综合恢复可用时间", () => {
    expect(resolveQuotaAvailableAt({ quotaAvailableAt: "2026-05-27 18:00:00" })).toBe("2026-05-27 18:00:00");
    expect(resolveQuotaAvailableAt(null)).toBe("");
  });
});
