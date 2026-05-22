import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Clock3,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { showAlert, showConfirm } from "@/services/dialog-service";
import {
  createBillingExpenseEntry,
  createBillingTimeEntry,
  deleteBillingExpenseEntry,
  deleteBillingTimeEntry,
  getBillingCaseSetting,
  listBillingCaseSummaries,
  listBillingExpenseEntries,
  listBillingTimeEntries,
  updateBillingExpenseEntry,
  updateBillingTimeEntry,
  upsertBillingCaseSetting,
} from "@/services/billing-service";
import {
  buildBillingExpenseFormState,
  buildBillingTimeFormState,
  calculateBillingDetailTotals,
  createDefaultBillingExpenseFormState,
  createDefaultBillingTimeFormState,
  filterBillingCaseSummaries,
  formatBillingCurrency,
  formatBillingDuration,
  formatBillingRate,
  mergeBillingCaseSummaries,
  validateBillingExpenseFormState,
  validateBillingTimeFormState,
  type BillingExpenseFormErrors,
  type BillingExpenseFormState,
  type BillingTimeFormErrors,
  type BillingTimeFormState,
} from "@/features/billing/billing-helpers";
import type { BillingCaseSummary, BillingExpenseEntry, BillingTimeEntry, CaseRecord } from "@/types/domain";

const INPUT_CLASS_NAME =
  "h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 text-sm text-[color:var(--color-card-foreground)] outline-none transition placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-primary)]";

/** 小数金额输入统一使用文本框规避 Tauri WebView 原生 number 控件的输入中间态崩溃。 */
const DECIMAL_INPUT_PROPS = {
  inputMode: "decimal",
  type: "text",
} as const;

/** 分钟数输入统一使用文本框，提交前仍由表单校验保证是非负数字。 */
const NUMERIC_INPUT_PROPS = {
  inputMode: "numeric",
  type: "text",
} as const;

/**
 * @author kongweiguang
 * 工具页中的工时计费工作区，负责案件汇总、默认费率、工时记录和费用记录操作。
 */
export function BillingPanel({
  cases,
  onBack,
}: {
  /** 当前工作空间下的案件列表。 */
  cases: CaseRecord[];
  /** 返回工具首页。 */
  onBack: () => void;
}) {
  const [summaryQuery, setSummaryQuery] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(cases[0]?.id ?? null);
  const [caseSettingRate, setCaseSettingRate] = useState("0");
  const [summaries, setSummaries] = useState<BillingCaseSummary[]>([]);
  const [timeEntries, setTimeEntries] = useState<BillingTimeEntry[]>([]);
  const [expenseEntries, setExpenseEntries] = useState<BillingExpenseEntry[]>([]);
  const [timeForm, setTimeForm] = useState<BillingTimeFormState>(createDefaultBillingTimeFormState);
  const [expenseForm, setExpenseForm] = useState<BillingExpenseFormState>(createDefaultBillingExpenseFormState);
  const [caseSettingRevision, setCaseSettingRevision] = useState(0);
  const [timeFormRevision, setTimeFormRevision] = useState(0);
  const [expenseFormRevision, setExpenseFormRevision] = useState(0);
  const [timeFormErrors, setTimeFormErrors] = useState<BillingTimeFormErrors>({});
  const [expenseFormErrors, setExpenseFormErrors] = useState<BillingExpenseFormErrors>({});
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSavingRate, setIsSavingRate] = useState(false);
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const caseSettingRateInputRef = useRef<HTMLInputElement | null>(null);
  const timeFormRef = useRef<HTMLFormElement | null>(null);
  const expenseFormRef = useRef<HTMLFormElement | null>(null);

  const mergedSummaries = useMemo(() => mergeBillingCaseSummaries(cases, summaries), [cases, summaries]);
  const filteredSummaries = useMemo(
    () => filterBillingCaseSummaries(mergedSummaries, summaryQuery),
    [mergedSummaries, summaryQuery],
  );
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const detailTotals = useMemo(
    () => calculateBillingDetailTotals(timeEntries, expenseEntries),
    [expenseEntries, timeEntries],
  );

  useEffect(() => {
    if (!cases.length) {
      setSelectedCaseId(null);
      return;
    }
    if (!selectedCaseId || !cases.some((item) => item.id === selectedCaseId)) {
      setSelectedCaseId(cases[0]?.id ?? null);
    }
  }, [cases, selectedCaseId]);

  useEffect(() => {
    void refreshSummaries();
  }, [cases]);

  useEffect(() => {
    if (!selectedCaseId) {
      setTimeEntries([]);
      setExpenseEntries([]);
      setCaseSettingRate("0");
      return;
    }
    void refreshCaseDetail(selectedCaseId);
  }, [selectedCaseId]);

  async function refreshSummaries() {
    setIsSummaryLoading(true);
    try {
      setSummaries(await listBillingCaseSummaries());
    } catch (error) {
      console.error("读取案件计费汇总失败", error);
      await showAlert({
        title: "读取失败",
        message: "无法读取案件计费汇总，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setIsSummaryLoading(false);
    }
  }

  async function refreshCaseDetail(caseId: string) {
    const currentCase = cases.find((item) => item.id === caseId);
    if (!currentCase) {
      return;
    }
    setIsDetailLoading(true);
    try {
      const [nextSetting, nextTimeEntries, nextExpenseEntries] = await Promise.all([
        getBillingCaseSetting(caseId),
        listBillingTimeEntries({ caseId }),
        listBillingExpenseEntries({ caseId }),
      ]);
      setCaseSettingRate(String(nextSetting?.defaultHourlyRate ?? 0));
      setTimeEntries(nextTimeEntries);
      setExpenseEntries(nextExpenseEntries);
      resetTimeForm();
      resetExpenseForm();
      setCaseSettingRevision((current) => current + 1);
      setTimeFormErrors({});
      setExpenseFormErrors({});
    } catch (error) {
      console.error("读取案件计费明细失败", error);
      await showAlert({
        title: "读取失败",
        message: `无法读取案件“${currentCase.name}”的计费明细，请稍后重试。`,
        intent: "warning",
      });
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleSaveCaseRate() {
    if (!selectedCase) {
      return;
    }
    const nextCaseSettingRate = caseSettingRateInputRef.current?.value ?? caseSettingRate;
    const parsedRate = Number(nextCaseSettingRate.trim() || "0");
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      await showAlert({
        title: "费率无效",
        message: "案件默认小时费率不能为负数。",
        intent: "warning",
      });
      return;
    }

    setIsSavingRate(true);
    try {
      setCaseSettingRate(nextCaseSettingRate);
      await upsertBillingCaseSetting({
        caseId: selectedCase.id,
        caseNameSnapshot: selectedCase.name,
        casePathSnapshot: selectedCase.casePath,
        currencyCode: "CNY",
        defaultHourlyRate: parsedRate,
      });
      await Promise.all([refreshSummaries(), refreshCaseDetail(selectedCase.id)]);
    } catch (error) {
      console.error("保存案件默认费率失败", error);
      await showAlert({
        title: "保存失败",
        message: "案件默认费率保存失败，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setIsSavingRate(false);
    }
  }

  async function handleSaveTimeEntry() {
    if (!selectedCase) {
      return;
    }
    const currentTimeForm = readBillingTimeFormState(timeFormRef.current, timeForm);
    const nextErrors = validateBillingTimeFormState(currentTimeForm);
    setTimeFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSavingTime(true);
    try {
      const payload = {
        caseId: selectedCase.id,
        caseNameSnapshot: selectedCase.name,
        casePathSnapshot: selectedCase.casePath,
        workDate: currentTimeForm.workDate,
        description: currentTimeForm.description.trim(),
        durationMinutes: Number(currentTimeForm.durationMinutes),
        hourlyRate: currentTimeForm.hourlyRate.trim() ? Number(currentTimeForm.hourlyRate) : undefined,
        ownerUserLabel: currentTimeForm.ownerUserLabel.trim(),
        billable: currentTimeForm.billable,
      };
      if (currentTimeForm.id) {
        await updateBillingTimeEntry(currentTimeForm.id, payload);
      } else {
        await createBillingTimeEntry(payload);
      }
      await Promise.all([refreshSummaries(), refreshCaseDetail(selectedCase.id)]);
    } catch (error) {
      console.error("保存工时记录失败", error);
      await showAlert({
        title: "保存失败",
        message: "工时记录保存失败，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setIsSavingTime(false);
    }
  }

  async function handleDeleteTimeEntry(entry: BillingTimeEntry) {
    const confirmed = await showConfirm({
      title: "删除工时记录",
      message: `确认删除“${entry.description || entry.workDate}”这条工时记录吗？`,
      confirmText: "删除",
      cancelText: "取消",
      intent: "danger",
    });
    if (!confirmed || !selectedCase) {
      return;
    }

    try {
      await deleteBillingTimeEntry(entry.id);
      await Promise.all([refreshSummaries(), refreshCaseDetail(selectedCase.id)]);
    } catch (error) {
      console.error("删除工时记录失败", error);
      await showAlert({
        title: "删除失败",
        message: "工时记录删除失败，请稍后重试。",
        intent: "warning",
      });
    }
  }

  async function handleSaveExpenseEntry() {
    if (!selectedCase) {
      return;
    }
    const currentExpenseForm = readBillingExpenseFormState(expenseFormRef.current, expenseForm);
    const nextErrors = validateBillingExpenseFormState(currentExpenseForm);
    setExpenseFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSavingExpense(true);
    try {
      const payload = {
        caseId: selectedCase.id,
        caseNameSnapshot: selectedCase.name,
        casePathSnapshot: selectedCase.casePath,
        expenseDate: currentExpenseForm.expenseDate,
        category: currentExpenseForm.category.trim(),
        amount: Number(currentExpenseForm.amount),
        note: currentExpenseForm.note.trim(),
      };
      if (currentExpenseForm.id) {
        await updateBillingExpenseEntry(currentExpenseForm.id, payload);
      } else {
        await createBillingExpenseEntry(payload);
      }
      await Promise.all([refreshSummaries(), refreshCaseDetail(selectedCase.id)]);
    } catch (error) {
      console.error("保存费用记录失败", error);
      await showAlert({
        title: "保存失败",
        message: "费用记录保存失败，请稍后重试。",
        intent: "warning",
      });
    } finally {
      setIsSavingExpense(false);
    }
  }

  function resetTimeForm() {
    setTimeForm(createDefaultBillingTimeFormState());
    setTimeFormRevision((current) => current + 1);
  }

  function resetExpenseForm() {
    setExpenseForm(createDefaultBillingExpenseFormState());
    setExpenseFormRevision((current) => current + 1);
  }

  function editTimeForm(entry: BillingTimeEntry) {
    setTimeForm(buildBillingTimeFormState(entry));
    setTimeFormErrors({});
    setTimeFormRevision((current) => current + 1);
  }

  function editExpenseForm(entry: BillingExpenseEntry) {
    setExpenseForm(buildBillingExpenseFormState(entry));
    setExpenseFormErrors({});
    setExpenseFormRevision((current) => current + 1);
  }

  async function handleDeleteExpenseEntry(entry: BillingExpenseEntry) {
    const confirmed = await showConfirm({
      title: "删除费用记录",
      message: `确认删除“${entry.category}”这条费用记录吗？`,
      confirmText: "删除",
      cancelText: "取消",
      intent: "danger",
    });
    if (!confirmed || !selectedCase) {
      return;
    }

    try {
      await deleteBillingExpenseEntry(entry.id);
      await Promise.all([refreshSummaries(), refreshCaseDetail(selectedCase.id)]);
    } catch (error) {
      console.error("删除费用记录失败", error);
      await showAlert({
        title: "删除失败",
        message: "费用记录删除失败，请稍后重试。",
        intent: "warning",
      });
    }
  }

  return (
    <section className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="border-b border-[color:var(--color-border)] px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]">
                <Wallet className="size-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-primary)] uppercase">Billing</p>
                <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-card-foreground)]">工时记录与计费</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                  当前工具页先落地工作空间本地计费能力，围绕案件维护默认费率、工时记录、费用记录和汇总，不生成正式账单。
                </p>
              </div>
            </div>
            <Button onClick={onBack} type="button" variant="outline">
              <ArrowLeft />
              返回工具首页
            </Button>
          </div>
        </header>

        {!cases.length ? (
          <div className="px-6 py-10">
            <div className="rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)] px-6 py-10 text-center">
              <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">当前还没有案件</p>
              <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
                先到“案件”工作区创建案件后，再回来记录工时和费用。
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 px-6 py-6 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.35fr)]">
            <aside className="grid gap-5">
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">案件汇总</h2>
                    <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">按案件查看工时、费用与总额概览。</p>
                  </div>
                  {isSummaryLoading ? <LoaderCircle className="size-4 animate-spin text-[color:var(--color-primary)]" /> : null}
                </div>
                <div className="relative mt-4">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
                  <input
                    className={`${INPUT_CLASS_NAME} pl-9`}
                    onChange={(event) => setSummaryQuery(event.currentTarget.value)}
                    placeholder="搜索案件名称"
                    type="text"
                    value={summaryQuery}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {filteredSummaries.map((summary) => {
                    const selected = summary.caseId === selectedCaseId;
                    return (
                      <button
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? "border-[color:var(--color-primary)] bg-[color:var(--color-secondary)]"
                            : "border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:border-[color:var(--color-primary)]/30"
                        }`}
                        key={summary.caseId}
                        onClick={() => setSelectedCaseId(summary.caseId)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-[color:var(--color-card-foreground)]">
                              {summary.caseNameSnapshot}
                            </p>
                            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{formatBillingRate(summary.defaultHourlyRate)}</p>
                          </div>
                          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-2.5 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                            {formatBillingDuration(summary.totalDurationMinutes)}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <SummaryMetric label="工时应收" value={formatBillingCurrency(summary.timeAmount)} />
                          <SummaryMetric label="费用合计" value={formatBillingCurrency(summary.expenseAmount)} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-[color:var(--color-muted-foreground)]">总额</span>
                          <span className="font-semibold text-[color:var(--color-card-foreground)]">
                            {formatBillingCurrency(summary.totalAmount)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {!filteredSummaries.length ? (
                    <div className="rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
                      没有匹配的案件汇总。
                    </div>
                  ) : null}
                </div>
              </section>
            </aside>

            <div className="grid gap-5">
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--color-muted-foreground)]">
                      <BriefcaseBusiness className="size-4" />
                      当前案件
                    </div>
                    <h2 className="mt-2 truncate text-xl font-semibold text-[color:var(--color-card-foreground)]">
                      {selectedCase?.name || "未选择案件"}
                    </h2>
                    <p className="mt-2 truncate text-sm text-[color:var(--color-muted-foreground)]">{selectedCase?.casePath || ""}</p>
                  </div>
                  {isDetailLoading ? <LoaderCircle className="size-4 animate-spin text-[color:var(--color-primary)]" /> : null}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <SummaryMetricCard icon={Clock3} label="累计工时" value={formatBillingDuration(detailTotals.totalDurationMinutes)} />
                  <SummaryMetricCard icon={Wallet} label="工时应收" value={formatBillingCurrency(detailTotals.timeAmount)} />
                  <SummaryMetricCard icon={Wallet} label="费用合计" value={formatBillingCurrency(detailTotals.expenseAmount)} />
                  <SummaryMetricCard icon={Wallet} label="总额" value={formatBillingCurrency(detailTotals.totalAmount)} />
                </div>

                <div className="mt-5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[color:var(--color-card-foreground)]">案件默认小时费率</h3>
                      <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">工时录入时默认带出，可在单条记录中覆盖。</p>
                    </div>
                    <Button disabled={isSavingRate || !selectedCase} onClick={() => void handleSaveCaseRate()} type="button">
                      {isSavingRate ? <LoaderCircle className="animate-spin" /> : <Save />}
                      保存费率
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
                    <div className="block">
                      <span className="text-sm font-medium text-[color:var(--color-card-foreground)]">默认小时费率</span>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          {...DECIMAL_INPUT_PROPS}
                          className={INPUT_CLASS_NAME}
                          defaultValue={caseSettingRate}
                          key={`${selectedCaseId ?? "empty"}-${caseSettingRevision}`}
                          ref={caseSettingRateInputRef}
                        />
                        <span className="text-sm text-[color:var(--color-muted-foreground)]">元/小时</span>
                      </div>
                    </div>
                    <div className="block">
                      <span className="text-sm font-medium text-[color:var(--color-card-foreground)]">案件</span>
                      <Select
                        onChange={(event) => setSelectedCaseId(event.currentTarget.value || null)}
                        surface="background"
                        value={selectedCaseId ?? ""}
                        wrapperClassName="mt-2"
                      >
                        {cases.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 xl:grid-cols-2">
                <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">工时记录</h3>
                      <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">记录办案工时、费率和经办人。</p>
                    </div>
                    <Button
                      onClick={() => {
                        resetTimeForm();
                        setTimeFormErrors({});
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Plus />
                      新建
                    </Button>
                  </div>

                  <form
                    className="mt-4 grid gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4"
                    key={`time-${timeForm.id ?? "new"}-${timeFormRevision}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveTimeEntry();
                    }}
                    ref={timeFormRef}
                  >
                    <FormField label="案件">
                      <input className={INPUT_CLASS_NAME} defaultValue={selectedCase?.name || ""} disabled type="text" />
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField error={timeFormErrors.workDate} label="工作日期">
                        <input
                          className={INPUT_CLASS_NAME}
                          defaultValue={timeForm.workDate}
                          name="workDate"
                          type="date"
                        />
                      </FormField>
                      <FormField error={timeFormErrors.durationMinutes} label="时长（分钟）">
                        <input
                          {...NUMERIC_INPUT_PROPS}
                          className={INPUT_CLASS_NAME}
                          defaultValue={timeForm.durationMinutes}
                          name="durationMinutes"
                        />
                      </FormField>
                    </div>
                    <FormField error={timeFormErrors.description} label="事项说明">
                      <input
                        className={INPUT_CLASS_NAME}
                        defaultValue={timeForm.description}
                        name="description"
                        type="text"
                      />
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField error={timeFormErrors.hourlyRate} label="覆盖小时费率">
                        <input
                          {...DECIMAL_INPUT_PROPS}
                          className={INPUT_CLASS_NAME}
                          defaultValue={timeForm.hourlyRate}
                          name="hourlyRate"
                          placeholder="留空则使用默认费率"
                        />
                      </FormField>
                      <FormField label="经办人">
                        <input
                          className={INPUT_CLASS_NAME}
                          defaultValue={timeForm.ownerUserLabel}
                          name="ownerUserLabel"
                          type="text"
                        />
                      </FormField>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[color:var(--color-card-foreground)]">
                      <input
                        className="size-4 rounded border-[color:var(--color-border)]"
                        defaultChecked={timeForm.billable}
                        name="billable"
                        type="checkbox"
                      />
                      计入应收金额
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={isSavingTime || !selectedCase} onClick={() => void handleSaveTimeEntry()} type="button">
                        {isSavingTime ? <LoaderCircle className="animate-spin" /> : <Save />}
                        {timeForm.id ? "保存工时" : "新增工时"}
                      </Button>
                      {timeForm.id ? (
                        <Button
                          onClick={() => {
                            resetTimeForm();
                            setTimeFormErrors({});
                          }}
                          type="button"
                          variant="outline"
                        >
                          取消编辑
                        </Button>
                      ) : null}
                    </div>
                  </form>

                  <div className="mt-4 grid gap-3">
                    {timeEntries.map((entry) => (
                      <article className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" key={entry.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{entry.description || "未命名工时"}</p>
                            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                              {entry.workDate} · {formatBillingDuration(entry.durationMinutes)} · {entry.ownerUserLabel || "未填写经办人"}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
                              费率 {formatBillingRate(entry.hourlyRate)} · {entry.billable ? "可计费" : "不计费"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{formatBillingCurrency(entry.amount)}</p>
                            <div className="mt-3 flex justify-end gap-2">
                              <Button onClick={() => editTimeForm(entry)} size="icon" type="button" variant="outline">
                                <Pencil />
                              </Button>
                              <Button onClick={() => void handleDeleteTimeEntry(entry)} size="icon" type="button" variant="outline">
                                <Trash2 />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                    {!timeEntries.length ? (
                      <div className="rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
                        当前案件还没有工时记录。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">费用记录</h3>
                      <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">记录案件相关支出，便于和工时一起核算。</p>
                    </div>
                    <Button
                      onClick={() => {
                        resetExpenseForm();
                        setExpenseFormErrors({});
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Plus />
                      新建
                    </Button>
                  </div>

                  <form
                    className="mt-4 grid gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4"
                    key={`expense-${expenseForm.id ?? "new"}-${expenseFormRevision}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveExpenseEntry();
                    }}
                    ref={expenseFormRef}
                  >
                    <FormField label="案件">
                      <input className={INPUT_CLASS_NAME} defaultValue={selectedCase?.name || ""} disabled type="text" />
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField error={expenseFormErrors.expenseDate} label="费用日期">
                        <input
                          className={INPUT_CLASS_NAME}
                          defaultValue={expenseForm.expenseDate}
                          name="expenseDate"
                          type="date"
                        />
                      </FormField>
                      <FormField error={expenseFormErrors.amount} label="金额">
                        <input
                          {...DECIMAL_INPUT_PROPS}
                          className={INPUT_CLASS_NAME}
                          defaultValue={expenseForm.amount}
                          name="amount"
                        />
                      </FormField>
                    </div>
                    <FormField error={expenseFormErrors.category} label="费用分类">
                      <input
                        className={INPUT_CLASS_NAME}
                        defaultValue={expenseForm.category}
                        name="category"
                        type="text"
                      />
                    </FormField>
                    <FormField label="备注">
                      <input
                        className={INPUT_CLASS_NAME}
                        defaultValue={expenseForm.note}
                        name="note"
                        type="text"
                      />
                    </FormField>
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={isSavingExpense || !selectedCase} onClick={() => void handleSaveExpenseEntry()} type="button">
                        {isSavingExpense ? <LoaderCircle className="animate-spin" /> : <Save />}
                        {expenseForm.id ? "保存费用" : "新增费用"}
                      </Button>
                      {expenseForm.id ? (
                        <Button
                          onClick={() => {
                            resetExpenseForm();
                            setExpenseFormErrors({});
                          }}
                          type="button"
                          variant="outline"
                        >
                          取消编辑
                        </Button>
                      ) : null}
                    </div>
                  </form>

                  <div className="mt-4 grid gap-3">
                    {expenseEntries.map((entry) => (
                      <article className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" key={entry.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{entry.category}</p>
                            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{entry.expenseDate}</p>
                            <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{entry.note || "未填写备注"}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-[color:var(--color-card-foreground)]">{formatBillingCurrency(entry.amount)}</p>
                            <div className="mt-3 flex justify-end gap-2">
                              <Button onClick={() => editExpenseForm(entry)} size="icon" type="button" variant="outline">
                                <Pencil />
                              </Button>
                              <Button onClick={() => void handleDeleteExpenseEntry(entry)} size="icon" type="button" variant="outline">
                                <Trash2 />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                    {!expenseEntries.length ? (
                      <div className="rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
                        当前案件还没有费用记录。
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-3">
      <p className="text-xs text-[color:var(--color-muted-foreground)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[color:var(--color-card-foreground)]">{value}</p>
    </div>
  );
}

function SummaryMetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-4">
      <div className="flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-3 text-base font-semibold text-[color:var(--color-card-foreground)]">{value}</p>
    </div>
  );
}

function readBillingTimeFormState(form: HTMLFormElement | null, fallback: BillingTimeFormState): BillingTimeFormState {
  return {
    id: fallback.id,
    workDate: readFormTextValue(form, "workDate", fallback.workDate),
    description: readFormTextValue(form, "description", fallback.description),
    durationMinutes: readFormTextValue(form, "durationMinutes", fallback.durationMinutes),
    hourlyRate: readFormTextValue(form, "hourlyRate", fallback.hourlyRate),
    ownerUserLabel: readFormTextValue(form, "ownerUserLabel", fallback.ownerUserLabel),
    billable: readFormCheckboxValue(form, "billable", fallback.billable),
  };
}

function readBillingExpenseFormState(form: HTMLFormElement | null, fallback: BillingExpenseFormState): BillingExpenseFormState {
  return {
    id: fallback.id,
    expenseDate: readFormTextValue(form, "expenseDate", fallback.expenseDate),
    category: readFormTextValue(form, "category", fallback.category),
    amount: readFormTextValue(form, "amount", fallback.amount),
    note: readFormTextValue(form, "note", fallback.note),
  };
}

function readFormTextValue(form: HTMLFormElement | null, name: string, fallback: string) {
  const value = form ? new FormData(form).get(name) : null;
  return typeof value === "string" ? value : fallback;
}

function readFormCheckboxValue(form: HTMLFormElement | null, name: string, fallback: boolean) {
  const field = form?.elements.namedItem(name);
  if (field instanceof HTMLInputElement) {
    return field.checked;
  }
  return fallback;
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-sm font-medium text-[color:var(--color-card-foreground)]">{label}</span>
      <div className="mt-2">{children}</div>
      {error ? <p className="mt-2 text-xs text-amber-600">{error}</p> : null}
    </div>
  );
}
