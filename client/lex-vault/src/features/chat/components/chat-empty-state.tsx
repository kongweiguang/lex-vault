import { useCallback } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { Bot, MessageSquarePlus } from "lucide-react";

import { contextAttachmentToPrompt } from "@/features/chat/components/chat-composer";
import type { ChatPanelMode } from "@/features/chat/chat-panel-types";
import type { ChatAttachment } from "@/types/domain";

/** 空对话推荐问题按场景区分，避免普通对话和案件对话看到同一套引导。 */
const RECOMMENDED_QUESTIONS_BY_MODE: Record<ChatPanelMode, string[]> = {
  chat: [
    "请围绕“竞业限制违约金是否过高”检索法律依据、裁判观点，并提示相关引证是否可能失效或被限缩",
    "请起草一份律师函初稿，主题是催告对方支付逾期货款，并预留当事人信息、金额、期限和违约责任字段",
    "请整理一套适用于委托合同的电子签名与送签流程，说明签署顺序、催签节点、归档要求和风险提示",
  ],
  case: [
    "根据当前案件材料，梳理案件事实、争议焦点和关键时间线",
    "结合当前案件已有证据，整理电子取证线索、证明力和补强方向",
    "围绕当前案件，生成下一步办案计划、待补材料和沟通要点",
  ],
};

/** 空状态只给可操作入口，不写冗长说明，避免像演示页。 */
export function EmptyChat({
  agentEnabled,
  mode,
  contextAttachments = [],
  hidden = false,
  onQuestionSelect,
}: {
  agentEnabled: boolean;
  /** 当前空状态所属场景，决定展示哪一组推荐问题。 */
  mode: ChatPanelMode;
  /** 当前会话里等待随下一轮发送的知识库或案件材料上下文。 */
  contextAttachments?: ChatAttachment[];
  /** 历史加载等特殊状态下隐藏推荐问题，避免和中间提示抢占注意力。 */
  hidden?: boolean;
  /** 点击推荐问题后直接复用的业务发送回调。 */
  onQuestionSelect?: (prompt: string, visiblePrompt: string) => Promise<void> | void;
}) {
  const recommendedQuestions = RECOMMENDED_QUESTIONS_BY_MODE[mode];

  /** 将空态推荐问题复用到统一发送链路，并补齐待发送的本机上下文。 */
  const handleQuestionClick = useCallback((question: string) => {
    if (!agentEnabled) {
      return;
    }
    void sendRecommendedQuestion({
      question,
      contextAttachments,
      onQuestionSelect,
    });
  }, [agentEnabled, contextAttachments, onQuestionSelect]);

  if (hidden) {
    return null;
  }

  return (
    <ThreadPrimitive.Empty>
      <div className="flex min-h-full w-full flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]">
              <Bot className="size-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[color:var(--color-card-foreground)]">开始法律工作对话</h2>
              <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
                {agentEnabled ? "可以直接提问、审阅材料、生成文书草稿或让 小隐 检查当前目录。" : "当前 Agent 未启用。"}
              </p>
            </div>
          </div>
          <div className="mx-auto mt-6 flex w-full max-w-lg flex-col gap-2.5">
            {recommendedQuestions.map((item) => (
              <button
                key={item}
                className="group flex min-h-[3.75rem] items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-left text-sm font-medium text-[color:var(--color-card-foreground)] shadow-sm transition hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--color-primary)_20%,var(--color-border))] hover:bg-[color:var(--color-secondary)] hover:text-[color:var(--color-primary)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-muted)] disabled:text-[color:var(--color-muted-foreground)] disabled:shadow-none"
                disabled={!agentEnabled}
                type="button"
                onClick={() => void handleQuestionClick(item)}
              >
                <span className="min-w-0 flex-1 leading-6">{item}</span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)] transition group-hover:bg-[color:var(--color-primary)]/10 group-hover:text-[color:var(--color-primary)]">
                  <MessageSquarePlus className="size-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
}

/**
 * 空态推荐问题需要直接走业务发送链路，避免依赖 composer 状态同步时序导致点了无反应。
 */
export async function sendRecommendedQuestion({
  question,
  contextAttachments = [],
  onQuestionSelect,
}: {
  /** 推荐问题原文，同时作为用户可见提问文本。 */
  question: string;
  /** 当前待随下一轮发送的知识库或案件材料上下文。 */
  contextAttachments?: ChatAttachment[];
  /** 实际发送回调。 */
  onQuestionSelect?: (prompt: string, visiblePrompt: string) => Promise<void> | void;
}) {
  if (!onQuestionSelect) {
    return;
  }

  const contextText = contextAttachments.map(contextAttachmentToPrompt).filter(Boolean).join("\n\n");
  const nextPrompt = [question, contextText].filter(Boolean).join("\n\n");
  await onQuestionSelect(nextPrompt, question);
}
