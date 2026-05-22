import { invoke } from "@tauri-apps/api/core";

import type {
  BillingCaseSetting,
  BillingCaseSummary,
  BillingExpenseEntry,
  BillingTimeEntry,
} from "@/types/domain";

/** 按案件查询工时或费用列表。 */
export type BillingCaseQuery = {
  /** 关联案件 ID；为空时返回全部案件记录。 */
  caseId?: string;
};

/** 新增或更新案件默认费率。 */
export type BillingCaseSettingInput = {
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot?: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 币种编码，首版固定为 CNY。 */
  currencyCode?: string;
  /** 默认小时费率。 */
  defaultHourlyRate?: number;
};

/** 工时记录写入参数。 */
export type BillingTimeEntryInput = {
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot?: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 工作日期，格式 YYYY-MM-DD。 */
  workDate: string;
  /** 事项说明。 */
  description?: string;
  /** 时长，单位分钟。 */
  durationMinutes: number;
  /** 覆盖后的小时费率。 */
  hourlyRate?: number;
  /** 经办人标签。 */
  ownerUserLabel?: string;
  /** 是否可计费。 */
  billable?: boolean;
};

/** 费用记录写入参数。 */
export type BillingExpenseEntryInput = {
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot?: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 费用日期，格式 YYYY-MM-DD。 */
  expenseDate: string;
  /** 费用分类。 */
  category: string;
  /** 金额。 */
  amount: number;
  /** 备注说明。 */
  note?: string;
};

/** 查询案件默认计费设置。 */
export function getBillingCaseSetting(caseId: string) {
  return invoke<BillingCaseSetting | null>("get_billing_case_setting_command", { caseId });
}

/** 保存案件默认计费设置。 */
export function upsertBillingCaseSetting(payload: BillingCaseSettingInput) {
  return invoke<BillingCaseSetting>("upsert_billing_case_setting_command", { payload });
}

/** 查询工时记录列表。 */
export function listBillingTimeEntries(query: BillingCaseQuery = {}) {
  return invoke<BillingTimeEntry[]>("list_billing_time_entries_command", { query });
}

/** 创建工时记录。 */
export function createBillingTimeEntry(payload: BillingTimeEntryInput) {
  return invoke<BillingTimeEntry>("create_billing_time_entry_command", { payload });
}

/** 更新工时记录。 */
export function updateBillingTimeEntry(entryId: string, payload: Partial<BillingTimeEntryInput>) {
  return invoke<BillingTimeEntry>("update_billing_time_entry_command", { entryId, payload });
}

/** 删除工时记录。 */
export function deleteBillingTimeEntry(entryId: string) {
  return invoke<void>("delete_billing_time_entry_command", { entryId });
}

/** 查询费用记录列表。 */
export function listBillingExpenseEntries(query: BillingCaseQuery = {}) {
  return invoke<BillingExpenseEntry[]>("list_billing_expense_entries_command", { query });
}

/** 创建费用记录。 */
export function createBillingExpenseEntry(payload: BillingExpenseEntryInput) {
  return invoke<BillingExpenseEntry>("create_billing_expense_entry_command", { payload });
}

/** 更新费用记录。 */
export function updateBillingExpenseEntry(entryId: string, payload: Partial<BillingExpenseEntryInput>) {
  return invoke<BillingExpenseEntry>("update_billing_expense_entry_command", { entryId, payload });
}

/** 删除费用记录。 */
export function deleteBillingExpenseEntry(entryId: string) {
  return invoke<void>("delete_billing_expense_entry_command", { entryId });
}

/** 查询案件维度计费汇总。 */
export function listBillingCaseSummaries() {
  return invoke<BillingCaseSummary[]>("list_billing_case_summaries_command");
}
