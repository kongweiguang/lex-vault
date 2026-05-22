const resolveRuntimeEnv = (key: keyof ImportMetaEnv, fallback: string) => {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

/** 后端 API 基础地址，开发环境可通过 `.env.development.local` 快速切换到本地服务。 */
export const API_BASE_URL = resolveRuntimeEnv(
  "VITE_LEX_VAULT_API_BASE_URL",
  "https://law.ktestai.cn/prod-api",
);

/** 法规镜像静态目录基地址，开发环境可按需覆盖到本地或其他测试镜像。 */
export const LAW_REPOSITORY_BASE_URL = resolveRuntimeEnv(
  "VITE_LEX_VAULT_LAW_REPOSITORY_BASE_URL",
  "https://law.ktestai.cn/lex-vault/laws",
);

/** 法规镜像索引地址，约定由 Nginx 静态目录直接提供。 */
export const LAW_REPOSITORY_INDEX_URL = `${LAW_REPOSITORY_BASE_URL}/index.json`;

/** law-admin 密码登录使用的客户端 ID，本地联调时可切换到测试客户端。 */
export const LAW_ADMIN_CLIENT_ID = resolveRuntimeEnv(
  "VITE_LEX_VAULT_LAW_ADMIN_CLIENT_ID",
  "e5cd7e4891bf95d1d19206ce24a7b32e",
);

/** law-admin 密码登录使用的默认租户 ID。 */
export const LAW_ADMIN_TENANT_ID = "000000";

/** law-admin API 加密头名称。 */
export const LAW_ADMIN_ENCRYPT_HEADER = "encrypt-key";

/** law-admin 后端用于解密请求 AES 密钥的 RSA 公钥。 */
export const LAW_ADMIN_REQUEST_PUBLIC_KEY =
  "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAKoR8mX0rGKLqzcWmOzbfj64K8ZIgOdHnzkXSOVOZbFu/TJhZ7rFAN+eaGkl3C4buccQd/EjEsj9ir7ijT7h96MCAwEAAQ==";

/** 当前本机前端固定用户标识，后端暂未启用鉴权。 */
export const USER_ID = "local-user";

/** 本地保存用户主题偏好的键名，避免刷新或重启后丢失。 */
export const THEME_STORAGE_KEY = "lex-vault-theme-mode";
