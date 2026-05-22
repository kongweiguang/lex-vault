//! 微信套餐网关认证快照回归测试。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};

use super::wechat_gateway_auth_file_from_home;

/// 验证微信网关认证快照固定写入 Lex Vault 用户目录下的 wechat 子目录。
#[test]
fn wechat_gateway_auth_file_is_written_under_lex_vault_wechat_directory() {
    let home = Path::new("demo-home");

    let auth_file = wechat_gateway_auth_file_from_home(home);

    assert_eq!(
        auth_file,
        PathBuf::from("demo-home")
            .join(".lex-vault")
            .join("wechat")
            .join("gateway-auth.json")
    );
}
