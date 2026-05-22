import { Monitor, Moon, Sun } from "lucide-react";

import type { AuthInfo, UserPackageSummary, UserProfileInfo } from "@/types/domain";

import type { LoginDialogState, ThemeOption } from "@/features/settings/settings-panel-types";

/** 设置页展示的三种主题模式。 */
export const themeOptions = [
  { label: "浅色", value: "light", icon: Sun },
  { label: "深色", value: "dark", icon: Moon },
  { label: "系统", value: "system", icon: Monitor },
] satisfies ThemeOption[];

/** 默认登录弹层状态。 */
export const defaultLoginDialogState: LoginDialogState = {
  username: "",
  password: "",
  code: "",
  uuid: "",
};

/** 默认 Codex profile ID，需要和应用启动时的 runtime 保持一致。 */
export const CODEX_PROFILE_ID = "lex-vault";

/** 计算设置页顶部展示名称。 */
export function resolveDisplayName(authInfo: AuthInfo | null, userProfile: UserProfileInfo | null) {
  return userProfile?.nickName || userProfile?.userName || authInfo?.username || "未登录账号";
}

/** 计算头像缩写。 */
export function resolveAvatarText(displayName: string) {
  return (displayName || "律").slice(0, 1).toUpperCase();
}

/** 拼接角色名称。 */
export function resolveRoleNames(userProfile: UserProfileInfo | null) {
  return userProfile?.roles?.map((role) => role.roleName || role.roleKey).filter(Boolean).join("、") || "";
}

/** 设置页额度进度条项。 */
export type QuotaProgressItem = {
  /** 窗口标签。 */
  label: string;
  /** 剩余额度百分比数值，范围 0-100。 */
  percent: number;
  /** 供界面直接展示的剩余额度百分比文案。 */
  percentText: string;
};

/** 解析设置页账号卡片展示的套餐名称。 */
export function resolvePackageLabel(packageSummary: UserPackageSummary | null) {
  const summary = packageSummary as (UserPackageSummary & Record<string, unknown>) | null;
  if (!summary) {
    return "";
  }

  const packageName = firstNonEmptyText(summary.packageName, summary.aiPackageName, summary.currentPackageName);
  const packageCode = firstNonEmptyText(summary.packageCode, summary.aiPackageCode, summary.currentPackageCode);
  return packageName || packageCode || "";
}

/** 解析设置页额度进度条。 */
export function resolveQuotaProgressItems(packageSummary: UserPackageSummary | null) {
  const summary = packageSummary as (UserPackageSummary & Record<string, unknown>) | null;
  if (!summary) {
    return [] satisfies QuotaProgressItem[];
  }

  const items = [
    createQuotaProgressItem(
      "5小时",
      summary.fiveHourQuotaPercent,
      summary.fiveHourUsagePercent,
      summary.fiveHourPercent,
    ),
    createQuotaProgressItem(
      "7天",
      summary.weeklyQuotaPercent,
      summary.weeklyUsagePercent,
      summary.weeklyPercent,
      summary.sevenDayQuotaPercent,
      summary.sevenDayUsagePercent,
      summary.sevenDayPercent,
    ),
    createQuotaProgressItem(
      "月",
      summary.monthlyQuotaPercent,
      summary.monthlyUsagePercent,
      summary.monthlyPercent,
    ),
  ].filter((item): item is QuotaProgressItem => item !== null);

  return items;
}

/** 解析设置页账号卡片展示的额度百分比摘要。 */
export function resolveQuotaSummary(packageSummary: UserPackageSummary | null) {
  return resolveQuotaProgressItems(packageSummary)
    .map((item) => `${item.label} 剩余 ${item.percentText}`)
    .join(" / ");
}

/** 取第一个非空文本值。 */
function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** 统一把后端返回的额度百分比转换为 0-100 数值。 */
function normalizePercentNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clampPercent(value);
    }
    if (typeof value === "string") {
      const trimmed = value.trim().replace(/%$/, "");
      if (!trimmed) {
        continue;
      }
      const numericValue = Number(trimmed);
      if (Number.isFinite(numericValue)) {
        return clampPercent(numericValue);
      }
    }
  }
  return null;
}

/** 生成单个剩余额度进度条项。 */
function createQuotaProgressItem(label: string, ...values: unknown[]) {
  const usedPercent = normalizePercentNumber(...values);
  if (usedPercent == null) {
    return null;
  }
  const remainingPercent = clampPercent(100 - usedPercent);
  return {
    label,
    percent: remainingPercent,
    percentText: `${trimTrailingZero(remainingPercent)}%`,
  } satisfies QuotaProgressItem;
}

/** 去除百分比小数末尾多余的 0。 */
function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/** 限制百分比数值范围，避免异常数据把进度条撑出边界。 */
function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

/** 判断登录按钮是否可提交。 */
export function isLoginButtonDisabled(
  loginDialog: LoginDialogState,
  captchaEnabled: boolean,
  isLoggingIn: boolean,
) {
  return (
    isLoggingIn ||
    !loginDialog.username.trim() ||
    !loginDialog.password ||
    (captchaEnabled && !loginDialog.code.trim())
  );
}

/** 将字节数格式化为更适合设置页阅读的单位。 */
export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
