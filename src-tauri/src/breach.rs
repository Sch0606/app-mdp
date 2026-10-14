//! Vérification des fuites via l'API « Pwned Passwords » de Have I Been Pwned.
//!
//! k-anonymat : chaque mot de passe est haché en SHA-1 sur l'appareil et seuls les
//! 5 premiers caractères hexadécimaux du hachage sont envoyés. L'API renvoie tous
//! les suffixes connus pour ce préfixe et la comparaison se fait localement.
//! Ni le mot de passe ni son hachage complet ne quittent l'appareil.

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use reqwest::blocking::Client;
use serde::Serialize;
use sha1::{Digest, Sha1};

use crate::store::CategoryMap;

const RANGE_ENDPOINT: &str = "https://api.pwnedpasswords.com/range/";
const RANGE_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const PREFIX_LENGTH: usize = 5;

type RangeMap = HashMap<String, u64>;
static RANGE_CACHE: OnceLock<Mutex<HashMap<String, (Instant, RangeMap)>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CompromisedEntry {
    pub categorie: String,
    pub index: usize,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreachReport {
    pub compromised: Vec<CompromisedEntry>,
    pub checked: usize,
    pub requests: usize,
}

pub fn sha1_hex_upper(password: &str) -> String {
    let digest = Sha1::digest(password.as_bytes());
    digest.iter().map(|byte| format!("{byte:02X}")).collect()
}

/// Lit la réponse `SUFFIXE:COMPTE` ; les lignes de remplissage (compte 0) sont ignorées.
pub fn parse_range(body: &str) -> RangeMap {
    body.lines()
        .filter_map(|line| {
            let (suffix, count) = line.trim().split_once(':')?;
            let count = count.trim().parse::<u64>().ok()?;
            (count > 0).then(|| (suffix.trim().to_ascii_uppercase(), count))
        })
        .collect()
}

/// Cœur testable : `fetch_range` reçoit uniquement un préfixe de 5 caractères.
pub fn check_categories(
    categories: &CategoryMap,
    mut fetch_range: impl FnMut(&str) -> Result<RangeMap, String>,
) -> Result<BreachReport, String> {
    // Regroupe par hachage pour ne faire qu'une requête par préfixe.
    let mut by_hash: BTreeMap<String, Vec<(String, usize)>> = BTreeMap::new();
    for (category, entries) in categories {
        for (index, entry) in entries.iter().enumerate() {
            if entry.mdp.is_empty() {
                continue;
            }
            by_hash
                .entry(sha1_hex_upper(&entry.mdp))
                .or_default()
                .push((category.clone(), index));
        }
    }

    let mut ranges: HashMap<String, RangeMap> = HashMap::new();
    let mut compromised = Vec::new();
    for (hash, locations) in &by_hash {
        let (prefix, suffix) = hash.split_at(PREFIX_LENGTH);
        if !ranges.contains_key(prefix) {
            ranges.insert(prefix.to_string(), fetch_range(prefix)?);
        }
        if let Some(count) = ranges[prefix].get(suffix) {
            for (categorie, index) in locations {
                compromised.push(CompromisedEntry {
                    categorie: categorie.clone(),
                    index: *index,
                    count: *count,
                });
            }
        }
    }

    Ok(BreachReport {
        compromised,
        checked: by_hash.len(),
        requests: ranges.len(),
    })
}

/// Récupère une plage, avec un cache mémoire de quelques heures par préfixe.
pub fn cached_range(prefix: &str) -> Result<RangeMap, String> {
    let cache = RANGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some((fetched_at, range)) = guard.get(prefix) {
            if fetched_at.elapsed() < RANGE_CACHE_TTL {
                return Ok(range.clone());
            }
        }
    }

    let range = fetch_range(prefix)?;
    if let Ok(mut guard) = cache.lock() {
        guard.insert(prefix.to_string(), (Instant::now(), range.clone()));
    }
    Ok(range)
}

fn fetch_range(prefix: &str) -> Result<RangeMap, String> {
    if prefix.len() != PREFIX_LENGTH || !prefix.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Préfixe de hachage invalide.".to_string());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Clave-password-manager")
        .build()
        .map_err(|_| "Le service de vérification est indisponible.".to_string())?;
    let response = client
        .get(format!("{RANGE_ENDPOINT}{prefix}"))
        // Le remplissage masque la taille réelle de la réponse sur le réseau.
        .header("Add-Padding", "true")
        .send()
        .map_err(|_| {
            "Impossible de joindre Have I Been Pwned. Vérifiez la connexion.".to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Have I Been Pwned a répondu avec l’erreur {}.",
            response.status().as_u16()
        ));
    }
    let body = response
        .text()
        .map_err(|_| "Réponse illisible de Have I Been Pwned.".to_string())?;
    Ok(parse_range(&body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::PasswordEntry;

    fn entry(mdp: &str) -> PasswordEntry {
        PasswordEntry {
            plateforme: "Service".into(),
            mdp: mdp.into(),
            ..Default::default()
        }
    }

    #[test]
    fn sha1_matches_the_reference_hash() {
        assert_eq!(
            sha1_hex_upper("password"),
            "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8"
        );
    }

    #[test]
    fn parse_range_ignores_padding_and_garbage() {
        let range =
            parse_range("1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\nABC:0\nnot-a-line\n");
        assert_eq!(range.len(), 1);
        assert_eq!(range["1E4C9B93F3F0682250B6CF8331B7EE68FD8"], 3_861_493);
    }

    #[test]
    fn only_prefixes_are_sent_and_matches_are_local() {
        let mut categories = CategoryMap::new();
        categories.insert(
            "Perso".into(),
            vec![
                entry("password"),
                entry("Unique-Et-Long-2026!"),
                entry("password"),
            ],
        );
        categories.insert("Pro".into(), vec![entry(""), entry("password")]);

        let mut requested = Vec::new();
        let report = check_categories(&categories, |prefix| {
            requested.push(prefix.to_string());
            Ok(if prefix == "5BAA6" {
                parse_range("1E4C9B93F3F0682250B6CF8331B7EE68FD8:42")
            } else {
                RangeMap::new()
            })
        })
        .unwrap();

        assert!(requested.iter().all(|prefix| prefix.len() == 5));
        assert_eq!(requested.iter().filter(|p| *p == "5BAA6").count(), 1);
        assert_eq!(report.checked, 2);
        assert_eq!(
            report.compromised,
            vec![
                CompromisedEntry {
                    categorie: "Perso".into(),
                    index: 0,
                    count: 42
                },
                CompromisedEntry {
                    categorie: "Perso".into(),
                    index: 2,
                    count: 42
                },
                CompromisedEntry {
                    categorie: "Pro".into(),
                    index: 1,
                    count: 42
                },
            ]
        );
    }

    #[test]
    fn network_errors_are_reported() {
        let mut categories = CategoryMap::new();
        categories.insert("Perso".into(), vec![entry("secret")]);
        let error = check_categories(&categories, |_| Err("hors ligne".into())).unwrap_err();
        assert_eq!(error, "hors ligne");
    }
}
