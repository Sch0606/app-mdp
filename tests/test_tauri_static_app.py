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
