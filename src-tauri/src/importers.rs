//! Import depuis les navigateurs et les autres gestionnaires de mots de passe.
//!
//! Formats reconnus : CSV de navigateur, Bitwarden (JSON non chiffré et CSV),
//! KeePass 2 (XML), 1Password (CSV) et LastPass (CSV). Chaque parseur produit
//! des `ImportCandidate`, c'est-à-dire un accès et l'espace qui le recevra.

use std::collections::HashMap;

use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::store::PasswordEntry;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportCandidate {
    #[serde(default)]
    pub categorie: String,
    #[serde(flatten)]
    pub entry: PasswordEntry,
}

pub const DEFAULT_IMPORT_CATEGORY: &str = "Import navigateur";

/// Détecte le format d'après le contenu puis délègue au bon parseur.
pub fn parse_import_file(text: &str) -> Result<Vec<ImportCandidate>, String> {
    if text.len() > crate::store::MAX_IMPORT_BYTES {
        return Err("Fichier d’import trop volumineux.".to_string());
    }
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    if trimmed.starts_with('{') {
        parse_bitwarden_json(trimmed)
    } else if trimmed.starts_with('<') {
        parse_keepass_xml(trimmed)
    } else {
        parse_csv(text)
    }
}

// ---------------------------------------------------------------------------
// Bitwarden JSON
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct BitwardenExport {
    #[serde(default)]
    encrypted: bool,
    #[serde(default)]
    folders: Vec<BitwardenFolder>,
    #[serde(default)]
    items: Vec<BitwardenItem>,
}

#[derive(Deserialize)]
struct BitwardenFolder {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct BitwardenItem {
    #[serde(rename = "type", default = "bitwarden_login_type")]
    kind: u8,
    #[serde(default)]
    name: String,
    #[serde(rename = "folderId", default)]
    folder_id: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    login: Option<BitwardenLogin>,
}

#[derive(Deserialize)]
struct BitwardenLogin {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    totp: Option<String>,
    #[serde(default)]
    uris: Option<Vec<BitwardenUri>>,
}

#[derive(Deserialize)]
struct BitwardenUri {
    #[serde(default)]
    uri: Option<String>,
}

fn bitwarden_login_type() -> u8 {
    1
}

pub fn parse_bitwarden_json(text: &str) -> Result<Vec<ImportCandidate>, String> {
    let export: BitwardenExport = serde_json::from_str(text).map_err(|_| {
        "Fichier JSON non reconnu. Utilisez l’export JSON de Bitwarden.".to_string()
    })?;
    if export.encrypted {
        return Err(
            "Cet export Bitwarden est chiffré. Exportez au format « JSON » non chiffré."
                .to_string(),
        );
    }
    let folders: HashMap<String, String> = export
        .folders
        .into_iter()
        .map(|folder| (folder.id, folder.name))
        .collect();

    let mut candidates = Vec::new();
    for item in export.items {
        // Seuls les identifiants (type 1) ont un mot de passe à importer.
        if item.kind != 1 {
            continue;
        }
        let Some(login) = item.login else { continue };
        let site = login
            .uris
            .unwrap_or_default()
            .into_iter()
            .find_map(|uri| uri.uri.filter(|value| !value.trim().is_empty()))
            .unwrap_or_default();
        let entry = PasswordEntry {
            plateforme: name_or_host(item.name.trim(), &site),
            email: login.username.unwrap_or_default().trim().to_string(),
            mdp: login.password.unwrap_or_default(),
            site: site.trim().to_string(),
            notes: item.notes.unwrap_or_default(),
            totp_secret: login.totp.unwrap_or_default().trim().to_string(),
            favorite: item.favorite,
            ..Default::default()
        };
        if entry.mdp.is_empty() && entry.email.is_empty() {
            continue;
        }
        let folder = item
            .folder_id
            .and_then(|id| folders.get(&id).cloned())
            .unwrap_or_default();
        candidates.push(ImportCandidate {
            categorie: category_or_default(&folder, "Bitwarden"),
            entry,
        });
    }
    Ok(candidates)
}

// ---------------------------------------------------------------------------
// KeePass 2 XML
// ---------------------------------------------------------------------------

#[derive(Default)]
struct KeePassGroup {
    uuid: String,
    name: String,
}

struct KeePassEntry {
    fields: Vec<(String, String)>,
    tags: String,
    group_path: Vec<(String, String)>,
}

pub fn parse_keepass_xml(text: &str) -> Result<Vec<ImportCandidate>, String> {
    let invalid =
        || "Fichier XML non reconnu. Utilisez l’export « KeePass XML (2.x) ».".to_string();
    let mut reader = Reader::from_str(text);
    let mut stack: Vec<String> = Vec::new();
    let mut groups: Vec<KeePassGroup> = Vec::new();
    let mut current: Option<KeePassEntry> = None;
    let mut entries: Vec<KeePassEntry> = Vec::new();
    let mut history_depth = 0usize;
    let mut text_buffer = String::new();
    let mut pending_key = String::new();
    let mut recycle_bin = String::new();
    let mut saw_root = false;

    loop {
        let event = reader.read_event().map_err(|_| invalid())?;
        match event {
            Event::Start(start) => {
                let name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
                text_buffer.clear();
                match name.as_str() {
                    "KeePassFile" => saw_root = true,
                    "Group" => groups.push(KeePassGroup::default()),
                    "History" => history_depth += 1,
                    "Entry" if history_depth == 0 => {
                        current = Some(KeePassEntry {
                            fields: Vec::new(),
                            tags: String::new(),
                            group_path: groups
                                .iter()
                                .map(|group| (group.uuid.clone(), group.name.clone()))
                                .collect(),
                        });
                    }
                    _ => {}
                }
                stack.push(name);
            }
            Event::Empty(empty) => {
                // `<Value/>` : champ présent mais vide.
                if empty.name().as_ref() == b"Value" && history_depth == 0 {
                    if let Some(entry) = current.as_mut() {
                        entry
                            .fields
                            .push((std::mem::take(&mut pending_key), String::new()));
                    }
                }
            }
            Event::Text(content) => {
                text_buffer.push_str(&content.decode().map_err(|_| invalid())?);
            }
            Event::CData(content) => {
                text_buffer.push_str(&String::from_utf8_lossy(content.as_ref()));
            }
            Event::GeneralRef(reference) => {
                if let Some(character) = reference.resolve_char_ref().map_err(|_| invalid())? {
                    text_buffer.push(character);
                } else {
                    let name = reference.decode().map_err(|_| invalid())?;
                    text_buffer.push_str(match name.as_ref() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    });
                }
            }
            Event::End(_) => {
                let name = stack.pop().unwrap_or_default();
                let parent = stack.last().map(String::as_str).unwrap_or_default();
                let value = std::mem::take(&mut text_buffer);
                match (name.as_str(), parent) {
                    ("RecycleBinUUID", "Meta") => recycle_bin = value.trim().to_string(),
                    ("UUID", "Group") => {
                        if let Some(group) = groups.last_mut() {
                            group.uuid = value.trim().to_string();
                        }
                    }
                    ("Name", "Group") => {
                        if let Some(group) = groups.last_mut() {
                            group.name = value.trim().to_string();
                        }
                    }
                    ("Group", _) => {
                        groups.pop();
                    }
                    ("History", _) => history_depth = history_depth.saturating_sub(1),
                    ("Key", "String") if history_depth == 0 => pending_key = value,
                    ("Value", "String") if history_depth == 0 => {
                        if let Some(entry) = current.as_mut() {
                            entry.fields.push((std::mem::take(&mut pending_key), value));
                        }
                    }
                    ("Tags", "Entry") if history_depth == 0 => {
                        if let Some(entry) = current.as_mut() {
                            entry.tags = value;
                        }
                    }
                    ("Entry", _) if history_depth == 0 => {
                        if let Some(entry) = current.take() {
                            entries.push(entry);
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !saw_root {
        return Err(invalid());
    }

    let mut candidates = Vec::new();
    for keepass_entry in entries {
        if !recycle_bin.is_empty()
            && keepass_entry
                .group_path
                .iter()
                .any(|(uuid, _)| *uuid == recycle_bin)
        {
            continue;
        }
        let field = |keys: &[&str]| {
            keepass_entry
                .fields
                .iter()
                .find(|(key, value)| {
                    keys.iter()
                        .any(|candidate| key.eq_ignore_ascii_case(candidate))
                        && !value.is_empty()
                })
                .map(|(_, value)| value.clone())
                .unwrap_or_default()
        };
        let site = field(&["URL"]).trim().to_string();
        let entry = PasswordEntry {
            plateforme: name_or_host(field(&["Title"]).trim(), &site),
            email: field(&["UserName"]).trim().to_string(),
            mdp: field(&["Password"]),
            site,
            notes: field(&["Notes"]),
            totp_secret: field(&["otp", "TimeOtp-Secret-Base32", "TOTP Seed"])
                .trim()
                .to_string(),
            tags: split_tags(&keepass_entry.tags),
            ..Default::default()
        };
        if entry.mdp.is_empty() && entry.email.is_empty() {
            continue;
        }
        // Le premier groupe est la racine de la base : on utilise le groupe le plus
        // profond en dessous, sinon l'espace par défaut.
        let folder = keepass_entry
            .group_path
            .iter()
            .skip(1)
            .last()
            .map(|(_, name)| name.clone())
            .unwrap_or_default();
        candidates.push(ImportCandidate {
            categorie: category_or_default(&folder, "KeePass"),
            entry,
        });
    }
    Ok(candidates)
}

// ---------------------------------------------------------------------------
// CSV : navigateurs, Bitwarden, 1Password, LastPass
// ---------------------------------------------------------------------------

pub fn parse_csv(csv_text: &str) -> Result<Vec<ImportCandidate>, String> {
    let delimiter = detect_import_delimiter(csv_text);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let normalized_headers: Vec<String> = headers.iter().map(normalize_import_header).collect();
    let find = |names: &[&str]| {
        let normalized_names: Vec<String> = names
            .iter()
            .map(|name| normalize_import_header(name))
            .collect();
        normalized_headers
            .iter()
            .position(|header| normalized_names.iter().any(|name| header == name))
    };
    let has = |name: &str| normalized_headers.iter().any(|header| header == name);
    let source = if has("grouping") && has("extra") {
        "LastPass"
    } else if has("loginuri") {
        "Bitwarden"
    } else if has("otpauth") || has("archived") {
        "1Password"
    } else {
        "navigateur"
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
    let notes_i = find(&["notes", "note", "commentaire", "comments", "extra"]);
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
    let folder_i = find(&["folder", "grouping", "group", "groupe", "dossier"]);
    let tags_i = find(&["tags", "labels", "etiquettes"]);
    let favorite_i = find(&["favorite", "fav", "favori", "favoris"]);
    let archived_i = find(&["archived"]);

    let mut candidates = Vec::new();
    for row in reader.records() {
        let row = row.map_err(|e| e.to_string())?;
        let get = |i: Option<usize>| i.and_then(|x| row.get(x)).unwrap_or("").trim().to_string();
        let site = get(url_i);
        // LastPass exporte ses notes sécurisées avec l'URL factice `http://sn`.
        if source == "LastPass" && site.eq_ignore_ascii_case("http://sn") {
            continue;
        }
        if is_truthy(&get(archived_i)) {
            continue;
        }
        let entry = PasswordEntry {
            plateforme: name_or_host(&get(name_i), &site),
            email: get(user_i),
            mdp: row.get(pass_i).unwrap_or("").to_string(),
            site,
            notes: get(notes_i),
            totp_secret: get(totp_i),
            favorite: is_truthy(&get(favorite_i)),
            tags: split_tags(&get(tags_i)),
            ..Default::default()
        };
        if entry.mdp.is_empty() && entry.email.is_empty() {
            continue;
        }
        let folder = get(folder_i);
        let folder = folder
            .rsplit(['\\', '/'])
            .find(|segment| !segment.trim().is_empty())
            .unwrap_or_default();
        candidates.push(ImportCandidate {
            categorie: category_or_default(folder, source),
            entry,
        });
    }
    Ok(candidates)
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

// ---------------------------------------------------------------------------
// Utilitaires communs
// ---------------------------------------------------------------------------

fn category_or_default(folder: &str, source: &str) -> String {
    let folder = folder.trim();
    if !folder.is_empty() {
        folder.to_string()
    } else if source == "navigateur" {
        DEFAULT_IMPORT_CATEGORY.to_string()
    } else {
        format!("Import {source}")
    }
}

fn name_or_host(name: &str, site: &str) -> String {
    if name.is_empty() {
        service_name_from_site(site)
    } else {
        name.to_string()
    }
}

fn is_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "oui" | "y"
    )
}

fn split_tags(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

fn service_name_from_site(site: &str) -> String {
    let normalized = crate::normalize_site_input(site).unwrap_or_default();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_accepts_french_chrome_headers_with_bom_and_semicolon() {
        let entries = parse_import_file(
            "\u{feff}nom;url;nom d'utilisateur;mot de passe\nGoogle;https://accounts.google.com;lea@example.fr;Secret-123!",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].categorie, DEFAULT_IMPORT_CATEGORY);
        assert_eq!(entries[0].entry.plateforme, "Google");
        assert_eq!(entries[0].entry.email, "lea@example.fr");
        assert_eq!(entries[0].entry.mdp, "Secret-123!");
        assert_eq!(entries[0].entry.site, "https://accounts.google.com");
    }

    #[test]
    fn csv_accepts_bitwarden_columns_and_maps_folders() {
        let entries = parse_import_file(
            "folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\nPerso,1,login,GitHub,,,\"https://github.com\",dev@example.fr,Secret-456!,JBSWY3DPEHPK3PXP\n,,login,Sans dossier,,,,a@b.fr,x,",
        )
        .unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].categorie, "Perso");
        assert!(entries[0].entry.favorite);
        assert_eq!(entries[0].entry.site, "https://github.com");
        assert_eq!(entries[0].entry.totp_secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(entries[1].categorie, "Import Bitwarden");
    }

    #[test]
    fn csv_uses_url_host_when_name_is_missing() {
        let entries = parse_import_file(
            "url,username,password\nhttps://example.com/login,me@example.com,Secret-789!",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry.plateforme, "example.com");
    }

    #[test]
    fn lastpass_csv_maps_grouping_extra_and_skips_secure_notes() {
        let entries = parse_import_file(
            "url,username,password,totp,extra,name,grouping,fav\nhttps://bank.fr,moi,Banque-1!,,Code agence 42,Ma banque,Finances\\Banques,1\nhttp://sn,,,,Note privée,Note,Perso,0",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].categorie, "Banques");
        assert_eq!(entries[0].entry.plateforme, "Ma banque");
        assert_eq!(entries[0].entry.notes, "Code agence 42");
        assert!(entries[0].entry.favorite);
    }

    #[test]
    fn onepassword_csv_maps_otp_tags_and_skips_archived_items() {
        let entries = parse_import_file(
            "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nGitLab,https://gitlab.com,dev,Secret-1!,otpauth://totp/GitLab?secret=JBSWY3DPEHPK3PXP,false,false,\"travail,dev\",\nAncien,https://old.com,dev,Secret-2!,,false,true,,",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].categorie, "Import 1Password");
        assert!(entries[0].entry.totp_secret.starts_with("otpauth://"));
        assert_eq!(entries[0].entry.tags, vec!["travail", "dev"]);
    }

    #[test]
    fn bitwarden_json_maps_folders_totp_and_ignores_non_logins() {
        let json = r#"{
            "encrypted": false,
            "folders": [{ "id": "f1", "name": "Banque" }],
            "items": [
                { "type": 1, "name": "Crédit", "folderId": "f1", "favorite": true, "notes": "agence",
                  "login": { "username": "moi", "password": "Secret-1!", "totp": "JBSWY3DPEHPK3PXP",
                             "uris": [{ "uri": "https://banque.fr" }] } },
                { "type": 1, "name": "", "folderId": null,
                  "login": { "username": "dev", "password": "Secret-2!", "uris": [{ "uri": "https://www.github.com" }] } },
                { "type": 2, "name": "Note", "notes": "secrète" }
            ]
        }"#;
        let entries = parse_import_file(json).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].categorie, "Banque");
        assert_eq!(entries[0].entry.totp_secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(entries[0].entry.site, "https://banque.fr");
        assert!(entries[0].entry.favorite);
        assert_eq!(entries[1].categorie, "Import Bitwarden");
        assert_eq!(entries[1].entry.plateforme, "github.com");
    }

    #[test]
    fn bitwarden_encrypted_json_is_rejected() {
        let error = parse_import_file(r#"{ "encrypted": true, "items": [] }"#).unwrap_err();
        assert!(error.contains("chiffré"));
    }

    #[test]
    fn keepass_xml_maps_groups_otp_tags_and_skips_history_and_recycle_bin() {
        let xml = r#"<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
  <Meta><RecycleBinUUID>BIN</RecycleBinUUID></Meta>
  <Root>
    <Group>
      <UUID>ROOT</UUID><Name>Base</Name>
      <Entry>
        <String><Key>Title</Key><Value>Racine</Value></String>
        <String><Key>Password</Key><Value>Root-1!</Value></String>
      </Entry>
      <Group>
        <UUID>WORK</UUID><Name>Travail</Name>
        <Entry>
          <Tags>pro;vpn</Tags>
          <String><Key>Title</Key><Value>VPN &amp; Mail</Value></String>
          <String><Key>UserName</Key><Value>moi</Value></String>
          <String><Key>Password</Key><Value Protected="True"> a&lt;b </Value></String>
          <String><Key>URL</Key><Value>https://vpn.example.com</Value></String>
          <String><Key>Notes</Key><Value/></String>
          <String><Key>otp</Key><Value>otpauth://totp/VPN?secret=JBSWY3DPEHPK3PXP</Value></String>
          <History>
            <Entry>
              <String><Key>Title</Key><Value>Ancienne version</Value></String>
              <String><Key>Password</Key><Value>old</Value></String>
            </Entry>
          </History>
        </Entry>
      </Group>
      <Group>
        <UUID>BIN</UUID><Name>Corbeille</Name>
        <Entry>
          <String><Key>Title</Key><Value>Supprimé</Value></String>
          <String><Key>Password</Key><Value>gone</Value></String>
        </Entry>
      </Group>
    </Group>
  </Root>
</KeePassFile>"#;
        let entries = parse_import_file(xml).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].categorie, "Import KeePass");
        assert_eq!(entries[0].entry.plateforme, "Racine");
        assert_eq!(entries[1].categorie, "Travail");
        assert_eq!(entries[1].entry.plateforme, "VPN & Mail");
        assert_eq!(entries[1].entry.mdp, " a<b ");
        assert_eq!(entries[1].entry.email, "moi");
        assert_eq!(entries[1].entry.tags, vec!["pro", "vpn"]);
        assert!(entries[1].entry.totp_secret.contains("JBSWY3DPEHPK3PXP"));
    }

    #[test]
    fn unrelated_xml_is_rejected() {
        assert!(parse_import_file("<html><body></body></html>").is_err());
    }
}
