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

// ─── Group management commands ─────────────────────────────────────

/// Wrap the given top-level element IDs into a new Group (preserving order).
#[tauri::command]
pub fn group_elements(ids: Vec<String>, store: State<'_, SceneStore>) -> Result<SceneElement, String> {
    if ids.is_empty() {
        return Err("No ids provided".into());
    }
    let mut s = store.lock().unwrap();
    s.push_undo();

    // Collect elements in the requested order, removing from top-level.
    let mut children: Vec<SceneElement> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(pos) = s.scene.elements.iter().position(|e| &e.id == id) {
            children.push(s.scene.elements.remove(pos));
        }
    }
    if children.is_empty() {
        return Err("None of the specified elements found at top level".into());
    }

    let group = make_group(children);
    s.scene.elements.push(group.clone());
    Ok(group)
}

/// Move a Group's children back to top-level (at the group's position).
#[tauri::command]
pub fn ungroup(id: String, store: State<'_, SceneStore>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    if let Some(pos) = s.scene.elements.iter().position(|e| e.id == id) {
        if let ElementKind::Group { children, .. } = s.scene.elements[pos].kind.clone() {
            s.push_undo();
            s.scene.elements.remove(pos);
            for (i, child) in children.into_iter().enumerate() {
                s.scene.elements.insert(pos + i, child);
            }
            Ok(())
        } else {
            Err(format!("Element {id} is not a Group"))
        }
    } else {
        Err(format!("Group {id} not found at top level"))
    }
}

/// Move a top-level element into a Group's children list.
#[tauri::command]
pub fn move_into_group(
    element_id: String,
    group_id: String,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();

    // Extract the element from top-level first.
    let pos = s.scene.elements.iter().position(|e| e.id == element_id)
        .ok_or_else(|| format!("Element {element_id} not found at top level"))?;
    s.push_undo();
    let el = s.scene.elements.remove(pos);

    // Find the group and push the element into it.
    if let Some(group) = s.scene.elements.iter_mut().find(|e| e.id.as_str() == group_id) {
        if let ElementKind::Group { children, .. } = &mut group.kind {
            children.push(el);
            Ok(())
        } else {
            // Rollback: reinsert element
            s.scene.elements.insert(pos, el);
            Err(format!("Element {group_id} is not a Group"))
        }
    } else {
        s.scene.elements.insert(pos, el);
        Err(format!("Group {group_id} not found"))
    }
}

/// Add a new element directly into a group's children list.
#[tauri::command]
pub fn add_element_to_group(
    kind: ElementKindTag,
    group_id: String,
    store: State<'_, SceneStore>,
) -> Result<SceneElement, String> {
    let el = kind.default_element();
    let mut s = store.lock().unwrap();
    s.push_undo();
    if let Some(group) = s.find_element_mut(&group_id) {
        if let ElementKind::Group { children, .. } = &mut group.kind {
            children.push(el.clone());
            Ok(el)
        } else {
            Err(format!("Element {group_id} is not a Group"))
        }
    } else {
        Err(format!("Group {group_id} not found"))
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
