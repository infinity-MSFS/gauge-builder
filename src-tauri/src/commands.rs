use crate::build_runner::{self, BuildMode};
use crate::codegen::{self, CodegenPreview};
use crate::project::{self, GaugeEntry, Manifest, ProjectInfo, ProjectOpen, ProjectStore};
use crate::refs::{self, RefImageInput};
use crate::scene::*;
use crate::var_registry::*;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;

// ─── Document helpers ──────────────────────────────────────────────

/// The scene as it should hit disk: the live document plus the variable
/// registry, so one gauge file is enough to reopen the gauge.
fn scene_for_disk(scene_store: &SceneStore, var_store: &VarStore) -> Scene {
    let mut scene = scene_store.lock().unwrap().scene.clone();
    scene.vars = var_store.lock().unwrap().vars.clone();
    scene
}

/// Make `scene` the editor's document: its variables become the registry and
/// the undo history starts fresh.
fn adopt_scene(mut scene: Scene, scene_store: &SceneStore, var_store: &VarStore) -> Scene {
    var_store.lock().unwrap().vars = std::mem::take(&mut scene.vars);
    scene_store.lock().unwrap().reset(scene.clone());
    scene
}

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

/// Write the scene RON, extracting the editor's reference images into a
/// `refs/` folder beside it so the project is self-contained.
#[tauri::command]
pub fn save_scene(
    path: String,
    ref_images: Vec<RefImageInput>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<(), String> {
    let mut scene = scene_for_disk(&scene_store, &var_store);
    let path = PathBuf::from(path);
    let project_dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();
    // The scene's own file name scopes its references, so saving one scene into
    // a folder never prunes the images belonging to another.
    let prefix = refs::prefix_for(&path.to_string_lossy());
    scene.ref_images =
        refs::extract_ref_images(&project_dir, &prefix, &ref_images, &HashSet::new())?;
    project::write_scene(&path, &scene)
}

#[tauri::command]
pub fn load_scene(
    path: String,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<Scene, String> {
    let scene = project::read_scene(Path::new(&path))?;
    Ok(adopt_scene(scene, &scene_store, &var_store))
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
    ref_images: Vec<RefImageInput>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<(), String> {
    let mut scene = scene_for_disk(&scene_store, &var_store);
    let vars = scene.vars.clone();
    let output_dir = PathBuf::from(output_dir);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let prefix = refs::prefix_for(&codegen::scene_ron_name(&scene));
    scene.ref_images =
        refs::extract_ref_images(&output_dir, &prefix, &ref_images, &HashSet::new())?;
    codegen::emit_project(&scene, &vars, &output_dir)
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

// ─── Project commands ──────────────────────────────────────────────
//
// A project is a folder of gauge scenes registered in a `project.ron`
// manifest. One gauge is open at a time; every command that changes which one
// takes the editor's reference images so the outgoing gauge is written out
// before its tab is left.

/// Persist the active gauge — scene RON, reference images, and the manifest
/// entry, which mirrors the scene's own name and size. A no-op when the editor
/// is working on a loose scene file rather than a project.
fn write_active_gauge(
    project: &ProjectStore,
    scene_store: &SceneStore,
    var_store: &VarStore,
    ref_images: &[RefImageInput],
) -> Result<(), String> {
    let mut p = project.lock().unwrap();
    let (root, active) = match (p.root.clone(), p.manifest.active.clone()) {
        (Some(root), Some(active)) => (root, active),
        _ => return Ok(()),
    };
    let entry = match p.manifest.find(&active) {
        Some(e) => e.clone(),
        None => return Ok(()),
    };

    let mut scene = scene_for_disk(scene_store, var_store);
    // Everything the project's other tabs still reference is off limits to this
    // gauge's prune, whatever its file name looks like.
    let in_use = project::refs_in_use(&root, &p.manifest, &active);
    scene.ref_images =
        refs::extract_ref_images(&root, &refs::prefix_for(&entry.file), ref_images, &in_use)?;
    project::write_scene(&root.join(&entry.file), &scene)?;

    if let Some(e) = p.manifest.find_mut(&active) {
        e.name = scene.gauge_name.clone();
        e.width = scene.width;
        e.height = scene.height;
    }
    project::write_manifest(&root, &p.manifest)
}

/// Load `id` into the editor and record it as the project's active gauge.
fn open_gauge(
    project: &ProjectStore,
    scene_store: &SceneStore,
    var_store: &VarStore,
    id: &str,
) -> Result<ProjectOpen, String> {
    let mut p = project.lock().unwrap();
    let root = p.require_root()?;
    let entry = p.require_gauge(id)?;
    let path = root.join(&entry.file);

    let scene = project::read_scene(&path)?;
    p.manifest.active = Some(id.to_string());
    project::write_manifest(&root, &p.manifest)?;
    let info = p.info().ok_or("No project is open")?;
    drop(p);

    Ok(ProjectOpen {
        project: info,
        scene: adopt_scene(scene, scene_store, var_store),
        path: path.to_string_lossy().to_string(),
    })
}

/// Write `scene` into the project under a fresh file name, register it at
/// `at` in the tab order, and open it.
fn insert_gauge(
    project: &ProjectStore,
    scene_store: &SceneStore,
    var_store: &VarStore,
    scene: &Scene,
    at: Option<usize>,
) -> Result<ProjectOpen, String> {
    let id = {
        let mut p = project.lock().unwrap();
        let root = p.require_root()?;
        let file = project::unique_file(&root, &p.manifest, &scene.gauge_name);
        project::write_scene(&root.join(&file), scene)?;
        let entry = project::entry_for(scene, file);
        let id = entry.id.clone();
        let at = at.unwrap_or(p.manifest.gauges.len()).min(p.manifest.gauges.len());
        p.manifest.gauges.insert(at, entry);
        project::write_manifest(&root, &p.manifest)?;
        id
    };
    open_gauge(project, scene_store, var_store, &id)
}

#[tauri::command]
pub fn get_project(project: State<'_, ProjectStore>) -> Option<ProjectInfo> {
    project.lock().unwrap().info()
}

/// Default codegen output directory for a gauge: `<root>/out/<scene file stem>`.
#[tauri::command]
pub fn gauge_output_dir(id: String, project: State<'_, ProjectStore>) -> Option<String> {
    let p = project.lock().unwrap();
    let root = p.root.as_ref()?;
    Some(project::gauge_out_dir(root, p.manifest.find(&id)?))
}

/// Open the project folder at `dir`, creating the manifest if the folder has
/// never been one. Loose `*.ron` scenes in the folder are registered on the way
/// in, so pointing this at a directory of existing scenes just works.
#[tauri::command]
pub fn open_project(
    dir: String,
    ref_images: Vec<RefImageInput>,
    app: tauri::AppHandle,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<ProjectOpen, String> {
    // Don't lose the gauge that is open in the project we are leaving.
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;

    let root = PathBuf::from(&dir);
    std::fs::create_dir_all(&root).map_err(|e| format!("Creating {root:?}: {e}"))?;
    let root = canonical_root(&root);

    let folder_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());

    let mut manifest = project::read_manifest(&root)?.unwrap_or_else(|| Manifest::new(folder_name));
    project::prune_missing(&root, &mut manifest);
    project::adopt_loose_scenes(&root, &mut manifest);

    let first = manifest.active_or_first().map(|g| g.id.clone());
    {
        let mut p = project.lock().unwrap();
        p.root = Some(root.clone());
        p.manifest = manifest;
    }
    project::remember_root(&app, Some(&root));

    match first {
        Some(id) => open_gauge(&project, &scene_store, &var_store, &id),
        // An empty folder gets one gauge, so the tab bar is never blank.
        None => insert_gauge(&project, &scene_store, &var_store, &Scene::default(), None),
    }
}

/// Absolute path, with Windows' verbatim `\\?\` prefix stripped so the path the
/// UI shows is the one the user typed.
fn canonical_root(root: &Path) -> PathBuf {
    match root.canonicalize() {
        Ok(abs) => {
            let text = abs.to_string_lossy().to_string();
            PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
        }
        Err(_) => root.to_path_buf(),
    }
}

/// Leave the project. The active gauge is written out first; the scene stays
/// open in the editor as a loose document.
#[tauri::command]
pub fn close_project(
    ref_images: Vec<RefImageInput>,
    app: tauri::AppHandle,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<(), String> {
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;
    project::remember_root(&app, None);
    let mut p = project.lock().unwrap();
    p.root = None;
    p.manifest = Manifest::default();
    Ok(())
}

/// Reopen the project the editor was last in, if its folder is still there.
/// Called once at startup; `None` simply means there is nothing to reopen.
#[tauri::command]
pub fn reopen_last_project(
    app: tauri::AppHandle,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<Option<ProjectOpen>, String> {
    let Some(root) = project::last_root(&app) else {
        return Ok(None);
    };
    match open_project(
        root.to_string_lossy().to_string(),
        Vec::new(),
        app.clone(),
        project,
        scene_store,
        var_store,
    ) {
        Ok(open) => Ok(Some(open)),
        Err(err) => {
            // A project that no longer opens shouldn't block startup — forget
            // it and come up on an empty scene.
            project::remember_root(&app, None);
            eprintln!("Reopening last project failed: {err}");
            Ok(None)
        }
    }
}

/// Write the active gauge without changing which one is open (Ctrl+S).
#[tauri::command]
pub fn save_gauge(
    ref_images: Vec<RefImageInput>,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<Option<ProjectInfo>, String> {
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;
    Ok(project.lock().unwrap().info())
}

/// Switch tabs: save what is open, then load `id`.
#[tauri::command]
pub fn select_gauge(
    id: String,
    ref_images: Vec<RefImageInput>,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<ProjectOpen, String> {
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;
    open_gauge(&project, &scene_store, &var_store, &id)
}

/// Add an empty gauge to the project and switch to it.
#[tauri::command]
pub fn add_gauge(
    name: String,
    width: Option<f32>,
    height: Option<f32>,
    ref_images: Vec<RefImageInput>,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<ProjectOpen, String> {
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;
    let scene = Scene {
        gauge_name: name,
        width: width.unwrap_or(512.0),
        height: height.unwrap_or(512.0),
        ..Scene::default()
    };
    insert_gauge(&project, &scene_store, &var_store, &scene, None)
}

/// Copy a gauge — elements, variables and layout — under a fresh name, placed
/// right after the original, and switch to it.
#[tauri::command]
pub fn duplicate_gauge(
    id: String,
    ref_images: Vec<RefImageInput>,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<ProjectOpen, String> {
    write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;

    let (mut scene, at) = {
        let p = project.lock().unwrap();
        let root = p.require_root()?;
        let entry = p.require_gauge(&id)?;
        let scene = project::read_scene(&root.join(&entry.file))?;
        (scene, p.manifest.position(&id).map(|i| i + 1))
    };
    scene.gauge_name = format!("{}_copy", scene.gauge_name);
    // References are re-extracted under the copy's own name on its first save;
    // until then it has none, so it never claims the original's files.
    scene.ref_images.clear();
    insert_gauge(&project, &scene_store, &var_store, &scene, at)
}

/// Rename a gauge. A tab's label is the scene's own `gauge_name`, so renaming a
/// background tab rewrites that gauge's RON.
#[tauri::command]
pub fn rename_gauge(
    id: String,
    name: String,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
) -> Result<ProjectInfo, String> {
    let mut p = project.lock().unwrap();
    let root = p.require_root()?;
    let entry = p.require_gauge(&id)?;

    if p.manifest.active.as_deref() == Some(id.as_str()) {
        let mut s = scene_store.lock().unwrap();
        s.push_undo();
        s.scene.gauge_name = name.clone();
    } else {
        let path = root.join(&entry.file);
        let mut scene = project::read_scene(&path)?;
        scene.gauge_name = name.clone();
        project::write_scene(&path, &scene)?;
    }

    if let Some(e) = p.manifest.find_mut(&id) {
        e.name = name;
    }
    project::write_manifest(&root, &p.manifest)?;
    p.info().ok_or_else(|| "No project is open".into())
}

/// Reorder the tab bar. Ids the caller omits keep their relative order at the end.
#[tauri::command]
pub fn reorder_gauges(
    ids: Vec<String>,
    project: State<'_, ProjectStore>,
) -> Result<ProjectInfo, String> {
    let mut p = project.lock().unwrap();
    let root = p.require_root()?;
    let mut reordered: Vec<GaugeEntry> = Vec::with_capacity(p.manifest.gauges.len());
    for id in &ids {
        if let Some(g) = p.manifest.find(id) {
            reordered.push(g.clone());
        }
    }
    for g in &p.manifest.gauges {
        if !ids.contains(&g.id) {
            reordered.push(g.clone());
        }
    }
    p.manifest.gauges = reordered;
    project::write_manifest(&root, &p.manifest)?;
    p.info().ok_or_else(|| "No project is open".into())
}

/// Remove a gauge from the project, optionally deleting its scene file. When
/// the last one goes an empty gauge takes its place, so a project always has a
/// gauge to show.
#[tauri::command]
pub fn delete_gauge(
    id: String,
    delete_file: bool,
    ref_images: Vec<RefImageInput>,
    project: State<'_, ProjectStore>,
    scene_store: State<'_, SceneStore>,
    var_store: State<'_, VarStore>,
) -> Result<ProjectOpen, String> {
    let removing_active =
        project.lock().unwrap().manifest.active.as_deref() == Some(id.as_str());
    // Writing out a gauge that is about to be deleted would just recreate it.
    if !removing_active {
        write_active_gauge(&project, &scene_store, &var_store, &ref_images)?;
    }

    let next = {
        let mut p = project.lock().unwrap();
        let root = p.require_root()?;
        let entry = p.require_gauge(&id)?;
        let pos = p.manifest.position(&id).unwrap_or(0);

        if delete_file {
            let path = root.join(&entry.file);
            std::fs::remove_file(&path).map_err(|e| format!("Deleting {path:?}: {e}"))?;
        }
        p.manifest.gauges.remove(pos);
        if removing_active {
            p.manifest.active = None;
        }
        project::write_manifest(&root, &p.manifest)?;

        // Fall through to the tab that slid into its place, else the last one.
        p.manifest.active.clone().or_else(|| {
            p.manifest
                .gauges
                .get(pos)
                .or_else(|| p.manifest.gauges.last())
                .map(|g| g.id.clone())
        })
    };

    match next {
        Some(id) => open_gauge(&project, &scene_store, &var_store, &id),
        None => insert_gauge(&project, &scene_store, &var_store, &Scene::default(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::ProjectState;
    use crate::refs::REFS_DIR;
    use crate::var_registry::VarRegistry;
    use std::sync::Mutex;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gauge_cmds_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn stores(root: &Path) -> (ProjectStore, SceneStore, VarStore) {
        let project = Mutex::new(ProjectState {
            root: Some(root.to_path_buf()),
            manifest: Manifest::new("test"),
        });
        (
            project,
            Mutex::new(SceneState::default()),
            Mutex::new(VarRegistry::default()),
        )
    }

    fn named(name: &str) -> Scene {
        Scene {
            gauge_name: name.into(),
            ..Scene::default()
        }
    }

    fn var(sim_name: &str) -> VarEntry {
        VarEntry {
            id: sim_name.into(),
            kind: VarKind::LVar,
            sim_name: sim_name.into(),
            unit: None,
            index: None,
            rust_type: RustVarType::F64,
            preview_value: 0.0,
        }
    }

    /// What `add_gauge` does: write the gauge on screen, then start a new one.
    fn add(
        p: &ProjectStore,
        s: &SceneStore,
        v: &VarStore,
        scene: &Scene,
    ) -> Result<ProjectOpen, String> {
        write_active_gauge(p, s, v, &[])?;
        insert_gauge(p, s, v, scene, None)
    }

    #[test]
    fn each_gauge_keeps_its_own_elements_and_variables() {
        let dir = temp_dir("switch");
        let (p, s, v) = stores(&dir);

        add(&p, &s, &v, &named("alpha")).unwrap();
        let alpha = p.lock().unwrap().manifest.active.clone().unwrap();
        s.lock()
            .unwrap()
            .scene
            .elements
            .push(ElementKindTag::Rect.default_element());
        v.lock().unwrap().add(var("ALPHA_RPM"));

        // Opening a second gauge writes the first out and starts clean.
        add(&p, &s, &v, &named("bravo")).unwrap();
        assert!(s.lock().unwrap().scene.elements.is_empty());
        assert!(v.lock().unwrap().vars.is_empty());
        v.lock().unwrap().add(var("BRAVO_OIL"));

        // Coming back restores exactly what was left behind.
        write_active_gauge(&p, &s, &v, &[]).unwrap();
        let back = open_gauge(&p, &s, &v, &alpha).unwrap();
        assert_eq!(back.scene.gauge_name, "alpha");
        assert_eq!(back.scene.elements.len(), 1);
        let vars = v.lock().unwrap().vars.clone();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].sim_name, "ALPHA_RPM");
        // The path handed back is where the frontend resolves `refs/` from.
        assert!(back.path.ends_with("alpha.ron"));

        // Both gauges are registered, and the manifest remembers the open one.
        let manifest = p.lock().unwrap().manifest.clone();
        assert_eq!(manifest.gauges.len(), 2);
        assert_eq!(manifest.active.as_deref(), Some(alpha.as_str()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_gauge_switch_does_not_leave_undo_pointing_at_the_old_scene() {
        let dir = temp_dir("undo");
        let (p, s, v) = stores(&dir);

        add(&p, &s, &v, &named("alpha")).unwrap();
        let alpha = p.lock().unwrap().manifest.active.clone().unwrap();
        s.lock().unwrap().push_undo();
        s.lock()
            .unwrap()
            .scene
            .elements
            .push(ElementKindTag::Circle.default_element());

        add(&p, &s, &v, &named("bravo")).unwrap();
        assert!(s.lock().unwrap().undo().is_none());

        // The history it dropped was not the alpha edit itself.
        let back = open_gauge(&p, &s, &v, &alpha).unwrap();
        assert_eq!(back.scene.elements.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_syncs_the_manifest_entry_with_the_scenes_own_name_and_size() {
        let dir = temp_dir("sync");
        let (p, s, v) = stores(&dir);

        add(&p, &s, &v, &named("alpha")).unwrap();
        {
            let mut scene = s.lock().unwrap();
            scene.scene.gauge_name = "Altimeter".into();
            scene.scene.width = 1024.0;
        }
        write_active_gauge(&p, &s, &v, &[]).unwrap();

        let entry = p.lock().unwrap().manifest.gauges[0].clone();
        assert_eq!(entry.name, "Altimeter");
        assert_eq!(entry.width, 1024.0);
        // The file name is fixed when the gauge is created; renaming keeps it.
        assert_eq!(entry.file, "alpha.ron");

        // And the manifest on disk agrees with the one in memory.
        let on_disk = project::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(on_disk.gauges[0].name, "Altimeter");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_duplicate_is_an_independent_copy() {
        let dir = temp_dir("duplicate");
        let (p, s, v) = stores(&dir);

        add(&p, &s, &v, &named("alpha")).unwrap();
        let alpha = p.lock().unwrap().manifest.active.clone().unwrap();
        s.lock()
            .unwrap()
            .scene
            .elements
            .push(ElementKindTag::Rect.default_element());
        write_active_gauge(&p, &s, &v, &[]).unwrap();

        // Mirrors `duplicate_gauge` without the Tauri State plumbing.
        let (mut copy, at) = {
            let p = p.lock().unwrap();
            let entry = p.require_gauge(&alpha).unwrap();
            let scene = project::read_scene(&dir.join(&entry.file)).unwrap();
            (scene, p.manifest.position(&alpha).map(|i| i + 1))
        };
        copy.gauge_name = format!("{}_copy", copy.gauge_name);
        copy.ref_images.clear();
        insert_gauge(&p, &s, &v, &copy, at).unwrap();

        let manifest = p.lock().unwrap().manifest.clone();
        assert_eq!(manifest.gauges.len(), 2);
        assert_eq!(manifest.gauges[1].name, "alpha_copy");
        assert_eq!(manifest.gauges[1].file, "alpha_copy.ron");
        assert_eq!(s.lock().unwrap().scene.elements.len(), 1);

        // Editing the copy leaves the original alone.
        s.lock().unwrap().scene.elements.clear();
        write_active_gauge(&p, &s, &v, &[]).unwrap();
        let original = project::read_scene(&dir.join("alpha.ron")).unwrap();
        assert_eq!(original.elements.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn saving_one_tab_leaves_another_tabs_reference_image_alone() {
        let dir = temp_dir("shared_refs");
        let (p, s, v) = stores(&dir);

        // Two gauges pointing at one image — how a project written before
        // references were namespaced per scene file looks on disk, and the
        // shape that had one tab's save delete the other tab's artwork.
        let shared = "refs/md_pfd_pasted_454eb139.png";
        std::fs::create_dir_all(dir.join(REFS_DIR)).unwrap();
        std::fs::write(dir.join(shared), b"pixels").unwrap();

        for file in ["md-pfd.ron", "scene.ron"] {
            let mut scene = named("md_pfd");
            scene.ref_images.push(RefImage {
                id: "r1".into(),
                name: "Pasted.png".into(),
                file: shared.into(),
                source: "Pasted.png".into(),
                x: 0.0,
                y: 0.0,
                w: 512.0,
                h: 512.0,
                opacity: 0.5,
                locked: false,
                visible: true,
            });
            project::write_scene(&dir.join(file), &scene).unwrap();
            let entry = project::entry_for(&scene, file.to_string());
            p.lock().unwrap().manifest.gauges.push(entry);
        }
        let md_pfd = p.lock().unwrap().manifest.gauges[0].id.clone();
        p.lock().unwrap().manifest.active = Some(md_pfd);

        // The editor is showing md-pfd with its reference layer empty, so this
        // save has every excuse to prune the file — except that scene.ron
        // still needs it.
        write_active_gauge(&p, &s, &v, &[]).unwrap();
        assert!(dir.join(shared).exists(), "a file the other tab uses was pruned");

        let other = project::read_scene(&dir.join("scene.ron")).unwrap();
        assert_eq!(other.ref_images.len(), 1);
        assert!(dir.join(&other.ref_images[0].file).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
