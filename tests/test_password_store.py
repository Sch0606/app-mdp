import json
import unittest

from password_store import PasswordStore


class PasswordStoreTest(unittest.TestCase):
    def test_added_password_is_encrypted_on_disk_and_decrypted_on_load(self):
        with self.subTest():
            from tempfile import TemporaryDirectory

            with TemporaryDirectory() as tmp:
                from pathlib import Path

                tmp_path = Path(tmp)
                data_file = tmp_path / "passwords.json"
                key_file = tmp_path / "secret.key"
                store = PasswordStore(data_file=data_file, key_file=key_file)

                store.add_password("Perso", "Gmail", "user@example.com", "secret-123")

                raw = json.loads(data_file.read_text(encoding="utf-8"))
                self.assertIs(raw["encrypted"], True)
                self.assertNotEqual(raw["categories"]["Perso"][0]["mdp"], "secret-123")

                loaded = store.load()
                self.assertEqual(
                    loaded,
                    {
                        "Perso": [
                            {
                                "plateforme": "Gmail",
                                "email": "user@example.com",
                                "mdp": "secret-123",
                            }
                        ]
                    },
                )

    def test_plaintext_file_is_migrated_to_encrypted_format(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            data_file = tmp_path / "passwords.json"
            key_file = tmp_path / "secret.key"
            data_file.write_text(
                json.dumps(
                    {
                        "Perso": [
                            {
                                "plateforme": "Mail",
                                "email": "me@example.com",
                                "mdp": "plain-password",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            store = PasswordStore(data_file=data_file, key_file=key_file)

            self.assertEqual(
                store.load(),
                {
                    "Perso": [
                        {
                            "plateforme": "Mail",
                            "email": "me@example.com",
                            "mdp": "plain-password",
                        }
                    ]
                },
            )

            raw = json.loads(data_file.read_text(encoding="utf-8"))
            self.assertIs(raw["encrypted"], True)
            self.assertNotEqual(raw["categories"]["Perso"][0]["mdp"], "plain-password")

    def test_category_can_be_added_without_losing_existing_entries(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            data_file = tmp_path / "passwords.json"
            key_file = tmp_path / "secret.key"
            store = PasswordStore(data_file=data_file, key_file=key_file)

            store.add_password("Perso", "Gmail", "user@example.com", "secret-123")
            store.add_category("Pro")

            self.assertEqual(store.load()["Pro"], [])
            self.assertEqual(store.load()["Perso"][0]["mdp"], "secret-123")

    def test_category_can_be_renamed_without_losing_entries(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            data_file = tmp_path / "passwords.json"
            key_file = tmp_path / "secret.key"
            store = PasswordStore(data_file=data_file, key_file=key_file)

            store.add_password("Perso", "Gmail", "user@example.com", "secret-123")
            store.rename_category("Perso", "Privé")

            loaded = store.load()
            self.assertNotIn("Perso", loaded)
            self.assertEqual(loaded["Privé"][0]["mdp"], "secret-123")
