import type { FormEvent } from "react";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfigPathInput } from "@/features/settings/settings-panel-primitives";
import type { AppConfig } from "@/types/domain";

type SettingsPathsSectionProps = {
  draftConfig: AppConfig | null;
  isSaving: boolean;
  onSubmit: (event: FormEvent) => void;
  onUpdateWorkspaceRoot: (value: string) => void;
  onChooseWorkspaceRoot: () => void;
  onUpdateField: (field: "docTemplate" | "lawDirectory" | "caseRef" | "caseMaster", value: string) => void;
  onChooseFieldDirectory: (title: string, field: "docTemplate" | "lawDirectory" | "caseRef" | "caseMaster") => void;
};

/** 设置页本机路径配置区域。 */
export function SettingsPathsSection({
  draftConfig,
  isSaving,
  onSubmit,
  onUpdateWorkspaceRoot,
  onChooseWorkspaceRoot,
  onUpdateField,
  onChooseFieldDirectory,
}: SettingsPathsSectionProps) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">本机文件位置</h2>
      <form className="mt-4 space-y-4" onSubmit={onSubmit}>
        {draftConfig ? (
          <>
            <ConfigPathInput
              label="工作空间"
              onChange={onUpdateWorkspaceRoot}
              onChoose={onChooseWorkspaceRoot}
              value={draftConfig.workspaceRoot}
            />
            <ConfigPathInput
              label="文书模板"
              onChange={(value) => onUpdateField("docTemplate", value)}
              onChoose={() => onChooseFieldDirectory("选择文书模板目录", "docTemplate")}
              value={draftConfig.docTemplate}
            />
            <ConfigPathInput
              label="法规资料"
              onChange={(value) => onUpdateField("lawDirectory", value)}
              onChoose={() => onChooseFieldDirectory("选择法规资料目录", "lawDirectory")}
              value={draftConfig.lawDirectory}
            />
            <ConfigPathInput
              label="案例数据"
              onChange={(value) => onUpdateField("caseRef", value)}
              onChoose={() => onChooseFieldDirectory("选择案例数据目录", "caseRef")}
              value={draftConfig.caseRef}
            />
            <ConfigPathInput
              label="案件存储"
              onChange={(value) => onUpdateField("caseMaster", value)}
              onChoose={() => onChooseFieldDirectory("选择案件存储目录", "caseMaster")}
              value={draftConfig.caseMaster}
            />
          </>
        ) : (
          <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-500">正在加载配置</div>
        )}

        <div className="flex justify-end">
          <Button className="bg-[#1d4ed8]" disabled={!draftConfig || isSaving} type="submit">
            <Check />
            保存配置
          </Button>
        </div>
      </form>
    </section>
  );
}
