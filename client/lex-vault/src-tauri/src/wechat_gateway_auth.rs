//! 旧版微信 Bot 网关认证快照。
//!
//! 当前微信回复主链路已经改为 Rust 桥接 Codex app-server thread；该文件路径仅保留给旧版本迁移和排障。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::appserver_client::{
    lex_vault_runtime_default_model, lex_vault_runtime_law_admin_client_id,
    lex_vault_runtime_model_base_url,
};
use crate::runtime_bundle::LEX_VAULT_HOME_DIRECTORY;

/// 微信网关认证文件名。
const WECHAT_GATEWAY_AUTH_FILE_NAME: &str = "gateway-auth.json";
/// 微信登录态目录名。
const WECHAT_STATE_DIRECTORY: &str = "wechat";
/// 旧版微信 helper 曾使用的套餐网关认证快照。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WechatGatewayAuthState {
    /// 当前桌面端登录 token。
    pub access_token: String,
    /// Responses 网关基础地址。
    pub model_base_url: String,
    /// 默认模型名。
    pub model: String,
    /// law-admin 客户端 ID。
    pub client_id: String,
}

/// 基于用户目录构造微信网关认证文件路径。
pub fn wechat_gateway_auth_file_from_home(home: &Path) -> PathBuf {
    home.join(LEX_VAULT_HOME_DIRECTORY)
        .join(WECHAT_STATE_DIRECTORY)
        .join(WECHAT_GATEWAY_AUTH_FILE_NAME)
}

/// 将当前认证快照写入微信 helper 可读的 JSON 文件。
pub fn sync_wechat_gateway_auth_state(access_token: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位当前用户目录".to_string())?;
    let auth_file = wechat_gateway_auth_file_from_home(&home);
    if let Some(parent) = auth_file.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("创建微信状态目录失败：{err}"))?;
    }
    let state = WechatGatewayAuthState {
        access_token: access_token.trim().to_string(),
        model_base_url: lex_vault_runtime_model_base_url().to_string(),
        model: lex_vault_runtime_default_model().to_string(),
        client_id: lex_vault_runtime_law_admin_client_id().to_string(),
    };
    let content = serde_json::to_string_pretty(&state)
        .map_err(|err| format!("序列化微信网关认证快照失败：{err}"))?;
    std::fs::write(&auth_file, content)
        .map_err(|err| format!("写入微信网关认证快照失败：{err}"))?;
    Ok(auth_file)
}

#[cfg(test)]
#[path = "tests/wechat_gateway_auth_tests.rs"]
mod tests;
