# Politique de Sécurité & Gestion des Secrets — MashVoice (Open Source)

MashVoice est un projet **Open Source** (`MyMasha/MashVoice`). Aucune clé API privée, aucun jeton GitHub (`PAT`), aucune graine de chiffrement statique et aucun secret administrateur ne sont présents dans le code source ou dans les exécutables distribués.

---

## 1. Seule clé présente dans le dépôt : Clé Publique de Vérification Auto-Updater (`Ed25519`)

Conformément à l'architecture de sécurité de **Tauri v2** (`tauri-plugin-updater`) :

- **Clé publique intégrée (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, ID `F6A9F0FBF91D7ADE`)** :
  - Sert **exclusivement à vérifier cryptographiquement** la signature `.sig` (`Ed25519`) des mises à jour téléchargées depuis GitHub Releases avant toute installation.
  - Il est mathématiquement impossible de signer un exécutable ou de publier une mise à jour avec cette clé publique.
- **Clé privée de signature (`TAURI_SIGNING_PRIVATE_KEY`) — Strictement Administrateur** :
  - Stockée **uniquement** dans le coffre chiffré **GitHub Actions Secrets** de l'organisation `MyMasha/MashVoice` (inaccessible aux contributeurs externes, aux forks et aux utilisateurs non-administrateurs).
  - Le workflow `.github/workflows/release.yml` applique le principe du moindre privilège (`contents: read` par défaut, et `if: github.repository == 'MyMasha/MashVoice'` pour l'étape de signature).

---

## 2. Fichiers Secrets Locaux (Inaccessibles aux Non-Administrateurs)

Lorsqu'une instance de `mashvoice-server` ou de l'application Desktop s'exécute, ses fichiers sensibles sont générés localement hors Git (exclus par `.gitignore`) et verrouillés au niveau du système d'exploitation (`chmod 0600` sur Unix / profil utilisateur courant sous Windows via `write_admin_secret_file`) :

| Fichier local (ignoré par Git) | Rôle | Accès |
| :--- | :--- | :--- |
| `data/master.secret` | Clé secrète aléatoire 256 bits (`OsRng`) signant les tokens `MASH-SV4` (`HMAC-SHA256`) | **Admin Hôte uniquement (`0600`)** |
| `data/secure-vault.bin` | Coffre-fort local chiffré en **AES-256-GCM** | **Utilisateur local uniquement (`0600`)** |
| `data/mashvoice-state.json` | Registre des tokens émis/révoqués et état local | **Admin Hôte uniquement (`0600`)** |
| `.env` *(optionnel)* | Variables d'environnement serveur (voir `.env.example`) | **Admin Hôte uniquement (ignoré par Git)** |

### Isolation RBAC dans l'API Rust (`crates/mashvoice-server`)

Même lorsqu'un utilisateur dispose d'un Token de Connexion valide de rang `MEMBER` :
1. **`GET /api/security/tokens`** filtre strictement la réponse : un compte non-admin reçoit `isAdmin: false` avec `tokens: []` et `activeSessions: []`. Les valeurs brutes des tokens `FOUNDER` / `ADMIN` ne quittent **jamais** une session administrateur.
2. **`POST /api/security/tokens/revoke`** et **`POST /api/updater/config`** exigent le rang `FOUNDER` ou `ADMIN` et renvoient `403 FORBIDDEN` à tout non-administrateur.
3. **`GET /api/bootstrap/public`** n'expose les `starterTokens` d'amorçage **que** sur l'interface loopback locale (`127.0.0.1` / `::1`) et peut être totalement désactivé via `MASHVOICE_HIDE_STARTER_TOKENS=true`.
4. **Écoute locale sécurisée** : sous Tauri Desktop, le moteur Axum écoute par défaut uniquement sur `127.0.0.1` (aucun port ouvert sur le Wi-Fi public).

---

## 3. Relais Zero-IP (`mv-relay-v1` sur `zyntra.win`) & Chiffrement de Bout en Bout (E2EE)

- **Zéro adresse IP exposée** : l'ajout d'amis, les messages privés (y compris hors-ligne jusqu'à 7 jours) et la signalisation WebRTC passent par `wss://zyntra.win/api/mashvoice/ws` (et le repli HTTPS `https://zyntra.win/api/mashvoice`) uniquement via votre **Pseudo** (`ex: v0dka` ou `v0dka#4921`).
- **Zéro clé de chiffrement statique dans le code Open Source** :
  - Chaque client génère localement une paire de clés asymétriques **WebCrypto ECDH P-256** dont la clé privée ne quitte jamais l'appareil.
  - Les enveloppes d'amis et d'appels (`mv4e1.e2e.<pub>.<ct>`) sont chiffrées de bout en bout en **AES-256-GCM** via accord de clé Diffie-Hellman (`ECDH P-256` + `SHA-256`).
  - Les salons de serveurs communautaires (`mv4e1.srv.<ct>`) dérivent leur clé `AES-256-GCM` du code d'invitation privé du serveur.
  - Le relais `zyntra.win` ne voit que des enveloppes opaques chiffrées `mv4e1.*` et supprime les messages dès réception d'un accusé `ack`.

---

## 4. Signaler une Vulnérabilité

N'ouvrez pas d'Issue publique contenant un exploit actif. Contactez directement les administrateurs de l'organisation GitHub **[@MyMasha](https://github.com/MyMasha)** pour un traitement coordonné.
