// CivilKit CAD desktop shell: one window that loads the bundled static build (tauri://localhost/cad/) and works offline.
mod slicer;

use std::ffi::OsStr;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const DOCS_URL: &str = "https://civilkit.io/docs/cad/";
const WHATS_NEW_URL: &str = "https://civilkit.io/cad/whats-new/";

// Page side: links to the web and new-window links go to the system browser (never inside the window), and a part file arriving from outside
// (double-click in Finder) is handed to the app as the same drop event the page already handles, so the web app needs no special case.
const INIT_SCRIPT: &str = r#"
(() => {
  const external = (u) => /^(https?|mailto):/i.test(u);
  const open = (u) => { try { window.__TAURI__.opener.openUrl(u).catch((err) => console.error('open failed: ' + err)); } catch (e) { /* no bridge: do nothing rather than navigate away */ } };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (isDownload(a)) { e.preventDefault(); e.stopPropagation(); save(a); return; }
    if (a.hasAttribute('download')) return;
    const href = a.href;
    if (external(href)) { e.preventDefault(); e.stopPropagation(); open(href); }
    else if (a.target === '_blank') { e.preventDefault(); e.stopPropagation(); try { const u = new URL(href); open('https://civilkit.io' + u.pathname + u.search + u.hash); } catch (_) {} }
  }, true);
  // Downloads (Export, Save a copy, saved scripts): WKWebView ignores <a download>, so a blob or data link goes through a native Save dialog and is written there.
  // The blob is fetched synchronously inside click(), because the app revokes the URL right after clicking.
  const save = (a) => {
    const name = a.getAttribute('download') || 'download';
    const bytes = fetch(a.href).then((r) => r.arrayBuffer());
    (async () => {
      const buf = await bytes;
      const path = await window.__TAURI__.dialog.save({ defaultPath: name });
      if (path) await window.__TAURI__.fs.writeFile(path, new Uint8Array(buf));
    })().catch((err) => console.error('save failed: ' + err));
  };
  const isDownload = (a) => a.hasAttribute('download') && /^(blob|data):/i.test(a.href);
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isDownload(this)) { save(this); return; } return realClick.call(this); };
  window.open = (u) => { if (u) { const s = String(u); if (external(s)) open(s); } return null; };
})();
"#;

static PENDING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
static PAGE_READY: AtomicBool = AtomicBool::new(false);

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn open_in_page(app: &AppHandle, path: &PathBuf) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(bytes) = std::fs::read(path) else { return };
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let js = format!(
        "(() => {{ const b = Uint8Array.from(atob('{}'), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([b], {})); \
         window.dispatchEvent(new DragEvent('drop', {{ dataTransfer: dt, bubbles: true, cancelable: true }})); }})()",
        b64(&bytes),
        serde_json_string(&name)
    );
    let _ = win.eval(&js);
}

fn serde_json_string(s: &str) -> String {
    let mut o = String::from("\"");
    for ch in s.chars() {
        match ch {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn flush_pending(app: &AppHandle) {
    if !PAGE_READY.load(Ordering::SeqCst) {
        return;
    }
    let files: Vec<PathBuf> = std::mem::take(&mut *PENDING.lock().unwrap());
    for f in files {
        open_in_page(app, &f);
    }
}

/// Returns true if `path` has a supported CivilKit part extension (`.ckpart`, `.ckpart.gz`, `.ckpart`, `.ckpart.gz`).
pub fn is_supported_part_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".ckpart")
        || lower.ends_with(".ckpart.gz")
        || lower.ends_with(".ckpart")
        || lower.ends_with(".ckpart.gz")
}

/// Parse a single CLI argument into a part file path, accepting both filesystem paths and `file://` URIs.
pub fn parse_cli_part_arg(arg: &OsStr) -> Option<PathBuf> {
    let s = arg.to_str();
    let candidate = if let Some(text) = s {
        if text.starts_with("file://") {
            Url::parse(text)
                .ok()
                .and_then(|u| if u.scheme() == "file" { u.to_file_path().ok() } else { None })?
        } else {
            PathBuf::from(arg)
        }
    } else {
        PathBuf::from(arg)
    };
    is_supported_part_path(&candidate).then_some(candidate)
}

/// Extract supported part file paths from CLI arguments (used by Windows/Linux file associations and CLI launches).
pub fn extract_cli_part_files<I, S>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut out = Vec::new();
    let mut after_double_dash = false;
    for raw in args {
        let arg = raw.as_ref();
        if !after_double_dash {
            if arg == "--" {
                after_double_dash = true;
                continue;
            }
            if arg.to_str().is_some_and(|s| s.starts_with('-')) {
                continue;
            }
        }
        if let Some(path) = parse_cli_part_arg(arg) {
            out.push(path);
        }
    }
    out
}

fn queue_file(app: &AppHandle, path: PathBuf) {
    PENDING.lock().unwrap().push(path);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
    flush_pending(app);
}

#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "CivilKit CAD",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About CivilKit CAD"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open-part", "Open Part File...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    let window = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?])?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "help-docs", "CivilKit CAD Guide", true, None::<&str>)?,
            &MenuItem::with_id(app, "help-new", "What's New", true, None::<&str>)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

#[cfg(not(target_os = "macos"))]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open-part", "Open Part File...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    let window = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?])?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "help-docs", "CivilKit CAD Guide", true, None::<&str>)?,
            &MenuItem::with_id(app, "help-new", "What's New", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::about(app, Some("About CivilKit CAD"), None)?,
        ],
    )?;
    Menu::with_items(app, &[&file, &edit, &view, &window, &help])
}

fn generate_auth_token() -> Result<String, String> {
    let mut raw = [0u8; 32];
    getrandom::fill(&mut raw).map_err(|e| format!("random: {e}"))?;
    let mut token = String::with_capacity(64);
    for b in raw {
        token.push_str(&format!("{b:02x}"));
    }
    Ok(token)
}

fn start_embedded_kernel() -> Result<(String, String), String> {
    let token = generate_auth_token()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("addr: {e}"))?.port();
    let mut cfg = ck_native::Config::default();
    cfg.token = token.clone();
    cfg.dir = None;
    cfg.origins = vec!["tauri://localhost".into(), "http://tauri.localhost".into(), "https://tauri.localhost".into()];
    cfg.quiet = true;
    std::thread::Builder::new()
        .name("ck-native-http".into())
        .spawn(move || ck_native::serve(listener, cfg))
        .map_err(|e| format!("spawn: {e}"))?;
    Ok((format!("http://127.0.0.1:{port}"), token))
}

fn build_init_script(embedded: Option<(&str, &str)>) -> String {
    match embedded {
        Some((url, token)) => format!(
            "window.__CK_NATIVE__ = Object.freeze({{ url: {}, token: {} }});\n{}",
            serde_json_string(url),
            serde_json_string(token),
            INIT_SCRIPT
        ),
        None => INIT_SCRIPT.to_string(),
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![slicer::detect_slicers, slicer::open_in_slicer])
        .setup(|app| {
            app.set_menu(build_menu(app.handle())?)?;
            let embedded = match start_embedded_kernel() {
                Ok(pair) => Some(pair),
                Err(e) => {
                    eprintln!("embedded kernel unavailable: {e}");
                    None
                }
            };
            let init_script = build_init_script(embedded.as_ref().map(|(u, t)| (u.as_str(), t.as_str())));
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("cad/index.html".into()))
                .title("CivilKit CAD")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .disable_drag_drop_handler() // the page handles file drops itself (HTML5 drag and drop)
                .initialization_script(init_script)
                // only the bundled app is ever shown in the window
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about" | "blob" | "data") || url.host_str() == Some("tauri.localhost"))
                .on_page_load(move |_w, payload| {
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let h = handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(1500)); // the app listens for drops once it has mounted
                            PAGE_READY.store(true, Ordering::SeqCst);
                            flush_pending(&h);
                            // debug builds only: run a test script from a file (WKWebView has no remote debugging port); it reports through the window title
                            #[cfg(debug_assertions)]
                            if let (Ok(f), Some(w)) = (std::env::var("CK_DESKTOP_TEST_JS"), h.get_webview_window("main")) {
                                if let Ok(js) = std::fs::read_to_string(f) { let _ = w.eval(&js); }
                            }
                        });
                    } else {
                        PAGE_READY.store(false, Ordering::SeqCst);
                    }
                })
                .build()?;
            // Windows / Linux file associations (and CLI launches on all platforms) pass file paths via argv.
            for path in extract_cli_part_files(std::env::args_os().skip(1)) {
                if path.is_file() {
                    queue_file(app.handle(), path);
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "help-docs" => { let _ = app.opener().open_url(DOCS_URL, None::<&str>); }
            "help-new" => { let _ = app.opener().open_url(WHATS_NEW_URL, None::<&str>); }
            "open-part" => {
                let a = app.clone();
                app.dialog().file().set_title("Open a part file").add_filter("CivilKit part", &["ckpart", "ckpart", "gz", "json"]).pick_file(move |p| {
                    if let Some(path) = p.and_then(|f| f.into_path().ok()) { queue_file(&a, path); }
                });
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building CivilKit CAD");

    app.run(|handle, event| {
        // macOS: a double-clicked .ckpart, or a file dropped on the Dock icon
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = &event {
            for u in urls {
                if let Ok(p) = u.to_file_path() { queue_file(handle, p); }
            }
        }
        let _ = (&handle, &event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    fn http_get(addr: &str, origin: &str, auth: Option<&str>) -> String {
        let mut s = TcpStream::connect(addr).expect("connect to embedded kernel");
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let auth_hdr = auth.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        let req = format!("GET /version HTTP/1.1\r\nHost: {addr}\r\nOrigin: {origin}\r\n{auth_hdr}Connection: close\r\n\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        resp
    }

    #[test]
    fn embedded_kernel_serves_version_and_requires_token() {
        let (url, token) = start_embedded_kernel().expect("start embedded kernel");
        assert!(url.starts_with("http://127.0.0.1:"));
        assert_eq!(token.len(), 64);
        let addr = url.trim_start_matches("http://");

        // macOS / Linux origin
        let ok = http_get(addr, "tauri://localhost", Some(&token));
        assert!(ok.starts_with("HTTP/1.1 200 OK"), "{ok}");
        assert!(ok.contains("Access-Control-Allow-Origin: tauri://localhost"), "{ok}");
        assert!(ok.contains("\"protocol\":1"), "{ok}");

        // Windows WebView2 origin
        let ok_win = http_get(addr, "http://tauri.localhost", Some(&token));
        assert!(ok_win.starts_with("HTTP/1.1 200 OK"), "{ok_win}");
        assert!(ok_win.contains("Access-Control-Allow-Origin: http://tauri.localhost"), "{ok_win}");

        let unauth = http_get(addr, "tauri://localhost", None);
        assert!(unauth.starts_with("HTTP/1.1 401"), "{unauth}");

        let init = build_init_script(Some((&url, &token)));
        assert!(init.starts_with("window.__CK_NATIVE__ = Object.freeze("));
        assert!(init.contains(&url));
        assert!(init.contains(&token));
    }

    #[test]
    fn generate_auth_token_produces_unique_64_hex_chars() {
        let t1 = generate_auth_token().expect("token 1");
        let t2 = generate_auth_token().expect("token 2");
        assert_eq!(t1.len(), 64);
        assert_eq!(t2.len(), 64);
        assert!(t1.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t1, t2);
    }

    #[test]
    fn is_supported_part_path_matches_ckpart_variants_case_insensitively() {
        assert!(is_supported_part_path(Path::new("bracket.ckpart")));
        assert!(is_supported_part_path(Path::new("/tmp/Bracket.CKPART.GZ")));
        assert!(is_supported_part_path(Path::new("legacy.ckpart")));
        assert!(is_supported_part_path(Path::new("legacy.ckpart.gz")));
        assert!(!is_supported_part_path(Path::new("notes.txt")));
        assert!(!is_supported_part_path(Path::new("archive.tar.gz")));
        assert!(!is_supported_part_path(Path::new("")));
    }

    #[test]
    fn extract_cli_part_files_handles_paths_flags_and_file_urls() {
        let args = [
            "-psn_0_12345",
            "--verbose",
            "part1.ckpart",
            "ignore.stl",
            "part2.ckpart.gz",
            "file:///tmp/my%20part.ckpart",
            "--",
            "-weird.ckpart",
        ];
        let parsed = extract_cli_part_files(args);
        assert_eq!(
            parsed,
            vec![
                PathBuf::from("part1.ckpart"),
                PathBuf::from("part2.ckpart.gz"),
                PathBuf::from("/tmp/my part.ckpart"),
                PathBuf::from("-weird.ckpart"),
            ]
        );
    }

    #[test]
    fn serde_json_string_escapes_windows_backslashes_and_quotes() {
        assert_eq!(
            serde_json_string(r#"C:\Users\demo\"bracket".ckpart"#),
            r#""C:\\Users\\demo\\\"bracket\".ckpart""#
        );
    }
}
