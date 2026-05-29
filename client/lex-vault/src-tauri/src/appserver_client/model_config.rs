use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use dotenvy::from_path_iter;
use serde_json::{json, Value};

/// Lex Vault 默认模型网关地址。
pub const LEX_VAULT_MODEL_BASE_URL: &str = "https://law.ktestai.cn/prod-api/v1";
/// law-admin 默认客户端 ID。
pub const LAW_ADMIN_CLIENT_ID: &str = "e5cd7e4891bf95d1d19206ce24a7b32e";
/// Lex Vault 默认模型 provider 标识。
pub const LEX_VAULT_MODEL_PROVIDER_ID: &str = "lex_vault_law";
/// Lex Vault 默认模型名称。
pub const LEX_VAULT_DEFAULT_MODEL: &str = "gpt-5.4";
/// app-server 读取登录 token 使用的环境变量名。
pub const LEX_VAULT_LAW_TOKEN_ENV: &str = "LEX_VAULT_LAW_TOKEN";
const LEX_VAULT_MODEL_REASONING_EFFORT: &str = "medium";
const LEX_VAULT_CONFIG_SECTION: &str = "lex_vault";
const LEX_VAULT_APP_VERSION_KEY: &str = "app_version";
const CODEX_WEB_SEARCH_KEY_PATH: &str = "web_search";
const CODEX_WEB_SEARCH_DISABLED: &str = "disabled";
const CODEX_MEMORIES_FEATURE_KEY_PATH: &str = "features.memories";
const DEV_ENV_FILE_NAMES: [&str; 2] = [".env.local", ".env.development.local"];
pub const LEX_VAULT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 返回当前运行时生效的模型基础地址，开发环境优先读取本地覆盖配置。
pub fn lex_vault_runtime_model_base_url() -> &'static str {
    static MODEL_BASE_URL: OnceLock<String> = OnceLock::new();
    MODEL_BASE_URL
        .get_or_init(|| {
            resolve_runtime_override("LEX_VAULT_MODEL_BASE_URL", LEX_VAULT_MODEL_BASE_URL)
        })
        .as_str()
}

/// 返回当前运行时生效的默认模型名，开发环境可通过本地覆盖配置快速切换。
pub fn lex_vault_runtime_default_model() -> &'static str {
    static DEFAULT_MODEL: OnceLock<String> = OnceLock::new();
    DEFAULT_MODEL
        .get_or_init(|| {
            resolve_runtime_override("LEX_VAULT_DEFAULT_MODEL", LEX_VAULT_DEFAULT_MODEL)
        })
        .as_str()
}

/// 返回当前运行时生效的 law-admin 客户端 ID，便于本地联调不同客户端配置。
pub fn lex_vault_runtime_law_admin_client_id() -> &'static str {
    static CLIENT_ID: OnceLock<String> = OnceLock::new();
    CLIENT_ID
        .get_or_init(|| {
            resolve_runtime_override("LEX_VAULT_LAW_ADMIN_CLIENT_ID", LAW_ADMIN_CLIENT_ID)
        })
        .as_str()
}

pub fn lex_vault_model_config_batch_params(model_instructions_file: &Path) -> Value {
    json!({
        "edits": [
            {
                "keyPath": format!("{LEX_VAULT_CONFIG_SECTION}.{LEX_VAULT_APP_VERSION_KEY}"),
                "value": LEX_VAULT_APP_VERSION,
                "mergeStrategy": "replace"
            },
            {
                "keyPath": "model",
                "value": lex_vault_runtime_default_model(),
                "mergeStrategy": "replace"
            },
            {
                "keyPath": "model_provider",
                "value": LEX_VAULT_MODEL_PROVIDER_ID,
                "mergeStrategy": "replace"
            },
            {
                "keyPath": "model_reasoning_effort",
                "value": LEX_VAULT_MODEL_REASONING_EFFORT,
                "mergeStrategy": "replace"
            },
            {
                "keyPath": "model_instructions_file",
                "value": model_instructions_file.display().to_string(),
                "mergeStrategy": "replace"
            },
            {
                "keyPath": CODEX_WEB_SEARCH_KEY_PATH,
                "value": CODEX_WEB_SEARCH_DISABLED,
                "mergeStrategy": "replace"
            },
            {
                "keyPath": format!("model_providers.{LEX_VAULT_MODEL_PROVIDER_ID}"),
                "value": {
                    "name": "Lex Vault Law API",
                    "base_url": lex_vault_runtime_model_base_url(),
                    "env_key": LEX_VAULT_LAW_TOKEN_ENV,
                    "wire_api": "responses",
                    "requires_openai_auth": false,
                    "http_headers": {
                        "clientid": lex_vault_runtime_law_admin_client_id()
                    }
                },
                "mergeStrategy": "replace"
            }
        ],
        "reloadUserConfig": true
    })
}

pub fn lex_vault_model_config_is_current(response: &Value, model_instructions_file: &Path) -> bool {
    let expected_model_instructions_file = model_instructions_file.display().to_string();
    lex_vault_app_version(response).as_deref() == Some(LEX_VAULT_APP_VERSION)
        && response
            .get("config")
            .and_then(|config| config.get("model"))
            .and_then(Value::as_str)
            == Some(lex_vault_runtime_default_model())
        && response
            .get("config")
            .and_then(|config| config.get("model_provider"))
            .and_then(Value::as_str)
            == Some(LEX_VAULT_MODEL_PROVIDER_ID)
        && response
            .get("config")
            .and_then(|config| config.get("model_instructions_file"))
            .and_then(Value::as_str)
            == Some(expected_model_instructions_file.as_str())
        && response
            .get("config")
            .and_then(|config| config.get("web_search"))
            .and_then(Value::as_str)
            == Some(CODEX_WEB_SEARCH_DISABLED)
        && response
            .get("config")
            .and_then(|config| config.get("model_providers"))
            .and_then(|providers| providers.get(LEX_VAULT_MODEL_PROVIDER_ID))
            .is_some_and(lex_vault_provider_config_is_current)
}

pub fn codex_memory_feature_config_batch_params() -> Value {
    json!({
        "edits": [
            {
                "keyPath": CODEX_MEMORIES_FEATURE_KEY_PATH,
                "value": true,
                "mergeStrategy": "replace"
            }
        ],
        "reloadUserConfig": true
    })
}

pub fn codex_memory_feature_config_is_current(response: &Value) -> bool {
    response
        .get("config")
        .and_then(|config| config.get("features"))
        .and_then(|features| features.get("memories"))
        .and_then(Value::as_bool)
        == Some(true)
}

fn lex_vault_provider_config_is_current(provider: &Value) -> bool {
    provider.get("base_url").and_then(Value::as_str) == Some(lex_vault_runtime_model_base_url())
        && provider.get("env_key").and_then(Value::as_str) == Some(LEX_VAULT_LAW_TOKEN_ENV)
        && provider.get("wire_api").and_then(Value::as_str) == Some("responses")
        && provider
            .get("requires_openai_auth")
            .and_then(Value::as_bool)
            == Some(false)
        && provider
            .get("http_headers")
            .and_then(|headers| headers.get("clientid"))
            .and_then(Value::as_str)
            == Some(lex_vault_runtime_law_admin_client_id())
}

pub fn lex_vault_app_version(response: &Value) -> Option<String> {
    response
        .get("config")?
        .get(LEX_VAULT_CONFIG_SECTION)?
        .get(LEX_VAULT_APP_VERSION_KEY)?
        .as_str()
        .map(str::to_string)
}

/// 解析当前运行时覆盖值，优先级为进程环境变量 > 本地 `.env` 文件 > 默认值。
fn resolve_runtime_override(key: &str, fallback: &str) -> String {
    if let Some(value) = read_process_env_value(key) {
        return value;
    }
    if should_skip_local_dev_env_overrides() {
        return fallback.to_string();
    }
    load_local_dev_env_overrides()
        .get(key)
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

/// 读取经过裁剪和判空后的进程环境变量。
fn read_process_env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 判断当前二进制是否在编译时被标记为忽略本地开发 `.env` 覆盖。
fn should_skip_local_dev_env_overrides() -> bool {
    option_env!("LEX_VAULT_DISABLE_LOCAL_DEV_ENV")
        .map(|value| !value.trim().is_empty() && value != "0")
        .unwrap_or(false)
}

/// 加载前端目录下的本地开发 `.env`，供 Rust 与 Vite 共用同一份联调配置。
fn load_local_dev_env_overrides() -> &'static HashMap<String, String> {
    static DEV_ENV_OVERRIDES: OnceLock<HashMap<String, String>> = OnceLock::new();
    DEV_ENV_OVERRIDES.get_or_init(|| {
        let mut overrides = HashMap::new();
        for file_name in DEV_ENV_FILE_NAMES {
            let env_path = client_app_root().join(file_name);
            if !env_path.exists() {
                continue;
            }
            let Ok(iter) = from_path_iter(&env_path) else {
                continue;
            };
            for item in iter.flatten() {
                let value = item.1.trim();
                if value.is_empty() {
                    continue;
                }
                overrides.insert(item.0, value.to_string());
            }
        }
        overrides
    })
}

/// 返回前端工程根目录，便于在 Tauri 侧定位共享的开发环境文件。
fn client_app_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}
