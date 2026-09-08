//! Project folders.
//!
//! A project is a directory holding one scene RON per gauge plus a
//! `project.ron` manifest that registers them:
//!
//! ```text
//! dc-gauge-builder-projects/
//!   project.ron          the manifest — one entry per gauge
//!   altimeter.ron        a gauge scene (elements, vars, reference metadata)
//!   airspeed.ron
//!   refs/                tracing images, already namespaced per gauge
//!   out/altimeter/       the crate codegen emits for that gauge
//! ```
//!
//! The editor holds one gauge open at a time; the tab bar switches between the
//! manifest's entries, saving the outgoing gauge on the way out. Gauge scene
//! files sit directly in the root so they share the one `refs/` folder — the
//! reference extractor already seeds file names per gauge, so they never
//! collide.

use crate::refs::slug;
use crate::scene::{scene_to_ron, Scene};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub const MANIFEST_NAME: &str = "project.ron";
pub const MANIFEST_VERSION: u32 = 1;
/// Default parent for emitted crates, one subfolder per gauge.
pub const OUT_DIR: &str = "out";

// ─── Manifest ──────────────────────────────────────────────────────

/// One registered gauge. `name` and the size mirror the scene's own metadata so
/// the tab bar can render without opening every file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GaugeEntry {
    pub id: String,
    pub name: String,
    /// Scene RON path relative to the project root, e.g. `altimeter.ron`.
    pub file: String,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub name: String,
    pub gauges: Vec<GaugeEntry>,
    /// Gauge the editor had open last, reopened when the project is reopened.
    #[serde(default)]
    pub active: Option<String>,
}

impl Manifest {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            version: MANIFEST_VERSION,
            name: name.into(),
            gauges: Vec::new(),
            active: None,
        }
    }

    pub fn find(&self, id: &str) -> Option<&GaugeEntry> {
        self.gauges.iter().find(|g| g.id == id)
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut GaugeEntry> {
        self.gauges.iter_mut().find(|g| g.id == id)
    }

    pub fn position(&self, id: &str) -> Option<usize> {
        self.gauges.iter().position(|g| g.id == id)
    }

    /// The gauge to open: the recorded one while it still exists, else the first.
    pub fn active_or_first(&self) -> Option<&GaugeEntry> {
        self.active
            .as_deref()
            .and_then(|id| self.find(id))
            .or_else(|| self.gauges.first())
    }
}

impl Default for Manifest {
    fn default() -> Self {
        Self::new("project")
    }
}

// ─── Editor-side state ─────────────────────────────────────────────

pub struct ProjectState {
    /// `None` while the editor is working on a loose scene file.
    pub root: Option<PathBuf>,
    pub manifest: Manifest,
}

impl Default for ProjectState {
    fn default() -> Self {
        Self {
            root: None,
            manifest: Manifest::default(),
        }
    }
}

pub type ProjectStore = Mutex<ProjectState>;

/// The open project as the frontend sees it.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    /// Absolute path of the project folder.
    pub root: String,
    pub manifest: Manifest,
}

/// Result of anything that changes which gauge is open: the new project state
/// plus the scene now loaded and the absolute path it came from (the frontend
/// resolves the scene's `refs/` entries against that path).
#[derive(Debug, Clone, Serialize)]
pub struct ProjectOpen {
    pub project: ProjectInfo,
    pub scene: Scene,
    pub path: String,
}

impl ProjectState {
    pub fn info(&self) -> Option<ProjectInfo> {
        self.root.as_ref().map(|root| ProjectInfo {
            root: root.to_string_lossy().to_string(),
            manifest: self.manifest.clone(),
        })
    }

    pub fn require_root(&self) -> Result<PathBuf, String> {
        self.root.clone().ok_or_else(|| "No project is open".to_string())
    }

    pub fn require_gauge(&self, id: &str) -> Result<GaugeEntry, String> {
        self.manifest
            .find(id)
            .cloned()
            .ok_or_else(|| format!("Gauge {id} is not in this project"))
    }
}

// ─── Disk I/O ──────────────────────────────────────────────────────

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(MANIFEST_NAME)
}

/// Read the manifest, or `None` when the folder has never been a project.
/// A manifest that fails to parse is an error — silently replacing it would
/// throw away the user's gauge registrations.
pub fn read_manifest(root: &Path) -> Result<Option<Manifest>, String> {
    let path = manifest_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("Reading {path:?}: {e}"))?;
    ron::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{MANIFEST_NAME} is not valid: {e}"))
}

pub fn write_manifest(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let text = ron::ser::to_string_pretty(manifest, ron::ser::PrettyConfig::default())
        .map_err(|e| e.to_string())?;
    fs::write(manifest_path(root), text).map_err(|e| format!("Writing {MANIFEST_NAME}: {e}"))
}

pub fn read_scene(path: &Path) -> Result<Scene, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Reading {path:?}: {e}"))?;
    ron::from_str(&text).map_err(|e| format!("{path:?} is not a valid scene: {e}"))
}

pub fn write_scene(path: &Path, scene: &Scene) -> Result<(), String> {
    fs::write(path, scene_to_ron(scene)?).map_err(|e| format!("Writing {path:?}: {e}"))
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// Turn a scene into a manifest entry pointing at `file`.
pub fn entry_for(scene: &Scene, file: String) -> GaugeEntry {
    GaugeEntry {
        id: new_id(),
        name: scene.gauge_name.clone(),
        file,
        width: scene.width,
        height: scene.height,
    }
}

/// A `<slug>.ron` name free both on disk and in the manifest.
pub fn unique_file(root: &Path, manifest: &Manifest, name: &str) -> String {
    let base = slug(name);
    let mut candidate = format!("{base}.ron");
    let mut n = 2;
    while root.join(&candidate).exists() || manifest.gauges.iter().any(|g| g.file == candidate) {
        candidate = format!("{base}_{n}.ron");
        n += 1;
    }
    candidate
}

/// Register every `*.ron` in the root that parses as a scene and isn't already
/// listed — dropping a scene file into the folder is enough to pick it up, and
/// it turns a plain folder of scenes into a project on first open.
pub fn adopt_loose_scenes(root: &Path, manifest: &mut Manifest) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut found: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == MANIFEST_NAME || !name.to_ascii_lowercase().ends_with(".ron") {
            continue;
        }
        if !entry.path().is_file() || manifest.gauges.iter().any(|g| g.file == name) {
            continue;
        }
        found.push(name);
    }
    // Directory order is filesystem-dependent; sort so tabs come back the same
    // way on every machine.
    found.sort();
    for name in found {
        if let Ok(scene) = read_scene(&root.join(&name)) {
            manifest.gauges.push(entry_for(&scene, name));
        }
    }
}

/// Reference file names every gauge *other* than `except` still points at.
///
/// Saving a gauge prunes leftovers matching its own prefix, which is only safe
/// while no one else needs them. Two gauges may trace the same image, and
/// projects written before references were namespaced per scene file can leave
/// a sibling holding a file that matches this gauge's prefix exactly — pruning
/// it would delete artwork that is still in use.
pub fn refs_in_use(root: &Path, manifest: &Manifest, except: &str) -> HashSet<String> {
    let mut in_use = HashSet::new();
    for gauge in &manifest.gauges {
        if gauge.id == except {
            continue;
        }
        let Ok(scene) = read_scene(&root.join(&gauge.file)) else {
            // A gauge we cannot read is a gauge whose references we cannot
            // account for, so leave its files alone rather than guess.
            continue;
        };
        for image in &scene.ref_images {
            if let Some(name) = image.file.rsplit(['/', '\\']).next() {
                in_use.insert(name.to_string());
            }
        }
    }
    in_use
}

/// Drop manifest entries whose scene file has gone missing.
pub fn prune_missing(root: &Path, manifest: &mut Manifest) {
    manifest.gauges.retain(|g| root.join(&g.file).is_file());
    if let Some(active) = manifest.active.clone() {
        if manifest.find(&active).is_none() {
            manifest.active = None;
        }
    }
}

// ─── Last-opened project ───────────────────────────────────────────

/// Where the path of the last project is parked between runs.
fn recent_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("recent_project.txt"))
}

/// Remember (or, with `None`, forget) the project to reopen on next launch.
pub fn remember_root(app: &tauri::AppHandle, root: Option<&Path>) {
    let Some(file) = recent_file(app) else { return };
    match root {
        Some(root) => {
            let _ = fs::write(file, root.to_string_lossy().as_bytes());
        }
        None => {
            let _ = fs::remove_file(file);
        }
    }
}

/// The remembered project, while its folder is still there.
pub fn last_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let text = fs::read_to_string(recent_file(app)?).ok()?;
    let root = PathBuf::from(text.trim());
    root.is_dir().then_some(root)
}

/// Default codegen output for a gauge: `<root>/out/<scene file stem>`.
pub fn gauge_out_dir(root: &Path, entry: &GaugeEntry) -> String {
    let stem = entry
        .file
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(&entry.file);
    root.join(OUT_DIR).join(stem).to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gauge_project_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scene_named(name: &str) -> Scene {
        Scene {
            gauge_name: name.into(),
            ..Scene::default()
        }
    }

    #[test]
    fn manifest_round_trips() {
        let dir = temp_dir("manifest");
        let mut m = Manifest::new("dc-gauges");
        m.gauges.push(entry_for(&scene_named("Altimeter"), "altimeter.ron".into()));
        m.active = Some(m.gauges[0].id.clone());
        write_manifest(&dir, &m).unwrap();

        let back = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(back.name, "dc-gauges");
        assert_eq!(back.gauges.len(), 1);
        assert_eq!(back.gauges[0].file, "altimeter.ron");
        assert_eq!(back.active, m.active);
        assert!(back.active_or_first().is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_manifest_is_not_an_error() {
        let dir = temp_dir("no_manifest");
        assert!(read_manifest(&dir).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_manifest_reports_rather_than_resetting() {
        let dir = temp_dir("bad_manifest");
        fs::write(manifest_path(&dir), "not a manifest").unwrap();
        assert!(read_manifest(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn adopts_loose_scenes_in_a_stable_order() {
        let dir = temp_dir("adopt");
        write_scene(&dir.join("zulu.ron"), &scene_named("Zulu")).unwrap();
        write_scene(&dir.join("alpha.ron"), &scene_named("Alpha")).unwrap();
        fs::write(dir.join("notes.txt"), "ignored").unwrap();
        fs::write(dir.join("broken.ron"), "()").unwrap();

        let mut m = Manifest::new("p");
        adopt_loose_scenes(&dir, &mut m);
        let files: Vec<&str> = m.gauges.iter().map(|g| g.file.as_str()).collect();
        assert_eq!(files, vec!["alpha.ron", "zulu.ron"]);
        assert_eq!(m.gauges[0].name, "Alpha");

        // Re-running never double-registers.
        adopt_loose_scenes(&dir, &mut m);
        assert_eq!(m.gauges.len(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_file_avoids_disk_and_manifest_collisions() {
        let dir = temp_dir("unique");
        let mut m = Manifest::new("p");
        assert_eq!(unique_file(&dir, &m, "Altimeter"), "altimeter.ron");

        fs::write(dir.join("altimeter.ron"), "").unwrap();
        assert_eq!(unique_file(&dir, &m, "Altimeter"), "altimeter_2.ron");

        m.gauges.push(entry_for(&scene_named("x"), "altimeter_2.ron".into()));
        assert_eq!(unique_file(&dir, &m, "Altimeter"), "altimeter_3.ron");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prunes_entries_whose_file_vanished() {
        let dir = temp_dir("prune");
        write_scene(&dir.join("alpha.ron"), &scene_named("Alpha")).unwrap();
        let mut m = Manifest::new("p");
        m.gauges.push(entry_for(&scene_named("Alpha"), "alpha.ron".into()));
        m.gauges.push(entry_for(&scene_named("Gone"), "gone.ron".into()));
        m.active = Some(m.gauges[1].id.clone());

        prune_missing(&dir, &mut m);
        assert_eq!(m.gauges.len(), 1);
        assert_eq!(m.gauges[0].file, "alpha.ron");
        assert!(m.active.is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn out_dir_is_named_after_the_scene_file() {
        let root = Path::new("/projects/dc");
        let entry = entry_for(&scene_named("My Gauge"), "my_gauge.ron".into());
        let out = gauge_out_dir(root, &entry).replace('\\', "/");
        assert!(out.ends_with("out/my_gauge"), "{out}");
    }
}
