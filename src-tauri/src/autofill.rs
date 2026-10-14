use std::{
    fs,
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};

use rand::{distributions::Alphanumeric, rngs::OsRng, Rng};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use url::Url;

use crate::store::{CategoryMap, PasswordStore};

pub const AUTOFILL_PORT: u16 = 32191;
const MAX_BODY_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutofillAccount {
    pub category: String,
    pub index: usize,
    pub label: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AutofillCredential {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CandidateAction {
    Save,
    Update,
    Saved,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredentialCandidate {
    pub origin: String,
    pub username: String,
    pub password: String,
}

#[derive(Clone, Serialize)]
struct CandidateStatusResponse {
    action: CandidateAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutofillStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AutofillConfig {
    enabled: bool,
    token: String,
}

#[derive(Clone)]
pub struct AutofillRuntime {
    config_path: PathBuf,
    config: Arc<Mutex<AutofillConfig>>,
    store: Arc<Mutex<PasswordStore>>,
    running: Arc<AtomicBool>,
}

#[derive(Debug, Deserialize)]
struct OriginRequest {
    origin: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRequest {
    origin: String,
    category: String,
    index: usize,
}

#[derive(Serialize)]
struct ServerStatus {
    enabled: bool,
    unlocked: bool,
}

#[derive(Serialize)]
struct ErrorResponse<'a> {
    code: &'a str,
    message: &'a str,
}

fn fresh_token() -> String {
    OsRng
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

/// Hébergeurs partagés : chaque sous-domaine appartient à un propriétaire différent.
const SHARED_HOSTING_SUFFIXES: &[&str] = &[
    "github.io",
    "gitlab.io",
    "herokuapp.com",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "web.app",
    "firebaseapp.com",
    "appspot.com",
    "blogspot.com",
    "azurewebsites.net",
    "cloudfront.net",
    "onrender.com",
    "fly.dev",
];

/// Suffixes de second niveau courants des domaines nationaux (`co.uk`, `com.br`…).
const SECOND_LEVEL_LABELS: &[&str] = &[
    "ac", "co", "com", "edu", "gouv", "gov", "go", "ne", "net", "or", "org",
];

/// Services dont la connexion se fait sur un autre domaine que le service lui-même.
const SIGN_IN_ALIASES: &[(&str, &str)] = &[
    ("gmail.com", "google.com"),
    ("youtube.com", "google.com"),
    ("live.com", "microsoft.com"),
    ("outlook.com", "microsoft.com"),
    ("hotmail.com", "microsoft.com"),
    ("office.com", "microsoft.com"),
    ("microsoftonline.com", "microsoft.com"),
    ("icloud.com", "apple.com"),
];

fn normalized_host(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| "Origine invalide.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Origine non prise en charge.".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Domaine introuvable.".to_string())?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    Ok(host.strip_prefix("www.").unwrap_or(&host).to_string())
}

fn registrable_domain(host: &str) -> String {
    let is_ip = host.contains(':') || host.chars().all(|c| c.is_ascii_digit() || c == '.');
    let labels: Vec<&str> = host.split('.').collect();
    if is_ip || labels.len() < 2 {
        return host.to_string();
    }
    let keep = if let Some(suffix) = SHARED_HOSTING_SUFFIXES
        .iter()
        .find(|suffix| host == **suffix || host.ends_with(&format!(".{suffix}")))
    {
        suffix.split('.').count() + 1
    } else if labels.len() >= 3
        && labels[labels.len() - 1].len() == 2
        && SECOND_LEVEL_LABELS.contains(&labels[labels.len() - 2])
    {
        3
    } else {
        2
    };
    labels[labels.len().saturating_sub(keep)..].join(".")
}

fn site_key(host: &str) -> String {
    let domain = registrable_domain(host);
    SIGN_IN_ALIASES
        .iter()
        .find(|(alias, _)| *alias == domain)
        .map(|(_, canonical)| canonical.to_string())
        .unwrap_or(domain)
}

/// Un compte correspond au même hôte, ou au même domaine enregistrable
/// (`mail.google.com` ↔ `accounts.google.com`), jamais à un domaine voisin.
fn site_matches(entry_site: &str, requested_host: &str) -> bool {
    match normalized_host(entry_site) {
        Ok(entry_host) => {
            entry_host == requested_host || site_key(&entry_host) == site_key(requested_host)
        }
        Err(_) => false,
    }
}

pub fn matching_accounts(
    categories: &CategoryMap,
    origin: &str,
) -> Result<Vec<AutofillAccount>, String> {
    let requested_host = normalized_host(origin)?;
    let mut matches = Vec::new();

    for (category, entries) in categories {
        for (index, entry) in entries.iter().enumerate() {
            if entry.mdp.is_empty()
                || entry.site.trim().is_empty()
                || !site_matches(&entry.site, &requested_host)
            {
                continue;
            }
            let exact = normalized_host(&entry.site).ok().as_deref() == Some(&requested_host);
            matches.push((
                !exact,
                AutofillAccount {
                    category: category.clone(),
                    index,
                    label: entry.plateforme.clone(),
                    username: entry.email.clone(),
                },
            ));
        }
    }

    matches.sort_by_key(|(inexact, _)| *inexact);
    Ok(matches.into_iter().map(|(_, account)| account).collect())
}

pub fn matching_accounts_from_store(
    store: &Mutex<PasswordStore>,
    origin: &str,
) -> Result<Vec<AutofillAccount>, String> {
    let categories = store
        .lock()
        .map_err(|_| "unavailable".to_string())?
        .load()
        .map_err(|_| "locked".to_string())?;
    matching_accounts(&categories, origin)
}

pub fn credential_for(
    categories: &CategoryMap,
    origin: &str,
    category: &str,
    index: usize,
) -> Result<AutofillCredential, String> {
    let requested_host = normalized_host(origin)?;
    let entry = categories
        .get(category)
        .and_then(|entries| entries.get(index))
        .ok_or_else(|| "Compte introuvable.".to_string())?;
    if !site_matches(&entry.site, &requested_host) {
        return Err("Ce compte ne correspond pas à ce site.".to_string());
    }
    Ok(AutofillCredential {
        username: entry.email.clone(),
        password: entry.mdp.clone(),
    })
}

fn canonical_candidate_origin(value: &str) -> Result<(String, String), String> {
    let mut url = Url::parse(value).map_err(|_| "Origine invalide.".to_string())?;
    if url.scheme() != "https" {
        return Err("Seules les connexions HTTPS peuvent être enregistrées.".to_string());
    }
    let host = normalized_host(value)?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok((url.to_string(), host))
}

pub fn candidate_status(
    categories: &CategoryMap,
    origin: &str,
    username: &str,
    password: &str,
) -> Result<CandidateAction, String> {
    if username.trim().is_empty() || password.is_empty() {
        return Err("Identifiant ou mot de passe manquant.".to_string());
    }
    let (_, requested_host) = canonical_candidate_origin(origin)?;
    for entries in categories.values() {
        for entry in entries {
            if !site_matches(&entry.site, &requested_host) {
                continue;
            }
            if entry.email.trim().eq_ignore_ascii_case(username.trim()) {
                return Ok(if entry.mdp == password {
                    CandidateAction::Saved
                } else {
                    CandidateAction::Update
                });
            }
        }
    }
    Ok(CandidateAction::Save)
}

pub fn candidate_status_from_store(
    store: &Mutex<PasswordStore>,
    candidate: &CredentialCandidate,
) -> Result<CandidateAction, String> {
    let categories = store
        .lock()
        .map_err(|_| "unavailable".to_string())?
        .load()
        .map_err(|_| "locked".to_string())?;
    candidate_status(
        &categories,
        &candidate.origin,
        &candidate.username,
        &candidate.password,
    )
}

pub fn save_candidate(
    store: &Mutex<PasswordStore>,
    candidate: &CredentialCandidate,
) -> Result<CandidateAction, String> {
    let (site, host) = canonical_candidate_origin(&candidate.origin)?;
    let guard = store.lock().map_err(|_| "unavailable".to_string())?;
    let categories = guard.load().map_err(|_| "locked".to_string())?;
    let action = candidate_status(
        &categories,
        &candidate.origin,
        &candidate.username,
        &candidate.password,
    )?;

    match action {
        CandidateAction::Saved => Ok(action),
        CandidateAction::Save => {
            guard
                .add_password(
                    "Remplissage automatique".to_string(),
                    crate::store::PasswordEntry {
                        plateforme: registrable_domain(&host),
                        email: candidate.username.trim().to_string(),
                        mdp: candidate.password.clone(),
                        site,
                        ..crate::store::PasswordEntry::default()
                    },
                )
                .map_err(|error| error.to_string())?;
            Ok(action)
        }
        CandidateAction::Update => {
            for (category, entries) in &categories {
                for (index, entry) in entries.iter().enumerate() {
                    if site_matches(&entry.site, &host)
                        && entry
                            .email
                            .trim()
                            .eq_ignore_ascii_case(candidate.username.trim())
                    {
                        let mut updated = entry.clone();
                        updated.mdp = candidate.password.clone();
                        if updated.site.trim().is_empty() {
                            updated.site = site;
                        }
                        guard
                            .update_password(category.clone(), index, updated)
                            .map_err(|error| error.to_string())?;
                        return Ok(action);
                    }
                }
            }
            Err("Compte introuvable.".to_string())
        }
    }
}

impl AutofillRuntime {
    pub fn new(config_path: PathBuf, store: Arc<Mutex<PasswordStore>>) -> Self {
        let config = fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| serde_json::from_str::<AutofillConfig>(&content).ok())
            .filter(|config| !config.token.is_empty())
            .unwrap_or_else(|| AutofillConfig {
                enabled: false,
                token: fresh_token(),
            });
        let runtime = Self {
            config_path,
            config: Arc::new(Mutex::new(config)),
            store,
            running: Arc::new(AtomicBool::new(false)),
        };
        let _ = runtime.persist();
        runtime
    }

    pub fn status(&self) -> Result<AutofillStatus, String> {
        let config = self
            .config
            .lock()
            .map_err(|_| "Configuration de remplissage indisponible.".to_string())?;
        Ok(AutofillStatus {
            enabled: config.enabled,
            running: self.running.load(Ordering::Relaxed),
            port: AUTOFILL_PORT,
            token: config.token.clone(),
        })
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<AutofillStatus, String> {
        self.config
            .lock()
            .map_err(|_| "Configuration de remplissage indisponible.".to_string())?
            .enabled = enabled;
        self.persist()?;
        self.status()
    }

    pub fn rotate_token(&self) -> Result<AutofillStatus, String> {
        self.config
            .lock()
            .map_err(|_| "Configuration de remplissage indisponible.".to_string())?
            .token = fresh_token();
        self.persist()?;
        self.status()
    }

    fn persist(&self) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(
            &*self
                .config
                .lock()
                .map_err(|_| "Configuration de remplissage indisponible.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::write(&self.config_path, content).map_err(|error| error.to_string())
    }
}

pub fn start_server(runtime: AutofillRuntime, app: AppHandle) {
    thread::spawn(move || {
        let Ok(server) = Server::http(("127.0.0.1", AUTOFILL_PORT)) else {
            runtime.running.store(false, Ordering::Relaxed);
            return;
        };
        runtime.running.store(true, Ordering::Relaxed);
        for request in server.incoming_requests() {
            handle_request(request, &runtime, &app);
        }
        runtime.running.store(false, Ordering::Relaxed);
    });
}

fn extension_origin(request: &Request) -> Option<String> {
    let origin = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Origin"))?
        .value
        .as_str()
        .to_string();
    if origin.starts_with("chrome-extension://") || origin.starts_with("extension://") {
        Some(origin)
    } else {
        None
    }
}

fn token_is_valid(request: &Request, runtime: &AutofillRuntime) -> bool {
    let supplied = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("X-Clave-Token"))
        .map(|header| header.value.as_str());
    let Ok(config) = runtime.config.lock() else {
        return false;
    };
    config.enabled && supplied == Some(config.token.as_str())
}

fn read_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let declared = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Content-Length"))
        .and_then(|header| header.value.as_str().parse::<usize>().ok())
        .unwrap_or(0);
    if declared > MAX_BODY_BYTES {
        return Err("Requête trop volumineuse.".to_string());
    }
    let mut body = String::new();
    request
        .as_reader()
        .take((MAX_BODY_BYTES + 1) as u64)
        .read_to_string(&mut body)
        .map_err(|_| "Requête illisible.".to_string())?;
    if body.len() > MAX_BODY_BYTES {
        return Err("Requête trop volumineuse.".to_string());
    }
    serde_json::from_str(&body).map_err(|_| "Requête invalide.".to_string())
}

fn respond_json<T: Serialize>(request: Request, code: u16, value: &T, origin: &str) {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string());
    let mut response = Response::from_string(body).with_status_code(StatusCode(code));
    for (name, value) in [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Access-Control-Allow-Origin", origin),
        (
            "Access-Control-Allow-Headers",
            "Content-Type, X-Clave-Token",
        ),
        ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ("Cache-Control", "no-store"),
    ] {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
    let _ = request.respond(response);
}

fn respond_error(
    request: Request,
    code: u16,
    error_code: &'static str,
    message: &'static str,
    origin: &str,
) {
    respond_json(
        request,
        code,
        &ErrorResponse {
            code: error_code,
            message,
        },
        origin,
    );
}

fn handle_request(mut request: Request, runtime: &AutofillRuntime, app: &AppHandle) {
    let Some(origin) = extension_origin(&request) else {
        let _ = request.respond(Response::empty(StatusCode(403)));
        return;
    };
    if request.method() == &Method::Options {
        respond_json(request, 204, &serde_json::json!({}), &origin);
        return;
    }
    if request.method() != &Method::Post || !token_is_valid(&request, runtime) {
        respond_error(
            request,
            403,
            "unauthorized",
            "Extension non appairée.",
            &origin,
        );
        return;
    }

    match request.url() {
        "/v1/status" => {
            let unlocked = runtime
                .store
                .lock()
                .ok()
                .map(|store| store.auth_status().unlocked)
                .unwrap_or(false);
            respond_json(
                request,
                200,
                &ServerStatus {
                    enabled: true,
                    unlocked,
                },
                &origin,
            );
        }
        "/v1/focus" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            respond_json(request, 200, &serde_json::json!({ "ok": true }), &origin);
        }
        "/v1/matches" => {
            let Ok(payload) = read_json::<OriginRequest>(&mut request) else {
                respond_error(
                    request,
                    400,
                    "invalid_request",
                    "Requête invalide.",
                    &origin,
                );
                return;
            };
            match matching_accounts_from_store(runtime.store.as_ref(), &payload.origin) {
                Ok(accounts) => respond_json(request, 200, &accounts, &origin),
                Err(code) if code == "locked" => respond_error(
                    request,
                    423,
                    "locked",
                    "Déverrouillez Clave pour continuer.",
                    &origin,
                ),
                Err(_) => respond_error(
                    request,
                    400,
                    "invalid_origin",
                    "Site non pris en charge.",
                    &origin,
                ),
            }
        }
        "/v1/credential" => {
            let Ok(payload) = read_json::<CredentialRequest>(&mut request) else {
                respond_error(
                    request,
                    400,
                    "invalid_request",
                    "Requête invalide.",
                    &origin,
                );
                return;
            };
            let categories = runtime
                .store
                .lock()
                .ok()
                .and_then(|store| store.load().ok());
            let Some(categories) = categories else {
                respond_error(
                    request,
                    423,
                    "locked",
                    "Déverrouillez Clave pour continuer.",
                    &origin,
                );
                return;
            };
            match credential_for(
                &categories,
                &payload.origin,
                &payload.category,
                payload.index,
            ) {
                Ok(credential) => respond_json(request, 200, &credential, &origin),
                Err(_) => respond_error(
                    request,
                    404,
                    "not_found",
                    "Aucun compte sûr pour ce site.",
                    &origin,
                ),
            }
        }
        "/v1/candidate-status" => {
            let Ok(payload) = read_json::<CredentialCandidate>(&mut request) else {
                respond_error(
                    request,
                    400,
                    "invalid_request",
                    "Identifiants incomplets.",
                    &origin,
                );
                return;
            };
            match candidate_status_from_store(runtime.store.as_ref(), &payload) {
                Ok(action) => {
                    respond_json(request, 200, &CandidateStatusResponse { action }, &origin)
                }
                Err(code) if code == "locked" => respond_error(
                    request,
                    423,
                    "locked",
                    "Déverrouillez Clave pour continuer.",
                    &origin,
                ),
                Err(_) => respond_error(
                    request,
                    400,
                    "invalid_candidate",
                    "Cette connexion ne peut pas être enregistrée.",
                    &origin,
                ),
            }
        }
        "/v1/save-candidate" => {
            let Ok(payload) = read_json::<CredentialCandidate>(&mut request) else {
                respond_error(
                    request,
                    400,
                    "invalid_request",
                    "Identifiants incomplets.",
                    &origin,
                );
                return;
            };
            match save_candidate(runtime.store.as_ref(), &payload) {
                Ok(action) => {
                    let status = CandidateStatusResponse { action };
                    let _ = app.emit("vault-changed", status.clone());
                    respond_json(request, 200, &status, &origin)
                }
                Err(code) if code == "locked" => respond_error(
                    request,
                    423,
                    "locked",
                    "Déverrouillez Clave pour continuer.",
                    &origin,
                ),
                Err(_) => respond_error(
                    request,
                    400,
                    "save_failed",
                    "Clave n’a pas pu enregistrer ce compte.",
                    &origin,
                ),
            }
        }
        _ => respond_error(request, 404, "not_found", "Route inconnue.", &origin),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Mutex};

    use tempfile::tempdir;

    use crate::store::{CategoryMap, PasswordEntry, PasswordStore};

    use super::{
        candidate_status, credential_for, matching_accounts, matching_accounts_from_store,
        save_candidate, CandidateAction, CredentialCandidate,
    };

    fn vault() -> CategoryMap {
        BTreeMap::from([(
            "Personnel".to_string(),
            vec![
                PasswordEntry {
                    plateforme: "GitHub principal".into(),
                    email: "lea@example.fr".into(),
                    mdp: "secret-principal".into(),
                    site: "https://github.com/login".into(),
                    ..PasswordEntry::default()
                },
                PasswordEntry {
                    plateforme: "GitHub travail".into(),
                    email: "lea@work.fr".into(),
                    mdp: "secret-travail".into(),
                    site: "https://www.github.com/".into(),
                    ..PasswordEntry::default()
                },
                PasswordEntry {
                    plateforme: "Faux GitHub".into(),
                    email: "attacker@example.fr".into(),
                    mdp: "never".into(),
                    site: "https://github.com.evil.test/".into(),
                    ..PasswordEntry::default()
                },
                PasswordEntry {
                    plateforme: "GitHub sans mot de passe".into(),
                    email: "vide@example.fr".into(),
                    mdp: String::new(),
                    site: "https://github.com/".into(),
                    ..PasswordEntry::default()
                },
            ],
        )])
    }

    #[test]
    fn matches_only_the_exact_host_and_treats_www_as_equivalent() {
        let matches = matching_accounts(&vault(), "https://github.com/session").unwrap();

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].label, "GitHub principal");
        assert_eq!(matches[1].username, "lea@work.fr");
    }

    #[test]
    fn matches_a_sign_in_subdomain_of_the_saved_site() {
        let matches = matching_accounts(&vault(), "https://accounts.github.com/").unwrap();

        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn rejects_lookalike_and_shared_hosting_domains() {
        assert!(matching_accounts(&vault(), "https://github.com.evil.test/")
            .unwrap()
            .iter()
            .all(|account| account.label == "Faux GitHub"));
        assert!(matching_accounts(&vault(), "https://notgithub.com/")
            .unwrap()
            .is_empty());

        let pages = BTreeMap::from([(
            "Web".to_string(),
            vec![PasswordEntry {
                plateforme: "Blog".into(),
                email: "lea".into(),
                mdp: "secret".into(),
                site: "https://lea.github.io/".into(),
                ..PasswordEntry::default()
            }],
        )]);
        assert!(matching_accounts(&pages, "https://attacker.github.io/")
            .unwrap()
            .is_empty());
        assert_eq!(
            matching_accounts(&pages, "https://lea.github.io/login")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn gmail_accounts_are_offered_on_the_google_sign_in_page() {
        let vault = BTreeMap::from([(
            "Mail".to_string(),
            vec![
                PasswordEntry {
                    plateforme: "Gmail".into(),
                    email: "lea@gmail.com".into(),
                    mdp: "secret-gmail".into(),
                    site: "gmail.com".into(),
                    ..PasswordEntry::default()
                },
                PasswordEntry {
                    plateforme: "Google pro".into(),
                    email: "lea@work.fr".into(),
                    mdp: "secret-pro".into(),
                    site: "https://accounts.google.co.uk/".into(),
                    ..PasswordEntry::default()
                },
            ],
        )]);

        let matches =
            matching_accounts(&vault, "https://accounts.google.com/v3/signin/identifier").unwrap();

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].label, "Gmail");
        assert!(credential_for(&vault, "https://accounts.google.com/", "Mail", 0).is_ok());
        assert_eq!(
            candidate_status(
                &vault,
                "https://accounts.google.com/",
                "lea@gmail.com",
                "secret-gmail"
            )
            .unwrap(),
            CandidateAction::Saved
        );
    }

    #[test]
    fn ignores_accounts_without_a_saved_password() {
        let matches = matching_accounts(&vault(), "https://github.com/").unwrap();

        assert_eq!(matches.len(), 2);
        assert!(!matches
            .iter()
            .any(|account| account.username == "vide@example.fr"));
    }

    #[test]
    fn account_metadata_never_serializes_a_password() {
        let matches = matching_accounts(&vault(), "https://github.com/").unwrap();
        let json = serde_json::to_string(&matches).unwrap();

        assert!(!json.contains("secret-principal"));
        assert!(!json.contains("password"));
        assert!(!json.contains("mdp"));
    }

    #[test]
    fn credential_is_revalidated_against_the_request_origin() {
        let credential = credential_for(&vault(), "https://github.com/", "Personnel", 0).unwrap();
        assert_eq!(credential.username, "lea@example.fr");
        assert_eq!(credential.password, "secret-principal");

        assert!(credential_for(&vault(), "https://evil.test/", "Personnel", 0).is_err());
    }

    #[test]
    fn locked_store_never_exposes_account_metadata() {
        let directory = tempdir().unwrap();
        let mut password_store = PasswordStore::new(
            directory.path().join("vault.json"),
            directory.path().join("key"),
            directory.path().join("auth.json"),
        );
        password_store
            .setup_master_password("correct horse battery staple".into())
            .unwrap();
        password_store.lock();
        let store = Mutex::new(password_store);

        let error = matching_accounts_from_store(&store, "https://github.com/").unwrap_err();

        assert_eq!(error, "locked");
    }

    #[test]
    fn candidate_status_distinguishes_new_saved_and_updated_credentials() {
        assert_eq!(
            candidate_status(
                &vault(),
                "https://github.com/",
                "lea@example.fr",
                "secret-principal"
            )
            .unwrap(),
            CandidateAction::Saved
        );
        assert_eq!(
            candidate_status(
                &vault(),
                "https://github.com/",
                "lea@example.fr",
                "nouveau-secret"
            )
            .unwrap(),
            CandidateAction::Update
        );
        assert_eq!(
            candidate_status(
                &vault(),
                "https://github.com/",
                "nouveau@example.fr",
                "nouveau-secret"
            )
            .unwrap(),
            CandidateAction::Save
        );
    }

    #[test]
    fn candidate_status_rejects_incomplete_credentials() {
        let categories = vault();

        assert!(candidate_status(&categories, "https://example.com", "", "secret").is_err());
        assert!(
            candidate_status(&categories, "https://example.com", "lea@example.fr", "").is_err()
        );
        assert!(candidate_status(
            &categories,
            "http://example.com",
            "lea@example.fr",
            "secret"
        )
        .is_err());
    }

    #[test]
    fn save_candidate_creates_then_updates_the_matching_account() {
        let directory = tempdir().unwrap();
        let mut password_store = PasswordStore::new(
            directory.path().join("vault.json"),
            directory.path().join("key"),
            directory.path().join("auth.json"),
        );
        password_store
            .setup_master_password("correct horse battery staple".into())
            .unwrap();
        let store = Mutex::new(password_store);
        let mut candidate = CredentialCandidate {
            origin: "https://example.com".into(),
            username: "lea@example.fr".into(),
            password: "premier-secret".into(),
        };

        assert_eq!(
            save_candidate(&store, &candidate).unwrap(),
            CandidateAction::Save
        );
        let created = store.lock().unwrap().load().unwrap();
        assert_eq!(created["Remplissage automatique"][0].mdp, "premier-secret");
        assert_eq!(
            created["Remplissage automatique"][0].site,
            "https://example.com/"
        );

        candidate.password = "second-secret".into();
        assert_eq!(
            save_candidate(&store, &candidate).unwrap(),
            CandidateAction::Update
        );
        let updated = store.lock().unwrap().load().unwrap();
        assert_eq!(updated["Remplissage automatique"].len(), 1);
        assert_eq!(updated["Remplissage automatique"][0].mdp, "second-secret");
    }
}
