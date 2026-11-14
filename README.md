# MashVoice — Singularity 4.1 P2P (Rust + Tauri v2 🦀)

Logiciel professionnel de communication **P2P chiffré écrit en Rust** (avec **Axum + Tokio** et **Tauri v2** Desktop & Mobile), reprenant toutes les fonctionnalités de Discord avec le style spatial **Trou Noir 3D de Schwarzschild** de *MashClient Singularity*.

---

## Architecture Rust (`Cargo.toml`)

- [`crates/mashvoice-core`](crates/mashvoice-core) — **Coeur Rust natif** :
  - [`security.rs`](crates/mashvoice-core/src/security.rs) : Tokens de connexion obligatoires `MASH-SV4` signés **HMAC-SHA256** (comparaison en temps constant `subtle`), coffre-fort local chiffré **AES-256-GCM**, anti-bruteforce, et génération/validation **QR Code SVG** en Rust pour l'authentification instantanée Mobile → PC.
  - [`hardware.rs`](crates/mashvoice-core/src/hardware.rs) : Contrôleur matériel natif via `sysinfo` (scan ultra-léger des processus de jeux actifs : *MashClient, Minecraft, Valorant, CS2, Fortnite, GTA V...*, réglage GPU dédié NVENC/AMF vs iGPU vs CPU pur, budget RAM `512–8192 Mo`, nombre de threads CPU Tokio).
  - [`updater.rs`](crates/mashvoice-core/src/updater.rs) : **Auto-Updater GitHub Rust** (`reqwest` + `rustls-tls` + `semver`) ciblant le dépôt privé `MyMasha/MashVoice` avec un token **Read-Only valable 365 jours**.
  - [`store.rs`](crates/mashvoice-core/src/store.rs) : Serveurs communautaires, rôles colorés et permissions granulaires, salons textuels/vocaux/streams, messages privés, réactions et révocation temps réel.
- [`crates/mashvoice-server`](crates/mashvoice-server) — **Serveur P2P Async Tokio/Axum & CLI Rust** :
  - Hub WebSocket temps réel de signalisation **WebRTC Mesh P2P**, vérification continue du Token obligatoire (Heartbeat 15s + déconnexion instantanée en cas de révocation), et binaire autonome ultra-léger (~10–15 Mo de RAM, zéro Garbage Collector).
- [`src-tauri`](src-tauri) — **Shell Natif Tauri v2 (Desktop Windows/Linux/macOS + Mobile Android/iOS)** :
  - Remplace Electron par du Rust natif + `tauri-plugin-updater` pour prendre un minimum absolu de ressources pendant vos sessions de jeu.

---

## Lien GitHub Token Read-Only (365 jours — Organisation `MyMasha`)

Cliquez sur ce lien pré-rempli pour générer votre Fine-Grained Token en lecture seule (`contents:read` + `metadata:read`, durée `365 jours`, organisation `MyMasha`) pour l'Auto-Updater :

👉 **[Générer le Token GitHub Read-Only (365 jours • MyMasha)](https://github.com/settings/personal-access-tokens/new?name=MashVoice+Auto-Updater&description=Token+Read-Only+(365+jours)+pour+l%27auto-updater+MashVoice+sur+MyMasha&target_name=MyMasha&expires_in=365&contents=read&metadata=read)**

*(Sur la page GitHub, vérifiez que **Resource owner** est bien sur `MyMasha` et sélectionnez `Only select repositories → MashVoice`, puis collez le token dans l'onglet **Auto-Updater** du Launcher ou des Paramètres).*

---

## Commandes Rust & Build

```bash
# 1. Exécuter toute la suite de tests Rust (Unitaires + Intégration WS/QR/P2P)
cargo test --workspace

# 2. Générer un nouveau Token de Connexion obligatoire en Rust pour un ami
cargo run -q -p mashvoice-server -- mint-token --label "Ami Escouade" --days 365

# 3. Compiler le frontend et lancer le serveur/noeud Rust optimisé (--release)
npm run ui:build
cargo run --release -p mashvoice-server

# 4. Compiler l'application Desktop native Tauri v2 (.exe / .msi / .AppImage / .dmg)
npm run tauri:build

# 5. Compiler l'application Mobile native Android / iOS via Tauri v2
npx tauri android init && npm run tauri:android
```
