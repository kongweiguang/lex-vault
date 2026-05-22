import dayjs from "dayjs";

import type {
  BillingCaseSummary,
  BillingExpenseEntry,
  BillingTimeEntry,
  CaseRecord,
} from "@/types/domain";

const BILLING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 工时表单状态。 */
export type BillingTimeFormState = {
  /** 编辑态时的记录 ID。 */
  id?: string;
  /** 工作日期。 */
  workDate: string;
  /** 事项说明。 */
  description: string;
  /** 时长分钟数。 */
  durationMinutes: string;
  /** 覆盖小时费率。 */
  hourlyRate: string;
  /** 经办人标签。 */
  ownerUserLabel: string;
  /** 是否可计费。 */
  billable: boolean;
};

/** 费用表单状态。 */
export type BillingExpenseFormState = {
  /** 编辑态时的记录 ID。 */
  id?: string;
  /** 费用日期。 */
  expenseDate: string;
  /** 费用分类。 */
  category: string;
  /** 金额。 */
  amount: string;
  /** 备注说明。 */
  note: string;
};

/** 工时表单错误。 */
export type BillingTimeFormErrors = Partial<Record<"workDate" | "description" | "durationMinutes" | "hourlyRate", string>>;

/** 费用表单错误。 */
export type BillingExpenseFormErrors = Partial<Record<"expenseDate" | "category" | "amount", string>>;

/** 工具工作区视图。 */
export type ToolsWorkspaceView =
  | { page: "home" }
  | { page: "detail"; toolKey: "billing" };

/** 当前案件下的明细汇总。 */
export type BillingDetailTotals = {
  /** 累计工时分钟数。 */
  totalDurationMinutes: number;
  /** 工时应收合计。 */
  timeAmount: number;
  /** 费用合计。 */
  expenseAmount: number;
  /** 总额。 */
  totalAmount: number;
};

/** 创建工具首页视图。 */
export function createToolsWorkspaceHomeView(): ToolsWorkspaceView {
  return { page: "home" };
}

/** 切换到某个工具详情页。 */
export function createToolsWorkspaceDetailView(toolKey: "billing"): ToolsWorkspaceView {
  return { page: "detail", toolKey };
}

/** 默认空工时表单。 */
export function createDefaultBillingTimeFormState(date = dayjs().format("YYYY-MM-DD")): BillingTimeFormState {
  return {
    workDate: date,
    description: "",
    durationMinutes: "60",
    hourlyRate: "",
    ownerUserLabel: "",
    billable: true,
  };
}

/** 默认空费用表单。 */
export function createDefaultBillingExpenseFormState(date = dayjs().format("YYYY-MM-DD")): BillingExpenseFormState {
  return {
    expenseDate: date,
    category: "",
    amount: "",
    note: "",
  };
}

/** 把工时记录回填到表单。 */
export function buildBillingTimeFormState(entry: BillingTimeEntry): BillingTimeFormState {
  return {
    id: entry.id,
    workDate: entry.workDate,
    description: entry.description,
    durationMinutes: String(entry.durationMinutes),
    hourlyRate: entry.hourlyRate > 0 ? String(entry.hourlyRate) : "",
    ownerUserLabel: entry.ownerUserLabel,
    billable: entry.billable,
  };
}

/** 把费用记录回填到表单。 */
export function buildBillingExpenseFormState(entry: BillingExpenseEntry): BillingExpenseFormState {
  return {
    id: entry.id,
    expenseDate: entry.expenseDate,
    category: entry.category,
    amount: String(entry.amount),
    note: entry.note,
  };
}

/** 案件汇总列表需要把无记录案件补成零值行。 */
export function mergeBillingCaseSummaries(cases: CaseRecord[], summaries: BillingCaseSummary[]) {
  const summaryByCaseId = new Map(summaries.map((item) => [item.caseId, item]));
  const merged = cases.map((caseItem) => {
    const matched = summaryByCaseId.get(caseItem.id);
    if (matched) {
      return {
        ...matched,
        caseNameSnapshot: caseItem.name,
        casePathSnapshot: caseItem.casePath,
      };
    }
    return {
      caseId: caseItem.id,
      caseNameSnapshot: caseItem.name,
      casePathSnapshot: caseItem.casePath,
      currencyCode: "CNY",
      defaultHourlyRate: 0,
      totalDurationMinutes: 0,
      timeAmount: 0,
      expenseAmount: 0,
      totalAmount: 0,
      timeEntryCount: 0,
      expenseEntryCount: 0,
    } satisfies BillingCaseSummary;
  });
  return merged.sort((left, right) => left.caseNameSnapshot.localeCompare(right.caseNameSnapshot, "zh-CN"));
}

/** 过滤案件汇总列表。 */
export function filterBillingCaseSummaries(summaries: BillingCaseSummary[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return summaries;
  }
  return summaries.filter((item) => {
    const haystack = [item.caseId, item.caseNameSnapshot, item.casePathSnapshot].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

/** 计算当前案件下的明细汇总。 */
export function calculateBillingDetailTotals(
  timeEntries: BillingTimeEntry[],
  expenseEntries: BillingExpenseEntry[],
): BillingDetailTotals {
  const totalDurationMinutes = timeEntries.reduce((sum, item) => sum + item.durationMinutes, 0);
  const timeAmount = roundCurrency(timeEntries.reduce((sum, item) => sum + item.amount, 0));
  const expenseAmount = roundCurrency(expenseEntries.reduce((sum, item) => sum + item.amount, 0));
  return {
    totalDurationMinutes,
    timeAmount,
    expenseAmount,
    totalAmount: roundCurrency(timeAmount + expenseAmount),
  };
}

/** 工时分钟数格式化为小时+分钟。 */
export function formatBillingDuration(durationMinutes: number) {
  const safeMinutes = Math.max(0, Math.trunc(durationMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  return `${minutes}分钟`;
}

/** 金额统一格式化为人民币。 */
export function formatBillingCurrency(amount: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** 统一格式化小时费率文案。 */
export function formatBillingRate(hourlyRate: number) {
  if (!hourlyRate) {
    return "未设置";
  }
  return `${formatBillingCurrency(hourlyRate)}/小时`;
}

/** 校验工时表单。 */
export function validateBillingTimeFormState(formState: BillingTimeFormState): BillingTimeFormErrors {
  const nextErrors: BillingTimeFormErrors = {};
  if (!isStrictBillingDate(formState.workDate)) {
    nextErrors.workDate = "请选择有效的工作日期";
  }
  if (!formState.description.trim()) {
    nextErrors.description = "请输入事项说明";
  }
  const durationMinutes = Number(formState.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    nextErrors.durationMinutes = "时长不能为负数";
  }
  if (formState.hourlyRate.trim()) {
    const hourlyRate = Number(formState.hourlyRate);
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      nextErrors.hourlyRate = "费率不能为负数";
    }
  }
  return nextErrors;
}

/** 校验费用表单。 */
export function validateBillingExpenseFormState(formState: BillingExpenseFormState): BillingExpenseFormErrors {
  const nextErrors: BillingExpenseFormErrors = {};
  if (!isStrictBillingDate(formState.expenseDate)) {
    nextErrors.expenseDate = "请选择有效的费用日期";
  }
  if (!formState.category.trim()) {
    nextErrors.category = "请输入费用分类";
  }
  const amount = Number(formState.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    nextErrors.amount = "金额不能为负数";
  }
  return nextErrors;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function isStrictBillingDate(value: string) {
  if (!BILLING_DATE_PATTERN.test(value.trim())) {
    return false;
  }
  return dayjs(value).format("YYYY-MM-DD") === value;
}
