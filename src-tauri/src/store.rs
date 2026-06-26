use std::{collections::BTreeMap, fs, path::PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;

const AUTH_VERSION: u8 = 1;
const VAULT_VERSION: u8 = 2;
const KDF_ITERATIONS: u32 = 210_000;
const AUTH_VERIFIER: &[u8] = b"clave-auth-v1";

pub type CategoryMap = BTreeMap<String, Vec<PasswordEntry>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordEntry {
    pub plateforme: String,
    pub email: String,
    pub mdp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub configured: bool,
    pub unlocked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthFile {
    version: u8,
    kdf: String,
    iterations: u32,
    salt: String,
    verifier: String,
    wrapped_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
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
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedEntry {
    plateforme: String,
    email: String,
    mdp: String,
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
        }
    }

    pub fn setup_master_password(&mut self, password: String) -> Result<(), StoreError> {
        if self.auth_file.exists() {
            return Err(StoreError::AuthAlreadyConfigured);
        }

        if password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        let vault_key = self.load_legacy_key()?.unwrap_or_else(Self::generate_key);
        let auth = self.build_auth_file(&password, &vault_key)?;
        self.write_auth_file(&auth)?;
        self.vault_key = Some(vault_key);

        if self.key_file.exists() {
            fs::remove_file(&self.key_file)?;
        }

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
        let auth = self.build_auth_file(&new_password, &vault_key)?;
        self.write_auth_file(&auth)?;
        Ok(())
    }

    pub fn lock(&mut self) {
        self.vault_key = None;
    }

    pub fn load(&self) -> Result<CategoryMap, StoreError> {
        if self.auth_file.exists() {
            self.require_key()?;
        }

        let raw = self.read_raw()?;

        if raw.trim().is_empty() {
            return Ok(CategoryMap::new());
        }

        let value: serde_json::Value = serde_json::from_str(&raw)?;
        if value
            .get("encrypted")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            let vault: EncryptedVault = serde_json::from_value(value)?;
            return self.decrypt_categories(vault.categories);
        }

        let plaintext: CategoryMap = serde_json::from_str(&raw)?;
        self.save(&plaintext)?;
        Ok(plaintext)
    }

    pub fn save(&self, categories: &CategoryMap) -> Result<(), StoreError> {
        let vault = EncryptedVault {
            version: VAULT_VERSION,
            encrypted: true,
            categories: self.encrypt_categories(categories)?,
        };
        self.write_json(&vault)
    }

    pub fn add_password(&self, categorie: String, entry: PasswordEntry) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        categories.entry(categorie).or_default().push(entry);
        self.save(&categories)
    }

    pub fn update_password(
        &self,
        categorie: String,
        index: usize,
        entry: PasswordEntry,
    ) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        let entries = categories.get_mut(&categorie).ok_or(StoreError::NotFound)?;
        let current = entries.get_mut(index).ok_or(StoreError::NotFound)?;

        *current = entry;
        self.save(&categories)
    }

    pub fn delete_password(&self, categorie: String, index: usize) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        let entries = categories.get_mut(&categorie).ok_or(StoreError::NotFound)?;

        if index >= entries.len() {
            return Err(StoreError::NotFound);
        }

        entries.remove(index);
        self.save(&categories)
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

    pub fn export_backup(&self, password: String) -> Result<String, StoreError> {
        if password.trim().len() < 8 {
            return Err(StoreError::InvalidPassword);
        }

        let categories = self.load()?;
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key = Self::derive_key_from_parts(&password, &salt, KDF_ITERATIONS);
        let payload = serde_json::to_vec(&categories)?;

        let backup = BackupFile {
            version: AUTH_VERSION,
            kdf: "PBKDF2-HMAC-SHA256".to_string(),
            iterations: KDF_ITERATIONS,
            salt: STANDARD.encode(salt),
            payload: Self::encrypt_payload(&key, &payload)?,
        };

        serde_json::to_string_pretty(&backup).map_err(StoreError::from)
    }

    pub fn import_backup(
        &self,
        password: String,
        backup_json: String,
    ) -> Result<CategoryMap, StoreError> {
        let backup: BackupFile = serde_json::from_str(&backup_json)?;
        let salt = STANDARD
            .decode(backup.salt.trim())
            .map_err(|_| StoreError::InvalidKey)?;
        let key = Self::derive_key_from_parts(&password, &salt, backup.iterations);
        let decrypted = Self::decrypt_payload(&key, &backup.payload)
            .map_err(|_| StoreError::InvalidPassword)?;
        let categories: CategoryMap = serde_json::from_slice(&decrypted)?;

        self.save(&categories)?;
        Ok(categories)
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

        fs::write(
            &self.data_file,
            serde_json::to_string_pretty(value)?.as_bytes(),
        )?;
        Ok(())
    }

    fn write_auth_file(&self, auth: &AuthFile) -> Result<(), StoreError> {
        if let Some(parent) = self.auth_file.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(
            &self.auth_file,
            serde_json::to_string_pretty(auth)?.as_bytes(),
        )?;
        Ok(())
    }

    fn read_auth_file(&self) -> Result<AuthFile, StoreError> {
        let raw = fs::read_to_string(&self.auth_file)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn build_auth_file(
        &self,
        password: &str,
        vault_key: &[u8; 32],
    ) -> Result<AuthFile, StoreError> {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let kek = Self::derive_key_from_parts(password, &salt, KDF_ITERATIONS);

        Ok(AuthFile {
            version: AUTH_VERSION,
            kdf: "PBKDF2-HMAC-SHA256".to_string(),
            iterations: KDF_ITERATIONS,
            salt: STANDARD.encode(salt),
            verifier: Self::encrypt_payload(&kek, AUTH_VERIFIER)?,
            wrapped_key: Self::encrypt_payload(&kek, vault_key)?,
        })
    }

    fn encrypt_categories(
        &self,
        categories: &CategoryMap,
    ) -> Result<BTreeMap<String, Vec<EncryptedEntry>>, StoreError> {
        let mut encrypted = BTreeMap::new();

        for (category, entries) in categories {
            let encrypted_entries = entries
                .iter()
                .map(|entry| {
                    Ok(EncryptedEntry {
                        plateforme: entry.plateforme.clone(),
                        email: entry.email.clone(),
                        mdp: self.encrypt_text(&entry.mdp)?,
                    })
                })
                .collect::<Result<Vec<_>, StoreError>>()?;

            encrypted.insert(category.clone(), encrypted_entries);
        }

        Ok(encrypted)
    }

    fn decrypt_categories(
        &self,
        categories: BTreeMap<String, Vec<EncryptedEntry>>,
    ) -> Result<CategoryMap, StoreError> {
        let mut decrypted = CategoryMap::new();

        for (category, entries) in categories {
            let decrypted_entries = entries
                .into_iter()
                .map(|entry| {
                    Ok(PasswordEntry {
                        plateforme: entry.plateforme,
                        email: entry.email,
                        mdp: self.decrypt_text(&entry.mdp)?,
                    })
                })
                .collect::<Result<Vec<_>, StoreError>>()?;

            decrypted.insert(category, decrypted_entries);
        }

        Ok(decrypted)
    }

    fn encrypt_text(&self, text: &str) -> Result<String, StoreError> {
        Self::encrypt_payload(&self.require_key()?, text.as_bytes())
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
        let salt = STANDARD
            .decode(auth.salt.trim())
            .map_err(|_| StoreError::InvalidKey)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

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
}
