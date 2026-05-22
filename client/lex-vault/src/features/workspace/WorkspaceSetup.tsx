import { Check, Folder } from "lucide-react";

import { Button } from "@/components/ui/button";

type WorkspaceSetupProps = {
  isSaving: boolean;
  onChooseWorkspace: () => void;
  resolvedThemeMode: "light" | "dark";
};

/** 首次进入应用时的工作区初始化页面。 */
export function WorkspaceSetup({
  isSaving,
  onChooseWorkspace,
  resolvedThemeMode,
}: WorkspaceSetupProps) {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground"
      data-theme={resolvedThemeMode}
    >
      <section className="w-full max-w-lg rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]">
            <Folder className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">选择工作空间</h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
              业务文件和工作空间索引会直接放在所选工作空间下
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            disabled={isSaving}
            onClick={onChooseWorkspace}
            type="button"
          >
            <Check />
            {isSaving ? "正在保存" : "选择目录"}
          </Button>
        </div>
      </section>
    </main>
  );
}
