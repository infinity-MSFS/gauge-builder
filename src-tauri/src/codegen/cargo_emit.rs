use crate::scene::Scene;

pub fn emit_cargo_toml(scene: &Scene) -> String {
    let snake_name = scene.gauge_name.replace('-', "_").to_lowercase();

    format!(
        r#"[package]
name = "{snake_name}"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
infinity_rs = {{ git = "https://github.com/infinity-MSFS/infinity-rs" }}
msfs_derive = {{ git = "https://github.com/infinity-MSFS/infinity-rs" }}

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
"#
    )
}

pub fn emit_cargo_config() -> String {
    r#"[target.wasm32-wasip1]
rustflags = [
    "-Clink-arg=--export-table",
    "-Clink-arg=--export=malloc",
    "-Clink-arg=--export=free",
]
"#
    .into()
}
