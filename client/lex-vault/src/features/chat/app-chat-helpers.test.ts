import { describe, expect, it } from "vitest";

import {
  appendAssistantDelta,
  appendAssistantToolOutputDelta,
  codexThreadToSummary,
  codexThreadToMessages,
  completeAssistantMessage,
  finalizeAssistantProcess,
  upsertAssistantFailure,
  upsertAssistantProcessDelta,
  upsertAssistantToolCall,
  completeToolMessage,
} from "@/features/chat/app-chat-helpers";
import type { ChatProcessItem } from "@/types/domain";
import type { CodexThreadRecord } from "@/types/codex";

describe("app-chat-helpers", () => {
  it("keeps process order stable and avoids duplicating final text into process area", () => {
    const startedMessages = upsertAssistantProcessDelta([], "turn_1", "reasoning", "先分析问题");
    const withToolStarted = upsertAssistantToolCall(startedMessages, {
      threadId: "thr_1",
      turnId: "turn_1",
      itemId: "tool_1",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
      path: "C:\\demo",
    });
    const withToolCompleted = completeToolMessage(withToolStarted, {
      threadId: "thr_1",
      turnId: "turn_1",
      itemId: "tool_1",
      kind: "commandExecution",
      status: "completed",
      outputPreview: "done",
    });
    const withDelta = appendAssistantDelta(withToolCompleted, "turn_1", "msg_final_1", "最终回答");
    const withCompleted = completeAssistantMessage(withDelta, "turn_1", "msg_final_1", "最终回答");
    const finalized = finalizeAssistantProcess(withCompleted, "turn_1");

    expect(finalized).toHaveLength(1);
    const assistant = finalized[0];
    expect(assistant.content).toBe("最终回答");
    expect(assistant.processText).toBe("先分析问题");
    expect(assistant.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(assistant.processItems?.[0]?.text).toBe("先分析问题");
    expect(assistant.processItems?.[1]?.toolCall?.status).toBe("complete");
    expect(assistant.processMeta?.completedAt).toBeTruthy();
  });

  it("keeps streamed final answer outside the process area while preserving commentary and tools", () => {
    const firstText = upsertAssistantProcessDelta([], "turn_multi_text", "commentary", "先说明计划", {
      itemId: "msg_a",
    });
    const withTool = upsertAssistantToolCall(firstText, {
      threadId: "thr_multi_text",
      turnId: "turn_multi_text",
      itemId: "tool_a",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
    });
    const withAnswer = appendAssistantDelta(withTool, "turn_multi_text", "msg_b", "最终结论");
    const finalized = finalizeAssistantProcess(withAnswer, "turn_multi_text");

    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.content).toBe("最终结论");
    expect(finalized[0]?.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(finalized[0]?.processItems?.[0]?.text).toBe("先说明计划");
  });

  it("removes duplicated live process text when the same itemId is promoted to final content", () => {
    const withProcess = upsertAssistantProcessDelta([], "turn_same_item", "commentary", "最终答案", {
      itemId: "msg_same",
    });
    const withFinalDelta = appendAssistantDelta(withProcess, "turn_same_item", "msg_same", "最终答案");
    const finalized = completeAssistantMessage(withFinalDelta, "turn_same_item", "msg_same", "最终答案");

    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.content).toBe("最终答案");
    expect(finalized[0]?.processItems).toEqual([]);
    expect(finalized[0]?.processText).toBeUndefined();
  });

  it("appends command output deltas instead of replacing the whole tool output", () => {
    const started = upsertAssistantToolCall([], {
      threadId: "thr_tool_delta",
      turnId: "turn_tool_delta",
      itemId: "tool_delta_1",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
    });
    const firstDelta = appendAssistantToolOutputDelta(started, {
      turnId: "turn_tool_delta",
      itemId: "tool_delta_1",
      kind: "commandExecution",
      delta: "line 1\n",
    });
    const secondDelta = appendAssistantToolOutputDelta(firstDelta, {
      turnId: "turn_tool_delta",
      itemId: "tool_delta_1",
      kind: "commandExecution",
      delta: "line 2\n",
    });

    const assistant = secondDelta[0];
    expect(assistant.toolCalls?.[0]?.outputPreview).toBe("line 1\nline 2\n");
    expect(assistant.processItems?.[0]?.toolCall?.outputPreview).toBe("line 1\nline 2\n");
  });

  it("keeps separate commentary blocks around tool calls and replaces completed snapshots", () => {
    const firstText = upsertAssistantProcessDelta([], "turn_inline", "commentary", "先看目录", {
      itemId: "msg_a",
    });
    const withTool = upsertAssistantToolCall(firstText, {
      threadId: "thr_inline",
      turnId: "turn_inline",
      itemId: "tool_a",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
    });
    const secondText = upsertAssistantProcessDelta(withTool, "turn_inline", "commentary", "再看输出", {
      itemId: "msg_b",
    });
    const completedSnapshot = upsertAssistantProcessDelta(secondText, "turn_inline", "commentary", "先看目录完整文本", {
      itemId: "msg_a",
      snapshot: true,
    });

    const assistant = completedSnapshot[0];
    expect(assistant.processItems?.map((item) => item.type)).toEqual(["text", "tool", "text"]);
    expect(assistant.processItems?.[0]?.text).toBe("先看目录完整文本");
    expect(assistant.processItems?.[1]?.toolCall?.command).toBe("dir");
    expect(assistant.processItems?.[2]?.text).toBe("再看输出");
    expect(assistant.processText).toBe("先看目录完整文本\n\n再看输出");
  });

  it("creates a new trailing text process block after tools even when itemId is missing", () => {
    const firstText = upsertAssistantProcessDelta([], "turn_no_id", "commentary", "先看目录");
    const firstContinuation = upsertAssistantProcessDelta(firstText, "turn_no_id", "commentary", "，继续补充");
    const withTool = upsertAssistantToolCall(firstContinuation, {
      threadId: "thr_no_id",
      turnId: "turn_no_id",
      itemId: "tool_no_id",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
    });
    const secondText = upsertAssistantProcessDelta(withTool, "turn_no_id", "commentary", "再看输出");
    const secondContinuation = upsertAssistantProcessDelta(secondText, "turn_no_id", "commentary", "，继续分析");

    const assistant = secondContinuation[0];
    expect(assistant.processItems?.map((item) => item.type)).toEqual(["text", "tool", "text"]);
    expect(assistant.processItems?.[0]?.text).toBe("先看目录，继续补充");
    expect(assistant.processItems?.[1]?.toolCall?.command).toBe("dir");
    expect(assistant.processItems?.[2]?.text).toBe("再看输出，继续分析");
    expect(assistant.processText).toBe("先看目录，继续补充\n\n再看输出，继续分析");
  });

  it("separates reasoning sections by segment key so later summaries do not replace earlier ones", () => {
    const firstSummary = upsertAssistantProcessDelta([], "turn_reasoning", "reasoning", "第一段摘要", {
      itemId: "reason_1",
      segmentKey: "summary:0",
    });
    const secondSummary = upsertAssistantProcessDelta(firstSummary, "turn_reasoning", "reasoning", "第二段摘要", {
      itemId: "reason_1",
      segmentKey: "summary:1",
    });
    const secondSummaryCompleted = upsertAssistantProcessDelta(secondSummary, "turn_reasoning", "reasoning", "第二段摘要完整", {
      itemId: "reason_1",
      segmentKey: "summary:1",
      snapshot: true,
    });

    const assistant = secondSummaryCompleted[0];
    expect(assistant.processItems?.map((item) => item.type)).toEqual(["text", "text"]);
    expect(assistant.processItems?.[0]?.text).toBe("第一段摘要");
    expect(assistant.processItems?.[1]?.text).toBe("第二段摘要完整");
    expect(assistant.processText).toBe("第一段摘要\n\n第二段摘要完整");
  });

  it("keeps failed turn in one assistant frame instead of creating a second recovery frame", () => {
    const startedMessages = upsertAssistantProcessDelta([], "turn_fail", "commentary", "先看目录", {
      itemId: "msg_fail_1",
    });
    const withTool = upsertAssistantToolCall(startedMessages, {
      threadId: "thr_fail",
      turnId: "turn_fail",
      itemId: "tool_fail_1",
      kind: "commandExecution",
      title: "执行命令：dir",
      command: "dir",
    });
    const withAnswer = appendAssistantDelta(withTool, "turn_fail", "msg_fail_answer", "先给出初步结论");
    const failed = upsertAssistantFailure(withAnswer, "turn_fail", "小助手出问题了，请联系开发者处理。");

    expect(failed).toHaveLength(1);
    expect(failed[0]?.role).toBe("error");
    expect(failed[0]?.content).toContain("先给出初步结论");
    expect(failed[0]?.content).toContain("当前回复未完成：小助手出问题了，请联系开发者处理。");
    expect(failed[0]?.processItems?.map((item: ChatProcessItem) => item.type)).toEqual(["text", "tool"]);
    expect(failed[0]?.toolCalls?.[0]?.status).toBe("error");
  });

  it("prefers final_answer and keeps phase-missing agent messages inside the process area", () => {
    const record: CodexThreadRecord = {
      id: "thr_1",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_1",
            createdAt: 1_700_000_000,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_1",
                  type: "userMessage",
                  text: "你好",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "reason_1",
                  type: "reasoning",
                  summary: [{ text: "思考摘要" }],
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_1",
                  type: "agentMessage",
                  phase: "commentary",
                  text: "先查资料",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_2",
                  type: "agentMessage",
                  text: "phase 缺失的兼容最终回答",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_3",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "显式最终回答",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.content).toBe("显式最终回答");
    expect(messages[1]?.processItems?.map((item) => item.type)).toEqual(["text", "text"]);
    expect(messages[1]?.processItems?.[0]?.text).toBe("思考摘要");
    expect(messages[1]?.processItems?.[1]?.text).toBe("先查资料");
  });

  it("uses the last phase-missing agent message as final content without process promotion", () => {
    const record: CodexThreadRecord = {
      id: "thr_2",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_2",
            createdAt: 1_700_000_100,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_2",
                  type: "userMessage",
                  text: "只有 completed 的回答",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_2a",
                  type: "agentMessage",
                  phase: "commentary",
                  text: "过程说明",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_2b",
                  type: "agentMessage",
                  text: "最终回退回答",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe("最终回退回答");
    expect(messages[1]?.processItems?.map((item) => item.text)).toEqual(["过程说明"]);
  });

  it("restores visible user question from wechat bridge prompt blocks", () => {
    const record: CodexThreadRecord = {
      id: "thr_wechat",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "<wechat-message>\n来源：微信普通会话。\n用户消息：\n你是谁\n</wechat-message>\n请直接回复这条微信消息。",
      preview: "<wechat-message>\n来源：微信普通会话。\n用户消息：\n你是谁\n</wechat-message>\n请直接回复这条微信消息。",
      turns: [
        {
          turn: {
            id: "turn_wechat",
            createdAt: 1_700_000_150,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_wechat",
                  type: "userMessage",
                  text: "<wechat-message>\n来源：微信普通会话。\n微信会话 ID：wx-1。\n用户消息：\n你是谁\n</wechat-message>\n请直接回复这条微信消息。",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_wechat",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "我是小隐。",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    const summary = codexThreadToSummary(record, {
      agentType: "default",
      casePath: "C:\\demo",
    });

    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("你是谁");
    expect(messages[1]?.content).toBe("我是小隐。");
    expect(summary.title).toBe("你是谁");
    expect(summary.preview).toBe("你是谁");
  });

  it("parses generic response-item message roles from real wechat history records", () => {
    const record: CodexThreadRecord = {
      id: "thr_wechat_message_role",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "<wechat-message>\n来源：微信普通会话。\n用户消息：\n今天武汉天气怎么样\n</wechat-message>\n请直接回复这条微信消息。",
      preview: "<wechat-message>\n来源：微信普通会话。\n用户消息：\n今天武汉天气怎么样\n</wechat-message>\n请直接回复这条微信消息。",
      turns: [
        {
          turn: {
            id: "turn_wechat_message_role",
            createdAt: 1_700_000_220,
            items: [
              {
                type: "response_item",
                payload: {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: "<wechat-message>\n来源：微信普通会话。\n微信会话 ID：wx-1。\n用户消息：\n今天武汉天气怎么样\n</wechat-message>\n请直接回复这条微信消息。",
                    },
                  ],
                },
              },
              {
                type: "response_item",
                payload: {
                  type: "message",
                  role: "assistant",
                  phase: "final_answer",
                  content: [
                    {
                      type: "output_text",
                      text: "武汉今天晴，稍微偏热。",
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    const summary = codexThreadToSummary(record, {
      agentType: "default",
      casePath: "C:\\demo",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("今天武汉天气怎么样");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toBe("武汉今天晴，稍微偏热。");
    expect(summary.title).toBe("今天武汉天气怎么样");
    expect(summary.preview).toBe("今天武汉天气怎么样");
  });

  it("restores mcp tool calls with user-facing tool names instead of raw item kinds", () => {
    const record: CodexThreadRecord = {
      id: "thr_mcp_history",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_mcp_history",
            createdAt: 1_700_000_260,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_1",
                  type: "userMessage",
                  text: "帮我记个日程",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "tool_mcp_1",
                  type: "mcpToolCall",
                  toolName: "calendar_create_event",
                  status: "running",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_1",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "已经开始创建日程。",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);

    expect(messages[1]?.processItems?.[0]?.toolCall?.name).toBe("调用工具：calendar_create_event工具");
    expect(messages[1]?.toolCalls?.[0]?.kind).toBe("mcpToolCall");
  });

  it("restores multimodal userMessage attachments from app-server content arrays", () => {
    const record: CodexThreadRecord = {
      id: "thr_multimodal",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_multimodal",
            createdAt: 1_700_000_180,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_multimodal",
                  type: "userMessage",
                  content: [
                    {
                      type: "text",
                      text: "请看这两张图",
                    },
                    {
                      type: "localImage",
                      path: "C:\\temp\\evidence.png",
                    },
                    {
                      type: "image",
                      url: "https://example.com/remote-proof.png",
                    },
                  ],
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_multimodal",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "我看到了两张图片。",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);

    expect(messages[0]?.content).toBe("请看这两张图");
    expect(messages[0]?.attachments).toEqual([
      expect.objectContaining({
        name: "evidence.png",
        type: "image",
        path: "C:\\temp\\evidence.png",
      }),
      expect.objectContaining({
        name: "remote-proof.png",
        type: "image",
        url: "https://example.com/remote-proof.png",
      }),
    ]);
  });

  it("keeps process-only history turns visible and preserves original order", () => {
    const record: CodexThreadRecord = {
      id: "thr_4",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_4",
            createdAt: 1_700_000_200,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_4",
                  type: "userMessage",
                  text: "帮我看看执行过程",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_4a",
                  type: "agentMessage",
                  phase: "commentary",
                  text: "先检查目录",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "tool_4a",
                  type: "commandExecution",
                  command: "dir",
                  status: "completed",
                  output: "done",
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "reason_4a",
                  type: "reasoning",
                  summary: [{ text: "再汇总结果" }],
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toBe("");
    expect(messages[1]?.processItems?.map((item) => item.type)).toEqual(["text", "tool", "text"]);
    expect(messages[1]?.processItems?.[0]?.text).toBe("先检查目录");
    expect(messages[1]?.processItems?.[1]?.toolCall?.command).toBe("dir");
    expect(messages[1]?.processItems?.[2]?.text).toBe("再汇总结果");
  });

  it("restores Codex event_msg history as ordered process items", () => {
    const record: CodexThreadRecord = {
      id: "thr_event",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "title",
      preview: "preview",
      turns: [
        {
          turn: {
            id: "turn_event",
            createdAt: 1_700_000_300,
            items: [
              {
                type: "event_msg",
                payload: {
                  method: "item/agentMessage/delta",
                  params: {
                    threadId: "thr_event",
                    turnId: "turn_event",
                    delta: "先读取文件",
                    item: {
                      id: "msg_event_a",
                      type: "agentMessage",
                      phase: "commentary",
                    },
                  },
                },
              },
              {
                type: "event_msg",
                payload: {
                  method: "item/started",
                  params: {
                    threadId: "thr_event",
                    turnId: "turn_event",
                    item: {
                      id: "tool_event_a",
                      type: "commandExecution",
                      command: "rg processItems",
                    },
                  },
                },
              },
              {
                type: "event_msg",
                payload: {
                  method: "item/completed",
                  params: {
                    threadId: "thr_event",
                    turnId: "turn_event",
                    item: {
                      id: "tool_event_a",
                      type: "commandExecution",
                      status: "completed",
                      output: "matched",
                    },
                  },
                },
              },
              {
                type: "response_item",
                payload: {
                  id: "msg_event_final",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "最终结论",
                },
              },
            ],
          },
        },
      ],
    };

    const messages = codexThreadToMessages(record);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("最终结论");
    expect(messages[0]?.processItems?.map((item) => item.type)).toEqual(["text", "tool"]);
    expect(messages[0]?.processItems?.[0]?.text).toBe("先读取文件");
    expect(messages[0]?.processItems?.[1]?.toolCall?.command).toBe("rg processItems");
    expect(messages[0]?.processItems?.[1]?.toolCall?.outputPreview).toBe("matched");
  });

  it("prefers codex thread title over the first user question in history list summaries", () => {
    const record: CodexThreadRecord = {
      id: "thr_3",
      cwd: "C:\\demo",
      ephemeral: false,
      title: "这是 Codex 总结的会话标题",
      preview: "用户原始问题预览",
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      turns: [
        {
          turn: {
            id: "turn_3",
            createdAt: 1_700_000_000,
            items: [
              {
                type: "response_item",
                payload: {
                  id: "user_3",
                  type: "userMessage",
                  text: "请帮我分析这份合同的违约责任条款",
                },
              },
            ],
          },
        },
      ],
    };

    const summary = codexThreadToSummary(record, {
      agentType: "default",
      casePath: "C:\\demo",
    });

    expect(summary.title).toBe("这是 Codex 总结的会话标题");
  });
});
