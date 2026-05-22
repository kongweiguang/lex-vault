import { Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SessionList } from "@/features/chat/SessionList";
import type { ChatSessionSummary } from "@/types/domain";

type CaseSessionsPaneProps = {
  agentEnabled: boolean;
  hasSelectedCase: boolean;
  isHistoryLoading: boolean;
  /** 案件历史列表最近一次加载失败的用户可见提示。 */
  historyLoadError?: string | null;
  selectedSessionId: string;
  sessionQuery: string;
  sessions: ChatSessionSummary[];
  onSessionQueryChange: (value: string) => void;
  onCreateConversation: () => void;
  /** 用户主动重新加载当前案件历史列表。 */
  onRetryHistory?: () => void;
  onSelectConversation: (conversationId: string) => void;
};

/** 案件会话搜索栏和列表区域。 */
export function CaseSessionsPane({
  agentEnabled,
  hasSelectedCase,
  isHistoryLoading,
  historyLoadError,
  selectedSessionId,
  sessionQuery,
  sessions,
  onSessionQueryChange,
  onCreateConversation,
  onRetryHistory,
  onSelectConversation,
}: CaseSessionsPaneProps) {
  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
          <input
            className="h-9 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)] pl-9 pr-3 text-sm text-[color:var(--color-card-foreground)] outline-none transition placeholder:text-[color:var(--color-muted-foreground)] focus:bg-[color:var(--color-card)] focus:ring-2 focus:ring-ring"
            disabled={!agentEnabled}
            onChange={(event) => onSessionQueryChange(event.currentTarget.value)}
            placeholder={agentEnabled ? "检索本案会话" : "本案会话能力已清理"}
            value={sessionQuery}
          />
        </div>
        <Button
          aria-label="刷新本案会话"
          disabled={!hasSelectedCase || !agentEnabled || !onRetryHistory || isHistoryLoading}
          onClick={onRetryHistory}
          size="icon"
          title="刷新本案会话"
          type="button"
          variant="outline"
        >
          <RefreshCw className={isHistoryLoading ? "animate-spin" : ""} />
        </Button>
        <Button
          aria-label="新建本案会话"
          disabled={!hasSelectedCase || !agentEnabled}
          onClick={onCreateConversation}
          size="icon"
          type="button"
          variant="outline"
        >
          <Plus />
        </Button>
      </div>
      <SessionList
        emptyText={hasSelectedCase ? (agentEnabled ? "未找到匹配会话" : "当前仅保留会话界面，历史与后台能力待重建") : "请先选择案件"}
        isLoading={isHistoryLoading}
        loadError={historyLoadError}
        onSelectConversation={onSelectConversation}
        onRetry={onRetryHistory}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />
    </>
  );
}

/** 案件会话顶部工具条。 */
export function CaseSessionsToolbar({
  agentEnabled,
  hasSelectedCase,
  sessionQuery,
  onSessionQueryChange,
  onCreateConversation,
  onRetryHistory,
}: Omit<CaseSessionsPaneProps, "isHistoryLoading" | "selectedSessionId" | "sessions" | "onSelectConversation">) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
        <input
          className="h-9 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)] pl-9 pr-3 text-sm text-[color:var(--color-card-foreground)] outline-none transition placeholder:text-[color:var(--color-muted-foreground)] focus:bg-[color:var(--color-card)] focus:ring-2 focus:ring-ring"
          disabled={!agentEnabled}
          onChange={(event) => onSessionQueryChange(event.currentTarget.value)}
          placeholder={agentEnabled ? "检索本案会话" : "本案会话能力已清理"}
          value={sessionQuery}
        />
      </div>
      <Button
        aria-label="刷新本案会话"
        disabled={!hasSelectedCase || !agentEnabled || !onRetryHistory}
        onClick={onRetryHistory}
        size="icon"
        title="刷新本案会话"
        type="button"
        variant="outline"
      >
        <RefreshCw />
      </Button>
      <Button
        aria-label="新建本案会话"
        disabled={!hasSelectedCase || !agentEnabled}
        onClick={onCreateConversation}
        size="icon"
        type="button"
        variant="outline"
      >
        <Plus />
      </Button>
    </div>
  );
}

/** 案件会话列表主体。 */
export function CaseSessionsList({
  agentEnabled,
  hasSelectedCase,
  isHistoryLoading,
  historyLoadError,
  selectedSessionId,
  sessions,
  onRetryHistory,
  onSelectConversation,
}: Pick<
  CaseSessionsPaneProps,
  | "agentEnabled"
  | "hasSelectedCase"
  | "isHistoryLoading"
  | "historyLoadError"
  | "selectedSessionId"
  | "sessions"
  | "onRetryHistory"
  | "onSelectConversation"
>) {
  return (
    <SessionList
      emptyText={hasSelectedCase ? (agentEnabled ? "未找到匹配会话" : "当前仅保留会话界面，历史与后台能力待重建") : "请先选择案件"}
      isLoading={isHistoryLoading}
      loadError={historyLoadError}
      onSelectConversation={onSelectConversation}
      onRetry={onRetryHistory}
      selectedSessionId={selectedSessionId}
      sessions={sessions}
    />
  );
}
