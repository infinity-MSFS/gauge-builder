use crate::build_runner::{self, BuildMode};
use crate::codegen::{self, CodegenPreview};
use crate::scene::*;
use crate::var_registry::*;
use std::path::PathBuf;
use tauri::State;

// ─── Scene commands ────────────────────────────────────────────────

#[tauri::command]
pub fn get_scene(store: State<'_, SceneStore>) -> Scene {
    store.lock().unwrap().scene.clone()
}

#[tauri::command]
pub fn set_gauge_meta(
    name: String,
    width: f32,
    height: f32,
    store: State<'_, SceneStore>,
) {
    let mut s = store.lock().unwrap();
    s.push_undo();
    s.scene.gauge_name = name;
    s.scene.width = width;
    s.scene.height = height;
}

#[tauri::command]
pub fn add_element(kind: ElementKindTag, store: State<'_, SceneStore>) -> SceneElement {
    let el = kind.default_element();
    let mut s = store.lock().unwrap();
    s.push_undo();
    s.scene.elements.push(el.clone());
    el
}

#[tauri::command]
pub fn update_element(
    id: String,
    patch: ElementKind,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    if let Some(el) = s.find_element_mut(&id) {
        el.kind = patch;
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

#[tauri::command]
pub fn delete_element(id: String, store: State<'_, SceneStore>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    if s.delete_element(&id) {
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

#[tauri::command]
pub fn reorder_elements(ids: Vec<String>, store: State<'_, SceneStore>) {
    let mut s = store.lock().unwrap();
    s.push_undo();
    let mut reordered = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(pos) = s.scene.elements.iter().position(|e| &e.id == id) {
            reordered.push(s.scene.elements[pos].clone());
        }
    }
    s.scene.elements = reordered;
}

#[tauri::command]
pub fn set_element_visible(
    id: String,
    visible: bool,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    if let Some(el) = s.find_element_mut(&id) {
        el.visible = visible;
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

#[tauri::command]
pub fn rename_element(
    id: String,
    name: String,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    if let Some(el) = s.find_element_mut(&id) {
        el.name = name;
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

#[tauri::command]
pub fn undo(store: State<'_, SceneStore>) -> Result<Scene, String> {
    store.lock().unwrap().undo().ok_or("Nothing to undo".into())
}

#[tauri::command]
pub fn redo(store: State<'_, SceneStore>) -> Result<Scene, String> {
    store.lock().unwrap().redo().ok_or("Nothing to redo".into())
}

#[tauri::command]
pub fn save_scene(path: String, store: State<'_, SceneStore>) -> Result<(), String> {
    let scene = store.lock().unwrap().scene.clone();
    let ron_str =
        ron::ser::to_string_pretty(&scene, ron::ser::PrettyConfig::default())
            .map_err(|e| e.to_string())?;
    std::fs::write(&path, ron_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_scene(path: String, store: State<'_, SceneStore>) -> Result<Scene, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let scene: Scene = ron::from_str(&content).map_err(|e| e.to_string())?;
    let mut s = store.lock().unwrap();
    s.push_undo();
    s.scene = scene.clone();
    Ok(scene)
}

// ─── Var registry commands ─────────────────────────────────────────

#[tauri::command]
pub fn get_vars(store: State<'_, VarStore>) -> Vec<VarEntry> {
    store.lock().unwrap().vars.clone()
}

#[tauri::command]
pub fn add_var(entry: VarEntry, store: State<'_, VarStore>) {
    store.lock().unwrap().add(entry);
}

#[tauri::command]
pub fn update_var(id: String, entry: VarEntry, store: State<'_, VarStore>) -> Result<(), String> {
    if store.lock().unwrap().update(&id, entry) {
        Ok(())
    } else {
        Err(format!("Var {} not found", id))
    }
}

#[tauri::command]
pub fn delete_var(id: String, store: State<'_, VarStore>) -> Result<(), String> {
    if store.lock().unwrap().delete(&id) {
        Ok(())
    } else {
        Err(format!("Var {} not found", id))
    }
}

// ─── Codegen commands ──────────────────────────────────────────────

#[tauri::command]
pub fn codegen_preview(
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> CodegenPreview {
    let scene = scene_store.lock().unwrap().scene.clone();
    let vars = var_store.lock().unwrap().vars.clone();
    codegen::preview(&scene, &vars)
}

#[tauri::command]
pub fn emit_project(
    output_dir: String,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<(), String> {
    let scene = scene_store.lock().unwrap().scene.clone();
    let vars = var_store.lock().unwrap().vars.clone();
    codegen::emit_project(&scene, &vars, &PathBuf::from(output_dir))
}

// ─── Build commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn run_build(
    output_dir: String,
    mode: BuildMode,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    build_runner::run_build(&PathBuf::from(output_dir), mode, app_handle).await
}
