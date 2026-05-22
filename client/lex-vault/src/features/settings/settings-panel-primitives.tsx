import type { LucideIcon } from "lucide-react";
import { Folder, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 设置页状态面板。 */
export function StatusPanel({
  icon: Icon,
  title,
  value,
  valueClassName,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
        <Icon className="size-4" />
        {title}
      </div>
      <p className={cn("mt-2 text-sm font-semibold text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

/** 登录弹层输入项。 */
export function DialogInput({
  label,
  value,
  onChange,
  icon: Icon,
  placeholder,
  type = "text",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  icon: LucideIcon;
  placeholder: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block">
      {label ? <span className="text-sm font-medium text-slate-700">{label}</span> : null}
      <div className={cn("relative", label ? "mt-2" : "")}>
        <Icon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          className="h-11 w-full rounded-md border bg-white pl-10 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      </div>
    </label>
  );
}

/** 配置目录输入项。 */
export function ConfigPathInput({
  label,
  value,
  onChange,
  onChoose,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onChoose: () => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_92px]">
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="h-10 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
            onChange={(event) => onChange(event.currentTarget.value)}
            value={value}
          />
        </div>
        <Button onClick={onChoose} type="button" variant="outline">
          <Folder />
          选择
        </Button>
      </div>
    </label>
  );
}
