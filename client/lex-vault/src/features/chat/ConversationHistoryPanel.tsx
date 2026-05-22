import { useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";

import { useResizableFilePanel } from "@/components/files/file-manager-hooks";
import { Button } from "@/components/ui/button";
import { SessionList } from "@/features/chat/SessionList";
import type { ChatSessionSummary } from "@/types/domain";

export function ConversationHistoryPanel({
  sessions,
  selectedSessionId,
  onSelectConversation,
  onCreateConversation,
  isLoading,
  loadError,
  onRetry,
  agentEnabled,
}: {
  sessions: ChatSessionSummary[];
  selectedSessionId: string;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: () => void;
  isLoading: boolean;
  /** 历史列表最近一次加载失败的用户可见提示。 */
  loadError?: string | null;
  /** 用户主动重新加载历史列表。 */
  onRetry?: () => void;
  /** Agent 能力是否已经接入。 */
  agentEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredConversations = sessions.filter((conversation) =>
    conversation.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const { panelRef, resetWidth, startResize, width } = useResizableFilePanel("lex-vault-side-panel-width-v3", 480);

  return (
    <section
      className="relative flex w-full min-w-0 shrink-0 flex-col rounded-xl border bg-white p-px shadow-sm lg:h-full"
      ref={panelRef}
      style={{ width }}
    >
      <div
        aria-label="调整历史会话宽度"
        className="absolute bottom-0 right-0 top-0 z-20 hidden w-2 cursor-col-resize touch-none bg-transparent transition hover:bg-blue-200/70 lg:block"
        onDoubleClick={resetWidth}
        onPointerDown={startResize}
        role="separator"
      />
      <div className="border-b p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">历史会话</h2>
            <p className="mt-1 text-xs text-slate-500">
              {agentEnabled ? "按案件、法规和文书问题继续追问" : "历史会话能力待新的 Agent 实现接入"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              aria-label="刷新历史会话"
              disabled={!agentEnabled || !onRetry || isLoading}
              onClick={onRetry}
              size="icon"
              title="刷新历史会话"
              type="button"
              variant="outline"
            >
              <RefreshCw className={isLoading ? "animate-spin" : ""} />
            </Button>
            <Button
              aria-label="新建会话"
              disabled={!agentEnabled}
              onClick={onCreateConversation}
              size="icon"
              type="button"
              variant="outline"
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="h-10 w-full rounded-md border bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-ring"
            disabled={!agentEnabled}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={agentEnabled ? "检索历史会话" : "历史会话能力已清理"}
            value={query}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <SessionList
          isLoading={isLoading}
          loadError={loadError}
          onSelectConversation={onSelectConversation}
          onRetry={onRetry}
          selectedSessionId={selectedSessionId}
          sessions={filteredConversations}
        />
      </div>
    </section>
  );
}
