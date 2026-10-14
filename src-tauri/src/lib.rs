mod autofill;
#[cfg(any(target_os = "macos", test))]
mod biometry_errors;
mod breach;
mod importers;
#[cfg(target_os = "macos")]
mod macos_biometry;
mod screen_protection;
mod share;
mod store;
mod system_lock;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime},
};

use autofill::{AutofillRuntime, AutofillStatus};
use base64::{engine::general_purpose::STANDARD, Engine};
use importers::{ImportCandidate, DEFAULT_IMPORT_CATEGORY};
use screen_protection::{ScreenProtectionRuntime, ScreenProtectionStatus};
use system_lock::{SystemLockConfig, SystemLockRuntime, SystemLockStatus};

const BROWSER_EXTENSION_ENABLED: bool = true;
use hmac::{Hmac, Mac};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use store::{ActivityRecord, AuthStatus, CategoryMap, PasswordEntry, PasswordStore, TrashRecord};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_biometry::{
    BiometryExt, DataOptions, GetDataOptions, SetDataOptions, Status as BiometryStatus,
};
use url::Url;

#[cfg(not(target_os = "macos"))]
const BIOMETRY_DOMAIN: &str = "clave";
#[cfg(not(target_os = "macos"))]
const BIOMETRY_MASTER_PASSWORD_NAME: &str = "master-password";

struct AppState {
    store: Arc<Mutex<PasswordStore>>,
}

#[tauri::command]
fn autofill_status(state: State<AutofillRuntime>) -> Result<AutofillStatus, String> {
    state.status()
}

#[tauri::command]
fn set_autofill_enabled(
    state: State<AutofillRuntime>,
    enabled: bool,
) -> Result<AutofillStatus, String> {
    state.set_enabled(enabled)
}

#[tauri::command]
fn rotate_autofill_token(state: State<AutofillRuntime>) -> Result<AutofillStatus, String> {
    state.rotate_token()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BiometryUiStatus {
    is_available: bool,
    is_enabled: bool,
    biometry_type: String,
    error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SiteIcon {
    icon_url: String,
    source: String,
    fallback_label: String,
}

const ICON_MAX_BYTES: usize = 160 * 1024;
const ICON_CACHE_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
static ICON_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[cfg(not(target_os = "macos"))]
fn biometry_data_options() -> DataOptions {
    DataOptions {
        domain: BIOMETRY_DOMAIN.to_string(),
        name: BIOMETRY_MASTER_PASSWORD_NAME.to_string(),
    }
}

#[cfg(not(target_os = "macos"))]
fn biometry_type_label(status: &BiometryStatus) -> String {
    format!("{:?}", status.biometry_type)
}

#[cfg(not(target_os = "macos"))]
fn map_biometry_status(app: &AppHandle) -> Result<BiometryUiStatus, String> {
    let status = app.biometry().status().map_err(|error| error.to_string())?;
    let is_enabled = app
        .biometry()
        .has_data(biometry_data_options())
        .unwrap_or(false);

    Ok(BiometryUiStatus {
        is_available: status.is_available,
        is_enabled,
        biometry_type: biometry_type_label(&status),
        error: status.error,
    })
}

#[tauri::command]
fn auth_status(state: State<AppState>) -> Result<AuthStatus, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .auth_status())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn biometrie_status(app: AppHandle) -> Result<BiometryUiStatus, String> {
    map_biometry_status(&app)
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn biometrie_status() -> Result<BiometryUiStatus, String> {
    Ok(macos_biometry::status())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn activer_biometrie(
    app: AppHandle,
    state: State<AppState>,
    password: String,
) -> Result<BiometryUiStatus, String> {
    if password.trim().len() < 8 {
        return Err("Mot de passe maitre invalide.".to_string());
    }

    {
        let mut store = state
            .store
            .lock()
            .map_err(|_| "Le coffre est indisponible.".to_string())?;
        store
            .unlock(password.clone())
            .map_err(|error| error.to_string())?;
    }

    let status = app.biometry().status().map_err(|error| error.to_string())?;
    if !status.is_available {
        return Err(status
            .error
            .unwrap_or_else(|| "Biometrie indisponible sur cet appareil.".to_string()));
    }

    app.biometry()
        .set_data(SetDataOptions {
            domain: BIOMETRY_DOMAIN.to_string(),
            name: BIOMETRY_MASTER_PASSWORD_NAME.to_string(),
            data: password,
        })
        .map_err(|error| error.to_string())?;

    map_biometry_status(&app)
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn activer_biometrie(state: State<AppState>, password: String) -> Result<BiometryUiStatus, String> {
    if password.trim().len() < 8 {
        return Err("Mot de passe maitre invalide.".to_string());
    }

    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .unlock(password.clone())
        .map_err(|error| error.to_string())?;

    macos_biometry::store_password(&password)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn desactiver_biometrie(app: AppHandle) -> Result<BiometryUiStatus, String> {
    app.biometry()
        .remove_data(biometry_data_options())
        .map_err(|error| error.to_string())?;
    map_biometry_status(&app)
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn desactiver_biometrie() -> Result<BiometryUiStatus, String> {
    macos_biometry::remove_password()
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn deverrouiller_biometrie(app: AppHandle, state: State<AppState>) -> Result<AuthStatus, String> {
    let data = app
        .biometry()
        .get_data(GetDataOptions {
            domain: BIOMETRY_DOMAIN.to_string(),
            name: BIOMETRY_MASTER_PASSWORD_NAME.to_string(),
            reason: "Deverrouiller Clave".to_string(),
            cancel_title: Some("Annuler".to_string()),
        })
        .map_err(|error| error.to_string())?;

    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    store.unlock(data.data).map_err(|error| error.to_string())?;
    Ok(store.auth_status())
}

#[tauri::command]
#[cfg(target_os = "macos")]
async fn deverrouiller_biometrie(state: State<'_, AppState>) -> Result<AuthStatus, String> {
    let password = tauri::async_runtime::spawn_blocking(macos_biometry::load_password)
        .await
        .map_err(|_| "L’authentification Touch ID a été interrompue.".to_string())??;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    store.unlock(password).map_err(|error| error.to_string())?;
    Ok(store.auth_status())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupResult {
    #[serde(flatten)]
    status: AuthStatus,
    recovery_key: String,
}

#[tauri::command]
fn setup_master_password(state: State<AppState>, password: String) -> Result<SetupResult, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    let recovery_key = store
        .setup_master_password(password)
        .map_err(|error| error.to_string())?;
    Ok(SetupResult {
        status: store.auth_status(),
        recovery_key,
    })
}

#[tauri::command]
fn creer_cle_recuperation(state: State<AppState>, password: String) -> Result<String, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .create_recovery_key(password)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recuperer_coffre(
    app: AppHandle,
    state: State<AppState>,
    cle_recuperation: String,
    nouveau_password: String,
) -> Result<AuthStatus, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    store
        .recover_with_key(cle_recuperation, nouveau_password)
        .map_err(|error| error.to_string())?;
    let status = store.auth_status();
    drop(store);

    // Le déverrouillage biométrique conserve l'ancien mot de passe : il devient invalide.
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let _ = macos_biometry::remove_password();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app.biometry().remove_data(biometry_data_options());

    Ok(status)
}

#[tauri::command]
async fn verifier_fuites(state: State<'_, AppState>) -> Result<breach::BreachReport, String> {
    let categories = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .load()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        breach::check_categories(&categories, breach::cached_range)
    })
    .await
    .map_err(|_| "La vérification a été interrompue.".to_string())?
}

#[tauri::command]
async fn partager_acces(
    state: State<'_, AppState>,
    categorie: String,
    index: usize,
    serveur: String,
    options: share::ShareOptions,
) -> Result<share::ShareLink, String> {
    let entry = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .load()
        .map_err(|error| error.to_string())?
        .get(&categorie)
        .and_then(|entries| entries.get(index))
        .cloned()
        .ok_or_else(|| "Accès introuvable.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || share::share_entry(&serveur, &entry, options))
        .await
        .map_err(|_| "Le partage a été interrompu.".to_string())?
}

#[tauri::command]
fn protection_ecran_status(state: State<ScreenProtectionRuntime>) -> ScreenProtectionStatus {
    state.status()
}

#[tauri::command]
fn definir_protection_ecran(
    app: AppHandle,
    state: State<ScreenProtectionRuntime>,
    enabled: bool,
) -> Result<ScreenProtectionStatus, String> {
    state.set_enabled(&app, enabled)
}

/// Adresse de la page de changement de mot de passe d'un site (W3C
/// `/.well-known/change-password`), ou sa page d'accueil si le site ne la propose pas.
#[tauri::command]
async fn url_changement_mot_de_passe(site: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = Client::builder()
            .timeout(Duration::from_secs(6))
            .user_agent("Clave-password-manager")
            .build()
            .map_err(|error| format!("Client HTTP indisponible: {error}"))?;
        resolve_change_password_url(&site, |url| {
            client
                .get(url)
                .send()
                .ok()
                .map(|response| response.status().as_u16())
        })
    })
    .await
    .map_err(|error| format!("Recherche de la page impossible: {error}"))?
}

fn resolve_change_password_url(
    site: &str,
    status_of: impl Fn(&str) -> Option<u16>,
) -> Result<String, String> {
    let normalized = normalize_site_input(site)?;
    if normalized.is_empty() {
        return Err("Aucun site web n’est associé à cet accès.".to_string());
    }
    let url = Url::parse(&normalized).map_err(|_| "Adresse du site invalide.".to_string())?;
    if url.host_str().is_none() || !matches!(url.scheme(), "http" | "https") {
        return Err("Adresse du site invalide.".to_string());
    }
    let origin = url.origin().ascii_serialization();
    let well_known = format!("{origin}/.well-known/change-password");

    // Un site qui répond 200 à n'importe quelle adresse ne prouve rien :
    // la spécification recommande de sonder une ressource qui ne doit pas exister.
    let supports = matches!(status_of(&well_known), Some(200..=299))
        && !matches!(
            status_of(&format!(
                "{origin}/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200"
            )),
            Some(200..=299)
        );
    Ok(if supports {
        well_known
    } else {
        format!("{origin}/")
    })
}

#[tauri::command]
fn verrouillage_systeme_status(
    state: State<SystemLockRuntime>,
) -> Result<SystemLockStatus, String> {
    state.status()
}

#[tauri::command]
fn definir_verrouillage_systeme(
    state: State<SystemLockRuntime>,
    on_session_lock: bool,
    on_sleep: bool,
) -> Result<SystemLockStatus, String> {
    state.set_config(SystemLockConfig {
        on_session_lock,
        on_sleep,
    })
}

#[tauri::command]
fn unlock(state: State<AppState>, password: String) -> Result<AuthStatus, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store.unlock(password).map_err(|error| error.to_string())?;
    Ok(store.auth_status())
}

#[tauri::command]
fn changer_mot_de_passe_maitre(
    state: State<AppState>,
    ancien_password: String,
    nouveau_password: String,
) -> Result<AuthStatus, String> {
    #[cfg(target_os = "macos")]
    let touch_id_was_enabled = macos_biometry::is_enabled();
    #[cfg(target_os = "macos")]
    let touch_id_password = nouveau_password.clone();

    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .change_master_password(ancien_password, nouveau_password)
        .map_err(|error| error.to_string())?;
    let auth_status = store.auth_status();
    drop(store);

    #[cfg(target_os = "macos")]
    if touch_id_was_enabled && macos_biometry::store_password(&touch_id_password).is_err() {
        let _ = macos_biometry::remove_password();
    }

    Ok(auth_status)
}

#[tauri::command]
fn lock(state: State<AppState>) -> Result<AuthStatus, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store.lock();
    Ok(store.auth_status())
}

#[tauri::command]
fn charger(state: State<AppState>) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .load()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ajouter(
    state: State<AppState>,
    categorie: String,
    plateforme: String,
    email: String,
    mdp: String,
    site: String,
    notes: String,
    totp_secret: String,
    icon_url: String,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .add_password(
            categorie,
            PasswordEntry {
                plateforme,
                email,
                mdp,
                site,
                notes,
                totp_secret,
                icon_url,
                tags: tags.unwrap_or_default(),
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn modifier(
    state: State<AppState>,
    categorie: String,
    index: usize,
    plateforme: String,
    email: String,
    mdp: String,
    site: String,
    notes: String,
    totp_secret: String,
    icon_url: String,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .update_password(
            categorie,
            index,
            PasswordEntry {
                plateforme,
                email,
                mdp,
                site,
                notes,
                totp_secret,
                icon_url,
                tags: tags.unwrap_or_default(),
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn supprimer_acces(
    state: State<AppState>,
    categorie: String,
    index: usize,
) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .delete_password(categorie, index)
        .map_err(|error| error.to_string())?;
    store.load().map_err(|error| error.to_string())
}

#[tauri::command]
fn fusionner_doublons(
    state: State<AppState>,
    categorie_gardee: String,
    index_garde: usize,
    categorie_retiree: String,
    index_retire: usize,
) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    store
        .merge_duplicates(
            categorie_gardee,
            index_garde,
            categorie_retiree,
            index_retire,
        )
        .map_err(|error| error.to_string())?;
    store.load().map_err(|error| error.to_string())
}

#[tauri::command]
fn ajouter_categorie(state: State<AppState>, categorie: String) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .add_category(categorie)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn renommer_categorie(
    state: State<AppState>,
    ancien_nom: String,
    nouveau_nom: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .rename_category(ancien_nom, nouveau_nom)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn supprimer_categorie(state: State<AppState>, categorie: String) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .delete_category(categorie)
        .map_err(|error| error.to_string())?;
    store.load().map_err(|error| error.to_string())
}

#[tauri::command]
fn generer() -> String {
    PasswordStore::generate_password()
}

#[tauri::command]
fn charger_historique(state: State<AppState>) -> Result<Vec<ActivityRecord>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .history()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn charger_corbeille(state: State<AppState>) -> Result<Vec<TrashRecord>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .trash()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn restaurer_corbeille(state: State<AppState>, index: usize) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .restore_trash(index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn vider_corbeille(state: State<AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .empty_trash()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn supprimer_corbeille(state: State<AppState>, index: usize) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .delete_trash(index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn restaurer_historique(state: State<AppState>, index: usize) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .restore_history(index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn definir_favori(
    state: State<AppState>,
    categorie: String,
    index: usize,
    favorite: bool,
) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .set_favorite(categorie, index, favorite)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn marquer_consulte(state: State<AppState>, categorie: String, index: usize) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .mark_accessed(categorie, index)
        .map_err(|e| e.to_string())
}

fn fallback_label(site: &str) -> String {
    let host = Url::parse(site)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_string()))
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_string();
    let label_source = host.split('.').next().unwrap_or("??");
    let label: String = label_source
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(2)
        .collect::<String>()
        .to_uppercase();
    if label.is_empty() {
        "??".to_string()
    } else {
        label
    }
}

fn normalize_site_input(site: &str) -> Result<String, String> {
    let compact: String = site.trim().chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return Ok(String::new());
    }

    let has_scheme = compact.starts_with("http://") || compact.starts_with("https://");
    let host_candidate = if has_scheme {
        compact
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(compact.as_str())
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
    } else {
        compact.split(['/', '?', '#']).next().unwrap_or_default()
    }
    .to_string();
    let add_common_tld = !has_scheme
        && host_candidate.len() >= 2
        && host_candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !host_candidate.contains('.')
        && !host_candidate.contains(':')
        && !host_candidate.eq_ignore_ascii_case("localhost");

    let mut candidate = if has_scheme {
        compact
    } else {
        format!("https://{compact}")
    };
    if add_common_tld {
        candidate = candidate.replacen(&host_candidate, &format!("{host_candidate}.com"), 1);
    }

    let url = Url::parse(&candidate).map_err(|_| "Adresse du site invalide.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Adresse du site invalide.".to_string());
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

#[tauri::command]
fn resoudre_icone_site(
    app: AppHandle,
    site: String,
    service: Option<String>,
) -> Result<SiteIcon, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("favicon-cache"));
    resolve_site_icon_with_cache(&site, service.as_deref().unwrap_or_default(), cache_dir)
}

fn resolve_site_icon_with_cache(
    site: &str,
    service: &str,
    cache_dir: Option<PathBuf>,
) -> Result<SiteIcon, String> {
    let normalized = normalize_site_input(&site)?;
    if normalized.is_empty() {
        return Ok(SiteIcon {
            icon_url: String::new(),
            source: "fallback".to_string(),
            fallback_label: "??".to_string(),
        });
    }

    let url = Url::parse(&normalized).map_err(|_| "Adresse du site invalide.".to_string())?;
    if url.host_str().is_none() {
        return Err("Adresse du site invalide.".to_string());
    }
    let origin = url.origin().ascii_serialization();

    let fallback_label = fallback_label(origin.as_str());
    let mut candidates = brand_icon_urls(service, url.host_str().unwrap_or_default());
    candidates.extend(discover_page_icon_urls(&origin));
    candidates.push(format!("{origin}/favicon.ico"));
    candidates.dedup();

    let mut icon_url = String::new();
    let mut source = "fallback";
    for candidate in candidates {
        let resolved = cached_icon_data_url(&candidate, cache_dir.clone());
        if !resolved.is_empty() {
            icon_url = resolved;
            source = if candidate.contains("cdn.simpleicons.org") {
                "brand"
            } else {
                "favicon"
            };
            break;
        }
    }

    Ok(SiteIcon {
        icon_url,
        source: source.to_string(),
        fallback_label,
    })
}

fn icon_slug(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn brand_icon_urls(service: &str, host: &str) -> Vec<String> {
    let words: Vec<String> = service
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(icon_slug)
        .collect();
    let mut slugs = Vec::new();
    let service_slug = words.join("");
    if !service_slug.is_empty() {
        slugs.push(service_slug);
        if let Some(last) = words.last() {
            if !last.ends_with('s') {
                let mut plural = words[..words.len().saturating_sub(1)].join("");
                plural.push_str(last);
                plural.push('s');
                slugs.push(plural);
            }
        }
    }
    let host_slug = icon_slug(
        host.trim_start_matches("www.")
            .split('.')
            .next()
            .unwrap_or_default(),
    );
    if !host_slug.is_empty() {
        slugs.push(host_slug);
    }
    slugs.sort();
    slugs.dedup();
    slugs
        .into_iter()
        .map(|slug| format!("https://cdn.simpleicons.org/{slug}?viewbox=auto"))
        .collect()
}

fn html_attribute(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let start = lower.find(attribute)? + attribute.len();
    let rest = tag.get(start..)?.trim_start();
    let rest = rest.strip_prefix('=')?.trim_start();
    let first = rest.chars().next()?;
    if first == '\'' || first == '"' {
        let value = &rest[first.len_utf8()..];
        return value.find(first).map(|end| value[..end].to_string());
    }
    let end = rest
        .find(|character: char| character.is_whitespace() || character == '>')
        .unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

fn extract_page_icon_urls(html: &str, origin: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let Ok(base) = Url::parse(origin) else {
        return Vec::new();
    };
    let mut cursor = 0;
    let mut icons = Vec::new();
    while let Some(relative_start) = lower[cursor..].find("<link") {
        let start = cursor + relative_start;
        let Some(relative_end) = lower[start..].find('>') else {
            break;
        };
        let end = start + relative_end + 1;
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        if html_attribute(tag_lower, "rel")
            .is_some_and(|rel| rel.split_whitespace().any(|value| value.contains("icon")))
        {
            if let Some(href) = html_attribute(tag, "href") {
                if let Ok(url) = base.join(&href) {
                    if matches!(url.scheme(), "http" | "https") {
                        icons.push(url.to_string());
                    }
                }
            }
        }
        cursor = end;
    }
    icons.dedup();
    icons
}

fn discover_page_icon_urls(origin: &str) -> Vec<String> {
    let client = match Client::builder()
        .timeout(Duration::from_millis(1800))
        .user_agent("Mozilla/5.0 Clave/0.3.1")
        .build()
    {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };
    let Ok(response) = client.get(origin).send() else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let Ok(bytes) = response.bytes() else {
        return Vec::new();
    };
    if bytes.is_empty() || bytes.len() > 512 * 1024 {
        return Vec::new();
    }
    let html = String::from_utf8_lossy(bytes.as_ref());
    extract_page_icon_urls(&html, origin)
}

fn cached_icon_data_url(url: &str, cache_dir: Option<PathBuf>) -> String {
    let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(icon_url) = guard.get(url) {
            return icon_url.clone();
        }
    }

    if let Some(cache_dir) = cache_dir.as_ref() {
        if let Some(icon_url) = read_cached_icon(cache_dir, url) {
            if !icon_url.is_empty() {
                if let Ok(mut guard) = cache.lock() {
                    guard.insert(url.to_string(), icon_url.clone());
                }
                return icon_url;
            }
        }
    }

    let icon_url = fetch_icon_data_url(url).unwrap_or_default();
    if !icon_url.is_empty() {
        if let Some(cache_dir) = cache_dir.as_ref() {
            write_cached_icon(cache_dir, url, &icon_url);
        }
        if let Ok(mut guard) = cache.lock() {
            guard.insert(url.to_string(), icon_url.clone());
        }
    }
    icon_url
}

fn cache_file_for(cache_dir: &std::path::Path, url: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    cache_dir.join(format!("{:x}.txt", hasher.finalize()))
}

fn read_cached_icon(cache_dir: &std::path::Path, url: &str) -> Option<String> {
    let file = cache_file_for(cache_dir, url);
    let metadata = std::fs::metadata(&file).ok()?;
    let modified = metadata.modified().ok()?;
    if SystemTime::now().duration_since(modified).ok()? > ICON_CACHE_MAX_AGE {
        let _ = std::fs::remove_file(file);
        return None;
    }
    let value = std::fs::read_to_string(file).ok()?;
    if value.is_empty() || (!value.starts_with("data:image/") && value != "fallback") {
        return None;
    }
    Some(if value == "fallback" {
        String::new()
    } else {
        value
    })
}

fn write_cached_icon(cache_dir: &std::path::Path, url: &str, icon_url: &str) {
    if std::fs::create_dir_all(cache_dir).is_err() {
        return;
    }
    let value = if icon_url.is_empty() {
        "fallback"
    } else {
        icon_url
    };
    let _ = std::fs::write(cache_file_for(cache_dir, url), value);
}

fn fetch_icon_data_url(url: &str) -> Option<String> {
    let client = Client::builder()
        .timeout(Duration::from_millis(1800))
        .user_agent("Clave/0.3.1")
        .build()
        .ok()?;
    let response = client.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/x-icon")
        .split(';')
        .next()
        .unwrap_or("image/x-icon")
        .trim()
        .to_string();
    if !content_type.starts_with("image/") {
        return None;
    }
    let bytes = response.bytes().ok()?;
    if bytes.is_empty() || bytes.len() > ICON_MAX_BYTES {
        return None;
    }
    icon_data_url(&content_type, bytes.as_ref())
}

fn icon_data_url(content_type: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > ICON_MAX_BYTES || !content_type.starts_with("image/") {
        return None;
    }
    Some(format!(
        "data:{};base64,{}",
        content_type,
        STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn previsualiser_import(csv_text: String) -> Result<Vec<ImportCandidate>, String> {
    importers::parse_import_file(&csv_text)
}

fn import_candidates(
    state: &State<AppState>,
    entries: Vec<ImportCandidate>,
) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    let items = entries
        .into_iter()
        .map(|candidate| {
            let categorie = candidate.categorie.trim();
            let categorie = if categorie.is_empty() {
                DEFAULT_IMPORT_CATEGORY.to_string()
            } else {
                categorie.to_string()
            };
            (categorie, candidate.entry)
        })
        .collect();
    store.add_passwords(items).map_err(|e| e.to_string())?;
    store.load().map_err(|e| e.to_string())
}

#[tauri::command]
fn importer_selection(
    state: State<AppState>,
    entries: Vec<ImportCandidate>,
) -> Result<CategoryMap, String> {
    import_candidates(&state, entries)
}

#[tauri::command]
fn importer_navigateur(state: State<AppState>, csv_text: String) -> Result<CategoryMap, String> {
    let entries = importers::parse_import_file(&csv_text)?;
    import_candidates(&state, entries)
}

#[derive(serde::Serialize)]
struct TotpCode {
    code: String,
    remaining: u64,
}

#[tauri::command]
fn generer_totp(secret: String) -> Result<TotpCode, String> {
    let normalized = normalize_totp_secret(&secret)?;
    let key = data_encoding::BASE32_NOPAD
        .decode(normalized.as_bytes())
        .map_err(|_| "Clé 2FA invalide.".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let counter = now / 30;
    let mut mac =
        Hmac::<Sha1>::new_from_slice(&key).map_err(|_| "Clé 2FA invalide.".to_string())?;
    mac.update(&counter.to_be_bytes());
    let bytes = mac.finalize().into_bytes();
    let offset = (bytes[19] & 0x0f) as usize;
    let value = (((bytes[offset] & 0x7f) as u32) << 24)
        | ((bytes[offset + 1] as u32) << 16)
        | ((bytes[offset + 2] as u32) << 8)
        | bytes[offset + 3] as u32;
    Ok(TotpCode {
        code: format!("{:06}", value % 1_000_000),
        remaining: 30 - now % 30,
    })
}

fn normalize_totp_secret(secret: &str) -> Result<String, String> {
    let raw = secret.trim();
    let value = if raw.to_ascii_lowercase().starts_with("otpauth://") {
        let url = Url::parse(raw).map_err(|_| "Clé 2FA invalide.".to_string())?;
        url.query_pairs()
            .find(|(key, _)| key.eq_ignore_ascii_case("secret"))
            .map(|(_, value)| value.to_string())
            .unwrap_or_default()
    } else {
        raw.to_string()
    };
    let normalized: String = value
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect();
    if normalized.is_empty() {
        Err("Clé 2FA invalide.".to_string())
    } else {
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        brand_icon_urls, extract_page_icon_urls, icon_data_url, normalize_site_input,
        normalize_totp_secret, read_cached_icon, resolve_change_password_url,
        resolve_site_icon_with_cache, should_keep_running_after_close, write_cached_icon,
    };

    #[test]
    fn closing_the_main_window_keeps_clave_running_for_autofill() {
        assert!(should_keep_running_after_close("main"));
        assert!(!should_keep_running_after_close("secondary"));
    }

    #[test]
    fn normalize_totp_secret_accepts_raw_secret_and_otpauth_uri() {
        assert_eq!(
            normalize_totp_secret(" jbsw y3dp ehpk 3pxp== ").unwrap(),
            "JBSWY3DPEHPK3PXP"
        );
        assert_eq!(
            normalize_totp_secret("otpauth://totp/Clave:test?secret=jbswy3dpehpk3pxp&issuer=Clave")
                .unwrap(),
            "JBSWY3DPEHPK3PXP"
        );
    }

    #[test]
    fn change_password_url_uses_well_known_when_supported() {
        let url = resolve_change_password_url("github.com/login", |url| {
            Some(if url.ends_with("/change-password") {
                200
            } else {
                404
            })
        })
        .unwrap();
        assert_eq!(url, "https://github.com/.well-known/change-password");
    }

    #[test]
    fn change_password_url_falls_back_to_homepage() {
        let missing =
            resolve_change_password_url("https://exemple.fr/compte", |_| Some(404)).unwrap();
        assert_eq!(missing, "https://exemple.fr/");

        let catch_all = resolve_change_password_url("exemple.fr", |_| Some(200)).unwrap();
        assert_eq!(catch_all, "https://exemple.fr/");

        let offline = resolve_change_password_url("exemple.fr", |_| None).unwrap();
        assert_eq!(offline, "https://exemple.fr/");

        assert!(resolve_change_password_url("  ", |_| Some(200)).is_err());
    }

    #[test]
    fn normalize_site_input_accepts_common_shorthand() {
        assert_eq!(
            normalize_site_input(" google.com ").unwrap(),
            "https://google.com"
        );
        assert_eq!(
            normalize_site_input("google").unwrap(),
            "https://google.com"
        );
        assert_eq!(
            normalize_site_input("www.exemple.fr/login").unwrap(),
            "https://www.exemple.fr/login"
        );
    }

    #[test]
    fn resolve_site_icon_uses_fallback_when_remote_icon_is_unavailable() {
        let icon = resolve_site_icon_with_cache("http://localhost:1", "", None).unwrap();

        assert_eq!(icon.icon_url, "");
        assert_eq!(icon.source, "fallback");
        assert_eq!(icon.fallback_label, "LO");
    }

    #[test]
    fn brand_icon_candidates_recover_the_epic_games_typo() {
        let candidates = brand_icon_urls("Epic Game", "www.epicgame.com");

        assert!(candidates.iter().any(|url| url.contains("/epicgames?")));
    }

    #[test]
    fn page_icon_discovery_supports_standard_and_apple_icons() {
        let html = r#"<html><head>
            <link rel="icon" href="/assets/favicon.png">
            <link href='https://cdn.example.com/touch.png' rel='apple-touch-icon'>
        </head></html>"#;

        assert_eq!(
            extract_page_icon_urls(html, "https://example.com"),
            vec![
                "https://example.com/assets/favicon.png",
                "https://cdn.example.com/touch.png",
            ]
        );
    }

    #[test]
    fn favicon_cache_persists_data_urls_on_disk() {
        let directory = tempfile::tempdir().unwrap();
        let url = "https://aternos.org/favicon.ico";
        let icon_url = "data:image/x-icon;base64,aWNv";

        write_cached_icon(directory.path(), url, icon_url);

        assert_eq!(read_cached_icon(directory.path(), url).unwrap(), icon_url);
    }

    #[test]
    fn icon_data_url_embeds_downloaded_favicon_bytes() {
        let url = icon_data_url("image/x-icon", b"ico").unwrap();

        assert_eq!(url, "data:image/x-icon;base64,aWNv");
    }
}

#[tauri::command]
fn exporter(state: State<AppState>, password: String) -> Result<String, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .export_backup(password)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn importer(
    state: State<AppState>,
    password: String,
    backup_json: String,
) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .import_backup(password, backup_json)
        .map_err(|error| error.to_string())
}

fn should_keep_running_after_close(window_label: &str) -> bool {
    window_label == "main"
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_biometry::init());

    builder
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Dossier de donnees introuvable: {error}"))?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|error| format!("Creation du dossier impossible: {error}"))?;

            let store = Arc::new(Mutex::new(PasswordStore::new(
                app_dir.join("passwords.json"),
                app_dir.join("secret.key"),
                app_dir.join("auth.json"),
            )));
            let autofill_runtime =
                AutofillRuntime::new(app_dir.join("autofill.json"), store.clone());
            if BROWSER_EXTENSION_ENABLED {
                autofill::start_server(autofill_runtime.clone(), app.handle().clone());
            }
            app.manage(AppState {
                store: store.clone(),
            });
            app.manage(autofill_runtime);

            let system_lock_runtime =
                SystemLockRuntime::new(app_dir.join("system_lock.json"), store.clone());
            system_lock::start(system_lock_runtime.clone(), app.handle().clone());
            app.manage(system_lock_runtime);

            let screen_protection =
                ScreenProtectionRuntime::new(app_dir.join("screen_protection.json"));
            if let Err(error) = screen_protection.apply(app.handle()) {
                eprintln!("{error}");
            }
            app.manage(screen_protection);

            let open_item = MenuItem::with_id(app, "open", "Ouvrir Clave", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter Clave", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Clave — coffre local")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if should_keep_running_after_close(window.label()) {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            biometrie_status,
            activer_biometrie,
            desactiver_biometrie,
            deverrouiller_biometrie,
            setup_master_password,
            creer_cle_recuperation,
            recuperer_coffre,
            unlock,
            changer_mot_de_passe_maitre,
            lock,
            charger,
            ajouter,
            modifier,
            supprimer_acces,
            fusionner_doublons,
            ajouter_categorie,
            renommer_categorie,
            supprimer_categorie,
            generer,
            charger_historique,
            charger_corbeille,
            restaurer_corbeille,
            vider_corbeille,
            supprimer_corbeille,
            restaurer_historique,
            definir_favori,
            marquer_consulte,
            resoudre_icone_site,
            previsualiser_import,
            importer_selection,
            importer_navigateur,
            generer_totp,
            exporter,
            importer,
            autofill_status,
            set_autofill_enabled,
            rotate_autofill_token,
            verifier_fuites,
            partager_acces,
            verrouillage_systeme_status,
            definir_verrouillage_systeme,
            protection_ecran_status,
            definir_protection_ecran,
            url_changement_mot_de_passe
        ])
        .run(tauri::generate_context!())
        .expect("erreur pendant l'execution de Clave");
}
