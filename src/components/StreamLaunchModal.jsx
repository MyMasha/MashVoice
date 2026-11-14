import React, { useState } from 'react';
import { MonitorUp, X, Cpu, Gamepad2, EyeOff, Zap } from 'lucide-react';
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
  const [maintainFramerate, setMaintainFramerate] = useState(
    streamSettings?.maintainFramerate !== false
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
          gap: 15,
        }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleConfirm}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(232, 168, 73, 0.16)',
                border: '1px solid var(--gold-border)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--gold-bright)',
              }}
            >
              <MonitorUp size={18} />
            </div>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, margin: 0 }}>
                Configurer ton Stream P2P
              </h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Zero-Copy GPU • Audio du jeu inclus • Sans barre flottante en jeu
              </div>
            </div>
          </div>

          <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </div>

        {/* 1. Resolution Picker: 720p, 1080p, 2K, 4K */}
        <div className="hw-card" style={{ padding: 14, gap: 10 }}>
          <div className="field-label" style={{ marginBottom: 0 }}>
            <span>Qualité / Résolution d&apos;image</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
              {resMeta.sub}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {STREAM_RESOLUTIONS.map((res) => {
              const info = STREAM_RESOLUTION_MAP[res];
              const selected = resolution === res;
              return (
                <button
                  key={res}
                  type="button"
                  className={`hw-choice ${selected ? 'selected' : ''}`}
                  style={{ padding: '10px 8px', textAlign: 'center', alignItems: 'center' }}
                  onClick={() => setResolution(res)}
                >
                  <strong style={{ fontSize: 14.5 }}>{res}</strong>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {info.w}×{info.h}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Frame Rate Picker: 15, 30, 60, 120 FPS */}
        <div className="hw-card" style={{ padding: 14, gap: 10 }}>
          <div className="field-label" style={{ marginBottom: 0 }}>
            <span>Fluidité (Images par seconde)</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold-bright)' }}>
              {fps} FPS • ~{(recommendedKbps / 1000).toFixed(1)} Mbps
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {STREAM_FPS_OPTIONS.map((val) => {
              const selected = fps === val;
              const desc =
                val === 15
                  ? 'Éco'
                  : val === 30
                    ? 'Standard'
                    : val === 60
                      ? 'Gaming'
                      : 'Esport';
              return (
                <button
                  key={val}
                  type="button"
                  className={`hw-choice ${selected ? 'selected' : ''}`}
                  style={{ padding: '10px 8px', textAlign: 'center', alignItems: 'center' }}
                  onClick={() => setFps(val)}
                >
                  <strong style={{ fontSize: 14 }}>{val} FPS</strong>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Hardware Codec & Frame Pacing */}
        <div className="hw-card" style={{ padding: 12, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
              <Cpu size={14} color="#f5c26b" /> Encodeur Matériel
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {['H264', 'AV1', 'VP9'].map((codec) => (
                <button
                  key={codec}
                  type="button"
                  className={`preset-pill ${preferredCodec === codec ? 'selected' : ''}`}
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => setPreferredCodec(codec)}
                >
                  {codec === 'H264' ? 'H.264 NVENC' : codec}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={maintainFramerate}
              onChange={(e) => setMaintainFramerate(e.target.checked)}
              style={{ accentColor: 'var(--gold-primary)' }}
            />
            <span>Priorité absolue aux FPS fluides en jeu (Anti-Freeze OpenGL / DirectX)</span>
          </label>
        </div>

        {/* 4. In-Game Overlay Removal + Minecraft Fullscreen Anti-Freeze Tip */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(72, 199, 142, 0.09)',
            border: '1px solid rgba(72, 199, 142, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#6ce0ad', fontWeight: 600 }}>
            <EyeOff size={14} />
            <span>Barre « partage votre écran » masquée automatiquement en jeu</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            <Gamepad2 size={14} color="#f5c26b" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>
                {activeGameTitle ? `${activeGameTitle} détecté : ` : 'Astuce Minecraft / OpenGL : '}
              </strong>
              si tu joues en <strong>Plein Écran (F11)</strong>, sélectionne l&apos;onglet{' '}
              <strong style={{ color: 'var(--gold-bright)' }}>« Écran entier »</strong> dans la
              fenêtre suivante pour éviter tout blocage de fenêtre OpenGL.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-chip" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-gold-cta" style={{ padding: '10px 20px' }}>
            <Zap size={15} /> Passer en Direct ({resolution} • {fps} FPS)
          </button>
        </div>
      </form>
    </div>
  );
}
