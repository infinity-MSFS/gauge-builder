mod build_runner;
mod codegen;
mod commands;
mod scene;
mod var_registry;

use scene::SceneState;
use std::sync::Mutex;
use var_registry::VarRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(SceneState::default()))
        .manage(Mutex::new(VarRegistry::default()))
        .invoke_handler(tauri::generate_handler![
            commands::get_scene,
            commands::set_gauge_meta,
            commands::add_element,
            commands::update_element,
            commands::delete_element,
            commands::reorder_elements,
            commands::set_element_visible,
            commands::rename_element,
            commands::undo,
            commands::redo,
            commands::save_scene,
            commands::load_scene,
            commands::get_vars,
            commands::add_var,
            commands::update_var,
            commands::delete_var,
            commands::codegen_preview,
            commands::emit_project,
            commands::run_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
