import React, { useEffect, useState } from 'react';
import {
  User,
  Cpu,
  Gamepad2,
  Mic,
  ShieldAlert,
  RefreshCw,
  X,
  ExternalLink,
  Copy,
  Check,
  KeyRound,
  Trash2,
} from 'lucide-react';

export default function SettingsModal({
  me,
  sessionToken,
  hwConfig,
  onUpdateHwConfig,
  streamSettings,
  onUpdateStreamSettings,
  simulatedGame,
  onToggleSimulatedGame,
  updaterStatus,
  onCheckUpdates,
  onSaveUpdaterToken,
  onProfileUpdated,
  onLogout,
  onClose,
}) {
  const [tab, setTab] = useState('hardware'); // 'profile' | 'hardware' | 'gaming' | 'audio' | 'security' | 'updater'
  const [displayName, setDisplayName] = useState(me?.displayName || '');
  const [customStatus, setCustomStatus] = useState(me?.customStatus || '');
  const [presence, setPresence] = useState(me?.status || 'online');
  const [savingProfile, setSavingProfile] = useState(false);

  // Audio/Video devices
  const [devices, setDevices] = useState({ audioIn: [], audioOut: [], videoIn: [] });

  // Security tokens admin state
  const [secData, setSecData] = useState({ tokens: [], activeSessions: [], currentTokenJti: '' });
  const [newTokLabel, setNewTokLabel] = useState('Invitation Ami P2P');
  const [newTokDays, setNewTokDays] = useState(365);
  const [mintedRaw, setMintedRaw] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Updater input
  const [ghPat, setGhPat] = useState('');
  const [checkingUpd, setCheckingUpd] = useState(false);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  const loadSecurityTokens = async () => {
    try {
      const res = await fetch('/api/security/tokens', { headers: authHeaders });
      if (res.ok) {
        setSecData(await res.json());
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (tab === 'security') {
      loadSecurityTokens();
    }
    if (tab === 'audio' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          setDevices({
            audioIn: list.filter((d) => d.kind === 'audioinput'),
            audioOut: list.filter((d) => d.kind === 'audiooutput'),
            videoIn: list.filter((d) => d.kind === 'videoinput'),
          });
        })
        .catch(() => {});
    }
  }, [tab]);

  const copyText = (text, id) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 1800);
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          displayName,
          status: presence,
          customStatus,
        }),
      });
      const data = await res.json();
      if (data.ok) onProfileUpdated(data.user);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleMintToken = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/security/tokens/mint', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: newTokLabel, days: newTokDays }),
    });
    const data = await res.json();
    if (data.ok) {
      setMintedRaw(data.token);
      loadSecurityTokens();
    }
  };

  const handleRevokeToken = async (jti) => {
    await fetch('/api/security/tokens/revoke', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ jti }),
    });
    loadSecurityTokens();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav">
          <div
            style={{
              padding: '0 10px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--gold-primary)',
            }}
          >
            PARAMÈTRES PRO
          </div>

          <button
            type="button"
            className={`settings-nav-btn ${tab === 'hardware' ? 'active' : ''}`}
            onClick={() => setTab('hardware')}
          >
            <Cpu size={16} /> GPU, CPU & RAM
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'gaming' ? 'active' : ''}`}
            onClick={() => setTab('gaming')}
          >
            <Gamepad2 size={16} /> Mode Jeu & Stream
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'audio' ? 'active' : ''}`}
            onClick={() => setTab('audio')}
          >
            <Mic size={16} /> Voix, Audio & Caméra
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'security' ? 'active' : ''}`}
            onClick={() => setTab('security')}
          >
            <ShieldAlert size={16} /> Sécurité & Tokens
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'updater' ? 'active' : ''}`}
            onClick={() => setTab('updater')}
          >
            <RefreshCw size={16} /> Auto-Updater GitHub
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'profile' ? 'active' : ''}`}
            onClick={() => setTab('profile')}
          >
            <User size={16} /> Profil & Identité P2P
          </button>

          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="settings-nav-btn"
            style={{ color: 'var(--crimson)' }}
            onClick={onLogout}
          >
            Verrouiller / Déconnexion
          </button>
        </aside>

        <section className="settings-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
              {tab === 'hardware' && 'Allocation Matérielle GPU, CPU & Mémoire RAM'}
              {tab === 'gaming' && 'Optimisation En Jeu « Turbo FPS » & Qualité Stream'}
              {tab === 'audio' && 'Périphériques Audio Opus & Caméra P2P'}
              {tab === 'security' && 'Sécurité Zero-Trust & Tokens de Connexion'}
              {tab === 'updater' && 'Auto-Updater GitHub (MyMasha/MashVoice)'}
              {tab === 'profile' && 'Profil Utilisateur & Identité P2P'}
            </h2>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          {tab === 'hardware' && (
            <>
              <div className="hw-card">
                <div className="field-label">
                  <span>1. Moteur d&apos;Exécution Graphique (GPU vs CPU)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {hwConfig.renderBackend}
                  </span>
                </div>
                <div className="hw-options-grid">
                  {[
                    {
                      id: 'gpu-dedicated',
                      title: 'GPU Dédié Haute Perf',
                      desc: 'Active NVENC / AMF Zero-Copy pour streamer sans toucher au CPU du jeu.',
                    },
                    {
                      id: 'gpu-integrated',
                      title: 'iGPU Secondaire',
                      desc: 'Place MashVoice sur le GPU intégré pour laisser 100% du GPU dédié au jeu.',
                    },
                    {
                      id: 'cpu-software',
                      title: 'Mode CPU Pur (0 Mo VRAM)',
                      desc: 'Coupe l’accélération GPU de l’interface pour économiser toute la VRAM.',
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`hw-choice ${hwConfig.renderBackend === item.id ? 'selected' : ''}`}
                      onClick={() => onUpdateHwConfig({ renderBackend: item.id })}
                    >
                      <strong>{item.title}</strong>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {item.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>2. Encodeur Matériel de Stream P2P</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {streamSettings.preferredCodec}
                  </span>
                </div>
                <div className="hw-options-grid">
                  {[
                    {
                      codec: 'H264',
                      enc: 'nvenc-av1-h264',
                      title: 'NVIDIA NVENC / AMD AMF (H.264)',
                      desc: 'Puce matérielle dédiée — latence < 6 ms, 0 perte FPS.',
                    },
                    {
                      codec: 'AV1',
                      enc: 'av1-hw',
                      title: 'AV1 Nouvelle Génération',
                      desc: 'Qualité visuelle +40% à débit égal (RTX 40 / RX 7000+).',
                    },
                    {
                      codec: 'VP9',
                      enc: 'cpu-x264',
                      title: 'VP9 / CPU Multi-Thread',
                      desc: 'Encodage universel ajustable selon vos coeurs CPU.',
                    },
                  ].map((item) => (
                    <button
                      key={item.codec}
                      type="button"
                      className={`hw-choice ${streamSettings.preferredCodec === item.codec ? 'selected' : ''}`}
                      onClick={() => {
                        onUpdateStreamSettings({ preferredCodec: item.codec });
                        onUpdateHwConfig({ videoEncoder: item.enc });
                      }}
                    >
                      <strong>{item.title}</strong>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {item.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>3. Allocation Mémoire RAM Maximale (`--max-old-space-size`)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {hwConfig.maxRamMb} Mo ({(hwConfig.maxRamMb / 1024).toFixed(2)} Go)
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
                  <span>512 Mo (Mode Compétitif)</span>
                  <span>2048 Mo (Équilibré)</span>
                  <span>4096 Mo</span>
                  <span>8192 Mo (Ultra Cache)</span>
                </div>
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>4. Threads CPU & Priorité Système</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {hwConfig.cpuThreads} Threads • {hwConfig.processPriority}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  className="range-slider"
                  value={hwConfig.cpuThreads}
                  onChange={(e) => onUpdateHwConfig({ cpuThreads: Number(e.target.value) })}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {[
                    { id: 'below_normal_in_game', label: 'Priorité Basse auto quand un jeu tourne (Recommandé)' },
                    { id: 'normal', label: 'Priorité Normale' },
                    { id: 'high_stream', label: 'Priorité Haute (PC dédié au stream)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`preset-pill ${hwConfig.processPriority === p.id ? 'selected' : ''}`}
                      onClick={() => onUpdateHwConfig({ processPriority: p.id })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'gaming' && (
            <>
              <div className="hw-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>
                      Bouclier de Performance « Mode Jeu Turbo FPS »
                    </strong>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Coupe automatiquement le shader 3D Schwarzschild et les animations UI dès qu&apos;un
                      jeu (MashClient, Minecraft, Valorant, CS2...) est détecté, tout en gardant le flux
                      WebRTC fluide à 60/120 FPS.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={onToggleSimulatedGame}
                  >
                    {simulatedGame ? 'Arrêter Simulation Jeu' : 'Tester : Simuler un Jeu Lancé'}
                  </button>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={hwConfig.autoDetectGames !== false}
                    onChange={(e) => onUpdateHwConfig({ autoDetectGames: e.target.checked })}
                    style={{ accentColor: 'var(--gold-primary)' }}
                  />
                  Détecter automatiquement les jeux plein écran / processus gaming
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={hwConfig.pauseShaderInGame !== false}
                    onChange={(e) => onUpdateHwConfig({ pauseShaderInGame: e.target.checked })}
                    style={{ accentColor: 'var(--gold-primary)' }}
                  />
                  Mettre le rendu WebGL d&apos;arrière-plan à 0.0% GPU pendant une partie
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={streamSettings.maintainFramerate !== false}
                    onChange={(e) =>
                      onUpdateStreamSettings({ maintainFramerate: e.target.checked })
                    }
                    style={{ accentColor: 'var(--gold-primary)' }}
                  />
                  Verrouiller la fluidité WebRTC (<code>degradationPreference = maintain-framerate</code>)
                </label>
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>Résolution & Cadence FPS des Streams P2P</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {streamSettings.resolution} @ {streamSettings.fps} FPS
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['720p', '1080p', '1440p'].map((res) => (
                    <button
                      key={res}
                      type="button"
                      className={`preset-pill ${streamSettings.resolution === res ? 'selected' : ''}`}
                      onClick={() => onUpdateStreamSettings({ resolution: res })}
                    >
                      {res}
                    </button>
                  ))}
                  <span style={{ width: 14 }} />
                  {[30, 60, 120].map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      className={`preset-pill ${streamSettings.fps === fps ? 'selected' : ''}`}
                      onClick={() => onUpdateStreamSettings({ fps })}
                    >
                      {fps} FPS
                    </button>
                  ))}
                </div>

                <div className="field-label" style={{ marginTop: 8 }}>
                  <span>Débit Vidéo Cible (Bitrate P2P Direct)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {(streamSettings.maxBitrateKbps / 1000).toFixed(1)} Mbps
                  </span>
                </div>
                <input
                  type="range"
                  min={2000}
                  max={15000}
                  step={500}
                  className="range-slider"
                  value={streamSettings.maxBitrateKbps}
                  onChange={(e) =>
                    onUpdateStreamSettings({ maxBitrateKbps: Number(e.target.value) })
                  }
                />
              </div>
            </>
          )}

          {tab === 'audio' && (
            <div className="hw-card">
              <div className="field-group">
                <label className="field-label">Microphone d&apos;entrée (Opus 48 kHz Stéréo)</label>
                <select className="mash-input">
                  {devices.audioIn.length === 0 && (
                    <option>Microphone par défaut du système</option>
                  )}
                  {devices.audioIn.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone #${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label className="field-label">Sortie Casque / Haut-parleurs</label>
                <select className="mash-input">
                  {devices.audioOut.length === 0 && <option>Sortie par défaut du système</option>}
                  {devices.audioOut.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Sortie Audio #${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={streamSettings.noiseSuppression !== false}
                  onChange={(e) =>
                    onUpdateStreamSettings({ noiseSuppression: e.target.checked })
                  }
                  style={{ accentColor: 'var(--gold-primary)' }}
                />
                Suppression neuronale du bruit clavier / ventilateur
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={streamSettings.echoCancellation !== false}
                  onChange={(e) =>
                    onUpdateStreamSettings({ echoCancellation: e.target.checked })
                  }
                  style={{ accentColor: 'var(--gold-primary)' }}
                />
                Annulation d&apos;écho acoustique faible latence
              </label>
            </div>
          )}

          {tab === 'security' && (
            <>
              <div className="hw-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <KeyRound size={16} color="#f5c26b" />
                  <strong>Générer un nouveau Token de Connexion Obligatoire (Amis / Équipe)</strong>
                </div>
                <form
                  onSubmit={handleMintToken}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 120px auto', gap: 8 }}
                >
                  <input
                    className="mash-input"
                    value={newTokLabel}
                    onChange={(e) => setNewTokLabel(e.target.value)}
                    placeholder="Nom du token (ex: Token de Lucas)"
                  />
                  <input
                    type="number"
                    min={1}
                    max={366}
                    className="mash-input mono"
                    value={newTokDays}
                    onChange={(e) => setNewTokDays(Number(e.target.value))}
                    title="Durée en jours"
                  />
                  <button type="submit" className="btn-gold-cta" style={{ padding: '0 18px' }}>
                    Générer
                  </button>
                </form>

                {mintedRaw && (
                  <div className="starter-token-box">
                    <div style={{ fontSize: 11.5, color: 'var(--emerald)', fontWeight: 600 }}>
                      Nouveau Token signé généré — envoyez-le de manière sécurisée :
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input className="mash-input mono" readOnly value={mintedRaw} />
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => copyText(mintedRaw, 'minted')}
                      >
                        {copiedId === 'minted' ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="hw-card">
                <strong>Tokens émis & Révocation en Temps Réel</strong>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Révoquer un token déconnecte instantanément tous les PC et téléphones qui
                  l&apos;utilisent.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {secData.tokens.map((t) => (
                    <div
                      key={t.jti}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.35)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {t.label}{' '}
                          {t.jti === secData.currentTokenJti && (
                            <span className="singularity-badge">SESSION ACTUELLE</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {t.tokenPreview} • Expire le{' '}
                          {new Date(t.expiresAt).toLocaleDateString('fr-FR')}
                        </div>
                      </div>

                      {t.revoked ? (
                        <span style={{ color: 'var(--crimson)', fontSize: 11.5, fontWeight: 700 }}>
                          RÉVOQUÉ
                        </span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {t.tokenValue && (
                            <button
                              type="button"
                              className="btn-chip"
                              onClick={() => copyText(t.tokenValue, t.jti)}
                            >
                              {copiedId === t.jti ? 'Copié' : 'Copier'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="dock-action-btn danger"
                            onClick={() => handleRevokeToken(t.jti)}
                            title="Révoquer ce token et couper ses connexions"
                          >
                            <Trash2 size={13} /> Révoquer
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'updater' && (
            <div className="hw-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Dépôt Cible : {updaterStatus?.owner || 'MyMasha'}/{updaterStatus?.repo || 'MashVoice'}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Version installée : v{updaterStatus?.currentVersion || '1.0.0'} • Canal Stable
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-chip"
                  disabled={checkingUpd}
                  onClick={async () => {
                    setCheckingUpd(true);
                    await onCheckUpdates();
                    setCheckingUpd(false);
                  }}
                >
                  {checkingUpd ? 'Vérification...' : 'Vérifier les mises à jour'}
                </button>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(232, 168, 73, 0.08)',
                  border: '1px solid var(--gold-border)',
                  fontSize: 12.5,
                }}
              >
                {updaterStatus?.lastStatus?.message ||
                  'Auto-Updater prêt. Configurez votre token GitHub Read-Only (365 jours) sur MyMasha.'}
              </div>

              <a
                href={updaterStatus?.prefilledTokenUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-gold-cta"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={15} /> Générer le Token Read-Only 365 Jours (Organisation MyMasha)
              </a>

              <div className="field-group" style={{ marginTop: 6 }}>
                <label className="field-label">
                  <span>Enregistrer le Token GitHub Read-Only dans l&apos;Auto-Updater</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {updaterStatus?.hasToken ? updaterStatus.maskedToken : 'Aucun token'}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    className="mash-input mono"
                    placeholder="github_pat_..."
                    value={ghPat}
                    onChange={(e) => setGhPat(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-chip"
                    style={{ padding: '0 16px' }}
                    onClick={async () => {
                      if (!ghPat.trim()) return;
                      await onSaveUpdaterToken(ghPat.trim());
                      setGhPat('');
                    }}
                  >
                    Sauvegarder
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'profile' && (
            <form onSubmit={saveProfile} className="hw-card">
              <div className="field-group">
                <label className="field-label">Nom d&apos;affichage</label>
                <input
                  className="mash-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Statut personnalisé</label>
                <input
                  className="mash-input"
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Présence</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { id: 'online', label: 'En ligne' },
                    { id: 'idle', label: 'Inactif' },
                    { id: 'dnd', label: 'Ne pas déranger' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`preset-pill ${presence === s.id ? 'selected' : ''}`}
                      onClick={() => setPresence(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">Identifiant Pair P2P (Partageable avec vos amis)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="mash-input mono" readOnly value={me?.peerId || ''} />
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => copyText(me?.peerId || '', 'peerid')}
                  >
                    {copiedId === 'peerid' ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              </div>
              <div>
                <button type="submit" className="btn-gold-cta" disabled={savingProfile}>
                  {savingProfile ? 'Enregistrement...' : 'Enregistrer le profil'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
