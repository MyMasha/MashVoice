# MashVoice — Singularity 4.1 P2P (Open Source • Rust + Tauri v2 🦀)

Application de communication vocale, vidéo et messagerie **P2P chiffrée de bout en bout** écrite en **Rust (`Axum` + `Tokio`)** et **Tauri v2**, inspirée de l'esthétique spatiale **Trou Noir 3D de Schwarzschild** de *MashClient Singularity*.

- **100 % par Pseudo (Zero-IP)** : ajoutez vos amis partout dans le monde uniquement avec leur **pseudo** (`ex: v0dka` ou `v0dka#4921`) grâce au relais temps réel **`mv-relay-v1`** propulsé par **[zyntra.win](https://zyntra.win)** (`wss://zyntra.win/api/mashvoice/ws`), avec boîte aux lettres hors-ligne chiffrée (7 jours) et zéro adresse IP exposée.
- **Chiffrement E2EE Sans Clé Statique** : accord de clé asymétrique **ECDH P-256** + **AES-256-GCM** côté client (`mv4e1.*`) et flux audio/vidéo **WebRTC DTLS-SRTP** jusqu'à **120 FPS**.
- **Ultra-Léger en Jeu** : binaire natif Rust + Tauri v2 (~15 Mo RAM côté moteur, zéro Electron/Chromium embarqué lourd, pause automatique du shader 3D en jeu).

---

## 📥 Téléchargement Windows (`.exe` signé & Sans SmartScreen)

Téléchargez la dernière version officielle signée cryptographiquement (`Ed25519`) sur GitHub Releases :

👉 **[Télécharger MashVoice pour Windows x64 (`setup.exe` / `Portable.zip` / `.msi`)](https://github.com/MyMasha/MashVoice/releases/latest)**

### ⚡ Installation en 1 ligne (Zéro Pop-Up Bleue SmartScreen / Zéro UAC)
Ouvrez **PowerShell** et collez :
```powershell
irm https://github.com/MyMasha/MashVoice/releases/latest/download/install-mashvoice.ps1 | iex
```
> Ce script officiel télécharge la dernière Release `MyMasha/MashVoice`, retire automatiquement l'attribut navigateur `Zone.Identifier` (`Unblock-File`) responsable de l'écran bleu Windows SmartScreen, installe MashVoice dans votre session utilisateur (`%LOCALAPPDATA%\MashVoice`) et le lance immédiatement.  
> Toutes les mises à jour suivantes s'installent **en 1 clic directement dans l'application** (pastille dorée `Mise à jour`) par remplacement atomique `.exe` — **sans jamais redéclencher SmartScreen** — puis affichent automatiquement le **Changelog** au redémarrage !

---

## ✨ Fonctionnalités Principales

1. **Ajout d'Amis & Messagerie 100 % Pseudo (`Zero-IP`)**
   - Connexion automatique à `wss://zyntra.win/api/mashvoice/ws` + repli HTTPS REST (`https://zyntra.win/api/mashvoice/publish`, `/poll`, `/presence/:pseudo`).
   - Les demandes d'amis et messages privés envoyés à un contact hors-ligne sont conservés chiffrés jusqu'à 7 jours et livrés dès sa reconnexion, puis nettoyés par `ack`.
2. **🛡️ MashKrisp™ IA (Isolation Vocale Anti-Clavier) & Hot-Plug Micro**
   - Filtre DSP temps réel `AudioWorklet` supprimant les clics de clavier mécanique, chocs de bureau et souffles de ventilateurs PC tout en préservant le timbre naturel de la voix (`< 3 ms` de latence).
   - Réparation et redemande d'autorisation microphone en 1 clic avec remplacement à chaud (`replaceTrack`) sans quitter l'appel.
3. **Vocal Haute Fidélité, Sonneries Musicales & Partage d'Écran 120 FPS**
   - Musiques d'appels entrants/sortants et sons d'événements style Discord synthétisés en WebAudio polyphonique (volume réglable).
   - Transport média direct **WebRTC P2P** à latence minimale (`maintain-framerate`, priorité encodeur matériel GPU NVENC / AMF / QSV).
4. **Serveurs Communautaires, Menu Clic-Droit & Paramètres Serveur Complets**
   - Menu contextuel complet style Discord (Muet, Notifications, Profil par serveur, Emojis & Stickers, Icône & Bannière, Déplacer, Quitter) et administration multi-onglets.
5. **Contrôleur Matériel Gaming Natif (`sysinfo`) & Authentification Zero-Trust QR**
   - Détection automatique des jeux actifs (*MashClient, Minecraft, Valorant, CS2, Fortnite...*), budget RAM ajustable, mise en veille `0% GPU` du shader 3D en jeu, tokens `MASH-SV4` (`HMAC-SHA256`) et connexion instantanée par scan QR Mobile.

---

## 🦀 Architecture du Dépôt

- [`crates/mashvoice-core`](crates/mashvoice-core) — **Coeur cryptographique & métier en Rust** :
  - [`security.rs`](crates/mashvoice-core/src/security.rs) : Tokens `MASH-SV4` (`HMAC-SHA256`), coffre-fort local `AES-256-GCM`, permissions fichier `0600` propriétaire uniquement, anti-bruteforce et défis QR SVG.
  - [`relay.rs`](crates/mashvoice-core/src/relay.rs) : Constantes et enveloppes chiffrées `mv4e1.*` (`AES-256-GCM`) du protocole Zero-IP `mv-relay-v1` (`zyntra.win`).
  - [`hardware.rs`](crates/mashvoice-core/src/hardware.rs) : Télémétrie CPU/RAM et détection de processus de jeux via `sysinfo`.
  - [`updater.rs`](crates/mashvoice-core/src/updater.rs) : Vérificateur Open-Source des Releases publiques `MyMasha/MashVoice` (`semver` + clé publique `Ed25519` `F6A9F0FBF91D7ADE`).
  - [`store.rs`](crates/mashvoice-core/src/store.rs) : État persistant des serveurs, salons, rôles, messages et sessions.
- [`crates/mashvoice-server`](crates/mashvoice-server) — **Moteur HTTP/WebSocket Async (`Axum` + `Tokio`) & CLI** :
  - API locale (`127.0.0.1` par défaut sous Tauri), contrôle d'accès RBAC strict (`FOUNDER` / `ADMIN` vs `MEMBER`) et hub temps réel.
- [`src-tauri`](src-tauri) — **Shell Natif Tauri v2** :
  - Fenêtre native sans bordure, pont IPC vers le coffre-fort Rust et plugin `tauri-plugin-updater`.
- [`src/`](src) — **Interface React 19 + Vite 6 + WebGL Schwarzschild Shader** :
  - [`src/lib/globalMesh.js`](src/lib/globalMesh.js) : Client temps réel `mv-relay-v1` (`wss://zyntra.win/api/mashvoice/ws`) avec chiffrement de bout en bout WebCrypto **ECDH P-256 + AES-256-GCM**.

---

## 🔐 Sécurité Open-Source & Fichiers Secrets Administrateur

Consultez [**SECURITY.md**](SECURITY.md) pour le détail complet de l'architecture de sécurité :

- **Zéro secret dans le dépôt** : aucune clé API, aucun token GitHub et aucune clé privée ne figurent dans Git. Seule la **clé publique de vérification** de l'Auto-Updater (`plugins.updater.pubkey` dans [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)) est publique par conception.
- **Clé privée de signature Release (`TAURI_SIGNING_PRIVATE_KEY`)** : conservée exclusivement dans les **GitHub Actions Secrets** administrateur de `MyMasha/MashVoice`.
- **Fichiers secrets locaux inaccessibles aux non-admins** : `data/master.secret`, `data/secure-vault.bin`, `data/mashvoice-state.json` et `.env` sont exclus de Git (`.gitignore`), créés avec les permissions **`0600`** (propriétaire uniquement) et protégés côté API par un contrôle RBAC strict (`FOUNDER` / `ADMIN` requis sur `/api/security/tokens` et `/api/security/tokens/revoke` — un membre `MEMBER` ne peut ni lire ni révoquer les tokens administrateur).
- Un modèle de configuration serveur sans aucun secret est disponible dans [`.env.example`](.env.example).

---

## 🛠️ Développement, Tests & Compilation

### Prérequis
- **Rust** (`stable`, `cargo` 1.80+)
- **Node.js** (`22 LTS` recommandé) & `npm`

### Commandes utiles

```bash
# 1. Installer les dépendances de l'interface
npm install

# 2. Compiler le frontend React/Vite
npm run ui:build

# 3. Exécuter toute la suite de tests Rust (unitaires + intégration RBAC/WS/QR)
cargo test --workspace

# 4. Lancer le moteur local Rust en mode développement / auto-hébergé
cargo run --release -p mashvoice-server

# 5. Générer un Token de Connexion (côté Administrateur hôte uniquement)
cargo run -q -p mashvoice-server -- mint-token --label "Invitation Escouade" --days 365

# 6. Compiler l'installateur natif Tauri v2 (.exe / .msi sous Windows)
npm run tauri:build

# 7. Compiler en local sur Windows (~45s) ET publier directement sur GitHub Releases (sans attendre GitHub Actions !)
npm run release:local
# (ou avec incrément auto de version : powershell -ExecutionPolicy Bypass -File scripts/publish-local-release.ps1 -Version 1.0.8)
```

---

## 📄 Licence

Projet Open Source distribué sous licence **MIT** — © [MyMasha](https://github.com/MyMasha/MashVoice) & [Zyntra](https://zyntra.win).
