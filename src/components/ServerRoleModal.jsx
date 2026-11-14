import React, { useState } from 'react';
import { X, Plus, Shield, Hash, Volume2, Users } from 'lucide-react';

const PERM_LABELS = [
  { id: 'ADMINISTRATOR', label: 'Administrateur complet' },
  { id: 'MANAGE_CHANNELS', label: 'Gérer les salons' },
  { id: 'MANAGE_ROLES', label: 'Gérer les rôles' },
  { id: 'STREAM_ULTRA', label: 'Stream 1440p / 120 FPS' },
  { id: 'KICK_MEMBERS', label: 'Expulser des membres' },
];

export default function ServerRoleModal({
  mode, // 'create-or-join' | 'create-channel' | 'roles'
  server,
  usersMap,
  sessionToken,
  onServerChange,
  onClose,
}) {
  const [srvName, setSrvName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [chName, setChName] = useState('');
  const [chType, setChType] = useState('text');

  // Role creator state
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState('#e8a849');
  const [rolePerms, setRolePerms] = useState(['STREAM_ULTRA']);
  const [err, setErr] = useState('');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  const handleCreateServer = async (e) => {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: srvName }),
    });
    const data = await res.json();
    if (!res.ok) return setErr(data.error || 'Erreur');
    onServerChange(data.server, true);
    onClose();
  };

  const handleJoinServer = async (e) => {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/servers/join', {
      method: 'POST',
      headers,
      body: JSON.stringify({ inviteCode }),
    });
    const data = await res.json();
    if (!res.ok) return setErr(data.error || 'Code introuvable');
    onServerChange(data.server, true);
    onClose();
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!server) return;
    const res = await fetch(`/api/servers/${server.id}/channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: chName, type: chType }),
    });
    const data = await res.json();
    if (!res.ok) return setErr(data.error || 'Erreur');
    onServerChange(data.server, false, data.channel);
    onClose();
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    if (!server || !roleName.trim()) return;
    const res = await fetch(`/api/servers/${server.id}/roles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: roleName, color: roleColor, permissions: rolePerms }),
    });
    const data = await res.json();
    if (data.ok) {
      setRoleName('');
      onServerChange(data.server, false);
    }
  };

  const handleToggleMemberRole = async (targetUserId, roleId) => {
    if (!server) return;
    const res = await fetch(`/api/servers/${server.id}/members/${targetUserId}/roles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ roleId }),
    });
    const data = await res.json();
    if (data.ok) onServerChange(data.server, false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="gatekeeper-card"
        style={{ width: mode === 'roles' ? 620 : 450, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>
            {mode === 'create-or-join' && 'Créer ou Rejoindre un Serveur P2P'}
            {mode === 'create-channel' && `Nouveau Salon — ${server?.name}`}
            {mode === 'roles' && `Rôles, Permissions & Membres — ${server?.name}`}
          </h3>
          <button type="button" className="win-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {err && <div style={{ color: 'var(--crimson)', fontSize: 12 }}>{err}</div>}

        {mode === 'create-or-join' && (
          <>
            <form onSubmit={handleCreateServer} className="hw-card">
              <strong>Créer un Serveur Communautaire</strong>
              <input
                className="mash-input"
                placeholder="Nom du serveur (ex: Escouade Spatiale)"
                value={srvName}
                onChange={(e) => setSrvName(e.target.value)}
              />
              <button type="submit" className="btn-gold-cta">
                <Plus size={15} /> Créer le serveur
              </button>
            </form>

            <form onSubmit={handleJoinServer} className="hw-card">
              <strong>Rejoindre via Code d&apos;Invitation P2P</strong>
              <input
                className="mash-input mono"
                placeholder="ex: MASH-HQ-2026"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
              <button type="submit" className="btn-chip" style={{ padding: '9px 14px' }}>
                Rejoindre le serveur
              </button>
            </form>
          </>
        )}

        {mode === 'create-channel' && (
          <form onSubmit={handleCreateChannel} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className={`hw-choice ${chType === 'text' ? 'selected' : ''}`}
                onClick={() => setChType('text')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Hash size={15} /> Salon Textuel
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Messages chiffrés, fichiers & réactions
                </span>
              </button>
              <button
                type="button"
                className={`hw-choice ${chType === 'voice' ? 'selected' : ''}`}
                onClick={() => setChType('voice')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Volume2 size={15} /> Vocal & Stream P2P
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Appels vocaux, caméra & partage de jeu 120 FPS
                </span>
              </button>
            </div>

            <input
              className="mash-input"
              placeholder={chType === 'text' ? 'nom-du-salon' : 'Escouade Gaming'}
              value={chName}
              onChange={(e) => setChName(e.target.value)}
            />
            <button type="submit" className="btn-gold-cta">
              Créer le salon
            </button>
          </form>
        )}

        {mode === 'roles' && server && (
          <>
            <div className="hw-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Code d&apos;invitation P2P du serveur :</span>
                <code style={{ color: 'var(--gold-bright)', fontWeight: 700 }}>
                  {server.inviteCode}
                </code>
              </div>
            </div>

            <form onSubmit={handleCreateRole} className="hw-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={15} color="#f5c26b" />
                <strong>Créer un Rôle Personnalisé</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px auto', gap: 8 }}>
                <input
                  className="mash-input"
                  placeholder="Nom du rôle (ex: Capitaine)"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                />
                <input
                  type="color"
                  value={roleColor}
                  onChange={(e) => setRoleColor(e.target.value)}
                  style={{ width: '100%', height: 38, border: 'none', borderRadius: 8, background: 'none' }}
                />
                <button type="submit" className="btn-chip" style={{ padding: '0 14px' }}>
                  Ajouter
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PERM_LABELS.map((p) => (
                  <label
                    key={p.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}
                  >
                    <input
                      type="checkbox"
                      checked={rolePerms.includes(p.id)}
                      onChange={(e) =>
                        setRolePerms((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                        )
                      }
                      style={{ accentColor: 'var(--gold-primary)' }}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </form>

            <div className="hw-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={15} color="#f5c26b" />
                <strong>Attribution des Rôles aux Membres ({server.members.length})</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {server.members.map((m) => {
                  const u = usersMap.get(m.userId);
                  if (!u) return null;
                  return (
                    <div
                      key={m.userId}
                      style={{
                        padding: 10,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <strong style={{ fontSize: 13 }}>{u.displayName} (@{u.username})</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {server.roles.map((r) => {
                          const has = m.roleIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => handleToggleMemberRole(m.userId, r.id)}
                              style={{
                                padding: '3px 9px',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 600,
                                border: `1px solid ${r.color}`,
                                background: has ? `${r.color}2e` : 'transparent',
                                color: has ? '#fff' : 'var(--text-secondary)',
                              }}
                            >
                              {has ? '✓ ' : '+ '}
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
          </>
        )}
      </div>
    </div>
  );
}
