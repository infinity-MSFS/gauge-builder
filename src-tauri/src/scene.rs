use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use uuid::Uuid;

// ─── Core scene graph types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: f32,
    pub height: f32,
    pub gauge_name: String,
    pub elements: Vec<SceneElement>,
}

impl Default for Scene {
    fn default() -> Self {
        Self {
            width: 512.0,
            height: 512.0,
            gauge_name: "my_gauge".into(),
            elements: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneElement {
    pub id: String,
    pub name: String,
    pub visible: bool,
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
        style: NvgStyle,
    },
    Path {
        commands: Vec<PathCmd>,
        style: NvgStyle,
    },
    Group {
        name: String,
        children: Vec<SceneElement>,
    },
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
        let (name, kind) = match self {
            ElementKindTag::Rect => (
                "Rectangle".into(),
                ElementKind::Rect {
                    x: BoundValue::lit(50.0),
                    y: BoundValue::lit(50.0),
                    w: BoundValue::lit(100.0),
                    h: BoundValue::lit(80.0),
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
                    style,
                },
            ),
            ElementKindTag::Line => (
                "Line".into(),
                ElementKind::Line {
                    x1: BoundValue::lit(10.0),
                    y1: BoundValue::lit(10.0),
                    x2: BoundValue::lit(200.0),
                    y2: BoundValue::lit(200.0),
                    style: NvgStyle {
                        fill: None,
                        stroke: Some(BoundColor::Rgba(1.0, 1.0, 1.0, 1.0)),
                        stroke_width: 2.0,
                        ..NvgStyle::default()
                    },
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
                    style,
                },
            ),
            ElementKindTag::Group => (
                "Group".into(),
                ElementKind::Group {
                    name: "Group".into(),
                    children: Vec::new(),
                },
            ),
        };
        SceneElement {
            id,
            name,
            visible: true,
            kind,
        }
    }
}

// ─── Scene state with undo/redo ────────────────────────────────────

const MAX_UNDO: usize = 50;

pub struct SceneState {
    pub scene: Scene,
    undo_stack: Vec<Scene>,
    redo_stack: Vec<Scene>,
}

impl Default for SceneState {
    fn default() -> Self {
        Self {
            scene: Scene::default(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }
}

impl SceneState {
    pub fn push_undo(&mut self) {
        self.undo_stack.push(self.scene.clone());
        if self.undo_stack.len() > MAX_UNDO {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    pub fn undo(&mut self) -> Option<Scene> {
        if let Some(prev) = self.undo_stack.pop() {
            self.redo_stack.push(self.scene.clone());
            self.scene = prev;
            Some(self.scene.clone())
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<Scene> {
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

    pub fn delete_element(&mut self, id: &str) -> bool {
        fn delete_in(elements: &mut Vec<SceneElement>, id: &str) -> bool {
            if let Some(pos) = elements.iter().position(|e| e.id == id) {
                elements.remove(pos);
                return true;
            }
            for el in elements.iter_mut() {
                if let ElementKind::Group { children, .. } = &mut el.kind {
                    if delete_in(children, id) {
                        return true;
                    }
                }
            }
            false
        }
        delete_in(&mut self.scene.elements, id)
    }
}

pub type SceneStore = Mutex<SceneState>;
