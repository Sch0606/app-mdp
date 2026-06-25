import json
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class PasswordStore:
    def __init__(self, data_file="passwords.json", key_file="secret.key"):
        self.data_file = Path(data_file)
        self.key_file = Path(key_file)
        self.fernet = Fernet(self._load_or_create_key())

    def add_password(self, categorie, plateforme, email, mdp):
        passwords = self.load()
        passwords.setdefault(categorie, [])
        passwords[categorie].append(
            {
                "plateforme": plateforme,
                "email": email,
                "mdp": mdp,
            }
        )
        self.save(passwords)

    def add_category(self, categorie):
        passwords = self.load()
        passwords.setdefault(categorie, [])
        self.save(passwords)

    def rename_category(self, old_name, new_name):
        passwords = self.load()
        if old_name not in passwords or not new_name:
            return passwords

        if old_name == new_name:
            return passwords

        passwords[new_name] = passwords.pop(old_name)
        self.save(passwords)
        return passwords

    def load(self):
        raw = self._read_raw()

        if self._is_encrypted_format(raw):
            return self._decrypt_categories(raw["categories"])

        self.save(raw)
        return raw

    def save(self, passwords):
        encrypted = {
            "version": 2,
            "encrypted": True,
            "categories": self._encrypt_categories(passwords),
        }
        self.data_file.write_text(
            json.dumps(encrypted, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_or_create_key(self):
        if self.key_file.exists():
            return self.key_file.read_bytes().strip()

        key = Fernet.generate_key()
        self.key_file.write_bytes(key)
        return key

    def _read_raw(self):
        if not self.data_file.exists():
            return {}

        content = self.data_file.read_text(encoding="utf-8").strip()
        if not content:
            return {}

        return json.loads(content)

    def _is_encrypted_format(self, raw):
        return isinstance(raw, dict) and raw.get("encrypted") is True and "categories" in raw

    def _encrypt_categories(self, passwords):
        encrypted = {}

        for categorie, entries in passwords.items():
            encrypted[categorie] = []
            for entry in entries:
                encrypted[categorie].append(
                    {
                        "plateforme": entry.get("plateforme", ""),
                        "email": entry.get("email", ""),
                        "mdp": self._encrypt_text(entry.get("mdp", "")),
                    }
                )

        return encrypted

    def _decrypt_categories(self, categories):
        decrypted = {}

        for categorie, entries in categories.items():
            decrypted[categorie] = []
            for entry in entries:
                decrypted[categorie].append(
                    {
                        "plateforme": entry.get("plateforme", ""),
                        "email": entry.get("email", ""),
                        "mdp": self._decrypt_text(entry.get("mdp", "")),
                    }
                )

        return decrypted

    def _encrypt_text(self, value):
        return self.fernet.encrypt(value.encode("utf-8")).decode("utf-8")

    def _decrypt_text(self, value):
        try:
            return self.fernet.decrypt(value.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            return ""
