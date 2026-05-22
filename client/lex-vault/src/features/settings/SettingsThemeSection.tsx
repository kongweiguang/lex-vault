import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/types/domain";

import { themeOptions } from "@/features/settings/settings-panel-helpers";

type SettingsThemeSectionProps = {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
};

/** 设置页主题切换区域。 */
export function SettingsThemeSection({ themeMode, onThemeModeChange }: SettingsThemeSectionProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">界面色调</h2>
      <div className="mt-4 grid gap-2 rounded-lg bg-slate-100 p-1 sm:grid-cols-3">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const isActive = themeMode === option.value;

          return (
            <button
              aria-pressed={isActive}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive && "bg-white text-[#1d4ed8] shadow-sm",
              )}
              key={option.value}
              onClick={() => onThemeModeChange(option.value)}
              type="button"
            >
              <Icon className="size-4" />
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
