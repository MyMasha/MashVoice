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
  Sparkles,
  Download,
  Minus,
  Square,
  X,
} from 'lucide-react';
import BlackHoleCanvas from './BlackHoleCanvas.jsx';
import { UpdateTopPill } from './UpdateExperience.jsx';

export default function SecureLauncher({
  bootstrap,
  hwConfig,
  onUpdateHwConfig,
  updaterStatus,
  installingUpdate,
  onCheckUpdates,
  onInstallUpdate,
  onOpenChangelog,
  onAuthenticated,
  onToggleMobileCompanion,
  mobileCompanionOpen,
  lockReason,
}) {
  const [navTab, setNavTab] = useState('connexion'); // 'connexion' | 'optimisations' | 'updater' | 'systeme'
  const [authMode, setAuthMode] = useState('token'); // 'token' | 'qr'
  const [username, setUsername] = useState('');
  const [connectionToken, setConnectionToken] = useState('');
  const [rememberVault, setRememberVault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(lockReason || '');

  // QR Code Challenge state
  const [qrState, setQrState] = useState(null);
  const [qrScannedBy, setQrScannedBy] = useState(null);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0);

  // Auto-updater state inside Launcher
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (lockReason) setErrorMsg(lockReason);
  }, [lockReason]);

  useEffect(() => {
    window.mashNative?.setRemoteNode?.('');
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

  useEffect(() => {
    if (!connectionToken && bootstrap?.starterTokens?.[0]?.token) {
      setConnectionToken(bootstrap.starterTokens[0].token);
    }
  }, [bootstrap, connectionToken]);

  const createQrChallenge = async () => {
    setQrScannedBy(null);
    try {
      const res = await fetch('/api/auth/qr/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: window.mashNative?.isElectron
            ? 'MashVoice Desktop (Tauri Rust)'
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
    if (!username.trim()) {
      setErrorMsg('Entre ton pseudo (ex: rawsq, v0dka...) avant de lancer MashVoice.');
      return;
    }
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
          username: username.trim(),
          deviceType: 'desktop',
          deviceName: window.mashNative?.isElectron ? 'MashVoice Tauri PC' : 'MashVoice PC',
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

  return (
    <div className="launcher-root">
      <BlackHoleCanvas
        quality={presetQuality}
        paused={hwConfig.renderBackend === 'cpu-software'}
        offsetX={0.13}
        offsetY={0.0}
      />
      <div className="launcher-vignette" />

      {/* Top Navigation Bar (v5 « Obsidian Air ») */}
      <header className="launcher-topbar">
        <div className="brand-cluster">
          <div className="brand-mark" />
          <span className="brand-title">MASHVOICE</span>
          <span className="singularity-badge">5.0</span>
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
            Performance
          </button>
          <button
            type="button"
            id="launcher-tab-updater"
            className={`pill-nav-btn ${navTab === 'updater' ? 'active' : ''}`}
            onClick={() => setNavTab('updater')}
          >
            Mises à jour{' '}
            <span className="pill-count">
              v{updaterStatus?.currentVersion || bootstrap?.version || '1.0.6'}
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
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--emerald)',
              marginRight: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--emerald)',
              }}
            />
            zyntra.win · E2EE
          </span>

          <UpdateTopPill
            updaterStatus={updaterStatus}
            installing={installingUpdate}
            onInstallUpdate={onInstallUpdate}
            onOpenChangelog={onOpenChangelog}
          />

          <button
            type="button"
            id="toggle-mobile-companion-btn"
            className="mobile-companion-pill"
            onClick={onToggleMobileCompanion}
            title="Ouvrir l'application mobile MashVoice pour tester le vocal mobile ou scanner le QR Code PC"
          >
            <Smartphone size={14} />
            {mobileCompanionOpen ? 'Fermer Mobile' : 'Mobile & QR'}
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
            <span>Routage aveugle Zero-IP · Audio Opus 48 kHz stéréo</span>
          </div>
          <h1 className="hero-heading">Communication P2P sans compromis.</h1>
          <p className="hero-description">
            Vocal basse latence chiffré de bout en bout avec isolation{' '}
            <strong>MashKrisp™ Anti-Clavier</strong>, ajout d&apos;amis{' '}
            <strong>100% par pseudo</strong> et partage d&apos;écran jusqu&apos;en{' '}
            <strong>4K 120 FPS</strong> sans impact en jeu.
          </p>

          <div className="launcher-metrics-row">
            <div className="launcher-metric-card">
              <strong>&lt; 2.8 ms</strong>
              <span>MashKrisp™ AudioWorklet</span>
            </div>
            <div className="launcher-metric-card">
              <strong>4K · 120 FPS</strong>
              <span>Stream GPU Zero-Copy</span>
            </div>
            <div className="launcher-metric-card">
              <strong>AES-256-GCM</strong>
              <span>Aucune IP exposée</span>
            </div>
          </div>

          <div className="preset-row" role="group" aria-label="Profil graphique d'arrière-plan">
            {[
              { id: 'ultra', label: 'Cinématique' },
              { id: 'balanced', label: 'Équilibré' },
              { id: 'turbo', label: 'Turbo 0% GPU' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-pill ${presetQuality === p.id ? 'selected' : ''}`}
                onClick={() => onUpdateHwConfig({ shaderPreset: p.id })}
              >
                <span className="preset-dot" />
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Right Panel switches based on Top Segmented Nav */}
        {navTab === 'connexion' && (
          <section className="gatekeeper-card" aria-label="Portail de Sécurité">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheck size={17} color="var(--gold-primary)" />
                  <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.015em' }}>
                    Bon retour
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Session P2P sans adresse IP exposée. Clés chiffrées localement.
                </span>
              </div>
              <span className="singularity-badge">MASH-SV4</span>
            </div>

            <div className="gate-tabs">
              <button
                type="button"
                id="auth-mode-token"
                className={`gate-tab ${authMode === 'token' ? 'active' : ''}`}
                onClick={() => setAuthMode('token')}
              >
                <KeyRound size={13} /> Clé d&apos;accès
              </button>
              <button
                type="button"
                id="auth-mode-qr"
                className={`gate-tab ${authMode === 'qr' ? 'active' : ''}`}
                onClick={() => setAuthMode('qr')}
              >
                <QrCode size={13} /> Scan QR Mobile
              </button>
            </div>

            {errorMsg && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--crimson-bg)',
                  border: '1px solid rgba(239, 90, 90, 0.32)',
                  color: 'var(--crimson)',
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
              <form onSubmit={handleTokenLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="field-group">
                  <label className="field-label" htmlFor="launcher-username">
                    <span>Pseudo</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      Zero-IP
                    </span>
                  </label>
                  <input
                    id="launcher-username"
                    className="mash-input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: rawsq, v0dka..."
                    autoComplete="off"
                  />
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="launcher-conn-token">
                    <span>Token MASH-SV4</span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--emerald)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                      }}
                    >
                      <Lock size={11} /> Coffre AES-256
                    </span>
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

                {starterTokens.some((t) => t.token) && (
                  <div className="starter-token-box">
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      Clé propriétaire locale détectée :
                    </div>
                    {starterTokens.slice(0, 1).map(
                      (t) =>
                        t.token && (
                          <div key={t.jti} className="starter-token-row">
                            <span style={{ fontSize: 11.5, color: 'var(--text-primary)', fontWeight: 500 }}>
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
                              {connectionToken === t.token ? '✓ Clé active' : 'Remplir'}
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
                  Mémoriser dans le coffre-fort local chiffré
                </label>

                <button
                  type="submit"
                  className="btn-gold-cta"
                  disabled={submitting}
                  style={{ width: '100%', padding: '10px 16px', marginTop: 2 }}
                >
                  <span>{submitting ? 'Vérification...' : 'Ouvrir MashVoice'}</span>
                </button>
              </form>
            ) : (
              <div className="qr-auth-panel">
                <div className="qr-frame">
                  {qrState?.qrDataUrl ? (
                    <img src={qrState.qrDataUrl} alt="QR Code de connexion MashVoice PC" />
                  ) : (
                    <div
                      style={{
                        width: 168,
                        height: 168,
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                      }}
                    >
                      Génération...
                    </div>
                  )}

                  {qrScannedBy && (
                    <div className="qr-scanned-overlay">
                      <Smartphone size={24} color="var(--emerald)" />
                      <div>Mobile détecté : @{qrScannedBy.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                        Appuyez sur « Autoriser ce PC » sur votre téléphone...
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>
                  Scannez depuis l&apos;app compagnon MashVoice
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Ouvrez <strong>MashVoice Mobile → Scan QR</strong> pour transférer votre session
                  chiffrée instantanément.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{qrState?.fingerprint || '----'}</span>
                  <span>·</span>
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
              <Cpu size={17} color="var(--gold-primary)" />
              <h2 style={{ fontSize: 15.5, fontWeight: 600 }}>
                Allocation Matérielle GPU / CPU / RAM &amp; Mode Jeu
              </h2>
            </div>

            <div className="hw-card">
              <div className="field-label">
                <span>Processeur de Rendu &amp; Encodage Stream</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-primary)' }}>
                  {hwConfig.renderBackend}
                </span>
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
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-primary)' }}>
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
                <span>512 Mo (Léger)</span>
                <span>2048 Mo (Recommandé)</span>
                <span>8192 Mo (Stream 4K)</span>
              </div>
            </div>

            <div className="hw-card">
              <div className="field-label">
                <span>Coeurs / Threads CPU Autorisés</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-primary)' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <RefreshCw size={17} color="var(--gold-primary)" />
                <h2 style={{ fontSize: 15.5, fontWeight: 600 }}>
                  Auto-Updater 1-Clic — MyMasha/MashVoice
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn-chip" onClick={onOpenChangelog}>
                  <Sparkles size={12} /> Notes
                </button>
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
                  {checkingUpdate ? 'Vérification...' : 'Vérifier'}
                </button>
              </div>
            </div>

            <div className="hw-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <CheckCircle2 size={16} color="var(--emerald)" />
                <span>
                  {updaterStatus?.lastStatus?.message ||
                    `Connecté au dépôt MyMasha/MashVoice (v${updaterStatus?.currentVersion || '1.0.6'}).`}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Installation atomique directe sans pop-up SmartScreen (aucun attribut navigateur{' '}
                <code>Zone.Identifier</code>), signature <code>Ed25519</code> vérifiée et ouverture
                automatique des notes de version au redémarrage.
              </div>

              {updaterStatus?.lastStatus?.updateAvailable ? (
                <button
                  type="button"
                  className="btn-gold-cta"
                  disabled={installingUpdate}
                  onClick={onInstallUpdate}
                >
                  <Download size={15} />
                  {installingUpdate
                    ? `Installation en cours (${updaterStatus?.downloadPercent || 0}%)...`
                    : `Installer v${updaterStatus.lastStatus.latestVersion} & Redémarrer`}
                </button>
              ) : (
                <a
                  href={
                    updaterStatus?.publicReleasesUrl ||
                    bootstrap?.publicReleasesUrl ||
                    'https://github.com/MyMasha/MashVoice/releases/latest'
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="btn-gold-cta"
                  style={{ textDecoration: 'none', padding: '9px 16px', fontSize: 12.5 }}
                >
                  <ExternalLink size={14} /> Voir les Releases Signées sur GitHub
                </a>
              )}
            </div>
          </section>
        )}

        {navTab === 'systeme' && (
          <section className="launcher-panel-overlay">
            <h2 style={{ fontSize: 15.5, fontWeight: 600 }}>
              Diagnostic Système &amp; Architecture Zero-Trust
            </h2>
            <div
              className="hw-card"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65, color: 'var(--text-secondary)' }}
            >
              <div>CPU détecté : {bootstrap?.hostSpecs?.cpuModel || 'x64'} ({bootstrap?.hostSpecs?.cpuCores || 8} coeurs)</div>
              <div>RAM système : {bootstrap?.hostSpecs?.totalMemMb || 16384} Mo</div>
              <div>Budget RAM MashVoice : max {hwConfig.maxRamMb} Mo</div>
              <div>Isolation vocale : MashKrisp™ AudioWorklet (&lt; 2.8 ms)</div>
              <div>Relais Zero-IP : wss://zyntra.win/api/mashvoice/ws (ECDH P-256 + AES-256-GCM)</div>
              <div>Mise à jour : remplacement atomique signé Ed25519</div>
            </div>
          </section>
        )}
      </main>

      {/* Bottom Telemetry & Quick Action Bar */}
      <footer className="launcher-bottombar">
        <div className="bottom-status-chips">
          <span className="status-chip highlight">
            <Lock size={11} /> Chiffrement ECDH P-256 · AES-256-GCM
          </span>
          <span className="jvm-summary">
            Moteur Rust · Max {hwConfig.maxRamMb} Mo RAM · {hwConfig.renderBackend.toUpperCase()} · Pause shader en jeu :{' '}
            {hwConfig.pauseShaderInGame ? 'Auto' : 'Off'}
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
          <Play size={13} fill="currentColor" />
          {submitting
            ? 'Vérification...'
            : authMode === 'qr' && navTab === 'connexion'
              ? 'Scanner depuis Mobile'
              : 'Se connecter'}
        </button>
      </footer>
    </div>
  );
}
