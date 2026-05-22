//! commands::file_manager 模块回归测试。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

fn temp_root(name: &str) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be valid")
        .as_millis();
    let root = std::env::temp_dir().join(format!("lex-vault-file-manager-{name}-{millis}"));
    fs::create_dir_all(&root).expect("test root should be created");
    root
}

#[test]
fn copy_native_file_generates_unique_target_when_name_conflicts() {
    let root = temp_root("copy-file");
    fs::write(root.join("a.txt"), "source").expect("source file should be created");
    fs::write(root.join("b.txt"), "exists").expect("target file should be created");

    let copied = copy_native_path(
        root.to_string_lossy().to_string(),
        "a.txt".to_string(),
        "b.txt".to_string(),
    )
    .expect("copy should succeed");

    assert_eq!(copied, "b (1).txt");
    assert_eq!(
        fs::read_to_string(root.join("b (1).txt")).expect("copied file should be readable"),
        "source"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn copy_native_folder_rejects_copying_into_descendant() {
    let root = temp_root("copy-descendant");
    fs::create_dir_all(root.join("folder/child")).expect("folder should be created");

    let error = copy_native_path(
        root.to_string_lossy().to_string(),
        "folder".to_string(),
        "folder/child/copy".to_string(),
    )
    .expect_err("copying a folder into its descendant should fail");

    assert!(error.contains("自身或子目录"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn import_native_paths_copies_external_folder_and_renames_conflict() {
    let root = temp_root("import-root");
    let external = temp_root("import-external");
    fs::create_dir_all(root.join("target/source")).expect("conflict folder should be created");
    fs::create_dir_all(external.join("source/nested")).expect("external folder should be created");
    fs::write(external.join("source/nested/a.md"), "hello")
        .expect("external file should be created");

    let imported = import_native_paths(
        root.to_string_lossy().to_string(),
        Some("target".to_string()),
        vec![external.join("source").to_string_lossy().to_string()],
    )
    .expect("import should succeed");

    assert_eq!(imported, vec!["target/source (1)"]);
    assert_eq!(
        fs::read_to_string(root.join("target/source (1)/nested/a.md"))
            .expect("imported nested file should be readable"),
        "hello"
    );
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(external);
}

#[test]
fn rename_native_path_rejects_moving_folder_into_descendant() {
    let root = temp_root("rename-descendant");
    fs::create_dir_all(root.join("folder/child")).expect("folder should be created");

    let error = rename_native_path(
        root.to_string_lossy().to_string(),
        "folder".to_string(),
        "folder/child/moved".to_string(),
    )
    .expect_err("moving a folder into its descendant should fail");

    assert!(error.contains("自身或子目录"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn copy_native_path_rejects_parent_escape() {
    let root = temp_root("escape");
    fs::write(root.join("a.txt"), "source").expect("source file should be created");

    let error = copy_native_path(
        root.to_string_lossy().to_string(),
        "a.txt".to_string(),
        "../a.txt".to_string(),
    )
    .expect_err("target outside root should fail");

    assert!(error.contains("非法文件路径"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn unique_available_path_keeps_downloaded_file_when_name_conflicts() {
    let root = temp_root("remote-conflict");
    fs::create_dir_all(root.join("民法典")).expect("category folder should be created");
    fs::write(root.join("民法典/合同编.md"), "exists").expect("existing file should be created");

    let target = unique_available_path(&root.join("民法典/合同编.md"));

    assert_eq!(relative_path(&root, &target), "民法典/合同编 (1).md");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn fetch_remote_law_index_rejects_non_http_url() {
    let error = fetch_remote_law_index("file:///tmp/index.json".to_string(), true)
        .expect_err("non http url should be rejected");

    assert!(error.contains("http 或 https"));
}

#[test]
fn fetch_remote_law_index_uses_cache_when_not_forced() {
    let root = temp_root("law-index-cache");
    let cache_path = root.join("remote-laws-index.json");
    fs::write(&cache_path, r#"{"version":"cached"}"#).expect("cache should be written");

    let payload = fetch_remote_law_index_with_cache(
        "https://example.com/index.json",
        false,
        &cache_path,
        |_| Err("remote should not be called".to_string()),
    )
    .expect("cache should be returned");

    assert_eq!(payload.content, r#"{"version":"cached"}"#);
    assert!(payload.cached);
    assert!(payload.cached_at.is_some());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn fetch_remote_law_index_rejects_non_http_url_even_with_cache() {
    let root = temp_root("law-index-cache-invalid-url");
    let cache_path = root.join("remote-laws-index.json");
    fs::write(&cache_path, r#"{"version":"cached"}"#).expect("cache should be written");

    let error =
        fetch_remote_law_index_with_cache("file:///tmp/index.json", false, &cache_path, |_| {
            Err("remote should not be called".to_string())
        })
        .expect_err("invalid url should be rejected before reading cache");

    assert!(error.contains("http 或 https"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn fetch_remote_law_index_downloads_when_cache_missing() {
    let root = temp_root("law-index-missing-cache");
    let cache_path = root.join("remote-laws-index.json");

    let payload = fetch_remote_law_index_with_cache(
        "https://example.com/index.json",
        false,
        &cache_path,
        |_| Ok(r#"{"version":"remote"}"#.to_string()),
    )
    .expect("remote index should be returned");

    assert_eq!(payload.content, r#"{"version":"remote"}"#);
    assert!(!payload.cached);
    assert!(payload.cached_at.is_some());
    assert_eq!(
        fs::read_to_string(&cache_path).expect("cache should be readable"),
        r#"{"version":"remote"}"#
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn fetch_remote_law_index_force_refresh_ignores_cache() {
    let root = temp_root("law-index-force-refresh");
    let cache_path = root.join("remote-laws-index.json");
    fs::write(&cache_path, r#"{"version":"cached"}"#).expect("cache should be written");

    let payload = fetch_remote_law_index_with_cache(
        "https://example.com/index.json",
        true,
        &cache_path,
        |_| Ok(r#"{"version":"fresh"}"#.to_string()),
    )
    .expect("fresh index should be returned");

    assert_eq!(payload.content, r#"{"version":"fresh"}"#);
    assert!(!payload.cached);
    assert_eq!(
        fs::read_to_string(&cache_path).expect("cache should be refreshed"),
        r#"{"version":"fresh"}"#
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn remote_law_index_cache_path_uses_user_cache_file() {
    let path = remote_law_index_cache_path().expect("cache path should be resolved");
    let normalized = path.to_string_lossy().replace('\\', "/");

    assert!(normalized.ends_with("/.lex-vault/cache/remote-laws-index.json"));
}

#[test]
fn docx_extension_is_not_treated_as_text_file() {
    assert!(is_docx_file(Some("docx")));
    assert!(!is_docx_file(Some("doc")));
    assert!(!is_text_file(Some("docx"), 128));
}

#[test]
fn legacy_office_preview_falls_back_to_external() {
    let root = temp_root("legacy-office-external");
    let file = root.join("旧版合同.doc");
    fs::write(&file, "fake legacy office payload").expect("source file should be created");

    let preview = preview_file(&file, Some("doc"), 26);

    assert_eq!(preview.preview_kind, "external");
    assert_eq!(preview.converter, "none");
    assert!(preview.asset_path.is_none());
    assert!(preview
        .external_reason
        .expect("fallback reason should exist")
        .contains("系统默认程序"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn docx_preview_uses_frontend_renderer_hint() {
    let root = temp_root("docx-preview-kind");
    let file = root.join("合同审查意见.docx");
    fs::write(&file, "fake docx payload").expect("source file should be created");

    let preview = preview_file(&file, Some("docx"), 17);

    assert_eq!(preview.preview_kind, "docx");
    assert_eq!(preview.converter, "docx-preview");
    assert_eq!(
        preview.asset_path.as_deref(),
        Some(file.to_string_lossy().as_ref())
    );
    assert!(preview.external_reason.is_none());
    let _ = fs::remove_dir_all(root);
}
