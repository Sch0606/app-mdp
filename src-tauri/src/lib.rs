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
use url::Url;

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SiteIcon {
    icon_url: String,
    source: String,
    fallback_label: String,
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
    icon_url: String,
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
fn resoudre_icone_site(site: String) -> Result<SiteIcon, String> {
    let normalized = normalize_site_input(&site)?;
    if normalized.is_empty() {
        return Ok(SiteIcon {
            icon_url: String::new(),
            source: "fallback".to_string(),
            fallback_label: "??".to_string(),
        });
    }

    let url = Url::parse(&normalized).map_err(|_| "Adresse du site invalide.".to_string())?;
    let origin = format!(
        "{}://{}",
        url.scheme(),
        url.host_str()
            .ok_or_else(|| "Adresse du site invalide.".to_string())?
    );

    Ok(SiteIcon {
        icon_url: format!("{origin}/favicon.ico"),
        source: "favicon".to_string(),
        fallback_label: fallback_label(origin.as_str()),
    })
}

fn parse_import(csv_text: &str) -> Result<Vec<PasswordEntry>, String> {
    let delimiter = detect_import_delimiter(csv_text);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let find = |names: &[&str]| {
        let normalized_names: Vec<String> = names
            .iter()
            .map(|name| normalize_import_header(name))
            .collect();
        headers.iter().position(|h| {
            normalized_names
                .iter()
                .any(|n| normalize_import_header(h) == *n)
        })
    };
    let name_i = find(&[
        "name",
        "nom",
        "title",
        "titre",
        "service",
        "application",
        "app",
    ]);
    let url_i = find(&[
        "url",
        "website",
        "site",
        "site web",
        "origin",
        "origine",
        "login_uri",
        "login uri",
        "login_url",
        "website_url",
    ]);
    let user_i = find(&[
        "username",
        "user",
        "login",
        "identifiant",
        "nom d'utilisateur",
        "utilisateur",
        "email",
        "courriel",
        "login_username",
    ]);
    let pass_i = find(&["password", "mot de passe", "mdp", "pass", "login_password"])
        .ok_or("Colonne de mot de passe introuvable. Vérifiez que le fichier CSV vient bien d’un navigateur ou d’un gestionnaire compatible.")?;
    let notes_i = find(&["notes", "note", "commentaire", "comments"]);
    let totp_i = find(&[
        "totp",
        "otp",
        "otpauth",
        "otp_auth",
        "otp secret",
        "otpsecret",
        "login_totp",
        "login_otp",
        "2fa",
    ]);
    let mut entries = Vec::new();
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let get = |i: Option<usize>| i.and_then(|x| row.get(x)).unwrap_or("").trim().to_string();
        let site = get(url_i);
        let mut plateforme = get(name_i);
        if plateforme.is_empty() {
            plateforme = service_name_from_site(&site);
        }
        let entry = PasswordEntry {
            plateforme,
            email: get(user_i),
            mdp: row.get(pass_i).unwrap_or("").to_string(),
            site,
            notes: get(notes_i),
            totp_secret: get(totp_i),
            ..Default::default()
        };
        if !entry.mdp.is_empty() || !entry.email.is_empty() {
            entries.push(entry);
        }
    }
    Ok(entries)
}

fn detect_import_delimiter(csv_text: &str) -> u8 {
    let first_line = csv_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    let comma_count = first_line.matches(',').count();
    let semicolon_count = first_line.matches(';').count();
    let tab_count = first_line.matches('\t').count();

    if tab_count > comma_count && tab_count >= semicolon_count {
        b'\t'
    } else if semicolon_count > comma_count {
        b';'
    } else {
        b','
    }
}

fn normalize_import_header(value: &str) -> String {
    value
        .trim_start_matches('\u{feff}')
        .trim()
        .to_lowercase()
        .chars()
        .filter_map(|character| match character {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => Some('a'),
            'ç' => Some('c'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'í' | 'ì' | 'î' | 'ï' => Some('i'),
            'ñ' => Some('n'),
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => Some('o'),
            'ú' | 'ù' | 'û' | 'ü' => Some('u'),
            'ý' | 'ÿ' => Some('y'),
            c if c.is_ascii_alphanumeric() => Some(c),
            _ => None,
        })
        .collect()
}

fn service_name_from_site(site: &str) -> String {
    let normalized = normalize_site_input(site).unwrap_or_default();
    if normalized.is_empty() {
        return String::new();
    }

    Url::parse(&normalized)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.trim_start_matches("www.").to_string())
        })
        .unwrap_or_default()
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
    use super::{normalize_site_input, normalize_totp_secret, parse_import, resoudre_icone_site};

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
    fn resolve_site_icon_uses_normalized_origin() {
        let icon = resoudre_icone_site("google".to_string()).unwrap();

        assert_eq!(icon.icon_url, "https://google.com/favicon.ico");
        assert_eq!(icon.source, "favicon");
        assert_eq!(icon.fallback_label, "GO");
    }

    #[test]
    fn parse_import_accepts_french_chrome_headers_with_bom_and_semicolon() {
        let entries = parse_import(
            "\u{feff}nom;url;nom d'utilisateur;mot de passe\nGoogle;https://accounts.google.com;lea@example.fr;Secret-123!",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].plateforme, "Google");
        assert_eq!(entries[0].email, "lea@example.fr");
        assert_eq!(entries[0].mdp, "Secret-123!");
        assert_eq!(entries[0].site, "https://accounts.google.com");
    }

    #[test]
    fn parse_import_accepts_bitwarden_totp_columns() {
        let entries = parse_import(
            "folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\nPerso,false,login,GitHub,,,\"https://github.com\",dev@example.fr,Secret-456!,JBSWY3DPEHPK3PXP",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].plateforme, "GitHub");
        assert_eq!(entries[0].email, "dev@example.fr");
        assert_eq!(entries[0].site, "https://github.com");
        assert_eq!(entries[0].totp_secret, "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn parse_import_uses_url_host_when_name_is_missing() {
        let entries = parse_import(
            "url,username,password\nhttps://example.com/login,me@example.com,Secret-789!",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].plateforme, "example.com");
        assert_eq!(entries[0].email, "me@example.com");
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
            resoudre_icone_site,
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
