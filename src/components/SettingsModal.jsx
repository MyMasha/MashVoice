import React, { useEffect, useRef, useState } from 'react';
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
  Sparkles,
  Volume2,
  VolumeX,
  Download,
  Music,
  Waves,
} from 'lucide-react';
import { KrispVoiceProcessor, loadSavedKrispMode } from '../lib/krispEngine.js';
import {
  STREAM_RESOLUTIONS,
  STREAM_FPS_OPTIONS,
  computeRecommendedBitrateKbps,
  normalizeResolutionKey,
} from '../lib/p2pEngine.js';
import { mashSounds } from '../lib/soundEffects.js';

export default function SettingsModal({
  me,
  sessionToken,
  hwConfig,
  onUpdateHwConfig,
  streamSettings,
  onUpdateStreamSettings,
  micState,
  onRetryMicrophone,
  simulatedGame,
  onToggleSimulatedGame,
  updaterStatus,
  installingUpdate,
  onCheckUpdates,
  onInstallUpdate,
  onOpenChangelog,
  onProfileUpdated,
  onLogout,
  onClose,
}) {
  const [tab, setTab] = useState('audio'); // 'profile' | 'hardware' | 'gaming' | 'audio' | 'security' | 'updater'
  const [displayName, setDisplayName] = useState(me?.displayName || '');
  const [customStatus, setCustomStatus] = useState(me?.customStatus || '');
  const [presence, setPresence] = useState(me?.status || 'online');
  const [savingProfile, setSavingProfile] = useState(false);

  // Audio/Video devices + MashKrisp live mic loopback test
  const [devices, setDevices] = useState({ audioIn: [], audioOut: [], videoIn: [] });
  const [krispMode, setKrispMode] = useState(streamSettings?.krispMode || loadSavedKrispMode());
  const [sfxConfig, setSfxConfig] = useState(() => mashSounds.getConfig());
  const [testingMic, setTestingMic] = useState(false);
  const [micMeter, setMicMeter] = useState({ inputLevel: 0, outputLevel: 0, suppressedDb: 0, voiceActive: false });
  const [micRepairNotice, setMicRepairNotice] = useState('');
  const loopbackRef = useRef({ raw: null, krisp: null, audioEl: null });

  // Security tokens admin state
  const [secData, setSecData] = useState({ tokens: [], activeSessions: [], currentTokenJti: '' });
  const [newTokLabel, setNewTokLabel] = useState('Invitation Ami P2P');
  const [newTokDays, setNewTokDays] = useState(365);
  const [mintedRaw, setMintedRaw] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Updater state
  const [checkingUpd, setCheckingUpd] = useState(false);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  const stopMicLoopback = () => {
    try {
      loopbackRef.current.audioEl?.pause();
      if (loopbackRef.current.audioEl) loopbackRef.current.audioEl.srcObject = null;
      loopbackRef.current.krisp?.destroy();
      loopbackRef.current.raw?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    loopbackRef.current = { raw: null, krisp: null, audioEl: null };
    setTestingMic(false);
    setMicMeter({ inputLevel: 0, outputLevel: 0, suppressedDb: 0, voiceActive: false });
  };

  useEffect(() => () => stopMicLoopback(), []);

  const refreshDeviceList = () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
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
    if (tab === 'audio') {
      refreshDeviceList();
    } else if (testingMic) {
      stopMicLoopback();
    }
  }, [tab]);

  const handleStartMicTest = async () => {
    if (testingMic) {
      stopMicLoopback();
      return;
    }
    setMicRepairNotice('');
    try {
      await window.mashNative?.repairMicrophoneAccess?.(false);
      const raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(streamSettings.audioInputId ? { deviceId: { exact: streamSettings.audioInputId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const krisp = new KrispVoiceProcessor({
        mode: krispMode,
        onMeter: (m) => setMicMeter(m),
      });
      const outStream = await krisp.attach(raw);
      const audio = new Audio();
      audio.srcObject = outStream;
      audio.volume = 0.9;
      audio.play().catch(() => {});
      loopbackRef.current = { raw, krisp, audioEl: audio };
      setTestingMic(true);
      refreshDeviceList();
    } catch {
      setMicRepairNotice(
        "Accès au microphone refusé — cliquez sur « Réinitialiser & Autoriser le Micro » ci-dessous."
      );
    }
  };

  const handleSelectKrisp = (nextMode) => {
    setKrispMode(nextMode);
    onUpdateStreamSettings({ krispMode: nextMode });
    loopbackRef.current.krisp?.setMode(nextMode);
    mashSounds.krispToggle(nextMode !== 'off');
  };

  const handleUpdateSfx = (patch) => {
    const next = mashSounds.updateConfig(patch);
    setSfxConfig(next);
  };

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
            PARAMÈTRES MASHVOICE
          </div>

          <button
            type="button"
            className={`settings-nav-btn ${tab === 'audio' ? 'active' : ''}`}
            onClick={() => setTab('audio')}
          >
            <Mic size={16} /> Voix, MashKrisp &amp; Sons
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'hardware' ? 'active' : ''}`}
            onClick={() => setTab('hardware')}
          >
            <Cpu size={16} /> GPU, CPU &amp; RAM
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'gaming' ? 'active' : ''}`}
            onClick={() => setTab('gaming')}
          >
            <Gamepad2 size={16} /> Mode Jeu &amp; Stream
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'security' ? 'active' : ''}`}
            onClick={() => setTab('security')}
          >
            <ShieldAlert size={16} /> Sécurité &amp; Tokens
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'updater' ? 'active' : ''}`}
            onClick={() => setTab('updater')}
          >
            <RefreshCw size={16} /> Auto-Updater &amp; Changelog
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'profile' ? 'active' : ''}`}
            onClick={() => setTab('profile')}
          >
            <User size={16} /> Profil &amp; Identité P2P
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
              {tab === 'audio' && 'Voix Opus, MashKrisp™ Anti-Clavier & Musiques d’Appels'}
              {tab === 'hardware' && 'Allocation Matérielle GPU, CPU & Mémoire RAM'}
              {tab === 'gaming' && 'Optimisation En Jeu « Turbo FPS » & Qualité Stream'}
              {tab === 'security' && 'Sécurité Zero-Trust & Tokens de Connexion'}
              {tab === 'updater' && 'Auto-Updater 1-Clic & Notes de Version (Changelog)'}
              {tab === 'profile' && 'Profil Utilisateur & Identité P2P'}
            </h2>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          {tab === 'audio' && (
            <>
              {/* 1. MashKrisp Voice Isolation Card */}
              <div className="hw-card krisp-feature-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Waves size={18} color="#48c78e" />
                    <div>
                      <strong style={{ fontSize: 14 }}>
                        MashKrisp™ IA — Isolation Vocale Anti-Clavier (Équivalent Discord Krisp)
                      </strong>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Supprime en temps réel (&lt; 3 ms) les clics de clavier mécanique, clics souris,
                        coups sur le bureau et souffles PC pour ne transmettre que votre voix.
                      </div>
                    </div>
                  </div>
                  <span className="singularity-badge" style={{ color: '#6ce0ad', borderColor: 'rgba(72,199,142,0.4)' }}>
                    {krispMode === 'off' ? 'OFF' : 'ACTIF'}
                  </span>
                </div>

                <div className="hw-options-grid">
                  {[
                    {
                      id: 'ultra',
                      title: '🛡️ Ultra Anti-Clavier (Recommandé)',
                      desc: 'Coupe les switchs mécaniques (-36 dB), chocs bureau et ventilateurs.',
                    },
                    {
                      id: 'standard',
                      title: '🎙️ Standard Naturel',
                      desc: 'Réduction douce (-18 dB) idéale pour environnements déjà calmes.',
                    },
                    {
                      id: 'off',
                      title: 'Studio Brut (Désactivé)',
                      desc: 'Aucune porte spectrale — transmet l’intégralité du micro studio.',
                    },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`hw-choice ${krispMode === opt.id ? 'selected' : ''}`}
                      onClick={() => handleSelectKrisp(opt.id)}
                    >
                      <strong style={{ fontSize: 12.5 }}>{opt.title}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Microphone Selection, Instant Permission Re-Request & Live Test */}
              <div className="hw-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <strong>Périphériques Microphone &amp; Réparation d&apos;Autorisation</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-chip"
                      onClick={async () => {
                        const res = await onRetryMicrophone?.();
                        refreshDeviceList();
                        setMicRepairNotice(
                          res?.ok
                            ? `✓ Microphone actif : ${res.deviceLabel || 'Connecté'}`
                            : res?.error || 'Autorisez le micro dans la fenêtre système.'
                        );
                      }}
                    >
                      <Mic size={12} /> Réinitialiser &amp; Autoriser le Micro
                    </button>
                    {window.mashNative?.isTauri && (
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => window.mashNative?.repairMicrophoneAccess?.(true)}
                      >
                        Confidentialité Micro Windows
                      </button>
                    )}
                  </div>
                </div>

                {(micState?.status === 'blocked' || micState?.status === 'no-device' || micRepairNotice) && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: micRepairNotice.startsWith('✓')
                        ? 'var(--emerald-bg)'
                        : 'rgba(232, 168, 73, 0.12)',
                      border: '1px solid var(--gold-border)',
                      fontSize: 12,
                      color: micRepairNotice.startsWith('✓') ? '#6ce0ad' : 'var(--gold-bright)',
                    }}
                  >
                    {micRepairNotice || micState?.error}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field-group">
                    <label className="field-label">Microphone d&apos;entrée (Opus 48 kHz Stéréo)</label>
                    <select
                      className="mash-input"
                      value={streamSettings.audioInputId || ''}
                      onChange={(e) => onUpdateStreamSettings({ audioInputId: e.target.value })}
                    >
                      <option value="">Microphone par défaut du système</option>
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
                </div>

                {/* Live Voice & Keyboard Suppression Meter */}
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <button
                    type="button"
                    className={testingMic ? 'dock-action-btn danger' : 'btn-gold-cta'}
                    style={{ padding: '7px 14px', fontSize: 12, flexShrink: 0 }}
                    onClick={handleStartMicTest}
                  >
                    {testingMic ? 'Arrêter le test' : 'Tester mon micro & MashKrisp'}
                  </button>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span>
                        {testingMic
                          ? micMeter.voiceActive
                            ? '🟢 Voix détectée — transmise clairement'
                            : '🛡️ Bruit / Clavier filtré par MashKrisp'
                          : ' Tapez au clavier pendant le test pour vérifier le filtrage MashKrisp™'}
                      </span>
                      {testingMic && micMeter.suppressedDb > 0 && (
                        <span style={{ fontFamily: 'var(--font-mono)', color: '#48c78e' }}>
                          -{micMeter.suppressedDb} dB bruit filtré
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 99,
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round((testingMic ? micMeter.outputLevel : 0) * 100)}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #48c78e, #f5c26b)',
                          transition: 'width 80ms linear',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Discord-Style Call Ringtones & Event Sounds */}
              <div className="hw-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Music size={17} color="#f5c26b" />
                    <strong>Musiques d&apos;Appels &amp; Sons d&apos;Événements (Style Discord)</strong>
                  </div>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => handleUpdateSfx({ enabled: !sfxConfig.enabled })}
                  >
                    {sfxConfig.enabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                    {sfxConfig.enabled ? 'Sons Activés' : 'Sons Coupés'}
                  </button>
                </div>

                <div className="field-group">
                  <div className="field-label">
                    <span>Volume des sonneries &amp; notifications</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                      {Math.round((sfxConfig.volume ?? 0.75) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="range-slider"
                    value={Math.round((sfxConfig.volume ?? 0.75) * 100)}
                    onChange={(e) => handleUpdateSfx({ volume: Number(e.target.value) / 100 })}
                  />
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input
                      type="checkbox"
                      checked={sfxConfig.callMusic !== false}
                      onChange={(e) => handleUpdateSfx({ callMusic: e.target.checked })}
                      style={{ accentColor: 'var(--gold-primary)' }}
                    />
                    Musique d&apos;appel entrant &amp; sortant
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input
                      type="checkbox"
                      checked={sfxConfig.messageSounds !== false}
                      onChange={(e) => handleUpdateSfx({ messageSounds: e.target.checked })}
                      style={{ accentColor: 'var(--gold-primary)' }}
                    />
                    Messages &amp; Demandes d&apos;amis
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input
                      type="checkbox"
                      checked={sfxConfig.voiceSounds !== false}
                      onChange={(e) => handleUpdateSfx({ voiceSounds: e.target.checked })}
                      style={{ accentColor: 'var(--gold-primary)' }}
                    />
                    Rejoindre / Quitter vocal, Mute &amp; Stream
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => mashSounds.playIncomingRingPhrase()}
                  >
                    🎵 Tester Sonnerie Entrante
                  </button>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => mashSounds.playOutgoingRingPhrase()}
                  >
                    📞 Tester Musique d&apos;Appel Sortant
                  </button>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => mashSounds.messageIn()}
                  >
                    💬 Tester Son Message
                  </button>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => mashSounds.friendRequest()}
                  >
                    ✨ Tester Demande d&apos;Ami
                  </button>
                </div>
              </div>
            </>
          )}

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
                  <span>3. Allocation Mémoire RAM Maximale</span>
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
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>4. Threads CPU &amp; Priorité Système</span>
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
                      Coupe automatiquement le shader 3D Schwarzschild dès qu&apos;un jeu (MashClient,
                      Minecraft, Valorant, CS2...) est détecté, tout en gardant le flux WebRTC fluide à
                      60/120 FPS.
                    </div>
                  </div>
                  <button type="button" className="btn-chip" onClick={onToggleSimulatedGame}>
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
              </div>

              <div className="hw-card">
                <div className="field-label">
                  <span>Résolution &amp; Cadence FPS des Streams P2P</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
                    {normalizeResolutionKey(streamSettings.resolution)} @ {streamSettings.fps} FPS •{' '}
                    {((streamSettings.maxBitrateKbps || 10500) / 1000).toFixed(1)} Mbps
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', minWidth: 74 }}>
                      Résolution :
                    </span>
                    {STREAM_RESOLUTIONS.map((res) => (
                      <button
                        key={res}
                        type="button"
                        className={`preset-pill ${normalizeResolutionKey(streamSettings.resolution) === res ? 'selected' : ''}`}
                        onClick={() =>
                          onUpdateStreamSettings({
                            resolution: res,
                            ...(streamSettings.customBitrate
                              ? {}
                              : {
                                  maxBitrateKbps: computeRecommendedBitrateKbps(
                                    res,
                                    streamSettings.fps
                                  ),
                                }),
                          })
                        }
                      >
                        {res}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', minWidth: 74 }}>
                      Fluidité :
                    </span>
                    {STREAM_FPS_OPTIONS.map((fps) => (
                      <button
                        key={fps}
                        type="button"
                        className={`preset-pill ${Number(streamSettings.fps) === fps ? 'selected' : ''}`}
                        onClick={() =>
                          onUpdateStreamSettings({
                            fps,
                            ...(streamSettings.customBitrate
                              ? {}
                              : {
                                  maxBitrateKbps: computeRecommendedBitrateKbps(
                                    streamSettings.resolution,
                                    fps
                                  ),
                                }),
                          })
                        }
                      >
                        {fps} FPS
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 6 }}>
                  <div className="field-label">
                    <span>Débit Vidéo Maximum (Bitrate P2P)</span>
                    <button
                      type="button"
                      className="btn-chip"
                      style={{ fontSize: 10.5, padding: '2px 8px' }}
                      onClick={() =>
                        onUpdateStreamSettings({
                          customBitrate: false,
                          maxBitrateKbps: computeRecommendedBitrateKbps(
                            streamSettings.resolution,
                            streamSettings.fps
                          ),
                        })
                      }
                    >
                      Auto Recommandé
                    </button>
                  </div>
                  <input
                    type="range"
                    min={2000}
                    max={45000}
                    step={500}
                    className="range-slider"
                    value={streamSettings.maxBitrateKbps || 10500}
                    onChange={(e) =>
                      onUpdateStreamSettings({
                        customBitrate: true,
                        maxBitrateKbps: Number(e.target.value),
                      })
                    }
                  />
                </div>

                <div
                  style={{
                    marginTop: 4,
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'rgba(72, 199, 142, 0.08)',
                    border: '1px solid rgba(72, 199, 142, 0.35)',
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                  }}
                >
                  ✓ <strong style={{ color: '#6ce0ad' }}>Anti-Freeze Minecraft &amp; Zéro Barre en Jeu actifs</strong> : la barre flottante « partage votre écran » est automatiquement masquée sous Windows et le mode Anti-Occlusion / Anti-EcoQoS empêche le gel d&apos;image sur Minecraft (sélectionnez « Écran entier » en Plein Écran F11 OpenGL).
                </div>
              </div>
            </>
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

              {secData.isAdmin !== false ? (
                <div className="hw-card">
                  <strong>Tokens émis &amp; Révocation en Temps Réel (Admin uniquement)</strong>
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
                            >
                              <Trash2 size={13} /> Révoquer
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="hw-card" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <strong>Registre des Tokens &amp; Révocation (Accès Administrateur Requis)</strong>
                  <div>
                    Votre session utilise le rang <code>{secData.currentTier || 'MEMBER'}</code>.
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'updater' && (
            <div className="hw-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>
                    Dépôt Open-Source : {updaterStatus?.owner || 'MyMasha'}/{updaterStatus?.repo || 'MashVoice'}
                  </strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Version installée : v{updaterStatus?.currentVersion || '1.0.6'} • Signature Ed25519 (
                    {updaterStatus?.updaterKeyId || 'F6A9F0FBF91D7ADE'})
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn-chip" onClick={onOpenChangelog}>
                    <Sparkles size={12} /> Voir le Changelog
                  </button>
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
                  'Auto-Updater 1-Clic sans SmartScreen prêt (remplacement atomique .exe + ouverture auto du Changelog au redémarrage).'}
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
                    ? `Téléchargement & Installation (${updaterStatus?.downloadPercent || 0}%)...`
                    : `Installer v${updaterStatus.lastStatus.latestVersion} & Redémarrer`}
                </button>
              ) : (
                <a
                  href={
                    updaterStatus?.publicReleasesUrl ||
                    'https://github.com/MyMasha/MashVoice/releases/latest'
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="btn-gold-cta"
                  style={{ textDecoration: 'none' }}
                >
                  <ExternalLink size={15} /> Voir les Releases Officielles sur GitHub (MyMasha/MashVoice)
                </a>
              )}
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
