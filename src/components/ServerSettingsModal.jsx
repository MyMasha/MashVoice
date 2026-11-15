import React, { useEffect, useRef, useState } from 'react';
import {
  Settings,
  Hash,
  Volume2,
  Radio,
  Shield,
  Smile,
  Users,
  Link2,
  UserPen,
  Trash2,
  LogOut,
  Plus,
  Copy,
  Check,
  Upload,
  Download,
  X,
} from 'lucide-react';

export const SERVER_BANNER_PRESETS = [
  {
    id: 'singularity-gold',
    label: 'Obsidian Ambre',
    css: 'linear-gradient(135deg, #101218 0%, #191612 65%, rgba(229, 169, 82, 0.22) 100%)',
  },
  {
    id: 'void-violet',
    label: 'Obsidian Air',
    css: 'linear-gradient(135deg, #0d1016 0%, #141923 60%, #1f2736 100%)',
  },
  {
    id: 'cyber-emerald',
    label: 'Émeraude Nordique',
    css: 'linear-gradient(135deg, #0d1314 0%, #11211d 65%, rgba(62, 207, 142, 0.2) 100%)',
  },
  {
    id: 'crimson-nova',
    label: 'Bordeaux Solaire',
    css: 'linear-gradient(135deg, #130f12 0%, #241418 65%, rgba(239, 90, 90, 0.22) 100%)',
  },
];

const PERM_LABELS = [
  { id: 'ADMIN', label: 'Administrateur complet' },
  { id: 'MANAGE_SERVER', label: 'Gérer le serveur' },
  { id: 'MANAGE_CHANNELS', label: 'Gérer les salons' },
  { id: 'STREAM_HD', label: 'Stream 720p / 1080p / 2K / 4K • 15–120 FPS' },
];

export default function ServerSettingsModal({
  server,
  initialTab = 'overview',
  me,
  usersMap,
  sessionToken,
  serverPrefs,
  onUpdateServerPrefs,
  onServerUpdated,
  onServerRemoved,
  onDownloadAssets,
  onClose,
}) {
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState(server?.name || '');
  const [shortName, setShortName] = useState(server?.shortName || '');
  const [description, setDescription] = useState(server?.description || '');
  const [banner, setBanner] = useState(server?.banner || 'singularity-gold');
  const [iconUrl, setIconUrl] = useState(server?.iconUrl || '');
  const [bannerUrl, setBannerUrl] = useState(server?.bannerUrl || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Channels form
  const [chName, setChName] = useState('');
  const [chType, setChType] = useState('text');
  const [chQuality, setChQuality] = useState('1080p 60FPS');

  // Roles form
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#f5c26b');
  const [rolePerms, setRolePerms] = useState(['STREAM_HD']);

  // Emojis & Stickers form
  const [assetKind, setAssetKind] = useState('emoji');
  const [assetName, setAssetName] = useState('');
  const [assetSymbol, setAssetSymbol] = useState('⚡');
  const [assetUrl, setAssetUrl] = useState('');

  // Per-server profile & privacy (local preferences)
  const [nickname, setNickname] = useState(serverPrefs?.nickname || '');
  const [serverBio, setServerBio] = useState(serverPrefs?.bio || '');
  const [allowDms, setAllowDms] = useState(serverPrefs?.allowDms !== false);
  const [showActivity, setShowActivity] = useState(serverPrefs?.showActivity !== false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const iconFileRef = useRef(null);
  const bannerFileRef = useRef(null);
  const assetFileRef = useRef(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!server) return;
    setName(server.name || '');
    setShortName(server.shortName || '');
    setDescription(server.description || '');
    setBanner(server.banner || 'singularity-gold');
    setIconUrl(server.iconUrl || '');
    setBannerUrl(server.bannerUrl || '');
  }, [server]);

  if (!server) return null;

  const isOwner = server.ownerId === me?.id;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  const flash = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2800);
  };

  const readFileAsDataUrl = (file, cb) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') cb(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOverview = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          name,
          shortName,
          description,
          banner,
          iconUrl,
          bannerUrl,
        }),
      });
      const data = await res.json();
      if (data.ok && data.server) {
        onServerUpdated(data.server);
        flash('✓ Paramètres du serveur enregistrés !');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!chName.trim()) return;
    const res = await fetch(`/api/servers/${encodeURIComponent(server.id)}/channels`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: chName.trim(),
        type: chType,
        maxQuality: chType !== 'text' ? chQuality : undefined,
      }),
    });
    const data = await res.json();
    if (data.ok && data.server) {
      setChName('');
      onServerUpdated(data.server);
      flash('✓ Salon créé !');
    }
  };

  const handleDeleteChannel = async (channelId) => {
    const res = await fetch(
      `/api/servers/${encodeURIComponent(server.id)}/channels/${encodeURIComponent(channelId)}`,
      { method: 'DELETE', headers: authHeaders }
    );
    const data = await res.json();
    if (data.ok && data.server) {
      onServerUpdated(data.server);
      flash('✓ Salon supprimé.');
    }
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    if (!roleName.trim()) return;
    const res = await fetch(`/api/servers/${encodeURIComponent(server.id)}/roles`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: roleName.trim(),
        color: roleColor,
        permissions: rolePerms,
      }),
    });
    const data = await res.json();
    if (data.ok && data.server) {
      setRoleName('');
      onServerUpdated(data.server);
      flash('✓ Rôle créé !');
    }
  };

  const handleDeleteRole = async (roleId) => {
    const res = await fetch(
      `/api/servers/${encodeURIComponent(server.id)}/roles/${encodeURIComponent(roleId)}`,
      { method: 'DELETE', headers: authHeaders }
    );
    const data = await res.json();
    if (data.ok && data.server) {
      onServerUpdated(data.server);
    }
  };

  const handleToggleMemberRole = async (targetUserId, roleId) => {
    const res = await fetch(
      `/api/servers/${encodeURIComponent(server.id)}/members/${encodeURIComponent(targetUserId)}/roles`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ roleId }),
      }
    );
    const data = await res.json();
    if (data.ok && data.server) {
      onServerUpdated(data.server);
    }
  };

  const handleAddAsset = async (e) => {
    e.preventDefault();
    if (!assetName.trim()) return;
    const res = await fetch(`/api/servers/${encodeURIComponent(server.id)}/assets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        kind: assetKind,
        name: assetName.trim(),
        emoji: assetSymbol || '✨',
        dataUrl: assetUrl,
      }),
    });
    const data = await res.json();
    if (data.ok && data.server) {
      setAssetName('');
      setAssetUrl('');
      onServerUpdated(data.server);
      flash(`✓ ${assetKind === 'sticker' ? 'Sticker' : 'Emoji'} ajouté !`);
    }
  };

  const handleDeleteAsset = async (kind, assetId) => {
    const res = await fetch(
      `/api/servers/${encodeURIComponent(server.id)}/assets/${encodeURIComponent(kind)}/${encodeURIComponent(assetId)}`,
      { method: 'DELETE', headers: authHeaders }
    );
    const data = await res.json();
    if (data.ok && data.server) {
      onServerUpdated(data.server);
    }
  };

  const handleLeaveOrDelete = async () => {
    const res = await fetch(`/api/servers/${encodeURIComponent(server.id)}/leave`, {
      method: 'POST',
      headers: authHeaders,
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      onServerRemoved(server.id);
      onClose();
    }
  };

  const activePresetCss =
    SERVER_BANNER_PRESETS.find((b) => b.id === banner)?.css || SERVER_BANNER_PRESETS[0].css;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav">
          <div
            style={{
              padding: '0 10px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.09em',
              color: 'var(--gold-primary)',
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {server.name}
          </div>

          <button
            type="button"
            className={`settings-nav-btn ${tab === 'overview' ? 'active' : ''}`}
            onClick={() => setTab('overview')}
          >
            <Settings size={15} /> Vue d&apos;ensemble
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'channels' ? 'active' : ''}`}
            onClick={() => setTab('channels')}
          >
            <Hash size={15} /> Salons ({server.channels?.length || 0})
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'roles' ? 'active' : ''}`}
            onClick={() => setTab('roles')}
          >
            <Shield size={15} /> Rôles &amp; Permissions
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'assets' ? 'active' : ''}`}
            onClick={() => setTab('assets')}
          >
            <Smile size={15} /> Emojis &amp; Stickers
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'members' ? 'active' : ''}`}
            onClick={() => setTab('members')}
          >
            <Users size={15} /> Membres ({server.members?.length || 0})
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'invites' ? 'active' : ''}`}
            onClick={() => setTab('invites')}
          >
            <Link2 size={15} /> Invitations P2P
          </button>

          <div className="ctx-sep" style={{ margin: '8px 6px' }} />

          <button
            type="button"
            className={`settings-nav-btn ${tab === 'server-profile' ? 'active' : ''}`}
            onClick={() => setTab('server-profile')}
          >
            <UserPen size={15} /> Profil par serveur
          </button>
          <button
            type="button"
            className={`settings-nav-btn ${tab === 'privacy' ? 'active' : ''}`}
            onClick={() => setTab('privacy')}
          >
            <Shield size={15} /> Confidentialité
          </button>

          <div style={{ flex: 1 }} />

          {server.id !== 'srv-singularity' && (
            <button
              type="button"
              className="settings-nav-btn"
              style={{ color: 'var(--crimson)' }}
              onClick={handleLeaveOrDelete}
            >
              <LogOut size={15} /> {isOwner ? 'Supprimer le serveur' : 'Quitter le serveur'}
            </button>
          )}
        </aside>

        <section className="settings-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
              {tab === 'overview' && "Vue d'ensemble & Apparence du Serveur"}
              {tab === 'channels' && 'Gestion des Salons Textuels, Vocaux & Scènes'}
              {tab === 'roles' && 'Rôles Hiérarchiques & Permissions'}
              {tab === 'assets' && 'Emojis Personnalisés & Stickers du Serveur'}
              {tab === 'members' && 'Membres & Attribution des Rôles'}
              {tab === 'invites' && "Code d'Invitation P2P Zero-IP"}
              {tab === 'server-profile' && 'Modifier votre Profil sur ce Serveur'}
              {tab === 'privacy' && 'Paramètres de Confidentialité du Serveur'}
            </h2>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          {feedback && (
            <div
              style={{
                padding: '9px 14px',
                borderRadius: 9,
                background: 'var(--emerald-bg)',
                border: '1px solid rgba(72, 199, 142, 0.45)',
                color: '#6ce0ad',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {feedback}
            </div>
          )}

          {tab === 'overview' && (
            <form onSubmit={handleSaveOverview} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Live Server Banner + Icon Preview */}
              <div
                style={{
                  position: 'relative',
                  height: 128,
                  borderRadius: 16,
                  border: '1px solid var(--border-strong)',
                  overflow: 'hidden',
                  background: bannerUrl ? `url(${bannerUrl}) center/cover` : activePresetCss,
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: 16,
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    background: '#0b0c12',
                    border: '2px solid var(--gold-bright)',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 20,
                    color: 'var(--gold-bright)',
                    flexShrink: 0,
                  }}
                >
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt={name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    shortName || 'MV'
                  )}
                </div>
                <div style={{ textShadow: '0 2px 10px rgba(0,0,0,0.85)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
                    {name || server.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>
                    {description || 'Serveur communautaire P2P chiffré'}
                  </div>
                </div>
              </div>

              <div className="hw-card">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
                  <div className="field-group">
                    <label className="field-label">Nom du serveur</label>
                    <input
                      className="mash-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Sigle (2-4 car.)</label>
                    <input
                      className="mash-input mono"
                      maxLength={4}
                      value={shortName}
                      onChange={(e) => setShortName(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">Description du serveur</label>
                  <input
                    className="mash-input"
                    placeholder="Décrivez votre communauté, vos jeux ou votre équipe..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field-group">
                    <label className="field-label">
                      <span>Icône personnalisée (URL ou Fichier)</span>
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => iconFileRef.current?.click()}
                      >
                        <Upload size={11} /> Importer
                      </button>
                    </label>
                    <input
                      ref={iconFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => readFileAsDataUrl(e.target.files?.[0], setIconUrl)}
                    />
                    <input
                      className="mash-input mono"
                      placeholder="https://... ou importer une image"
                      value={iconUrl}
                      onChange={(e) => setIconUrl(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">
                      <span>Bannière personnalisée (URL ou Fichier)</span>
                      <button
                        type="button"
                        className="btn-chip"
                        onClick={() => bannerFileRef.current?.click()}
                      >
                        <Upload size={11} /> Importer
                      </button>
                    </label>
                    <input
                      ref={bannerFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => readFileAsDataUrl(e.target.files?.[0], setBannerUrl)}
                    />
                    <input
                      className="mash-input mono"
                      placeholder="https://... ou choisir un thème ci-dessous"
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">Thème de Bannière Singularity</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SERVER_BANNER_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-pill ${banner === p.id && !bannerUrl ? 'selected' : ''}`}
                        onClick={() => {
                          setBanner(p.id);
                          setBannerUrl('');
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: p.css,
                          }}
                        />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <button type="submit" className="btn-gold-cta" disabled={saving}>
                    {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {tab === 'channels' && (
            <>
              <form onSubmit={handleCreateChannel} className="hw-card">
                <strong>Créer un nouveau salon</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px auto', gap: 8 }}>
                  <input
                    className="mash-input"
                    placeholder="Nom du salon (ex: clips-valorant, escouade-2)"
                    value={chName}
                    onChange={(e) => setChName(e.target.value)}
                  />
                  <select
                    className="mash-input"
                    value={chType}
                    onChange={(e) => setChType(e.target.value)}
                  >
                    <option value="text"># Salon Textuel</option>
                    <option value="voice">🔊 Salon Vocal</option>
                    <option value="stage">📡 Scène Stream</option>
                  </select>
                  {chType !== 'text' ? (
                    <select
                      className="mash-input"
                      value={chQuality}
                      onChange={(e) => setChQuality(e.target.value)}
                    >
                      <option value="720p 15FPS">720p • 15 FPS</option>
                      <option value="720p 30FPS">720p • 30 FPS</option>
                      <option value="720p 60FPS">720p • 60 FPS</option>
                      <option value="1080p 30FPS">1080p • 30 FPS</option>
                      <option value="1080p 60FPS">1080p • 60 FPS</option>
                      <option value="1080p 120FPS">1080p • 120 FPS</option>
                      <option value="2K 60FPS">2K • 60 FPS</option>
                      <option value="2K 120FPS">2K • 120 FPS</option>
                      <option value="4K 60FPS">4K • 60 FPS</option>
                      <option value="4K 120FPS">4K • 120 FPS</option>
                    </select>
                  ) : (
                    <div />
                  )}
                  <button type="submit" className="btn-gold-cta" style={{ padding: '0 16px' }}>
                    <Plus size={15} /> Créer
                  </button>
                </div>
              </form>

              <div className="hw-card">
                <strong>Salons existants ({server.channels?.length || 0})</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {server.channels?.map((ch) => (
                    <div
                      key={ch.id}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.32)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        {ch.type === 'text' && <Hash size={15} color="#f5c26b" />}
                        {ch.type === 'voice' && <Volume2 size={15} color="#48c78e" />}
                        {ch.type === 'stage' && <Radio size={15} color="#e8a849" />}
                        <strong>{ch.name}</strong>
                        {ch.maxQuality && <span className="p2p-e2ee-tag">{ch.maxQuality}</span>}
                      </div>
                      {server.channels.length > 1 && (
                        <button
                          type="button"
                          className="dock-action-btn danger"
                          onClick={() => handleDeleteChannel(ch.id)}
                          title="Supprimer ce salon"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'roles' && (
            <>
              <form onSubmit={handleCreateRole} className="hw-card">
                <strong>Créer un Rôle</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px auto', gap: 8 }}>
                  <input
                    className="mash-input"
                    placeholder="Nom du rôle (ex: Capitaine, Streamer VIP...)"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                  />
                  <input
                    type="color"
                    value={roleColor}
                    onChange={(e) => setRoleColor(e.target.value)}
                    style={{
                      width: '100%',
                      height: 40,
                      borderRadius: 8,
                      border: '1px solid var(--border-strong)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  />
                  <button type="submit" className="btn-gold-cta" style={{ padding: '0 18px' }}>
                    Ajouter
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PERM_LABELS.map((p) => {
                    const active = rolePerms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`preset-pill ${active ? 'selected' : ''}`}
                        onClick={() =>
                          setRolePerms((prev) =>
                            prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                          )
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </form>

              <div className="hw-card">
                <strong>Rôles du serveur ({server.roles?.length || 0})</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {server.roles?.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.32)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: r.color,
                          }}
                        />
                        <strong style={{ color: r.color }}>{r.name}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {(r.permissions || []).join(' • ') || 'Membre standard'}
                        </span>
                      </div>
                      {server.roles.length > 1 && (
                        <button
                          type="button"
                          className="dock-action-btn danger"
                          onClick={() => handleDeleteRole(r.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'assets' && (
            <>
              <form onSubmit={handleAddAsset} className="hw-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong>Ajouter un Emoji ou Sticker au serveur</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn-chip"
                      onClick={() => onDownloadAssets(server, 'emojis')}
                    >
                      <Download size={12} /> Download Emojis
                    </button>
                    <button
                      type="button"
                      className="btn-chip"
                      onClick={() => onDownloadAssets(server, 'stickers')}
                    >
                      <Download size={12} /> Download Stickers
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 72px auto', gap: 8 }}>
                  <select
                    className="mash-input"
                    value={assetKind}
                    onChange={(e) => setAssetKind(e.target.value)}
                  >
                    <option value="emoji">Emoji</option>
                    <option value="sticker">Sticker</option>
                  </select>
                  <input
                    className="mash-input"
                    placeholder="Nom (ex: mash_gg, clutch)"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                  />
                  <input
                    className="mash-input"
                    placeholder="⚡"
                    value={assetSymbol}
                    onChange={(e) => setAssetSymbol(e.target.value)}
                    title="Caractère Emoji de secours"
                  />
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => assetFileRef.current?.click()}
                  >
                    <Upload size={13} /> Image
                  </button>
                  <input
                    ref={assetFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => readFileAsDataUrl(e.target.files?.[0], setAssetUrl)}
                  />
                </div>
                <div>
                  <button type="submit" className="btn-gold-cta" style={{ padding: '8px 18px' }}>
                    Ajouter au serveur
                  </button>
                </div>
              </form>

              <div className="hw-card">
                <strong>Emojis ({server.customEmojis?.length || 0}) &amp; Stickers ({server.customStickers?.length || 0})</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {[
                    ...(server.customEmojis || []).map((a) => ({ ...a, _k: 'emoji' })),
                    ...(server.customStickers || []).map((a) => ({ ...a, _k: 'sticker' })),
                  ].map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 9,
                        background: 'rgba(0,0,0,0.35)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {item.dataUrl ? (
                          <img
                            src={item.dataUrl}
                            alt={item.name}
                            style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ fontSize: 20 }}>{item.emoji || '✨'}</span>
                        )}
                        <span
                          style={{
                            fontSize: 12,
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          :{item.name}:
                        </span>
                      </div>
                      <button
                        type="button"
                        className="win-btn"
                        onClick={() => handleDeleteAsset(item._k, item.id)}
                      >
                        <Trash2 size={12} color="#e25555" />
                      </button>
                    </div>
                  ))}
                  {(server.customEmojis?.length || 0) + (server.customStickers?.length || 0) === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                      Aucun emoji ou sticker personnalisé pour l&apos;instant — importez une image ou créez-en un ci-dessus.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'members' && (
            <div className="hw-card">
              <strong>Membres du serveur ({server.members?.length || 0})</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {server.members?.map((m) => {
                  const u = usersMap?.get(m.userId) || {
                    id: m.userId,
                    displayName: m.userId,
                    username: m.userId,
                    avatarColor: '#e8a849',
                  };
                  return (
                    <div
                      key={m.userId}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 9,
                        background: 'rgba(0,0,0,0.32)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          className="avatar-circle"
                          style={{ width: 32, height: 32, background: u.avatarColor || '#e8a849' }}
                        >
                          {u.displayName?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{u.displayName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{u.username}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {server.roles?.map((r) => {
                          const hasRole = m.roleIds?.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className={`preset-pill ${hasRole ? 'selected' : ''}`}
                              style={{ padding: '4px 10px', fontSize: 11 }}
                              onClick={() => handleToggleMemberRole(m.userId, r.id)}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: r.color,
                                }}
                              />
                              {r.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'invites' && (
            <div className="hw-card">
              <strong>Code d&apos;invitation instantané (Relais Zero-IP Zyntra)</strong>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Partagez ce code avec vos amis : ils peuvent rejoindre votre serveur depuis l&apos;icône{' '}
                <strong>+</strong> de la barre latérale, sans aucune adresse IP.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="mash-input mono" readOnly value={server.inviteCode || ''} />
                <button
                  type="button"
                  className="btn-gold-cta"
                  style={{ padding: '10px 18px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(server.inviteCode || '');
                    setCopiedInvite(true);
                    setTimeout(() => setCopiedInvite(false), 1800);
                  }}
                >
                  {copiedInvite ? <Check size={15} /> : <Copy size={15} />}
                  {copiedInvite ? 'Copié !' : 'Copier'}
                </button>
              </div>
            </div>
          )}

          {tab === 'server-profile' && (
            <div className="hw-card">
              <strong>Profil personnalisé sur {server.name}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Choisissez un surnom affiché uniquement dans ce serveur sans modifier votre pseudo global.
              </div>
              <div className="field-group">
                <label className="field-label">Surnom sur ce serveur</label>
                <input
                  className="mash-input"
                  placeholder={me?.displayName || 'Votre surnom...'}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Statut / Bio serveur</label>
                <input
                  className="mash-input"
                  placeholder="Ex: Main Jett • Dispo ranked..."
                  value={serverBio}
                  onChange={(e) => setServerBio(e.target.value)}
                />
              </div>
              <div>
                <button
                  type="button"
                  className="btn-gold-cta"
                  onClick={() => {
                    onUpdateServerPrefs(server.id, {
                      nickname: nickname.trim(),
                      bio: serverBio.trim(),
                    });
                    flash('✓ Profil par serveur enregistré !');
                  }}
                >
                  Enregistrer le profil serveur
                </button>
              </div>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="hw-card">
              <strong>Confidentialité &amp; Sécurité sur {server.name}</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={allowDms}
                  onChange={(e) => {
                    setAllowDms(e.target.checked);
                    onUpdateServerPrefs(server.id, { allowDms: e.target.checked });
                  }}
                  style={{ accentColor: 'var(--gold-primary)' }}
                />
                Autoriser les messages privés directs des membres de ce serveur
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={showActivity}
                  onChange={(e) => {
                    setShowActivity(e.target.checked);
                    onUpdateServerPrefs(server.id, { showActivity: e.target.checked });
                  }}
                  style={{ accentColor: 'var(--gold-primary)' }}
                />
                Afficher mon jeu en cours (Statut d&apos;activité) aux membres de ce serveur
              </label>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
