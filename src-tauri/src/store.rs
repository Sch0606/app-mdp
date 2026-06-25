use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type CategoryMap = BTreeMap<String, Vec<PasswordEntry>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PasswordEntry {
    pub plateforme: String,
    pub email: String,
    pub mdp: String,
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
}

pub struct PasswordStore {
    data_file: PathBuf,
    key_file: PathBuf,
}

impl PasswordStore {
    pub fn new(data_file: PathBuf, key_file: PathBuf) -> Self {
        Self {
            data_file,
            key_file,
        }
    }

    pub fn load(&self) -> Result<CategoryMap, StoreError> {
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
            version: 2,
            encrypted: true,
            categories: self.encrypt_categories(categories)?,
        };
        self.write_json(&vault)
    }

    pub fn add_password(
        &self,
        categorie: String,
        entry: PasswordEntry,
    ) -> Result<(), StoreError> {
        let mut categories = self.load()?;
        categories.entry(categorie).or_default().push(entry);
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
        let cipher = self.cipher()?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let encrypted = cipher
            .encrypt(nonce, text.as_bytes())
            .map_err(|_| StoreError::Crypto)?;

        let mut payload = nonce_bytes.to_vec();
        payload.extend(encrypted);
        Ok(STANDARD.encode(payload))
    }

    fn decrypt_text(&self, value: &str) -> Result<String, StoreError> {
        let payload = STANDARD.decode(value).map_err(|_| StoreError::Crypto)?;
        if payload.len() < 13 {
            return Err(StoreError::Crypto);
        }

        let (nonce_bytes, encrypted) = payload.split_at(12);
        let cipher = self.cipher()?;
        let decrypted = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), encrypted)
            .map_err(|_| StoreError::Crypto)?;

        String::from_utf8(decrypted).map_err(|_| StoreError::Crypto)
    }

    fn cipher(&self) -> Result<Aes256Gcm, StoreError> {
        let key = self.load_or_create_key()?;
        Aes256Gcm::new_from_slice(&key).map_err(|_| StoreError::InvalidKey)
    }

    fn load_or_create_key(&self) -> Result<[u8; 32], StoreError> {
        if self.key_file.exists() {
            let raw = fs::read_to_string(&self.key_file)?;
            let bytes = STANDARD.decode(raw.trim()).map_err(|_| StoreError::InvalidKey)?;
            return bytes.try_into().map_err(|_| StoreError::InvalidKey);
        }

        if let Some(parent) = self.key_file.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        fs::write(&self.key_file, STANDARD.encode(key))?;
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn store_in(path: &Path) -> PasswordStore {
        PasswordStore::new(path.join("passwords.json"), path.join("secret.key"))
    }

    #[test]
    fn added_password_is_encrypted_on_disk_and_decrypted_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

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

        let store = store_in(dir.path());
        assert_eq!(store.load().unwrap()["Perso"][0].mdp, "plain-password");

        let raw = fs::read_to_string(data_file).unwrap();
        assert!(raw.contains("\"encrypted\": true"));
        assert!(!raw.contains("plain-password"));
    }

    #[test]
    fn category_can_be_renamed_without_losing_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

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
        let store = store_in(dir.path());

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
}
