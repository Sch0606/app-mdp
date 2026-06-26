# Biometrie macOS

Touch ID passe par le Trousseau macOS. Pour enregistrer le mot de passe maitre dans le Trousseau, l'application doit etre signee avec les entitlements Keychain.

Pour un test local sans certificat Apple, utilisez une build signee en ad hoc :

```bash
npm run build:mac-local
```

Puis lancez l'application generee dans `src-tauri/target/universal-apple-darwin/release/bundle/macos/`.

Si le projet est sur un PC Windows, utilisez GitHub Actions :

1. Poussez les changements sur GitHub.
2. Ouvrez l'onglet `Actions`.
3. Lancez le workflow `Build macOS biometry test`.
4. Telechargez l'artifact `Clave-macOS-biometry-test`.
5. Dezippez le fichier sur le Mac.
6. Lancez `Clave.app`, puis activez la biometrie depuis les parametres.

`npm run tauri dev` peut encore afficher `-34018` parce que macOS refuse parfois l'ecriture dans le Trousseau aux binaires de developpement non signes avec les bons entitlements.

Pour une distribution fiable, signez avec un certificat Apple Developer ID et gardez `src-tauri/entitlements.plist` dans la build.
