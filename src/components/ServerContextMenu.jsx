import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Image as ImageIcon,
  LogOut,
  Settings,
  Shield,
  Smile,
  Sticker,
  UserPen,
  UserPlus,
  BellOff,
  Bell,
  ArrowUpDown,
  CheckCheck,
  X,
} from 'lucide-react';

/**
 * Full Discord-Style Server Right-Click Context Menu (all 16 items from reference):
 * 1. Marquer comme lu
 * 2. Inviter sur le serveur
 * 3. Paramètres du serveur
 * ---
 * 4. Rendre le serveur muet › (submenu)
 * 5. Paramètres de notification › (@mentions seulement)
 * 6. Masquer les salons muets [ ]
 * 7. Montrer tous les salons [✓]
 * ---
 * 8. Paramètres de confidentialité
 * 9. Modifier le profil par serveur
 * ---
 * 10. Download Emojis
 * 11. Download Stickers
 * ---
 * 12. Déplacer vers... › (submenu)
 * ---
 * 13. Quitter le serveur (danger red)
 * ---
 * 14. View Icon
 * 15. View Banner
 * ---
 * 16. Copier l'identifiant du serveur
 */
export default function ServerContextMenu({
  menu, // { x, y, server }
  prefs, // { mutedUntil, notifyLevel, hideMutedChannels, showAllChannels }
  onUpdatePrefs,
  onMarkAsRead,
  onCopyInvite,
  onOpenSettings,
  onMoveServer,
  onDownloadAssets,
  onLeaveServer,
  onViewMedia,
  onCopyServerId,
  onClose,
}) {
  const [submenu, setSubmenu] = useState(null); // 'mute' | 'notif' | 'move' | null

  useEffect(() => {
    const handleOutside = () => onClose();
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('click', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  if (!menu?.server) return null;

  const { server } = menu;
  const menuWidth = 262;
  const menuHeight = 520;
  const clampedX =
    typeof window !== 'undefined' ? Math.min(menu.x, window.innerWidth - menuWidth - 16) : menu.x;
  const clampedY =
    typeof window !== 'undefined'
      ? Math.max(12, Math.min(menu.y, window.innerHeight - menuHeight - 12))
      : menu.y;
  const flipSubmenuLeft =
    typeof window !== 'undefined' && clampedX + menuWidth + 220 > window.innerWidth;

  const isMuted =
    prefs?.mutedUntil === 'forever' ||
    (typeof prefs?.mutedUntil === 'number' && prefs.mutedUntil > Date.now());
  const notifyLevel = prefs?.notifyLevel || 'mentions';
  const notifyLabelMap = {
    all: 'Tous les messages',
    mentions: '@mentions seulement',
    none: 'Rien (Silencieux)',
  };

  return (
    <div
      className="ctx-menu-shell"
      style={{ left: clampedX, top: clampedY }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Group 1: Read, Invite, Server Settings */}
      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onMarkAsRead(server);
          onClose();
        }}
      >
        <span>Marquer comme lu</span>
        <CheckCheck size={14} className="ctx-icon" />
      </button>

      <button
        type="button"
        className="ctx-item highlight-invite"
        onClick={() => {
          onCopyInvite(server);
          onClose();
        }}
      >
        <span>Inviter sur le serveur</span>
        <UserPlus size={14} className="ctx-icon" />
      </button>

      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onOpenSettings(server, 'overview');
          onClose();
        }}
      >
        <span>Paramètres du serveur</span>
        <Settings size={14} className="ctx-icon" />
      </button>

      <div className="ctx-sep" />

      {/* Group 2: Mute, Notifications, Channel Visibility */}
      <div
        className="ctx-submenu-wrap"
        onMouseEnter={() => setSubmenu('mute')}
        onMouseLeave={() => setSubmenu((s) => (s === 'mute' ? null : s))}
      >
        <button
          type="button"
          className="ctx-item"
          onClick={() => {
            onUpdatePrefs(server.id, { mutedUntil: isMuted ? null : 'forever' });
            onClose();
          }}
        >
          <span>{isMuted ? 'Réactiver le serveur' : 'Rendre le serveur muet'}</span>
          <ChevronRight size={14} className="ctx-icon" />
        </button>

        {submenu === 'mute' && (
          <div className={`ctx-submenu ${flipSubmenuLeft ? 'left' : ''}`}>
            {isMuted && (
              <button
                type="button"
                className="ctx-item"
                onClick={() => {
                  onUpdatePrefs(server.id, { mutedUntil: null });
                  onClose();
                }}
              >
                <span>Réactiver maintenant</span>
                <Bell size={13} />
              </button>
            )}
            {[
              { label: 'Pendant 15 minutes', ms: 15 * 60 * 1000 },
              { label: 'Pendant 1 heure', ms: 60 * 60 * 1000 },
              { label: 'Pendant 8 heures', ms: 8 * 60 * 60 * 1000 },
              { label: 'Pendant 24 heures', ms: 24 * 60 * 60 * 1000 },
              { label: "Jusqu'à ce que je le réactive", ms: 'forever' },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                className="ctx-item"
                onClick={() => {
                  onUpdatePrefs(server.id, {
                    mutedUntil: opt.ms === 'forever' ? 'forever' : Date.now() + opt.ms,
                  });
                  onClose();
                }}
              >
                <span>{opt.label}</span>
                <BellOff size={13} className="ctx-icon" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="ctx-submenu-wrap"
        onMouseEnter={() => setSubmenu('notif')}
        onMouseLeave={() => setSubmenu((s) => (s === 'notif' ? null : s))}
      >
        <button type="button" className="ctx-item with-sub">
          <div className="ctx-item-col">
            <span>Paramètres de notification</span>
            <small>{notifyLabelMap[notifyLevel]}</small>
          </div>
          <ChevronRight size={14} className="ctx-icon" />
        </button>

        {submenu === 'notif' && (
          <div className={`ctx-submenu ${flipSubmenuLeft ? 'left' : ''}`}>
            {[
              { id: 'all', label: 'Tous les messages' },
              { id: 'mentions', label: '@mentions seulement' },
              { id: 'none', label: 'Rien (Silencieux)' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="ctx-item"
                onClick={() => {
                  onUpdatePrefs(server.id, { notifyLevel: opt.id });
                  onClose();
                }}
              >
                <span>{opt.label}</span>
                <span className={`ctx-radio ${notifyLevel === opt.id ? 'checked' : ''}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="ctx-item"
        onClick={() =>
          onUpdatePrefs(server.id, { hideMutedChannels: !prefs?.hideMutedChannels })
        }
      >
        <span>Masquer les salons muets</span>
        <span className={`ctx-checkbox ${prefs?.hideMutedChannels ? 'checked' : ''}`}>
          {prefs?.hideMutedChannels && <Check size={11} strokeWidth={3} />}
        </span>
      </button>

      <button
        type="button"
        className="ctx-item"
        onClick={() =>
          onUpdatePrefs(server.id, { showAllChannels: prefs?.showAllChannels === false })
        }
      >
        <span>Montrer tous les salons</span>
        <span className={`ctx-checkbox ${prefs?.showAllChannels !== false ? 'checked' : ''}`}>
          {prefs?.showAllChannels !== false && <Check size={11} strokeWidth={3} />}
        </span>
      </button>

      <div className="ctx-sep" />

      {/* Group 3: Privacy & Per-Server Profile */}
      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onOpenSettings(server, 'privacy');
          onClose();
        }}
      >
        <span>Paramètres de confidentialité</span>
        <Shield size={14} className="ctx-icon" />
      </button>

      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onOpenSettings(server, 'server-profile');
          onClose();
        }}
      >
        <span>Modifier le profil par serveur</span>
        <UserPen size={14} className="ctx-icon" />
      </button>

      <div className="ctx-sep" />

      {/* Group 4: Download Emojis & Stickers */}
      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onDownloadAssets(server, 'emojis');
          onClose();
        }}
      >
        <span>Download Emojis</span>
        <Smile size={14} className="ctx-icon" />
      </button>

      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onDownloadAssets(server, 'stickers');
          onClose();
        }}
      >
        <span>Download Stickers</span>
        <Sticker size={14} className="ctx-icon" />
      </button>

      <div className="ctx-sep" />

      {/* Group 5: Move Server in Rail */}
      <div
        className="ctx-submenu-wrap"
        onMouseEnter={() => setSubmenu('move')}
        onMouseLeave={() => setSubmenu((s) => (s === 'move' ? null : s))}
      >
        <button type="button" className="ctx-item">
          <span>Déplacer vers...</span>
          <ChevronRight size={14} className="ctx-icon" />
        </button>

        {submenu === 'move' && (
          <div className={`ctx-submenu ${flipSubmenuLeft ? 'left' : ''}`}>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                onMoveServer(server.id, 'top');
                onClose();
              }}
            >
              <span>Tout en haut</span>
              <ArrowUpDown size={13} className="ctx-icon" />
            </button>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                onMoveServer(server.id, 'up');
                onClose();
              }}
            >
              <span>Monter d&apos;un cran</span>
            </button>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                onMoveServer(server.id, 'down');
                onClose();
              }}
            >
              <span>Descendre d&apos;un cran</span>
            </button>
            <button
              type="button"
              className="ctx-item"
              onClick={() => {
                onMoveServer(server.id, 'bottom');
                onClose();
              }}
            >
              <span>Tout en bas</span>
            </button>
          </div>
        )}
      </div>

      <div className="ctx-sep" />

      {/* Group 6: Leave Server (Red) */}
      <button
        type="button"
        className="ctx-item danger"
        onClick={() => {
          onLeaveServer(server);
          onClose();
        }}
      >
        <span>Quitter le serveur</span>
        <LogOut size={14} className="ctx-icon" />
      </button>

      <div className="ctx-sep" />

      {/* Group 7: View Icon & View Banner */}
      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onViewMedia(server, 'icon');
          onClose();
        }}
      >
        <span>View Icon</span>
        <Eye size={14} className="ctx-icon" />
      </button>

      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onViewMedia(server, 'banner');
          onClose();
        }}
      >
        <span>View Banner</span>
        <ImageIcon size={14} className="ctx-icon" />
      </button>

      <div className="ctx-sep" />

      {/* Group 8: Copy Server ID */}
      <button
        type="button"
        className="ctx-item"
        onClick={() => {
          onCopyServerId(server);
          onClose();
        }}
      >
        <span>Copier l&apos;identifiant du serveur</span>
        <span className="ctx-id-badge">ID</span>
      </button>
    </div>
  );
}

/**
 * Lightbox Viewer for `View Icon` & `View Banner`
 */
export function ServerMediaViewerModal({ viewer, onOpenEdit, onClose }) {
  if (!viewer?.server) return null;
  const { server, kind } = viewer;
  const isBanner = kind === 'banner';
  const rawUrl = isBanner ? server.bannerUrl : server.iconUrl;

  const bannerPresets = {
    'singularity-gold': 'linear-gradient(135deg, #1b1307 0%, #5c3a10 48%, #f5c26b 100%)',
    'void-violet': 'linear-gradient(135deg, #0b0718 0%, #2b1854 55%, #7d56f4 100%)',
    'cyber-emerald': 'linear-gradient(135deg, #061712 0%, #114b3a 55%, #48c78e 100%)',
    'crimson-nova': 'linear-gradient(135deg, #1b070a 0%, #5c1622 55%, #e25555 100%)',
  };
  const bgStyle =
    rawUrl && (rawUrl.startsWith('http') || rawUrl.startsWith('data:'))
      ? { backgroundImage: `url(${rawUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: bannerPresets[server.banner] || bannerPresets['singularity-gold'] };

  return (
    <div className="modal-backdrop" style={{ zIndex: 150 }} onClick={onClose}>
      <div
        className="hw-card"
        style={{
          width: isBanner ? 580 : 380,
          maxWidth: '94vw',
          background: '#0b0c12',
          border: '1px solid var(--border-strong)',
          padding: 20,
          boxShadow: 'var(--shadow-elevated)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong>
            {isBanner ? `Bannière de ${server.name}` : `Icône de ${server.name}`}
          </strong>
          <button type="button" className="win-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {isBanner ? (
          <div
            style={{
              width: '100%',
              height: 210,
              borderRadius: 14,
              border: '1px solid var(--border-strong)',
              display: 'flex',
              alignItems: 'flex-end',
              padding: 16,
              ...bgStyle,
            }}
          >
            <span className="tile-badge">{server.name}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', padding: '18px 0' }}>
            {rawUrl ? (
              <img
                src={rawUrl}
                alt={server.name}
                style={{
                  width: 168,
                  height: 168,
                  borderRadius: 36,
                  objectFit: 'cover',
                  border: '2px solid var(--gold-border)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 168,
                  height: 168,
                  borderRadius: 36,
                  background: 'linear-gradient(145deg, #1b1e2b, #0c0e15)',
                  border: '2px solid var(--gold-border)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: 48,
                  fontWeight: 700,
                  color: 'var(--gold-bright)',
                }}
              >
                {server.shortName}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            className="btn-chip"
            onClick={() => {
              onClose();
              onOpenEdit(server);
            }}
          >
            Personnaliser dans Paramètres Serveur
          </button>
          {rawUrl && (
            <a
              href={rawUrl}
              download={`${server.shortName}-${kind}.png`}
              target="_blank"
              rel="noreferrer"
              className="btn-gold-cta"
              style={{ padding: '7px 14px', fontSize: 12, textDecoration: 'none' }}
            >
              <Download size={13} /> Télécharger
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
