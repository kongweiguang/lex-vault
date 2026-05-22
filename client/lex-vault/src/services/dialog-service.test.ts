import { describe, expect, it } from "vitest";

import {
  getDialogStateSnapshot,
  resetDialogServiceForTest,
  resolveActiveDialog,
  showAlert,
  showConfirm,
  showPrompt,
} from "@/services/dialog-service";

describe("dialog-service", () => {
  it("queues dialogs and activates the next one after the current dialog resolves", async () => {
    resetDialogServiceForTest();

    const firstAlert = showAlert("第一条提示");
    const secondConfirm = showConfirm("第二条确认");

    expect(getDialogStateSnapshot()?.kind).toBe("alert");
    expect(getDialogStateSnapshot()?.options.message).toBe("第一条提示");

    resolveActiveDialog();
    await firstAlert;
    await Promise.resolve();

    expect(getDialogStateSnapshot()?.kind).toBe("confirm");
    expect(getDialogStateSnapshot()?.options.message).toBe("第二条确认");

    resolveActiveDialog(true);
    await expect(secondConfirm).resolves.toBe(true);
  });

  it("returns false when confirm dialog is cancelled", async () => {
    resetDialogServiceForTest();

    const confirmation = showConfirm("是否删除当前文件？");
    resolveActiveDialog(false);

    await expect(confirmation).resolves.toBe(false);
  });

  it("returns the prompt value when prompt dialog is confirmed", async () => {
    resetDialogServiceForTest();

    const prompt = showPrompt({
      title: "新建文件",
      message: "请输入文件名",
      defaultValue: "起诉状.md",
    });

    expect(getDialogStateSnapshot()?.kind).toBe("prompt");
    resolveActiveDialog("答辩状.md");

    await expect(prompt).resolves.toBe("答辩状.md");
  });

  it("keeps the same snapshot reference while the active dialog does not change", async () => {
    resetDialogServiceForTest();

    const alert = showAlert("稳定快照");
    const firstSnapshot = getDialogStateSnapshot();
    const secondSnapshot = getDialogStateSnapshot();

    expect(firstSnapshot).toBe(secondSnapshot);

    resolveActiveDialog();
    await alert;
  });
});
