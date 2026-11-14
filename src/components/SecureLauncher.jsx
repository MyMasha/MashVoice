import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  QrCode,
  KeyRound,
  Smartphone,
  Cpu,
  RefreshCw,
  ExternalLink,
  Lock,
  Play,
  CheckCircle2,
  AlertTriangle,
  Minus,
  Square,
  X,
} from 'lucide-react';
import BlackHoleCanvas from './BlackHoleCanvas.jsx';

export default function SecureLauncher({
  bootstrap,
  hwConfig,
  onUpdateHwConfig,
  updaterStatus,
  onCheckUpdates,
  onSaveUpdaterToken,
  onAuthenticated,
  onToggleMobileCompanion,
  mobileCompanionOpen,
  lockReason,
}) {
  const [navTab, setNavTab] = useState('connexion'); // 'connexion' | 'optimisations' | 'updater' | 'systeme'
  const [authMode, setAuthMode] = useState('token'); // 'token' | 'qr'
  const [username, setUsername] = useState('rawsq');
  const [connectionToken, setConnectionToken] = useState('');
  const [joinRemoteMode, setJoinRemoteMode] = useState(() =>
    Boolean(window.mashNative?.getRemoteNode?.())
  );
  const [remoteNodeInput, setRemoteNodeInput] = useState(
    () => window.mashNative?.getRemoteNode?.() || ''
  );
  const [rememberVault, setRememberVault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(lockReason || '');

  // QR Code Challenge state
  const [qrState, setQrState] = useState(null); // { challengeId, qrDataUrl, fingerprint, expiresAt }
  const [qrScannedBy, setQrScannedBy] = useState(null);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0);

  // Auto-updater token input inside Launcher
  const [ghPatInput, setGhPatInput] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (lockReason) setErrorMsg(lockReason);
  }, [lockReason]);

  // Load saved token from encrypted vault if available
  useEffect(() => {
    const loadSaved = async () => {
      if (window.mashNative?.getVault) {
        const v = await window.mashNative.getVault();
        if (v.connectionToken) setConnectionToken(v.connectionToken);
        if (v.savedUsername) setUsername(v.savedUsername);
      } else {
        const savedTok = localStorage.getItem('mashvoice.vault.token');
        const savedUsr = localStorage.getItem('mashvoice.vault.username');
        if (savedTok) setConnectionToken(savedTok);
        if (savedUsr) setUsername(savedUsr);
      }
    };
    loadSaved();
  }, []);

  // Auto-fill local Founder token on host PC when connectionToken is still empty
  useEffect(() => {
    if (!joinRemoteMode && !connectionToken && bootstrap?.starterTokens?.[0]?.token) {
      setConnectionToken(bootstrap.starterTokens[0].token);
    }
  }, [bootstrap, joinRemoteMode, connectionToken]);

  const createQrChallenge = async () => {
    setQrScannedBy(null);
    try {
      const res = await fetch('/api/auth/qr/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: window.mashNative?.isElectron
            ? 'MashVoice Desktop (Electron)'
            : `MashVoice PC (${navigator.platform || 'Desktop'})`,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setQrState(data);
        setQrSecondsLeft(Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000)));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (authMode !== 'qr' || navTab !== 'connexion') return undefined;
    createQrChallenge();
    return undefined;
  }, [authMode, navTab]);

  // Watch active QR challenge via WebSocket for real-time mobile scan & instant PC login
  useEffect(() => {
    if (!qrState?.challengeId || authMode !== 'qr') return undefined;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?mode=qr&challengeId=${encodeURIComponent(qrState.challengeId)}`
    );

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'qr:scanned') {
          setQrScannedBy(msg.scannedBy);
        } else if (msg.type === 'qr:approved' && msg.auth) {
          onAuthenticated({
            ...msg.auth,
            rememberVault: true,
          });
        }
      } catch {
        // ignore
      }
    };

    const countdown = setInterval(() => {
      const rem = Math.max(0, Math.round((qrState.expiresAt - Date.now()) / 1000));
      setQrSecondsLeft(rem);
      if (rem <= 0) {
        createQrChallenge();
      }
    }, 1000);

    return () => {
      clearInterval(countdown);
      ws.close();
    };
  }, [qrState?.challengeId, authMode]);

  const handleTokenLogin = async (e) => {
    e?.preventDefault();
    setErrorMsg('');
    if (!connectionToken.trim()) {
      setErrorMsg('Accès refusé : le Token de Connexion obligatoire est requis pour entrer.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionToken: connectionToken.trim(),
          username: username.trim() || 'rawsq',
          deviceType: 'desktop',
          deviceName: window.mashNative?.isElectron ? 'MashVoice Electron PC' : 'MashVoice PC',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Token de connexion invalide.');
        setSubmitting(false);
        return;
      }

      onAuthenticated({
        sessionToken: data.sessionToken,
        connectionToken: connectionToken.trim(),
        user: data.user,
        tokenInfo: data.tokenInfo,
        rememberVault,
      });
    } catch (err) {
      setErrorMsg(`Erreur réseau : ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const presetQuality = hwConfig.shaderPreset || 'balanced';
  const starterTokens = bootstrap?.starterTokens || [];
  const prefilledUrl =
    updaterStatus?.prefilledTokenUrl ||
    bootstrap?.prefilledGithubTokenUrl ||
    'https://github.com/settings/personal-access-tokens/new?name=MashVoice+Auto-Updater&target_name=MyMasha&expires_in=365&contents=read&metadata=read';

  return (
    <div className="launcher-root">
      <BlackHoleCanvas
        quality={presetQuality}
        paused={hwConfig.renderBackend === 'cpu-software'}
        offsetX={0.13}
        offsetY={0.0}
      />
      <div className="launcher-vignette" />

      {/* Top Navigation Bar (MASHCLIENT Singularity 4.1 style) */}
      <header className="launcher-topbar">
        <div className="brand-cluster">
          <div className="brand-mark" />
          <span className="brand-title">MASHVOICE</span>
          <span className="singularity-badge">SINGULARITY 4.1</span>
        </div>

        <nav className="launcher-pill-nav" aria-label="Navigation Launcher">
          <button
            type="button"
            id="launcher-tab-connexion"
            className={`pill-nav-btn ${navTab === 'connexion' ? 'active' : ''}`}
            onClick={() => setNavTab('connexion')}
          >
            Connexion
          </button>
          <button
            type="button"
            id="launcher-tab-optimisations"
            className={`pill-nav-btn ${navTab === 'optimisations' ? 'active' : ''}`}
            onClick={() => setNavTab('optimisations')}
          >
            Optimisations <span className="pill-count">18/18</span>
          </button>
          <button
            type="button"
            id="launcher-tab-updater"
            className={`pill-nav-btn ${navTab === 'updater' ? 'active' : ''}`}
            onClick={() => setNavTab('updater')}
          >
            Auto-Updater{' '}
            <span className="pill-count">
              v{updaterStatus?.currentVersion || bootstrap?.version || '1.0.0'}
            </span>
          </button>
          <button
            type="button"
            id="launcher-tab-systeme"
            className={`pill-nav-btn ${navTab === 'systeme' ? 'active' : ''}`}
            onClick={() => setNavTab('systeme')}
          >
            Système
          </button>
        </nav>

        <div className="topbar-right">
          <button
            type="button"
            id="toggle-mobile-companion-btn"
            className="mobile-companion-pill"
            onClick={onToggleMobileCompanion}
            title="Ouvrir l'application mobile MashVoice pour tester le vocal mobile ou scanner le QR Code PC"
          >
            <Smartphone size={14} />
            {mobileCompanionOpen ? 'Fermer App Mobile' : 'App Mobile & Scan QR'}
          </button>

          {window.mashNative?.isElectron && (
            <div className="win-controls">
              <button
                type="button"
                className="win-btn"
                onClick={() => window.mashNative.windowControl('minimize')}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="win-btn"
                onClick={() => window.mashNative.windowControl('maximize')}
              >
                <Square size={12} />
              </button>
              <button
                type="button"
                className="win-btn close"
                onClick={() => window.mashNative.windowControl('close')}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Center Content */}
      <main className="launcher-main">
        <section className="launcher-hero-left">
          <div className="hero-overline">
            WEBRTC P2P MESH • ZERO-TRUST TOKEN • STREAM 120 FPS
          </div>
          <h1 className="hero-heading">MASHVOICE</h1>
          <p className="hero-description">
            Communication P2P chiffrée ultra-fluide entre amis et serveurs communautaires.
            Accès protégé par <strong>Token de Connexion obligatoire</strong> vérifié en continu,
            authentification instantanée par <strong>QR Code Mobile</strong> et Trou Noir 3D de
            Schwarzschild à mise en veille automatique en jeu.
          </p>
        </section>

        {/* Right Panel switches based on Top Pill Nav */}
        {navTab === 'connexion' && (
          <section className="gatekeeper-card" aria-label="Portail de Sécurité">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} color="#f5c26b" />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>
                  Portail Sécurisé Singularity
                </span>
              </div>
              <span className="singularity-badge">OBLIGATOIRE</span>
            </div>

            <div className="gate-tabs">
              <button
                type="button"
                id="auth-mode-token"
                className={`gate-tab ${authMode === 'token' ? 'active' : ''}`}
                onClick={() => setAuthMode('token')}
              >
                <KeyRound size={14} /> Token de Connexion
              </button>
              <button
                type="button"
                id="auth-mode-qr"
                className={`gate-tab ${authMode === 'qr' ? 'active' : ''}`}
                onClick={() => setAuthMode('qr')}
              >
                <QrCode size={14} /> Scanner QR Mobile
              </button>
            </div>

            {errorMsg && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--crimson-bg)',
                  border: '1px solid rgba(226, 85, 85, 0.4)',
                  color: '#ff9494',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {authMode === 'token' ? (
              <form onSubmit={handleTokenLogin} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {window.mashNative?.setRemoteNode && (
                  <div className="field-group">
                    <label className="field-label">
                      <span>Noeud P2P cible</span>
                      <span style={{ color: 'var(--gold-primary)', fontSize: 11 }}>
                        {joinRemoteMode ? 'Rejoindre un ami' : 'Mon PC (Hôte)'}
                      </span>
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn-chip"
                        style={{
                          flex: 1,
                          justifyContent: 'center',
                          borderColor: !joinRemoteMode ? 'var(--gold-primary)' : undefined,
                          color: !joinRemoteMode ? 'var(--gold-bright)' : undefined,
                        }}
                        onClick={() => {
                          setJoinRemoteMode(false);
                          window.mashNative.setRemoteNode('');
                        }}
                      >
                        Héberger sur mon PC
                      </button>
                      <button
                        type="button"
                        className="btn-chip"
                        style={{
                          flex: 1,
                          justifyContent: 'center',
                          borderColor: joinRemoteMode ? 'var(--gold-primary)' : undefined,
                          color: joinRemoteMode ? 'var(--gold-bright)' : undefined,
                        }}
                        onClick={() => setJoinRemoteMode(true)}
                      >
                        Rejoindre l&apos;IP d&apos;un ami
                      </button>
                    </div>
                    {joinRemoteMode && (
                      <input
                        className="mash-input mono"
                        style={{ marginTop: 6 }}
                        value={remoteNodeInput}
                        onChange={(e) => {
                          setRemoteNodeInput(e.target.value);
                          window.mashNative.setRemoteNode(e.target.value);
                        }}
                        placeholder="ex: 26.48.12.90:3080 ou 192.168.1.25:3080"
                        autoComplete="off"
                      />
                    )}
                  </div>
                )}

                <div className="field-group">
                  <label className="field-label" htmlFor="launcher-username">
                    <span>Ton Pseudo</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Chiffré E2EE</span>
                  </label>
                  <input
                    id="launcher-username"
                    className="mash-input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Entre ton pseudo (ex: Masha)"
                    autoComplete="off"
                  />
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="launcher-conn-token">
                    <span>Token de Connexion (Requis en continu)</span>
                    <Lock size={12} color="#e8a849" />
                  </label>
                  <input
                    id="launcher-conn-token"
                    type="password"
                    className="mash-input mono"
                    value={connectionToken}
                    onChange={(e) => setConnectionToken(e.target.value)}
                    placeholder="MASH-SV4.eyJ2Ijo0LCJqd..."
                    autoComplete="off"
                  />
                </div>

                {!joinRemoteMode && starterTokens.some((t) => t.token) && (
                  <div className="starter-token-box">
                    <div style={{ fontSize: 11, color: 'var(--gold-bright)', fontWeight: 600 }}>
                      Accès propriétaire local (clique pour remplir ton Token) :
                    </div>
                    {starterTokens.slice(0, 1).map(
                      (t) =>
                        t.token && (
                          <div key={t.jti} className="starter-token-row">
                            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                              {t.label}
                            </span>
                            <button
                              type="button"
                              className="btn-chip"
                              onClick={() => {
                                setConnectionToken(t.token);
                                setErrorMsg('');
                              }}
                            >
                              {connectionToken === t.token ? '✓ Token actif' : 'Utiliser mon Token'}
                            </button>
                          </div>
                        )
                    )}
                  </div>
                )}

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberVault}
                    onChange={(e) => setRememberVault(e.target.checked)}
                    style={{ accentColor: 'var(--gold-primary)' }}
                  />
                  Sauvegarder dans le coffre-fort local chiffré (rester connecté)
                </label>
              </form>
            ) : (
              <div className="qr-auth-panel">
                <div className="qr-frame">
                  {qrState?.qrDataUrl ? (
                    <img src={qrState.qrDataUrl} alt="QR Code de connexion MashVoice PC" />
                  ) : (
                    <div style={{ width: 176, height: 176, display: 'grid', placeItems: 'center' }}>
                      Génération...
                    </div>
                  )}

                  {qrScannedBy && (
                    <div className="qr-scanned-overlay">
                      <Smartphone size={26} color="#f5c26b" />
                      <div>Mobile détecté : @{qrScannedBy.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                        Appuyez sur « Autoriser ce PC » sur votre téléphone...
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>
                  Scannez avec l&apos;app MashVoice Mobile déjà connectée
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Ouvrez <strong>MashVoice Mobile → Scanner QR</strong> pour transférer votre session
                  sécurisée sur ce PC en 1 seconde.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--gold-primary)',
                  }}
                >
                  <span>Empreinte: {qrState?.fingerprint || '----'}</span>
                  <span>•</span>
                  <span>Expire dans {qrSecondsLeft}s</span>
                  <button type="button" className="btn-chip" onClick={createQrChallenge}>
                    Régénérer
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {navTab === 'optimisations' && (
          <section className="launcher-panel-overlay">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Cpu size={18} color="#f5c26b" />
              <h2 style={{ fontSize: 16, fontFamily: 'var(--font-display)' }}>
                Allocation Matérielle GPU / CPU / RAM & Mode Jeu
              </h2>
            </div>

            <div className="hw-card">
              <div className="field-label">
                <span>Processeur de Rendu & Encodage Stream</span>
                <span style={{ color: 'var(--gold-bright)' }}>{hwConfig.renderBackend}</span>
              </div>
              <div className="hw-options-grid">
                {[
                  {
                    id: 'gpu-dedicated',
                    title: 'GPU Dédié (NVENC / AMF)',
                    desc: 'Encodeur matériel Zero-Copy, 0 impact FPS en jeu',
                  },
                  {
                    id: 'gpu-integrated',
                    title: 'iGPU Économie (QSV)',
                    desc: 'Décharge le GPU principal sur le circuit intégré',
                  },
                  {
                    id: 'cpu-software',
                    title: 'CPU Uniquement',
                    desc: 'Désactive WebGL/GPU pour réserver 100% VRAM au jeu',
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`hw-choice ${hwConfig.renderBackend === opt.id ? 'selected' : ''}`}
                    onClick={() => onUpdateHwConfig({ renderBackend: opt.id })}
                  >
                    <strong style={{ fontSize: 12.5 }}>{opt.title}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hw-card">
              <div className="field-label">
                <span>Limite Mémoire RAM Allouée à MashVoice</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                  {hwConfig.maxRamMb} Mo
                </span>
              </div>
              <input
                type="range"
                min={512}
                max={8192}
                step={256}
                className="range-slider"
                value={hwConfig.maxRamMb}
                onChange={(e) => onUpdateHwConfig({ maxRamMb: Number(e.target.value) })}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>512 Mo (Ultra-Léger)</span>
                <span>2048 Mo (Recommandé)</span>
                <span>8192 Mo (Stream 4K)</span>
              </div>
            </div>

            <div className="hw-card">
              <div className="field-label">
                <span>Coeurs / Threads CPU Autorisés</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                  {hwConfig.cpuThreads} Threads
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={bootstrap?.hostSpecs?.cpuCores || 16}
                step={1}
                className="range-slider"
                value={hwConfig.cpuThreads}
                onChange={(e) => onUpdateHwConfig({ cpuThreads: Number(e.target.value) })}
              />
            </div>
          </section>
        )}

        {navTab === 'updater' && (
          <section className="launcher-panel-overlay">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <RefreshCw size={18} color="#f5c26b" />
                <h2 style={{ fontSize: 16, fontFamily: 'var(--font-display)' }}>
                  Auto-Updater GitHub — MyMasha/MashVoice
                </h2>
              </div>
              <button
                type="button"
                className="btn-chip"
                disabled={checkingUpdate}
                onClick={async () => {
                  setCheckingUpdate(true);
                  await onCheckUpdates();
                  setCheckingUpdate(false);
                }}
              >
                {checkingUpdate ? 'Vérification...' : 'Vérifier maintenant'}
              </button>
            </div>

            <div className="hw-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <CheckCircle2 size={16} color="#48c78e" />
                <span>
                  {updaterStatus?.lastStatus?.message ||
                    `Connecté au dépôt MyMasha/MashVoice (v${updaterStatus?.currentVersion || '1.0.0'}).`}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Pour que l&apos;Auto-Updater télécharge automatiquement chaque release privée sur
                l&apos;organisation <strong>MyMasha</strong> pendant <strong>365 jours</strong> en
                lecture seule (<code>contents:read</code>), générez votre token pré-configuré en 1 clic :
              </div>
              <a
                href={prefilledUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-gold-cta"
                style={{ textDecoration: 'none', padding: '9px 16px', fontSize: 12.5 }}
              >
                <ExternalLink size={15} /> Ouvrir le Lien GitHub Token Read-Only (365 jours • MyMasha)
              </a>
            </div>

            <div className="hw-card">
              <label className="field-label" htmlFor="launcher-gh-pat">
                <span>Token GitHub Read-Only (MyMasha/MashVoice)</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                  {updaterStatus?.hasToken ? updaterStatus.maskedToken : 'Non configuré'}
                </span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="launcher-gh-pat"
                  type="password"
                  className="mash-input mono"
                  placeholder="github_pat_11A..."
                  value={ghPatInput}
                  onChange={(e) => setGhPatInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-chip"
                  style={{ padding: '0 14px', whiteSpace: 'nowrap' }}
                  onClick={async () => {
                    if (!ghPatInput.trim()) return;
                    await onSaveUpdaterToken(ghPatInput.trim());
                    setGhPatInput('');
                  }}
                >
                  Activer
                </button>
              </div>
            </div>
          </section>
        )}

        {navTab === 'systeme' && (
          <section className="launcher-panel-overlay">
            <h2 style={{ fontSize: 16, fontFamily: 'var(--font-display)' }}>
              Diagnostic Système & Sécurité Zero-Trust
            </h2>
            <div className="hw-card" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <div>• CPU Détecté : {bootstrap?.hostSpecs?.cpuModel} ({bootstrap?.hostSpecs?.cpuCores} coeurs)</div>
              <div>• RAM Système : {bootstrap?.hostSpecs?.totalMemMb} Mo</div>
              <div>• Budget RAM MashVoice : Max {hwConfig.maxRamMb} Mo</div>
              <div>• Moteur Vidéo : {hwConfig.videoEncoder} (degradationPreference = maintain-framerate)</div>
              <div>• Sécurité : Signature HMAC-SHA256 + Heartbeat continu 15s + Coffre AES</div>
              <div>• Dépôt Auto-Update : https://github.com/MyMasha/MashVoice (Read-Only 365j)</div>
            </div>
          </section>
        )}
      </main>

      {/* Bottom Bar (exact MASHCLIENT feel with golden CTA button) */}
      <footer className="launcher-bottombar">
        <div className="bottom-status-chips">
          <span className="status-chip highlight">
            <Lock size={12} color="#f5c26b" /> Token Obligatoire
          </span>
          <span className="status-chip">WebRTC P2P Direct</span>
          <span className="status-chip">QR Mobile Ready</span>
          <span className="jvm-summary">
            RAM: Max {hwConfig.maxRamMb} Mo • {hwConfig.renderBackend.toUpperCase()} • Pause Shader En Jeu:{' '}
            {hwConfig.pauseShaderInGame ? 'OUI (0% GPU)' : 'NON'}
          </span>
        </div>

        <button
          type="button"
          id="launcher-connect-cta"
          className="btn-gold-cta"
          disabled={submitting}
          onClick={() => {
            if (navTab !== 'connexion') {
              setNavTab('connexion');
              return;
            }
            if (authMode === 'qr') {
              onToggleMobileCompanion();
              return;
            }
            handleTokenLogin();
          }}
        >
          <Play size={15} fill="currentColor" />
          {submitting
            ? 'VÉRIFICATION...'
            : authMode === 'qr' && navTab === 'connexion'
              ? 'SCANNER DEPUIS MOBILE'
              : 'SE CONNECTER'}
        </button>
      </footer>
    </div>
  );
}
