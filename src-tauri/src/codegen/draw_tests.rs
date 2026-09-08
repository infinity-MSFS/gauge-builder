//! Checks on the emitted `draw.rs`. These guard the shapes the editor can now
//! produce — rounded rects, aligned/static text, pivoted groups and paths —
//! against the `infinity_rs::nvg` API they have to compile against.

use crate::codegen::draw::emit_draw;
use crate::scene::*;

fn scene_with(kind: ElementKind) -> Scene {
    Scene {
        width: 512.0,
        height: 512.0,
        gauge_name: "t".into(),
        elements: vec![SceneElement {
            id: "e1".into(),
            name: "e1".into(),
            visible: true,
            locked: false,
            kind,
        }],
        ref_images: Vec::new(),
        vars: Vec::new(),
    }
}

fn style() -> NvgStyle {
    NvgStyle {
        fill: Some(BoundColor::Rgba(1.0, 0.0, 0.0, 1.0)),
        stroke: None,
        stroke_width: 1.0,
        line_cap: LineCap::Butt,
        line_join: LineJoin::Miter,
    }
}

fn emit(kind: ElementKind) -> String {
    emit_draw(&scene_with(kind), &[])
}

#[test]
fn square_corners_use_rect() {
    let out = emit(ElementKind::Rect {
        x: BoundValue::lit(1.0),
        y: BoundValue::lit(2.0),
        w: BoundValue::lit(3.0),
        h: BoundValue::lit(4.0),
        radius: BoundValue::lit(0.0),
        style: style(),
    });
    assert!(out.contains("ctx.rect("), "{out}");
    assert!(!out.contains("rounded_rect"), "{out}");
}

#[test]
fn a_corner_radius_switches_to_rounded_rect() {
    let out = emit(ElementKind::Rect {
        x: BoundValue::lit(1.0),
        y: BoundValue::lit(2.0),
        w: BoundValue::lit(3.0),
        h: BoundValue::lit(4.0),
        radius: BoundValue::lit(6.0),
        style: style(),
    });
    assert!(out.contains("ctx.rounded_rect(1.0_f32, 2.0_f32, 3.0_f32, 4.0_f32, 6.0_f32)"), "{out}");
}

fn text(text: Option<&str>, h: TextAlignH, v: TextAlignV, decimals: u32) -> ElementKind {
    ElementKind::Text {
        x: BoundValue::lit(10.0),
        y: BoundValue::lit(20.0),
        content: BoundValue::LVar {
            name: "airspeed".into(),
        },
        font_size: BoundValue::lit(24.0),
        font: "roboto".into(),
        text: text.map(|s| s.to_string()),
        align_h: h,
        align_v: v,
        decimals,
        style: style(),
    }
}

#[test]
fn static_text_is_emitted_verbatim() {
    let out = emit(text(Some("KTS"), TextAlignH::Center, TextAlignV::Middle, 0));
    assert!(out.contains("ctx.text_align(Align::CENTER | Align::MIDDLE)"), "{out}");
    assert!(out.contains(r#"ctx.text(10.0_f32, 20.0_f32, "KTS")"#), "{out}");
    assert!(out.contains(r#"ctx.font_face("roboto")"#), "{out}");
}

#[test]
fn a_bound_value_is_formatted_to_the_chosen_precision() {
    let out = emit(text(None, TextAlignH::Right, TextAlignV::Baseline, 2));
    assert!(out.contains("ctx.text_align(Align::RIGHT | Align::BASELINE)"), "{out}");
    assert!(out.contains(r#"&format!("{:.2}", airspeed as f32)"#), "{out}");
}

#[test]
fn quotes_in_a_label_are_escaped() {
    let out = emit(text(Some(r#"5" HG"#), TextAlignH::Left, TextAlignV::Top, 0));
    assert!(out.contains(r#""5\" HG""#), "{out}");
}

#[test]
fn paths_emit_every_command_kind() {
    let out = emit(ElementKind::Path {
        commands: vec![
            PathCmd::MoveTo {
                x: BoundValue::lit(0.0),
                y: BoundValue::lit(0.0),
            },
            PathCmd::LineTo {
                x: BoundValue::lit(10.0),
                y: BoundValue::lit(0.0),
            },
            PathCmd::BezierTo {
                c1x: BoundValue::lit(1.0),
                c1y: BoundValue::lit(2.0),
                c2x: BoundValue::lit(3.0),
                c2y: BoundValue::lit(4.0),
                x: BoundValue::lit(5.0),
                y: BoundValue::lit(6.0),
            },
            PathCmd::ClosePath,
        ],
        style: style(),
    });
    assert!(out.contains("ctx.move_to(0.0_f32, 0.0_f32)"), "{out}");
    assert!(out.contains("ctx.line_to(10.0_f32, 0.0_f32)"), "{out}");
    assert!(
        out.contains("ctx.bezier_to(1.0_f32, 2.0_f32, 3.0_f32, 4.0_f32, 5.0_f32, 6.0_f32)"),
        "{out}"
    );
    assert!(out.contains("ctx.close_path()"), "{out}");
}

#[test]
fn a_bound_path_anchor_reads_the_variable() {
    let out = emit(ElementKind::Path {
        commands: vec![PathCmd::MoveTo {
            x: BoundValue::LVar {
                name: "tape_y".into(),
            },
            y: BoundValue::lit(0.0),
        }],
        style: style(),
    });
    assert!(out.contains("ctx.move_to(tape_y as f32, 0.0_f32)"), "{out}");
}

fn group(children: Vec<SceneElement>, pivot: (f64, f64), rotate: BoundValue) -> ElementKind {
    ElementKind::Group {
        name: "g".into(),
        children,
        translate_x: BoundValue::lit(100.0),
        translate_y: BoundValue::lit(200.0),
        rotate,
        scale_x: BoundValue::lit(1.0),
        scale_y: BoundValue::lit(1.0),
        opacity: BoundValue::lit(1.0),
        pivot_x: BoundValue::lit(pivot.0),
        pivot_y: BoundValue::lit(pivot.1),
        clip_modifier: None,
        array_modifier: None,
    }
}

#[test]
fn a_pivot_brackets_the_rotation() {
    let out = emit(group(
        vec![],
        (30.0, 40.0),
        BoundValue::LVar {
            name: "needle".into(),
        },
    ));
    // Move to the pivot, rotate, then move back — so a needle spins on its hub.
    let body = out
        .split("ctx.translate(100.0_f32, 200.0_f32);")
        .nth(1)
        .expect("group transform missing");
    let pivot_in = body.find("ctx.translate(30.0_f32, 40.0_f32);").expect("pivot in");
    let rot = body.find("ctx.rotate((needle as f32)").expect("rotate");
    let pivot_out = body
        .find("ctx.translate(-(30.0_f32), -(40.0_f32));")
        .expect("pivot out");
    assert!(pivot_in < rot && rot < pivot_out, "{body}");
}

#[test]
fn a_zero_pivot_emits_no_extra_translates() {
    let out = emit(group(vec![], (0.0, 0.0), BoundValue::lit(15.0)));
    assert!(!out.contains("ctx.translate(-("), "{out}");
}

#[test]
fn hidden_elements_are_skipped() {
    let mut scene = scene_with(ElementKind::Rect {
        x: BoundValue::lit(1.0),
        y: BoundValue::lit(2.0),
        w: BoundValue::lit(3.0),
        h: BoundValue::lit(4.0),
        radius: BoundValue::lit(0.0),
        style: style(),
    });
    scene.elements[0].visible = false;
    let out = emit_draw(&scene, &[]);
    assert!(!out.contains("ctx.rect("), "{out}");
}

#[test]
fn a_locked_element_still_renders() {
    let mut scene = scene_with(ElementKind::Rect {
        x: BoundValue::lit(1.0),
        y: BoundValue::lit(2.0),
        w: BoundValue::lit(3.0),
        h: BoundValue::lit(4.0),
        radius: BoundValue::lit(0.0),
        style: style(),
    });
    scene.elements[0].locked = true;
    let out = emit_draw(&scene, &[]);
    assert!(out.contains("ctx.rect("), "{out}");
}

#[test]
fn save_and_restore_stay_balanced() {
    let out = emit(group(
        vec![SceneElement {
            id: "c".into(),
            name: "c".into(),
            visible: true,
            locked: false,
            kind: text(Some("A"), TextAlignH::Left, TextAlignV::Top, 0),
        }],
        (0.0, 0.0),
        BoundValue::lit(0.0),
    ));
    assert_eq!(
        out.matches("ctx.save();").count(),
        out.matches("ctx.restore();").count(),
        "{out}"
    );
}
