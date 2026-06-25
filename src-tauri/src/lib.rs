mod store;

use std::sync::Mutex;

use store::{CategoryMap, PasswordEntry, PasswordStore};
use tauri::{Manager, State};

struct AppState {
    store: Mutex<PasswordStore>,
}

#[tauri::command]
fn charger(state: State<AppState>) -> Result<CategoryMap, String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .load()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ajouter(
    state: State<AppState>,
    categorie: String,
    plateforme: String,
    email: String,
    mdp: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .add_password(
            categorie,
            PasswordEntry {
                plateforme,
                email,
                mdp,
            },
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ajouter_categorie(state: State<AppState>, categorie: String) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .add_category(categorie)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn renommer_categorie(
    state: State<AppState>,
    ancien_nom: String,
    nouveau_nom: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?
        .rename_category(ancien_nom, nouveau_nom)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn supprimer_categorie(state: State<AppState>, categorie: String) -> Result<CategoryMap, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Le coffre est indisponible.".to_string())?;

    store
        .delete_category(categorie)
        .map_err(|error| error.to_string())?;
    store.load().map_err(|error| error.to_string())
}

#[tauri::command]
fn generer() -> String {
    PasswordStore::generate_password()
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Dossier de donnees introuvable: {error}"))?;
            std::fs::create_dir_all(&app_dir)
                .map_err(|error| format!("Creation du dossier impossible: {error}"))?;

            app.manage(AppState {
                store: Mutex::new(PasswordStore::new(
                    app_dir.join("passwords.json"),
                    app_dir.join("secret.key"),
                )),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            charger,
            ajouter,
            ajouter_categorie,
            renommer_categorie,
            supprimer_categorie,
            generer
        ])
        .run(tauri::generate_context!())
        .expect("erreur pendant l'execution de Clave");
}
