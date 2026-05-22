/** 创建前端会话 ID，优先使用浏览器原生 UUID。 */
export function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "session-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
