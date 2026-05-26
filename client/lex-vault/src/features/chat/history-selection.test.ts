import { describe, expect, it } from "vitest";

import { shouldHydrateScopedHistorySelection } from "@/features/chat/history-selection";

describe("history-selection", () => {
  it("requests hydration when the scoped session has no cached messages yet", () => {
    expect(shouldHydrateScopedHistorySelection({}, "thr_1", null)).toBe(true);
    expect(shouldHydrateScopedHistorySelection({ thr_1: [] }, "thr_1", null)).toBe(true);
  });

  it("skips hydration when the session already has messages", () => {
    expect(
      shouldHydrateScopedHistorySelection(
        {
          thr_1: [
            {
              id: "msg_1",
              role: "assistant",
              content: "历史回答",
              createdAt: "2026-05-26T00:00:00.000Z",
            },
          ],
        },
        "thr_1",
        null,
      ),
    ).toBe(false);
  });

  it("skips duplicate hydration while the same session is already loading", () => {
    expect(shouldHydrateScopedHistorySelection({}, "thr_1", "thr_1")).toBe(false);
  });
});
