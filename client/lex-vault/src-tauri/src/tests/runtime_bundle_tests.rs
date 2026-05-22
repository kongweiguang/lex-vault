//! runtime_bundle 模块回归测试。
//!
//! @author kongweiguang

use super::{
    install_runtime_bundle_from_archive, is_valid_runtime_root, resolve_extracted_runtime_root,
    sanitize_archive_entry_path, PRIMARY_RUNTIME_DIRECTORY,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use uuid::Version::Nil;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// 验证 runtime zip 解压后会同时保留运行时主体和预装插件目录。
#[test]
fn install_runtime_bundle_from_archive_keeps_runtime_and_plugins() {
    let temp_root = temp_root("install");
    let archive_path = temp_root.join("codex-primary-runtime.zip");
    let lex_vault_home = temp_root.join(".lex-vault");
    create_demo_runtime_archive(&archive_path);

    let runtime_root =
        install_runtime_bundle_from_archive(&archive_path, &lex_vault_home, &mut |_| {})
            .expect("runtime archive should install");

    assert!(is_valid_runtime_root(&runtime_root));
    assert!(runtime_root.join("runtime.json").is_file());
    assert!(
        runtime_root
            .join("plugins")
            .join("openai-primary-runtime")
            .join(".agents")
            .join("plugins")
            .join("marketplace.json")
            .is_file(),
        "installed runtime should keep marketplace manifest"
    );
    assert!(
        runtime_root
            .join("plugins")
            .join("openai-primary-runtime")
            .join("plugins")
            .join("documents")
            .join(".codex-plugin")
            .join("plugin.json")
            .is_file(),
        "installed runtime should keep plugin manifest"
    );

    let _ = fs::remove_dir_all(temp_root);
}

/// 验证命名为 `codex-primary-runtime/` 的子目录可以被识别为真正 runtime 根目录。
#[test]
fn resolve_extracted_runtime_root_accepts_named_child_directory() {
    let temp_root = temp_root("resolve-root");
    let runtime_root = temp_root.join(PRIMARY_RUNTIME_DIRECTORY);
    fs::create_dir_all(runtime_root.join("dependencies")).expect("dependencies dir should exist");
    fs::write(runtime_root.join("runtime.json"), "{}").expect("runtime json should exist");

    let resolved =
        resolve_extracted_runtime_root(&temp_root).expect("named runtime dir should resolve");

    assert_eq!(resolved, runtime_root);

    let _ = fs::remove_dir_all(temp_root);
}

/// 验证 zip 中包含 `..` 的非法路径会被拒绝，避免越界写文件。
#[test]
fn sanitize_archive_entry_path_rejects_parent_segments() {
    let error =
        sanitize_archive_entry_path("../runtime.json").expect_err("parent segments should fail");

    assert_eq!(error.code, "CODEX_RUNTIME_START_FAILED");
    assert!(error.title.contains("非法路径"));
}

/// 构造用于测试的最小 runtime zip。
fn create_demo_runtime_archive(archive_path: &PathBuf) {
    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent).expect("archive parent should be created");
    }
    let file = File::create(archive_path).expect("archive file should be created");
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    writer
        .add_directory("dependencies/", options)
        .expect("dependencies dir should be added");
    writer
        .add_directory("dependencies/node/bin/", options)
        .expect("node dir should be added");
    writer
        .add_directory("dependencies/python/", options)
        .expect("python dir should be added");
    writer
        .add_directory("plugins/openai-primary-runtime/.agents/plugins/", options)
        .expect("marketplace dir should be added");
    writer
        .add_directory(
            "plugins/openai-primary-runtime/plugins/documents/.codex-plugin/",
            options,
        )
        .expect("plugin dir should be added");

    writer
        .start_file("runtime.json", options)
        .expect("runtime json should start");
    writer
        .write_all(br#"{"name":"codex-primary-runtime"}"#)
        .expect("runtime json should write");
    writer
        .start_file("dependencies/node/bin/node.exe", options)
        .expect("node executable should start");
    writer
        .write_all(b"node")
        .expect("node executable should write");
    writer
        .start_file("dependencies/python/python.exe", options)
        .expect("python executable should start");
    writer
        .write_all(b"python")
        .expect("python executable should write");
    writer
        .start_file(
            "plugins/openai-primary-runtime/.agents/plugins/marketplace.json",
            options,
        )
        .expect("marketplace manifest should start");
    writer
        .write_all(br#"{"name":"openai-primary-runtime","plugins":[{"name":"documents"}]}"#)
        .expect("marketplace manifest should write");
    writer
        .start_file(
            "plugins/openai-primary-runtime/plugins/documents/.codex-plugin/plugin.json",
            options,
        )
        .expect("plugin manifest should start");
    writer
        .write_all(br#"{"name":"documents","version":"1.0.0"}"#)
        .expect("plugin manifest should write");
    writer.finish().expect("archive should finish");
}

/// 构造唯一临时目录。
fn temp_root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "lex-vault-runtime-bundle-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&path).expect("temp root should be created");
    path
}
