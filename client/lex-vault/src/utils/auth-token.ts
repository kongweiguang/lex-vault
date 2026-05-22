/** 规范化 law-admin access token，避免重复 Bearer 前缀或首尾空白导致后端判定 token 无效。 */
export function normalizeAccessToken(accessToken?: string | null) {
  const token = (accessToken ?? "").trim();
  return token.toLowerCase().startsWith("bearer ")
    ? token.slice("bearer ".length).trim()
    : token;
}
