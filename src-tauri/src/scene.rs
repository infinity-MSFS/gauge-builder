use crate::var_registry::VarEntry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;
use uuid::Uuid;

// ─── Core scene graph types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: f32,
    pub height: f32,
    pub gauge_name: String,
    pub elements: Vec<SceneElement>,
    /// Editor-only tracing images. Filled in when the project is saved or
    /// exported; the emitted gauge code never references them.
    #[serde(default)]
    pub ref_images: Vec<RefImage>,
    /// The gauge's sim variables. Held live in the `VarRegistry`; copied in on
    /// the way to disk and moved back out on load, so a scene file carries
    /// everything a gauge needs and each tab keeps its own variables.
    #[serde(default)]
    pub vars: Vec<VarEntry>,
}

impl Default for Scene {
    fn default() -> Self {
        Self {
            width: 512.0,
            height: 512.0,
            gauge_name: "my_gauge".into(),
            elements: Vec::new(),
            ref_images: Vec::new(),
            vars: Vec::new(),
        }
    }
}

/// A reference image as recorded in the scene RON. `file` points at the bytes
/// written under the project's `refs/` folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefImage {
    pub id: String,
    pub name: String,
    /// Path relative to the directory holding the scene RON, e.g. `refs/x.png`.
    pub file: String,
    /// The image's original file name, e.g. `Pasted.png`. Kept so reopening and
    /// resaving re-derives the same `refs/` name; without it the editor falls
    /// back to the seeded name and stacks a fresh prefix on with every save.
    #[serde(default)]
    pub source: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub opacity: f32,
    pub locked: bool,
    pub visible: bool,
}

/// Serialize a scene to the pretty RON form used for on-disk projects.
pub fn scene_to_ron(scene: &Scene) -> Result<String, String> {
    ron::ser::to_string_pretty(scene, ron::ser::PrettyConfig::default())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneElement {
    pub id: String,
    pub name: String,
    pub visible: bool,
    /// Locked elements are skipped by canvas hit-testing and cannot be transformed.
    #[serde(default)]
    pub locked: bool,
    pub kind: ElementKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ElementKind {
    Rect {
        x: BoundValue,
        y: BoundValue,
        w: BoundValue,
        h: BoundValue,
        #[serde(default = "default_zero_bv")]
        radius: BoundValue,
        style: NvgStyle,
    },
    Circle {
        cx: BoundValue,
        cy: BoundValue,
        r: BoundValue,
        style: NvgStyle,
    },
    Arc {
        cx: BoundValue,
        cy: BoundValue,
        r: BoundValue,
        a0: BoundValue,
        a1: BoundValue,
        dir: ArcDir,
        style: NvgStyle,
    },
    Line {
        x1: BoundValue,
        y1: BoundValue,
        x2: BoundValue,
        y2: BoundValue,
        style: NvgStyle,
    },
    Text {
        x: BoundValue,
        y: BoundValue,
        content: BoundValue,
        font_size: BoundValue,
        font: String,
        /// Static label. When set, it is drawn verbatim and `content` is ignored.
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        align_h: TextAlignH,
        #[serde(default)]
        align_v: TextAlignV,
        /// Decimal places used when formatting a bound numeric `content`.
        #[serde(default)]
        decimals: u32,
        style: NvgStyle,
    },
    Path {
        commands: Vec<PathCmd>,
        style: NvgStyle,
    },
    Group {
        name: String,
        children: Vec<SceneElement>,
        #[serde(default = "default_zero_bv")] translate_x: BoundValue,
        #[serde(default = "default_zero_bv")] translate_y: BoundValue,
        #[serde(default = "default_zero_bv")] rotate: BoundValue,
        #[serde(default = "default_one_bv")]  scale_x: BoundValue,
        #[serde(default = "default_one_bv")]  scale_y: BoundValue,
        #[serde(default = "default_one_bv")]  opacity: BoundValue,
        #[serde(default = "default_zero_bv")] pivot_x: BoundValue,
        #[serde(default = "default_zero_bv")] pivot_y: BoundValue,
        #[serde(default)] clip_modifier: Option<ClipModifier>,
        #[serde(default)] array_modifier: Option<ArrayModifier>,
    },
}

fn default_zero_bv() -> BoundValue { BoundValue::lit(0.0) }
fn default_one_bv()  -> BoundValue { BoundValue::lit(1.0) }

// ─── Text alignment (maps to nvg Align flags) ──────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub enum TextAlignH {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub enum TextAlignV {
    Top,
    Middle,
    Bottom,
    #[default]
    Baseline,
}

// ─── Group modifiers ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipModifier {
    pub x: BoundValue,
    pub y: BoundValue,
    pub w: BoundValue,
    pub h: BoundValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ArrayModifier {
    Linear {
        count: u32,
        offset_x: BoundValue,
        offset_y: BoundValue,
    },
    Radial {
        count: u32,
        cx: BoundValue,
        cy: BoundValue,
        start_angle: BoundValue,
        arc_angle: BoundValue,
    },
}

// ─── Helper: build an empty Group SceneElement ─────────────────────

pub fn make_group(children: Vec<SceneElement>) -> SceneElement {
    SceneElement {
        id: Uuid::new_v4().to_string(),
        name: "Group".into(),
        visible: true,
        locked: false,
        kind: ElementKind::Group {
            name: "Group".into(),
            children,
            translate_x: BoundValue::lit(0.0),
            translate_y: BoundValue::lit(0.0),
            rotate:      BoundValue::lit(0.0),
            scale_x:     BoundValue::lit(1.0),
            scale_y:     BoundValue::lit(1.0),
            opacity:     BoundValue::lit(1.0),
            pivot_x:     BoundValue::lit(0.0),
            pivot_y:     BoundValue::lit(0.0),
            clip_modifier:  None,
            array_modifier: None,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BoundValue {
    Literal { value: f64 },
    LVar { name: String },
    AVar { name: String, unit: String, index: u32 },
    Expr { expr: String },
}

impl BoundValue {
    pub fn lit(v: f64) -> Self {
        BoundValue::Literal { value: v }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NvgStyle {
    pub fill: Option<BoundColor>,
    pub stroke: Option<BoundColor>,
    pub stroke_width: f32,
    pub line_cap: LineCap,
    pub line_join: LineJoin,
}

impl Default for NvgStyle {
    fn default() -> Self {
        Self {
            fill: Some(BoundColor::Rgba(0.8, 0.8, 0.8, 1.0)),
            stroke: None,
            stroke_width: 1.0,
            line_cap: LineCap::Butt,
            line_join: LineJoin::Miter,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BoundColor {
    Rgba(f32, f32, f32, f32),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ArcDir {
    Cw,
    Ccw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LineCap {
    Butt,
    Round,
    Square,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LineJoin {
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PathCmd {
    MoveTo { x: BoundValue, y: BoundValue },
    LineTo { x: BoundValue, y: BoundValue },
    BezierTo {
        c1x: BoundValue,
        c1y: BoundValue,
        c2x: BoundValue,
        c2y: BoundValue,
        x: BoundValue,
        y: BoundValue,
    },
    ClosePath,
}

// ─── Element tag for add_element command ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ElementKindTag {
    Rect,
    Circle,
    Arc,
    Line,
    Text,
    Path,
    Group,
}

impl ElementKindTag {
    pub fn default_element(&self) -> SceneElement {
        let id = Uuid::new_v4().to_string();
        let style = NvgStyle::default();
        let outline = || NvgStyle {
            fill: None,
            stroke: Some(BoundColor::Rgba(1.0, 1.0, 1.0, 1.0)),
            stroke_width: 2.0,
            ..NvgStyle::default()
        };
        let (name, kind) = match self {
            ElementKindTag::Rect => (
                "Rectangle".into(),
                ElementKind::Rect {
                    x: BoundValue::lit(50.0),
                    y: BoundValue::lit(50.0),
                    w: BoundValue::lit(100.0),
                    h: BoundValue::lit(80.0),
                    radius: BoundValue::lit(0.0),
                    style,
                },
            ),
            ElementKindTag::Circle => (
                "Circle".into(),
                ElementKind::Circle {
                    cx: BoundValue::lit(100.0),
                    cy: BoundValue::lit(100.0),
                    r: BoundValue::lit(50.0),
                    style,
                },
            ),
            ElementKindTag::Arc => (
                "Arc".into(),
                ElementKind::Arc {
                    cx: BoundValue::lit(100.0),
                    cy: BoundValue::lit(100.0),
                    r: BoundValue::lit(50.0),
                    a0: BoundValue::lit(0.0),
                    a1: BoundValue::lit(std::f64::consts::PI),
                    dir: ArcDir::Cw,
                    style: NvgStyle {
                        stroke_width: 3.0,
                        ..outline()
                    },
                },
            ),
            ElementKindTag::Line => (
                "Line".into(),
                ElementKind::Line {
                    x1: BoundValue::lit(10.0),
                    y1: BoundValue::lit(10.0),
                    x2: BoundValue::lit(200.0),
                    y2: BoundValue::lit(200.0),
                    style: outline(),
                },
            ),
            ElementKindTag::Text => (
                "Text".into(),
                ElementKind::Text {
                    x: BoundValue::lit(50.0),
                    y: BoundValue::lit(50.0),
                    content: BoundValue::Literal { value: 0.0 },
                    font_size: BoundValue::lit(24.0),
                    font: "sans".into(),
                    text: Some("Label".into()),
                    align_h: TextAlignH::Left,
                    align_v: TextAlignV::Baseline,
                    decimals: 0,
                    style,
                },
            ),
            ElementKindTag::Path => (
                "Path".into(),
                ElementKind::Path {
                    commands: vec![
                        PathCmd::MoveTo {
                            x: BoundValue::lit(0.0),
                            y: BoundValue::lit(0.0),
                        },
                        PathCmd::LineTo {
                            x: BoundValue::lit(100.0),
                            y: BoundValue::lit(100.0),
                        },
                    ],
                    style: outline(),
                },
            ),
            ElementKindTag::Group => (
                "Group".into(),
                ElementKind::Group {
                    name: "Group".into(),
                    children: Vec::new(),
                    translate_x: BoundValue::lit(0.0),
                    translate_y: BoundValue::lit(0.0),
                    rotate:      BoundValue::lit(0.0),
                    scale_x:     BoundValue::lit(1.0),
                    scale_y:     BoundValue::lit(1.0),
                    opacity:     BoundValue::lit(1.0),
                    pivot_x:     BoundValue::lit(0.0),
                    pivot_y:     BoundValue::lit(0.0),
                    clip_modifier:  None,
                    array_modifier: None,
                },
            ),
        };
        SceneElement {
            id,
            name,
            visible: true,
            locked: false,
            kind,
        }
    }
}

// ─── Free functions over element trees ─────────────────────────────

/// Recursively give `el` and every descendant a fresh UUID.
pub fn regenerate_ids(el: &mut SceneElement) {
    el.id = Uuid::new_v4().to_string();
    if let ElementKind::Group { children, .. } = &mut el.kind {
        for c in children.iter_mut() {
            regenerate_ids(c);
        }
    }
}

fn contains_id(elements: &[SceneElement], id: &str) -> bool {
    elements.iter().any(|e| {
        e.id == id
            || match &e.kind {
                ElementKind::Group { children, .. } => contains_id(children, id),
                _ => false,
            }
    })
}

/// Remove `id` from wherever it lives in the tree, returning it and its index.
fn take_in(elements: &mut Vec<SceneElement>, id: &str) -> Option<(SceneElement, usize)> {
    if let Some(pos) = elements.iter().position(|e| e.id == id) {
        return Some((elements.remove(pos), pos));
    }
    for el in elements.iter_mut() {
        if let ElementKind::Group { children, .. } = &mut el.kind {
            if contains_id(children, id) {
                return take_in(children, id);
            }
        }
    }
    None
}

// ─── Scene state with undo/redo ────────────────────────────────────

const MAX_UNDO: usize = 100;
/// Consecutive edits sharing a tag inside this window collapse into a single
/// undo step, so scrubbing a number field does not flood the history.
const COALESCE_MS: u128 = 700;

pub struct SceneState {
    pub scene: Scene,
    undo_stack: Vec<Scene>,
    redo_stack: Vec<Scene>,
    last_tag: Option<(String, Instant)>,
}

impl Default for SceneState {
    fn default() -> Self {
        Self {
            scene: Scene::default(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            last_tag: None,
        }
    }
}

impl SceneState {
    /// Replace the document wholesale — opening a gauge or a scene file. The
    /// history is dropped with it, since undoing back into a scene the editor
    /// no longer has open is never what the user meant.
    pub fn reset(&mut self, scene: Scene) {
        self.scene = scene;
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.last_tag = None;
    }

    pub fn push_undo(&mut self) {
        self.push_undo_tagged(None);
    }

    /// Snapshot the scene onto the undo stack. When `tag` repeats inside the
    /// coalesce window the snapshot is skipped, leaving the earlier one as the
    /// single restore point for the whole gesture.
    pub fn push_undo_tagged(&mut self, tag: Option<String>) {
        if let Some(t) = &tag {
            if let Some((last, at)) = &self.last_tag {
                if last == t && at.elapsed().as_millis() < COALESCE_MS {
                    self.last_tag = Some((t.clone(), Instant::now()));
                    self.redo_stack.clear();
                    return;
                }
            }
        }
        self.last_tag = tag.map(|t| (t, Instant::now()));
        self.undo_stack.push(self.scene.clone());
        if self.undo_stack.len() > MAX_UNDO {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    pub fn undo(&mut self) -> Option<Scene> {
        self.last_tag = None;
        if let Some(prev) = self.undo_stack.pop() {
            self.redo_stack.push(self.scene.clone());
            self.scene = prev;
            Some(self.scene.clone())
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<Scene> {
        self.last_tag = None;
        if let Some(next) = self.redo_stack.pop() {
            self.undo_stack.push(self.scene.clone());
            self.scene = next;
            Some(self.scene.clone())
        } else {
            None
        }
    }

    pub fn find_element_mut(&mut self, id: &str) -> Option<&mut SceneElement> {
        fn find_in<'a>(elements: &'a mut [SceneElement], id: &str) -> Option<&'a mut SceneElement> {
            for el in elements.iter_mut() {
                if el.id == id {
                    return Some(el);
                }
                if let ElementKind::Group { children, .. } = &mut el.kind {
                    if let Some(found) = find_in(children, id) {
                        return Some(found);
                    }
                }
            }
            None
        }
        find_in(&mut self.scene.elements, id)
    }

    /// Detach `id` from wherever it lives, returning it plus its former index.
    pub fn take_element(&mut self, id: &str) -> Option<(SceneElement, usize)> {
        take_in(&mut self.scene.elements, id)
    }

    /// The parent id (None = scene root) and ordered sibling ids around `id`.
    pub fn siblings_of(&self, id: &str) -> Option<(Option<String>, Vec<String>)> {
        fn walk(
            elements: &[SceneElement],
            id: &str,
            parent: Option<&str>,
        ) -> Option<(Option<String>, Vec<String>)> {
            if elements.iter().any(|e| e.id == id) {
                return Some((
                    parent.map(|s| s.to_string()),
                    elements.iter().map(|e| e.id.clone()).collect(),
                ));
            }
            for el in elements {
                if let ElementKind::Group { children, .. } = &el.kind {
                    if let Some(found) = walk(children, id, Some(&el.id)) {
                        return Some(found);
                    }
                }
            }
            None
        }
        walk(&self.scene.elements, id, None)
    }

    /// Mutable access to a container's child list. `None` parent = scene root.
    pub fn children_mut(&mut self, parent: Option<&str>) -> Option<&mut Vec<SceneElement>> {
        match parent {
            None => Some(&mut self.scene.elements),
            Some(pid) => match self.find_element_mut(pid) {
                Some(SceneElement {
                    kind: ElementKind::Group { children, .. },
                    ..
                }) => Some(children),
                _ => None,
            },
        }
    }

    /// True when `ancestor` is `id` itself or contains it — guards against
    /// reparenting a group into its own subtree.
    pub fn is_ancestor_of(&self, ancestor: &str, id: &str) -> bool {
        fn find<'a>(elements: &'a [SceneElement], id: &str) -> Option<&'a SceneElement> {
            for el in elements {
                if el.id == id {
                    return Some(el);
                }
                if let ElementKind::Group { children, .. } = &el.kind {
                    if let Some(f) = find(children, id) {
                        return Some(f);
                    }
                }
            }
            None
        }
        if ancestor == id {
            return true;
        }
        match find(&self.scene.elements, ancestor) {
            Some(SceneElement {
                kind: ElementKind::Group { children, .. },
                ..
            }) => contains_id(children, id),
            _ => false,
        }
    }

    pub fn delete_element(&mut self, id: &str) -> bool {
        self.take_element(id).is_some()
    }
}

pub type SceneStore = Mutex<SceneState>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::var_registry::{RustVarType, VarKind};

    fn round_trip(scene: &Scene) -> Scene {
        ron::from_str(&scene_to_ron(scene).unwrap()).unwrap()
    }

    /// `ElementKind` and `BoundValue` carry an internal `type` tag for the
    /// frontend's benefit, and a style holds `Rgba(..)` tuples. Reading that
    /// combination back needs a RON new enough to hand serde a map rather than
    /// a sequence for a named tuple — older ones fail on every saved scene
    /// that actually has artwork in it.
    #[test]
    fn a_scene_with_artwork_reloads() {
        let mut scene = Scene::default();
        for tag in [
            ElementKindTag::Rect,
            ElementKindTag::Circle,
            ElementKindTag::Arc,
            ElementKindTag::Line,
            ElementKindTag::Text,
            ElementKindTag::Path,
        ] {
            scene.elements.push(tag.default_element());
        }
        scene.elements.push(make_group(vec![ElementKindTag::Rect.default_element()]));

        let back = round_trip(&scene);
        assert_eq!(back.elements.len(), scene.elements.len());
        for (a, b) in scene.elements.iter().zip(&back.elements) {
            assert_eq!(a.id, b.id);
            assert_eq!(
                std::mem::discriminant(&a.kind),
                std::mem::discriminant(&b.kind)
            );
        }
        match &back.elements[0].kind {
            ElementKind::Rect { style, .. } => assert!(style.fill.is_some()),
            other => panic!("expected a Rect, got {other:?}"),
        }
    }

    #[test]
    fn variables_travel_with_the_scene() {
        let mut scene = Scene::default();
        scene.vars.push(VarEntry {
            id: "v1".into(),
            kind: VarKind::AVar,
            sim_name: "INDICATED ALTITUDE".into(),
            unit: Some("feet".into()),
            index: Some(0),
            rust_type: RustVarType::F64,
            preview_value: 1200.0,
        });

        let back = round_trip(&scene);
        assert_eq!(back.vars.len(), 1);
        assert_eq!(back.vars[0].sim_name, "INDICATED ALTITUDE");
        assert_eq!(back.vars[0].unit.as_deref(), Some("feet"));
    }

    #[test]
    fn scenes_saved_before_variables_still_load() {
        let legacy = r#"(width: 512.0, height: 512.0, gauge_name: "old", elements: [])"#;
        let scene: Scene = ron::from_str(legacy).unwrap();
        assert!(scene.vars.is_empty());
    }
}
