//! Codex app-server runtime 对接命令。
//!
//! @author kongweiguang

pub mod command_handlers;
mod models;
mod runtime_support;

pub(crate) use crate::runtime_bundle::LEX_VAULT_HOME_DIRECTORY;
pub(crate) use command_handlers::{
    codex_add_marketplace, codex_compact_thread, codex_install_plugin, codex_interrupt_turn,
    codex_list_plugins, codex_list_threads, codex_prepare_runtime_bundle, codex_read_plugin,
    codex_read_thread, codex_remove_marketplace, codex_reset_memory, codex_respond_approval,
    codex_resume_thread, codex_set_plugin_enabled, codex_set_thread_memory_mode,
    codex_start_legal_turn, codex_start_runtime, codex_start_thread, codex_stop_runtime,
    codex_uninstall_plugin, codex_upgrade_marketplace,
};
pub use models::AppState;
pub(crate) use models::{
    AddMarketplaceRequest, CodexOperationResult, CodexPluginDetails, CodexPluginListResult,
    CodexRuntime, CodexRuntimeView, CodexThreadListResult, CodexThreadRecord, CompactThreadRequest,
    InterruptTurnRequest, ListThreadsRequest, PluginEnablementRequest, PluginLookupRequest,
    ReadThreadRequest, RemoveMarketplaceRequest, ResumeThreadRequest, StartThreadRequest,
    ThreadMemoryModeRequest, UninstallPluginRequest, UpgradeMarketplaceRequest,
};
pub(crate) use runtime_support::{
    audit, builtin_plugin_marketplaces_fingerprint, cleanup_legacy_builtin_skills,
    clear_stale_runtime_if_exited, emit_error, ensure_builtin_local_mcp_server_config,
    ensure_builtin_plugin_marketplaces_config, ensure_model_instructions_file,
    install_builtin_plugin_marketplaces, install_builtin_plugin_marketplaces_from,
    prepare_codex_runtime_home, profile_codex_home, runtime_client,
    sync_builtin_plugin_marketplaces, thread_record_from_summary, validate_workspace,
    CODEX_HOME_DIRECTORY, CODEX_MARKETPLACES_DIRECTORY, LEX_VAULT_MODEL_INSTRUCTIONS,
    MODEL_INSTRUCTIONS_DIRECTORY, MODEL_INSTRUCTIONS_FILE_NAME,
};

#[cfg(test)]
#[path = "../../tests/commands_codex_tests.rs"]
mod tests;
