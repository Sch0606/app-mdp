mod store;

use std::sync::Mutex;

use hmac::{Hmac, Mac};
use sha1::Sha1;
use store::{ActivityRecord, AuthStatus, CategoryMap, PasswordEntry, PasswordStore, TrashRecord};
use tauri::{AppHandle, Manager, State};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_biometry::{
    BiometryExt, DataOptions, GetDataOptions, SetDataOptions, Status as BiometryStatus,
};

#[cfg(not(target_os = "macos"))]
const BIOMETRY_DOMAIN: &str = "clave";
#[cfg(not(target_os = "macos"))]
const BIOMETRY_MASTER_PASSWORD_NAME: &str = "master-password";

struct AppState {
    store: Mutex<PasswordStore>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BiometryUiStatus {
    is_available: bool,
    is_enabled: bool,
    biometry_type: String,
    error: Option<String>,
}

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
    Ok(BiometryUiStatus {
        is_available: false,
        is_enabled: false,
        biometry_type: "macOS".to_string(),
        error: Some("Biometrie desactivee sur macOS.".to_string()),
    })
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
fn activer_biometrie(password: String) -> Result<BiometryUiStatus, String> {
    let _ = password;
    Err("Biometrie desactivee sur macOS.".to_string())
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
    biometrie_status()
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
fn deverrouiller_biometrie() -> Result<AuthStatus, String> {
    Err("Biometrie desactivee sur macOS.".to_string())
}

#[tauri::command]
fn setup_master_password(state: State<AppState>, password: String) -> Result<AuthStatus, String> {
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .setup_master_password(password)
        .map_err(|error| error.to_string())?;
    Ok(store.auth_status())
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
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .change_master_password(ancien_password, nouveau_password)
        .map_err(|error| error.to_string())?;
    Ok(store.auth_status())
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

fn parse_import(csv_text: &str) -> Result<Vec<PasswordEntry>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let find = |names: &[&str]| {
        headers
            .iter()
            .position(|h| names.iter().any(|n| h.trim().eq_ignore_ascii_case(n)))
    };
    let name_i = find(&["name", "title", "service", "folder"]);
    let url_i = find(&["url", "website", "origin", "login_uri", "login uri"]);
    let user_i = find(&["username", "user", "login", "identifiant", "login_username"]);
    let pass_i = find(&["password", "mot de passe", "login_password"])
        .ok_or("Colonne de mot de passe introuvable.")?;
    let mut entries = Vec::new();
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let get = |i: Option<usize>| i.and_then(|x| row.get(x)).unwrap_or("").trim().to_string();
        let entry = PasswordEntry {
            plateforme: get(name_i),
            email: get(user_i),
            mdp: row.get(pass_i).unwrap_or("").to_string(),
            site: get(url_i),
            ..Default::default()
        };
        if !entry.mdp.is_empty() || !entry.email.is_empty() {
            entries.push(entry);
        }
    }
    Ok(entries)
}

#[tauri::command]
fn previsualiser_import(csv_text: String) -> Result<Vec<PasswordEntry>, String> {
    parse_import(&csv_text)
}

#[tauri::command]
fn importer_selection(
    state: State<AppState>,
    entries: Vec<PasswordEntry>,
) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    for entry in entries {
        store
            .add_password("Import navigateur".into(), entry)
            .map_err(|e| e.to_string())?;
    }
    store.load().map_err(|e| e.to_string())
}

#[tauri::command]
fn importer_navigateur(state: State<AppState>, csv_text: String) -> Result<CategoryMap, String> {
    let entries = parse_import(&csv_text)?;
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;
    for entry in entries {
        store
            .add_password("Import navigateur".into(), entry)
            .map_err(|e| e.to_string())?;
    }
    store.load().map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct TotpCode {
    code: String,
    remaining: u64,
}

#[tauri::command]
fn generer_totp(secret: String) -> Result<TotpCode, String> {
    let normalized: String = secret
        .trim()
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect();
    let key = data_encoding::BASE32_NOPAD
        .decode(normalized.as_bytes())
        .map_err(|_| "Secret TOTP invalide.".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let counter = now / 30;
    let mut mac =
        Hmac::<Sha1>::new_from_slice(&key).map_err(|_| "Secret TOTP invalide.".to_string())?;
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

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
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

            app.manage(AppState {
                store: Mutex::new(PasswordStore::new(
                    app_dir.join("passwords.json"),
                    app_dir.join("secret.key"),
                    app_dir.join("auth.json"),
                )),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            biometrie_status,
            activer_biometrie,
            desactiver_biometrie,
            deverrouiller_biometrie,
            setup_master_password,
            unlock,
            changer_mot_de_passe_maitre,
            lock,
            charger,
            ajouter,
            modifier,
            supprimer_acces,
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
            previsualiser_import,
            importer_selection,
            importer_navigateur,
            generer_totp,
            exporter,
            importer
        ])
        .run(tauri::generate_context!())
        .expect("erreur pendant l'execution de Clave");
}
