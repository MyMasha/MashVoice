import React, { useState } from 'react';
import { MonitorUp, X, Cpu, Gamepad2, EyeOff, Zap, ShieldCheck } from 'lucide-react';
import {
  STREAM_RESOLUTIONS,
  STREAM_FPS_OPTIONS,
  STREAM_RESOLUTION_MAP,
  computeRecommendedBitrateKbps,
  normalizeResolutionKey,
} from '../lib/p2pEngine.js';

export default function StreamLaunchModal({
  streamSettings,
  activeGameTitle,
  onStartStream,
  onClose,
}) {
  const [resolution, setResolution] = useState(
    normalizeResolutionKey(streamSettings?.resolution || '1080p')
  );
  const [fps, setFps] = useState(Number(streamSettings?.fps) || 60);
  const [preferredCodec, setPreferredCodec] = useState(streamSettings?.preferredCodec || 'H264');
  // false = 'maintain-resolution' (Netteté 1:1 Anti-Flou, recommended so fast games like Minecraft never drop to 360p!)
  const [maintainFramerate, setMaintainFramerate] = useState(
    Boolean(streamSettings?.maintainFramerate)
  );

  const recommendedKbps = computeRecommendedBitrateKbps(resolution, fps);
  const resMeta = STREAM_RESOLUTION_MAP[resolution] || STREAM_RESOLUTION_MAP['1080p'];

  const handleConfirm = (e) => {
    e.preventDefault();
    onStartStream({
      resolution,
      fps,
      preferredCodec,
      maintainFramerate,
      customBitrate: false,
      maxBitrateKbps: recommendedKbps,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="gatekeeper-card"
        style={{
          width: 520,
          maxWidth: '94vw',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleConfirm}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: 'var(--gold-muted)',
                border: '1px solid var(--gold-border)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--gold-primary)',
                flexShrink: 0,
              }}
            >
              <MonitorUp size={17} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
                Partager un jeu ou écran
              </h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Capture GPU Zero-Copy · CABAC High Profile · Latence ~25 ms
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '4px 9px',
                borderRadius: 6,
                background: 'var(--gold-muted)',
                color: 'var(--gold-primary)',
                fontWeight: 500,
              }}
            >
              {resolution} · {fps} FPS · ~{(recommendedKbps / 1000).toFixed(1)} Mbps
            </span>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 1. Resolution Picker: 720p, 1080p, 2K, 4K */}
        <div className="hw-card" style={{ padding: 14, gap: 9 }}>
          <div className="field-label">
            <span>Résolution</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11 }}>
              {resMeta.sub} ({resMeta.w}×{resMeta.h})
            </span>
          </div>
          <div className="mv-seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {STREAM_RESOLUTIONS.map((res) => (
              <button
                key={res}
                type="button"
                className={`mv-seg-btn ${resolution === res ? 'active' : ''}`}
                style={{ fontFamily: 'var(--font-mono)', padding: '8px 6px' }}
                onClick={() => setResolution(res)}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Frame Rate Picker: 15, 30, 60, 120 FPS */}
        <div className="hw-card" style={{ padding: 14, gap: 9 }}>
          <div className="field-label">
            <span>Fluidité</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11 }}>
              Cible {fps} images/s
            </span>
          </div>
          <div className="mv-seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {STREAM_FPS_OPTIONS.map((val) => (
              <button
                key={val}
                type="button"
                className={`mv-seg-btn ${fps === val ? 'active' : ''}`}
                style={{ fontFamily: 'var(--font-mono)', padding: '8px 6px' }}
                onClick={() => setFps(val)}
              >
                {val} FPS
              </button>
            ))}
          </div>
        </div>

        {/* 3. Hardware Codec & Anti-Blur Sharpness Mode */}
        <div className="hw-card" style={{ padding: 12, gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}>
              <Cpu size={14} color="var(--text-secondary)" /> Encodeur matériel
            </span>
            <div className="mv-seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }}>
              {['H264', 'AV1', 'VP9'].map((codec) => (
                <button
                  key={codec}
                  type="button"
                  className={`mv-seg-btn ${preferredCodec === codec ? 'active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}
                  onClick={() => setPreferredCodec(codec)}
                >
                  {codec === 'H264' ? 'H.264 High' : codec}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="field-label" style={{ fontSize: 11.5 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <ShieldCheck size={13} color="var(--emerald)" /> Priorité d&apos;encodage en mouvement rapide
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--emerald)' }}>
                {maintainFramerate ? 'Sous-échantillonnage auto' : ' Pixel 1:1 verrouillé'}
              </span>
            </div>
            <div className="mv-seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <button
                type="button"
                className={`mv-seg-btn ${!maintainFramerate ? 'active' : ''}`}
                style={{ padding: '7px 8px', fontSize: 11.5 }}
                onClick={() => setMaintainFramerate(false)}
              >
                Netteté 1:1 · Anti-Flou
              </button>
              <button
                type="button"
                className={`mv-seg-btn ${maintainFramerate ? 'active' : ''}`}
                style={{ padding: '7px 8px', fontSize: 11.5 }}
                onClick={() => setMaintainFramerate(true)}
              >
                Connexion faible · FPS
              </button>
            </div>
          </div>
        </div>

        {/* 4. In-Game Overlay Removal + Minecraft Fullscreen Anti-Freeze Tip */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 9,
            background: 'rgba(62, 207, 142, 0.07)',
            border: '1px solid rgba(62, 207, 142, 0.22)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            fontSize: 11.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--emerald)', fontWeight: 600 }}>
            <EyeOff size={13} />
            <span>Barre « partage votre écran » masquée automatiquement en jeu</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            <Gamepad2 size={13} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>
                {activeGameTitle ? `${activeGameTitle} détecté : ` : 'Astuce Plein Écran (F11) : '}
              </strong>
              sélectionne l&apos;onglet <strong style={{ color: 'var(--text-primary)' }}>« Écran entier »</strong>{' '}
              dans la fenêtre système suivante pour éviter tout gel OpenGL.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button type="button" className="btn-chip" style={{ padding: '9px 14px' }} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-gold-cta" style={{ padding: '9px 20px' }}>
            <Zap size={14} /> Lancer le Stream P2P ({resolution} · {fps} FPS)
          </button>
        </div>
      </form>
    </div>
  );
}
