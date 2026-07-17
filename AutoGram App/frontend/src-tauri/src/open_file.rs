//! Safe open-in-system helpers for Drive document cache.
//!
//! Open With on Windows:
//! - Prefer `%WINDIR%\System32\OpenWith.exe` (modern picker, reliable)
//! - Fallback: rundll32 OpenAs_RunDLL
//! - Never wait; never CREATE_NO_WINDOW on the UI process
//! - Avoid DETACHED_PROCESS — it often kills/hides the Open With UI under Tauri

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

fn resolve_worker_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource) = app.path().resource_dir() {
        let p = resource.join("worker");
        if p.join("daemon.py").exists() {
            return Ok(p.canonicalize().unwrap_or(p));
        }
    }
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut dir = cwd.clone();
    for _ in 0..8 {
        let p = dir.join("worker");
        if p.join("daemon.py").exists() {
            return Ok(p.canonicalize().unwrap_or(p));
        }
        if !dir.pop() {
            break;
        }
    }
    for p in [
        cwd.join("worker"),
        cwd.join("..").join("worker"),
        cwd.join("..").join("..").join("worker"),
        cwd.join("..").join("..").join("..").join("worker"),
    ] {
        if p.join("daemon.py").exists() {
            return Ok(p.canonicalize().unwrap_or(p));
        }
    }
    Err("worker/ directory not found".into())
}

fn allowed_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let worker = resolve_worker_root(app)?;
    let mut roots = vec![
        worker.clone(),
        worker.join("cache"),
        worker.join("temp"),
        worker.join("sessions"),
        worker.join("cache").join("previews"),
        worker.join("cache").join("open"),
        worker.join("cache").join("thumbs"),
    ];
    if let Ok(tmp) = std::env::temp_dir().canonicalize() {
        roots.push(tmp);
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let h = PathBuf::from(home);
        roots.push(h.join("Downloads"));
        roots.push(h.join("Documents"));
        roots.push(h.join("Desktop"));
        roots.push(h.join("AppData").join("Local").join("Temp"));
    }
    Ok(roots
        .into_iter()
        .filter_map(|p| {
            if p.exists() {
                Some(p.canonicalize().unwrap_or(p))
            } else {
                let _ = fs::create_dir_all(&p);
                Some(p.canonicalize().unwrap_or(p))
            }
        })
        .collect())
}

fn to_shell_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\UNC\")
        .map(|r| format!(r"\\{r}"))
        .unwrap_or_else(|| s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

fn path_looks_like_cache(path: &str) -> bool {
    let l = path.to_lowercase().replace('/', "\\");
    l.contains("\\cache\\")
        || l.contains("\\temp\\")
        || l.contains("\\previews\\")
        || l.contains("\\worker\\")
        || l.contains("\\appdata\\local\\temp")
}

fn path_is_allowed(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let raw = path.to_string_lossy().trim().trim_matches('"').to_string();
    if raw.is_empty() {
        return Err("empty path".into());
    }
    let low = raw.to_lowercase();
    if low.starts_with("http://") || low.starts_with("https://") || low.starts_with("asset://") {
        return Err("path is a URL, not a local file".into());
    }
    let p = PathBuf::from(&raw);
    if !p.is_file() {
        return Err(format!("path not found or not a file: {raw}"));
    }
    let canon = p.canonicalize().unwrap_or(p);
    let shell = to_shell_path(&canon);
    if path_looks_like_cache(&shell) {
        return Ok(canon);
    }
    let roots = allowed_roots(app)?;
    for root in roots {
        let c = to_shell_path(&canon).to_lowercase();
        let r = to_shell_path(&root).to_lowercase();
        if c.starts_with(&r) || canon.starts_with(&root) {
            return Ok(canon);
        }
    }
    Err(format!(
        "open blocked: path outside allowed cache roots ({shell})"
    ))
}

/// Spawn without waiting. No CREATE_NO_WINDOW / DETACHED on GUI tools.
fn spawn_ui(program: &Path, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {} failed: {e}", program.display()))?;
    Ok(())
}

fn windir() -> PathBuf {
    PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into()))
}

/// Open with default app — non-blocking.
#[tauri::command]
pub fn open_path_safe(app: AppHandle, path: String) -> Result<(), String> {
    let p = path_is_allowed(&app, Path::new(path.trim()))?;
    let shell = to_shell_path(&p);

    #[cfg(windows)]
    {
        // Default association via FileProtocolHandler (shows target app, not Open With)
        let rundll = windir().join("System32").join("rundll32.exe");
        spawn_ui(&rundll, &["url.dll,FileProtocolHandler", &shell])?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        spawn_ui(Path::new("open"), &[&shell])?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        spawn_ui(Path::new("xdg-open"), &[&shell])?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("open not supported".into())
}

/// Windows "Open with…" dialog — must actually appear on screen.
#[tauri::command]
pub fn open_with_dialog(app: AppHandle, path: String) -> Result<(), String> {
    let p = path_is_allowed(&app, Path::new(path.trim()))?;
    let shell = to_shell_path(&p);

    #[cfg(windows)]
    {
        // 1) Official modern picker (Win10/11)
        let open_with = windir().join("System32").join("OpenWith.exe");
        if open_with.is_file() {
            if spawn_ui(&open_with, &[&shell]).is_ok() {
                return Ok(());
            }
        }

        // 2) Classic OpenAs_RunDLL — no DETACHED, no CREATE_NO_WINDOW
        let rundll = windir().join("System32").join("rundll32.exe");
        if spawn_ui(
            &rundll,
            &["shell32.dll,OpenAs_RunDLL", &shell],
        )
        .is_ok()
        {
            return Ok(());
        }

        // 3) PowerShell Start-Process (last resort)
        let lit = shell.replace('\'', "''");
        let ps = windir().join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
        let ps_cmd = if open_with.is_file() {
            format!(
                "Start-Process -FilePath '{}' -ArgumentList @('{}')",
                open_with.display().to_string().replace('\'', "''"),
                lit
            )
        } else {
            format!(
                "Start-Process -FilePath rundll32 -ArgumentList 'shell32.dll,OpenAs_RunDLL','{lit}'"
            )
        };
        Command::new(if ps.is_file() {
            ps
        } else {
            PathBuf::from("powershell")
        })
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &ps_cmd,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Open With gagal: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        open_path_safe(app, shell)
    }
}

#[tauri::command]
pub fn reveal_path_safe(app: AppHandle, path: String) -> Result<(), String> {
    let p = path_is_allowed(&app, Path::new(path.trim()))?;
    let shell = to_shell_path(&p);

    #[cfg(windows)]
    {
        let explorer = windir().join("explorer.exe");
        spawn_ui(&explorer, &[&format!("/select,{shell}")])?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        spawn_ui(Path::new("open"), &["-R", &shell])?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(parent) = p.parent() {
            spawn_ui(Path::new("xdg-open"), &[&parent.to_string_lossy()])?;
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("reveal not supported".into())
}

#[tauri::command]
pub fn cache_file_ready(app: AppHandle, path: String) -> Result<bool, String> {
    let raw = path.trim().trim_matches('"');
    if raw.is_empty() {
        return Ok(false);
    }
    let low = raw.to_lowercase();
    if low.starts_with("http://") || low.starts_with("https://") || low.starts_with("asset://") {
        return Ok(false);
    }
    let p = Path::new(raw);
    if !p.is_file() {
        return Ok(false);
    }
    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };
    if meta.len() == 0 {
        return Ok(false);
    }
    match path_is_allowed(&app, p) {
        Ok(_) => Ok(true),
        Err(_) => Ok(path_looks_like_cache(raw)),
    }
}

#[tauri::command]
pub fn copy_cache_file(app: AppHandle, from: String, to: String) -> Result<String, String> {
    let src = path_is_allowed(&app, Path::new(from.trim()))?;
    let dest_raw = to.trim().trim_matches('"').to_string();
    if dest_raw.is_empty() {
        return Err("empty dest".into());
    }
    let dest = PathBuf::from(&dest_raw);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir dest: {e}"))?;
        let parent_ok = {
            let roots = allowed_roots(&app)?;
            let pp = parent.canonicalize().unwrap_or(parent.to_path_buf());
            let ps = to_shell_path(&pp).to_lowercase();
            path_looks_like_cache(&ps)
                || roots.iter().any(|r| {
                    let rs = to_shell_path(r).to_lowercase();
                    ps.starts_with(&rs) || pp.starts_with(r)
                })
        };
        if !parent_ok {
            return Err("copy dest outside allowed cache roots".into());
        }
    }
    fs::copy(&src, &dest).map_err(|e| format!("copy failed: {e}"))?;
    let out = dest
        .canonicalize()
        .unwrap_or(dest)
        .to_string_lossy()
        .to_string();
    Ok(to_shell_path(Path::new(&out)))
}
