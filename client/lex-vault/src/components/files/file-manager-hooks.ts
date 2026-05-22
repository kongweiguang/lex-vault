import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** 文件管理面板宽度约束，保证左侧管理区可拉伸但不会挤碎主工作区。 */
const PANEL_WIDTH_LIMIT = {
  min: 360,
  max: 760,
};

/** 可拖拽文件管理面板的宽度状态，按业务区域记忆到本机 WebView localStorage。 */
export function useResizableFilePanel(storageKey: string, defaultWidth: number) {
  const panelRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, defaultWidth));

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelRef.current?.getBoundingClientRect().width ?? width;

    /** 鼠标向右扩大文件管理区，向左缩小文件管理区。 */
    const resize = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(PANEL_WIDTH_LIMIT.max, Math.max(window.innerWidth - 520, PANEL_WIDTH_LIMIT.min));
      const nextWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, PANEL_WIDTH_LIMIT.min), maxWidth);
      setWidth(nextWidth);
    };
    const stopResize = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize, { once: true });
  }, [width]);

  const resetWidth = useCallback(() => setWidth(defaultWidth), [defaultWidth]);

  return { panelRef, resetWidth, startResize, width };
}

/** 监听 Tauri 原生文件拖入事件，并把落点换算成当前文件树目录。 */
export function useNativeFileDrop(
  panelRef: RefObject<HTMLElement | null>,
  onDropPaths: (parentPath: string | null, sourcePaths: string[]) => void,
) {
  const callbackRef = useRef(onDropPaths);
  callbackRef.current = onDropPaths;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindDropListener() {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || !event.payload.paths.length) {
            return;
          }

          const position = event.payload.position;
          const panel = panelRef.current;
          if (!panel) {
            return;
          }
          const { x, y } = normalizeDropPosition(position.x, position.y, panel);
          const bounds = panel.getBoundingClientRect();
          if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
            return;
          }

          const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-file-drop-path]");
          const parentPath = target?.dataset.fileDropPath?.trim() || null;
          callbackRef.current(parentPath, event.payload.paths);
        });

        if (cancelled) {
          unlisten();
        }
      } catch {
        // 浏览器预览环境没有 Tauri WebView 拖放事件，保持普通页面可运行。
      }
    }

    void bindDropListener();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [panelRef]);
}

function readStoredWidth(storageKey: string, defaultWidth: number) {
  const value = Number(window.localStorage.getItem(storageKey));
  if (!Number.isFinite(value)) {
    return defaultWidth;
  }
  return Math.min(Math.max(value, PANEL_WIDTH_LIMIT.min), PANEL_WIDTH_LIMIT.max);
}

/**
 * Tauri 拖放坐标在不同平台/缩放场景下可能是逻辑像素或物理像素。
 * 这里优先使用当前窗口坐标系，只有明显越界时才回退到按 DPR 折算。
 */
function normalizeDropPosition(x: number, y: number, panel: HTMLElement) {
  const logical = { x, y };
  if (isInsideViewport(logical.x, logical.y) || isInsideBounds(logical.x, logical.y, panel)) {
    return logical;
  }

  const scale = window.devicePixelRatio || 1;
  if (scale === 1) {
    return logical;
  }

  const physical = { x: x / scale, y: y / scale };
  return physical;
}

function isInsideViewport(x: number, y: number) {
  return x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
}

function isInsideBounds(x: number, y: number, panel: HTMLElement) {
  const bounds = panel.getBoundingClientRect();
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
