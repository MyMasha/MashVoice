# Protocole Relais MashVoice Zero-IP (`mv-relay-v1`) pour `https://zyntra.win`

> **Instructions directes pour l'Agent IA de `zyntra.win`** :
> Implémente ce microservice / module de relais sur **`https://zyntra.win`** sous le préfixe **`/api/mashvoice`**.
> Ce protocole permet aux utilisateurs du client **MashVoice (Rust + Tauri v2)** de s'ajouter en ami **uniquement avec un Pseudo** (ex: `rawsq` -> `v0dka`, **zéro adresse IP**), de recevoir leurs demandes d'amis et messages privés même s'ils étaient hors-ligne, et d'échanger la signalisation WebRTC (appels vocaux & stream 120 FPS).

---

## 1. Architecture & Principe Zero-Knowledge

1. **Zéro IP exposée** : les clients s'adressent uniquement via des clés logiques normalisées (`inbox:v0dka`, `inbox:v0dka-tag-4921`, `inbox:p2p-mash-xxxx`, `srv:srv-...`, `invite:mash-...`, `room:...`).
2. **Zéro texte en clair sur le serveur** : chaque charge utile (`envelope`) est déjà chiffrée de bout en bout côté client en **AES-256-GCM** (`mv4e1.<base64url_nonce_et_ciphertext>`). `zyntra.win` agit comme un routeur aveugle + boîte aux lettres temporaire.
3. **Zéro bande passante média** : l'audio, la caméra et les streams 1080p/1440p 120 FPS passent **directement de PC à PC en WebRTC P2P** après l'échange des paquets SDP/ICE (`< 4 Ko`). `zyntra.win` ne transporte que de petits paquets JSON.
4. **Double transport (WebSocket temps réel + Fallback REST HTTP)** sur le port standard **443 (`HTTPS` / `WSS`)** pour traverser 100 % des box Internet, 4G/5G, pare-feux Windows et Cloudflare.

---

## 2. Règle de Normalisation des Clés & Topics

Côté client comme côté serveur, toute clé de pseudo ou de topic est normalisée ainsi :

```js
function normKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')       // "@v0dka" -> "v0dka"
    .toLowerCase()
    .replace(/#/g, '-tag-')   // "v0dka#4921" -> "v0dka-tag-4921"
    .replace(/[^a-z0-9_.:-]/g, '')
    .slice(0, 96);
}
```

Préfixes de topics autorisés :
- `inbox:<pseudo>` (ex: `inbox:v0dka`)
- `inbox:<pseudo>-tag-<tag>` (ex: `inbox:v0dka-tag-4921`)
- `inbox:<peerId>` (ex: `inbox:p2p-mash-8f3a12bc`)
- `srv:<serverId>` (messages & événements de serveur communautaire)
- `invite:<inviteCode>` (rejoindre un serveur via code `MASH-XXXXXX`)
- `room:<roomId>` (présence salon vocal & signalisation WebRTC SDP/ICE)

---

## 3. Endpoints à exposer sur `https://zyntra.win`

### CORS obligatoire (pour Tauri Windows WebView2 & Web)
Toutes les routes `/api/mashvoice/*` doivent autoriser ces headers CORS (car l'application Windows Tauri v2 tourne sous l'origine `http://tauri.localhost` ou `https://tauri.localhost`, en plus du client Rust natif) :
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-MashVoice-App`
- Répondre `204 No Content` aux requêtes `OPTIONS`.
- Taille maximale du body JSON / frame WS : **`512 KB`** (pour permettre les images jointes chiffrées et les bundles SDP WebRTC).

---

### 3.1. `GET /api/mashvoice/health`
Permet à MashVoice de vérifier que le relais `zyntra.win` est en ligne.

**Réponse `200 OK` :**
```json
{
  "ok": true,
  "service": "zyntra-mashvoice-relay",
  "protocol": "mv-relay-v1",
  "wsUrl": "wss://zyntra.win/api/mashvoice/ws",
  "connectedPeers": 12,
  "serverTs": 1731612345678
}
```

---

### 3.2. `WSS /api/mashvoice/ws` (Transport Temps Réel Principal)

Connexion WebSocket standard sur `wss://zyntra.win/api/mashvoice/ws` (sans sous-protocole particulier requis). Toutes les trames sont du **texte UTF-8 JSON**.

#### A. Trames Client -> Serveur

1. **`subscribe` — S'abonner à ses topics + récupérer les messages reçus hors-ligne**
```json
{
  "op": "subscribe",
  "peerId": "p2p-mash-9c41ef20",
  "pseudo": "v0dka",
  "tag": "4921",
  "topics": [
    "inbox:v0dka",
    "inbox:v0dka-tag-4921",
    "inbox:p2p-mash-9c41ef20"
  ],
  "sinceTs": 0
}
```
*Comportement attendu du serveur :*
- Enregistre les `topics` sur cette connexion WebSocket (peut être appelé plusieurs fois dans la session quand l'utilisateur rejoint un serveur `srv:...` ou un vocal `room:...` : faire une **union** des topics).
- Mémorise en mémoire que `pseudo` (`v0dka` et `v0dka-tag-4921`) est actuellement `online` (pour l'endpoint optionnel de présence).
- Répond immédiatement :
  ```json
  {
    "op": "sub_ack",
    "ok": true,
    "topics": ["inbox:v0dka", "inbox:v0dka-tag-4921", "inbox:p2p-mash-9c41ef20"],
    "serverTs": 1731612345678
  }
  ```
- Puis envoie sous forme de trames `deliver` tous les messages stockés en boîte aux lettres (`mailbox`) pour ces `topics` ayant `ts > sinceTs` et non expirés (triés par `ts` croissant).

2. **`publish` — Envoyer un paquet chiffré vers un ou plusieurs topics (par Pseudo ou Peer ID)**
```json
{
  "op": "publish",
  "msgId": "7d9e41b0-3c1a-4b9f-9e12-8812a34bc901",
  "senderPeerId": "p2p-mash-1122aabb",
  "topics": ["inbox:v0dka"],
  "storeOffline": true,
  "ttlSec": 604800,
  "envelope": "mv4e1.eyJpdiI6..."
}
```
*Comportement attendu du serveur :*
- **Déduplication** : si `msgId` a déjà été vu dans les dernières minutes, renvoyer simplement `pub_ack` sans redistribuer.
- **Diffusion live (`< 10ms`)** : pour chaque client WebSocket abonné à **au moins un** des `topics` demandés (et dont `peerId !== senderPeerId`), envoyer **une seule** trame `deliver` (même si le client est abonné à la fois à `inbox:v0dka` et `inbox:v0dka-tag-4921`, ne lui livrer `msgId` qu'une fois).
- **File d'attente hors-ligne (`mailbox`)** : si `storeOffline !== false`, conserver le message pour chaque topic de `topics` (max **200 messages par topic**, durée de vie `ttlSec` bornée entre `60` et `604800` secondes = 7 jours ; pour la signalisation WebRTC éphémère le client enverra `storeOffline: false`).
- Répondre à l'émetteur :
  ```json
  {
    "op": "pub_ack",
    "ok": true,
    "msgId": "7d9e41b0-3c1a-4b9f-9e12-8812a34bc901",
    "liveRecipients": 1,
    "queued": true,
    "serverTs": 1731612345678
  }
  ```

3. **`ack` — Accuser réception pour nettoyer sa boîte aux lettres hors-ligne**
```json
{
  "op": "ack",
  "topics": ["inbox:v0dka", "inbox:v0dka-tag-4921", "inbox:p2p-mash-9c41ef20"],
  "msgIds": ["7d9e41b0-3c1a-4b9f-9e12-8812a34bc901"]
}
```
*Comportement attendu :* supprime ces `msgIds` uniquement dans les files d'attente des `topics` indiqués (pour qu'une demande d'ami déjà acceptée ou refusée ne réapparaisse pas au redémarrage suivant).

4. **`ping` — Keepalive (envoyé toutes les 25s pour éviter le timeout Cloudflare de 100s)**
```json
{ "op": "ping", "ts": 1731612345678 }
```
*Réponse du serveur :*
```json
{ "op": "pong", "ts": 1731612345678, "serverTs": 1731612345680 }
```

#### B. Trame Serveur -> Client (`deliver`)
```json
{
  "op": "deliver",
  "msgId": "7d9e41b0-3c1a-4b9f-9e12-8812a34bc901",
  "topic": "inbox:v0dka",
  "senderPeerId": "p2p-mash-1122aabb",
  "ts": 1731612345678,
  "envelope": "mv4e1.eyJpdiI6..."
}
```

---

### 3.3. Endpoints HTTP REST (Fallback Anti-Pare-feu & Mode Sans WebSocket)

Ces deux routes partagent **exactement la même mémoire / boîte aux lettres** que le WebSocket :

#### `POST /api/mashvoice/publish`
- **Body JSON** : identique à la trame WS `publish` (`{ msgId, senderPeerId, topics, storeOffline, ttlSec, envelope }`).
- **Action** : pousse en temps réel aux clients WebSocket connectés **ET** stocke dans la boîte aux lettres si `storeOffline !== false`.
- **Réponse `200 OK`** :
  ```json
  {
    "ok": true,
    "msgId": "7d9e41b0-3c1a-4b9f-9e12-8812a34bc901",
    "liveRecipients": 1,
    "queued": true,
    "serverTs": 1731612345678
  }
  ```

#### `POST /api/mashvoice/poll`
- **Body JSON** :
  ```json
  {
    "peerId": "p2p-mash-9c41ef20",
    "pseudo": "v0dka",
    "topics": ["inbox:v0dka", "inbox:v0dka-tag-4921", "inbox:p2p-mash-9c41ef20"],
    "sinceTs": 1731600000000,
    "ackMsgIds": []
  }
  ```
- **Action** :
  1. Met à jour `lastSeen` de `pseudo` (considéré en ligne s'il a poll ou WS actif depuis `< 45s`).
  2. Supprime éventuellement `ackMsgIds` des `topics` fournis.
  3. Retourne tous les messages stockés pour `topics` avec `ts > sinceTs` (et `senderPeerId !== peerId`), dédupliqués par `msgId`.
- **Réponse `200 OK`** :
  ```json
  {
    "ok": true,
    "serverTs": 1731612345678,
    "messages": [
      {
        "msgId": "7d9e41b0-3c1a-4b9f-9e12-8812a34bc901",
        "topic": "inbox:v0dka",
        "senderPeerId": "p2p-mash-1122aabb",
        "ts": 1731612345678,
        "envelope": "mv4e1.eyJpdiI6..."
      }
    ]
  }
  ```

#### `GET /api/mashvoice/presence/:pseudo` *(Optionnel mais recommandé)*
- Permet d'afficher instantanément `v0dka est en ligne` ou `Demande déposée dans sa boîte (hors-ligne)` sans jamais exposer aucune IP.
- **Réponse `200 OK`** :
  ```json
  {
    "ok": true,
    "pseudo": "v0dka",
    "online": true,
    "lastSeenTs": 1731612345678
  }
  ```

---

## 4. Implémentation de Référence Complète (Node.js `ws` + HTTP, 0 BDD requise)

Si `zyntra.win` tourne sous Node.js (Express, Fastify, Next.js custom server ou microservice derrière Nginx/Caddy), voici une implémentation **complète, autonome et prête pour la production** avec persistance JSON sur disque :

```js
// mashvoiceRelay.js — Protocole mv-relay-v1 pour https://zyntra.win
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const DATA_FILE = process.env.MASHVOICE_RELAY_STORE || path.resolve('./mashvoice-mailbox.json');
const MAX_MSGS_PER_TOPIC = 200;
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours
const MAX_ENVELOPE_LEN = 512 * 1024;         // 512 Ko

function normKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/#/g, '-tag-')
    .replace(/[^a-z0-9_.:-]/g, '')
    .slice(0, 96);
}

// État en mémoire + sauvegarde disque asynchrone périodique
const mailboxByTopic = new Map(); // topic -> Array<{ msgId, topic, senderPeerId, ts, expiresAt, envelope }>
const seenMsgIds = new Map();     // msgId -> ts
const presenceByPseudo = new Map(); // pseudo -> lastSeenTs
const wsClients = new Set();      // Set<{ ws, peerId, pseudo, topics: Set<string> }>
let dirty = false;

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const now = Date.now();
    for (const [topic, list] of Object.entries(raw.mailboxes || {})) {
      const valid = list.filter((m) => m.expiresAt > now);
      if (valid.length > 0) mailboxByTopic.set(topic, valid);
    }
  }
} catch {
  // Démarrage propre si fichier absent/corrompu
}

function purgeAndPersist() {
  const now = Date.now();
  for (const [topic, list] of mailboxByTopic.entries()) {
    const kept = list.filter((m) => m.expiresAt > now);
    if (kept.length === 0) mailboxByTopic.delete(topic);
    else mailboxByTopic.set(topic, kept);
  }
  for (const [id, ts] of seenMsgIds.entries()) {
    if (now - ts > 10 * 60 * 1000) seenMsgIds.delete(id);
  }
  if (!dirty) return;
  dirty = false;
  const obj = { mailboxes: Object.fromEntries(mailboxByTopic) };
  fs.promises.writeFile(DATA_FILE, JSON.stringify(obj), 'utf8').catch(() => {});
}
setInterval(purgeAndPersist, 30_000).unref?.();

function dispatchPublish(body) {
  const msgId = String(body?.msgId || '').trim().slice(0, 80);
  const senderPeerId = String(body?.senderPeerId || '').trim().slice(0, 96);
  const envelope = String(body?.envelope || '');
  const rawTopics = Array.isArray(body?.topics) ? body.topics : [];
  const topics = [...new Set(rawTopics.map(normKey).filter(Boolean))].slice(0, 12);

  if (!msgId || !envelope || envelope.length > MAX_ENVELOPE_LEN || topics.length === 0) {
    return { ok: false, error: 'INVALID_PUBLISH_PAYLOAD' };
  }

  const now = Date.now();
  if (seenMsgIds.has(msgId)) {
    return { ok: true, msgId, liveRecipients: 0, queued: false, duplicate: true, serverTs: now };
  }
  seenMsgIds.set(msgId, now);

  // 1. Diffusion temps réel aux clients WebSocket connectés (dédupliquée par client)
  let liveRecipients = 0;
  for (const client of wsClients) {
    if (client.ws.readyState !== 1) continue;
    if (senderPeerId && client.peerId === senderPeerId) continue;
    const matchedTopic = topics.find((t) => client.topics.has(t));
    if (matchedTopic) {
      client.ws.send(
        JSON.stringify({
          op: 'deliver',
          msgId,
          topic: matchedTopic,
          senderPeerId,
          ts: now,
          envelope,
        })
      );
      liveRecipients += 1;
    }
  }

  // 2. Stockage boîte aux lettres hors-ligne
  const storeOffline = body?.storeOffline !== false;
  if (storeOffline) {
    const ttlMs = Math.min(
      Math.max((Number(body?.ttlSec) || 604800) * 1000, 60_000),
      DEFAULT_TTL_MS
    );
    const expiresAt = now + ttlMs;
    for (const topic of topics) {
      const list = mailboxByTopic.get(topic) || [];
      list.push({ msgId, topic, senderPeerId, ts: now, expiresAt, envelope });
      if (list.length > MAX_MSGS_PER_TOPIC) {
        list.splice(0, list.length - MAX_MSGS_PER_TOPIC);
      }
      mailboxByTopic.set(topic, list);
    }
    dirty = true;
  }

  return { ok: true, msgId, liveRecipients, queued: storeOffline, serverTs: now };
}

function collectStoredMessages(topics, sinceTs = 0, excludePeerId = '') {
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const t of topics) {
    const list = mailboxByTopic.get(t);
    if (!list) continue;
    for (const m of list) {
      if (m.expiresAt <= now || m.ts <= sinceTs) continue;
      if (excludePeerId && m.senderPeerId === excludePeerId) continue;
      if (seen.has(m.msgId)) continue;
      seen.add(m.msgId);
      out.push({
        msgId: m.msgId,
        topic: m.topic,
        senderPeerId: m.senderPeerId,
        ts: m.ts,
        envelope: m.envelope,
      });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function ackMessages(topics, msgIds) {
  if (!Array.isArray(msgIds) || msgIds.length === 0) return;
  const idSet = new Set(msgIds.map(String));
  for (const t of topics) {
    const list = mailboxByTopic.get(t);
    if (!list) continue;
    const filtered = list.filter((m) => !idSet.has(m.msgId));
    if (filtered.length !== list.length) {
      mailboxByTopic.set(t, filtered);
      dirty = true;
    }
  }
}

export function attachMashVoiceRelay(httpServer, expressApp) {
  // CORS middleware sur /api/mashvoice
  expressApp.use('/api/mashvoice', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MashVoice-App');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  expressApp.get('/api/mashvoice/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'zyntra-mashvoice-relay',
      protocol: 'mv-relay-v1',
      wsUrl: 'wss://zyntra.win/api/mashvoice/ws',
      connectedPeers: wsClients.size,
      serverTs: Date.now(),
    });
  });

  expressApp.get('/api/mashvoice/presence/:pseudo', (req, res) => {
    const key = normKey(req.params.pseudo);
    const wsOnline = [...wsClients].some((c) => c.ws.readyState === 1 && c.pseudo === key);
    const lastSeenTs = wsOnline ? Date.now() : presenceByPseudo.get(key) || 0;
    const online = wsOnline || Date.now() - lastSeenTs < 45_000;
    res.json({ ok: true, pseudo: key, online, lastSeenTs });
  });

  expressApp.post('/api/mashvoice/publish', (req, res) => {
    const result = dispatchPublish(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  expressApp.post('/api/mashvoice/poll', (req, res) => {
    const body = req.body || {};
    const peerId = String(body.peerId || '').trim();
    const pseudo = normKey(body.pseudo || '');
    if (pseudo) presenceByPseudo.set(pseudo, Date.now());
    const topics = [...new Set((body.topics || []).map(normKey).filter(Boolean))].slice(0, 24);
    ackMessages(topics, body.ackMsgIds || []);
    const messages = collectStoredMessages(topics, Number(body.sinceTs) || 0, peerId);
    res.json({ ok: true, serverTs: Date.now(), messages });
  });

  // Serveur WebSocket sur /api/mashvoice/ws
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_ENVELOPE_LEN + 16384 });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/mashvoice/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    }
  });

  wss.on('connection', (ws) => {
    const client = { ws, peerId: '', pseudo: '', topics: new Set() };
    wsClients.add(client);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        switch (msg.op) {
          case 'subscribe': {
            if (msg.peerId) client.peerId = String(msg.peerId).trim().slice(0, 96);
            if (msg.pseudo) {
              client.pseudo = normKey(msg.pseudo);
              presenceByPseudo.set(client.pseudo, Date.now());
            }
            const addedTopics = (msg.topics || []).map(normKey).filter(Boolean).slice(0, 32);
            for (const t of addedTopics) client.topics.add(t);

            ws.send(
              JSON.stringify({
                op: 'sub_ack',
                ok: true,
                topics: [...client.topics],
                serverTs: Date.now(),
              })
            );

            const queued = collectStoredMessages(
              addedTopics,
              Number(msg.sinceTs) || 0,
              client.peerId
            );
            for (const item of queued) {
              ws.send(JSON.stringify({ op: 'deliver', ...item }));
            }
            break;
          }
          case 'publish': {
            const res = dispatchPublish(msg);
            ws.send(JSON.stringify({ op: 'pub_ack', ...res }));
            break;
          }
          case 'ack': {
            const targetTopics = Array.isArray(msg.topics)
              ? msg.topics.map(normKey).filter(Boolean)
              : [...client.topics];
            ackMessages(targetTopics, msg.msgIds || []);
            break;
          }
          case 'ping': {
            if (client.pseudo) presenceByPseudo.set(client.pseudo, Date.now());
            ws.send(JSON.stringify({ op: 'pong', ts: msg.ts, serverTs: Date.now() }));
            break;
          }
          default:
            break;
        }
      } catch {
        // Ignorer les trames invalides
      }
    });

    ws.on('close', () => {
      if (client.pseudo) presenceByPseudo.set(client.pseudo, Date.now());
      wsClients.delete(client);
    });
  });
}
```

---

## 5. Configuration Reverse-Proxy (Nginx / Caddy / Cloudflare)

- **Cloudflare** : vérifier que **Network -> WebSockets** est sur **ON** pour `zyntra.win`.
- **Nginx** (si Nginx est devant le backend) :
  ```nginx
  location /api/mashvoice/ws {
      proxy_pass http://127.0.0.1:PORT_DU_BACKEND;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
  }

  location /api/mashvoice/ {
      client_max_body_size 1m;
      proxy_pass http://127.0.0.1:PORT_DU_BACKEND;
      proxy_set_header Host $host;
  }
  ```

---

## 6. Checklist de Validation Rapide (pour l'Agent IA de `zyntra.win`)

Une fois déployé sur `https://zyntra.win`, l'Agent IA doit vérifier ces 3 commandes avant de confirmer que c'est prêt :

```bash
# 1. Healthcheck HTTPS
curl -s https://zyntra.win/api/mashvoice/health

# 2. Envoi d'une demande d'ami chiffrée test vers le pseudo "v0dka"
curl -s -X POST https://zyntra.win/api/mashvoice/publish \
  -H "Content-Type: application/json" \
  -d '{"msgId":"test-001","senderPeerId":"p2p-mash-rawsq","topics":["inbox:v0dka"],"storeOffline":true,"envelope":"mv4e1.dGVzdA"}'

# 3. Récupération hors-ligne par "v0dka" + nettoyage (ack)
curl -s -X POST https://zyntra.win/api/mashvoice/poll \
  -H "Content-Type: application/json" \
  -d '{"peerId":"p2p-mash-v0dka","pseudo":"v0dka","topics":["inbox:v0dka"],"sinceTs":0,"ackMsgIds":["test-001"]}'
```

Dès que ces 3 tests répondent `"ok": true` (et que `wss://zyntra.win/api/mashvoice/ws` accepte l'upgrade WebSocket), **MashVoice** pourra brancher son moteur Rust + WebView directement sur `https://zyntra.win/api/mashvoice` en mode **100 % Pseudo uniquement (zéro IP)** !
