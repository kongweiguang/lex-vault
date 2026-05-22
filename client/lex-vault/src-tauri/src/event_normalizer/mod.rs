//! Codex app-server 原始事件到前端稳定 UI 事件的归一化。
//!
//! @author kongweiguang

mod helpers;
mod models;
mod normalize;

pub use models::{
    ApprovalDecisionKind, ApprovalDecisionRequest, ApprovalRequest, CodexUiEvent, ProcessDeltaInfo,
    RiskLevel, ThreadInfo, ToolCallDeltaInfo, ToolCallInfo, ToolCallResult, TurnInfo,
};
pub use normalize::{normalize_approval_request, EventNormalizer};

#[cfg(test)]
#[path = "../tests/event_normalizer_tests.rs"]
mod tests;
