/** 窗口活跃状态快照。 */
export type WindowActivityState = {
  /** 当前文档是否处于可见状态。 */
  isVisible: boolean;
  /** 当前应用窗口是否处于前台聚焦状态。 */
  isFocused: boolean;
};

/** 窗口活跃状态监听器。 */
type WindowActivityListener = (state: WindowActivityState) => void;

/** 当前窗口活跃状态快照。 */
let currentState: WindowActivityState = resolveWindowActivityState();

/** 窗口活跃状态订阅列表。 */
const listeners = new Set<WindowActivityListener>();

/** 是否已经绑定全局浏览器事件。 */
let isBound = false;

/** 读取当前窗口活跃状态。 */
export function getWindowActivityState() {
  return currentState;
}

/** 当前窗口是否可认为在前台可见。 */
export function isWindowInForeground() {
  return currentState.isVisible && currentState.isFocused;
}

/** 当前窗口是否处于隐藏或失焦状态。 */
export function isWindowInactive() {
  return !isWindowInForeground();
}

/** 订阅窗口活跃状态变化。 */
export function subscribeWindowActivity(listener: WindowActivityListener) {
  ensureWindowActivityBinding();
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/** 初始化窗口活跃状态监听，供应用入口提前绑定。 */
export function initializeWindowActivityTracking() {
  ensureWindowActivityBinding();
}

/** 解析浏览器环境下的可见性和焦点状态。 */
function resolveWindowActivityState(): WindowActivityState {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { isVisible: true, isFocused: true };
  }
  return {
    isVisible: document.visibilityState !== "hidden",
    isFocused: typeof document.hasFocus === "function" ? document.hasFocus() : true,
  };
}

/** 首次使用时统一绑定可见性和焦点事件。 */
function ensureWindowActivityBinding() {
  if (isBound || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  isBound = true;
  const updateState = () => {
    const nextState = resolveWindowActivityState();
    if (
      nextState.isVisible === currentState.isVisible
      && nextState.isFocused === currentState.isFocused
    ) {
      return;
    }
    currentState = nextState;
    listeners.forEach((listener) => listener(currentState));
  };
  document.addEventListener("visibilitychange", updateState);
  window.addEventListener("focus", updateState);
  window.addEventListener("blur", updateState);
}
