//! Codex app-server JSON-RPC 客户端模块装配入口。
//!
//! @author kongweiguang
mod client;
mod model_config;
mod params;
mod protocol;

pub use client::{AppServerJsonRpcClient, CODEX_EVENT_NAME};
pub use model_config::{
    codex_memory_feature_config_batch_params, codex_memory_feature_config_is_current,
    lex_vault_app_version, lex_vault_model_config_batch_params, lex_vault_model_config_is_current,
    lex_vault_runtime_default_model, lex_vault_runtime_law_admin_client_id,
    lex_vault_runtime_model_base_url, LAW_ADMIN_CLIENT_ID, LEX_VAULT_APP_VERSION,
    LEX_VAULT_DEFAULT_MODEL, LEX_VAULT_LAW_TOKEN_ENV, LEX_VAULT_MODEL_BASE_URL,
    LEX_VAULT_MODEL_PROVIDER_ID,
};
pub use params::{
    legal_turn_start_params, legal_user_text, thread_list_params, thread_read_params,
    thread_resume_params, thread_start_params, turn_interrupt_params, APPROVAL_POLICY,
    COLLABORATION_MODE_DEFAULT, COLLABORATION_MODE_DEFAULT_MODEL,
    COLLABORATION_MODE_DEFAULT_REASONING_EFFORT, THREAD_SANDBOX_MODE, TURN_SANDBOX_POLICY_TYPE,
};
pub use protocol::{
    CompletedTurnOutput, StartLegalTurnAttachment, StartLegalTurnRequest, ThreadListResponse,
    ThreadMemoryMode, ThreadReadResponse, ThreadResumeResponse, ThreadStartResponse, ThreadSummary,
    TurnStartResponse, TurnSummary,
};

#[cfg(test)]
#[path = "tests/appserver_client_tests.rs"]
mod tests;
