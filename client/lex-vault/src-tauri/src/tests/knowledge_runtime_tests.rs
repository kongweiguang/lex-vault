//! knowledge_runtime 模块回归测试。
//!
//! @author kongweiguang

use super::{
    build_fallback_case_index, build_search_snippet, case_graphify_index_container_root,
    case_graphify_index_root, case_graphify_runtime_root, case_source_exclude_roots,
    cleanup_legacy_case_graphify_output, default_graphify_index_mode,
    ensure_case_graphify_index_layout, format_graphify_command, graphify_anthropic_base_url,
    graphify_command_prefix, is_searchable_index_file, move_graphify_output_into_case_index,
    prepare_graphify_staging_output, resolve_graphify_output_root, sanitize_archive_entry_path,
    should_fallback_to_local_index, CASE_INDEX_DIRECTORY, GRAPHIFY_GATEWAY_BACKEND,
    GRAPHIFY_GATEWAY_MODEL, GRAPHIFY_GATEWAY_TOKEN_BUDGET, GRAPHIFY_INDEX_MODE_FALLBACK,
    GRAPHIFY_NEW_CLAUDE_FUNCTION, GRAPHIFY_OUTPUT_DIRECTORY,
};
use std::path::Path;
use tempfile::tempdir;

#[test]
fn case_graphify_index_root_uses_hidden_directory() {
    let root = case_graphify_index_root(Path::new("C:\\cases\\alpha"));
    let normalized = root.to_string_lossy().replace('\\', "/");
    assert!(normalized.ends_with(&CASE_INDEX_DIRECTORY.replace('\\', "/")));
}

#[test]
fn sanitize_archive_entry_path_rejects_parent_segments() {
    let error = sanitize_archive_entry_path("../graphify.exe")
        .expect_err("parent segments should be rejected");

    assert_eq!(error.code, "KNOWLEDGE_RUNTIME_PREPARE_FAILED");
    assert!(error.title.contains("非法路径"));
}

#[test]
fn searchable_index_file_accepts_markdown_and_rejects_binary() {
    assert!(is_searchable_index_file(Path::new("wiki/index.md")));
    assert!(is_searchable_index_file(Path::new("wiki/index.html")));
    assert!(!is_searchable_index_file(Path::new("wiki/index.pdf")));
}

#[test]
fn build_search_snippet_flattens_newlines() {
    let snippet = build_search_snippet("第一行\n第二行包含证据目录\n第三行", "证据目录");
    assert!(snippet.contains("第二行包含证据目录"));
    assert!(!snippet.contains('\n'));
}

#[test]
fn graphify_anthropic_base_url_uses_anthropic_prefix() {
    let url = graphify_anthropic_base_url().expect("gateway url");
    assert!(url.contains("/anthropic"));
    assert!(!url.contains("clientid="));
}

#[test]
fn format_graphify_command_contains_extract_backend_model_token_budget_and_out() {
    let command = format_graphify_command(
        Path::new("C:\\runtime\\graphify.exe"),
        Path::new("C:\\cases\\alpha"),
        Path::new("C:\\tmp\\graphify-build"),
    );

    assert!(command.contains("extract"));
    assert!(command.contains(&format!("--backend {GRAPHIFY_GATEWAY_BACKEND}")));
    assert!(command.contains(&format!("--model {GRAPHIFY_GATEWAY_MODEL}")));
    assert!(command.contains(&format!("--token-budget {GRAPHIFY_GATEWAY_TOKEN_BUDGET}")));
    assert!(command.contains("--exclude .lex-vault/"));
    assert!(command.contains("--exclude graphify-out/"));
    assert!(command.contains("--out"));
}

#[test]
fn graphify_command_prefix_prefers_python_module_launcher_when_available() {
    let runtime_dir = tempdir().expect("runtime dir");
    let scripts_dir = runtime_dir.path().join("Scripts");
    std::fs::create_dir_all(&scripts_dir).expect("scripts dir");
    std::fs::write(scripts_dir.join("python.exe"), b"").expect("python exe");
    std::fs::write(scripts_dir.join("graphify.exe"), b"").expect("graphify exe");

    let prefix = graphify_command_prefix(&scripts_dir.join("graphify.exe"));

    assert!(prefix.contains("python.exe"));
    assert!(prefix.contains("-m graphify"));
}

#[test]
fn resolve_graphify_output_root_uses_graphify_out_subdirectory() {
    let temp_root = tempdir().expect("temp root");
    let output_root = temp_root.path().join(GRAPHIFY_OUTPUT_DIRECTORY);
    std::fs::create_dir_all(&output_root).expect("create output root");

    let resolved = resolve_graphify_output_root(temp_root.path()).expect("resolve output root");

    assert_eq!(resolved, output_root);
}

#[test]
fn move_graphify_output_into_case_index_replaces_case_hidden_directory() {
    let case_dir = tempdir().expect("case dir");
    let built_root_holder = tempdir().expect("built root holder");
    let built_root = built_root_holder.path().join(GRAPHIFY_OUTPUT_DIRECTORY);
    std::fs::create_dir_all(&built_root).expect("create built root");
    std::fs::write(built_root.join("GRAPH_REPORT.md"), "# report").expect("write report");

    move_graphify_output_into_case_index(case_dir.path(), &built_root, false)
        .expect("move output root");

    let final_root = case_graphify_index_root(case_dir.path());
    assert!(final_root.join("GRAPH_REPORT.md").is_file());
    assert!(!built_root.exists());
}

#[test]
fn ensure_case_graphify_index_layout_migrates_legacy_flat_layout() {
    let case_dir = tempdir().expect("case dir");
    let legacy_root = case_graphify_index_container_root(case_dir.path());
    std::fs::create_dir_all(legacy_root.join("wiki")).expect("legacy wiki dir");
    std::fs::write(legacy_root.join("graph.json"), "{}").expect("write graph");
    std::fs::write(legacy_root.join("GRAPH_REPORT.md"), "# report").expect("write report");
    std::fs::write(
        legacy_root.join("index-metadata.json"),
        "{\"builtAt\":\"2026-05-26T00:00:00Z\",\"sourceLatestModifiedMs\":1,\"sourceFileCount\":1,\"indexedFileCount\":1,\"wikiEntryPath\":\"wiki/index.md\",\"indexMode\":\"graphify-extract\"}",
    )
    .expect("write metadata");
    std::fs::write(legacy_root.join("wiki").join("index.md"), "# wiki").expect("write wiki");

    let final_root = ensure_case_graphify_index_layout(case_dir.path()).expect("migrate layout");

    assert_eq!(final_root, case_graphify_index_root(case_dir.path()));
    assert!(final_root.join("graph.json").is_file());
    assert!(final_root.join("GRAPH_REPORT.md").is_file());
    assert!(final_root.join("index-metadata.json").is_file());
    assert!(final_root.join("wiki").join("index.md").is_file());
    assert!(!legacy_root.join("graph.json").exists());
    assert!(!legacy_root.join("wiki").join("index.md").exists());
}

#[test]
fn prepare_graphify_staging_output_reuses_existing_incremental_artifacts() {
    let case_dir = tempdir().expect("case dir");
    let final_root = case_graphify_index_root(case_dir.path());
    std::fs::create_dir_all(final_root.join("cache")).expect("cache dir");
    std::fs::write(final_root.join("manifest.json"), "{\"files\":[]}").expect("write manifest");
    std::fs::write(final_root.join("graph.json"), "{}").expect("write graph");
    std::fs::write(final_root.join("cache").join("chunk.bin"), b"cache").expect("write cache");

    let temp_root = tempdir().expect("temp root");
    prepare_graphify_staging_output(case_dir.path(), temp_root.path(), false)
        .expect("prepare staging");

    let staging_root = temp_root.path().join(GRAPHIFY_OUTPUT_DIRECTORY);
    assert!(staging_root.join("manifest.json").is_file());
    assert!(staging_root.join("graph.json").is_file());
    assert!(staging_root.join("cache").join("chunk.bin").is_file());
}

#[test]
fn prepare_graphify_staging_output_skips_copy_when_forced() {
    let case_dir = tempdir().expect("case dir");
    let final_root = case_graphify_index_root(case_dir.path());
    std::fs::create_dir_all(&final_root).expect("final root");
    std::fs::write(final_root.join("manifest.json"), "{\"files\":[]}").expect("write manifest");

    let temp_root = tempdir().expect("temp root");
    prepare_graphify_staging_output(case_dir.path(), temp_root.path(), true)
        .expect("prepare staging");

    assert!(!temp_root.path().join(GRAPHIFY_OUTPUT_DIRECTORY).exists());
}

#[test]
fn cleanup_legacy_case_graphify_output_removes_case_root_directory() {
    let case_dir = tempdir().expect("case dir");
    let legacy_output_root = case_dir.path().join(GRAPHIFY_OUTPUT_DIRECTORY);
    std::fs::create_dir_all(&legacy_output_root).expect("legacy output root");
    std::fs::write(legacy_output_root.join("GRAPH_REPORT.md"), "# report").expect("write report");

    cleanup_legacy_case_graphify_output(case_dir.path()).expect("cleanup legacy output");

    assert!(!legacy_output_root.exists());
}

#[test]
fn fallback_detection_only_triggers_for_gateway_like_failures() {
    assert!(should_fallback_to_local_index(
        "",
        "401 Unauthorized: clientid mismatch"
    ));
    assert!(should_fallback_to_local_index(
        "",
        "graphify warning: no llm api key found"
    ));
    assert!(!should_fallback_to_local_index(
        "",
        "unsupported document structure"
    ));
}

#[test]
fn fallback_case_index_creates_searchable_wiki() {
    let case_dir = tempdir().expect("case dir");
    let output_dir = tempdir().expect("output dir");
    let facts_dir = case_dir.path().join("案件事实");
    std::fs::create_dir_all(&facts_dir).expect("facts dir");
    std::fs::write(
        facts_dir.join("说明.md"),
        "# 事实\n\n双方于 2020 年登记结婚，现因感情破裂准备离婚。",
    )
    .expect("write source");

    build_fallback_case_index(output_dir.path(), case_dir.path()).expect("fallback build");

    let index = std::fs::read_to_string(output_dir.path().join("wiki").join("index.md"))
        .expect("read fallback index");
    let material = std::fs::read_to_string(
        output_dir
            .path()
            .join("wiki")
            .join("materials")
            .join("0001.md"),
    )
    .expect("read fallback material");

    assert!(index.contains("案件本地索引"));
    assert!(index.contains("文本优先的本地构建策略"));
    assert!(index.contains("案件事实/说明.md"));
    assert!(material.contains("双方于 2020 年登记结婚"));
    assert!(material.contains("提取模式：`text`"));
}

#[test]
fn fallback_case_index_keeps_non_text_material_as_metadata_only() {
    let case_dir = tempdir().expect("case dir");
    let output_dir = tempdir().expect("output dir");
    let evidence_dir = case_dir.path().join("证据材料");
    std::fs::create_dir_all(&evidence_dir).expect("evidence dir");
    std::fs::write(evidence_dir.join("聊天截图.pdf"), b"%PDF-1.4 mock").expect("write binary");

    build_fallback_case_index(output_dir.path(), case_dir.path()).expect("fallback build");

    let material = std::fs::read_to_string(
        output_dir
            .path()
            .join("wiki")
            .join("materials")
            .join("0001.md"),
    )
    .expect("read fallback material");

    assert!(material.contains("证据材料/聊天截图.pdf"));
    assert!(material.contains("提取模式：`metadata-only`"));
    assert!(material.contains("该文件当前未做正文抽取"));
}

#[test]
fn case_source_exclude_roots_cover_hidden_runtime_outputs() {
    let excludes = case_source_exclude_roots(Path::new("C:\\cases\\alpha"));

    assert!(excludes.iter().any(|path| path.ends_with(".lex-vault")));
    assert!(excludes.iter().any(|path| path.ends_with("graphify-out")));
}

#[test]
fn case_graphify_runtime_root_uses_hidden_runtime_directory() {
    let root = case_graphify_runtime_root(Path::new("C:\\cases\\alpha"));
    let normalized = root.to_string_lossy().replace('\\', "/");

    assert!(normalized.ends_with(".lex-vault/graphify-runtime"));
}

#[test]
fn anthropic_patch_sends_bearer_authorization_header() {
    assert!(GRAPHIFY_NEW_CLAUDE_FUNCTION.contains("\"authorization\": f\"Bearer {api_key}\""));
}

#[test]
fn default_graphify_index_mode_is_fallback_local_text() {
    assert_eq!(default_graphify_index_mode(), GRAPHIFY_INDEX_MODE_FALLBACK);
}
