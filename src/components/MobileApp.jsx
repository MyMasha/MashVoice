import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Hash,
  MessageSquare,
  Volume2,
  QrCode,
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  MonitorUp,
  PhoneOff,
  Send,
  ShieldCheck,
  Camera,
  CheckCircle2,
  X,
} from 'lucide-react';
import { P2PMeshEngine } from '../lib/p2pEngine.js';
import { mashSounds } from '../lib/soundEffects.js';

function MobileVideo({ stream, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
    />
  );
}

export default function MobileApp({
  bootstrap,
  isDrawer = false,
  onCloseDrawer,
}) {
  const [mobSession, setMobSession] = useState(() => {
    try {
      const saved = localStorage.getItem('mashvoice.mobile.session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [loginUser, setLoginUser] = useState('rawsq');
  const [loginToken, setLoginToken] = useState('');
  const [loginErr, setLoginErr] = useState('');

  const [tab, setTab] = useState('qr'); // 'servers' | 'dms' | 'voice' | 'qr'
  const [stateData, setStateData] = useState({ servers: [], dmChannels: [], users: [], voiceRooms: {} });
  const [activeServerId, setActiveServerId] = useState('srv-singularity');
  const [activeChannelId, setActiveChannelId] = useState('ch-general');
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');

  // Mobile Voice / Camera / Stream state
  const [voiceRoomId, setVoiceRoomId] = useState(null);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [screenOn, setScreenOn] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);

  // QR Scanner state
  const [cameraScanning, setCameraScanning] = useState(false);
  const [pendingPcChallenge, setPendingPcChallenge] = useState(null);
  const [inspectedChallenge, setInspectedChallenge] = useState(null);
  const [scannedPayload, setScannedPayload] = useState('');
  const [qrStatusMsg, setQrStatusMsg] = useState('');

  const wsRef = useRef(null);
  const p2pRef = useRef(null);
  const qrVideoRef = useRef(null);
  const qrStreamRef = useRef(null);

  useEffect(() => {
    if (!loginToken && bootstrap?.starterTokens?.[0]?.token) {
      setLoginToken(bootstrap.starterTokens[0].token);
    }
  }, [bootstrap]);

  const handleMobileLogin = async (e) => {
    e.preventDefault();
    setLoginErr('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionToken: loginToken.trim(),
        username: loginUser.trim() || 'rawsq',
        deviceType: 'mobile-app',
        deviceName: 'MashVoice Mobile (Téléphone)',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoginErr(data.error || 'Token refusé');
      return;
    }
    const bundle = {
      sessionToken: data.sessionToken,
      connectionToken: loginToken.trim(),
      user: data.user,
    };
    localStorage.setItem('mashvoice.mobile.session', JSON.stringify(bundle));
    setMobSession(bundle);
    mashSounds.unlockGate();
  };

  // Load workspace & connect mobile WebSocket when authenticated
  useEffect(() => {
    if (!mobSession?.sessionToken) return undefined;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobSession.sessionToken}`,
    };

    fetch('/api/state', { headers })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem('mashvoice.mobile.session');
          setMobSession(null);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setStateData(d);
      })
      .catch(() => {});

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?token=${encodeURIComponent(mobSession.sessionToken)}`
    );
    wsRef.current = ws;

    const p2p = new P2PMeshEngine({
      sendSignal: (payload) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'p2p:signal', ...payload }));
      },
      onRemoteStreamsChange: (list) => setRemoteStreams(list),
    });
    p2pRef.current = p2p;

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'auth:force_disconnect') {
          p2p.leaveRoom();
          localStorage.removeItem('mashvoice.mobile.session');
          setMobSession(null);
          setLoginErr(msg.reason || 'Token révoqué');
        } else if (msg.type === 'voice:rooms') {
          setStateData((prev) => ({ ...prev, voiceRooms: msg.rooms || {} }));
        } else if (msg.type === 'p2p:room-joined') {
          await p2p.joinRoom(msg.roomId, msg.selfPeerKey, msg.existingPeers || []);
        } else if (msg.type === 'p2p:peer-joined') {
          await p2p.handlePeerJoined(msg.peer);
        } else if (msg.type === 'p2p:peer-left') {
          p2p.handlePeerLeft(msg.peerKey);
        } else if (msg.type === 'p2p:signal') {
          await p2p.handleSignal(msg.fromPeerKey, msg.fromUser, msg.signal);
        } else if (msg.type === 'chat:message' && msg.channelId === activeChannelId) {
          setMessages((prev) =>
            prev.some((m) => m.id === msg.message.id) ? prev : [...prev, msg.message]
          );
        }
      } catch {
        // ignore
      }
    };

    return () => {
      p2p.leaveRoom();
      ws.close();
    };
  }, [mobSession?.sessionToken]);

  useEffect(() => {
    if (!mobSession?.sessionToken || !activeChannelId) return;
    fetch(`/api/messages/${encodeURIComponent(activeChannelId)}`, {
      headers: { Authorization: `Bearer ${mobSession.sessionToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.messages) setMessages(d.messages);
      })
      .catch(() => {});
  }, [activeChannelId, mobSession?.sessionToken]);

  // Poll pending PC QR challenge when on QR tab so user can test 1-tap scan!
  useEffect(() => {
    if (!mobSession?.sessionToken || tab !== 'qr') return undefined;
    const checkPending = () => {
      fetch('/api/auth/qr/pending', {
        headers: { Authorization: `Bearer ${mobSession.sessionToken}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPendingPcChallenge(d?.pending || null))
        .catch(() => {});
    };
    checkPending();
    const timer = setInterval(checkPending, 2000);
    return () => clearInterval(timer);
  }, [mobSession?.sessionToken, tab]);

  // Real Camera QR Code Reader using jsQR
  useEffect(() => {
    if (!cameraScanning) {
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach((t) => t.stop());
        qrStreamRef.current = null;
      }
      return undefined;
    }

    let active = true;
    let raf = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        qrStreamRef.current = stream;
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = stream;
        }
        const scanTick = () => {
          if (!active) return;
          const v = qrVideoRef.current;
          if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = jsQR(img.data, img.width, img.height);
            if (decoded?.data && decoded.data.includes('qr-auth')) {
              setCameraScanning(false);
              inspectQrPayload(decoded.data);
              return;
            }
          }
          raf = requestAnimationFrame(scanTick);
        };
        raf = requestAnimationFrame(scanTick);
      })
      .catch(() => {
        setQrStatusMsg('Caméra indisponible ici — utilisez le bouton de détection directe ci-dessous.');
        setCameraScanning(false);
      });

    return () => {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach((t) => t.stop());
        qrStreamRef.current = null;
      }
    };
  }, [cameraScanning]);

  const inspectQrPayload = async (payloadStr) => {
    setQrStatusMsg('');
    setScannedPayload(payloadStr);
    const res = await fetch('/api/auth/qr/inspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobSession.sessionToken}`,
      },
      body: JSON.stringify({ qrPayload: payloadStr }),
    });
    const data = await res.json();
    if (!res.ok) {
      setQrStatusMsg(data.error || 'QR invalide');
      return;
    }
    setInspectedChallenge(data.challenge);
  };

  const approvePcQr = async () => {
    const res = await fetch('/api/auth/qr/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobSession.sessionToken}`,
      },
      body: JSON.stringify({
        qrPayload: scannedPayload,
        mobileConnectionToken: mobSession.connectionToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setQrStatusMsg(data.error || 'Échec d\'autorisation');
      return;
    }
    mashSounds.unlockGate();
    setInspectedChallenge(null);
    setQrStatusMsg(`✓ PC "${data.approvedDevice}" authentifié instantanément !`);
  };

  const joinMobileVoice = (roomId) => {
    setVoiceRoomId(roomId);
    setTab('voice');
    mashSounds.joinVoice();
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:join-room',
          roomId,
          mediaState: { muted, cameraOn: false, screenOn: false },
        })
      );
    }
  };

  const leaveMobileVoice = () => {
    p2pRef.current?.leaveRoom();
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'p2p:leave-room' }));
    }
    setVoiceRoomId(null);
    setCamOn(false);
    setScreenOn(false);
    setLocalStream(null);
  };

  const flipMobileCamera = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (camOn) {
      const s = await p2pRef.current?.toggleCamera(true, nextFacing);
      setLocalStream(s);
    }
  };

  const sendMobileMessage = async (e) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    const text = msgInput;
    setMsgInput('');
    const res = await fetch(`/api/messages/${encodeURIComponent(activeChannelId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobSession.sessionToken}`,
      },
      body: JSON.stringify({ content: text }),
    });
    const d = await res.json();
    if (d.ok && d.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === d.message.id) ? prev : [...prev, d.message]
      );
    }
  };

  const currentServer = stateData.servers.find((s) => s.id === activeServerId) || stateData.servers[0];

  return (
    <div className="mobile-app-shell">
      <header className="mobile-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="brand-mark" style={{ width: 18, height: 18 }} />
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>
            MASHVOICE MOBILE
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {mobSession && (
            <span style={{ fontSize: 11, color: 'var(--gold-bright)', fontWeight: 600 }}>
              @{mobSession.user.username}
            </span>
          )}
          {isDrawer && (
            <button type="button" className="win-btn" onClick={onCloseDrawer}>
              <X size={15} />
            </button>
          )}
        </div>
      </header>

      {!mobSession ? (
        <div
          className="mobile-body"
          style={{ padding: 18, justifyContent: 'center', gap: 14 }}
        >
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <ShieldCheck size={34} color="#f5c26b" style={{ margin: '0 auto 8px' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 19 }}>
              Connexion Mobile Sécurisée
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Connectez votre téléphone avec votre Token obligatoire pour parler, streamer et
              authentifier votre PC par QR Code.
            </p>
          </div>

          {loginErr && (
            <div style={{ color: 'var(--crimson)', fontSize: 12, textAlign: 'center' }}>
              {loginErr}
            </div>
          )}

          <form onSubmit={handleMobileLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              className="mash-input"
              placeholder="Pseudo (ex: rawsq)"
              value={loginUser}
              onChange={(e) => setLoginUser(e.target.value)}
            />
            <input
              type="password"
              className="mash-input mono"
              placeholder="Token MASH-SV4..."
              value={loginToken}
              onChange={(e) => setLoginToken(e.target.value)}
            />
            {bootstrap?.starterTokens?.[0]?.token && (
              <button
                type="button"
                className="btn-chip"
                onClick={() => setLoginToken(bootstrap.starterTokens[0].token)}
              >
                Remplir avec le Token Maître Fondateur
              </button>
            )}
            <button type="submit" id="mobile-login-btn" className="btn-gold-cta">
              Activer MashVoice Mobile
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="mobile-body">
            {tab === 'qr' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="hw-card" style={{ textAlign: 'center' }}>
                  <QrCode size={28} color="#f5c26b" style={{ margin: '0 auto' }} />
                  <strong style={{ fontSize: 14.5 }}>Authentifier un PC par QR Code</strong>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Sur votre PC, ouvrez l&apos;onglet <strong>Scanner QR Mobile</strong> du
                    Launcher, puis scannez le code ci-dessous.
                  </p>

                  {cameraScanning ? (
                    <div style={{ position: 'relative', height: 200, borderRadius: 12, overflow: 'hidden' }}>
                      <video
                        ref={qrVideoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <button
                        type="button"
                        className="btn-chip"
                        style={{ position: 'absolute', bottom: 8, right: 8 }}
                        onClick={() => setCameraScanning(false)}
                      >
                        Fermer Caméra
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-chip"
                      style={{ padding: '9px 14px', justifyContent: 'center' }}
                      onClick={() => setCameraScanning(true)}
                    >
                      <Camera size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                      Ouvrir la Caméra pour Scanner
                    </button>
                  )}

                  {pendingPcChallenge && !inspectedChallenge && (
                    <div className="starter-token-box" style={{ marginTop: 6, textAlign: 'left' }}>
                      <div style={{ fontSize: 11.5, color: 'var(--gold-primary)', fontWeight: 600 }}>
                        QR Code PC détecté à proximité :
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {pendingPcChallenge.deviceName} · Empreinte {pendingPcChallenge.fingerprint}
                      </div>
                      <button
                        type="button"
                        id="mobile-scan-detected-qr-btn"
                        className="btn-gold-cta"
                        style={{ padding: '8px 14px', fontSize: 12 }}
                        onClick={() => inspectQrPayload(pendingPcChallenge.qrPayload)}
                      >
                        Scanner ce QR Code PC
                      </button>
                    </div>
                  )}
                </div>

                {inspectedChallenge && (
                  <div
                    className="hw-card"
                    style={{ borderColor: 'var(--gold-border)', background: 'var(--bg-elevated)' }}
                  >
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Confirmer la connexion sur ce PC ?
                    </strong>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Appareil : <strong style={{ color: 'var(--text-primary)' }}>{inspectedChallenge.deviceName}</strong>
                      <br />
                      Empreinte : <code>{inspectedChallenge.fingerprint}</code>
                      <br />
                      Compte transféré : <strong style={{ color: 'var(--text-primary)' }}>@{mobSession.user.username}</strong>
                    </div>
                    <button
                      type="button"
                      id="mobile-approve-pc-btn"
                      className="btn-gold-cta"
                      onClick={approvePcQr}
                    >
                      <CheckCircle2 size={15} /> Autoriser la connexion du PC
                    </button>
                  </div>
                )}

                {qrStatusMsg && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: 'var(--emerald-bg)',
                      color: 'var(--emerald)',
                      fontSize: 12,
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  >
                    {qrStatusMsg}
                  </div>
                )}
              </div>
            )}

            {tab === 'servers' && currentServer && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div
                  style={{
                    padding: '8px 10px',
                    display: 'flex',
                    gap: 6,
                    overflowX: 'auto',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {currentServer.channels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={`preset-pill ${activeChannelId === ch.id ? 'selected' : ''}`}
                      style={{ padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                      onClick={() => {
                        if (ch.type === 'text') setActiveChannelId(ch.id);
                        else joinMobileVoice(ch.id);
                      }}
                    >
                      {ch.type === 'text' ? <Hash size={11} /> : <Volume2 size={11} />}
                      <span>{ch.name}</span>
                    </button>
                  ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {messages.map((m) => (
                    <div key={m.id} style={{ fontSize: 12.5 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>
                        {stateData.users.find((u) => u.id === m.authorId)?.displayName || 'Pair'} :{' '}
                      </strong>
                      <span style={{ color: 'var(--text-secondary)' }}>{m.content}</span>
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={sendMobileMessage}
                  style={{ padding: 10, display: 'flex', gap: 6, borderTop: '1px solid var(--border-subtle)' }}
                >
                  <input
                    className="mash-input"
                    placeholder="Message mobile P2P..."
                    value={msgInput}
                    onChange={(e) => setMsgInput(e.target.value)}
                  />
                  <button type="submit" className="btn-chip" style={{ padding: '0 12px' }}>
                    <Send size={14} />
                  </button>
                </form>
              </div>
            )}

            {tab === 'dms' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="cat-header">MESSAGES PRIVÉS & APPELS DIRECTS</div>
                {stateData.dmChannels.map(({ id, peer }) => (
                  <div
                    key={id}
                    className="hw-card"
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10 }}
                  >
                    <div>
                      <strong>{peer.displayName}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{peer.username}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => {
                          setActiveChannelId(id);
                          setTab('servers');
                        }}
                      >
                        Chat
                      </button>
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => joinMobileVoice(id)}
                      >
                        Appeler
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'voice' && (
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                {!voiceRoomId ? (
                  <div className="hw-card" style={{ textAlign: 'center' }}>
                    <strong>Rejoindre un Salon Vocal / Stream Mobile</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      {(currentServer?.channels || [])
                        .filter((c) => c.type !== 'text')
                        .map((vc) => (
                          <button
                            key={vc.id}
                            type="button"
                            className="btn-gold-cta"
                            onClick={() => joinMobileVoice(vc.id)}
                          >
                            <Volume2 size={15} /> Rejoindre {vc.name}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--emerald)', fontWeight: 700 }}>
                      ● En Vocal / Stream P2P depuis le Téléphone
                    </div>

                    <div style={{ height: 180, borderRadius: 12, background: '#050609', border: '1px solid var(--border-strong)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                      {localStream ? (
                        <MobileVideo stream={localStream} muted />
                      ) : remoteStreams[0]?.stream ? (
                        <MobileVideo stream={remoteStreams[0].stream} />
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Audio Opus P2P Actif ({remoteStreams.length + 1} connecté(s))
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button
                        type="button"
                        className={`dock-action-btn ${muted ? 'danger' : ''}`}
                        onClick={() => {
                          const next = !muted;
                          setMuted(next);
                          p2pRef.current?.setMuted(next);
                        }}
                      >
                        {muted ? <MicOff size={15} /> : <Mic size={15} />}{' '}
                        {muted ? 'Micro Coupé' : 'Micro Actif'}
                      </button>

                      <button
                        type="button"
                        className={`dock-action-btn ${camOn ? 'active-gold' : ''}`}
                        onClick={async () => {
                          const next = !camOn;
                          const s = await p2pRef.current?.toggleCamera(next, facingMode);
                          setCamOn(Boolean(s));
                          setLocalStream(s);
                        }}
                      >
                        {camOn ? <Video size={15} /> : <VideoOff size={15} />} Caméra
                      </button>

                      <button
                        type="button"
                        className="dock-action-btn"
                        onClick={flipMobileCamera}
                      >
                        <SwitchCamera size={15} /> Avant/Arrière
                      </button>

                      <button
                        type="button"
                        className={`dock-action-btn ${screenOn ? 'active-gold' : ''}`}
                        onClick={async () => {
                          const next = !screenOn;
                          const s = await p2pRef.current?.toggleScreenShare(next);
                          setScreenOn(Boolean(s));
                          setLocalStream(s);
                        }}
                      >
                        <MonitorUp size={15} /> Stream Mobile
                      </button>
                    </div>

                    <button
                      type="button"
                      className="dock-action-btn danger"
                      style={{ padding: 10 }}
                      onClick={leaveMobileVoice}
                    >
                      <PhoneOff size={15} /> Quitter l&apos;appel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <nav className="mobile-tabbar" aria-label="Navigation Mobile">
            <button
              type="button"
              className={`mobile-tab-btn ${tab === 'servers' ? 'active' : ''}`}
              onClick={() => setTab('servers')}
            >
              <Hash size={17} />
              <span>Salons</span>
            </button>
            <button
              type="button"
              className={`mobile-tab-btn ${tab === 'dms' ? 'active' : ''}`}
              onClick={() => setTab('dms')}
            >
              <MessageSquare size={17} />
              <span>Privés</span>
            </button>
            <button
              type="button"
              className={`mobile-tab-btn ${tab === 'voice' ? 'active' : ''}`}
              onClick={() => setTab('voice')}
            >
              <Volume2 size={17} />
              <span>Vocal/Cam</span>
            </button>
            <button
              type="button"
              id="mobile-tab-qr"
              className={`mobile-tab-btn ${tab === 'qr' ? 'active' : ''}`}
              onClick={() => setTab('qr')}
            >
              <QrCode size={17} />
              <span>Scan QR</span>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
