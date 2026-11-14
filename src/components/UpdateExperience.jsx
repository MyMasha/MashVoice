import React, { useEffect } from 'react';
import { Download, RefreshCw, Sparkles, CheckCircle2, X, ExternalLink, ShieldCheck } from 'lucide-react';
import { mashSounds } from '../lib/soundEffects.js';

/**
 * Golden MashClient-style Topbar Pill (`Mise à jour vX.Y.Z` -> `Téléchargement XX%` -> `Relancer`)
 */
export function UpdateTopPill({ updaterStatus, installing, onInstallUpdate, onOpenChangelog }) {
  const status = updaterStatus?.lastStatus;
  const installState = updaterStatus?.installState || 'idle';
  const pct = updaterStatus?.downloadPercent || 0;
  const isAvailable = Boolean(status?.updateAvailable);
  const isDownloading = installing || installState === 'downloading';
  const isReadyRestart = installState === 'ready_to_restart' || installState === 'restarting';

  if (!isAvailable && !isDownloading && !isReadyRestart) {
    return (
      <button
        type="button"
        className="changelog-mini-pill"
        onClick={onOpenChangelog}
        title="Afficher les nouveautés de cette version (Changelog)"
      >
        <Sparkles size={11} />
        <span>Quoi de neuf v{updaterStatus?.currentVersion || '1.0.6'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`update-pill ${isDownloading ? 'downloading' : ''} ${isReadyRestart ? 'ready' : ''}`}
      onClick={onInstallUpdate}
      disabled={isDownloading}
      title="Cliquer pour télécharger, installer automatiquement sans pop-up SmartScreen et redémarrer MashVoice"
    >
      {isDownloading && (
        <span className="update-pill-progress" style={{ width: `${Math.max(6, pct)}%` }} />
      )}
      <span className="update-pill-content">
        {isDownloading ? (
          <>
            <RefreshCw size={12} className="spin-icon" />
            <span>Installation {pct}%...</span>
          </>
        ) : isReadyRestart ? (
          <>
            <Sparkles size={12} />
            <span>Relancer v{status?.latestVersion || ''}</span>
          </>
        ) : (
          <>
            <Download size={12} />
            <span>Mise à jour v{status?.latestVersion}</span>
          </>
        )}
      </span>
    </button>
  );
}

/**
 * Compact Floating Bottom-Right Update Notification Popup
 * Clicking installs the update in-place & restarts into the Changelog!
 */
export function UpdateFloatingPopup({
  updaterStatus,
  dismissed,
  installing,
  errorMsg,
  onInstallUpdate,
  onDismiss,
}) {
  const status = updaterStatus?.lastStatus;
  const installState = updaterStatus?.installState || 'idle';
  const pct = updaterStatus?.downloadPercent || 0;
  const isDownloading = installing || installState === 'downloading';
  const isReady = installState === 'ready_to_restart' || installState === 'restarting';

  useEffect(() => {
    if (status?.updateAvailable && !dismissed) {
      mashSounds.updateAvailable();
    }
  }, [status?.updateAvailable, status?.latestVersion]);

  if (dismissed && !isDownloading && !isReady) return null;
  if (!status?.updateAvailable && !isDownloading && !isReady) return null;

  return (
    <div className="update-floating-toast" role="region" aria-label="Mise à jour MashVoice disponible">
      <div className="update-toast-glow" />
      <div className="update-toast-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="update-toast-icon">
            {isDownloading ? <RefreshCw size={15} className="spin-icon" /> : <Download size={15} />}
          </span>
          <div>
            <div className="update-toast-title">
              {isDownloading
                ? `Mise à jour v${status?.latestVersion || ''} en cours...`
                : isReady
                  ? 'Mise à jour installée — Redémarrage...'
                  : `Nouvelle version v${status?.latestVersion} disponible !`}
            </div>
            <div className="update-toast-sub">
              {isDownloading
                ? `Remplacement atomique sans SmartScreen (${pct}%)`
                : 'Clique pour installer automatiquement et voir le Changelog'}
            </div>
          </div>
        </div>
        {!isDownloading && (
          <button
            type="button"
            className="win-btn"
            onClick={onDismiss}
            aria-label="Masquer la notification"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {isDownloading && (
        <div className="update-toast-bar">
          <div className="update-toast-bar-fill" style={{ width: `${Math.max(8, pct)}%` }} />
        </div>
      )}

      {errorMsg && (
        <div style={{ fontSize: 11, color: '#ff9494', lineHeight: 1.35 }}>{errorMsg}</div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-gold-cta update-toast-cta"
          disabled={isDownloading}
          onClick={onInstallUpdate}
        >
          {isDownloading ? (
            <>Téléchargement {pct}%...</>
          ) : isReady ? (
            <>Redémarrer maintenant</>
          ) : (
            <>
              <Download size={14} /> Installer &amp; Redémarrer
            </>
          )}
        </button>
        {errorMsg && (
          <a
            href={status?.publicReleasesUrl || 'https://github.com/MyMasha/MashVoice/releases/latest'}
            target="_blank"
            rel="noreferrer"
            className="btn-chip"
            style={{ textDecoration: 'none', padding: '8px 10px' }}
          >
            <ExternalLink size={12} /> GitHub
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Post-Update Changelog Modal (auto-opens right after restart with `--after-update` or version bump)
 */
export function ChangelogModal({ changelog, currentVersion, onClose }) {
  useEffect(() => {
    if (changelog) {
      mashSounds.changelogFanfare();
    }
  }, [changelog?.version]);

  if (!changelog) return null;

  const lines = String(changelog.notes || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const renderFormattedLine = (text, idx) => {
    if (text.startsWith('### ') || text.startsWith('## ')) {
      return (
        <h4 key={idx} className="changelog-section-heading">
          {text.replace(/^#{2,3}\s+/, '')}
        </h4>
      );
    }
    const clean = text.replace(/^[-*]\s+/, '');
    const parts = clean.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <li key={idx} className="changelog-item">
        <span className="changelog-bullet" />
        <span>
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={i} style={{ color: 'var(--gold-ivory)' }}>
                  {part.slice(2, -2)}
                </strong>
              );
            }
            if (part.startsWith('`') && part.endsWith('`')) {
              return (
                <code key={i} className="changelog-code">
                  {part.slice(1, -1)}
                </code>
              );
            }
            return <React.Fragment key={i}>{part}</React.Fragment>;
          })}
        </span>
      </li>
    );
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 160 }} onClick={onClose}>
      <div className="changelog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="changelog-hero">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="singularity-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={11} /> MISE À JOUR INSTALLÉE • v{changelog.version || currentVersion}
            </span>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
          <h2 className="changelog-title">
            {changelog.title || `Nouveautés MashVoice Singularity v${changelog.version || currentVersion}`}
          </h2>
          <div className="changelog-meta">
            <CheckCircle2 size={13} color="#48c78e" />
            <span>Binaire signé vérifié (Ed25519) • Relais Zero-IP zyntra.win actif</span>
          </div>
        </div>

        <ul className="changelog-list">{lines.map((line, idx) => renderFormattedLine(line, idx))}</ul>

        <div className="changelog-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <ShieldCheck size={14} color="#f5c26b" />
            <span>Open Source MIT • MyMasha/MashVoice</span>
          </div>
          <button type="button" className="btn-gold-cta" style={{ padding: '9px 22px' }} onClick={onClose}>
            Super, découvrir MashVoice !
          </button>
        </div>
      </div>
    </div>
  );
}
