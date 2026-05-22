import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ScrollShortcutMode } from "@/features/chat/chat-panel-types";

const SCROLL_EDGE_THRESHOLD = 24;

/** 根据当前滚动位置决定显示“回到底部”还是“回到顶部”按钮。 */
function resolveScrollShortcutMode(element: HTMLDivElement | null): ScrollShortcutMode {
  if (!element) {
    return null;
  }
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= SCROLL_EDGE_THRESHOLD) {
    return null;
  }
  return maxScrollTop - element.scrollTop <= SCROLL_EDGE_THRESHOLD ? "top" : "bottom";
}

/** 聊天视口滚动快捷按钮，靠近底部时切为回到顶部。 */
export function ThreadScrollShortcut({
  viewportRef,
  refreshKey,
}: {
  viewportRef: { current: HTMLDivElement | null };
  refreshKey: string;
}) {
  const [mode, setMode] = useState<ScrollShortcutMode>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setMode(null);
      return;
    }

    const updateMode = () => {
      setMode(resolveScrollShortcutMode(viewport));
    };

    updateMode();
    viewport.addEventListener("scroll", updateMode, { passive: true });

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMode);
    resizeObserver?.observe(viewport);
    Array.from(viewport.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        resizeObserver?.observe(child);
      }
    });

    return () => {
      viewport.removeEventListener("scroll", updateMode);
      resizeObserver?.disconnect();
    };
  }, [refreshKey, viewportRef]);

  const handleClick = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !mode) {
      return;
    }
    viewport.scrollTo({
      top: mode === "bottom" ? viewport.scrollHeight : 0,
      behavior: "smooth",
    });
  }, [mode, viewportRef]);

  if (!mode) {
    return null;
  }

  const isScrollToTop = mode === "top";
  return (
    <Button
      aria-label={isScrollToTop ? "回到顶部" : "回到底部"}
      className="pointer-events-auto size-10 rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg shadow-slate-200/70 hover:bg-slate-50"
      onClick={handleClick}
      size="icon"
      title={isScrollToTop ? "回到顶部" : "回到底部"}
      type="button"
      variant="ghost"
    >
      {isScrollToTop ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </Button>
  );
}
