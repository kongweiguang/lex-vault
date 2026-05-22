//! Tauri 应用装配入口，集中注册插件、命令和启动生命周期。
//!
//! @author kongweiguang

use crate::{commands, local_mcp_server, tray, update_manager, window};
use tauri::{Manager, RunEvent};

/// 启动 Tauri 应用，并保持所有对外命令名称稳定。
pub fn run() {
    tauri::Builder::default()
        .manage(commands::codex::AppState::default())
        .manage(commands::wechat::WechatLoginState::default())
        .manage(commands::wechat::WechatThreadBridgeState::default())
        .manage(local_mcp_server::LocalMcpRuntimeState::default())
        .manage(update_manager::AppUpdateStateStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main_window(&app);
            if let Some(webview_window) = app.get_webview_window("main") {
                let _ = webview_window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            let log_dir = crate::logging::initialize_logging()
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            crate::logging::log_with_details(
                "INFO",
                "app_setup",
                "Lex Vault 桌面端启动初始化完成",
                serde_json::json!({
                    "logDir": log_dir,
                    "version": env!("CARGO_PKG_VERSION"),
                }),
            );
            let config = commands::local_data::initialize_local_home()
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            app.state::<local_mcp_server::LocalMcpRuntimeState>()
                .ensure_started(
                    (!config.workspace_database.trim().is_empty())
                        .then(|| std::path::PathBuf::from(config.workspace_database.as_str())),
                )
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            tray::create_main_tray(app)?;
            window::initialize_main_window(app);
            commands::wechat::spawn_wechat_auto_resume(app.handle().clone());
            update_manager::spawn_silent_update_check(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_window_theme,
            commands::notify_desktop,
            commands::get_app_update_status,
            commands::check_app_update,
            commands::download_and_install_app_update,
            commands::wechat::wechat_login_start,
            commands::wechat::wechat_login_cancel,
            commands::wechat::wechat_status_read,
            commands::wechat::wechat_send_message,
            commands::file_manager::list_native_files,
            commands::file_manager::read_native_file,
            commands::file_manager::create_native_file,
            commands::file_manager::create_native_folder,
            commands::file_manager::rename_native_path,
            commands::file_manager::copy_native_path,
            commands::file_manager::delete_native_path,
            commands::file_manager::write_native_file,
            commands::file_manager::import_native_paths,
            commands::file_manager::read_clipboard_file_paths,
            commands::file_manager::fetch_remote_law_index,
            commands::file_manager::download_remote_file_to_library,
            commands::file_manager::open_native_file,
            commands::file_manager::open_native_directory,
            commands::file_manager::reveal_native_path,
            commands::codex::command_handlers::codex_prepare_runtime_bundle,
            commands::codex::command_handlers::codex_start_runtime,
            commands::codex::command_handlers::codex_stop_runtime,
            commands::codex::command_handlers::codex_start_thread,
            commands::codex::command_handlers::codex_resume_thread,
            commands::codex::command_handlers::codex_list_threads,
            commands::codex::command_handlers::codex_read_thread,
            commands::codex::command_handlers::codex_start_legal_turn,
            commands::codex::command_handlers::codex_interrupt_turn,
            commands::codex::command_handlers::codex_compact_thread,
            commands::codex::command_handlers::codex_set_thread_memory_mode,
            commands::codex::command_handlers::codex_reset_memory,
            commands::codex::command_handlers::codex_respond_approval,
            commands::codex::command_handlers::codex_list_plugins,
            commands::codex::command_handlers::codex_read_plugin,
            commands::codex::command_handlers::codex_install_plugin,
            commands::codex::command_handlers::codex_uninstall_plugin,
            commands::codex::command_handlers::codex_add_marketplace,
            commands::codex::command_handlers::codex_remove_marketplace,
            commands::codex::command_handlers::codex_upgrade_marketplace,
            commands::local_data::get_app_config,
            commands::local_data::update_app_config,
            commands::local_data::get_auth_info,
            commands::local_data::update_auth_info,
            commands::local_data::clear_auth_info,
            commands::local_data::list_calendar_events_command,
            commands::local_data::create_calendar_event_command,
            commands::local_data::update_calendar_event_command,
            commands::local_data::delete_calendar_event_command,
            commands::local_data::complete_calendar_event_command,
            commands::local_data::list_calendar_agenda_command,
            commands::local_data::list_calendar_templates_command,
            commands::local_data::apply_calendar_template_command,
            commands::local_data::search_calendar_conflicts_command,
            commands::local_data::list_recurring_calendar_rules_command,
            commands::local_data::create_recurring_calendar_rule_command,
            commands::local_data::update_recurring_calendar_rule_command,
            commands::local_data::pause_recurring_calendar_rule_command,
            commands::local_data::delete_recurring_calendar_rule_command,
            commands::local_data::preview_recurring_calendar_rule_command,
            commands::local_data::list_calendar_schedule_items_command,
            commands::local_data::mark_recurring_calendar_delivery_command,
            commands::local_data::get_billing_case_setting_command,
            commands::local_data::upsert_billing_case_setting_command,
            commands::local_data::list_billing_time_entries_command,
            commands::local_data::create_billing_time_entry_command,
            commands::local_data::update_billing_time_entry_command,
            commands::local_data::delete_billing_time_entry_command,
            commands::local_data::list_billing_expense_entries_command,
            commands::local_data::create_billing_expense_entry_command,
            commands::local_data::update_billing_expense_entry_command,
            commands::local_data::delete_billing_expense_entry_command,
            commands::local_data::list_billing_case_summaries_command
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                commands::wechat::shutdown_wechat_receiver(app);
            }
        });
}
