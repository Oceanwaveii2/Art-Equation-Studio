//! Native decorations remain native: controls, hit testing, maximization and
//! accessibility are owned by Windows. Unsupported DWM attributes fall back.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChromeColors { pub dark: bool, pub caption: [u8; 3], pub text: [u8; 3], pub border: [u8; 3] }
impl Default for ChromeColors {
    fn default() -> Self { Self { dark: true, caption: [7,19,38], text: [255,255,255], border: [24,40,68] } }
}
#[derive(Default)]
pub(crate) struct ChromeState(pub Mutex<ChromeColors>);
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChromeResult { platform: &'static str, high_contrast: bool, attributes: Vec<(u32,i32)> }
pub(crate) fn color_ref(rgb: [u8;3]) -> u32 { u32::from(rgb[0]) | u32::from(rgb[1]) << 8 | u32::from(rgb[2]) << 16 }

#[cfg(windows)]
pub(crate) fn apply(hwnd: *mut std::ffi::c_void, colors: &ChromeColors, focused: bool) -> ChromeResult {
    use std::ffi::c_void;
    #[repr(C)] struct HighContrast { size: u32, flags: u32, scheme: *mut u16 }
    #[link(name="user32")]
    extern "system" { fn SystemParametersInfoW(action: u32, param: u32, value: *mut c_void, flags: u32) -> i32; }
    #[link(name="dwmapi")]
    extern "system" { fn DwmSetWindowAttribute(hwnd: *mut c_void, attribute: u32, data: *const c_void, size: u32) -> i32; }
    let mut hc = HighContrast { size: std::mem::size_of::<HighContrast>() as u32, flags: 0, scheme: std::ptr::null_mut() };
    let high_contrast = unsafe { SystemParametersInfoW(0x42, hc.size, &mut hc as *mut _ as *mut c_void, 0) != 0 && hc.flags & 1 != 0 };
    let default = 0xffffffffu32;
    let values = [(20, u32::from(colors.dark && !high_contrast)),
        (35, if high_contrast { default } else { color_ref(colors.caption) }),
        (36, if high_contrast { default } else { color_ref(colors.text) }),
        (34, if high_contrast || !focused { default } else { color_ref(colors.border) })];
    let attributes = values.into_iter().map(|(id,value)| {
        let hr = unsafe { DwmSetWindowAttribute(hwnd, id, &value as *const _ as *const c_void, 4) }; (id,hr)
    }).collect();
    ChromeResult { platform: "windows-dwm", high_contrast, attributes }
}
#[tauri::command]
pub(crate) fn set_window_chrome(window: tauri::WebviewWindow, state: State<'_, ChromeState>, colors: ChromeColors) -> Result<ChromeResult,String> {
    *state.0.lock().map_err(|e| e.to_string())? = colors.clone();
    window.set_theme(Some(if colors.dark { tauri::Theme::Dark } else { tauri::Theme::Light })).map_err(|e| e.to_string())?;
    #[cfg(windows)] {
        let result = apply(window.hwnd().map_err(|e|e.to_string())?.0, &colors, window.is_focused().unwrap_or(true));
        if result.high_contrast { let _ = window.set_theme(None); }
        Ok(result)
    }
    #[cfg(not(windows))] { Ok(ChromeResult { platform: "native-theme", high_contrast: false, attributes: vec![] }) }
}
pub(crate) fn startup(app: &tauri::App, root: &std::path::Path) {
    let theme = std::fs::read(root.join("settings.json")).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()).and_then(|value|value["theme"].as_str().map(str::to_owned));
    let colors = match theme.as_deref() {
        Some("light") => ChromeColors { dark:false, caption:[232,236,241], text:[13,21,32], border:[216,224,232] },
        Some("dark") => ChromeColors { dark:true, caption:[20,22,26], text:[248,250,252], border:[38,41,50] },
        _ => ChromeColors::default()
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = set_window_chrome(window.clone(), app.state::<ChromeState>(), colors);
        // Track 2 Runtime Guard: prevent ERR_CONNECTION_REFUSED if window is pointed at localhost:5173
        if let Ok(url) = window.url() {
            if url.host_str() == Some("localhost") && url.port() == Some(5173) {
                let reachable = std::net::TcpStream::connect_timeout(
                    &"127.0.0.1:5173".parse().unwrap(),
                    std::time::Duration::from_millis(150),
                ).is_ok();
                if !reachable {
                    log::warn!("Dev server 127.0.0.1:5173 unreachable; redirecting to embedded frontend");
                    if let Ok(fallback) = "http://tauri.localhost/".parse::<tauri::Url>() {
                        let _ = window.navigate(fallback);
                    }
                }
            }
        }
    }
}
pub(crate) fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if matches!(event, tauri::WindowEvent::Focused(_) | tauri::WindowEvent::ThemeChanged(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
        #[cfg(windows)] if let (Ok(hwnd), Ok(colors)) = (window.hwnd(), window.state::<ChromeState>().0.lock()) { let _ = apply(hwnd.0, &colors, window.is_focused().unwrap_or(true)); }
    }
}
#[cfg(test)] mod tests {
    #[test] fn colorref_uses_windows_byte_order() { assert_eq!(super::color_ref([0x12,0x34,0x56]),0x563412); }
}
