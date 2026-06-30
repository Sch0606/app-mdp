# Fondation securite et mises a jour

## Objectif

Ajouter a Clave une identification claire de la version installee, des mises a jour signees publiees avec GitHub Releases, un effacement prudent du presse-papiers et un verrouillage automatique apres une veille du systeme.

## Version et mises a jour

Une section `A propos` dans les parametres affiche la version courante obtenue depuis l'application Tauri. Au chargement de cette section, Clave peut verifier la derniere version disponible sans bloquer l'ouverture du coffre. L'utilisateur dispose aussi d'un bouton `Rechercher une mise a jour`.

Lorsqu'une version plus recente existe, l'interface affiche son numero, un resume et un bouton `Installer puis redemarrer`. Le telechargement presente une progression. Une absence de connexion ou une reponse GitHub invalide produit un message local et ne modifie pas l'application.

Le depot `Sch0606/app-mdp` utilise GitHub Releases comme canal stable. Le workflow de publication genere les installateurs, leurs signatures et le manifeste attendu par le module de mise a jour Tauri. La cle publique est integree a l'application. La cle privee reste hors du depot et est fournie au workflow par les secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et, si necessaire, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Presse-papiers securise

Tous les chemins de copie de secrets passent par un service unique. Apres une copie, Clave memorise uniquement en memoire la valeur copiee et programme son nettoyage. Le delai par defaut est de 30 secondes et les reglages proposes sont 15 secondes, 30 secondes, 1 minute et jamais.

A l'expiration, Clave relit le presse-papiers. Il ne l'efface que si sa valeur est toujours exactement celle que Clave avait copiee. Si l'utilisateur a copie autre chose entre-temps, ce nouveau contenu est conserve. Le minuteur est remplace lorsqu'un autre secret est copie et annule lors du verrouillage. Aucun secret n'est journalise ou sauvegarde dans les preferences.

## Verrouillage apres veille

Un battement periodique en memoire compare l'heure reelle a l'heure du dernier passage. Un ecart anormal indique que les minuteurs ont ete suspendus par la veille du systeme. Si le coffre est ouvert, Clave le verrouille immediatement a la reprise.

La restauration de visibilite de la fenetre declenche la meme verification. Une simple perte de focus ou une reduction courte ne verrouille pas le coffre. Le verrouillage reutilise le flux existant afin de vider les donnees dechiffrees de l'interface et de revenir a l'ecran du mot de passe maitre.

## Interface

La carte `A propos` rejoint la page Parametres avec la version, l'etat de mise a jour et les actions associees. Le reglage du presse-papiers rejoint la carte Securite sous la forme d'un controle segmente coherent avec le delai de verrouillage automatique.

## Erreurs et securite

- Une verification de mise a jour echouee n'empeche jamais l'utilisation locale du coffre.
- Une signature invalide bloque l'installation.
- Un echec de lecture ou d'effacement du presse-papiers affiche un message generique sans inclure le secret.
- Les controles de reprise ne lancent pas plusieurs verrouillages concurrents.
- Le mode developpement peut simuler une mise a jour sans installer un binaire non signe.

## Verification

- Tests Rust pour les decisions de nettoyage conditionnel et de detection d'un ecart de veille.
- Tests d'integration statiques pour les reglages, la carte A propos et la configuration Tauri.
- Test JavaScript du minuteur et du verrouillage sans exposer de secret dans les sorties.
- Validation du workflow GitHub, de la generation du manifeste et des signatures.
- Verification manuelle d'une mise a jour entre deux versions de test avant publication stable.

## Hors perimetre de cette phase

La refonte de la liste, le panneau Nouvel acces, Ctrl+K, l'historique, la corbeille, les imports et TOTP seront traites dans les phases suivantes deja approuvees.
