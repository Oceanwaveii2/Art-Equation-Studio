//! Machine preferences are separate from authored documents and save history.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
static WRITE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Preferences {
    #[serde(default = "english")] pub language: String,
    #[serde(default = "automatic")] pub native_backend: String,
    #[serde(default = "standard")] pub preparation_acceleration: String,
}
fn english() -> String { "en".into() }
fn standard() -> String { "standard".into() }
impl Default for Preferences { fn default()->Self { Self { language:english(),native_backend:automatic(),preparation_acceleration:standard() } } }
fn automatic() -> String { "auto".into() }
fn validate(p: &Preferences) -> Result<(), String> {
    if !["en", "zh-CN", "ja", "pt-BR", "pt-PT", "es"].contains(&p.language.as_str()) { return Err("Unsupported launch language".into()); }
    if !["auto", "dx12", "vulkan"].contains(&p.native_backend.as_str()) { return Err("Unsupported native backend".into()); }
    if !["standard", "cuda-dx12", "cuda-dx12-upload"].contains(&p.preparation_acceleration.as_str()) { return Err("Unsupported preparation acceleration".into()); }
    Ok(())
}
pub(crate) fn read() -> Preferences {
    let default = Preferences::default();
    super::resolve_workspace_root().ok().and_then(|root| std::fs::read(root.join("launch-preferences.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok()).filter(|p| validate(p).is_ok()).unwrap_or(default)
}
#[tauri::command]
pub(crate) fn get_launch_preferences() -> Preferences { read() }
#[tauri::command]
pub(crate) fn set_launch_preferences(preferences: Preferences) -> Result<Preferences, String> {
    validate(&preferences)?;
    let _guard = WRITE_LOCK.lock().map_err(|_| "Launch preference write unavailable")?;
    let root = super::resolve_workspace_root()?;
    super::atomic_write(&root.join("launch-preferences.json"), &serde_json::to_vec_pretty(&preferences).map_err(|e| e.to_string())?)?;
    Ok(preferences)
}
#[cfg(test)] mod tests {
    #[test] fn reject_invalid_preferences() {
        assert!(super::validate(&super::Preferences { language: "ja".into(), native_backend: "dx12".into(),..Default::default() }).is_ok());
        assert!(super::validate(&super::Preferences { language: "en".into(), native_backend: "cuda".into(),..Default::default() }).is_err());
        assert!(super::validate(&super::Preferences { language: "unknown".into(), native_backend: "auto".into(),..Default::default() }).is_err());
    }
}
