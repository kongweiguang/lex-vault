import { describe, expect, it, vi } from "vitest";

import { sendRecommendedQuestion } from "@/features/chat/components/chat-empty-state";
import type { ChatAttachment } from "@/types/domain";

describe("sendRecommendedQuestion", () => {
  it("sends the recommended question through the business pipeline with hidden context", async () => {
    const onQuestionSelect = vi.fn().mockResolvedValue(undefined);
    const attachments: ChatAttachment[] = [
      {
        id: "case-1",
        name: "证据目录",
        type: "case-path",
        path: "C:\\cases\\A\\证据目录",
        rootPath: "C:\\cases\\A",
        relativePath: "证据目录",
        nodeType: "folder",
        sourceLabel: "案件材料",
      },
    ];

    await sendRecommendedQuestion({
      question: "根据当前案件材料，梳理案件事实",
      contextAttachments: attachments,
      onQuestionSelect,
    });

    expect(onQuestionSelect).toHaveBeenCalledTimes(1);
    expect(onQuestionSelect).toHaveBeenCalledWith(
      expect.stringContaining("根据当前案件材料，梳理案件事实"),
      "根据当前案件材料，梳理案件事实",
    );
    expect(onQuestionSelect.mock.calls[0]?.[0]).toContain("<case-material");
    expect(onQuestionSelect.mock.calls[0]?.[0]).toContain("绝对路径：C:\\cases\\A\\证据目录");
  });

  it("does nothing when no send callback is provided", async () => {
    await expect(sendRecommendedQuestion({ question: "测试问题" })).resolves.toBeUndefined();
  });
});
