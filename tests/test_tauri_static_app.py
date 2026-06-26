import unittest
from pathlib import Path


class TauriStaticAppTest(unittest.TestCase):
    def test_tauri_static_frontend_uses_global_invoke_without_bare_import(self):
        script = Path("src/script.js").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")

        self.assertNotIn("@tauri-apps/api", script)
        self.assertIn("__TAURI__.core.invoke", script)
        self.assertIn('"withGlobalTauri": true', config)

    def test_windows_release_does_not_open_a_console_window(self):
        main_rs = Path("src-tauri/src/main.rs").read_text(encoding="utf-8")

        self.assertIn('windows_subsystem = "windows"', main_rs)

    def test_context_menu_and_delete_category_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")

        self.assertIn('id="category-menu"', html)
        self.assertIn('id="delete-modal"', html)
        self.assertIn("contextmenu", script)
        self.assertIn("supprimer_categorie", script)
        self.assertIn("fn supprimer_categorie", lib)

    def test_master_password_lock_screen_is_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        store = Path("src-tauri/src/store.rs").read_text(encoding="utf-8")

        self.assertIn('id="lock-screen"', html)
        self.assertIn('id="master-password"', html)
        self.assertNotIn('id="master-confirm"', html)
        self.assertIn("auth_status", script)
        self.assertIn("setup_master_password", script)
        self.assertIn("unlock", script)
        self.assertIn("fn auth_status", lib)
        self.assertIn("fn setup_master_password", lib)
        self.assertIn("fn unlock", lib)
        self.assertIn("PBKDF2-HMAC-SHA256", store)
        self.assertIn("wrapped_key", store)

    def test_productivity_security_options_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")

        for marker in [
            'id="search-input"',
            'id="lock-now"',
            'id="audit-panel"',
            'id="generator-length"',
            'id="backup-modal"',
        ]:
            self.assertIn(marker, html)

        self.assertNotIn('id="export-vault"', html)
        self.assertNotIn('id="import-vault"', html)

        for marker in [
            "filtrerAcces",
            "copierTexte",
            "modifierAcces",
            "supprimerAcces",
            "verrouillerApplication",
            "evaluerForceMotDePasse",
            "mettreAJourAudit",
            "exporterCoffre",
            "importerCoffre",
        ]:
            self.assertIn(marker, script)

        for command in ["modifier", "supprimer_acces", "exporter", "importer"]:
            self.assertIn(f"fn {command}", lib)
            self.assertIn(command, script)

    def test_settings_page_and_collapsed_generator_are_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        script = Path("src/script.js").read_text(encoding="utf-8")
        style = Path("src/style.css").read_text(encoding="utf-8")
        lib = Path("src-tauri/src/lib.rs").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        entitlements = Path("src-tauri/entitlements.plist").read_text(encoding="utf-8")
        package = Path("package.json").read_text(encoding="utf-8")

        for marker in [
            'id="settings-button"',
            'id="settings-page"',
            'id="settings-lock-now"',
            'id="lock-hotkey-display"',
            'id="record-lock-hotkey"',
            'id="clear-lock-hotkey"',
            'id="biometry-status"',
            'id="enable-biometry"',
            'id="disable-biometry"',
            'id="toggle-toolbar-lock"',
            'id="auto-lock-delay"',
            'id="change-master-form"',
            'id="settings-export-vault"',
            'id="settings-import-vault"',
            'class="tools-grid generator-collapsed"',
        ]:
            self.assertIn(marker, html)

        for marker in [
            "ouvrirParametres",
            "fermerParametres",
            "changerMotDePasseMaitre",
            "appliquerPreferenceVerrouillage",
            "appliquerDelaiVerrouillage",
            "capturerRaccourciVerrouillage",
            "gererRaccourciVerrouillage",
            "mettreAJourBiometrie",
            "activerBiometrie",
            "deverrouillerAvecBiometrie",
            "expliquerErreurBiometrie",
            "afficherGenerateur",
            "changer_mot_de_passe_maitre",
            "biometrie_status",
        ]:
            self.assertIn(marker, script)

        self.assertIn("fn changer_mot_de_passe_maitre", lib)
        self.assertIn("fn biometrie_status", lib)
        self.assertIn("tauri_plugin_biometry::init()", lib)
        self.assertIn('"entitlements": "entitlements.plist"', config)
        self.assertIn('"signingIdentity": "-"', config)
        self.assertIn("keychain-access-groups", entitlements)
        self.assertIn("<array/>", entitlements)
        self.assertIn('"build:mac-local"', package)
        self.assertIn(".generator-collapsed .tool-panel:first-child", style)
        self.assertIn(".settings-page", style)

    def test_release_workflow_uses_universal_macos_bundle_path(self):
        workflow = Path(".github/workflows/release.yml").read_text(encoding="utf-8")

        self.assertIn("--target universal-apple-darwin", workflow)
        self.assertIn(
            "asset-source: src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg",
            workflow,
        )
        self.assertIn("path: dist/*", workflow)
        self.assertIn("files: dist/*", workflow)
        self.assertIn("actions/checkout@v5", workflow)
        self.assertIn("actions/setup-node@v5", workflow)
        self.assertIn("actions/upload-artifact@v6", workflow)
        self.assertIn("softprops/action-gh-release@v3", workflow)

    def test_macos_biometry_test_workflow_builds_signed_app_artifact(self):
        workflow = Path(".github/workflows/macos-biometry-test.yml").read_text(encoding="utf-8")
        docs = Path("MACOS_BIOMETRY.md").read_text(encoding="utf-8")

        self.assertIn("workflow_dispatch", workflow)
        self.assertIn("runs-on: macos-latest", workflow)
        self.assertIn("npm run build:mac-local", workflow)
        self.assertIn("npm run build:mac-dmg", workflow)
        self.assertIn("codesign --verify", workflow)
        self.assertIn("codesign -d --entitlements", workflow)
        self.assertIn("Clave-macOS-biometry-test.zip", workflow)
        self.assertIn("bundle/dmg/*.dmg", workflow)
        self.assertIn("path: dist/*", workflow)
        self.assertIn("actions/upload-artifact@v6", workflow)
        self.assertIn("Build macOS biometry test", docs)
        self.assertIn("Utilisez le fichier `.dmg`", docs)
