//! 对话级 JSONL 追踪日志，按 thread/turn 记录一次对话的完整请求响应链路。
//!
//! @author kongweiguang

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::logging::log_with_details;

static TRACE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// 追加一条对话链路追踪日志。
pub fn append_trace(trace_key: &str, stage: &str, summary: impl AsRef<str>, payload: Value) {
    let sanitized = sanitize_trace_key(trace_key);
    let Some(path) = trace_file_path(&sanitized) else {
        return;
    };

    let _guard = match TRACE_LOCK.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = create_dir_all(parent) {
            log_with_details(
                "ERROR",
                "conversation_trace_create_dir_failed",
                "创建对话追踪目录失败",
                json!({ "traceKey": sanitized, "error": err.to_string() }),
            );
            return;
        }
    }

    let line = json!({
        "timestamp": chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
        "traceKey": sanitized,
        "stage": stage,
        "summary": summary.as_ref(),
        "payload": payload,
    });

    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            let _ = writeln!(file, "{line}");
        }
        Err(err) => {
            log_with_details(
                "ERROR",
                "conversation_trace_write_failed",
                "写入对话追踪日志失败",
                json!({ "traceKey": sanitized, "path": path, "error": err.to_string() }),
            );
        }
    }
}

fn trace_file_path(trace_key: &str) -> Option<PathBuf> {
    let log_dir = crate::logging::log_directory()?;
    Some(
        log_dir
            .join("conversation-traces")
            .join(format!("{trace_key}.jsonl")),
    )
}

fn sanitize_trace_key(trace_key: &str) -> String {
    let trimmed = trace_key.trim();
    if trimmed.is_empty() {
        return "unknown".to_string();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
