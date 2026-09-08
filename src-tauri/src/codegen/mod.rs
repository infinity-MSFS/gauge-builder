pub mod cargo_emit;
pub mod draw;
#[cfg(test)]
mod draw_tests;
pub mod gauge_emit;
pub mod vars_emit;

use crate::scene::{scene_to_ron, Scene};
use crate::var_registry::VarEntry;
use std::fs;
use std::path::Path;

#[derive(serde::Serialize, Clone)]
pub struct CodegenPreview {
    pub gauge_rs: String,
    pub draw_rs: String,
    pub vars_rs: String,
    pub cargo_toml: String,
}

pub fn preview(scene: &Scene, vars: &[VarEntry]) -> CodegenPreview {
    CodegenPreview {
        gauge_rs: gauge_emit::emit_gauge(scene),
        draw_rs: draw::emit_draw(scene, vars),
        vars_rs: vars_emit::emit_vars(vars),
        cargo_toml: cargo_emit::emit_cargo_toml(scene),
    }
}

pub fn emit_project(scene: &Scene, vars: &[VarEntry], output_dir: &Path) -> Result<(), String> {
    let src_dir = output_dir.join("src");
    let cargo_dir = output_dir.join(".cargo");

    fs::create_dir_all(&src_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&cargo_dir).map_err(|e| e.to_string())?;

    let p = preview(scene, vars);

    fs::write(output_dir.join("Cargo.toml"), p.cargo_toml).map_err(|e| e.to_string())?;
    fs::write(cargo_dir.join("config.toml"), cargo_emit::emit_cargo_config())
        .map_err(|e| e.to_string())?;
    fs::write(src_dir.join("lib.rs"), p.gauge_rs).map_err(|e| e.to_string())?;
    fs::write(src_dir.join("draw.rs"), p.draw_rs).map_err(|e| e.to_string())?;
    fs::write(src_dir.join("vars.rs"), p.vars_rs).map_err(|e| e.to_string())?;

    // The scene RON travels with the generated crate, so an exported project
    // can be reopened later with its reference images intact.
    fs::write(output_dir.join(scene_ron_name(scene)), scene_to_ron(scene)?)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::RefImage;

    #[test]
    fn exported_project_carries_a_reloadable_scene_ron() {
        let dir = std::env::temp_dir().join("gauge_emit_project_ron");
        let _ = fs::remove_dir_all(&dir);

        let mut scene = Scene {
            gauge_name: "My Gauge".into(),
            ..Scene::default()
        };
        scene.ref_images.push(RefImage {
            id: "r1".into(),
            name: "panel.png".into(),
            file: "refs/my_gauge_panel_deadbeef.png".into(),
            source: "panel.png".into(),
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 200.0,
            opacity: 0.5,
            locked: false,
            visible: true,
        });

        emit_project(&scene, &[], &dir).unwrap();

        let ron_path = dir.join("my_gauge.ron");
        assert!(dir.join("Cargo.toml").exists());
        assert!(dir.join("src").join("lib.rs").exists());

        let reloaded: Scene = ron::from_str(&fs::read_to_string(&ron_path).unwrap()).unwrap();
        assert_eq!(reloaded.gauge_name, "My Gauge");
        assert_eq!(reloaded.ref_images.len(), 1);
        assert_eq!(reloaded.ref_images[0].file, "refs/my_gauge_panel_deadbeef.png");
        assert_eq!(reloaded.ref_images[0].w, 100.0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scenes_saved_before_reference_images_still_load() {
        let legacy = r#"(width: 512.0, height: 512.0, gauge_name: "old", elements: [])"#;
        let scene: Scene = ron::from_str(legacy).unwrap();
        assert!(scene.ref_images.is_empty());
    }
}

/// File name of the scene RON written into an exported project.
pub fn scene_ron_name(scene: &Scene) -> String {
    format!("{}.ron", crate::refs::slug(&scene.gauge_name))
}

