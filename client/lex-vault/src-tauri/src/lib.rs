//! Lex Vault 桌面端 Tauri 入口。
//!
//! @author kongweiguang

mod app;
mod appserver_client;
mod codex_process;
mod commands;
mod conversation_trace;
mod event_normalizer;
mod jsonrpc;
mod knowledge_runtime;
mod local_mcp_server;
mod logging;
mod notification_center;
mod runtime_bundle;
mod tray;
mod update_manager;
mod websearch_runtime;
mod wechat_gateway_auth;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
