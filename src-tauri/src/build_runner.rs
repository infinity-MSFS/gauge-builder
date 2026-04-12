use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BuildMode {
    CodegenOnly,
    CheckOnly,
    FullBuild { msfs_sdk_path: String },
}

#[derive(Clone, Serialize)]
struct BuildLog {
    line: String,
    kind: String,
}

#[derive(Clone, Serialize)]
struct BuildDone {
    success: bool,
    elapsed_ms: u64,
}

pub async fn run_build(
    output_dir: &Path,
    mode: BuildMode,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    match mode {
        BuildMode::CodegenOnly => {
            app_handle
                .emit(
                    "build_done",
                    BuildDone {
                        success: true,
                        elapsed_ms: 0,
                    },
                )
                .ok();
        }
        BuildMode::CheckOnly => {
            shell_cargo(output_dir, &["check", "--lib"], None, &app_handle).await?;
        }
        BuildMode::FullBuild { msfs_sdk_path } => {
            shell_cargo(
                output_dir,
                &["build", "--target", "wasm32-wasip1", "--release"],
                Some(("MSFS2024_SDK", &msfs_sdk_path)),
                &app_handle,
            )
            .await?;
        }
    }
    Ok(())
}

async fn shell_cargo(
    cwd: &Path,
    args: &[&str],
    env: Option<(&str, &str)>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let start = Instant::now();

    let mut cmd = Command::new("cargo");
    cmd.args(args).current_dir(cwd);
    if let Some((key, val)) = env {
        cmd.env(key, val);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn cargo: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let handle_out = app_handle.clone();
    let handle_err = app_handle.clone();

    let t1 = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            handle_out
                .emit(
                    "build_log",
                    BuildLog {
                        line,
                        kind: "stdout".into(),
                    },
                )
                .ok();
        }
    });

    let t2 = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            handle_err
                .emit(
                    "build_log",
                    BuildLog {
                        line,
                        kind: "stderr".into(),
                    },
                )
                .ok();
        }
    });

    let _ = t1.await;
    let _ = t2.await;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for cargo: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;
    app_handle
        .emit(
            "build_done",
            BuildDone {
                success: status.success(),
                elapsed_ms: elapsed,
            },
        )
        .ok();

    if status.success() {
        Ok(())
    } else {
        Err("Build failed".into())
    }
}
