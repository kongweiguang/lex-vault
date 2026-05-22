import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertCircle,
  CircleCheckBig,
  OctagonAlert,
  PencilLine,
  ShieldQuestion,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ActiveDialogState,
  type PromptDialogState,
  getDialogStateSnapshot,
  resolveActiveDialog,
  subscribeDialogState,
} from "@/services/dialog-service";

function isPromptDialog(dialog: ActiveDialogState | null): dialog is PromptDialogState {
  return dialog?.kind === "prompt";
}

function intentMeta(intent: "primary" | "danger" | "success" | "warning") {
  if (intent === "danger") {
    return {
      icon: OctagonAlert,
      iconClassName: "bg-rose-50 text-rose-600 ring-1 ring-rose-100",
      confirmClassName: "bg-rose-600 hover:bg-rose-700",
    };
  }
  if (intent === "success") {
    return {
      icon: CircleCheckBig,
      iconClassName: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100",
      confirmClassName: "bg-emerald-600 hover:bg-emerald-700",
    };
  }
  if (intent === "warning") {
    return {
      icon: ShieldQuestion,
      iconClassName: "bg-amber-50 text-amber-600 ring-1 ring-amber-100",
      confirmClassName: "bg-amber-500 text-slate-950 hover:bg-amber-400",
    };
  }
  return {
    icon: AlertCircle,
    iconClassName: "bg-blue-50 text-blue-600 ring-1 ring-blue-100",
    confirmClassName: "bg-[#1d4ed8] hover:bg-[#1e40af]",
  };
}

/**
 * @author kongweiguang
 * 全局自定义弹框宿主，统一承接 alert、confirm、prompt 的展示与交互。
 */
export function AppDialogHost() {
  const dialog = useSyncExternalStore(subscribeDialogState, getDialogStateSnapshot, getDialogStateSnapshot);
  const [promptValue, setPromptValue] = useState("");
  const promptInputRef = useRef<HTMLInputElement>(null);
  const promptOptions = isPromptDialog(dialog) ? dialog.options : null;

  useEffect(() => {
    if (!promptOptions) {
      setPromptValue("");
      return;
    }
    setPromptValue(promptOptions.defaultValue ?? "");
  }, [dialog?.id, promptOptions]);

  useEffect(() => {
    if (!promptOptions) {
      return;
    }
    window.setTimeout(() => {
      promptInputRef.current?.focus();
      promptInputRef.current?.select();
    }, 0);
  }, [dialog?.id, promptOptions]);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dialog.options.dismissible) {
        if (dialog.kind === "alert") {
          resolveActiveDialog();
          return;
        }
        resolveActiveDialog(dialog.kind === "confirm" ? false : null);
        return;
      }
      if (event.key !== "Enter" || dialog.kind !== "prompt") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) {
        return;
      }
      resolveActiveDialog(promptValue);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialog, promptValue]);

  if (!dialog) {
    return null;
  }

  const meta = intentMeta(dialog.options.intent);
  const Icon = dialog.kind === "prompt" ? PencilLine : meta.icon;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!dialog.options.dismissible) {
          return;
        }
        if (dialog.kind === "alert") {
          resolveActiveDialog();
          return;
        }
        resolveActiveDialog(dialog.kind === "confirm" ? false : null);
      }}
      role="dialog"
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-dialog-header-gradient px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-4">
              <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", meta.iconClassName)}>
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">{dialog.options.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{dialog.options.message}</p>
                {dialog.options.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{dialog.options.description}</p>
                ) : null}
              </div>
            </div>
            {dialog.options.dismissible ? (
              <Button
                aria-label="关闭弹框"
                onClick={() => {
                  if (dialog.kind === "alert") {
                    resolveActiveDialog();
                    return;
                  }
                  resolveActiveDialog(dialog.kind === "confirm" ? false : null);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>

        {dialog.kind === "prompt" ? (
          <div className="px-6 pb-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{promptOptions?.inputLabel}</span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setPromptValue(event.currentTarget.value)}
                placeholder={promptOptions?.placeholder}
                ref={promptInputRef}
                value={promptValue}
              />
            </label>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 bg-slate-50 px-6 py-5">
          {dialog.kind !== "alert" ? (
            <Button
              onClick={() => resolveActiveDialog(dialog.kind === "confirm" ? false : null)}
              type="button"
              variant="outline"
            >
              {dialog.options.cancelText}
            </Button>
          ) : null}
          <Button
            className={meta.confirmClassName}
            onClick={() => {
              if (dialog.kind === "alert") {
                resolveActiveDialog();
                return;
              }
              if (dialog.kind === "confirm") {
                resolveActiveDialog(true);
                return;
              }
              resolveActiveDialog(promptValue);
            }}
            type="button"
          >
            {dialog.options.confirmText}
          </Button>
        </div>
      </section>
    </div>
  );
}
