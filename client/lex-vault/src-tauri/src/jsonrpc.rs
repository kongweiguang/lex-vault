//! app-server JSON-RPC 基础类型与错误模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 前后端共享的统一错误结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// 程序可稳定判断的错误码。
    pub code: String,
    /// 面向用户的短标题。
    pub title: String,
    /// 面向用户或开发者的详细错误信息。
    pub message: String,
    /// 当前错误是否允许用户重试或恢复。
    pub recoverable: bool,
    /// 原始协议或系统错误上下文。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl AppError {
    /// 创建不带额外上下文的应用错误。
    pub fn new(
        code: impl Into<String>,
        title: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
    ) -> Self {
        Self {
            code: code.into(),
            title: title.into(),
            message: message.into(),
            recoverable,
            details: None,
        }
    }

    /// 附加原始错误上下文，便于调试协议兼容问题。
    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

/// JSON-RPC 请求消息。
#[derive(Debug, Serialize)]
pub struct JsonRpcRequest<'a, T> {
    /// 自增请求 ID。
    pub id: u64,
    /// app-server 方法名。
    pub method: &'a str,
    /// 方法参数。
    pub params: T,
}

/// JSON-RPC notification 消息。
#[derive(Debug, Serialize)]
pub struct JsonRpcNotification<'a, T> {
    /// app-server notification 方法名。
    pub method: &'a str,
    /// notification 参数。
    pub params: T,
}

/// JSON-RPC error 对象。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JsonRpcError {
    /// 协议错误码。
    pub code: i64,
    /// 协议错误说明。
    pub message: String,
    /// 可选错误上下文。
    #[serde(default)]
    pub data: Option<Value>,
}

/// app-server 返回的 response 或主动 request/notification。
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcIncoming {
    /// response 或 server request 的 ID。
    #[serde(default)]
    pub id: Option<Value>,
    /// request 或 notification 方法名。
    #[serde(default)]
    pub method: Option<String>,
    /// request 或 notification 参数。
    #[serde(default)]
    pub params: Option<Value>,
    /// request 成功结果。
    #[serde(default)]
    pub result: Option<Value>,
    /// request 失败错误。
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}
