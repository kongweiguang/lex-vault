//! commands::codex 模块回归测试。
//!
//! @author kongweiguang

use serde_json::Value;

use super::command_handlers::{
    build_workspace_directory_developer_instructions, merge_developer_instructions,
    resolve_skill_path,
};
use super::models::plugin_list_result_from_value;
use super::{
    builtin_plugin_marketplaces_fingerprint, cleanup_legacy_builtin_skills,
    ensure_builtin_local_mcp_server_config, ensure_builtin_plugin_marketplaces_config,
    ensure_model_instructions_file, install_builtin_plugin_marketplaces_from, profile_codex_home,
    CODEX_HOME_DIRECTORY, CODEX_MARKETPLACES_DIRECTORY, LEX_VAULT_HOME_DIRECTORY,
    LEX_VAULT_MODEL_INSTRUCTIONS, MODEL_INSTRUCTIONS_DIRECTORY, MODEL_INSTRUCTIONS_FILE_NAME,
};
use crate::appserver_client::{
    codex_memory_feature_config_batch_params, codex_memory_feature_config_is_current,
    ThreadMemoryMode,
};
use crate::commands::local_data::AppConfig;

/// 验证工作区目录说明由后端根据本机配置生成，前端不需要参与传参。
#[test]
fn workspace_directory_developer_instructions_use_app_config_paths() {
    let config = AppConfig {
        workspace_root: "C:\\workspace".to_string(),
        user_config_database: "C:\\user.db".to_string(),
        workspace_database: "C:\\workspace\\.lex-vault\\lex-vault.db".to_string(),
        doc_template: "D:\\legal\\templates".to_string(),
        law_directory: "D:\\legal\\laws".to_string(),
        case_ref: "D:\\legal\\cases".to_string(),
        case_master: "D:\\legal\\matters".to_string(),
    };

    let instructions = build_workspace_directory_developer_instructions(&config)
        .expect("configured workspace should produce instructions");

    assert!(instructions.contains("<workspaceRoot>/doc/ 是文书模板目录"));
    assert!(instructions.contains("D:\\legal\\templates"));
    assert!(instructions.contains("<workspaceRoot>/master/ 是案件存储根目录"));
    assert!(instructions.contains("D:\\legal\\matters"));
}

/// 验证已有 instructions 会与工作区目录说明合并。
#[test]
fn merge_developer_instructions_preserves_existing_skill_instructions() {
    let merged = merge_developer_instructions(Some("专项说明"), Some("目录说明".to_string()))
        .expect("merged instructions should exist");

    assert_eq!(merged, "专项说明\n\n目录说明");
}

/// 验证 thread 记忆模式序列化后能直接对齐 app-server 协议要求的小写字面量。
#[test]
fn thread_memory_mode_serializes_to_app_server_literal() {
    let enabled = serde_json::to_value(ThreadMemoryMode::Enabled)
        .expect("enabled memory mode should serialize");
    let disabled = serde_json::to_value(ThreadMemoryMode::Disabled)
        .expect("disabled memory mode should serialize");

    assert_eq!(enabled, Value::String("enabled".to_string()));
    assert_eq!(disabled, Value::String("disabled".to_string()));
}

/// 验证默认 Codex Home 固定落在用户主目录的 Lex Vault 数据目录下。
#[test]
fn profile_codex_home_uses_lex_vault_home_directory() {
    let path = profile_codex_home("lex-vault").expect("profile path should build");
    let expected_suffix = std::path::Path::new(LEX_VAULT_HOME_DIRECTORY).join(CODEX_HOME_DIRECTORY);

    assert!(
        path.ends_with(expected_suffix),
        "profile codex home should resolve to ~/.lex-vault/agent, got {}",
        path.display()
    );
}

/// 验证运行时会把模型 instructions 文件写到当前 profile 的固定位置。
#[test]
fn ensure_model_instructions_file_writes_expected_content() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-model-instructions-{}",
        std::process::id()
    ));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    std::fs::create_dir_all(&codex_home).expect("codex home should be created");

    let instructions_file =
        ensure_model_instructions_file(&codex_home).expect("instructions file should exist");

    let expected_path = codex_home
        .join(MODEL_INSTRUCTIONS_DIRECTORY)
        .join(MODEL_INSTRUCTIONS_FILE_NAME);
    let written = std::fs::read_to_string(&instructions_file)
        .expect("instructions file content should be readable");

    assert_eq!(instructions_file, expected_path);
    assert_eq!(written, LEX_VAULT_MODEL_INSTRUCTIONS);

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证启动时会清理旧版本遗留的合同审查 skill，避免继续从本地项目资源注入能力。
#[test]
fn cleanup_legacy_builtin_skills_removes_legacy_contract_review_skill() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-legacy-skills-{}", std::process::id()));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let removed_skill_dir = codex_home.join("skills").join("legal-contract-review");
    std::fs::create_dir_all(&removed_skill_dir).expect("legacy skill dir should be created");
    std::fs::write(removed_skill_dir.join("SKILL.md"), "# legacy")
        .expect("legacy skill file should be written");

    cleanup_legacy_builtin_skills(&codex_home).expect("legacy skills should be cleaned");
    assert!(
        !removed_skill_dir.exists(),
        "removed legal contract review skill should be deleted"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证启动时会继续清理旧版本遗留的文书写作 skill。
#[test]
fn cleanup_legacy_builtin_skills_removes_legacy_document_drafting_skill() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-removed-skills-{}", std::process::id()));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let removed_skill_dir = codex_home.join("skills").join("legal-document-drafting");
    std::fs::create_dir_all(&removed_skill_dir).expect("legacy skill dir should be created");
    std::fs::write(removed_skill_dir.join("SKILL.md"), "# legacy")
        .expect("legacy skill file should be written");

    cleanup_legacy_builtin_skills(&codex_home).expect("legacy skills should be cleaned");

    assert!(
        !removed_skill_dir.exists(),
        "removed legal document drafting skill should be deleted"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证 skill 路径优先查找顶层 skills 目录。
#[test]
fn resolve_skill_path_prefers_direct_skill_directory() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-resolve-skill-direct-{}",
        std::process::id()
    ));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let skill_path = codex_home
        .join("skills")
        .join("plugin-creator")
        .join("SKILL.md");
    std::fs::create_dir_all(skill_path.parent().expect("skill dir should exist"))
        .expect("skill dir should be created");
    std::fs::write(&skill_path, "# plugin creator").expect("skill file should be written");

    let resolved = resolve_skill_path(&codex_home, "plugin-creator");

    assert_eq!(resolved, Some(skill_path));
    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证系统 skill 会回退到 `.system/<name>/SKILL.md`。
#[test]
fn resolve_skill_path_supports_system_skill_directory() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-resolve-skill-system-{}",
        std::process::id()
    ));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let skill_path = codex_home
        .join("skills")
        .join(".system")
        .join("plugin-creator")
        .join("SKILL.md");
    std::fs::create_dir_all(skill_path.parent().expect("skill dir should exist"))
        .expect("system skill dir should be created");
    std::fs::write(&skill_path, "# plugin creator").expect("skill file should be written");

    let resolved = resolve_skill_path(&codex_home, "plugin-creator");

    assert_eq!(resolved, Some(skill_path));
    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证找不到 skill 时不会返回错误路径。
#[test]
fn resolve_skill_path_returns_none_when_skill_is_missing() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-resolve-skill-missing-{}",
        std::process::id()
    ));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    std::fs::create_dir_all(codex_home.join("skills")).expect("skills root should exist");

    let resolved = resolve_skill_path(&codex_home, "plugin-creator");

    assert_eq!(resolved, None);
    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证 runtime zip 中的 marketplace 目录会复制到当前 profile 的固定预装目录。
#[test]
fn install_builtin_plugin_marketplaces_copies_marketplace_into_profile() {
    let temp_root =
        std::env::temp_dir().join(format!("lex-vault-builtin-plugins-{}", std::process::id()));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("demo-market");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let plugin_manifest_path = resources_dir
        .join("plugins")
        .join("demo-plugin")
        .join(".codex-plugin")
        .join("plugin.json");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(
        plugin_manifest_path
            .parent()
            .expect("plugin manifest parent should exist"),
    )
    .expect("plugin dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "demo-plugin" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(
        &plugin_manifest_path,
        r#"{
  "name": "demo-plugin",
  "version": "1.0.0"
}"#,
    )
    .expect("plugin manifest should be written");

    let marketplaces = install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplace should be installed");

    let copied_marketplace = codex_home
        .join(CODEX_MARKETPLACES_DIRECTORY)
        .join("demo-market");
    assert_eq!(marketplaces.len(), 1);
    assert_eq!(marketplaces[0].name, "demo-market");
    assert_eq!(marketplaces[0].plugin_names, vec!["demo-plugin"]);
    assert!(
        copied_marketplace
            .join(".agents/plugins/marketplace.json")
            .is_file(),
        "copied marketplace manifest should exist"
    );
    assert!(
        copied_marketplace
            .join("plugins/demo-plugin/.codex-plugin/plugin.json")
            .is_file(),
        "copied plugin manifest should exist"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证重新同步时会用资源目录 manifest 覆写目标目录中的脏 marketplace 元数据。
#[test]
fn install_builtin_plugin_marketplaces_restores_marketplace_manifest() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-manifest-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("demo-market");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let source_manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let plugin_manifest_path = resources_dir
        .join("plugins")
        .join("demo-plugin")
        .join(".codex-plugin")
        .join("plugin.json");
    std::fs::create_dir_all(
        source_manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(
        plugin_manifest_path
            .parent()
            .expect("plugin manifest parent should exist"),
    )
    .expect("plugin dir should be created");
    std::fs::write(
        &source_manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "demo-plugin" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(
        &plugin_manifest_path,
        r#"{
  "name": "demo-plugin",
  "version": "1.0.0"
}"#,
    )
    .expect("plugin manifest should be written");

    let stale_manifest_path = codex_home
        .join(CODEX_MARKETPLACES_DIRECTORY)
        .join("demo-market")
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    std::fs::create_dir_all(
        stale_manifest_path
            .parent()
            .expect("stale manifest parent should exist"),
    )
    .expect("stale marketplace dir should be created");
    std::fs::write(
        &stale_manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "stale-plugin" }
  ]
}"#,
    )
    .expect("stale marketplace manifest should be written");

    install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplace should be installed");

    let restored_manifest =
        std::fs::read_to_string(&stale_manifest_path).expect("restored manifest should exist");
    assert!(
        restored_manifest.contains("\"demo-plugin\""),
        "restored manifest should contain source plugin entry: {restored_manifest}"
    );
    assert!(
        !restored_manifest.contains("\"stale-plugin\""),
        "restored manifest should not keep stale plugin entry: {restored_manifest}"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证重复同步相同的预装 marketplace 时会直接复用已有目录，避免 Windows 因目录占用导致删除失败。
#[test]
fn install_builtin_plugin_marketplaces_reuses_existing_directory_when_contents_match() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-reuse-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("demo-market");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let skill_file = resources_dir
        .join("plugins")
        .join("demo-plugin")
        .join("skills")
        .join("demo")
        .join("SKILL.md");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(skill_file.parent().expect("skill dir should exist"))
        .expect("skill dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "demo-plugin" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(&skill_file, "# same").expect("skill file should be written");

    install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("first marketplace install should succeed");
    let copied_manifest = codex_home
        .join(CODEX_MARKETPLACES_DIRECTORY)
        .join("demo-market")
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let first_write_time = std::fs::metadata(&copied_manifest)
        .expect("copied manifest should exist")
        .modified()
        .expect("copied manifest modified time should exist");

    std::thread::sleep(std::time::Duration::from_millis(1100));

    install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("second marketplace install should succeed");
    let second_write_time = std::fs::metadata(&copied_manifest)
        .expect("copied manifest should still exist")
        .modified()
        .expect("copied manifest modified time should still exist");

    assert_eq!(
        first_write_time, second_write_time,
        "unchanged marketplace should be reused instead of being recopied"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证预装插件内容变化后会生成新的指纹，便于后续增量预装。
#[test]
fn builtin_plugin_marketplaces_fingerprint_changes_when_content_changes() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-fingerprint-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("demo-market");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let skill_file = resources_dir
        .join("plugins")
        .join("demo-plugin")
        .join("skills")
        .join("demo")
        .join("SKILL.md");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(skill_file.parent().expect("skill dir should exist"))
        .expect("skill dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "demo-plugin" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(&skill_file, "# first").expect("skill file should be written");

    let marketplaces = install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplace should be installed");
    let first_fingerprint = builtin_plugin_marketplaces_fingerprint(&marketplaces)
        .expect("fingerprint should be calculated")
        .expect("fingerprint should exist");

    std::fs::write(
        codex_home
            .join(CODEX_MARKETPLACES_DIRECTORY)
            .join("demo-market")
            .join("plugins")
            .join("demo-plugin")
            .join("skills")
            .join("demo")
            .join("SKILL.md"),
        "# second",
    )
    .expect("copied skill file should be updated");

    let second_fingerprint = builtin_plugin_marketplaces_fingerprint(&marketplaces)
        .expect("fingerprint should be recalculated")
        .expect("fingerprint should exist");

    assert_ne!(first_fingerprint, second_fingerprint);

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证离线 marketplace 会写入当前 profile 的 config.toml，确保 runtime 启动后默认可见。
#[test]
fn ensure_builtin_plugin_marketplaces_config_writes_marketplaces_and_plugins() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-config-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("demo-market");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let plugin_manifest_path = resources_dir
        .join("plugins")
        .join("demo-plugin")
        .join(".codex-plugin")
        .join("plugin.json");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(
        plugin_manifest_path
            .parent()
            .expect("plugin manifest parent should exist"),
    )
    .expect("plugin dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "demo-market",
  "plugins": [
    { "name": "demo-plugin" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(
        &plugin_manifest_path,
        r#"{
  "name": "demo-plugin",
  "version": "1.0.0"
}"#,
    )
    .expect("plugin manifest should be written");

    let marketplaces = install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplace should be installed");
    ensure_builtin_plugin_marketplaces_config(&codex_home, &marketplaces)
        .expect("builtin plugin config should be written");

    let config_path = codex_home.join("config.toml");
    let config = std::fs::read_to_string(&config_path).expect("config should be readable");

    assert!(
        config.contains("[marketplaces.demo-market]"),
        "config should contain marketplace section: {config}"
    );
    assert!(
        config.contains("source_type = \"local\""),
        "config should mark bundled marketplace as local: {config}"
    );
    assert!(
        config.contains("[plugins.\"demo-plugin@demo-market\"]"),
        "config should contain enabled plugin section: {config}"
    );
    assert!(
        config.contains("enabled = true"),
        "config should enable bundled plugin by default: {config}"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证启动 runtime 前会把本地能力 MCP server 预写入 profile 配置，供 app-server 通过 URL 直连。
#[test]
fn ensure_builtin_local_mcp_server_config_writes_streamable_http_server() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-calendar-mcp-config-{}",
        std::process::id()
    ));
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    std::fs::create_dir_all(&codex_home).expect("codex home should exist");

    ensure_builtin_local_mcp_server_config(&codex_home, "http://127.0.0.1:3945/mcp")
        .expect("local mcp config should be written");

    let config =
        std::fs::read_to_string(codex_home.join("config.toml")).expect("config should be readable");
    assert!(
        config.contains("[mcp_servers.lex_vault_local]"),
        "config should contain builtin local mcp section: {config}"
    );
    assert!(
        config.contains("url = \"http://127.0.0.1:3945/mcp\""),
        "config should record builtin local mcp url: {config}"
    );
    assert!(
        !config.contains("command = "),
        "config should no longer keep stdio command mode: {config}"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证 memories 会按 app-server `config/batchWrite` 协议写入官方 feature flag。
#[test]
fn codex_memory_feature_config_uses_app_server_batch_write_shape() {
    let params = codex_memory_feature_config_batch_params();

    assert_eq!(
        params,
        serde_json::json!({
            "edits": [
                {
                    "keyPath": "features.memories",
                    "value": true,
                    "mergeStrategy": "replace"
                }
            ],
            "reloadUserConfig": true
        })
    );
}

/// 验证 app-server `config/read` 返回已启用 memories 时不会重复写配置。
#[test]
fn codex_memory_feature_config_detects_current_config() {
    assert!(codex_memory_feature_config_is_current(&serde_json::json!({
        "config": {
            "features": {
                "memories": true
            }
        }
    })));
    assert!(!codex_memory_feature_config_is_current(
        &serde_json::json!({
            "config": {
                "features": {
                    "memories": false
                }
            }
        })
    ));
}

/// 验证写入官方 marketplace 配置时，会清理旧版本遗留的 `kong` 标识与插件条目。
#[test]
fn ensure_builtin_plugin_marketplaces_config_removes_legacy_kong_entries() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-legacy-cleanup-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("openai-primary-runtime");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    let plugin_manifest_path = resources_dir
        .join("plugins")
        .join("documents")
        .join(".codex-plugin")
        .join("plugin.json");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::create_dir_all(
        plugin_manifest_path
            .parent()
            .expect("plugin manifest parent should exist"),
    )
    .expect("plugin dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "openai-primary-runtime",
  "plugins": [
    { "name": "documents" }
  ]
}"#,
    )
    .expect("marketplace manifest should be written");
    std::fs::write(
        &plugin_manifest_path,
        r#"{
  "name": "documents",
  "version": "1.0.0"
}"#,
    )
    .expect("plugin manifest should be written");

    let legacy_marketplace_dir = codex_home.join(CODEX_MARKETPLACES_DIRECTORY).join("kong");
    std::fs::create_dir_all(&legacy_marketplace_dir).expect("legacy marketplace dir should exist");
    std::fs::create_dir_all(&codex_home).expect("codex home should exist");
    std::fs::write(
        codex_home.join("config.toml"),
        r#"[marketplaces.kong]
source_type = "local"
source = "C:\\legacy\\kong"

[plugins."documents@kong"]
enabled = true
"#,
    )
    .expect("legacy config should be written");

    let marketplaces = install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplace should be installed");
    ensure_builtin_plugin_marketplaces_config(&codex_home, &marketplaces)
        .expect("builtin plugin config should be written");

    let config =
        std::fs::read_to_string(codex_home.join("config.toml")).expect("config should be readable");
    assert!(
        !config.contains("[marketplaces.kong]"),
        "legacy marketplace should be removed from config: {config}"
    );
    assert!(
        !config.contains("documents@kong"),
        "legacy plugin entry should be removed from config: {config}"
    );
    assert!(
        config.contains("[marketplaces.openai-primary-runtime]"),
        "official marketplace should exist after cleanup: {config}"
    );
    assert!(
        !legacy_marketplace_dir.exists(),
        "legacy marketplace dir should be removed from runtime home"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证某个预装 marketplace 不再声明插件后，会清理旧配置中的市场和插件残留。
#[test]
fn ensure_builtin_plugin_marketplaces_config_removes_stale_empty_marketplace_entries() {
    let temp_root = std::env::temp_dir().join(format!(
        "lex-vault-builtin-plugin-empty-marketplace-cleanup-{}",
        std::process::id()
    ));
    let resources_dir = temp_root
        .join("resources")
        .join("plugins")
        .join("openai-bundled");
    let codex_home = temp_root.join(CODEX_HOME_DIRECTORY);
    let manifest_path = resources_dir
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    std::fs::create_dir_all(
        manifest_path
            .parent()
            .expect("manifest parent should exist"),
    )
    .expect("marketplace dir should be created");
    std::fs::write(
        &manifest_path,
        r#"{
  "name": "openai-bundled",
  "plugins": []
}"#,
    )
    .expect("empty marketplace manifest should be written");

    let stale_marketplace_dir = codex_home
        .join(CODEX_MARKETPLACES_DIRECTORY)
        .join("openai-bundled");
    std::fs::create_dir_all(stale_marketplace_dir.join(".agents").join("plugins"))
        .expect("stale marketplace dir should be created");
    std::fs::write(
        stale_marketplace_dir
            .join(".agents")
            .join("plugins")
            .join("marketplace.json"),
        r#"{
  "name": "openai-bundled",
  "plugins": [
    { "name": "browser-use" }
  ]
}"#,
    )
    .expect("stale marketplace manifest should be written");
    std::fs::create_dir_all(&codex_home).expect("codex home should exist");
    std::fs::write(
        codex_home.join("config.toml"),
        r#"[marketplaces.openai-bundled]
source_type = "local"
source = "C:\\legacy\\openai-bundled"

[plugins."browser-use@openai-bundled"]
enabled = true
"#,
    )
    .expect("stale config should be written");

    let marketplaces = install_builtin_plugin_marketplaces_from(
        &temp_root.join("resources").join("plugins"),
        &codex_home,
    )
    .expect("marketplaces should load");
    assert!(
        marketplaces.is_empty(),
        "empty marketplace should not stay in preinstalled set"
    );

    ensure_builtin_plugin_marketplaces_config(&codex_home, &marketplaces)
        .expect("builtin plugin config should be rewritten");

    let config =
        std::fs::read_to_string(codex_home.join("config.toml")).expect("config should be readable");
    assert!(
        !config.contains("[marketplaces.openai-bundled]"),
        "empty marketplace section should be removed: {config}"
    );
    assert!(
        !config.contains("browser-use@openai-bundled"),
        "stale browser-use entry should be removed: {config}"
    );
    assert!(
        !stale_marketplace_dir.exists(),
        "stale empty marketplace dir should be removed from runtime home"
    );

    let _ = std::fs::remove_dir_all(temp_root);
}

/// 验证安装包配置会把内置 sidecar 资源目录一起打进客户端，避免客户机缺失 app-server。
#[test]
fn tauri_bundle_resources_include_builtin_binaries_directory() {
    let tauri_config_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&tauri_config_path).expect("tauri config should be readable");
    let config: Value = serde_json::from_str(&raw).expect("tauri config should be valid json");
    let resources = config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_builtin_binaries = resources.iter().any(|resource| {
        resource
            .as_str()
            .map(|value| value == "resources/binaries")
            .unwrap_or(false)
    });

    assert!(
        has_builtin_binaries,
        "tauri bundle resources should include resources/binaries so installers can ship bundled app-server sidecars"
    );
}

/// 验证安装包配置会把微信 helper 资源目录一起打进客户端，避免客户机缺失扫码脚本和最小依赖。
#[test]
fn tauri_bundle_resources_include_wechat_directory() {
    let tauri_config_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&tauri_config_path).expect("tauri config should be readable");
    let config: Value = serde_json::from_str(&raw).expect("tauri config should be valid json");
    let resources = config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_wechat_resources = resources.iter().any(|resource| {
        resource
            .as_str()
            .map(|value| value == "resources/wechat")
            .unwrap_or(false)
    });

    assert!(
        has_wechat_resources,
        "tauri bundle resources should include resources/wechat so installers can ship the wechat helper and its bundled npm dependencies"
    );
}

/// 验证安装包不再内置离线插件目录，避免把大体积插件资源打进安装包。
#[test]
fn tauri_bundle_resources_exclude_builtin_plugins_directory() {
    let tauri_config_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&tauri_config_path).expect("tauri config should be readable");
    let config: Value = serde_json::from_str(&raw).expect("tauri config should be valid json");
    let resources = config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_builtin_plugins = resources.iter().any(|resource| {
        resource
            .as_str()
            .map(|value| value == "resources/plugins")
            .unwrap_or(false)
    });

    assert!(
        !has_builtin_plugins,
        "tauri bundle resources should exclude resources/plugins so installers stay lightweight and plugins are loaded from the runtime zip"
    );
}

/// 验证安装包不再内置 runtime 目录，避免把 Python/Node 运行时打进安装包。
#[test]
fn tauri_bundle_resources_exclude_builtin_runtimes_directory() {
    let tauri_config_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&tauri_config_path).expect("tauri config should be readable");
    let config: Value = serde_json::from_str(&raw).expect("tauri config should be valid json");
    let resources = config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let has_builtin_runtimes = resources.iter().any(|resource| {
        resource
            .as_str()
            .map(|value| value == "resources/runtimes")
            .unwrap_or(false)
    });

    assert!(
        !has_builtin_runtimes,
        "tauri bundle resources should exclude resources/runtimes so runtime files are unpacked from the external zip instead of the installer"
    );
}

/// 验证 `plugin/list` 只在 marketplaces 下返回插件时，桌面端仍能正确展开成前端列表。
#[test]
fn plugin_list_result_flattens_marketplace_embedded_plugins() {
    let result = plugin_list_result_from_value(serde_json::json!({
        "marketplaces": [
            {
                "name": "kong",
                "path": "C:\\\\demo\\\\marketplace.json",
                "plugins": [
                    {
                        "id": "documents@kong",
                        "name": "documents",
                        "installed": false,
                        "enabled": true,
                        "availability": "AVAILABLE",
                        "interface": {
                            "displayName": "Documents",
                            "shortDescription": "Create and edit documents",
                            "category": "Productivity"
                        }
                    }
                ]
            }
        ],
        "marketplaceLoadErrors": [],
        "featuredPluginIds": []
    }));

    assert_eq!(result.marketplaces.len(), 1);
    assert_eq!(result.plugins.len(), 1);
    assert_eq!(result.plugins[0].id, "documents@kong");
    assert_eq!(result.plugins[0].plugin_name, "documents");
    assert_eq!(result.plugins[0].marketplace_name, "kong");
    assert_eq!(
        result.plugins[0].marketplace_path,
        "C:\\\\demo\\\\marketplace.json"
    );
    assert_eq!(result.plugins[0].name, "Documents");
    assert_eq!(result.plugins[0].category, "Productivity");
    assert!(!result.plugins[0].installed);
    assert!(result.plugins[0].enabled);
}
