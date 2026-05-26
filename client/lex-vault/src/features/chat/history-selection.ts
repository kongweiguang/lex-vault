import type { ChatMessage } from "@/types/domain";

type MessagesBySession = Record<string, ChatMessage[]>;

/** 判断作用域默认选中的历史会话是否还需要主动回填 thread/read。 */
export function shouldHydrateScopedHistorySelection(
  messagesBySession: MessagesBySession,
  sessionId: string,
  hydratingHistorySessionId: string | null,
) {
  if (!sessionId || hydratingHistorySessionId === sessionId) {
    return false;
  }
  return !(sessionId in messagesBySession) || (messagesBySession[sessionId]?.length ?? 0) === 0;
}
