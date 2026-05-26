//! codex_process 模块回归测试。
//!
//! @author kongweiguang

use super::{
    binary_names_for_target, build_runtime_environment, is_direct_app_server_binary_name,
    join_environment_paths, node_executable_candidates, prepend_path_entries,
    python_executable_candidates, resolve_runtime_executable, target_suffix_for_platform,
    BuiltinRuntimeConfig,
};

#[test]
fn binary_names_for_windows_use_agent_server_prefix() {
    assert_eq!(
        binary_names_for_target("windows", "x86_64"),
        vec!["agent-server-x86_64-pc-windows-msvc.exe".to_string()]
    );
}

#[test]
fn binary_names_for_macos_include_darwin_target() {
    assert_eq!(
        binary_names_for_target("macos", "aarch64"),
        vec!["agent-server-aarch64-apple-darwin".to_string()]
    );
}

#[test]
fn target_suffix_for_unknown_platform_returns_none() {
    assert_eq!(target_suffix_for_platform("freebsd", "x86_64"), None);
}

#[test]
fn direct_app_server_binary_name_only_accepts_agent_server_prefix() {
    assert!(is_direct_app_server_binary_name(
        "agent-server-x86_64-pc-windows-msvc"
    ));
    assert!(!is_direct_app_server_binary_name(
        "codex-app-server-x86_64-pc-windows-msvc"
    ));
    assert!(!is_direct_app_server_binary_name("codex"));
}

#[test]
fn build_runtime_environment_injects_builtin_runtime_variables_and_prepends_path() {
    let original_path = std::env::var("PATH").ok();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let existing_path = if cfg!(windows) {
        r"C:\Windows\System32;C:\Tools".to_string()
    } else {
        "/usr/bin:/bin".to_string()
    };
    let python_path = if cfg!(windows) {
        r"C:\Runtime\Python\python.exe".to_string()
    } else {
        "/opt/python/bin/python".to_string()
    };
    let node_path = if cfg!(windows) {
        r"C:\Runtime\Node\node.exe".to_string()
    } else {
        "/opt/node/bin/node".to_string()
    };
    let python_dir = std::path::Path::new(&python_path)
        .parent()
        .expect("python dir")
        .display()
        .to_string();
    let node_dir = std::path::Path::new(&node_path)
        .parent()
        .expect("node dir")
        .display()
        .to_string();
    unsafe {
        std::env::set_var("PATH", &existing_path);
    }

    let env = build_runtime_environment(&BuiltinRuntimeConfig {
        python_executable: python_path.clone(),
        node_executable: node_path.clone(),
        runtime_root: if cfg!(windows) {
            r"C:\Runtime\agent-primary-runtime".to_string()
        } else {
            "/opt/agent-primary-runtime".to_string()
        },
        tools_directory: Some(if cfg!(windows) {
            r"C:\Runtime\LexVault\tools".to_string()
        } else {
            "/opt/lex-vault/tools".to_string()
        }),
        node_module_directories: vec![if cfg!(windows) {
            r"C:\Runtime\agent-primary-runtime\dependencies\node\node_modules".to_string()
        } else {
            "/opt/agent-primary-runtime/dependencies/node/node_modules".to_string()
        }],
        path_entries: vec![
            std::path::PathBuf::from(&python_dir),
            std::path::PathBuf::from(&node_dir),
            std::path::PathBuf::from(if cfg!(windows) {
                r"C:\Runtime\LexVault\tools"
            } else {
                "/opt/lex-vault/tools"
            }),
        ],
    });

    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_PYTHON" && value == &python_path));
    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_NODE" && value == &node_path));
    assert!(env
        .iter()
        .any(|(key, value)| key == "LEX_VAULT_RUNTIME_ROOT"
            && value.contains("agent-primary-runtime")));
    assert!(env
        .iter()
        .any(|(key, value)| { key == "LEX_VAULT_TOOLS_DIR" && value.contains("tools") }));
    assert!(env.iter().any(|(key, value)| {
        key == "NODE_REPL_NODE_MODULE_DIRS" && value.contains("node_modules")
    }));
    let path_value = env
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .expect("PATH should be injected");
    assert!(path_value.starts_with(&format!("{python_dir}{separator}{node_dir}{separator}")));
    assert!(path_value.contains("tools"));
    assert!(path_value.contains(&existing_path));

    restore_path(original_path);
}

#[test]
fn prepend_path_entries_deduplicates_runtime_directories() {
    let original_path = std::env::var("PATH").ok();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let existing_path = if cfg!(windows) {
        r"C:\Windows\System32;C:\Tools".to_string()
    } else {
        "/usr/bin:/bin".to_string()
    };
    let python_dir = if cfg!(windows) {
        r"C:\Runtime\Python"
    } else {
        "/opt/python"
    };
    let node_dir = if cfg!(windows) {
        r"C:\Runtime\Node"
    } else {
        "/opt/node"
    };
    unsafe {
        std::env::set_var("PATH", &existing_path);
    }

    let path_value = prepend_path_entries(&[
        std::path::PathBuf::from(python_dir),
        std::path::PathBuf::from(python_dir),
        std::path::PathBuf::from(node_dir),
    ])
    .expect("PATH should be built");

    assert_eq!(
        path_value,
        format!("{python_dir}{separator}{node_dir}{separator}{existing_path}")
    );
    restore_path(original_path);
}

#[test]
fn join_environment_paths_uses_platform_separator() {
    let value = join_environment_paths(&["one".to_string(), "two".to_string()]);
    if cfg!(windows) {
        assert_eq!(value, "one;two");
    } else {
        assert_eq!(value, "one:two");
    }
}

#[test]
fn resolve_runtime_executable_reads_current_platform_candidates() {
    let runtime_root = temp_runtime_root();
    let relative_python = python_executable_candidates()[0];
    let relative_node = node_executable_candidates()[0];
    let python_file = runtime_root.join(relative_python);
    let node_file = runtime_root.join(relative_node);
    if let Some(parent) = python_file.parent() {
        std::fs::create_dir_all(parent).expect("python runtime dir should exist");
    }
    if let Some(parent) = node_file.parent() {
        std::fs::create_dir_all(parent).expect("node runtime dir should exist");
    }
    std::fs::write(&python_file, b"python").expect("python runtime file should exist");
    std::fs::write(&node_file, b"node").expect("node runtime file should exist");

    let resolved_python = resolve_runtime_executable(&runtime_root, python_executable_candidates())
        .expect("python executable should resolve");
    let resolved_node = resolve_runtime_executable(&runtime_root, node_executable_candidates())
        .expect("node executable should resolve");

    assert_eq!(resolved_python, python_file.display().to_string());
    assert_eq!(resolved_node, node_file.display().to_string());

    let _ = std::fs::remove_dir_all(runtime_root);
}

fn restore_path(original_path: Option<String>) {
    match original_path {
        Some(path) => unsafe {
            std::env::set_var("PATH", path);
        },
        None => unsafe {
            std::env::remove_var("PATH");
        },
    }
}

fn temp_runtime_root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("lex-vault-runtime-tests-{}", uuid::Uuid::new_v4()))
}
