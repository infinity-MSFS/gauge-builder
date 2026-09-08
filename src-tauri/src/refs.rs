//! Reference-image extraction.
//!
//! Reference images live in the editor only — they are tracing aids, never part
//! of the emitted gauge. Saving or exporting a project drops them next to the
//! scene RON in a `refs/` folder under a seeded file name, so several gauge
//! projects can share one repository without their references colliding.

use crate::scene::RefImage;
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub const REFS_DIR: &str = "refs";

/// A reference image handed over by the editor: metadata plus the original
/// bytes, base64-encoded (the editor holds them as data URLs).
#[derive(Debug, Clone, Deserialize)]
pub struct RefImageInput {
    pub id: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub opacity: f32,
    pub locked: bool,
    pub visible: bool,
    /// Original file name — only its extension is used, to pick the suffix.
    pub source_name: String,
    /// Base64 payload with any `data:` prefix already stripped.
    pub data: String,
}

/// The `refs/` file-name prefix for a gauge, taken from its scene file rather
/// than its display name: two gauges in a project may share a name, but never a
/// file, so this is what keeps one gauge's save from pruning another's images.
pub fn prefix_for(scene_file: &str) -> String {
    let stem = scene_file
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(scene_file)
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(scene_file);
    slug(stem)
}

/// Write every reference image into `<project_dir>/refs/`, returning the scene
/// metadata (with repo-relative paths) to record in the RON. `prefix` scopes
/// the file names to one gauge — see [`prefix_for`] — and `in_use` names the
/// files other gauges in the project still point at, which this gauge must
/// never prune however well they match its own prefix.
pub fn extract_ref_images(
    project_dir: &Path,
    prefix: &str,
    inputs: &[RefImageInput],
    in_use: &HashSet<String>,
) -> Result<Vec<RefImage>, String> {
    let refs_dir = project_dir.join(REFS_DIR);
    let prefix = slug(prefix);

    if inputs.is_empty() {
        // Nothing to write, but a previously exported reference may be stale.
        if refs_dir.is_dir() {
            prune(&refs_dir, &prefix, in_use);
        }
        return Ok(Vec::new());
    }

    fs::create_dir_all(&refs_dir).map_err(|e| format!("Creating {refs_dir:?}: {e}"))?;

    let mut written = in_use.clone();
    let mut metas = Vec::with_capacity(inputs.len());
    for input in inputs {
        let bytes = decode_base64(&input.data)
            .map_err(|e| format!("Reference image '{}': {e}", input.name))?;
        // An image already sitting in `refs/` is the file to keep pointing at,
        // whatever earlier naming scheme minted it — otherwise opening an old
        // project and saving it renames every reference and strands the
        // originals beside them.
        let file_name = existing_match(&refs_dir, &bytes)
            .unwrap_or_else(|| seeded_file_name(&prefix, &input.source_name, &bytes));
        let path = refs_dir.join(&file_name);
        // Seeded names are content-addressed, so an unchanged image is already
        // byte-identical on disk — skip the write to keep git diffs quiet.
        if !path.exists() {
            fs::write(&path, &bytes).map_err(|e| format!("Writing {path:?}: {e}"))?;
        }
        written.insert(file_name.clone());
        metas.push(RefImage {
            id: input.id.clone(),
            name: input.name.clone(),
            file: format!("{REFS_DIR}/{file_name}"),
            source: input.source_name.clone(),
            x: input.x,
            y: input.y,
            w: input.w,
            h: input.h,
            opacity: input.opacity,
            locked: input.locked,
            visible: input.visible,
        });
    }

    prune(&refs_dir, &prefix, &written);
    Ok(metas)
}

/// Drop references this gauge wrote on an earlier export but no longer uses.
/// Only files carrying this gauge's prefix are considered, and `keep` shields
/// the ones other gauges still reference, so a shared `refs/` folder never
/// loses an image something else is using.
fn prune(refs_dir: &Path, prefix: &str, keep: &HashSet<String>) {
    let entries = match fs::read_dir(refs_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if keep.contains(&name) {
            continue;
        }
        if name.starts_with(&format!("{prefix}_")) && entry.path().is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The name of a `refs/` file already holding exactly these bytes.
fn existing_match(refs_dir: &Path, bytes: &[u8]) -> Option<String> {
    for entry in fs::read_dir(refs_dir).ok()?.flatten() {
        let path = entry.path();
        // Compare the cheap thing first; most candidates differ in length.
        let same_size = fs::metadata(&path).is_ok_and(|m| m.len() == bytes.len() as u64);
        if !same_size || !path.is_file() {
            continue;
        }
        if fs::read(&path).is_ok_and(|found| found == bytes) {
            return Some(entry.file_name().to_string_lossy().to_string());
        }
    }
    None
}

/// `<gauge>_<source>_<content hash>.<ext>` — stable across exports for the same
/// image, and distinct per gauge so projects can share a references folder.
fn seeded_file_name(prefix: &str, source_name: &str, bytes: &[u8]) -> String {
    let stem = source_name.rsplit_once('.').map(|(s, _)| s).unwrap_or(source_name);
    let stem = slug(stem);
    let ext = extension(source_name);
    let seed = fnv1a64(prefix.as_bytes()) ^ fnv1a64(bytes);
    format!("{prefix}_{stem}_{:08x}.{ext}", (seed >> 32) as u32)
}

fn extension(source_name: &str) -> String {
    let ext = source_name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "svg" => ext,
        _ => "png".into(),
    }
}

/// Lowercase, filesystem-safe, and short enough to keep paths sane.
pub fn slug(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_');
    let capped: String = trimmed.chars().take(32).collect();
    if capped.is_empty() {
        "ref".into()
    } else {
        capped
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Minimal base64 decoder — padding and embedded whitespace are ignored.
fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    let mut table = [0xffu8; 256];
    for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        .iter()
        .enumerate()
    {
        table[*c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for b in s.bytes() {
        if b == b'=' || b.is_ascii_whitespace() {
            continue;
        }
        let v = table[b as usize];
        if v == 0xff {
            return Err(format!("invalid base64 character '{}'", b as char));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8h").unwrap(), b"hello!");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert!(decode_base64("!!!").is_err());
    }

    #[test]
    fn seeded_names_are_stable_and_scoped() {
        let a = seeded_file_name("alt", "Panel Shot.PNG", b"pixels");
        assert_eq!(a, seeded_file_name("alt", "Panel Shot.PNG", b"pixels"));
        assert!(a.starts_with("alt_panel_shot_") && a.ends_with(".png"));
        // Different gauge, same image → different file.
        assert_ne!(a, seeded_file_name("asi", "Panel Shot.PNG", b"pixels"));
        // Same gauge, different image → different file.
        assert_ne!(a, seeded_file_name("alt", "Panel Shot.PNG", b"other"));
    }

    fn input(id: &str, source: &str, data: &str) -> RefImageInput {
        RefImageInput {
            id: id.into(),
            name: source.into(),
            x: 1.0,
            y: 2.0,
            w: 3.0,
            h: 4.0,
            opacity: 0.5,
            locked: false,
            visible: true,
            source_name: source.into(),
            data: data.into(),
        }
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gauge_refs_{tag}_{}", fnv1a64(tag.as_bytes())));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn extracts_into_refs_and_prunes_its_own_leftovers() {
        let dir = temp_dir("extract");
        // "aGVsbG8=" is "hello".
        let metas = extract_ref_images(
            &dir,
            "Altimeter",
            &[input("r1", "panel.png", "aGVsbG8=")],
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(metas.len(), 1);
        assert!(metas[0].file.starts_with("refs/altimeter_panel_"));
        assert_eq!(metas[0].x, 1.0);
        let written = dir.join(&metas[0].file);
        assert_eq!(fs::read(&written).unwrap(), b"hello");

        // An unrelated project's reference sharing the folder is left alone,
        // while this gauge's now-unused file goes away.
        let other = dir.join(REFS_DIR).join("asi_panel_0000.png");
        fs::write(&other, b"other").unwrap();
        let metas = extract_ref_images(&dir, "Altimeter", &[], &HashSet::new()).unwrap();
        assert!(metas.is_empty());
        assert!(!written.exists());
        assert!(other.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefixes_come_from_the_scene_file_name() {
        assert_eq!(prefix_for("altimeter.ron"), "altimeter");
        assert_eq!(prefix_for("alpha_2.ron"), "alpha_2");
        assert_eq!(prefix_for(r"C:\projects\dc\My Gauge.ron"), "my_gauge");
        // Two gauges sharing a display name still get separate prefixes.
        assert_ne!(prefix_for("altimeter.ron"), prefix_for("altimeter_2.ron"));
    }

    #[test]
    fn a_file_another_gauge_uses_survives_this_gauges_prune() {
        let dir = temp_dir("in_use");
        // Written under this gauge's prefix, but another tab points at it —
        // the case that used to delete a sibling's tracing image outright.
        let shared = dir.join(REFS_DIR).join("altimeter_shared_0000.png");
        fs::create_dir_all(dir.join(REFS_DIR)).unwrap();
        fs::write(&shared, b"shared").unwrap();
        let stale = dir.join(REFS_DIR).join("altimeter_stale_0000.png");
        fs::write(&stale, b"stale").unwrap();

        let in_use = HashSet::from(["altimeter_shared_0000.png".to_string()]);
        extract_ref_images(&dir, "Altimeter", &[], &in_use).unwrap();
        assert!(shared.exists(), "a referenced file must not be pruned");
        assert!(!stale.exists(), "an unreferenced leftover should still go");

        // Same when the gauge does have images of its own to write.
        extract_ref_images(
            &dir,
            "Altimeter",
            &[input("r1", "panel.png", "aGVsbG8=")],
            &in_use,
        )
        .unwrap();
        assert!(shared.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_recorded_source_name_keeps_names_stable_across_saves() {
        let dir = temp_dir("stable");
        let first =
            extract_ref_images(&dir, "pfd", &[input("r1", "Pasted.png", "aGVsbG8=")], &HashSet::new())
                .unwrap();
        assert_eq!(first[0].source, "Pasted.png");

        // Reopening feeds the recorded source back in, so the name is the same
        // rather than gaining another `pfd_` on the front.
        let again = extract_ref_images(
            &dir,
            "pfd",
            &[input("r1", &first[0].source, "aGVsbG8=")],
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(first[0].file, again[0].file);
        assert!(first[0].file.starts_with("refs/pfd_pasted_"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_image_already_in_refs_keeps_the_name_it_has() {
        let dir = temp_dir("reuse");
        // Named by an older scheme — a gauge-name prefix rather than this
        // gauge's scene-file one.
        fs::create_dir_all(dir.join(REFS_DIR)).unwrap();
        let legacy = dir.join(REFS_DIR).join("md_pfd_pasted_454eb139.png");
        fs::write(&legacy, b"hello").unwrap();

        let metas =
            extract_ref_images(&dir, "scene", &[input("r1", "Pasted.png", "aGVsbG8=")], &HashSet::new())
                .unwrap();
        assert_eq!(metas[0].file, "refs/md_pfd_pasted_454eb139.png");
        assert!(legacy.exists());
        // No second copy of the same pixels was minted alongside it.
        assert_eq!(fs::read_dir(dir.join(REFS_DIR)).unwrap().count(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_extensions_fall_back_to_png() {
        assert!(seeded_file_name("g", "clip", b"x").ends_with(".png"));
        assert!(seeded_file_name("g", "clip.tiff", b"x").ends_with(".png"));
        assert!(seeded_file_name("g", "clip.svg", b"x").ends_with(".svg"));
    }
}
