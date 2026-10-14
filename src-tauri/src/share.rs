//! Partage d'un accès par lien à usage unique.
//!
//! L'entrée est chiffrée ici en AES-256-GCM avec une clé aléatoire, puis seul le texte
//! chiffré est envoyé au serveur de partage. La clé est placée après le `#` du lien
//! (`…/s/<id>#<clé>`) : les navigateurs ne transmettent jamais le fragment, le serveur
//! ne peut donc pas lire le contenu. Le serveur détruit le secret à la première lecture.

use std::time::Duration;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use reqwest::{blocking::Client, header::CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::store::PasswordEntry;

pub const MIN_TTL_SECONDS: u64 = 5 * 60;
pub const MAX_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 12;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShareOptions {
    pub ttl_seconds: u64,
    pub include_username: bool,
    pub include_url: bool,
    pub include_notes: bool,
}

/// Contenu chiffré lu par la page de consultation (`share-server/public/viewer.js`).
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SharePayload {
    pub v: u8,
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub username: String,
    pub password: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub url: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub notes: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub url: String,
    pub expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedSecret {
    id: String,
    expires_at: u64,
}

pub fn build_payload(entry: &PasswordEntry, options: &ShareOptions) -> SharePayload {
    let pick = |include: bool, value: &str| {
        if include {
            value.trim().to_string()
        } else {
            String::new()
        }
    };
    SharePayload {
        v: 1,
        title: entry.plateforme.trim().to_string(),
        username: pick(options.include_username, &entry.email),
        password: entry.mdp.clone(),
        url: pick(options.include_url, &entry.site),
        notes: pick(options.include_notes, &entry.notes),
    }
}

/// Renvoie `(texte chiffré, clé)` encodés en base64url : `nonce || chiffré || tag`.
pub fn encrypt_payload(payload: &SharePayload) -> Result<(String, String), String> {
    let plaintext = serde_json::to_vec(payload)
        .map_err(|_| "Le contenu n’a pas pu être préparé.".to_string())?;
    let mut key = [0u8; KEY_LENGTH];
    let mut nonce = [0u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut nonce);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "Clé de partage invalide.".to_string())?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| "Le chiffrement a échoué.".to_string())?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&encrypted);
    Ok((URL_SAFE_NO_PAD.encode(blob), URL_SAFE_NO_PAD.encode(key)))
}

/// HTTPS obligatoire, sauf pour un serveur local de développement.
pub fn normalize_server_url(raw: &str) -> Result<Url, String> {
    let invalid = || "Adresse du serveur de partage invalide.".to_string();
    let mut url = Url::parse(raw.trim()).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?.to_ascii_lowercase();
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]")
        || host.ends_with(".localhost");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("Le serveur de partage doit utiliser HTTPS.".to_string()),
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url)
}

fn valid_id(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn share_entry(
    server: &str,
    entry: &PasswordEntry,
    options: ShareOptions,
) -> Result<ShareLink, String> {
    if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&options.ttl_seconds) {
        return Err("Durée de validité invalide.".to_string());
    }
    if entry.mdp.is_empty() {
        return Err("Cet accès n’a pas de mot de passe à partager.".to_string());
    }
    let base = normalize_server_url(server)?;
    let (ciphertext, key) = encrypt_payload(&build_payload(entry, &options))?;
    let body =
        serde_json::json!({ "ciphertext": ciphertext, "ttl": options.ttl_seconds }).to_string();

    let endpoint = base
        .join("api/secrets")
        .map_err(|_| "Adresse du serveur de partage invalide.".to_string())?;
    let response = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Connexion impossible.".to_string())?
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .map_err(|_| "Le serveur de partage est injoignable.".to_string())?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err("Trop de partages récents. Réessayez plus tard.".to_string());
    }
    if !status.is_success() {
        return Err(format!(
            "Le serveur de partage a refusé la demande ({}).",
            status.as_u16()
        ));
    }
    let text = response
        .text()
        .map_err(|_| "Réponse illisible du serveur de partage.".to_string())?;
    let created: CreatedSecret = serde_json::from_str(&text)
        .map_err(|_| "Réponse inattendue du serveur de partage.".to_string())?;
    if !valid_id(&created.id) {
        return Err("Réponse inattendue du serveur de partage.".to_string());
    }
    let mut link = base
        .join(&format!("s/{}", created.id))
        .map_err(|_| "Lien invalide.".to_string())?;
    link.set_fragment(Some(&key));
    Ok(ShareLink {
        url: link.to_string(),
        expires_at: created.expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;

    fn entry() -> PasswordEntry {
        PasswordEntry {
            plateforme: "GitHub".into(),
            email: "alice@example.com".into(),
            mdp: "s3cret!".into(),
            site: "https://github.com".into(),
            notes: "2FA activée".into(),
            ..Default::default()
        }
    }

    fn options() -> ShareOptions {
        ShareOptions {
            ttl_seconds: 3600,
            include_username: true,
            include_url: true,
            include_notes: false,
        }
    }

    #[test]
    fn payload_only_contains_selected_fields() {
        let payload = build_payload(&entry(), &options());
        assert_eq!(payload.username, "alice@example.com");
        assert_eq!(payload.url, "https://github.com");
        assert!(payload.notes.is_empty());
        let json = serde_json::to_string(&payload).unwrap();
        assert!(!json.contains("notes"));
    }

    #[test]
    fn encrypted_payload_round_trips_with_fragment_key() {
        let payload = build_payload(&entry(), &options());
        let (ciphertext, key) = encrypt_payload(&payload).unwrap();
        assert!(!ciphertext.contains("s3cret"));
        let blob = URL_SAFE_NO_PAD.decode(ciphertext).unwrap();
        let key = URL_SAFE_NO_PAD.decode(key).unwrap();
        assert_eq!(key.len(), KEY_LENGTH);
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let plain = cipher
            .decrypt(
                Nonce::from_slice(&blob[..NONCE_LENGTH]),
                &blob[NONCE_LENGTH..],
            )
            .unwrap();
        let decoded: SharePayload = serde_json::from_slice(&plain).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn server_url_requires_https_except_locally() {
        assert_eq!(
            normalize_server_url("https://share.example.com")
                .unwrap()
                .as_str(),
            "https://share.example.com/"
        );
        assert_eq!(
            normalize_server_url("https://example.com/clave")
                .unwrap()
                .as_str(),
            "https://example.com/clave/"
        );
        assert!(normalize_server_url("http://127.0.0.1:8787").is_ok());
        assert!(normalize_server_url("http://share.example.com").is_err());
        assert!(normalize_server_url("https://user:pw@example.com").is_err());
        assert!(normalize_server_url("ftp://example.com").is_err());
    }

    #[test]
    fn share_rejects_out_of_range_ttl() {
        let mut opts = options();
        opts.ttl_seconds = MAX_TTL_SECONDS + 1;
        assert!(share_entry("https://example.com", &entry(), opts).is_err());
    }
}
