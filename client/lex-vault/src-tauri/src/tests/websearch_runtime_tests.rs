//! websearch_runtime 模块回归测试。
//!
//! @author kongweiguang

use std::path::Path;

use super::{
    normalize_node_friendly_path, normalize_web_search_request, playwright_install_args,
    runtime_playwright_package_dir, search_helper_args, websearch_home_dir_from_home,
    WebSearchRequest, DEFAULT_WEB_SEARCH_ENGINE, DEFAULT_WEB_SEARCH_LIMIT,
    DEFAULT_WEB_SEARCH_TIMEOUT_MS, WECHAT_SEARCH_ENGINE,
};
use tempfile::tempdir;

#[test]
fn websearch_home_dir_uses_lex_vault_subdirectory() {
    let root = websearch_home_dir_from_home(Path::new("demo-home"));
    assert_eq!(
        root,
        Path::new("demo-home").join(".lex-vault").join("websearch")
    );
}

#[test]
fn runtime_playwright_package_dir_resolves_builtin_location() {
    let temp_root = tempdir().expect("temp root");
    let package_dir = temp_root
        .path()
        .join("dependencies")
        .join("node")
        .join("node_modules")
        .join("playwright");
    std::fs::create_dir_all(&package_dir).expect("package dir should exist");

    let resolved = runtime_playwright_package_dir(temp_root.path()).expect("package dir");

    assert_eq!(
        resolved,
        normalize_node_friendly_path(std::fs::canonicalize(&package_dir).unwrap_or(package_dir))
    );
}

#[test]
fn normalize_web_search_request_applies_defaults_and_bounds() {
    let normalized = normalize_web_search_request(WebSearchRequest {
        query: "  劳动仲裁  ".to_string(),
        limit: 99,
        engine: "".to_string(),
        timeout_ms: 99_999,
        include_page_summary: false,
    })
    .expect("request should normalize");

    assert_eq!(normalized.query, "劳动仲裁");
    assert_eq!(normalized.engine, DEFAULT_WEB_SEARCH_ENGINE);
    assert_eq!(normalized.limit, 10);
    assert_eq!(normalized.timeout_ms, 60_000);
}

#[test]
fn normalize_web_search_request_rejects_empty_query() {
    let error = normalize_web_search_request(WebSearchRequest {
        query: "   ".to_string(),
        limit: DEFAULT_WEB_SEARCH_LIMIT,
        engine: DEFAULT_WEB_SEARCH_ENGINE.to_string(),
        timeout_ms: DEFAULT_WEB_SEARCH_TIMEOUT_MS,
        include_page_summary: false,
    })
    .expect_err("empty query should fail");

    assert_eq!(error.code, "WEBSEARCH_INVALID_REQUEST");
}

#[test]
fn normalize_web_search_request_accepts_sogou_weixin_engine() {
    let normalized = normalize_web_search_request(WebSearchRequest {
        query: "微信公众号 离婚案件".to_string(),
        limit: DEFAULT_WEB_SEARCH_LIMIT,
        engine: WECHAT_SEARCH_ENGINE.to_string(),
        timeout_ms: DEFAULT_WEB_SEARCH_TIMEOUT_MS,
        include_page_summary: true,
    })
    .expect("wechat search request should normalize");

    assert_eq!(normalized.engine, WECHAT_SEARCH_ENGINE);
    assert!(normalized.include_page_summary);
}

#[test]
fn normalize_web_search_request_accepts_sogou_engine() {
    let normalized = normalize_web_search_request(WebSearchRequest {
        query: "OpenAI".to_string(),
        limit: DEFAULT_WEB_SEARCH_LIMIT,
        engine: "sogou".to_string(),
        timeout_ms: DEFAULT_WEB_SEARCH_TIMEOUT_MS,
        include_page_summary: false,
    })
    .expect("sogou web search request should normalize");

    assert_eq!(normalized.engine, "sogou");
}

#[test]
fn playwright_install_args_use_cli_script_before_install_command() {
    let cli = Path::new("resources").join("playwright").join("cli.js");
    let args = playwright_install_args(&cli);

    assert_eq!(args[0], cli.display().to_string());
    assert_eq!(args[1], "install");
    assert_eq!(args[2], "chromium");
}

#[test]
fn search_helper_args_place_script_first() {
    let helper = Path::new("resources")
        .join("websearch")
        .join("search-helper.cjs");
    let args = search_helper_args(&helper);

    assert_eq!(args, vec![helper.display().to_string()]);
}
