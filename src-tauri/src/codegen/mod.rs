pub mod cargo_emit;
pub mod draw;
pub mod gauge_emit;
pub mod vars_emit;

use crate::scene::Scene;
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

    Ok(())
}
