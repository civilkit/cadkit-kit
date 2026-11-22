// Safe desktop slicer discovery and one-click launch (Bambu Studio, OrcaSlicer, PrusaSlicer, UltiMaker Cura).
// Strictly allowlisted: never executes arbitrary commands or user-supplied paths.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SLICER_BYTES: usize = 256 * 1024 * 1024; // 256 MB safety cap

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DetectedSlicer {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
enum LaunchTarget {
    #[cfg(target_os = "macos")]
    MacApp(PathBuf),
    #[cfg(not(target_os = "macos"))]
    Executable(PathBuf),
    #[cfg(target_os = "linux")]
    Flatpak(&'static str),
}

struct SlicerSpec {
    id: &'static str,
    name: &'static str,
}

const KNOWN_SLICERS: &[SlicerSpec] = &[
    SlicerSpec { id: "bambu-studio", name: "Bambu Studio" },
    SlicerSpec { id: "orcaslicer", name: "OrcaSlicer" },
    SlicerSpec { id: "prusaslicer", name: "PrusaSlicer" },
    SlicerSpec { id: "cura", name: "UltiMaker Cura" },
];

pub fn is_known_slicer(id: &str) -> bool {
    KNOWN_SLICERS.iter().any(|s| s.id == id)
}

#[cfg(target_os = "macos")]
fn find_slicer_target(id: &str) -> Option<LaunchTarget> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let app_names: &[&str] = match id {
        "bambu-studio" => &["BambuStudio.app", "Bambu Studio.app"],
        "orcaslicer" => &["OrcaSlicer.app"],
        "prusaslicer" => &["Original Prusa Drivers/PrusaSlicer.app", "PrusaSlicer.app"],
        "cura" => &["UltiMaker Cura.app", "Ultimaker Cura.app"],
        _ => return None,
    };
    for name in app_names {
        let sys = PathBuf::from("/Applications").join(name);
        if sys.exists() {
            return Some(LaunchTarget::MacApp(sys));
        }
        if let Some(ref h) = home {
            let user = h.join("Applications").join(name);
            if user.exists() {
                return Some(LaunchTarget::MacApp(user));
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_slicer_target(id: &str) -> Option<LaunchTarget> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        roots.push(PathBuf::from(pf));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs"));
    }
    let rels: &[&str] = match id {
        "bambu-studio" => &["Bambu Studio\\bambu-studio.exe"],
        "orcaslicer" => &["OrcaSlicer\\orca-slicer.exe"],
        "prusaslicer" => &["Prusa3D\\PrusaSlicer\\prusa-slicer.exe"],
        "cura" => &[
            "UltiMaker Cura\\UltiMaker-Cura.exe",
            "Ultimaker Cura\\Ultimaker-Cura.exe",
        ],
        _ => return None,
    };
    for root in &roots {
        for rel in rels {
            let p = root.join(rel);
            if p.is_file() {
                return Some(LaunchTarget::Executable(p));
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn find_slicer_target(id: &str) -> Option<LaunchTarget> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let bins: &[&str] = match id {
        "bambu-studio" => &["bambu-studio", "BambuStudio"],
        "orcaslicer" => &["orca-slicer", "OrcaSlicer"],
        "prusaslicer" => &["prusa-slicer", "PrusaSlicer"],
        "cura" => &["cura", "UltiMaker-Cura"],
        _ => return None,
    };
    let mut dirs = vec![PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(ref h) = home {
        dirs.push(h.join(".local/bin"));
    }
    for dir in &dirs {
        for bin in bins {
            let p = dir.join(bin);
            if p.is_file() {
                return Some(LaunchTarget::Executable(p));
            }
        }
    }
    let flatpak_id: Option<&'static str> = match id {
        "bambu-studio" => Some("com.bambulab.BambuStudio"),
        "orcaslicer" => Some("io.github.softfever.OrcaSlicer"),
        "prusaslicer" => Some("com.prusa3d.PrusaSlicer"),
        "cura" => Some("com.ultimaker.cura"),
        _ => None,
    };
    if let Some(app_id) = flatpak_id {
        let sys_fp = PathBuf::from("/var/lib/flatpak/app").join(app_id);
        let user_fp = home.map(|h| h.join(".local/share/flatpak/app").join(app_id));
        if sys_fp.is_dir() || user_fp.map(|p| p.is_dir()).unwrap_or(false) {
            if Path::new("/usr/bin/flatpak").is_file() {
                return Some(LaunchTarget::Flatpak(app_id));
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn find_slicer_target(_id: &str) -> Option<LaunchTarget> {
    None
}

/// Sanitize a filename to a single safe basename ending in `.3mf` or `.stl`.
pub fn sanitize_filename(raw: &str) -> String {
    let base = Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("plate.3mf");
    let mut clean: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() {
        clean = "plate.3mf".to_string();
    }
    let lower = clean.to_ascii_lowercase();
    if !lower.ends_with(".3mf") && !lower.ends_with(".stl") {
        clean.push_str(".3mf");
    }
    clean
}

fn launch_target(target: &LaunchTarget, file_path: &Path) -> Result<(), String> {
    match target {
        #[cfg(target_os = "macos")]
        LaunchTarget::MacApp(app_path) => {
            Command::new("/usr/bin/open")
                .arg("-a")
                .arg(app_path)
                .arg(file_path)
                .spawn()
                .map_err(|e| format!("failed to launch slicer: {e}"))?;
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        LaunchTarget::Executable(exe_path) => {
            Command::new(exe_path)
                .arg(file_path)
                .spawn()
                .map_err(|e| format!("failed to launch slicer: {e}"))?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        LaunchTarget::Flatpak(app_id) => {
            Command::new("/usr/bin/flatpak")
                .arg("run")
                .arg(app_id)
                .arg(file_path)
                .spawn()
                .map_err(|e| format!("failed to launch flatpak slicer: {e}"))?;
            Ok(())
        }
    }
}

/// Detect allowlisted 3D-printing slicers installed in standard OS locations.
#[tauri::command]
pub fn detect_slicers() -> Vec<DetectedSlicer> {
    KNOWN_SLICERS
        .iter()
        .filter(|spec| find_slicer_target(spec.id).is_some())
        .map(|spec| DetectedSlicer {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
        })
        .collect()
}

/// Write a temporary `.3mf`/`.stl` file and open it in an allowlisted, detected slicer.
#[tauri::command]
pub fn open_in_slicer(slicer_id: String, bytes: Vec<u8>, filename: String) -> Result<String, String> {
    if !is_known_slicer(&slicer_id) {
        return Err(format!("unknown slicer: {slicer_id}"));
    }
    if bytes.is_empty() {
        return Err("cannot send an empty file to slicer".to_string());
    }
    if bytes.len() > MAX_SLICER_BYTES {
        return Err("file exceeds maximum allowed size for slicer handoff".to_string());
    }
    let target = find_slicer_target(&slicer_id)
        .ok_or_else(|| format!("slicer '{slicer_id}' is not installed"))?;

    let dir = std::env::temp_dir().join("civilkit-slicer");
    std::fs::create_dir_all(&dir).map_err(|e| format!("temp dir: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe_name = sanitize_filename(&filename);
    let file_path = dir.join(format!("{stamp}-{safe_name}"));
    std::fs::write(&file_path, &bytes).map_err(|e| format!("write temp file: {e}"))?;

    launch_target(&target, &file_path)?;
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_known_and_rejects_arbitrary_ids() {
        assert!(is_known_slicer("bambu-studio"));
        assert!(is_known_slicer("orcaslicer"));
        assert!(is_known_slicer("prusaslicer"));
        assert!(is_known_slicer("cura"));
        assert!(!is_known_slicer("sh"));
        assert!(!is_known_slicer("/bin/sh"));
        assert!(!is_known_slicer("bambu-studio; rm -rf /"));
    }

    #[test]
    fn sanitize_filename_strips_traversal_and_enforces_extension() {
        assert_eq!(sanitize_filename("../../evil/plate.3mf"), "plate.3mf");
        assert_eq!(sanitize_filename("my bracket.stl"), "my bracket.stl");
        assert_eq!(sanitize_filename("bracket"), "bracket.3mf");
        assert_eq!(sanitize_filename("..."), "plate.3mf");
        assert_eq!(sanitize_filename("a/b/c:d*e?.3mf"), "c_d_e_.3mf");
    }

    #[test]
    fn open_in_slicer_rejects_unknown_id_and_empty_payload() {
        let err1 = open_in_slicer("unknown-app".into(), vec![1, 2, 3], "a.3mf".into()).unwrap_err();
        assert!(err1.contains("unknown slicer"));
        let err2 = open_in_slicer("bambu-studio".into(), vec![], "a.3mf".into()).unwrap_err();
        assert!(err2.contains("empty"));
    }
}
