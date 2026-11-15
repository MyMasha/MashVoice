/**
 * MashVoice Singularity — Zero-IP Relay Client (`mv-relay-v1` on `https://zyntra.win`)
 *
 * Connects MashVoice Desktop (Tauri v2) & Web clients over `wss://zyntra.win/api/mashvoice/ws`
 * (with automatic HTTPS REST fallback on `https://zyntra.win/api/mashvoice/publish` & `/poll`) so:
 *  1. Friends add each other strictly by Pseudo (`v0dka` / `v0dka#4921`) — ZERO IP address!
 *  2. Offline friend requests & DMs are queued up to 7 days in Zyntra's SQLite mailbox until `ack`ed.
 *  3. Payloads use dynamic WebCrypto ECDH P-256 End-to-End Encryption (`mv4e1.e2e.*`) for friends,
 *     invite-derived AES-256-GCM (`mv4e1.srv.*`) for community servers, and topic-scoped handshakes
 *     (`mv4e1.hs.*`) — ZERO static global encryption key in Open-Source code!
 *  4. Voice, Camera & 120 FPS Screen Streams flow directly P2P via WebRTC after SDP/ICE signaling.
 */

export const ZYNTRA_HTTP_BASE = 'https://zyntra.win/api/mashvoice';
export const ZYNTRA_WS_URL = 'wss://zyntra.win/api/mashvoice/ws';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Exact `normKey` normalization matching `mashvoice-relay.js` on `zyntra.win`.
 */
export function normKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/#/g, '-tag-')
    .replace(/[^a-z0-9_.:-]/g, '')
    .slice(0, 96);
}

/**
 * Normalize a bare pseudo / identifier without `:` so it sits cleanly after `inbox:`.
 */
export function normTopicKey(raw) {
  return normKey(raw).replace(/:/g, '-');
}

function toBase64Url(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64u) {
  const b64 = String(b64u || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Local ECDH P-256 Identity & Peer Keyring (Private key never leaves local device) ---
const ECDH_STORAGE_KEY = 'mashvoice.e2ee.ecdhIdentity.v1';
const PEER_PUBS_STORAGE_KEY = 'mashvoice.e2ee.peerPubs.v1';

let ecdhReadyPromise = null;
let localEcdhPrivKey = null;
let localEcdhPubB64u = '';

async function ensureLocalEcdhIdentity() {
  if (localEcdhPrivKey && localEcdhPubB64u) {
    return { privKey: localEcdhPrivKey, pubB64u: localEcdhPubB64u };
  }
  if (ecdhReadyPromise) return ecdhReadyPromise;

  ecdhReadyPromise = (async () => {
    try {
      const savedRaw = localStorage.getItem(ECDH_STORAGE_KEY);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (parsed?.privJwk && parsed?.pubB64u) {
          localEcdhPrivKey = await crypto.subtle.importKey(
            'jwk',
            parsed.privJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveBits']
          );
          localEcdhPubB64u = parsed.pubB64u;
          return { privKey: localEcdhPrivKey, pubB64u: localEcdhPubB64u };
        }
      }
    } catch {
      // regenerate cleanly below
    }

    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    localEcdhPubB64u = toBase64Url(rawPub);
    localEcdhPrivKey = await crypto.subtle.importKey(
      'jwk',
      privJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
    try {
      localStorage.setItem(
        ECDH_STORAGE_KEY,
        JSON.stringify({ privJwk, pubB64u: localEcdhPubB64u })
      );
    } catch {
      // ignore storage quota
    }
    return { privKey: localEcdhPrivKey, pubB64u: localEcdhPubB64u };
  })();

  return ecdhReadyPromise;
}

function loadPeerPubsMap() {
  try {
    const raw = localStorage.getItem(PEER_PUBS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const peerPubsByKey = loadPeerPubsMap();
const sharedAesCache = new Map();
const contextAesCache = new Map();

function rememberPeerPublicKey(userOrPeerKey, pubB64u) {
  if (!pubB64u || typeof pubB64u !== 'string') return;
  let changed = false;
  const keys = [];
  if (typeof userOrPeerKey === 'string') {
    keys.push(normTopicKey(userOrPeerKey));
  } else if (userOrPeerKey && typeof userOrPeerKey === 'object') {
    if (userOrPeerKey.peerId) keys.push(normTopicKey(userOrPeerKey.peerId));
    if (userOrPeerKey.id) keys.push(normTopicKey(userOrPeerKey.id));
    if (userOrPeerKey.username) keys.push(normTopicKey(userOrPeerKey.username));
  }
  for (const k of keys) {
    if (k && peerPubsByKey[k] !== pubB64u) {
      peerPubsByKey[k] = pubB64u;
      changed = true;
    }
  }
  if (changed) {
    try {
      localStorage.setItem(PEER_PUBS_STORAGE_KEY, JSON.stringify(peerPubsByKey));
    } catch {
      // ignore
    }
  }
}

function lookupPeerPublicKey(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    return peerPubsByKey[normTopicKey(target)] || null;
  }
  if (target.ecdhPub) return target.ecdhPub;
  return (
    (target.peerId && peerPubsByKey[normTopicKey(target.peerId)]) ||
    (target.id && peerPubsByKey[normTopicKey(target.id)]) ||
    (target.username && peerPubsByKey[normTopicKey(target.username)]) ||
    null
  );
}

async function deriveEcdhAesKey(remotePubB64u) {
  if (sharedAesCache.has(remotePubB64u)) return sharedAesCache.get(remotePubB64u);
  const { privKey } = await ensureLocalEcdhIdentity();
  const remotePubKey = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(remotePubB64u),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: remotePubKey }, privKey, 256)
  );
  const domainPrefix = enc.encode('mv-relay-v1:ecdh-aes256gcm:');
  const material = new Uint8Array(domainPrefix.length + sharedBits.length);
  material.set(domainPrefix, 0);
  material.set(sharedBits, domainPrefix.length);
  const hash = await crypto.subtle.digest('SHA-256', material);
  const aesKey = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  sharedAesCache.set(remotePubB64u, aesKey);
  return aesKey;
}

async function deriveContextAesKey(domain, secretStr) {
  const cacheId = `${domain}|${secretStr}`;
  if (contextAesCache.has(cacheId)) return contextAesCache.get(cacheId);
  const seed = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`mv-relay-v1:${domain}:${secretStr}`)
  );
  const aesKey = await crypto.subtle.importKey('raw', seed, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  contextAesCache.set(cacheId, aesKey);
  return aesKey;
}

async function aesSeal(aesKey, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plain));
  const combined = new Uint8Array(12 + ct.length);
  combined.set(iv, 0);
  combined.set(ct, 12);
  return toBase64Url(combined);
}

async function aesOpen(aesKey, combinedB64u) {
  const combined = fromBase64Url(combinedB64u);
  if (combined.length <= 12) return null;
  const iv = combined.subarray(0, 12);
  const ct = combined.subarray(12);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return JSON.parse(dec.decode(new Uint8Array(plainBuf)));
}

export class GlobalP2PMesh {
  constructor({ me, onEvent, onStatusChange }) {
    this.me = me;
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.wsReady = false;
    this.httpAlive = false;
    this.subscribedTopics = new Set();
    this.serverSecrets = new Map(); // normKey("srv:...") -> inviteCode
    this.seenIds = new Set();
    this.pendingAckByTopic = new Map(); // topic -> Set<msgId>
    this.lastDeliverTs = 0;
    this.destroyed = false;
    this.pingTimer = null;
    this.pollTimer = null;
    this.reconnectTimer = null;

    ensureLocalEcdhIdentity().catch(() => {});

    if (me) {
      this.addBaseSubscriptions(me);
    }
    this.connectWebSocket();
    this.pingTimer = setInterval(() => this.sendPing(), 25_000);
    this.pollTimer = setInterval(() => {
      if (!this.wsReady) {
        this.pollHttpFallback();
      }
    }, 4500);
  }

  async enrichSelfProfile() {
    const { pubB64u } = await ensureLocalEcdhIdentity();
    return {
      ...this.me,
      ecdhPub: pubB64u,
    };
  }

  updateMe(me) {
    if (!me) return;
    this.me = me;
    this.addBaseSubscriptions(me);
  }

  addBaseSubscriptions(me) {
    const u = normTopicKey(me.username);
    const d = normTopicKey(me.displayName);
    const tag = String(me.tag || '').trim();
    const uTag = tag ? normTopicKey(`${me.username}#${tag}`) : '';
    const pid = normTopicKey(me.peerId);
    const uid = normTopicKey(me.id);

    const list = [];
    if (u) list.push(`inbox:${u}`);
    if (uTag && uTag !== u) list.push(`inbox:${uTag}`);
    if (pid) list.push(`inbox:${pid}`);
    if (uid) list.push(`inbox:${uid}`);
    if (d && d !== u) {
      list.push(`inbox:${d}`);
      if (tag) list.push(`inbox:${normTopicKey(`${me.displayName}#${tag}`)}`);
    }
    this.subscribeTopics(list);
  }

  subscribeServer(server) {
    if (!server) return;
    const topics = [];
    const inviteSecret = String(server.inviteCode || server.id || '').trim().toUpperCase();
    if (server.id) {
      const srvTopic = normKey(`srv:${normTopicKey(server.id)}`);
      topics.push(srvTopic);
      if (inviteSecret) this.serverSecrets.set(srvTopic, inviteSecret);
    }
    if (server.inviteCode) {
      const invTopic = normKey(`invite:${normTopicKey(server.inviteCode)}`);
      topics.push(invTopic);
      if (inviteSecret) this.serverSecrets.set(invTopic, inviteSecret);
    }
    this.subscribeTopics(topics);
  }

  subscribeRoom(roomId) {
    if (!roomId) return;
    this.subscribeTopics([normKey(`room:${normTopicKey(roomId)}`)]);
  }

  subscribeTopics(topics) {
    let added = false;
    for (const raw of topics) {
      const clean = normKey(raw);
      if (clean && !this.subscribedTopics.has(clean)) {
        this.subscribedTopics.add(clean);
        added = true;
      }
    }
    if (added && this.ws && this.ws.readyState === 1) {
      this.sendSubscribeFrame();
    }
  }

  sendSubscribeFrame() {
    if (!this.ws || this.ws.readyState !== 1) return;
    const allTopics = Array.from(this.subscribedTopics).slice(0, 32);
    if (allTopics.length === 0) return;
    try {
      this.ws.send(
        JSON.stringify({
          op: 'subscribe',
          peerId: this.me?.peerId || '',
          pseudo: normTopicKey(this.me?.username || ''),
          tag: String(this.me?.tag || ''),
          topics: allTopics,
          sinceTs: 0,
        })
      );
    } catch {
      // ignore socket race
    }
  }

  connectWebSocket() {
    if (this.destroyed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      const ws = new WebSocket(ZYNTRA_WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        this.sendSubscribeFrame();
      };

      ws.onmessage = async (ev) => {
        try {
          const frame = JSON.parse(String(ev.data));
          if (frame.op === 'sub_ack') {
            this.wsReady = true;
            this.emitStatus();
          } else if (frame.op === 'pong') {
            if (!this.wsReady) {
              this.wsReady = true;
              this.emitStatus();
            }
          } else if (frame.op === 'deliver') {
            await this.handleDeliveredItem(frame);
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        this.wsReady = false;
        this.emitStatus();
        if (!this.destroyed) {
          this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 1200);
        }
      };

      ws.onerror = () => {};
    } catch {
      this.wsReady = false;
      this.emitStatus();
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
      }
    }
  }

  emitStatus() {
    const online = this.wsReady || this.httpAlive;
    this.onStatusChange?.({
      online,
      relay: 'zyntra.win',
      mode: this.wsReady ? 'wss' : this.httpAlive ? 'https' : 'connecting',
      brokersConnected: online ? 1 : 0,
    });
  }

  sendPing() {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ op: 'ping', ts: Date.now() }));
      } catch {
        // ignore
      }
    }
  }

  async sealForTopic(topic, payloadObj, remoteEcdhPub = null) {
    const cleanTopic = normKey(topic);
    if (remoteEcdhPub) {
      try {
        const { pubB64u } = await ensureLocalEcdhIdentity();
        const aesKey = await deriveEcdhAesKey(remoteEcdhPub);
        const sealed = await aesSeal(aesKey, payloadObj);
        return `mv4e1.e2e.${pubB64u}.${sealed}`;
      } catch {
        // fallback below if peer pubkey was malformed
      }
    }

    const srvSecret = this.serverSecrets.get(cleanTopic);
    if (srvSecret) {
      const aesKey = await deriveContextAesKey('srv', srvSecret);
      const sealed = await aesSeal(aesKey, payloadObj);
      return `mv4e1.srv.${sealed}`;
    }

    const aesKey = await deriveContextAesKey('topic', cleanTopic);
    const sealed = await aesSeal(aesKey, payloadObj);
    return `mv4e1.hs.${sealed}`;
  }

  async openFromTopic(topic, envelopeStr) {
    const raw = String(envelopeStr || '').trim();
    if (!raw.startsWith('mv4e1.')) return null;
    const cleanTopic = normKey(topic);

    if (raw.startsWith('mv4e1.e2e.')) {
      const rest = raw.slice('mv4e1.e2e.'.length);
      const dotIdx = rest.indexOf('.');
      if (dotIdx <= 0) return null;
      const senderPubB64u = rest.slice(0, dotIdx);
      const ctB64u = rest.slice(dotIdx + 1);
      const aesKey = await deriveEcdhAesKey(senderPubB64u);
      const opened = await aesOpen(aesKey, ctB64u);
      if (opened?.from) rememberPeerPublicKey(opened.from, senderPubB64u);
      if (opened?.fromUser) rememberPeerPublicKey(opened.fromUser, senderPubB64u);
      return opened;
    }

    if (raw.startsWith('mv4e1.srv.')) {
      const ctB64u = raw.slice('mv4e1.srv.'.length);
      const secretCandidates = new Set();
      const direct = this.serverSecrets.get(cleanTopic);
      if (direct) secretCandidates.add(direct);
      for (const s of this.serverSecrets.values()) secretCandidates.add(s);
      for (const sec of secretCandidates) {
        try {
          const aesKey = await deriveContextAesKey('srv', sec);
          const opened = await aesOpen(aesKey, ctB64u);
          if (opened) return opened;
        } catch {
          // try next server invite secret
        }
      }
      return null;
    }

    if (raw.startsWith('mv4e1.hs.')) {
      const ctB64u = raw.slice('mv4e1.hs.'.length);
      const topicCandidates = [cleanTopic, ...this.subscribedTopics];
      for (const candidate of topicCandidates) {
        try {
          const aesKey = await deriveContextAesKey('topic', candidate);
          const opened = await aesOpen(aesKey, ctB64u);
          if (opened) return opened;
        } catch {
          // try next subscribed inbox alias
        }
      }
      return null;
    }

    // Legacy mv4e1.<iv+ct> compatibility keyed by topic
    const ctB64u = raw.slice('mv4e1.'.length);
    const aesKey = await deriveContextAesKey('topic', cleanTopic);
    return aesOpen(aesKey, ctB64u);
  }

  async handleDeliveredItem(item) {
    if (!item?.msgId || !item?.envelope) return;
    if (item.ts && item.ts > this.lastDeliverTs) {
      this.lastDeliverTs = item.ts;
    }
    if (this.seenIds.has(item.msgId)) {
      if (item.topic && !this.unackedFriendReqs?.has(item.msgId)) {
        this.ackMessage(item.topic, item.msgId);
      }
      return;
    }

    const topic = normKey(item.topic || '');
    const data = await this.openFromTopic(topic, item.envelope).catch(() => null);
    if (!data || typeof data !== 'object') return;

    this.seenIds.add(item.msgId);
    if (this.seenIds.size > 1000) {
      const oldest = this.seenIds.values().next().value;
      this.seenIds.delete(oldest);
    }

    if (data.from?.ecdhPub) rememberPeerPublicKey(data.from, data.from.ecdhPub);
    if (data.user?.ecdhPub) rememberPeerPublicKey(data.user, data.user.ecdhPub);
    if (data.fromUser?.ecdhPub) rememberPeerPublicKey(data.fromUser, data.fromUser.ecdhPub);

    const senderId = item.senderPeerId || data.senderPeerId;
    if (senderId && senderId === this.me?.peerId) return;

    data.msgId = item.msgId;
    data._relayTopic = topic;

    if (!this.unackedFriendReqs) this.unackedFriendReqs = new Set();
    if (data.type === 'friend:request') {
      this.unackedFriendReqs.add(item.msgId);
    }

    await this.onEvent?.(data, topic);

    // Keep `friend:request` in Zyntra's 7-day mailbox until explicitly accepted/declined;
    // acknowledge all other delivered events immediately so the mailbox stays clean.
    if (data.type !== 'friend:request' && topic) {
      this.ackMessage(topic, item.msgId);
    }
  }

  ackMessage(topic, msgId) {
    const cleanTopic = normKey(topic || '');
    if (!msgId) return;
    this.unackedFriendReqs?.delete(String(msgId));
    const targetTopics = cleanTopic ? [cleanTopic] : Array.from(this.subscribedTopics);
    if (targetTopics.length === 0) return;

    if (this.wsReady && this.ws?.readyState === 1) {
      try {
        this.ws.send(
          JSON.stringify({
            op: 'ack',
            topics: targetTopics,
            msgIds: [String(msgId)],
          })
        );
        return;
      } catch {
        // queue for HTTP poll ack below
      }
    }

    for (const t of targetTopics) {
      const set = this.pendingAckByTopic.get(t) || new Set();
      set.add(String(msgId));
      this.pendingAckByTopic.set(t, set);
    }
  }

  async pollHttpFallback() {
    if (this.destroyed || !this.me) return;
    const topics = Array.from(this.subscribedTopics).slice(0, 24);
    if (topics.length === 0) return;

    const ackMsgIds = [];
    for (const set of this.pendingAckByTopic.values()) {
      for (const id of set) ackMsgIds.push(id);
    }
    this.pendingAckByTopic.clear();

    try {
      const res = await fetch(`${ZYNTRA_HTTP_BASE}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: this.me.peerId || '',
          pseudo: normTopicKey(this.me.username || ''),
          topics,
          sinceTs: 0,
          ackMsgIds,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        if (!this.httpAlive) {
          this.httpAlive = true;
          this.emitStatus();
        }
        for (const msg of data.messages || []) {
          await this.handleDeliveredItem(msg);
        }
      }
    } catch {
      if (this.httpAlive) {
        this.httpAlive = false;
        this.emitStatus();
      }
    }
  }

  async publish(topic, payloadObj, opts = {}) {
    const cleanTopic = normKey(topic);
    if (!cleanTopic || !this.me) return 0;

    const msgId =
      (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const inner = {
      ...payloadObj,
      msgId,
      senderPeerId: this.me.peerId,
      ts: Date.now(),
    };

    const envelope = await this.sealForTopic(cleanTopic, inner, opts.remoteEcdhPub || null);
    const storeOffline = opts.storeOffline !== false;
    const ttlSec = opts.ttlSec || 604800;

    if (this.wsReady && this.ws?.readyState === 1) {
      try {
        this.ws.send(
          JSON.stringify({
            op: 'publish',
            msgId,
            senderPeerId: this.me.peerId,
            topics: [cleanTopic],
            storeOffline,
            ttlSec,
            envelope,
          })
        );
        return 1;
      } catch {
        // fallback to HTTP publish below
      }
    }

    try {
      const res = await fetch(`${ZYNTRA_HTTP_BASE}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgId,
          senderPeerId: this.me.peerId,
          topics: [cleanTopic],
          storeOffline,
          ttlSec,
          envelope,
        }),
      });
      if (res.ok) {
        if (!this.httpAlive) {
          this.httpAlive = true;
          this.emitStatus();
        }
        return 1;
      }
    } catch {
      // ignore offline
    }
    return 0;
  }

  async checkPresence(rawPseudo) {
    const key = normTopicKey(rawPseudo);
    if (!key) return null;
    try {
      const res = await fetch(`${ZYNTRA_HTTP_BASE}/presence/${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async sendFriendRequest(targetQuery) {
    if (!this.me) return 0;
    const key = normTopicKey(targetQuery);
    if (!key) return 0;
    const selfWithPub = await this.enrichSelfProfile();
    return this.publish(
      `inbox:${key}`,
      {
        type: 'friend:request',
        from: selfWithPub,
      },
      { storeOffline: true, ttlSec: 604800 }
    );
  }

  async sendFriendAccept(targetUser) {
    if (!this.me || !targetUser) return 0;
    const selfWithPub = await this.enrichSelfProfile();
    const remotePub = lookupPeerPublicKey(targetUser);
    const pid = normTopicKey(targetUser.peerId);
    const uid = normTopicKey(targetUser.id);
    const uname = normTopicKey(targetUser.username);

    const targets = new Set();
    if (pid) targets.add(`inbox:${pid}`);
    if (uid) targets.add(`inbox:${uid}`);
    if (uname) targets.add(`inbox:${uname}`);

    for (const t of targets) {
      await this.publish(
        t,
        {
          type: 'friend:accept',
          from: selfWithPub,
        },
        { storeOffline: true, ttlSec: 604800, remoteEcdhPub: remotePub }
      );
    }
    return 1;
  }

  async sendDirectMessage(targetUser, channelId, message) {
    if (!targetUser || !this.me) return;
    const selfWithPub = await this.enrichSelfProfile();
    const remotePub = lookupPeerPublicKey(targetUser);
    const pid = normTopicKey(targetUser.peerId);
    const uid = normTopicKey(targetUser.id);
    const packet = {
      type: 'dm:message',
      from: selfWithPub,
      channelId,
      message,
    };
    const topic = pid ? `inbox:${pid}` : uid ? `inbox:${uid}` : null;
    if (topic) {
      await this.publish(topic, packet, {
        storeOffline: true,
        ttlSec: 604800,
        remoteEcdhPub: remotePub,
      });
    }
  }

  async sendServerMessage(serverId, channelId, message) {
    if (!serverId || !this.me) return;
    const selfWithPub = await this.enrichSelfProfile();
    await this.publish(
      `srv:${normTopicKey(serverId)}`,
      {
        type: 'srv:message',
        from: selfWithPub,
        serverId,
        channelId,
        message,
      },
      { storeOffline: true, ttlSec: 604800 }
    );
  }

  async requestJoinServerByInvite(inviteCode) {
    if (!this.me || !inviteCode) return;
    const code = String(inviteCode).trim().toUpperCase();
    const invTopic = normKey(`invite:${normTopicKey(code)}`);
    this.serverSecrets.set(invTopic, code);
    const selfWithPub = await this.enrichSelfProfile();
    await this.publish(
      invTopic,
      {
        type: 'srv:join-request',
        inviteCode: code,
        from: selfWithPub,
      },
      { storeOffline: true, ttlSec: 86400 }
    );
  }

  async sendServerSnapshotToPeer(targetUser, server) {
    if (!targetUser || !server || !this.me) return;
    const selfWithPub = await this.enrichSelfProfile();
    const remotePub = lookupPeerPublicKey(targetUser);
    const pid = normTopicKey(targetUser.peerId);
    const uid = normTopicKey(targetUser.id);
    const topic = pid ? `inbox:${pid}` : uid ? `inbox:${uid}` : null;
    if (topic) {
      await this.publish(
        topic,
        {
          type: 'srv:welcome',
          server,
          from: selfWithPub,
        },
        { storeOffline: true, ttlSec: 604800, remoteEcdhPub: remotePub }
      );
    }
  }

  async ringPeerForCall(targetUser, roomId) {
    if (!targetUser || !roomId || !this.me) return;
    const selfWithPub = await this.enrichSelfProfile();
    const remotePub = lookupPeerPublicKey(targetUser);
    const pid = normTopicKey(targetUser.peerId);
    const uid = normTopicKey(targetUser.id);
    const topic = pid ? `inbox:${pid}` : uid ? `inbox:${uid}` : null;
    if (topic) {
      await this.publish(
        topic,
        {
          type: 'call:ring',
          from: selfWithPub,
          roomId,
        },
        { storeOffline: true, ttlSec: 90, remoteEcdhPub: remotePub }
      );
    }
  }

  async broadcastRoomEvent(roomId, eventType, extra = {}) {
    if (!roomId || !this.me) return;
    const selfWithPub = await this.enrichSelfProfile();
    await this.publish(
      `room:${normTopicKey(roomId)}`,
      {
        type: eventType,
        roomId,
        peerKey: this.me.peerId,
        user: selfWithPub,
        ...extra,
      },
      { storeOffline: false }
    );
  }

  async sendWebRtcSignal(targetPeerKey, roomId, signal) {
    if (!targetPeerKey || !this.me) return;
    const { pubB64u } = await ensureLocalEcdhIdentity();
    const slimSelf = {
      id: this.me.id,
      peerId: this.me.peerId,
      username: this.me.username,
      displayName: this.me.displayName,
      tag: this.me.tag,
      avatarColor: this.me.avatarColor,
      ecdhPub: pubB64u,
    };
    const remotePub = lookupPeerPublicKey(targetPeerKey);
    const pid = normTopicKey(targetPeerKey);
    await this.publish(
      `inbox:${pid}`,
      {
        type: 'webrtc:signal',
        fromPeerKey: this.me.peerId,
        fromUser: slimSelf,
        roomId,
        signal,
      },
      { storeOffline: false, ttlSec: 60, remoteEcdhPub: remotePub }
    );
  }

  destroy() {
    this.destroyed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
