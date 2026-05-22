import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, ChevronsDown, ChevronsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileSortState } from "@/utils/file-tree";

type FileSortPickerProps = {
  /** 当前文件树排序状态。 */
  sortState: FileSortState;
  /** 切换文件树排序状态。 */
  onSortChange: (sortState: FileSortState) => void;
  /** 排序按钮的无障碍名称。 */
  ariaLabel: string;
};

type FileTreeExpandToggleProps = {
  /** 当前是否已经展开全部文件夹。 */
  expanded: boolean;
  /** 是否禁用批量展开或收起操作。 */
  disabled: boolean;
  /** 切换全部文件夹展开状态。 */
  onToggle: () => void;
};

const SORT_OPTIONS: Array<FileSortState & { label: string; hint: string }> = [
  { key: "name", direction: "asc", label: "名称 A-Z", hint: "按文件名升序" },
  { key: "name", direction: "desc", label: "名称 Z-A", hint: "按文件名降序" },
  { key: "type", direction: "asc", label: "类型", hint: "同类型文件归在一起" },
  { key: "size", direction: "desc", label: "大小", hint: "大文件优先" },
  { key: "modifiedAt", direction: "desc", label: "最近", hint: "最近修改优先" },
];

/** 文件树排序菜单，避免原生 select 的选项样式不可控。 */
export function FileSortPicker({ sortState, onSortChange, ariaLabel }: FileSortPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption =
    SORT_OPTIONS.find((option) => option.key === sortState.key && option.direction === sortState.direction) ??
    SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  return (
    <div className="relative w-[132px] flex-none" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex h-9 w-full items-center gap-2 rounded-md border bg-white px-2.5 text-left text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-ring"
        onClick={() => setOpen((current) => !current)}
        title={ariaLabel}
        type="button"
      >
        <ArrowDownUp className="size-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate">{selectedOption.label}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 top-10 z-30 w-48 rounded-lg border bg-white p-1.5 shadow-xl">
          {SORT_OPTIONS.map((option) => {
            const selected = option.key === sortState.key && option.direction === sortState.direction;
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition",
                  selected ? "bg-blue-50 text-[#1d4ed8]" : "text-slate-700 hover:bg-slate-50",
                )}
                key={`${option.key}:${option.direction}`}
                onClick={() => {
                  onSortChange({ key: option.key, direction: option.direction });
                  setOpen(false);
                }}
                type="button"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {selected ? <Check className="size-3.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  <span className="block truncate text-xs text-slate-400">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 文件树一键展开或收起按钮，通过单个方向图标表达当前动作，避免工具栏出现叠加图标。 */
export function FileTreeExpandToggle({ expanded, disabled, onToggle }: FileTreeExpandToggleProps) {
  const label = expanded ? "收起全部文件夹" : "展开全部文件夹";
  const ToggleIcon = expanded ? ChevronsUp : ChevronsDown;
  return (
    <Button
      aria-label={label}
      className="h-9 border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-blue-50 hover:text-[#1d4ed8]"
      disabled={disabled}
      onClick={onToggle}
      size="icon"
      title={label}
      type="button"
      variant="outline"
    >
      <ToggleIcon className="size-4.5" />
    </Button>
  );
}
