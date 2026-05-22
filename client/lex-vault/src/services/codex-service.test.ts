import { describe, expect, it } from "vitest";

import { describeCodexInvokeError, formatCodexUserFacingError } from "@/services/codex-service";

describe("codex-service", () => {
  it("maps model overload errors to a readable desktop message", () => {
    const message = formatCodexUserFacingError({
      code: "TURN_RUNTIME_ERROR",
      title: "Codex turn 执行出错",
      message: "Selected model is at capacity. Please try a different model.",
      recoverable: true,
      details: {
        error: {
          message: "Selected model is at capacity. Please try a different model.",
          codexErrorInfo: "serverOverloaded",
        },
      },
    });

    expect(message).toContain("模型通道正忙");
  });

  it("maps invoke errors to rate-limit message when backend returns a structured app error", () => {
    const message = describeCodexInvokeError({
      code: "TURN_RUNTIME_ERROR",
      title: "Codex turn 执行出错",
      message: "429 rate limit exceeded for current project",
      recoverable: true,
    });

    expect(message).toContain("额度或调用频率已达上限");
  });
});
