import { describe, expect, it } from "vitest";

import {
  calculateBillingDetailTotals,
  createDefaultBillingExpenseFormState,
  createDefaultBillingTimeFormState,
  createToolsWorkspaceDetailView,
  createToolsWorkspaceHomeView,
  filterBillingCaseSummaries,
  formatBillingDuration,
  mergeBillingCaseSummaries,
  validateBillingExpenseFormState,
  validateBillingTimeFormState,
} from "@/features/billing/billing-helpers";

describe("billing-helpers", () => {
  it("merges current cases with stored summaries", () => {
    const merged = mergeBillingCaseSummaries(
      [
        { id: "案件A", name: "案件A", casePath: "C:/workspace/master/案件A" },
        { id: "案件B", name: "案件B", casePath: "C:/workspace/master/案件B" },
      ],
      [
        {
          caseId: "案件A",
          caseNameSnapshot: "旧案件A",
          casePathSnapshot: "C:/old/案件A",
          currencyCode: "CNY",
          defaultHourlyRate: 500,
          totalDurationMinutes: 120,
          timeAmount: 1000,
          expenseAmount: 200,
          totalAmount: 1200,
          timeEntryCount: 2,
          expenseEntryCount: 1,
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].caseNameSnapshot).toBe("案件A");
    expect(merged[0].timeAmount).toBe(1000);
    expect(merged[1].caseId).toBe("案件B");
    expect(merged[1].totalAmount).toBe(0);
  });

  it("filters summaries by case keywords", () => {
    const matched = filterBillingCaseSummaries(
      [
        {
          caseId: "劳动争议",
          caseNameSnapshot: "赵六劳动争议",
          casePathSnapshot: "C:/workspace/master/赵六劳动争议",
          currencyCode: "CNY",
          defaultHourlyRate: 0,
          totalDurationMinutes: 0,
          timeAmount: 0,
          expenseAmount: 0,
          totalAmount: 0,
          timeEntryCount: 0,
          expenseEntryCount: 0,
        },
      ],
      "劳动",
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].caseId).toBe("劳动争议");
  });

  it("calculates detail totals and formats duration", () => {
    const totals = calculateBillingDetailTotals(
      [
        {
          id: "time-1",
          caseId: "案件A",
          caseNameSnapshot: "案件A",
          casePathSnapshot: "C:/workspace/master/案件A",
          workDate: "2026-05-19",
          description: "整理证据",
          durationMinutes: 90,
          hourlyRate: 600,
          amount: 900,
          ownerUserLabel: "张律师",
          billable: true,
          createdAt: "2026-05-19T00:00:00Z",
          updatedAt: "2026-05-19T00:00:00Z",
        },
      ],
      [
        {
          id: "expense-1",
          caseId: "案件A",
          caseNameSnapshot: "案件A",
          casePathSnapshot: "C:/workspace/master/案件A",
          expenseDate: "2026-05-19",
          category: "差旅",
          amount: 120.5,
          note: "",
          createdAt: "2026-05-19T00:00:00Z",
          updatedAt: "2026-05-19T00:00:00Z",
        },
      ],
    );

    expect(totals).toEqual({
      totalDurationMinutes: 90,
      timeAmount: 900,
      expenseAmount: 120.5,
      totalAmount: 1020.5,
    });
    expect(formatBillingDuration(90)).toBe("1小时30分钟");
  });

  it("validates billing forms and workspace view transitions", () => {
    expect(createToolsWorkspaceHomeView()).toEqual({ page: "home" });
    expect(createToolsWorkspaceDetailView("billing")).toEqual({ page: "detail", toolKey: "billing" });

    const invalidTimeErrors = validateBillingTimeFormState({
      ...createDefaultBillingTimeFormState(),
      workDate: "2026/05/19",
      description: " ",
      durationMinutes: "-1",
      hourlyRate: "-2",
    });
    expect(invalidTimeErrors).toEqual({
      workDate: "请选择有效的工作日期",
      description: "请输入事项说明",
      durationMinutes: "时长不能为负数",
      hourlyRate: "费率不能为负数",
    });

    const invalidExpenseErrors = validateBillingExpenseFormState({
      ...createDefaultBillingExpenseFormState(),
      expenseDate: "2026/05/19",
      category: "",
      amount: "-1",
    });
    expect(invalidExpenseErrors).toEqual({
      expenseDate: "请选择有效的费用日期",
      category: "请输入费用分类",
      amount: "金额不能为负数",
    });
  });
});
