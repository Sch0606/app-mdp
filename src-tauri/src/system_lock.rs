//! Verrouillage du coffre sur les événements système.
//!
//! - Windows : verrouillage de session (Win+L), mise en veille et fermeture du capot,
//!   reçus par une fenêtre invisible dédiée (`WM_WTSSESSION_CHANGE`, `WM_POWERBROADCAST`).
//! - macOS : notifications `NSWorkspace` (veille, mise en veille de l'écran,
//!   changement de session) et `com.apple.screenIsLocked`.
//!
//! Le coffre est verrouillé côté Rust, puis l'interface est prévenue par l'événement
//! `system-locked` pour effacer son état.

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::store::PasswordStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LockReason {
    SessionLock,
    Sleep,
    LidClosed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemLockConfig {
    #[serde(default = "enabled_by_default")]
    pub on_session_lock: bool,
    #[serde(default = "enabled_by_default")]
    pub on_sleep: bool,
}

fn enabled_by_default() -> bool {
    true
}

impl Default for SystemLockConfig {
    fn default() -> Self {
        Self {
            on_session_lock: true,
            on_sleep: true,
        }
    }
}

impl SystemLockConfig {
    pub fn applies_to(&self, reason: LockReason) -> bool {
        match reason {
            LockReason::SessionLock => self.on_session_lock,
            LockReason::Sleep | LockReason::LidClosed => self.on_sleep,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLockStatus {
    pub supported: bool,
    #[serde(flatten)]
    pub config: SystemLockConfig,
}

#[derive(Clone)]
pub struct SystemLockRuntime {
    config_path: PathBuf,
    config: Arc<Mutex<SystemLockConfig>>,
    store: Arc<Mutex<PasswordStore>>,
}

impl SystemLockRuntime {
    pub fn new(config_path: PathBuf, store: Arc<Mutex<PasswordStore>>) -> Self {
        let config = fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            config_path,
            config: Arc::new(Mutex::new(config)),
            store,
        }
    }

    pub fn status(&self) -> Result<SystemLockStatus, String> {
        Ok(SystemLockStatus {
            supported: cfg!(any(target_os = "windows", target_os = "macos")),
            config: *self.config.lock().map_err(|_| "Réglage indisponible.")?,
        })
    }

    pub fn set_config(&self, config: SystemLockConfig) -> Result<SystemLockStatus, String> {
        *self.config.lock().map_err(|_| "Réglage indisponible.")? = config;
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let raw = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
        fs::write(&self.config_path, raw).map_err(|error| error.to_string())?;
        self.status()
    }

    /// Verrouille si le réglage correspondant est actif. Renvoie `true` si le coffre
    /// était ouvert et vient d'être fermé.
    pub fn handle(&self, reason: LockReason) -> bool {
        let applies = self
            .config
            .lock()
            .map(|config| config.applies_to(reason))
            .unwrap_or(true);
        if !applies {
            return false;
        }
        let Ok(mut store) = self.store.lock() else {
            return false;
        };
        let was_unlocked = store.auth_status().unlocked;
        store.lock();
        was_unlocked
    }
}

fn on_system_event(runtime: &SystemLockRuntime, app: &AppHandle, reason: LockReason) {
    if runtime.handle(reason) {
        let _ = app.emit("system-locked", reason);
    }
}

/// Démarre l'écoute. Doit être appelé depuis `setup` (thread principal sur macOS).
pub fn start(runtime: SystemLockRuntime, app: AppHandle) {
    #[cfg(target_os = "windows")]
    windows::start(runtime, app);
    #[cfg(target_os = "macos")]
    macos::start(runtime, app);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = (runtime, app);
}

#[cfg(target_os = "windows")]
mod windows {
    use std::sync::OnceLock;

    use tauri::AppHandle;
    use windows_sys::{
        core::GUID,
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, WPARAM},
            System::{
                LibraryLoader::GetModuleHandleW,
                Power::{RegisterPowerSettingNotification, POWERBROADCAST_SETTING},
                RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION},
                SystemServices::GUID_LIDSWITCH_STATE_CHANGE,
            },
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
                TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMSUSPEND,
                PBT_POWERSETTINGCHANGE, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW,
                WS_OVERLAPPED, WTS_SESSION_LOCK,
            },
        },
    };

    use super::{on_system_event, LockReason, SystemLockRuntime};

    static HANDLER: OnceLock<(SystemLockRuntime, AppHandle)> = OnceLock::new();

    fn same_guid(left: &GUID, right: &GUID) -> bool {
        left.data1 == right.data1
            && left.data2 == right.data2
            && left.data3 == right.data3
            && left.data4 == right.data4
    }

    fn dispatch(reason: LockReason) {
        if let Some((runtime, app)) = HANDLER.get() {
            on_system_event(runtime, app, reason);
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_WTSSESSION_CHANGE if wparam as u32 == WTS_SESSION_LOCK => {
                dispatch(LockReason::SessionLock);
                0
            }
            WM_POWERBROADCAST => {
                if wparam as u32 == PBT_APMSUSPEND {
                    dispatch(LockReason::Sleep);
                } else if wparam as u32 == PBT_POWERSETTINGCHANGE && lparam != 0 {
                    let setting = &*(lparam as *const POWERBROADCAST_SETTING);
                    // Données : 0 = capot fermé, 1 = capot ouvert.
                    if same_guid(&setting.PowerSetting, &GUID_LIDSWITCH_STATE_CHANGE)
                        && setting.DataLength >= 1
                        && setting.Data[0] == 0
                    {
                        dispatch(LockReason::LidClosed);
                    }
                }
                1
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn start(runtime: SystemLockRuntime, app: AppHandle) {
        if HANDLER.set((runtime, app)).is_err() {
            return;
        }
        std::thread::Builder::new()
            .name("clave-system-lock".into())
            .spawn(|| unsafe {
                let class_name = wide("ClaveSystemLockWatcher");
                let instance = GetModuleHandleW(std::ptr::null());
                let class = WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance,
                    lpszClassName: class_name.as_ptr(),
                    ..std::mem::zeroed()
                };
                RegisterClassW(&class);
                // Fenêtre de premier niveau jamais affichée : les fenêtres « message-only »
                // ne reçoivent pas les diffusions WM_POWERBROADCAST.
                let hwnd = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    class_name.as_ptr(),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                if hwnd.is_null() {
                    return;
                }
                WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
                RegisterPowerSettingNotification(
                    hwnd,
                    &GUID_LIDSWITCH_STATE_CHANGE,
                    DEVICE_NOTIFY_WINDOW_HANDLE,
                );

                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            })
            .ok();
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceScreensDidSleepNotification,
        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSDistributedNotificationCenter, NSNotification, NSString};
    use tauri::AppHandle;

    use super::{on_system_event, LockReason, SystemLockRuntime};

    pub fn start(runtime: SystemLockRuntime, app: AppHandle) {
        let observe = |reason: LockReason| {
            let runtime = runtime.clone();
            let app = app.clone();
            RcBlock::new(move |_notification: NonNull<NSNotification>| {
                on_system_event(&runtime, &app, reason);
            })
        };

        let workspace_center = NSWorkspace::sharedWorkspace().notificationCenter();
        let distributed_center = NSDistributedNotificationCenter::defaultCenter();
        let screen_locked = NSString::from_str("com.apple.screenIsLocked");

        unsafe {
            let observers = [
                workspace_center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceWillSleepNotification),
                    None,
                    None,
                    &observe(LockReason::Sleep),
                ),
                workspace_center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceScreensDidSleepNotification),
                    None,
                    None,
                    &observe(LockReason::Sleep),
                ),
                workspace_center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceSessionDidResignActiveNotification),
                    None,
                    None,
                    &observe(LockReason::SessionLock),
                ),
                distributed_center.addObserverForName_object_queue_usingBlock(
                    Some(&screen_locked),
                    None,
                    None,
                    &observe(LockReason::SessionLock),
                ),
            ];
            // Les observateurs vivent aussi longtemps que l'application.
            std::mem::forget(observers);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(dir: &std::path::Path) -> (SystemLockRuntime, Arc<Mutex<PasswordStore>>) {
        let store = Arc::new(Mutex::new(PasswordStore::new(
            dir.join("passwords.json"),
            dir.join("secret.key"),
            dir.join("auth.json"),
        )));
        store
            .lock()
            .unwrap()
            .setup_master_password("mot-de-passe-solide".into())
            .unwrap();
        (
            SystemLockRuntime::new(dir.join("system_lock.json"), store.clone()),
            store,
        )
    }

    #[test]
    fn system_events_lock_the_vault_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let (runtime, store) = runtime(dir.path());
        assert!(runtime.status().unwrap().config.on_sleep);

        assert!(runtime.handle(LockReason::LidClosed));
        assert!(!store.lock().unwrap().auth_status().unlocked);
        // Déjà verrouillé : pas de nouvel événement.
        assert!(!runtime.handle(LockReason::Sleep));
    }

    #[test]
    fn disabled_reasons_keep_the_vault_open_and_config_persists() {
        let dir = tempfile::tempdir().unwrap();
        let (runtime, store) = runtime(dir.path());
        runtime
            .set_config(SystemLockConfig {
                on_session_lock: false,
                on_sleep: true,
            })
            .unwrap();

        assert!(!runtime.handle(LockReason::SessionLock));
        assert!(store.lock().unwrap().auth_status().unlocked);

        let reloaded = SystemLockRuntime::new(dir.path().join("system_lock.json"), store);
        assert!(!reloaded.status().unwrap().config.on_session_lock);
        assert!(reloaded.status().unwrap().config.on_sleep);
    }
}
