use crate::build_runner::{self, BuildMode};
use crate::codegen::{self, CodegenPreview};
use crate::scene::*;
use crate::var_registry::*;
use serde::Deserialize;
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

/// Insert a fully-formed element (used by the canvas drawing tools, which know
/// the exact geometry the user dragged out). `parent_id` targets a group.
#[tauri::command]
pub fn add_element_full(
    element: SceneElement,
    parent_id: Option<String>,
    store: State<'_, SceneStore>,
) -> Result<SceneElement, String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    let list = s
        .children_mut(parent_id.as_deref())
        .ok_or_else(|| format!("Parent {parent_id:?} is not a group"))?;
    list.push(element.clone());
    Ok(element)
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

/// Same as `update_element` but consecutive calls sharing `tag` collapse into a
/// single undo step — for slider drags and number-field typing.
#[tauri::command]
pub fn update_element_live(
    id: String,
    patch: ElementKind,
    tag: String,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo_tagged(Some(tag));
    if let Some(el) = s.find_element_mut(&id) {
        el.kind = patch;
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ElementPatch {
    pub id: String,
    pub kind: ElementKind,
}

/// Apply many element updates as one undoable step — multi-select drags,
/// align/distribute, and nudges all land here.
#[tauri::command]
pub fn update_elements(
    patches: Vec<ElementPatch>,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    for p in patches {
        if let Some(el) = s.find_element_mut(&p.id) {
            el.kind = p.kind;
        }
    }
    Ok(())
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
pub fn delete_elements(ids: Vec<String>, store: State<'_, SceneStore>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    for id in ids {
        s.delete_element(&id);
    }
    Ok(())
}

/// Deep-clone each element (fresh ids throughout the subtree) and insert the
/// copy directly after its original. Returns the new top-level ids in order.
#[tauri::command]
pub fn duplicate_elements(
    ids: Vec<String>,
    store: State<'_, SceneStore>,
) -> Result<Vec<String>, String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    let mut new_ids = Vec::with_capacity(ids.len());
    for id in &ids {
        let (parent, siblings) = match s.siblings_of(id) {
            Some(v) => v,
            None => continue,
        };
        let idx = siblings.iter().position(|s| s == id).unwrap_or(0);
        let original = match s.children_mut(parent.as_deref()) {
            Some(list) => list[idx].clone(),
            None => continue,
        };
        let mut copy = original;
        regenerate_ids(&mut copy);
        copy.name = format!("{} copy", copy.name);
        new_ids.push(copy.id.clone());
        if let Some(list) = s.children_mut(parent.as_deref()) {
            list.insert(idx + 1, copy);
        }
    }
    if new_ids.is_empty() {
        Err("Nothing to duplicate".into())
    } else {
        Ok(new_ids)
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

/// Reorder one container's children. `parent_id` of None is the scene root.
#[tauri::command]
pub fn reorder_children(
    parent_id: Option<String>,
    ids: Vec<String>,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    let list = s
        .children_mut(parent_id.as_deref())
        .ok_or_else(|| format!("Parent {parent_id:?} is not a group"))?;
    let mut reordered = Vec::with_capacity(list.len());
    for id in &ids {
        if let Some(pos) = list.iter().position(|e| &e.id == id) {
            reordered.push(list[pos].clone());
        }
    }
    // Anything the caller did not mention keeps its relative order at the end.
    for el in list.iter() {
        if !ids.contains(&el.id) {
            reordered.push(el.clone());
        }
    }
    *list = reordered;
    Ok(())
}

/// Move `id` to `index` inside `parent_id` (None = scene root), reparenting if
/// needed. Rejects moving a group into its own subtree.
#[tauri::command]
pub fn move_element(
    id: String,
    parent_id: Option<String>,
    index: Option<usize>,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    if let Some(pid) = &parent_id {
        if s.is_ancestor_of(&id, pid) {
            return Err("Cannot move a group into itself".into());
        }
    }
    s.push_undo();
    let (el, _) = s
        .take_element(&id)
        .ok_or_else(|| format!("Element {id} not found"))?;
    let list = match s.children_mut(parent_id.as_deref()) {
        Some(l) => l,
        None => {
            // Target vanished — put it back at the root rather than losing it.
            s.scene.elements.push(el);
            return Err(format!("Parent {parent_id:?} is not a group"));
        }
    };
    let at = index.unwrap_or(list.len()).min(list.len());
    list.insert(at, el);
    Ok(())
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
pub fn set_element_locked(
    id: String,
    locked: bool,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    s.push_undo();
    if let Some(el) = s.find_element_mut(&id) {
        el.locked = locked;
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
    s.push_undo_tagged(Some(format!("rename:{id}")));
    if let Some(el) = s.find_element_mut(&id) {
        el.name = name.clone();
        if let ElementKind::Group { name: gname, .. } = &mut el.kind {
            *gname = name;
        }
        Ok(())
    } else {
        Err(format!("Element {} not found", id))
    }
}

// ─── Group management commands ─────────────────────────────────────

/// Wrap the given element IDs into a new Group. All ids must share a parent;
/// the group is inserted where the frontmost member sat.
#[tauri::command]
pub fn group_elements(ids: Vec<String>, store: State<'_, SceneStore>) -> Result<SceneElement, String> {
    if ids.is_empty() {
        return Err("No ids provided".into());
    }
    let mut s = store.lock().unwrap();

    let (parent, siblings) = s
        .siblings_of(&ids[0])
        .ok_or_else(|| format!("Element {} not found", ids[0]))?;
    // Keep the caller's ids in scene order so grouping never reshuffles art.
    let mut ordered: Vec<String> = siblings
        .iter()
        .filter(|sid| ids.contains(sid))
        .cloned()
        .collect();
    if ordered.is_empty() {
        return Err("None of the specified elements were found".into());
    }
    let insert_at = siblings
        .iter()
        .position(|sid| sid == ordered.last().unwrap())
        .unwrap_or(siblings.len());

    s.push_undo();
    let mut children = Vec::with_capacity(ordered.len());
    for id in ordered.drain(..) {
        if let Some((el, _)) = s.take_element(&id) {
            children.push(el);
        }
    }
    let group = make_group(children);
    let list = s
        .children_mut(parent.as_deref())
        .ok_or_else(|| "Parent group vanished".to_string())?;
    let at = insert_at.min(list.len());
    list.insert(at, group.clone());
    Ok(group)
}

/// Move a Group's children back into the group's own parent, at its position.
#[tauri::command]
pub fn ungroup(id: String, store: State<'_, SceneStore>) -> Result<(), String> {
    let mut s = store.lock().unwrap();
    let (parent, siblings) = s
        .siblings_of(&id)
        .ok_or_else(|| format!("Group {id} not found"))?;
    let pos = siblings.iter().position(|sid| sid == &id).unwrap_or(0);

    s.push_undo();
    let (el, _) = s
        .take_element(&id)
        .ok_or_else(|| format!("Group {id} not found"))?;
    let children = match el.kind {
        ElementKind::Group { children, .. } => children,
        _ => {
            // Not a group after all — restore it untouched.
            if let Some(list) = s.children_mut(parent.as_deref()) {
                list.insert(pos.min(list.len()), el);
            }
            return Err(format!("Element {id} is not a Group"));
        }
    };
    let list = s
        .children_mut(parent.as_deref())
        .ok_or_else(|| "Parent group vanished".to_string())?;
    for (i, child) in children.into_iter().enumerate() {
        let at = (pos + i).min(list.len());
        list.insert(at, child);
    }
    Ok(())
}

/// Move an element into a Group's children list, from anywhere in the tree.
#[tauri::command]
pub fn move_into_group(
    element_id: String,
    group_id: String,
    store: State<'_, SceneStore>,
) -> Result<(), String> {
    move_element(element_id, Some(group_id), None, store)
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
