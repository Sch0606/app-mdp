//! Masquage de la fenêtre dans les captures d'écran et les partages d'écran.
//!
//! S'appuie sur `WebviewWindow::set_content_protected` de Tauri :
//! - Windows : `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` ;
//! - macOS : `NSWindow.sharingType = .none`.
//!
//! Le réglage est conservé hors du coffre pour être appliqué dès le démarrage,
//! avant même le déverrouillage.

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenProtectionConfig {
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

impl Default for ScreenProtectionConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenProtectionStatus {
    pub supported: bool,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct ScreenProtectionRuntime {
    config_path: PathBuf,
    config: Arc<Mutex<ScreenProtectionConfig>>,
}

pub fn is_supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

impl ScreenProtectionRuntime {
    pub fn new(config_path: PathBuf) -> Self {
        let config = fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            config_path,
            config: Arc::new(Mutex::new(config)),
        }
    }

    fn config(&self) -> ScreenProtectionConfig {
        self.config.lock().map(|config| *config).unwrap_or_default()
    }

    pub fn status(&self) -> ScreenProtectionStatus {
        ScreenProtectionStatus {
            supported: is_supported(),
            enabled: self.config().enabled,
        }
    }

    /// Applique le réglage courant à toutes les fenêtres de l'application.
    pub fn apply(&self, app: &AppHandle) -> Result<(), String> {
        let enabled = is_supported() && self.config().enabled;
        for window in app.webview_windows().values() {
            window
                .set_content_protected(enabled)
                .map_err(|error| format!("Protection de la fenêtre impossible: {error}"))?;
        }
        Ok(())
    }

    pub fn set_enabled(
        &self,
        app: &AppHandle,
        enabled: bool,
    ) -> Result<ScreenProtectionStatus, String> {
        let next = ScreenProtectionConfig { enabled };
        let raw = serde_json::to_string_pretty(&next)
            .map_err(|error| format!("Réglage illisible: {error}"))?;
        fs::write(&self.config_path, raw)
            .map_err(|error| format!("Enregistrement du réglage impossible: {error}"))?;
        if let Ok(mut config) = self.config.lock() {
            *config = next;
        }
        self.apply(app)?;
        Ok(self.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protection_is_enabled_by_default_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("screen_protection.json");
        assert!(ScreenProtectionRuntime::new(path.clone()).config().enabled);

        fs::write(&path, r#"{"enabled":false}"#).unwrap();
        assert!(!ScreenProtectionRuntime::new(path.clone()).config().enabled);

        fs::write(&path, "{}").unwrap();
        assert!(ScreenProtectionRuntime::new(path).config().enabled);
    }
}
