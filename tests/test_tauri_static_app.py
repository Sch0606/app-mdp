import json
import unittest
from pathlib import Path


class TauriReactAppTest(unittest.TestCase):
    def test_react_motion_frontend_is_wired(self):
        html = Path("src/index.html").read_text(encoding="utf-8")
        main = Path("src/main.jsx").read_text(encoding="utf-8")
        package = json.loads(Path("package.json").read_text(encoding="utf-8"))

        self.assertIn('id="root"', html)
        self.assertIn('/main.jsx', html)
        self.assertIn("createRoot", main)
        self.assertIn("framer-motion", package["dependencies"])
        self.assertIn("react", package["dependencies"])
        self.assertFalse(Path("src/script.js").exists())

    def test_tauri_and_vite_use_the_same_development_origin(self):
        tauri = json.loads(Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        vite = Path("vite.config.js").read_text(encoding="utf-8")

        self.assertEqual(tauri["build"]["devUrl"], "http://127.0.0.1:1420")
        self.assertEqual(tauri["build"]["frontendDist"], "../dist")
        self.assertIn("host: '127.0.0.1'", vite)
        self.assertIn("port: 1420", vite)

    def test_windows_release_does_not_open_a_console_window(self):
        main_rs = Path("src-tauri/src/main.rs").read_text(encoding="utf-8")
        self.assertIn('windows_subsystem = "windows"', main_rs)

    def test_security_and_accessibility_foundations_are_preserved(self):
        style = Path("src/style.css").read_text(encoding="utf-8")
        config = Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8")
        store = Path("src-tauri/src/store.rs").read_text(encoding="utf-8")

        self.assertIn("prefers-reduced-motion", style)
        self.assertNotIn('"csp": null', config)
        self.assertIn("PBKDF2-HMAC-SHA256", store)
        self.assertIn("wrapped_key", store)


if __name__ == "__main__":
    unittest.main()
