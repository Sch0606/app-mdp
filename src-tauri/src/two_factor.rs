//! Annuaire des services compatibles 2FA (TOTP), issu de 2fa.directory.
//!
//! L'annuaire complet est téléchargé puis comparé localement : aucun domaine du
//! coffre n'est envoyé. Il est mis en cache sur disque pour fonctionner hors ligne.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

use reqwest::blocking::Client;
use serde_json::Value;

const DIRECTORY_ENDPOINT: &str = "https://api.2fa.directory/v3/totp.json";
const CACHE_FILE: &str = "2fa-directory.json";
const CACHE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const DIRECTORY_MAX_BYTES: usize = 8 * 1024 * 1024;

static MEMORY_CACHE: OnceLock<Mutex<Option<(Instant, Vec<String>)>>> = OnceLock::new();

/// Domaines (et domaines additionnels) des services proposant un code TOTP.
/// Format attendu : `[["Nom", { "domain": "...", "additional-domains": [...] }], ...]`.
pub fn parse_directory(body: &str) -> Result<Vec<String>, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|_| "Annuaire 2FA illisible.".to_string())?;
    let entries = value
        .as_array()
        .ok_or_else(|| "Annuaire 2FA illisible.".to_string())?;
    let mut domains = BTreeSet::new();
    for entry in entries {
        let Some(details) = entry.as_array().and_then(|pair| pair.get(1)) else {
            continue;
        };
        let main = details.get("domain").and_then(Value::as_str);
        let additional = details
            .get("additional-domains")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str);
        for domain in main.into_iter().chain(additional) {
            let domain = domain.trim().trim_end_matches('.').to_ascii_lowercase();
            let domain = domain.strip_prefix("www.").unwrap_or(&domain);
            if domain.contains('.') {
                domains.insert(domain.to_string());
            }
        }
    }
    if domains.is_empty() {
        return Err("Annuaire 2FA vide.".to_string());
    }
    Ok(domains.into_iter().collect())
}

fn read_disk_cache(path: &Path, max_age: Option<Duration>) -> Option<Vec<String>> {
    if let Some(max_age) = max_age {
        let modified = std::fs::metadata(path).ok()?.modified().ok()?;
        if SystemTime::now().duration_since(modified).ok()? > max_age {
            return None;
        }
    }
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn download() -> Result<Vec<String>, String> {
    let response = Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Clave")
        .build()
        .map_err(|_| "Annuaire 2FA indisponible.".to_string())?
        .get(DIRECTORY_ENDPOINT)
        .send()
        .map_err(|_| "Annuaire 2FA indisponible hors ligne.".to_string())?;
    if !response.status().is_success() {
        return Err("Annuaire 2FA indisponible.".to_string());
    }
    let bytes = response
        .bytes()
        .map_err(|_| "Annuaire 2FA indisponible.".to_string())?;
    if bytes.len() > DIRECTORY_MAX_BYTES {
        return Err("Annuaire 2FA trop volumineux.".to_string());
    }
    parse_directory(&String::from_utf8_lossy(&bytes))
}

/// Cache mémoire, puis disque (< 7 jours), puis réseau ; en cas d'échec réseau,
/// un cache disque périmé reste préférable à aucune information.
pub fn supported_domains(cache_dir: Option<PathBuf>) -> Result<Vec<String>, String> {
    let memory = MEMORY_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = memory.lock() {
        if let Some((loaded_at, domains)) = guard.as_ref() {
            if loaded_at.elapsed() < CACHE_MAX_AGE {
                return Ok(domains.clone());
            }
        }
    }

    let cache_file = cache_dir.as_ref().map(|directory| directory.join(CACHE_FILE));
    let domains = match cache_file
        .as_deref()
        .and_then(|path| read_disk_cache(path, Some(CACHE_MAX_AGE)))
    {
        Some(domains) => domains,
        None => match download() {
            Ok(domains) => {
                if let (Some(directory), Some(path)) = (cache_dir.as_ref(), cache_file.as_ref()) {
                    if std::fs::create_dir_all(directory).is_ok() {
                        if let Ok(json) = serde_json::to_string(&domains) {
                            let _ = std::fs::write(path, json);
                        }
                    }
                }
                domains
            }
            Err(error) => cache_file
                .as_deref()
                .and_then(|path| read_disk_cache(path, None))
                .ok_or(error)?,
        },
    };

    if let Ok(mut guard) = memory.lock() {
        *guard = Some((Instant::now(), domains.clone()));
    }
    Ok(domains)
}

#[cfg(test)]
mod tests {
    use super::{parse_directory, supported_domains};

    #[test]
    fn directory_lists_main_and_additional_domains() {
        let body = r#"[
            ["GitHub", {"domain": "github.com", "tfa": ["totp"]}],
            ["Google", {"domain": "www.Google.com", "additional-domains": ["youtube.com"], "tfa": ["totp"]}],
            ["Broken", {"tfa": ["totp"]}],
            "ignored"
        ]"#;
        assert_eq!(
            parse_directory(body).unwrap(),
            vec!["github.com", "google.com", "youtube.com"]
        );
    }

    #[test]
    fn unreadable_directory_is_an_error() {
        assert!(parse_directory("{}").is_err());
        assert!(parse_directory("[]").is_err());
    }

    #[test]
    fn disk_cache_is_used_before_the_network() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("2fa-directory.json"), r#"["example.com"]"#).unwrap();
        assert_eq!(
            supported_domains(Some(directory.path().to_path_buf())).unwrap(),
            vec!["example.com"]
        );
    }
}
