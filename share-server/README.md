# Serveur de partage Clave

Petit serveur Node (aucune dépendance) qui héberge les liens de partage à usage unique.
Clave en a besoin pour la fonction **Partager par lien** : sans serveur, le partage reste désactivé.

- [Comment ça marche](#comment-ça-marche)
- [Modèle de menace et limite importante](#modèle-de-menace-et-limite-importante)
- [Ce qu’il vous faut](#ce-quil-vous-faut)
- [Option 1 — Docker (recommandé)](#option-1--docker-recommandé)
- [Option 2 — Installation manuelle (Node + Caddy)](#option-2--installation-manuelle-node--caddy)
- [Option 3 — Essai rapide depuis votre PC](#option-3--essai-rapide-depuis-votre-pc)
- [Brancher Clave sur le serveur](#brancher-clave-sur-le-serveur)
- [Problèmes fréquents](#problèmes-fréquents)
- [Référence technique](#référence-technique)

## Comment ça marche

1. Clave chiffre l’accès sur votre appareil (AES-256-GCM, clé aléatoire de 256 bits).
2. Seul le texte chiffré est envoyé au serveur, qui renvoie un identifiant.
3. Clave construit le lien `https://votre-domaine/s/<id>#<clé>`. La partie après le `#` n’est
   jamais envoyée par les navigateurs : **le serveur ne peut pas lire ce que vous partagez**.
4. Le destinataire ouvre le lien et clique sur **Afficher l’accès**. Le serveur lui renvoie le
   texte chiffré et **le supprime aussitôt**. Le déchiffrement a lieu dans son navigateur.

Les secrets non consultés expirent (5 min à 7 jours). Ils sont gardés uniquement en mémoire :
redémarrer le serveur efface tous les liens en attente.

## Modèle de menace et limite importante

Le chiffrement de bout en bout protège contre un serveur **passif et honnête** : une fuite de
la mémoire ou des journaux du serveur ne révèle aucun secret.

Il **ne protège pas** contre un serveur **compromis ou malveillant**. La page `/s/<id>` et son
script `viewer.js` sont fournis par ce même serveur : un attaquant qui le contrôle peut les
remplacer par une version qui lit la clé dans le fragment `#…` et la lui transmet.

Pour les secrets sensibles, utilisez le **déchiffreur hors ligne**
[`offline/dechiffreur-clave.html`](offline/dechiffreur-clave.html) :

1. Conservez-en une copie locale (ou hébergez-la sur un domaine distinct du serveur de stockage).
2. Vérifiez son empreinte avant usage :
   ```bash
   sha256sum dechiffreur-clave.html
   ```
   Empreinte attendue : `1422b591339e221bb4b1302bce9b7569838ca68d3fa3887ee64f14b3df201e79`
3. Ouvrez le fichier dans le navigateur et collez le lien complet. La page ne demande au
   serveur que le texte chiffré ; la clé ne lui est jamais transmise.

Le destinataire doit obtenir ce fichier et son empreinte par un canal distinct du lien.

## Ce qu’il vous faut

| Élément | Pourquoi | Exemples |
| --- | --- | --- |
| Un serveur allumé en permanence | Le lien doit fonctionner quand le destinataire l’ouvre | VPS à ~4 €/mois (OVH, Hetzner, Scaleway, Infomaniak…), Raspberry Pi, NAS |
| Un nom de domaine | Clave exige une adresse **HTTPS**, qui nécessite un domaine | `partage.mondomaine.fr` (~10 €/an chez OVH, Gandi, Infomaniak…) |
| 10 minutes | | |

Le serveur consomme très peu : la plus petite offre VPS suffit largement.

> Pas de domaine ni de serveur pour l’instant ? Essayez d’abord l’[option 3](#option-3--essai-rapide-depuis-votre-pc).

### Étape commune : faire pointer le domaine vers le serveur

1. Notez l’**adresse IP publique** de votre serveur (affichée dans l’espace client de l’hébergeur).
2. Dans l’interface de votre registrar (là où vous avez acheté le domaine), section **DNS**,
   ajoutez un enregistrement :
   - Type : `A`
   - Nom / sous-domaine : `partage` (pour obtenir `partage.mondomaine.fr`)
   - Valeur : l’adresse IP du serveur
3. Patientez quelques minutes (parfois jusqu’à une heure). Pour vérifier, depuis votre PC :
   ```bash
   ping partage.mondomaine.fr
   ```
   L’IP affichée doit être celle de votre serveur.

### Se connecter au serveur

Les commandes suivantes se tapent **sur le serveur**, via SSH. Depuis Windows (PowerShell),
macOS ou Linux :

```bash
ssh root@ADRESSE_IP_DU_SERVEUR
```

L’hébergeur vous fournit l’utilisateur (`root`, `ubuntu`, `debian`…) et le mot de passe ou la
clé SSH. Les exemples ci-dessous supposent Ubuntu ou Debian.

## Option 1 — Docker (recommandé)

Docker installe tout d’un coup : le serveur de partage et **Caddy**, qui obtient et renouvelle
automatiquement le certificat HTTPS.

1. **Installer Docker** (une seule fois) :
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. **Copier le dossier `share-server`** sur le serveur. Depuis votre PC, à la racine du projet :
   ```bash
   scp -r share-server root@ADRESSE_IP_DU_SERVEUR:/opt/clave-share
   ```
3. **Indiquer votre domaine**, sur le serveur :
   ```bash
   cd /opt/clave-share
   echo "DOMAIN=partage.mondomaine.fr" > .env
   ```
4. **Démarrer** :
   ```bash
   docker compose up -d
   ```
5. **Vérifier** : ouvrez `https://partage.mondomaine.fr/healthz` dans votre navigateur.
   Vous devez voir `{"ok":true}`.

Le serveur redémarre tout seul après un reboot. Commandes utiles :

```bash
docker compose logs -f      # voir ce qui se passe
docker compose restart      # redémarrer
docker compose down         # arrêter
```

Pour mettre à jour, recopiez le dossier `share-server` puis lancez `docker compose up -d --build`.

## Option 2 — Installation manuelle (Node + Caddy)

À utiliser si vous ne voulez pas de Docker.

1. **Installer Node.js 20 ou plus récent** :
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   node --version
   ```
2. **Copier le dossier** (depuis votre PC) :
   ```bash
   scp -r share-server root@ADRESSE_IP_DU_SERVEUR:/opt/clave-share
   ```
3. **Lancer le serveur comme service**, pour qu’il démarre au boot et redémarre en cas de
   problème. Créez le fichier `/etc/systemd/system/clave-share.service` (par exemple avec
   `nano /etc/systemd/system/clave-share.service`) :
   ```ini
   [Unit]
   Description=Serveur de partage Clave
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /opt/clave-share/server.js
   Environment=PORT=8787 HOST=127.0.0.1 TRUST_PROXY=1
   DynamicUser=yes
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
   Puis :
   ```bash
   systemctl daemon-reload
   systemctl enable --now clave-share
   systemctl status clave-share
   ```
4. **Installer Caddy** pour le HTTPS (instructions officielles :
   <https://caddyserver.com/docs/install#debian-ubuntu-raspbian>), puis remplacez le contenu de
   `/etc/caddy/Caddyfile` par :
   ```
   partage.mondomaine.fr {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   et rechargez :
   ```bash
   systemctl reload caddy
   ```
5. **Vérifier** : `https://partage.mondomaine.fr/healthz` doit afficher `{"ok":true}`.

> **Déjà nginx sur votre serveur ?** Ajoutez un bloc `server` pour le domaine avec
> `proxy_pass http://127.0.0.1:8787;` et `proxy_set_header X-Forwarded-For $remote_addr;`,
> puis obtenez le certificat avec `certbot --nginx -d partage.mondomaine.fr`.

## Option 3 — Essai rapide depuis votre PC

Pour tester sans serveur ni domaine, avec [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(gratuit, sans compte pour un essai) :

```bash
node share-server/server.js
```

Dans un second terminal :

```bash
cloudflared tunnel --url http://localhost:8787
```

`cloudflared` affiche une adresse du type `https://xxxx.trycloudflare.com` : collez-la dans Clave.

Limites : les liens ne marchent que tant que votre PC et les deux commandes tournent, et
l’adresse change à chaque relance. C’est parfait pour essayer, pas pour un usage quotidien.

## Brancher Clave sur le serveur

1. Dans Clave, ouvrez **Paramètres › Partage**.
2. Saisissez l’adresse, par exemple `https://partage.mondomaine.fr`, puis **Enregistrer**.
3. Clic droit sur un accès → **Partager par lien** → **Créer le lien**.

Clave refuse les adresses en `http://`, sauf `localhost` pour le développement.

## Problèmes fréquents

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| « Le serveur de partage est injoignable » | Serveur arrêté, mauvaise adresse ou DNS pas encore propagé | Ouvrez `https://votre-domaine/healthz` dans un navigateur. Vérifiez `docker compose ps` ou `systemctl status clave-share`. |
| Erreur de certificat / HTTPS | Le domaine ne pointe pas encore vers le serveur, ou les ports 80/443 sont fermés | Vérifiez l’enregistrement DNS (`ping`). Ouvrez les ports 80 et 443 dans le pare-feu de l’hébergeur (et `ufw allow 80,443/tcp` si `ufw` est actif). |
| « Le serveur de partage a refusé la demande (404) » | L’adresse contient un chemin en trop | Saisissez seulement `https://partage.mondomaine.fr`. |
| « Trop de partages récents » | Limite anti-abus : 30 liens / 10 min par adresse IP | Patientez quelques minutes. |
| Tous les liens disparaissent | Le serveur a redémarré (stockage en mémoire) | Comportement normal : recréez le lien. |
| Le destinataire voit « Lien indisponible » | Lien déjà ouvert, expiré, ou copié sans la partie après le `#` | Créez un nouveau lien et envoyez-le en entier. |

## Référence technique

Variables d’environnement : `PORT` (8787), `HOST` (127.0.0.1), `TRUST_PROXY=1` derrière un proxy
inverse (utilise la première adresse de `X-Forwarded-For` pour la limitation de débit — le proxy
doit donc la remplacer, pas la compléter).

Ouvrir la page (`GET /s/<id>`) ne consomme pas le secret : les aperçus de liens des messageries
ne le détruisent donc pas.

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| `POST` | `/api/secrets` | `{ ciphertext, ttl }` → `201 { id, expiresAt }` (30 / 10 min / IP) |
| `POST` | `/api/secrets/:id/reveal` | `200 { ciphertext }` puis suppression, sinon `404` |
| `GET` | `/s/:id` | Page de consultation (ne consomme rien) |
| `GET` | `/healthz` | Sonde de disponibilité |
