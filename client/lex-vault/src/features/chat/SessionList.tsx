import { AlertCircle, MessageSquare, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChatSessionSummary } from "@/types/domain";

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectConversation,
  isLoading,
  loadError,
  onRetry,
  emptyText = "未找到匹配会话",
}: {
  sessions: ChatSessionSummary[];
  selectedSessionId: string;
  onSelectConversation: (conversationId: string) => void;
  isLoading: boolean;
  /** 历史列表最近一次加载失败的用户可见提示。 */
  loadError?: string | null;
  /** 用户主动重试历史列表加载。 */
  onRetry?: () => void;
  emptyText?: string;
}) {
  const showInlineNotice = sessions.length > 0 && (isLoading || Boolean(loadError));

  return (
    <div className="space-y-1">
      {showInlineNotice ? (
        <div className="mb-2 rounded-md border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          <div className="flex items-start gap-2">
            {loadError ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin" />
            )}
            <div className="min-w-0 flex-1">
              <p>{loadError ? "刚才没有刷新成功，先显示上次记录。" : "正在刷新历史会话，先显示已加载的记录。"}</p>
              {loadError && onRetry ? (
                <button
                  className="mt-1 inline-flex items-center gap-1 font-medium text-amber-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoading}
                  onClick={onRetry}
                  type="button"
                >
                  <RefreshCw className="size-3.5" />
                  重新加载
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {sessions.length > 0 ? (
        sessions.map((conversation) => {
          const isSelected = conversation.id === selectedSessionId;

          return (
            <button
              className={cn(
                "w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:bg-[color:var(--color-muted)]",
                isSelected &&
                  "border-[color:color-mix(in_srgb,var(--color-primary)_20%,var(--color-border))] bg-[color:var(--color-secondary)] text-[color:var(--color-primary)] shadow-sm",
              )}
              key={conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
              type="button"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
                    isSelected && "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]",
                  )}
                >
                  <MessageSquare className="size-4" />
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold leading-5 text-[color:var(--color-card-foreground)]">
                      {conversation.title}
                    </p>
                    <span className="shrink-0 pt-0.5 text-xs leading-4 text-[color:var(--color-muted-foreground)]">
                      {conversation.time}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })
      ) : (
        <div className="px-3 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
          {isLoading ? (
            "正在加载历史会话"
          ) : loadError ? (
            <div className="mx-auto max-w-64 space-y-3">
              <AlertCircle className="mx-auto size-5 text-amber-500" />
              <p>{loadError}</p>
              {onRetry ? (
                <button
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-card-foreground)] transition hover:bg-[color:var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isLoading}
                  onClick={onRetry}
                  type="button"
                >
                  <RefreshCw className="size-3.5" />
                  重新加载
                </button>
              ) : null}
            </div>
          ) : (
            emptyText
          )}
        </div>
      )}
    </div>
  );
}

