use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;

const AUTH_VERSION: u8 = 2;
const BACKUP_VERSION: u8 = 2;
const LEGACY_BACKUP_VERSION: u8 = 1;
/// v4 : le document logique complet (entrées, catégories, favoris, dates,
/// historique, corbeille) est chiffré en un seul bloc AES-256-GCM dont la
/// version et le format sont authentifiés (données associées).
const VAULT_VERSION: u8 = 4;
const VAULT_FORMAT: &str = "clave-vault";
const VAULT_CIPHER: &str = "AES-256-GCM";
const KDF_ITERATIONS: u32 = 210_000;
/// Bornes appliquées à tout paramètre KDF lu depuis un fichier, avant dérivation.
const MIN_KDF_ITERATIONS: u32 = 100_000;
const MAX_KDF_ITERATIONS: u32 = 5_000_000;
const MIN_SALT_BYTES: usize = 16;
const MAX_SALT_BYTES: usize = 64;
/// Taille maximale d’une sauvegarde ou d’un fichier d’import.
pub const MAX_IMPORT_BYTES: usize = 32 * 1024 * 1024;
const AUTH_VERIFIER: &[u8] = b"clave-auth-v1";
const KDF_NAME: &str = "PBKDF2-HMAC-SHA256";
const RECOVERY_KEY_BYTES: usize = 20;
const MAX_TAGS: usize = 12;
const MAX_TAG_LENGTH: usize = 32;
pub const PURGE_AFTER_SECONDS: u64 = 30 * 24 * 60 * 60;

pub type CategoryMap = BTreeMap<String, Vec<PasswordEntry>>;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordEntry {
    pub plateforme: String,
    pub email: String,
    pub mdp: String,
    #[serde(default)]
    pub site: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub totp_secret: String,
    #[serde(default)]
    pub icon_url: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub last_accessed: u64,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityRecord {
    pub categorie: String,
    pub action: String,
    pub entry: PasswordEntry,
    pub timestamp: u64,
    #[serde(default)]
    pub entry_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashRecord {
    pub categorie: String,
    pub entry: PasswordEntry,
    pub timestamp: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct VaultState {
    categories: CategoryMap,
    #[serde(default)]
    history: Vec<ActivityRecord>,
    #[serde(default)]
    trash: Vec<TrashRecord>,
}

/// Coffre v4 sur disque : seul l’en-tête est lisible, et il est authentifié.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SealedVault {
    version: u8,
    encrypted: bool,
    format: String,
    cipher: String,
    payload: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub configured: bool,
    pub unlocked: bool,
    pub recovery_configured: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthFile {
    version: u8,
    kdf: String,
    iterations: u32,
    salt: String,
    verifier: String,
    wrapped_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recovery: Option<KeySlot>,
}

/// Second emplacement de clé : la clé du coffre chiffrée par la clé de récupération.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeySlot {
    kdf: String,
    iterations: u32,
    salt: String,
    wrapped_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BackupFile {
    version: u8,
    kdf: String,
    iterations: u32,
    salt: String,
    payload: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedVault {
    version: u8,
    encrypted: bool,
    categories: BTreeMap<String, Vec<EncryptedEntry>>,
    #[serde(default)]
    history: Vec<EncryptedActivityRecord>,
    #[serde(default)]
    trash: Vec<EncryptedTrashRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedEntry {
    plateforme: String,
    email: String,
    mdp: String,
    #[serde(default)]
    site: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    totp_secret: String,
    #[serde(default)]
    icon_url: String,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
    #[serde(default)]
    last_accessed: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedActivityRecord {
    categorie: String,
    action: String,
    entry: EncryptedEntry,
    timestamp: u64,
    #[serde(default)]
    entry_index: usize,
}
#[derive(Debug, Serialize, Deserialize)]
struct EncryptedTrashRecord {
    categorie: String,
    entry: EncryptedEntry,
    timestamp: u64,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("Erreur fichier: {0}")]
    Io(#[from] std::io::Error),
    #[error("Erreur JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Erreur cryptographique.")]
    Crypto,
    #[error("Cle de chiffrement invalide.")]
    InvalidKey,
    #[error("Le coffre est verrouille.")]
    Locked,
    #[error("Mot de passe maitre deja configure.")]
    AuthAlreadyConfigured,
    #[error("Mot de passe maitre non configure.")]
    AuthNotConfigured,
    #[error("Mot de passe maitre incorrect.")]
    InvalidPassword,
    #[error("Element introuvable.")]
    NotFound,
    #[error("Cle de recuperation incorrecte.")]
    InvalidRecoveryKey,
    #[error("Aucune cle de recuperation n'est configuree pour ce coffre.")]
    RecoveryNotConfigured,
    #[error("Parametres de derivation de cle refuses.")]
    UnsupportedKdf,
    #[error("Format de fichier non pris en charge.")]
    UnsupportedFormat,
    #[error("Fichier trop volumineux.")]
    TooLarge,
}

pub struct PasswordStore {
    data_file: PathBuf,
    key_file: PathBuf,
    auth_file: PathBuf,
    vault_key: Option<[u8; 32]>,
}

impl PasswordStore {
    pub fn new(data_file: PathBuf, key_file: PathBuf, auth_file: PathBuf) -> Self {
        Self {
            data_file,
            key_file,
            auth_file,
            vault_key: None,
        }
    }

    pub fn auth_status(&self) -> AuthStatus {
        AuthStatus {
            configured: self.auth_file.exists(),
            unlocked: self.vault_key.is_some(),
            recovery_configured: self
                .read_auth_file()
                .map(|auth| auth.recovery.is_some())
                .unwrap_or(false),
        }
    }

    /// Crée le coffre et renvoie la clé de récupération à imprimer.
    pub fn setup_master_password(&mut self, password: String) -> Result<String, StoreError> {
        if self.auth_file.exists() {
            return Err(StoreError::AuthAlreadyConfigured);
        }

        if password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        let vault_key = self.load_legacy_key()?.unwrap_or_else(Self::generate_key);
        let recovery_key = Self::generate_recovery_key();
        let recovery =
            Self::build_key_slot(&Self::normalize_recovery_key(&recovery_key), &vault_key)?;
        let auth = Self::build_auth_file(&password, &vault_key, Some(recovery))?;
        self.write_auth_file(&auth)?;
        self.vault_key = Some(vault_key);

        if self.key_file.exists() {
            fs::remove_file(&self.key_file)?;
        }

        Ok(recovery_key)
    }

    /// Ajoute ou remplace l'emplacement de récupération. Sert aussi à migrer
    /// les coffres créés avant l'existence du kit de secours.
    pub fn create_recovery_key(&mut self, password: String) -> Result<String, StoreError> {
        self.unlock(password)?;
        let vault_key = self.require_key()?;
        let mut auth = self.read_auth_file()?;
        let recovery_key = Self::generate_recovery_key();
        auth.recovery = Some(Self::build_key_slot(
            &Self::normalize_recovery_key(&recovery_key),
            &vault_key,
        )?);
        auth.version = AUTH_VERSION;
        self.write_auth_file(&auth)?;
        Ok(recovery_key)
    }

    /// Ouvre le coffre avec la clé de récupération et définit un nouveau mot de passe maître.
    /// L'emplacement de récupération est conservé : la même clé reste valable.
    pub fn recover_with_key(
        &mut self,
        recovery_key: String,
        new_password: String,
    ) -> Result<(), StoreError> {
        if !self.auth_file.exists() {
            return Err(StoreError::AuthNotConfigured);
        }
        if new_password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        let auth = self.read_auth_file()?;
        let slot = auth.recovery.ok_or(StoreError::RecoveryNotConfigured)?;
        let normalized = Self::normalize_recovery_key(&recovery_key);
        if normalized.is_empty() {
            return Err(StoreError::InvalidRecoveryKey);
        }
        let salt = Self::checked_kdf(&slot.kdf, slot.iterations, &slot.salt)?;
        let kek = Self::derive_key_from_parts(&normalized, &salt, slot.iterations);
        let unwrapped = Self::decrypt_payload(&kek, &slot.wrapped_key)
            .map_err(|_| StoreError::InvalidRecoveryKey)?;
        let vault_key: [u8; 32] = unwrapped.try_into().map_err(|_| StoreError::InvalidKey)?;

        let rebuilt = Self::build_auth_file(&new_password, &vault_key, Some(slot))?;
        self.write_auth_file(&rebuilt)?;
        self.vault_key = Some(vault_key);
        Ok(())
    }

    pub fn unlock(&mut self, password: String) -> Result<(), StoreError> {
        if !self.auth_file.exists() {
            return Err(StoreError::AuthNotConfigured);
        }

        let auth = self.read_auth_file()?;
        let kek = Self::derive_key(&password, &auth)?;
        let verifier =
            Self::decrypt_payload(&kek, &auth.verifier).map_err(|_| StoreError::InvalidPassword)?;

        if verifier != AUTH_VERIFIER {
            return Err(StoreError::InvalidPassword);
        }

        let unwrapped = Self::decrypt_payload(&kek, &auth.wrapped_key)
            .map_err(|_| StoreError::InvalidPassword)?;
        let vault_key: [u8; 32] = unwrapped.try_into().map_err(|_| StoreError::InvalidKey)?;

        self.vault_key = Some(vault_key);
        Ok(())
    }

    pub fn change_master_password(
        &mut self,
        current_password: String,
        new_password: String,
    ) -> Result<(), StoreError> {
        if new_password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        self.unlock(current_password)?;
        let vault_key = self.require_key()?;
        let recovery = self.read_auth_file()?.recovery;
        let auth = Self::build_auth_file(&new_password, &vault_key, recovery)?;
        self.write_auth_file(&auth)?;
        Ok(())
    }

    pub fn lock(&mut self) {
        self.vault_key = None;
    }

    pub fn load(&self) -> Result<CategoryMap, StoreError> {
        Ok(self.load_state()?.categories)
    }

    fn load_state(&self) -> Result<VaultState, StoreError> {
        if self.auth_file.exists() {
            self.require_key()?;
        }

        let raw = self.read_raw()?;

        if raw.trim().is_empty() {
            return Ok(VaultState::default());
        }

        let value: serde_json::Value = serde_json::from_str(&raw)?;
        let encrypted = value
            .get("encrypted")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let version = value
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        if encrypted && version == u64::from(VAULT_VERSION) {
            let sealed: SealedVault = serde_json::from_value(value)?;
            let mut state = self.open_sealed_vault(&sealed)?;
            Self::normalize_state(&mut state);
            return Ok(state);
        }
        if encrypted && version > u64::from(VAULT_VERSION) {
            return Err(StoreError::UnsupportedFormat);
        }
        if encrypted {
            // Coffre v3 et antérieurs (métadonnées en clair) : lu puis
            // immédiatement réécrit au format scellé v4.
            let vault: EncryptedVault = serde_json::from_value(value)?;
            let categories = self.decrypt_categories(vault.categories)?;
            let history = vault
                .history
                .into_iter()
                .map(|r| {
                    Ok(ActivityRecord {
                        categorie: r.categorie,
                        action: r.action,
                        entry: self.decrypt_entry(r.entry)?,
                        timestamp: r.timestamp,
                        entry_index: r.entry_index,
                    })
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
            let trash = vault
                .trash
                .into_iter()
                .map(|r| {
                    Ok(TrashRecord {
                        categorie: r.categorie,
                        entry: self.decrypt_entry(r.entry)?,
                        timestamp: r.timestamp,
                    })
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
            let mut state = VaultState {
                categories,
                history,
                trash,
            };
            Self::normalize_state(&mut state);
            self.save_state(&state)?;
            return Ok(state);
        }

        let plaintext: CategoryMap = serde_json::from_str(&raw)?;
        let state = VaultState {
            categories: plaintext,
            ..Default::default()
        };
        self.save_state(&state)?;
        Ok(state)
    }

    pub fn save(&self, categories: &CategoryMap) -> Result<(), StoreError> {
        let mut state = self.load_state().unwrap_or_default();
        state.categories = categories.clone();
        self.save_state(&state)
    }

    fn normalize_state(state: &mut VaultState) {
        let now = Self::now();
        for entries in state.categories.values_mut() {
            for entry in entries {
                if entry.created_at == 0 {
                    entry.created_at = now;
                }
                if entry.updated_at == 0 {
                    entry.updated_at = entry.created_at;
                }
            }
        }
        state
            .trash
            .retain(|item| now.saturating_sub(item.timestamp) < PURGE_AFTER_SECONDS);
    }

    fn vault_associated_data() -> Vec<u8> {
        format!("{VAULT_FORMAT}|v{VAULT_VERSION}|{VAULT_CIPHER}").into_bytes()
    }

    fn open_sealed_vault(&self, sealed: &SealedVault) -> Result<VaultState, StoreError> {
        if sealed.format != VAULT_FORMAT || sealed.cipher != VAULT_CIPHER || !sealed.encrypted {
            return Err(StoreError::UnsupportedFormat);
        }
        let plaintext = Self::decrypt_payload_with_aad(
            &self.require_key()?,
            &sealed.payload,
            &Self::vault_associated_data(),
        )?;
        Ok(serde_json::from_slice(&plaintext)?)
    }

    fn save_state(&self, state: &VaultState) -> Result<(), StoreError> {
        let plaintext = serde_json::to_vec(state)?;
        let sealed = SealedVault {
            version: VAULT_VERSION,
            encrypted: true,
            format: VAULT_FORMAT.to_string(),
            cipher: VAULT_CIPHER.to_string(),
            payload: Self::encrypt_payload_with_aad(
                &self.require_key()?,
                &plaintext,
                &Self::vault_associated_data(),
            )?,
        };
        self.write_json(&sealed)
    }

    pub fn add_password(
        &self,
        categorie: String,
        mut entry: PasswordEntry,
    ) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        let now = Self::now();
        entry.tags = normalize_tags(&entry.tags);
        if entry.created_at == 0 {
            entry.created_at = now;
        }
        entry.updated_at = now;
        let entry_index = state.categories.get(&categorie).map_or(0, Vec::len);
        state
            .categories
            .entry(categorie.clone())
            .or_default()
            .push(entry.clone());
        state.history.push(ActivityRecord {
            categorie,
            action: "creation".into(),
            entry,
            timestamp: now,
            entry_index,
        });
        self.save_state(&state)
    }

    /// Ajoute plusieurs accès en une seule écriture (imports).
    pub fn add_passwords(&self, items: Vec<(String, PasswordEntry)>) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        let now = Self::now();
        for (categorie, mut entry) in items {
            entry.tags = normalize_tags(&entry.tags);
            if entry.created_at == 0 {
                entry.created_at = now;
            }
            entry.updated_at = now;
            let entries = state.categories.entry(categorie.clone()).or_default();
            let entry_index = entries.len();
            entries.push(entry.clone());
            state.history.push(ActivityRecord {
                categorie,
                action: "creation".into(),
                entry,
                timestamp: now,
                entry_index,
            });
        }
        self.save_state(&state)
    }

    pub fn update_password(
        &self,
        categorie: String,
        index: usize,
        mut entry: PasswordEntry,
    ) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        let entries = state
            .categories
            .get_mut(&categorie)
            .ok_or(StoreError::NotFound)?;
        let current = entries.get_mut(index).ok_or(StoreError::NotFound)?;
        let previous = current.clone();
        entry.tags = normalize_tags(&entry.tags);
        entry.created_at = previous.created_at;
        entry.updated_at = Self::now();
        entry.last_accessed = previous.last_accessed;
        entry.favorite = previous.favorite;
        *current = entry;
        state.history.push(ActivityRecord {
            categorie,
            action: "modification".into(),
            entry: previous,
            timestamp: Self::now(),
            entry_index: index,
        });
        self.save_state(&state)
    }

    pub fn delete_password(&self, categorie: String, index: usize) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        let entries = state
            .categories
            .get_mut(&categorie)
            .ok_or(StoreError::NotFound)?;

        if index >= entries.len() {
            return Err(StoreError::NotFound);
        }

        let entry = entries.remove(index);
        let timestamp = Self::now();
        state.history.push(ActivityRecord {
            categorie: categorie.clone(),
            action: "suppression".into(),
            entry: entry.clone(),
            timestamp,
            entry_index: index,
        });
        state.trash.push(TrashRecord {
            categorie,
            entry,
            timestamp,
        });
        self.save_state(&state)
    }

    /// Fusionne deux doublons : `keep` reçoit le mot de passe le plus récent,
    /// les notes combinées et le secret 2FA manquant ; `drop` part à la
    /// corbeille. L'ancienne version de `keep` reste dans l'historique.
    pub fn merge_duplicates(
        &self,
        keep_category: String,
        keep_index: usize,
        drop_category: String,
        drop_index: usize,
    ) -> Result<(), StoreError> {
        if keep_category == drop_category && keep_index == drop_index {
            return Err(StoreError::NotFound);
        }
        let mut state = self.load_state()?;
        let dropped = state
            .categories
            .get(&drop_category)
            .and_then(|entries| entries.get(drop_index))
            .cloned()
            .ok_or(StoreError::NotFound)?;
        let current = state
            .categories
            .get_mut(&keep_category)
            .and_then(|entries| entries.get_mut(keep_index))
            .ok_or(StoreError::NotFound)?;
        let previous = current.clone();
        let now = Self::now();

        let mut merged = merge_entries(&previous, &dropped);
        merged.updated_at = now;
        *current = merged;

        state.history.push(ActivityRecord {
            categorie: keep_category,
            action: "modification".into(),
            entry: previous,
            timestamp: now,
            entry_index: keep_index,
        });
        // Retrait après la mise à jour : `keep_index` reste valide même si
        // les deux entrées partagent la catégorie.
        let removed = state
            .categories
            .get_mut(&drop_category)
            .ok_or(StoreError::NotFound)?
            .remove(drop_index);
        state.history.push(ActivityRecord {
            categorie: drop_category.clone(),
            action: "suppression".into(),
            entry: removed.clone(),
            timestamp: now,
            entry_index: drop_index,
        });
        state.trash.push(TrashRecord {
            categorie: drop_category,
            entry: removed,
            timestamp: now,
        });
        self.save_state(&state)
    }

    pub fn history(&self) -> Result<Vec<ActivityRecord>, StoreError> {
        Ok(self.load_state()?.history)
    }
    pub fn trash(&self) -> Result<Vec<TrashRecord>, StoreError> {
        Ok(self.load_state()?.trash)
    }
    pub fn restore_trash(&self, index: usize) -> Result<CategoryMap, StoreError> {
        let mut state = self.load_state()?;
        if index >= state.trash.len() {
            return Err(StoreError::NotFound);
        }
        let item = state.trash.remove(index);
        state
            .categories
            .entry(item.categorie.clone())
            .or_default()
            .push(item.entry.clone());
        let entry_index = state
            .categories
            .get(&item.categorie)
            .map_or(0, |entries| entries.len().saturating_sub(1));
        state.history.push(ActivityRecord {
            categorie: item.categorie,
            action: "restauration".into(),
            entry: item.entry,
            timestamp: Self::now(),
            entry_index,
        });
        self.save_state(&state)?;
        Ok(state.categories)
    }

    pub fn empty_trash(&self) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        state.trash.clear();
        self.save_state(&state)
    }

    pub fn delete_trash(&self, index: usize) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        if index >= state.trash.len() {
            return Err(StoreError::NotFound);
        }
        state.trash.remove(index);
        self.save_state(&state)
    }

    pub fn restore_history(&self, index: usize) -> Result<CategoryMap, StoreError> {
        let mut state = self.load_state()?;
        let item = state
            .history
            .get(index)
            .cloned()
            .ok_or(StoreError::NotFound)?;
        let entries = state.categories.entry(item.categorie.clone()).or_default();
        let mut restored = item.entry.clone();
        restored.updated_at = Self::now();
        if item.entry_index < entries.len() {
            entries[item.entry_index] = restored.clone();
        } else {
            entries.push(restored.clone());
        }
        state.history.push(ActivityRecord {
            categorie: item.categorie,
            action: "restauration historique".into(),
            entry: restored,
            timestamp: Self::now(),
            entry_index: item.entry_index,
        });
        self.save_state(&state)?;
        Ok(state.categories)
    }

    pub fn set_favorite(
        &self,
        categorie: String,
        index: usize,
        favorite: bool,
    ) -> Result<CategoryMap, StoreError> {
        let mut state = self.load_state()?;
        let entry = state
            .categories
            .get_mut(&categorie)
            .and_then(|entries| entries.get_mut(index))
            .ok_or(StoreError::NotFound)?;
        entry.favorite = favorite;
        entry.updated_at = Self::now();
        self.save_state(&state)?;
        Ok(state.categories)
    }

    pub fn mark_accessed(&self, categorie: String, index: usize) -> Result<(), StoreError> {
        let mut state = self.load_state()?;
        let entry = state
            .categories
            .get_mut(&categorie)
            .and_then(|entries| entries.get_mut(index))
            .ok_or(StoreError::NotFound)?;
        entry.last_accessed = Self::now();
        self.save_state(&state)
    }

    pub fn add_category(&self, categorie: String) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        categories.entry(categorie).or_default();
        self.save(&categories)
    }

    pub fn rename_category(&self, old_name: String, new_name: String) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        if old_name == new_name || new_name.trim().is_empty() {
            return Ok(());
        }

        if let Some(entries) = categories.remove(&old_name) {
            categories.insert(new_name, entries);
            self.save(&categories)?;
        }

        Ok(())
    }

    pub fn delete_category(&self, categorie: String) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        categories.remove(&categorie);

        if categories.is_empty() {
            categories.insert("Perso".to_string(), Vec::new());
        }

        self.save(&categories)
    }

    fn backup_associated_data(version: u8, kdf: &str, iterations: u32, salt: &str) -> Vec<u8> {
        format!("clave-backup|v{version}|{kdf}|{iterations}|{salt}").into_bytes()
    }

    pub fn export_backup(&self, password: String) -> Result<String, StoreError> {
        if password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        let categories = self.load()?;
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key = Self::derive_key_from_parts(&password, &salt, KDF_ITERATIONS);
        let payload = serde_json::to_vec(&categories)?;
        let salt = STANDARD.encode(salt);
        let aad = Self::backup_associated_data(BACKUP_VERSION, KDF_NAME, KDF_ITERATIONS, &salt);

        let backup = BackupFile {
            version: BACKUP_VERSION,
            kdf: KDF_NAME.to_string(),
            iterations: KDF_ITERATIONS,
            payload: Self::encrypt_payload_with_aad(&key, &payload, &aad)?,
            salt,
        };

        serde_json::to_string_pretty(&backup).map_err(StoreError::from)
    }

    pub fn import_backup(
        &self,
        password: String,
        backup_json: String,
    ) -> Result<CategoryMap, StoreError> {
        if backup_json.len() > MAX_IMPORT_BYTES {
            return Err(StoreError::TooLarge);
        }
        // Tous les paramètres sont validés avant la moindre dérivation coûteuse.
        let backup: BackupFile =
            serde_json::from_str(&backup_json).map_err(|_| StoreError::UnsupportedFormat)?;
        if backup.version != BACKUP_VERSION && backup.version != LEGACY_BACKUP_VERSION {
            return Err(StoreError::UnsupportedFormat);
        }
        let salt = Self::checked_kdf(&backup.kdf, backup.iterations, &backup.salt)?;
        let key = Self::derive_key_from_parts(&password, &salt, backup.iterations);
        let decrypted = if backup.version == LEGACY_BACKUP_VERSION {
            Self::decrypt_payload(&key, &backup.payload)
        } else {
            let aad = Self::backup_associated_data(
                backup.version,
                &backup.kdf,
                backup.iterations,
                backup.salt.trim(),
            );
            Self::decrypt_payload_with_aad(&key, &backup.payload, &aad)
        }
        .map_err(|_| StoreError::InvalidPassword)?;
        let categories: CategoryMap = serde_json::from_slice(&decrypted)?;

        self.save(&categories)?;
        Ok(categories)
    }

    /// Valide nom du KDF, nombre d’itérations et sel, puis renvoie le sel décodé.
    fn checked_kdf(kdf: &str, iterations: u32, salt: &str) -> Result<Vec<u8>, StoreError> {
        if kdf != KDF_NAME || !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&iterations) {
            return Err(StoreError::UnsupportedKdf);
        }
        if salt.len() > MAX_SALT_BYTES * 2 {
            return Err(StoreError::UnsupportedKdf);
        }
        let salt = STANDARD
            .decode(salt.trim())
            .map_err(|_| StoreError::UnsupportedKdf)?;
        if !(MIN_SALT_BYTES..=MAX_SALT_BYTES).contains(&salt.len()) {
            return Err(StoreError::UnsupportedKdf);
        }
        Ok(salt)
    }

    pub fn generate_password() -> String {
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(20)
            .map(char::from)
            .collect()
    }

    fn read_raw(&self) -> Result<String, StoreError> {
        if !self.data_file.exists() {
            return Ok(String::new());
        }

        Ok(fs::read_to_string(&self.data_file)?)
    }

    fn write_json<T: Serialize>(&self, value: &T) -> Result<(), StoreError> {
        if let Some(parent) = self.data_file.parent() {
            fs::create_dir_all(parent)?;
        }

        Self::write_atomically(&self.data_file, serde_json::to_string_pretty(value)?.as_bytes())
    }

    fn write_auth_file(&self, auth: &AuthFile) -> Result<(), StoreError> {
        if let Some(parent) = self.auth_file.parent() {
            fs::create_dir_all(parent)?;
        }

        Self::write_atomically(&self.auth_file, serde_json::to_string_pretty(auth)?.as_bytes())
    }

    /// Écrit dans un fichier temporaire puis le renomme : une coupure pendant
    /// l’écriture ne laisse jamais un coffre tronqué.
    fn write_atomically(path: &std::path::Path, bytes: &[u8]) -> Result<(), StoreError> {
        let mut temporary = path.as_os_str().to_owned();
        temporary.push(".tmp");
        let temporary = PathBuf::from(temporary);
        fs::write(&temporary, bytes)?;
        fs::rename(&temporary, path)?;
        Ok(())
    }

    fn read_auth_file(&self) -> Result<AuthFile, StoreError> {
        let raw = fs::read_to_string(&self.auth_file)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn build_auth_file(
        password: &str,
        vault_key: &[u8; 32],
        recovery: Option<KeySlot>,
    ) -> Result<AuthFile, StoreError> {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let kek = Self::derive_key_from_parts(password, &salt, KDF_ITERATIONS);

        Ok(AuthFile {
            version: AUTH_VERSION,
            kdf: KDF_NAME.to_string(),
            iterations: KDF_ITERATIONS,
            salt: STANDARD.encode(salt),
            verifier: Self::encrypt_payload(&kek, AUTH_VERIFIER)?,
            wrapped_key: Self::encrypt_payload(&kek, vault_key)?,
            recovery,
        })
    }

    fn build_key_slot(secret: &str, vault_key: &[u8; 32]) -> Result<KeySlot, StoreError> {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let kek = Self::derive_key_from_parts(secret, &salt, KDF_ITERATIONS);
        Ok(KeySlot {
            kdf: KDF_NAME.to_string(),
            iterations: KDF_ITERATIONS,
            salt: STANDARD.encode(salt),
            wrapped_key: Self::encrypt_payload(&kek, vault_key)?,
        })
    }

    /// 160 bits aléatoires en Base32, groupés par 4 : `ABCD-EFGH-…` (8 groupes).
    fn generate_recovery_key() -> String {
        let mut bytes = [0u8; RECOVERY_KEY_BYTES];
        OsRng.fill_bytes(&mut bytes);
        data_encoding::BASE32_NOPAD
            .encode(&bytes)
            .as_bytes()
            .chunks(4)
            .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
            .collect::<Vec<_>>()
            .join("-")
    }

    /// Tolère tirets, espaces, minuscules et confusions 0/O, 1/I, 8/B à la saisie.
    fn normalize_recovery_key(value: &str) -> String {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .map(|character| match character.to_ascii_uppercase() {
                '0' => 'O',
                '1' => 'I',
                '8' => 'B',
                other => other,
            })
            .collect()
    }

    fn decrypt_categories(
        &self,
        categories: BTreeMap<String, Vec<EncryptedEntry>>,
    ) -> Result<CategoryMap, StoreError> {
        let mut decrypted = CategoryMap::new();

        for (category, entries) in categories {
            let decrypted_entries = entries
                .into_iter()
                .map(|entry| self.decrypt_entry(entry))
                .collect::<Result<Vec<_>, StoreError>>()?;

            decrypted.insert(category, decrypted_entries);
        }

        Ok(decrypted)
    }

    fn decrypt_entry(&self, entry: EncryptedEntry) -> Result<PasswordEntry, StoreError> {
        Ok(PasswordEntry {
            plateforme: entry.plateforme,
            email: entry.email,
            mdp: self.decrypt_text(&entry.mdp)?,
            site: entry.site,
            notes: if entry.notes.is_empty() {
                String::new()
            } else {
                self.decrypt_text(&entry.notes)?
            },
            totp_secret: if entry.totp_secret.is_empty() {
                String::new()
            } else {
                self.decrypt_text(&entry.totp_secret)?
            },
            icon_url: entry.icon_url,
            favorite: entry.favorite,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            last_accessed: entry.last_accessed,
            tags: entry.tags,
        })
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn decrypt_text(&self, value: &str) -> Result<String, StoreError> {
        let decrypted = Self::decrypt_payload(&self.require_key()?, value)?;
        String::from_utf8(decrypted).map_err(|_| StoreError::Crypto)
    }

    fn require_key(&self) -> Result<[u8; 32], StoreError> {
        self.vault_key.ok_or(StoreError::Locked)
    }

    fn encrypt_payload(key: &[u8; 32], value: &[u8]) -> Result<String, StoreError> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::InvalidKey)?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), value)
            .map_err(|_| StoreError::Crypto)?;

        let mut payload = nonce_bytes.to_vec();
        payload.extend(encrypted);
        Ok(STANDARD.encode(payload))
    }

    fn encrypt_payload_with_aad(
        key: &[u8; 32],
        value: &[u8],
        aad: &[u8],
    ) -> Result<String, StoreError> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::InvalidKey)?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: value, aad })
            .map_err(|_| StoreError::Crypto)?;
        let mut payload = nonce_bytes.to_vec();
        payload.extend(encrypted);
        Ok(STANDARD.encode(payload))
    }

    fn decrypt_payload_with_aad(
        key: &[u8; 32],
        value: &str,
        aad: &[u8],
    ) -> Result<Vec<u8>, StoreError> {
        let payload = STANDARD.decode(value).map_err(|_| StoreError::Crypto)?;
        if payload.len() < 13 {
            return Err(StoreError::Crypto);
        }
        let (nonce_bytes, encrypted) = payload.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::InvalidKey)?;
        cipher
            .decrypt(Nonce::from_slice(nonce_bytes), Payload { msg: encrypted, aad })
            .map_err(|_| StoreError::Crypto)
    }

    fn decrypt_payload(key: &[u8; 32], value: &str) -> Result<Vec<u8>, StoreError> {
        let payload = STANDARD.decode(value).map_err(|_| StoreError::Crypto)?;
        if payload.len() < 13 {
            return Err(StoreError::Crypto);
        }

        let (nonce_bytes, encrypted) = payload.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StoreError::InvalidKey)?;
        cipher
            .decrypt(Nonce::from_slice(nonce_bytes), encrypted)
            .map_err(|_| StoreError::Crypto)
    }

    fn derive_key(password: &str, auth: &AuthFile) -> Result<[u8; 32], StoreError> {
        let salt = Self::checked_kdf(&auth.kdf, auth.iterations, &auth.salt)?;
        Ok(Self::derive_key_from_parts(
            password,
            &salt,
            auth.iterations,
        ))
    }

    fn derive_key_from_parts(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
        key
    }

    fn generate_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        key
    }

    fn load_legacy_key(&self) -> Result<Option<[u8; 32]>, StoreError> {
        if !self.key_file.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(&self.key_file)?;
        let bytes = STANDARD
            .decode(raw.trim())
            .map_err(|_| StoreError::InvalidKey)?;
        Ok(Some(bytes.try_into().map_err(|_| StoreError::InvalidKey)?))
    }
}

/// Étiquettes en minuscules, sans `#`, sans doublon, en nombre et longueur bornés.
fn merge_entries(keep: &PasswordEntry, other: &PasswordEntry) -> PasswordEntry {
    let fill = |primary: &str, fallback: &str| {
        if primary.trim().is_empty() {
            fallback.to_string()
        } else {
            primary.to_string()
        }
    };
    let mut merged = keep.clone();
    if (other.updated_at > keep.updated_at && !other.mdp.is_empty()) || keep.mdp.is_empty() {
        merged.mdp = other.mdp.clone();
    }
    let (a, b) = (keep.notes.trim(), other.notes.trim());
    merged.notes = if b.is_empty() || a.contains(b) {
        keep.notes.clone()
    } else if a.is_empty() || b.contains(a) {
        other.notes.clone()
    } else {
        format!("{a}\n\n{b}")
    };
    merged.totp_secret = fill(&keep.totp_secret, &other.totp_secret);
    merged.site = fill(&keep.site, &other.site);
    merged.plateforme = fill(&keep.plateforme, &other.plateforme);
    merged.icon_url = fill(&keep.icon_url, &other.icon_url);
    merged.favorite = keep.favorite || other.favorite;
    merged.created_at = match (keep.created_at, other.created_at) {
        (0, other) => other,
        (own, 0) => own,
        (own, other) => own.min(other),
    };
    merged.last_accessed = keep.last_accessed.max(other.last_accessed);
    let tags: Vec<String> = keep.tags.iter().chain(&other.tags).cloned().collect();
    merged.tags = normalize_tags(&tags);
    merged
}

pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for tag in tags {
        let value: String = tag
            .trim()
            .trim_start_matches('#')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase()
            .chars()
            .take(MAX_TAG_LENGTH)
            .collect();
        if !value.is_empty() && !normalized.contains(&value) {
            normalized.push(value);
        }
        if normalized.len() >= MAX_TAGS {
            break;
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn vault_metadata_is_sealed_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        store
            .add_password(
                "Banque secrète".to_string(),
                PasswordEntry {
                    plateforme: "MaBanque".to_string(),
                    email: "lea@example.fr".to_string(),
                    mdp: "secret-123".to_string(),
                    site: "https://banque.example".to_string(),
                    tags: vec!["finances".to_string()],
                    favorite: true,
                    ..Default::default()
                },
            )
            .unwrap();
        let raw = fs::read_to_string(dir.path().join("passwords.json")).unwrap();
        for leaked in ["MaBanque", "lea@example.fr", "banque.example", "finances", "secrète", "creation", "favorite"] {
            assert!(!raw.contains(leaked), "{leaked} est lisible");
        }
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["version"], 4);

        // La version est authentifiée : la modifier rend le coffre illisible.
        let tampered = raw.replace("\"format\": \"clave-vault\"", "\"format\": \"autre\"");
        fs::write(dir.path().join("passwords.json"), tampered).unwrap();
        assert!(store.load().is_err());
    }

    #[test]
    fn legacy_v3_vault_is_migrated_to_the_sealed_format() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        let key = store.require_key().unwrap();
        let legacy = serde_json::json!({
            "version": 3,
            "encrypted": true,
            "categories": { "Perso": [{
                "plateforme": "Gmail",
                "email": "user@example.com",
                "mdp": PasswordStore::encrypt_payload(&key, b"ancien").unwrap(),
            }]}
        });
        fs::write(dir.path().join("passwords.json"), legacy.to_string()).unwrap();
        let categories = store.load().unwrap();
        assert_eq!(categories["Perso"][0].mdp, "ancien");
        let raw = fs::read_to_string(dir.path().join("passwords.json")).unwrap();
        assert!(!raw.contains("Gmail"));
    }

    #[test]
    fn backup_with_absurd_kdf_parameters_is_rejected_before_derivation() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        let salt = STANDARD.encode([7u8; 16]);
        for (kdf, iterations) in [
            (KDF_NAME, u32::MAX),
            (KDF_NAME, 1),
            ("scrypt", KDF_ITERATIONS),
        ] {
            let backup = serde_json::json!({
                "version": 2, "kdf": kdf, "iterations": iterations,
                "salt": salt, "payload": "AAAA"
            });
            let started = std::time::Instant::now();
            assert!(matches!(
                store.import_backup("x".repeat(12), backup.to_string()),
                Err(StoreError::UnsupportedKdf)
            ));
            assert!(started.elapsed() < std::time::Duration::from_secs(1));
        }
        let unknown = serde_json::json!({
            "version": 2, "kdf": KDF_NAME, "iterations": KDF_ITERATIONS,
            "salt": salt, "payload": "AAAA", "memory": 999999
        });
        assert!(matches!(
            store.import_backup("x".repeat(12), unknown.to_string()),
            Err(StoreError::UnsupportedFormat)
        ));
        assert!(matches!(
            store.import_backup("x".repeat(12), " ".repeat(MAX_IMPORT_BYTES + 1)),
            Err(StoreError::TooLarge)
        ));
    }

    fn store_in(path: &Path) -> PasswordStore {
        PasswordStore::new(
            path.join("passwords.json"),
            path.join("secret.key"),
            path.join("auth.json"),
        )
    }

    fn unlocked_store(path: &Path) -> PasswordStore {
        let mut store = store_in(path);
        store
            .setup_master_password("mot-de-passe-solide".to_string())
            .unwrap();
        store
    }

    #[test]
    fn master_password_sets_up_auth_and_unlocks_again() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(dir.path());

        assert!(!store.auth_status().configured);
        store
            .setup_master_password("mot-de-passe-solide".to_string())
            .unwrap();

        assert!(store.auth_status().configured);
        assert!(store.auth_status().unlocked);
        assert!(dir.path().join("auth.json").exists());

        let mut locked_store = store_in(dir.path());
        assert!(!locked_store.auth_status().unlocked);
        assert!(locked_store
            .unlock("mauvais-mot-de-passe".to_string())
            .is_err());
        locked_store
            .unlock("mot-de-passe-solide".to_string())
            .unwrap();
        assert!(locked_store.auth_status().unlocked);

        locked_store.lock();
        assert!(!locked_store.auth_status().unlocked);
        assert!(matches!(locked_store.load(), Err(StoreError::Locked)));
    }

    #[test]
    fn master_password_can_be_changed_with_current_password() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(dir.path());

        store
            .setup_master_password("ancien-secret".to_string())
            .unwrap();
        store
            .add_password(
                "Perso".to_string(),
                PasswordEntry {
                    plateforme: "Gmail".to_string(),
                    email: "user@example.com".to_string(),
                    mdp: "secret-123".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();

        assert!(store
            .change_master_password("mauvais-secret".to_string(), "nouveau-secret".to_string())
            .is_err());
        store
            .change_master_password("ancien-secret".to_string(), "nouveau-secret".to_string())
            .unwrap();

        let mut locked_store = store_in(dir.path());
        assert!(locked_store.unlock("ancien-secret".to_string()).is_err());
        locked_store.unlock("nouveau-secret".to_string()).unwrap();
        assert_eq!(locked_store.load().unwrap()["Perso"][0].mdp, "secret-123");
    }

    #[test]
    fn locked_store_cannot_read_or_write_vault() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(dir.path());
        store
            .setup_master_password("mot-de-passe-solide".to_string())
            .unwrap();
        store.add_category("Perso".to_string()).unwrap();

        let locked_store = store_in(dir.path());
        assert!(matches!(locked_store.load(), Err(StoreError::Locked)));
        assert!(matches!(
            locked_store.add_category("Pro".to_string()),
            Err(StoreError::Locked)
        ));
    }

    #[test]
    fn legacy_key_is_wrapped_then_removed() {
        let dir = tempfile::tempdir().unwrap();
        let key_file = dir.path().join("secret.key");
        fs::write(&key_file, STANDARD.encode(PasswordStore::generate_key())).unwrap();

        let mut store = store_in(dir.path());
        store
            .setup_master_password("mot-de-passe-solide".to_string())
            .unwrap();

        assert!(dir.path().join("auth.json").exists());
        assert!(!key_file.exists());
    }

    #[test]
    fn added_password_is_encrypted_on_disk_and_decrypted_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());

        store
            .add_password(
                "Perso".to_string(),
                PasswordEntry {
                    plateforme: "Gmail".to_string(),
                    email: "user@example.com".to_string(),
                    mdp: "secret-123".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();

        let raw = fs::read_to_string(dir.path().join("passwords.json")).unwrap();
        assert!(raw.contains("\"encrypted\": true"));
        assert!(!raw.contains("secret-123"));

        let loaded = store.load().unwrap();
        assert_eq!(loaded["Perso"][0].mdp, "secret-123");
    }

    #[test]
    fn plaintext_file_is_migrated_to_encrypted_format() {
        let dir = tempfile::tempdir().unwrap();
        let data_file = dir.path().join("passwords.json");
        fs::write(
            &data_file,
            r#"{"Perso":[{"plateforme":"Mail","email":"me@example.com","mdp":"plain-password"}]}"#,
        )
        .unwrap();

        let store = unlocked_store(dir.path());
        assert_eq!(store.load().unwrap()["Perso"][0].mdp, "plain-password");

        let raw = fs::read_to_string(data_file).unwrap();
        assert!(raw.contains("\"encrypted\": true"));
        assert!(!raw.contains("plain-password"));
    }

    #[test]
    fn category_can_be_renamed_without_losing_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());

        store
            .add_password(
                "Perso".to_string(),
                PasswordEntry {
                    plateforme: "Gmail".to_string(),
                    email: "user@example.com".to_string(),
                    mdp: "secret-123".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();
        store
            .rename_category("Perso".to_string(), "Prive".to_string())
            .unwrap();

        let loaded = store.load().unwrap();
        assert!(!loaded.contains_key("Perso"));
        assert_eq!(loaded["Prive"][0].mdp, "secret-123");
    }

    #[test]
    fn category_can_be_deleted_and_last_delete_recreates_default_category() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());

        store.add_category("Perso".to_string()).unwrap();
        store.add_category("Pro".to_string()).unwrap();
        store.delete_category("Pro".to_string()).unwrap();

        let loaded = store.load().unwrap();
        assert!(loaded.contains_key("Perso"));
        assert!(!loaded.contains_key("Pro"));

        store.delete_category("Perso".to_string()).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded["Perso"].len(), 0);
    }

    #[test]
    fn entry_can_be_updated_and_deleted_by_index() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());

        store
            .add_password(
                "Perso".to_string(),
                PasswordEntry {
                    plateforme: "Gmail".to_string(),
                    email: "user@example.com".to_string(),
                    mdp: "secret-123".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();

        store
            .update_password(
                "Perso".to_string(),
                0,
                PasswordEntry {
                    plateforme: "GitHub".to_string(),
                    email: "dev@example.com".to_string(),
                    mdp: "better-secret-456".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded["Perso"][0].plateforme, "GitHub");
        assert_eq!(loaded["Perso"][0].mdp, "better-secret-456");

        store.delete_password("Perso".to_string(), 0).unwrap();
        let loaded = store.load().unwrap();
        assert!(loaded["Perso"].is_empty());
    }

    #[test]
    fn vault_can_be_exported_and_imported_with_backup_password() {
        let source_dir = tempfile::tempdir().unwrap();
        let source = unlocked_store(source_dir.path());
        source
            .add_password(
                "Perso".to_string(),
                PasswordEntry {
                    plateforme: "Mail".to_string(),
                    email: "me@example.com".to_string(),
                    mdp: "secret-123".to_string(),
                    ..Default::default()
                },
            )
            .unwrap();

        let backup = source
            .export_backup("mot-de-passe-export".to_string())
            .unwrap();
        assert!(!backup.contains("secret-123"));
        assert!(source
            .import_backup("mauvais-export".to_string(), backup.clone())
            .is_err());

        let target_dir = tempfile::tempdir().unwrap();
        let target = unlocked_store(target_dir.path());
        let imported = target
            .import_backup("mot-de-passe-export".to_string(), backup)
            .unwrap();

        assert_eq!(imported["Perso"][0].plateforme, "Mail");
        assert_eq!(imported["Perso"][0].mdp, "secret-123");
    }

    #[test]
    fn history_favorites_and_trash_lifecycle_are_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        store
            .add_password(
                "Perso".into(),
                PasswordEntry {
                    plateforme: "Google".into(),
                    email: "a@b.fr".into(),
                    mdp: "first".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        store.set_favorite("Perso".into(), 0, true).unwrap();
        store
            .update_password(
                "Perso".into(),
                0,
                PasswordEntry {
                    plateforme: "Google".into(),
                    email: "a@b.fr".into(),
                    mdp: "second".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(store.load().unwrap()["Perso"][0].favorite);
        assert_eq!(store.load().unwrap()["Perso"][0].mdp, "second");
        store.restore_history(1).unwrap();
        assert_eq!(store.load().unwrap()["Perso"][0].mdp, "first");
        store.delete_password("Perso".into(), 0).unwrap();
        assert_eq!(store.trash().unwrap().len(), 1);
        store.delete_trash(0).unwrap();
        assert!(store.trash().unwrap().is_empty());
    }

    #[test]
    fn trash_older_than_thirty_days_is_purged() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        store
            .add_password(
                "Perso".into(),
                PasswordEntry {
                    plateforme: "Ancien".into(),
                    mdp: "secret".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        store.delete_password("Perso".into(), 0).unwrap();
        let mut state = store.load_state().unwrap();
        state.trash[0].timestamp = PasswordStore::now() - PURGE_AFTER_SECONDS - 1;
        store.save_state(&state).unwrap();
        assert!(store.trash().unwrap().is_empty());
    }

    #[test]
    fn recovery_key_resets_the_master_password_and_stays_valid() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(dir.path());
        let recovery_key = store
            .setup_master_password("mot-de-passe-oublie".to_string())
            .unwrap();
        assert_eq!(recovery_key.split('-').count(), 8);
        assert!(store.auth_status().recovery_configured);
        store
            .add_password(
                "Perso".into(),
                PasswordEntry {
                    plateforme: "Banque".into(),
                    mdp: "secret-bancaire".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        let raw_auth = fs::read_to_string(dir.path().join("auth.json")).unwrap();
        assert!(!raw_auth.contains(&recovery_key));

        let mut locked = store_in(dir.path());
        assert!(matches!(
            locked.recover_with_key("AAAA-BBBB".into(), "nouveau-secret".into()),
            Err(StoreError::InvalidRecoveryKey)
        ));
        let typed = recovery_key.to_lowercase().replace('-', " ");
        locked
            .recover_with_key(typed, "nouveau-secret".into())
            .unwrap();
        assert_eq!(locked.load().unwrap()["Perso"][0].mdp, "secret-bancaire");

        let mut reopened = store_in(dir.path());
        assert!(reopened.unlock("mot-de-passe-oublie".into()).is_err());
        reopened.unlock("nouveau-secret".into()).unwrap();
        reopened.lock();
        reopened
            .recover_with_key(recovery_key, "troisieme-secret".into())
            .unwrap();
    }

    #[test]
    fn legacy_auth_file_without_recovery_slot_is_migrated_on_demand() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_in(dir.path());
        store
            .setup_master_password("mot-de-passe-solide".to_string())
            .unwrap();
        // Simule un coffre v1 : pas d'emplacement de récupération.
        let mut auth = store.read_auth_file().unwrap();
        auth.version = 1;
        auth.recovery = None;
        store.write_auth_file(&auth).unwrap();
        assert!(!store.auth_status().recovery_configured);

        let mut locked = store_in(dir.path());
        assert!(matches!(
            locked.recover_with_key("AAAA".into(), "nouveau-secret".into()),
            Err(StoreError::RecoveryNotConfigured)
        ));
        assert!(locked.create_recovery_key("mauvais-secret".into()).is_err());
        let key = locked
            .create_recovery_key("mot-de-passe-solide".into())
            .unwrap();
        assert!(locked.auth_status().recovery_configured);
        assert_eq!(locked.read_auth_file().unwrap().version, AUTH_VERSION);

        locked
            .change_master_password("mot-de-passe-solide".into(), "autre-secret".into())
            .unwrap();
        let mut again = store_in(dir.path());
        again.recover_with_key(key, "final-secret".into()).unwrap();
    }

    #[test]
    fn tags_are_normalized_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        store
            .add_password(
                "Perso".into(),
                PasswordEntry {
                    plateforme: "Banque".into(),
                    mdp: "secret".into(),
                    tags: vec![
                        "#Banque".into(),
                        " travail ".into(),
                        "banque".into(),
                        "  ".into(),
                        "carte bleue".into(),
                    ],
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            store.load().unwrap()["Perso"][0].tags,
            vec!["banque", "travail", "carte-bleue"]
        );
    }

    #[test]
    fn duplicates_merge_into_the_kept_entry_and_send_the_other_to_trash() {
        let dir = tempfile::tempdir().unwrap();
        let store = unlocked_store(dir.path());
        let mut state = store.load_state().unwrap();
        state.categories.insert(
            "Perso".into(),
            vec![
                PasswordEntry {
                    plateforme: "GitHub".into(),
                    email: "moi@x.fr".into(),
                    mdp: "nouveau".into(),
                    site: "https://github.com".into(),
                    notes: "Compte perso".into(),
                    tags: vec!["dev".into()],
                    created_at: 50,
                    updated_at: 200,
                    ..Default::default()
                },
                PasswordEntry {
                    plateforme: "GitHub".into(),
                    email: "moi@x.fr".into(),
                    mdp: "ancien".into(),
                    site: "www.github.com".into(),
                    notes: "Import Edge".into(),
                    totp_secret: "JBSWY3DPEHPK3PXP".into(),
                    tags: vec!["import".into()],
                    favorite: true,
                    created_at: 10,
                    updated_at: 100,
                    ..Default::default()
                },
            ],
        );
        store.save_state(&state).unwrap();

        // Garde l'entrée d'index 1 : le mot de passe le plus récent vient de l'autre.
        store
            .merge_duplicates("Perso".into(), 1, "Perso".into(), 0)
            .unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded["Perso"].len(), 1);
        let merged = &loaded["Perso"][0];
        assert_eq!(merged.mdp, "nouveau");
        assert_eq!(
            merged.notes,
            "Import Edge

Compte perso"
        );
        assert_eq!(merged.totp_secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(merged.tags, vec!["import", "dev"]);
        assert!(merged.favorite);
        assert_eq!(merged.created_at, 10);

        let trash = store.trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].entry.mdp, "nouveau");
        let history = store.history().unwrap();
        assert_eq!(history.last().unwrap().action, "suppression");
        assert_eq!(history[history.len() - 2].entry.mdp, "ancien");

        assert!(store
            .merge_duplicates("Perso".into(), 0, "Perso".into(), 0)
            .is_err());
    }
}
