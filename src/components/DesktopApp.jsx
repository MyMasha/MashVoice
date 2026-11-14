import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Hash,
  Volume2,
  Radio,
  Plus,
  Shield,
  Settings,
  Mic,
  MicOff,
  Headphones,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  PhoneCall,
  Send,
  Paperclip,
  Maximize2,
  Minimize2,
  Smartphone,
  Gamepad2,
  Sparkles,
  UserPlus,
  Copy,
  Check,
  Minus,
  Square,
  X,
  UserCheck,
} from 'lucide-react';
import BlackHoleCanvas from './BlackHoleCanvas.jsx';
import SettingsModal from './SettingsModal.jsx';
import ServerRoleModal from './ServerRoleModal.jsx';
import { P2PMeshEngine } from '../lib/p2pEngine.js';
import { GlobalP2PMesh } from '../lib/globalMesh.js';
import { mashSounds } from '../lib/soundEffects.js';

const QUICK_EMOJIS = ['🔥', '⚡', '🪐', '🎯', '🛡️'];

function VideoStreamBox({ stream, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      onDoubleClick={(e) => e.currentTarget.requestFullscreen?.().catch(() => {})}
    />
  );
}

export default function DesktopApp({
  me,
  setMe,
  sessionToken,
  hwConfig,
  onUpdateHwConfig,
  updaterStatus,
  onCheckUpdates,
  onForceLock,
  onLogout,
  onToggleMobileCompanion,
  mobileCompanionOpen,
}) {
  const [workspace, setWorkspace] = useState({
    users: [],
    friends: [],
    dmChannels: [],
    servers: [],
    voiceRooms: {},
  });
  const [sendingRequest, setSendingRequest] = useState(false);

  // Navigation state: 'dms' or serverId
  const [selectedServerId, setSelectedServerId] = useState('srv-singularity');
  const [selectedChannelId, setSelectedChannelId] = useState('ch-general');
  const [messagesByChannel, setMessagesByChannel] = useState({});
  const [composerText, setComposerText] = useState('');
  const [typingUser, setTypingUser] = useState(null);
  const [friendQuery, setFriendQuery] = useState('');
  const [friendFeedback, setFriendFeedback] = useState('');
  const [friendError, setFriendError] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Global Zyntra Zero-IP Relay state
  const [meshStatus, setMeshStatus] = useState({ online: false, relay: 'zyntra.win', mode: 'connecting' });
  const [incomingRequests, setIncomingRequests] = useState(() => {
    try {
      const raw = localStorage.getItem('mashvoice.incomingFriendReqs');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sentRequests, setSentRequests] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null); // { from, roomId }

  // Voice & P2P Stream state
  const [activeVoiceRoomId, setActiveVoiceRoomId] = useState(null);
  const [activeVoiceLabel, setActiveVoiceLabel] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localPreviewStream, setLocalPreviewStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [stageExpanded, setStageExpanded] = useState(false);
  const [p2pStats, setP2pStats] = useState({
    rttMs: 7,
    bitrateKbps: 128,
    packetsLost: 0,
    activePeers: 0,
    codec: 'H264',
    fps: 60,
  });

  const [streamSettings, setStreamSettings] = useState({
    resolution: '1080p',
    fps: 60,
    maxBitrateKbps: 6500,
    preferredCodec: 'H264',
    maintainFramerate: true,
    echoCancellation: true,
    noiseSuppression: true,
  });

  // Hardware & Game telemetry
  const [nativeTelemetry, setNativeTelemetry] = useState({
    rssMb: 178,
    detectedGame: null,
  });
  const [simulatedGame, setSimulatedGame] = useState(false);

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [serverModalMode, setServerModalMode] = useState(null); // 'create-or-join' | 'create-channel' | 'roles'

  const wsRef = useRef(null);
  const p2pRef = useRef(null);
  const globalMeshRef = useRef(null);
  const handleP2PEventRef = useRef(null);
  const seenP2PIdsRef = useRef(new Set());
  const meRef = useRef(me);
  const workspaceRef = useRef(workspace);
  const activeVoiceRoomRef = useRef(activeVoiceRoomId);
  const sentRequestsRef = useRef(sentRequests);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    meRef.current = me;
    globalMeshRef.current?.updateMe(me);
  }, [me]);

  useEffect(() => {
    workspaceRef.current = workspace;
    for (const srv of workspace.servers) {
      globalMeshRef.current?.subscribeServer(srv);
    }
  }, [workspace]);

  useEffect(() => {
    activeVoiceRoomRef.current = activeVoiceRoomId;
    if (activeVoiceRoomId) {
      globalMeshRef.current?.subscribeRoom(activeVoiceRoomId);
    }
  }, [activeVoiceRoomId]);

  useEffect(() => {
    sentRequestsRef.current = sentRequests;
  }, [sentRequests]);

  useEffect(() => {
    try {
      localStorage.setItem('mashvoice.incomingFriendReqs', JSON.stringify(incomingRequests));
    } catch {
      // ignore
    }
  }, [incomingRequests]);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    }),
    [sessionToken]
  );

  const sendViaTunnel = async (targetPeerId, payload) => {
    try {
      await fetch('/api/p2p/tunnel-send', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          targetPeerId: targetPeerId || null,
          payload,
        }),
      });
    } catch {
      // ignore
    }
  };

  const usersMap = useMemo(() => {
    const m = new Map();
    for (const u of workspace.users) m.set(u.id, u);
    if (me) m.set(me.id, me);
    return m;
  }, [workspace.users, me]);

  const currentServer = useMemo(
    () =>
      selectedServerId === 'dms'
        ? null
        : workspace.servers.find((s) => s.id === selectedServerId) || null,
    [workspace.servers, selectedServerId]
  );

  // Load initial state
  const fetchWorkspace = async () => {
    const res = await fetch('/api/state', { headers: authHeaders });
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      onForceLock(err.error || 'Session verrouillée : Token de connexion requis.');
      return;
    }
    const data = await res.json();
    setWorkspace((prev) => ({
      users: data.users || [],
      friends: data.friends || [],
      dmChannels: data.dmChannels || [],
      servers: data.servers || [],
      voiceRooms: data.voiceRooms || prev.voiceRooms || {},
    }));
    if (data.me) setMe(data.me);
  };

  useEffect(() => {
    fetchWorkspace();
  }, [sessionToken]);

  // Subscribe to Electron hardware telemetry if running in Desktop shell
  useEffect(() => {
    if (!window.mashNative?.onHardwareTelemetry) return undefined;
    return window.mashNative.onHardwareTelemetry((t) => setNativeTelemetry(t));
  }, []);

  // Load messages when selectedChannelId changes
  useEffect(() => {
    if (!selectedChannelId) return;
    fetch(`/api/messages/${encodeURIComponent(selectedChannelId)}`, {
      headers: authHeaders,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.messages) {
          setMessagesByChannel((prev) => ({ ...prev, [selectedChannelId]: data.messages }));
        }
      })
      .catch(() => {});
  }, [selectedChannelId, sessionToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesByChannel[selectedChannelId]?.length]);

  const syncRemotePeer = async (peerProfile, switchToDm = false) => {
    if (!peerProfile) return null;
    const res = await fetch('/api/p2p/sync-peer', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ peer: peerProfile }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.ok) {
      await fetchWorkspace();
      if (switchToDm && data.dmChannelId) {
        setSelectedServerId('dms');
        setSelectedChannelId(data.dmChannelId);
      }
      return data;
    }
    return null;
  };

  const handleAcceptFriendRequest = async (peerProfile) => {
    if (!peerProfile) return;
    if (peerProfile._relayMsgId) {
      globalMeshRef.current?.ackMessage(peerProfile._relayTopic || '', peerProfile._relayMsgId);
    }
    setIncomingRequests((prev) =>
      prev.filter((r) => r.peerId !== peerProfile.peerId && r.id !== peerProfile.id)
    );
    mashSounds.unlockGate();
    await globalMeshRef.current?.sendFriendAccept(peerProfile);
    await syncRemotePeer(peerProfile, true);
    setFriendError('');
    setFriendFeedback(`✓ ${peerProfile.displayName} est maintenant ton ami P2P !`);
    setTimeout(() => setFriendFeedback(''), 3500);
  };

  const handleDeclineFriendRequest = (peerProfile) => {
    if (!peerProfile) return;
    if (peerProfile._relayMsgId) {
      globalMeshRef.current?.ackMessage(peerProfile._relayTopic || '', peerProfile._relayMsgId);
    }
    setIncomingRequests((prev) =>
      prev.filter((r) => r.peerId !== peerProfile.peerId && r.id !== peerProfile.id)
    );
  };

  const handleRemoveFriend = async (e, friendId) => {
    e.stopPropagation();
    await fetch(`/api/friends/${encodeURIComponent(friendId)}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    await fetchWorkspace();
    if (selectedChannelId.includes(friendId)) {
      setSelectedChannelId('ch-general');
      setSelectedServerId('srv-singularity');
    }
  };

  // Unified Zero-IP Relay Event Processor (mv-relay-v1 over zyntra.win)
  handleP2PEventRef.current = async (data) => {
    const curMe = meRef.current;
    if (!curMe || !data || typeof data !== 'object') return;
    if (data.targetPeerId && data.targetPeerId !== curMe.peerId) return;

    if (data.msgId) {
      if (seenP2PIdsRef.current.has(data.msgId)) return;
      seenP2PIdsRef.current.add(data.msgId);
      if (seenP2PIdsRef.current.size > 600) {
        const oldest = seenP2PIdsRef.current.values().next().value;
        seenP2PIdsRef.current.delete(oldest);
      }
    }

    switch (data.type) {
      case 'friend:request': {
        const from = data.from;
        if (!from || from.peerId === curMe.peerId) return;
        const alreadyFriend = workspaceRef.current.friends.some(
          (f) => f.id === from.id || f.peerId === from.peerId
        );
        const weRequestedThem = sentRequestsRef.current.some((q) => {
          const ql = q.toLowerCase();
          return (
            ql === from.username?.toLowerCase() ||
            ql === from.peerId?.toLowerCase() ||
            ql === `${from.username}#${from.tag}`.toLowerCase()
          );
        });

        if (alreadyFriend || weRequestedThem) {
          if (data.msgId) {
            globalMeshRef.current?.ackMessage(data._relayTopic || '', data.msgId);
          }
          await globalMeshRef.current?.sendFriendAccept(from);
          await syncRemotePeer(from, weRequestedThem);
          if (weRequestedThem) {
            setSentRequests((prev) =>
              prev.filter((q) => q.toLowerCase() !== from.username?.toLowerCase())
            );
            setFriendFeedback(`✓ Connexion P2P établie avec ${from.displayName} !`);
            setTimeout(() => setFriendFeedback(''), 3500);
          }
          return;
        }

        mashSounds.messageTick();
        const enrichedReq = {
          ...from,
          _relayMsgId: data.msgId || null,
          _relayTopic: data._relayTopic || '',
        };
        setIncomingRequests((prev) => {
          if (prev.some((r) => r.peerId === from.peerId || r.id === from.id)) return prev;
          return [enrichedReq, ...prev];
        });
        break;
      }

      case 'friend:accept': {
        const from = data.from;
        if (!from || from.peerId === curMe.peerId) return;
        mashSounds.unlockGate();
        setSentRequests((prev) =>
          prev.filter((q) => {
            const ql = q.toLowerCase();
            return (
              ql !== from.username?.toLowerCase() &&
              ql !== from.peerId?.toLowerCase() &&
              ql !== `${from.username}#${from.tag}`.toLowerCase()
            );
          })
        );
        await syncRemotePeer(from, true);
        setFriendError('');
        setFriendFeedback(`✓ ${from.displayName} a accepté ta demande d'ami !`);
        setTimeout(() => setFriendFeedback(''), 4000);
        break;
      }

      case 'dm:message': {
        const from = data.from;
        if (!from || !data.message || from.peerId === curMe.peerId) return;
        const localFriend = workspaceRef.current.friends.find(
          (f) => f.id === from.id || f.peerId === from.peerId
        );
        let dmId = localFriend ? `dm:${[curMe.id, localFriend.id].sort().join(':')}` : null;
        if (!dmId) {
          const synced = await syncRemotePeer(from, false);
          dmId = synced?.dmChannelId || `dm:${[curMe.id, from.id].sort().join(':')}`;
        }
        await fetch('/api/p2p/sync-message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            channelId: dmId,
            message: { ...data.message, channelId: dmId },
            author: from,
          }),
        });
        break;
      }

      case 'srv:message': {
        if (!data.channelId || !data.message || data.from?.peerId === curMe.peerId) return;
        await fetch('/api/p2p/sync-message', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            channelId: data.channelId,
            message: data.message,
            author: data.from,
          }),
        });
        break;
      }

      case 'srv:join-request': {
        if (!data.inviteCode || !data.from || data.from.peerId === curMe.peerId) return;
        const targetSrv = workspaceRef.current.servers.find(
          (s) => s.inviteCode?.toUpperCase() === String(data.inviteCode).toUpperCase()
        );
        if (targetSrv) {
          await Promise.all([
            globalMeshRef.current?.sendServerSnapshotToPeer(data.from, targetSrv),
            sendViaTunnel(data.from.peerId, {
              type: 'srv:welcome',
              from: curMe,
              server: targetSrv,
            }),
          ]);
        }
        break;
      }

      case 'srv:welcome': {
        if (!data.server) return;
        const res = await fetch('/api/p2p/sync-server', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ server: data.server, host: data.from }),
        });
        const saved = await res.json().catch(() => ({}));
        if (saved?.ok && saved.server) {
          await fetchWorkspace();
          setServerModalMode(null);
          setSelectedServerId(saved.server.id);
          const firstTxt = saved.server.channels?.find((c) => c.type === 'text');
          if (firstTxt) setSelectedChannelId(firstTxt.id);
        }
        break;
      }

      case 'call:ring': {
        if (!data.from || !data.roomId || data.from.peerId === curMe.peerId) return;
        mashSounds.joinVoice();
        setIncomingCall({ from: data.from, roomId: data.roomId });
        break;
      }

      case 'room:peer-joined': {
        if (!data.roomId || !data.peerKey || data.peerKey === curMe.peerId) return;
        const occ = {
          peerKey: data.peerKey,
          userId: data.user?.id || data.peerKey,
          username: data.user?.username || 'pair',
          displayName: data.user?.displayName || 'Pair P2P',
          avatarColor: data.user?.avatarColor || '#5ec2a6',
          deviceType: 'desktop',
        };
        setWorkspace((prev) => {
          const curList = prev.voiceRooms[data.roomId] || [];
          const filtered = curList.filter((p) => p.peerKey !== data.peerKey);
          return {
            ...prev,
            voiceRooms: { ...prev.voiceRooms, [data.roomId]: [...filtered, occ] },
          };
        });

        if (activeVoiceRoomRef.current === data.roomId) {
          await Promise.all([
            globalMeshRef.current?.broadcastRoomEvent(data.roomId, 'room:peer-here', {
              targetPeerKey: data.peerKey,
            }),
            sendViaTunnel(data.peerKey, {
              type: 'room:peer-here',
              roomId: data.roomId,
              peerKey: curMe.peerId,
              user: curMe,
              targetPeerKey: data.peerKey,
            }),
          ]);
          if (p2pRef.current && !p2pRef.current.peers.has(data.peerKey)) {
            await p2pRef.current.createPeerConnection(data.peerKey, occ, false);
          }
        }
        break;
      }

      case 'room:peer-here': {
        if (!data.roomId || !data.peerKey || data.peerKey === curMe.peerId) return;
        const occ = {
          peerKey: data.peerKey,
          userId: data.user?.id || data.peerKey,
          username: data.user?.username || 'pair',
          displayName: data.user?.displayName || 'Pair P2P',
          avatarColor: data.user?.avatarColor || '#5ec2a6',
          deviceType: 'desktop',
        };
        setWorkspace((prev) => {
          const curList = prev.voiceRooms[data.roomId] || [];
          const filtered = curList.filter((p) => p.peerKey !== data.peerKey);
          return {
            ...prev,
            voiceRooms: { ...prev.voiceRooms, [data.roomId]: [...filtered, occ] },
          };
        });

        if (
          activeVoiceRoomRef.current === data.roomId &&
          data.targetPeerKey === curMe.peerId &&
          p2pRef.current &&
          !p2pRef.current.peers.has(data.peerKey)
        ) {
          await p2pRef.current.createPeerConnection(data.peerKey, occ, true);
        }
        break;
      }

      case 'room:peer-left': {
        if (!data.roomId || !data.peerKey) return;
        setWorkspace((prev) => {
          const curList = prev.voiceRooms[data.roomId] || [];
          return {
            ...prev,
            voiceRooms: {
              ...prev.voiceRooms,
              [data.roomId]: curList.filter((p) => p.peerKey !== data.peerKey),
            },
          };
        });
        p2pRef.current?.handlePeerLeft(data.peerKey);
        break;
      }

      case 'webrtc:signal': {
        if (
          activeVoiceRoomRef.current === data.roomId &&
          data.fromPeerKey &&
          data.signal &&
          data.fromPeerKey !== curMe.peerId
        ) {
          await p2pRef.current?.handleSignal(data.fromPeerKey, data.fromUser, data.signal);
        }
        break;
      }

      default:
        break;
    }
  };

  // Initialize Global Encrypted P2P Mesh (Zero-IP Internet Rendezvous)
  useEffect(() => {
    if (!me?.peerId) return undefined;
    const mesh = new GlobalP2PMesh({
      me,
      onStatusChange: (st) => setMeshStatus(st),
      onEvent: (data) => handleP2PEventRef.current?.(data),
    });

    globalMeshRef.current = mesh;
    for (const srv of workspaceRef.current.servers) {
      mesh.subscribeServer(srv);
    }
    if (activeVoiceRoomRef.current) {
      mesh.subscribeRoom(activeVoiceRoomRef.current);
    }

    return () => {
      mesh.destroy();
      globalMeshRef.current = null;
    };
  }, [me?.peerId, sessionToken]);

  // Initialize P2P Engine + Real-time WebSocket with continuous Token Heartbeat
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?token=${encodeURIComponent(sessionToken)}`
    );
    wsRef.current = ws;

    const p2p = new P2PMeshEngine({
      sendSignal: (payload) => {
        if (String(payload?.targetPeerKey || '').startsWith('p2p-mash-')) {
          globalMeshRef.current?.sendWebRtcSignal(
            payload.targetPeerKey,
            payload.roomId,
            payload.signal
          );
          sendViaTunnel(payload.targetPeerKey, {
            type: 'webrtc:signal',
            fromPeerKey: meRef.current?.peerId,
            fromUser: meRef.current,
            roomId: payload.roomId,
            signal: payload.signal,
          });
          return;
        }
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'p2p:signal', ...payload }));
        }
      },
      onRemoteStreamsChange: (list) => setRemoteStreams(list),
      onP2PData: (_peerKey, packet) => {
        if (packet.kind === 'direct-chat' && packet.channelId && packet.message) {
          setMessagesByChannel((prev) => {
            const existing = prev[packet.channelId] || [];
            if (existing.some((m) => m.id === packet.message.id)) return prev;
            return { ...prev, [packet.channelId]: [...existing, packet.message] };
          });
        }
      },
      onStatsUpdate: (stats) => setP2pStats(stats),
      onSpeakingChange: (speaking) => {
        setLocalSpeaking(speaking);
        if (ws.readyState === 1 && p2p.roomId) {
          ws.send(
            JSON.stringify({
              type: 'p2p:media-state',
              roomId: p2p.roomId,
              patch: { speaking },
            })
          );
        }
      },
    });
    p2pRef.current = p2p;

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case 'auth:force_disconnect': {
            p2p.leaveRoom();
            onForceLock(msg.reason || 'Votre Token de Connexion obligatoire a été révoqué.');
            break;
          }
          case 'ws:ready': {
            setWorkspace((prev) => ({
              ...prev,
              voiceRooms: msg.voiceRooms || prev.voiceRooms,
              activeTunnels: msg.activeTunnels || prev.activeTunnels,
            }));
            break;
          }
          case 'p2p:tunnels': {
            setWorkspace((prev) => ({
              ...prev,
              activeTunnels: msg.tunnels || [],
            }));
            break;
          }
          case 'p2p:direct_event': {
            await handleP2PEventRef.current?.(msg.data);
            break;
          }
          case 'voice:rooms': {
            setWorkspace((prev) => ({ ...prev, voiceRooms: msg.rooms || {} }));
            break;
          }
          case 'p2p:room-joined': {
            await p2p.joinRoom(msg.roomId, msg.selfPeerKey, msg.existingPeers || []);
            break;
          }
          case 'p2p:peer-joined': {
            await p2p.handlePeerJoined(msg.peer);
            break;
          }
          case 'p2p:peer-left': {
            p2p.handlePeerLeft(msg.peerKey);
            break;
          }
          case 'p2p:signal': {
            await p2p.handleSignal(msg.fromPeerKey, msg.fromUser, msg.signal);
            break;
          }
          case 'chat:message': {
            mashSounds.messageTick();
            setMessagesByChannel((prev) => {
              const list = prev[msg.channelId] || [];
              if (list.some((m) => m.id === msg.message.id)) return prev;
              return { ...prev, [msg.channelId]: [...list, msg.message] };
            });
            break;
          }
          case 'chat:reaction': {
            setMessagesByChannel((prev) => {
              const list = prev[msg.channelId] || [];
              return {
                ...prev,
                [msg.channelId]: list.map((m) => (m.id === msg.message.id ? msg.message : m)),
              };
            });
            break;
          }
          case 'chat:typing': {
            if (msg.channelId === selectedChannelId) {
              setTypingUser(msg.user.displayName);
              setTimeout(() => setTypingUser(null), 2400);
            }
            break;
          }
          case 'server:updated': {
            setWorkspace((prev) => {
              const exists = prev.servers.some((s) => s.id === msg.server.id);
              const servers = exists
                ? prev.servers.map((s) => (s.id === msg.server.id ? msg.server : s))
                : [...prev.servers, msg.server];
              return { ...prev, servers };
            });
            break;
          }
          case 'user:updated': {
            setWorkspace((prev) => ({
              ...prev,
              users: prev.users.map((u) => (u.id === msg.user.id ? msg.user : u)),
            }));
            break;
          }
          case 'friendship:added': {
            fetchWorkspace();
            break;
          }
          default:
            break;
        }
      } catch {
        // ignore
      }
    };

    // Continuous 15-second mandatory token heartbeat
    const hb = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'auth:heartbeat' }));
      }
    }, 15_000);

    return () => {
      clearInterval(hb);
      p2p.leaveRoom();
      ws.close();
    };
  }, [sessionToken]);

  const handleUpdateStreamSettings = (patch) => {
    setStreamSettings((prev) => {
      const next = { ...prev, ...patch };
      p2pRef.current?.updateStreamSettings(next);
      return next;
    });
  };

  // Join a P2P Voice / Stream Channel or Direct DM Call
  const joinVoiceChannel = async (roomId, label, targetDmPeer = null) => {
    if (activeVoiceRoomId === roomId) return;
    mashSounds.joinVoice();
    setActiveVoiceRoomId(roomId);
    setActiveVoiceLabel(label);
    setCameraOn(false);
    setScreenOn(false);
    setLocalPreviewStream(null);
    setIncomingCall(null);

    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:join-room',
          roomId,
          mediaState: {
            muted: micMuted,
            deafened,
            cameraOn: false,
            screenOn: false,
            streamSpec: `${streamSettings.resolution} • ${streamSettings.fps} FPS • P2P`,
            encoder: `${streamSettings.preferredCodec} Hardware`,
          },
        })
      );
    } else if (me?.peerId) {
      await p2pRef.current?.joinRoom(roomId, me.peerId, []);
    }

    globalMeshRef.current?.subscribeRoom(roomId);
    setTimeout(() => {
      globalMeshRef.current?.broadcastRoomEvent(roomId, 'room:peer-joined');
      if (meRef.current?.peerId) {
        sendViaTunnel(null, {
          type: 'room:peer-joined',
          roomId,
          peerKey: meRef.current.peerId,
          user: meRef.current,
        });
      }
      if (targetDmPeer) {
        globalMeshRef.current?.ringPeerForCall(targetDmPeer, roomId);
        sendViaTunnel(targetDmPeer.peerId, {
          type: 'call:ring',
          from: meRef.current,
          roomId,
        });
      }
    }, 250);
  };

  const leaveVoiceChannel = () => {
    if (!activeVoiceRoomId) return;
    const prevRoom = activeVoiceRoomId;
    mashSounds.leaveVoice();
    globalMeshRef.current?.broadcastRoomEvent(prevRoom, 'room:peer-left');
    if (meRef.current?.peerId) {
      sendViaTunnel(null, {
        type: 'room:peer-left',
        roomId: prevRoom,
        peerKey: meRef.current.peerId,
        user: meRef.current,
      });
    }
    p2pRef.current?.leaveRoom();
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'p2p:leave-room' }));
    }
    setActiveVoiceRoomId(null);
    setActiveVoiceLabel('');
    setCameraOn(false);
    setScreenOn(false);
    setLocalPreviewStream(null);
    setStageExpanded(false);
  };

  const toggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    mashSounds.toggleMute(next);
    p2pRef.current?.setMuted(next);
    if (wsRef.current?.readyState === 1 && activeVoiceRoomId) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:media-state',
          roomId: activeVoiceRoomId,
          patch: { muted: next },
        })
      );
    }
  };

  const toggleDeafen = () => {
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true);
    p2pRef.current?.setDeafened(next);
    if (wsRef.current?.readyState === 1 && activeVoiceRoomId) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:media-state',
          roomId: activeVoiceRoomId,
          patch: { deafened: next, muted: next ? true : micMuted },
        })
      );
    }
  };

  const handleToggleCamera = async () => {
    if (!activeVoiceRoomId) return;
    const next = !cameraOn;
    const stream = await p2pRef.current?.toggleCamera(next);
    setCameraOn(Boolean(stream));
    if (!screenOn) setLocalPreviewStream(stream);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:media-state',
          roomId: activeVoiceRoomId,
          patch: { cameraOn: Boolean(stream) },
        })
      );
    }
  };

  const handleToggleScreenShare = async () => {
    if (!activeVoiceRoomId) return;
    const next = !screenOn;
    if (next) mashSounds.startStream();
    const stream = await p2pRef.current?.toggleScreenShare(next);
    setScreenOn(Boolean(stream));
    setLocalPreviewStream(stream || p2pRef.current?.localCameraStream || null);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(
        JSON.stringify({
          type: 'p2p:media-state',
          roomId: activeVoiceRoomId,
          patch: {
            screenOn: Boolean(stream),
            streamSpec: `${streamSettings.resolution} • ${streamSettings.fps} FPS`,
          },
        })
      );
    }
  };

  const handleSendMessage = async (e, attachment = null) => {
    e?.preventDefault();
    if (!composerText.trim() && !attachment) return;
    const content = composerText;
    setComposerText('');

    const res = await fetch(`/api/messages/${encodeURIComponent(selectedChannelId)}`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content, attachment }),
    });
    const data = await res.json();
    if (data.ok && data.message) {
      p2pRef.current?.broadcastP2PData({
        kind: 'direct-chat',
        channelId: selectedChannelId,
        message: data.message,
      });

      if (selectedServerId === 'dms') {
        const dmEntry = workspace.dmChannels.find((d) => d.id === selectedChannelId);
        if (dmEntry?.peer) {
          globalMeshRef.current?.sendDirectMessage(dmEntry.peer, selectedChannelId, data.message);
          sendViaTunnel(dmEntry.peer.peerId, {
            type: 'dm:message',
            from: meRef.current,
            channelId: selectedChannelId,
            message: data.message,
          });
        }
      } else if (currentServer) {
        globalMeshRef.current?.sendServerMessage(currentServer.id, selectedChannelId, data.message);
        sendViaTunnel(null, {
          type: 'srv:message',
          from: meRef.current,
          serverId: currentServer.id,
          channelId: selectedChannelId,
          message: data.message,
        });
      }
    }
  };

  const handleFileAttachment = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      handleSendMessage(null, {
        name: file.name,
        type: file.type,
        dataUrl: typeof reader.result === 'string' ? reader.result : null,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleToggleReaction = async (messageId, emoji) => {
    await fetch(
      `/api/messages/${encodeURIComponent(selectedChannelId)}/${encodeURIComponent(messageId)}/react`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ emoji }),
      }
    );
  };

  const handleAddFriend = async (e) => {
    e.preventDefault();
    const q = friendQuery.trim().replace(/^@+/, '');
    if (!q || sendingRequest) return;
    setFriendError('');
    setFriendFeedback('');

    const qLow = q.toLowerCase();
    if (qLow.startsWith('mash-sv4')) {
      setFriendError(
        "Ceci est un Token MASH-SV4 ! Entre uniquement le pseudo de ton ami (ex: v0dka)."
      );
      return;
    }

    const looksLikeIp =
      /^(?:ws:\/\/|wss:\/\/|http:\/\/|https:\/\/)?(?:\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::\d{1,5})?\/?$/i.test(
        q
      ) || qLow.includes(':3080');

    if (looksLikeIp) {
      setFriendError(
        "Aucune adresse IP n'est nécessaire ! Entre simplement le pseudo de ton ami (ex: v0dka)."
      );
      return;
    }

    setSendingRequest(true);
    try {
      const res = await fetch('/api/friends/add', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ query: q, globalOnly: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFriendError(data.error || 'Impossible d’envoyer la demande.');
        return;
      }

      const [sentCount, presence] = await Promise.all([
        globalMeshRef.current?.sendFriendRequest(q),
        globalMeshRef.current?.checkPresence(q.split('#')[0]),
      ]);
      if (q.includes('#')) {
        const basePseudo = q.split('#')[0].trim();
        if (basePseudo) await globalMeshRef.current?.sendFriendRequest(basePseudo);
      }

      setFriendQuery('');
      setSentRequests((prev) => (prev.includes(q) ? prev : [q, ...prev]));

      if (data.friend && !data.pendingGlobal) {
        setFriendFeedback(`✓ Conversation ouverte avec ${data.friend.displayName} !`);
        await fetchWorkspace();
        setSelectedServerId('dms');
        setSelectedChannelId(data.dmChannelId);
      } else if (presence?.online) {
        setFriendFeedback(
          `✓ Demande d'ami envoyée en direct à @${q} (en ligne sur Zyntra) !`
        );
      } else if (sentCount) {
        setFriendFeedback(
          `✓ Demande déposée pour @${q} sur Zyntra (il la recevra dès qu'il ouvrira MashVoice) !`
        );
      } else {
        setFriendFeedback(`✓ Demande d'ami en file d'attente pour @${q}.`);
      }
      setTimeout(() => setFriendFeedback(''), 5000);
    } finally {
      setSendingRequest(false);
    }
  };

  const activeGameTitle =
    nativeTelemetry.detectedGame || (simulatedGame ? 'MashClient 1.8.9 (Turbo FPS)' : null);
  const shaderPausedForGame =
    hwConfig.renderBackend === 'cpu-software' ||
    (Boolean(activeGameTitle) && hwConfig.pauseShaderInGame !== false) ||
    hwConfig.shaderPreset === 'turbo';

  // Compute current channel header metadata
  let currentChannelTitle = 'général';
  let currentChannelTopic = 'Discussion P2P chiffrée';
  let activeDmPeer = null;

  if (selectedServerId === 'dms') {
    const dmEntry = workspace.dmChannels.find((d) => d.id === selectedChannelId);
    if (dmEntry) {
      activeDmPeer = dmEntry.peer;
      currentChannelTitle = `@${dmEntry.peer.displayName}`;
      currentChannelTopic = `Message Privé P2P Direct • Peer ID: ${dmEntry.peer.peerId}`;
    }
  } else if (currentServer) {
    const ch = currentServer.channels.find((c) => c.id === selectedChannelId);
    if (ch) {
      currentChannelTitle = ch.name;
      currentChannelTopic = ch.topic || 'Salon communautaire P2P';
    }
  }

  // Group server members by highest hoisted role
  const groupedRoleMembers = useMemo(() => {
    if (!currentServer) return [];
    const sortedRoles = [...currentServer.roles].sort((a, b) => b.position - a.position);
    const groups = sortedRoles.map((r) => ({ role: r, members: [] }));
    const unassigned = [];

    for (const m of currentServer.members) {
      const user = usersMap.get(m.userId);
      if (!user) continue;
      const topRole = sortedRoles.find((r) => m.roleIds.includes(r.id));
      if (topRole) {
        const g = groups.find((x) => x.role.id === topRole.id);
        g.members.push({ user, topRole });
      } else {
        unassigned.push({ user, topRole: null });
      }
    }
    const nonEmpty = groups.filter((g) => g.members.length > 0);
    if (unassigned.length > 0) {
      nonEmpty.push({
        role: { id: 'none', name: 'Membres', color: '#9aa0ad' },
        members: unassigned,
      });
    }
    return nonEmpty;
  }, [currentServer, usersMap]);

  const currentMessages = messagesByChannel[selectedChannelId] || [];
  const activeRoomPeers = activeVoiceRoomId ? workspace.voiceRooms[activeVoiceRoomId] || [] : [];

  return (
    <div className="workspace-shell">
      {/* Top Singularity System & Telemetry Titlebar */}
      <header className="workspace-titlebar">
        <div className="brand-cluster">
          <div className="brand-mark" style={{ width: 18, height: 18 }} />
          <span className="brand-title" style={{ fontSize: 11.5 }}>
            MASHVOICE
          </span>
          <span className="singularity-badge">P2P MESH E2EE</span>
        </div>

        <div className="telemetry-strip">
          <button
            type="button"
            className={`telemetry-pill ${activeGameTitle ? 'turbo' : ''}`}
            onClick={() => setSimulatedGame((v) => !v)}
            title="Cliquer pour activer/tester le Mode Jeu Turbo FPS (0% GPU UI)"
          >
            <Gamepad2 size={12} />
            {activeGameTitle
              ? `En Jeu : ${activeGameTitle} • Shader 0% GPU`
              : 'Mode Jeu Auto : Veille'}
          </button>

          <span className="telemetry-pill">
            RAM: {nativeTelemetry.rssMb} / {hwConfig.maxRamMb} Mo
          </span>

          <span className="telemetry-pill">
            Encodeur: {streamSettings.preferredCodec}{' '}
            {hwConfig.renderBackend === 'cpu-software' ? 'CPU' : 'GPU'}
          </span>

          <button
            type="button"
            className="telemetry-pill"
            style={{ color: 'var(--gold-bright)', borderColor: 'var(--gold-border)' }}
            onClick={onToggleMobileCompanion}
          >
            <Smartphone size={12} />
            {mobileCompanionOpen ? 'Masquer Mobile' : 'App Mobile & QR'}
          </button>
        </div>

        {window.mashNative?.isElectron ? (
          <div className="win-controls">
            <button
              type="button"
              className="win-btn"
              onClick={() => window.mashNative.windowControl('minimize')}
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="win-btn"
              onClick={() => window.mashNative.windowControl('maximize')}
            >
              <Square size={11} />
            </button>
            <button
              type="button"
              className="win-btn close"
              onClick={() => window.mashNative.windowControl('close')}
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>
            ● Token Vérifié
          </div>
        )}
      </header>

      {/* Main 4-Column Discord-Style Grid */}
      <div className="workspace-grid">
        {/* 1. Left Server Rail */}
        <nav className="server-rail" aria-label="Serveurs et Messages Privés">
          <button
            type="button"
            id="rail-dms-btn"
            className={`rail-btn ${selectedServerId === 'dms' ? 'active' : ''}`}
            style={{ position: 'relative' }}
            title="Messages Privés & Amis P2P"
            onClick={() => {
              setSelectedServerId('dms');
              if (workspace.dmChannels[0]) {
                setSelectedChannelId(workspace.dmChannels[0].id);
              }
            }}
          >
            <MessageSquare size={20} />
            {incomingRequests.length > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 99,
                  background: '#e25555',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {incomingRequests.length}
              </span>
            )}
          </button>

          <div className="rail-divider" />

          {workspace.servers.map((srv) => (
            <button
              key={srv.id}
              type="button"
              className={`rail-btn ${selectedServerId === srv.id ? 'active' : ''}`}
              title={srv.name}
              onClick={() => {
                setSelectedServerId(srv.id);
                const firstText = srv.channels.find((c) => c.type === 'text');
                if (firstText) setSelectedChannelId(firstText.id);
              }}
            >
              {srv.shortName}
            </button>
          ))}

          <button
            type="button"
            id="rail-add-server-btn"
            className="rail-btn"
            title="Créer ou rejoindre un serveur communautaire P2P"
            onClick={() => setServerModalMode('create-or-join')}
          >
            <Plus size={20} />
          </button>
        </nav>

        {/* 2. Secondary Sidebar (DMs or Server Channels) */}
        <aside className="channel-sidebar">
          {selectedServerId === 'dms' ? (
            <>
              <div className="sidebar-header">
                <span>Messages Privés P2P</span>
                <Sparkles size={15} color="#f5c26b" />
              </div>

              <div className="sidebar-scroll">
                <div
                  style={{
                    padding: '9px 10px',
                    borderRadius: 9,
                    background: 'rgba(232, 168, 73, 0.07)',
                    border: '1px solid rgba(232, 168, 73, 0.24)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: 'var(--gold-bright)',
                      letterSpacing: '0.03em',
                    }}
                  >
                    <span>MON PSEUDO MASHVOICE</span>
                    <span
                      style={{
                        color: meshStatus.online ? 'var(--emerald)' : 'var(--gold-bright)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                      }}
                    >
                      {meshStatus.online ? '● Zyntra Actif' : '○ Connexion...'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.8, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                    Donne simplement ton <strong>Pseudo</strong> à ton ami (zéro adresse IP) :
                  </div>
                  <button
                    type="button"
                    className="btn-chip"
                    style={{
                      justifyContent: 'center',
                      fontSize: 11.5,
                      borderColor: 'rgba(72, 199, 142, 0.45)',
                      color: '#6ce0ad',
                    }}
                    onClick={() => {
                      const pseudoStr = me?.username || '';
                      navigator.clipboard?.writeText(pseudoStr);
                      setFriendError('');
                      setFriendFeedback(`✓ Pseudo copié : ${pseudoStr}`);
                      setTimeout(() => setFriendFeedback(''), 2600);
                    }}
                    title="Cliquer pour copier ton pseudo"
                  >
                    <Copy size={12} /> @{me?.username}
                  </button>
                </div>

                <form onSubmit={handleAddFriend} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cat-header">AJOUTER UN AMI PAR PSEUDO</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="mash-input"
                      style={{ padding: '7px 10px', fontSize: 12 }}
                      placeholder="Pseudo de ton ami (ex: v0dka)"
                      value={friendQuery}
                      onChange={(e) => setFriendQuery(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn-chip"
                      disabled={sendingRequest}
                      title="Envoyer une demande d'ami par pseudo"
                    >
                      {sendingRequest ? '...' : <UserPlus size={14} />}
                    </button>
                  </div>
                  {friendFeedback && (
                    <div style={{ fontSize: 11, color: 'var(--emerald)', lineHeight: 1.35 }}>
                      {friendFeedback}
                    </div>
                  )}
                  {friendError && (
                    <div style={{ fontSize: 11, color: '#ff8e8e', lineHeight: 1.35 }}>
                      {friendError}
                    </div>
                  )}
                </form>

                {incomingRequests.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="cat-header" style={{ color: 'var(--gold-bright)' }}>
                      DEMANDES D&apos;AMIS REÇUES ({incomingRequests.length})
                    </div>
                    {incomingRequests.map((req) => (
                      <div
                        key={req.peerId || req.id}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 9,
                          background: 'rgba(72, 199, 142, 0.1)',
                          border: '1px solid rgba(72, 199, 142, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 12.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {req.displayName}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                            @{req.username}#{req.tag}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn-chip"
                            style={{
                              padding: '4px 8px',
                              fontSize: 11,
                              color: '#48c78e',
                              borderColor: 'rgba(72, 199, 142, 0.5)',
                            }}
                            onClick={() => handleAcceptFriendRequest(req)}
                            title="Accepter la demande d'ami"
                          >
                            <UserCheck size={13} /> Accepter
                          </button>
                          <button
                            type="button"
                            className="win-btn"
                            onClick={() => handleDeclineFriendRequest(req)}
                            title="Ignorer"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <div className="cat-header">CONVERSATIONS DIRECTES ({workspace.dmChannels.length})</div>
                  <div className="channel-list" style={{ marginTop: 6 }}>
                    {workspace.dmChannels.length === 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '6px 4px' }}>
                        Entre simplement le pseudo de ton ami ci-dessus pour discuter et l&apos;appeler en P2P !
                      </div>
                    )}
                    {workspace.dmChannels.map(({ id, peer }) => (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        className={`channel-item ${selectedChannelId === id ? 'active' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                        onClick={() => setSelectedChannelId(id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedChannelId(id);
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                          <div
                            className="avatar-circle"
                            style={{
                              width: 28,
                              height: 28,
                              fontSize: 11,
                              background: peer.avatarColor || '#e8a849',
                              flexShrink: 0,
                            }}
                          >
                            {peer.displayName[0]?.toUpperCase()}
                            <span className={`presence-dot ${peer.status || 'online'}`} />
                          </div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {peer.displayName}
                            </div>
                            <div
                              style={{
                                fontSize: 10.5,
                                color: 'var(--text-muted)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {peer.activity ? `🎮 ${peer.activity.name}` : peer.customStatus || 'En ligne'}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="win-btn"
                          style={{ opacity: 0.55, flexShrink: 0 }}
                          title={`Retirer ${peer.displayName}`}
                          onClick={(e) => handleRemoveFriend(e, peer.id)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            currentServer && (
              <>
                <div className="sidebar-header">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentServer.name}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="win-btn"
                      title="Copier le code d'invitation P2P"
                      onClick={() => {
                        navigator.clipboard?.writeText(currentServer.inviteCode);
                        setCopiedInvite(true);
                        setTimeout(() => setCopiedInvite(false), 1600);
                      }}
                    >
                      {copiedInvite ? <Check size={14} color="#48c78e" /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      className="win-btn"
                      title="Gérer les Rôles & Permissions"
                      onClick={() => setServerModalMode('roles')}
                    >
                      <Shield size={15} color="#f5c26b" />
                    </button>
                    <button
                      type="button"
                      className="win-btn"
                      title="Créer un salon"
                      onClick={() => setServerModalMode('create-channel')}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="sidebar-scroll">
                  {currentServer.categories.map((cat) => {
                    const catChannels = currentServer.channels.filter((c) => c.categoryId === cat.id);
                    return (
                      <div key={cat.id}>
                        <div className="cat-header">
                          <span>{cat.name}</span>
                        </div>
                        <div className="channel-list">
                          {catChannels.map((ch) => {
                            const isVoice = ch.type === 'voice' || ch.type === 'stage';
                            const occupants = workspace.voiceRooms[ch.id] || [];
                            const isSelected = isVoice
                              ? activeVoiceRoomId === ch.id
                              : selectedChannelId === ch.id;

                            return (
                              <div key={ch.id}>
                                <button
                                  type="button"
                                  className={`channel-item ${isSelected ? 'active' : ''}`}
                                  onClick={() => {
                                    if (isVoice) {
                                      joinVoiceChannel(ch.id, `${ch.name} (${currentServer.shortName})`);
                                    } else {
                                      setSelectedChannelId(ch.id);
                                    }
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {ch.type === 'text' && <Hash size={15} />}
                                    {ch.type === 'voice' && <Volume2 size={15} />}
                                    {ch.type === 'stage' && <Radio size={15} />}
                                    <span>{ch.name}</span>
                                  </div>
                                  {isVoice && ch.maxQuality && (
                                    <span
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 9.5,
                                        color: 'var(--text-muted)',
                                      }}
                                    >
                                      {ch.maxQuality}
                                    </span>
                                  )}
                                </button>

                                {isVoice && occupants.length > 0 && (
                                  <div className="voice-occupants">
                                    {occupants.map((occ) => (
                                      <div key={occ.peerKey} className="voice-occupant-row">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                          <div
                                            className={`avatar-circle ${occ.speaking ? 'speaking' : ''}`}
                                            style={{
                                              width: 20,
                                              height: 20,
                                              fontSize: 9.5,
                                              background: occ.avatarColor || '#e8a849',
                                            }}
                                          >
                                            {occ.displayName?.[0]?.toUpperCase()}
                                          </div>
                                          <span>{occ.displayName}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                          {occ.screenOn && <span className="live-tag">LIVE</span>}
                                          {occ.cameraOn && !occ.screenOn && (
                                            <span className="p2p-e2ee-tag">CAM</span>
                                          )}
                                          {occ.muted && <MicOff size={11} color="#e25555" />}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          )}

          {/* Active P2P Voice / Stream Controls Dock */}
          {activeVoiceRoomId && (
            <div className="voice-connected-dock">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald)' }}>
                    ● Vocal P2P Connecté ({p2pStats.rttMs} ms)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {activeVoiceLabel} • {(p2pStats.bitrateKbps / 1000).toFixed(1)} Mbps
                  </div>
                </div>
                <button
                  type="button"
                  className="dock-action-btn danger"
                  onClick={leaveVoiceChannel}
                  title="Quitter le salon vocal"
                >
                  <PhoneOff size={14} />
                </button>
              </div>

              <div className="voice-dock-actions">
                <button
                  type="button"
                  className={`dock-action-btn ${cameraOn ? 'active-gold' : ''}`}
                  onClick={handleToggleCamera}
                  title="Activer / couper la caméra"
                >
                  {cameraOn ? <Video size={14} /> : <VideoOff size={14} />} Cam
                </button>
                <button
                  type="button"
                  id="start-stream-btn"
                  className={`dock-action-btn ${screenOn ? 'active-gold' : ''}`}
                  style={{ gridColumn: 'span 2' }}
                  onClick={handleToggleScreenShare}
                  title="Streamer un jeu ou votre écran en P2P Zero-Copy"
                >
                  <MonitorUp size={14} /> {screenOn ? 'Stop Stream' : 'Streamer'}
                </button>
                <button
                  type="button"
                  className="dock-action-btn"
                  onClick={() => setStageExpanded((v) => !v)}
                  title="Agrandir la scène Stream"
                >
                  {stageExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Bottom User Profile Bar */}
          <div className="user-profile-dock">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <div
                className={`avatar-circle ${localSpeaking ? 'speaking' : ''}`}
                style={{ background: me?.avatarColor || '#e8a849' }}
              >
                {me?.displayName?.[0]?.toUpperCase() || 'M'}
                <span className={`presence-dot ${me?.status || 'online'}`} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {me?.displayName}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>#{me?.tag || '0001'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                type="button"
                className="win-btn"
                onClick={toggleMic}
                title={micMuted ? 'Réactiver le micro' : 'Couper le micro'}
              >
                {micMuted ? <MicOff size={16} color="#e25555" /> : <Mic size={16} />}
              </button>
              <button
                type="button"
                className="win-btn"
                onClick={toggleDeafen}
                title={deafened ? 'Réactiver le son' : 'Mettre en sourdine'}
              >
                <Headphones size={16} color={deafened ? '#e25555' : 'currentColor'} />
              </button>
              <button
                type="button"
                id="open-pro-settings-btn"
                className="win-btn"
                onClick={() => setShowSettings(true)}
                title="Paramètres Pro (GPU, CPU, RAM, Stream, Sécurité & Auto-Updater)"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </aside>

        {/* 3. Center Chat + Stream Matrix Stage */}
        <main className="center-stage">
          {!shaderPausedForGame && (
            <BlackHoleCanvas
              quality={hwConfig.shaderPreset || 'balanced'}
              paused={false}
              offsetX={0.22}
              opacity={0.14}
            />
          )}

          <header className="stage-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {selectedServerId === 'dms' ? (
                <MessageSquare size={18} color="#f5c26b" style={{ flexShrink: 0 }} />
              ) : (
                <Hash size={18} color="#f5c26b" style={{ flexShrink: 0 }} />
              )}
              <strong
                style={{
                  fontSize: 15,
                  maxWidth: 280,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {currentChannelTitle}
              </strong>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentChannelTopic}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {activeDmPeer && (
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() =>
                    joinVoiceChannel(
                      selectedChannelId,
                      `Appel Privé @${activeDmPeer.displayName}`,
                      activeDmPeer
                    )
                  }
                >
                  <PhoneCall size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
                  Appeler en P2P
                </button>
              )}
            </div>
          </header>

          {/* Global Friend Request Notification Banner (visible from any server tab) */}
          {selectedServerId !== 'dms' && incomingRequests.length > 0 && (
            <div
              style={{
                margin: '10px 16px 0',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(72, 199, 142, 0.12)',
                border: '1px solid rgba(72, 199, 142, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                zIndex: 4,
              }}
            >
              <div style={{ fontSize: 12.5 }}>
                🔔 <strong>{incomingRequests[0].displayName}</strong> (@
                {incomingRequests[0].username}#{incomingRequests[0].tag}) t&apos;a envoyé une demande
                d&apos;ami P2P !
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-chip"
                  style={{ color: '#48c78e', borderColor: 'rgba(72, 199, 142, 0.55)' }}
                  onClick={() => handleAcceptFriendRequest(incomingRequests[0])}
                >
                  <UserCheck size={13} /> Accepter
                </button>
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => handleDeclineFriendRequest(incomingRequests[0])}
                >
                  Ignorer
                </button>
              </div>
            </div>
          )}

          {/* Incoming P2P Call Ring Banner */}
          {incomingCall && activeVoiceRoomId !== incomingCall.roomId && (
            <div
              style={{
                margin: '10px 16px 0',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(232, 168, 73, 0.14)',
                border: '1px solid var(--gold-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                zIndex: 4,
              }}
            >
              <div style={{ fontSize: 12.5 }}>
                📞 Appel P2P entrant de <strong>{incomingCall.from?.displayName}</strong> !
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-gold-cta"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() =>
                    joinVoiceChannel(
                      incomingCall.roomId,
                      `Appel Privé @${incomingCall.from?.displayName || 'Ami'}`
                    )
                  }
                >
                  <PhoneCall size={13} /> Rejoindre l&apos;appel
                </button>
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => setIncomingCall(null)}
                >
                  Ignorer
                </button>
              </div>
            </div>
          )}

          {/* Active P2P Voice / Camera / Game Stream Matrix */}
          {activeVoiceRoomId && (
            <section className={`stream-stage-panel ${stageExpanded ? 'expanded' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="live-tag">P2P MESH</span>
                  <strong style={{ fontSize: 13.5 }}>{activeVoiceLabel}</strong>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {streamSettings.resolution} • {streamSettings.fps} FPS •{' '}
                    {streamSettings.preferredCodec} Zero-Copy • Ping {p2pStats.rttMs} ms
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-chip" onClick={handleToggleScreenShare}>
                    {screenOn ? 'Arrêter le partage' : 'Partager Jeu / Écran'}
                  </button>
                  <button type="button" className="btn-chip" onClick={handleToggleCamera}>
                    {cameraOn ? 'Couper Caméra' : 'Activer Caméra'}
                  </button>
                </div>
              </div>

              <div className="stream-tiles-grid">
                {/* Self Tile */}
                <div className={`stream-tile ${localSpeaking ? 'speaking' : ''}`}>
                  {localPreviewStream ? (
                    <VideoStreamBox stream={localPreviewStream} muted />
                  ) : (
                    <div
                      className="avatar-circle"
                      style={{
                        width: 68,
                        height: 68,
                        fontSize: 24,
                        background: me?.avatarColor || '#e8a849',
                      }}
                    >
                      {me?.displayName?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="tile-overlay-top">
                    <span className="tile-badge">Vous ({me?.displayName})</span>
                    {screenOn && (
                      <span className="live-tag">
                        EN DIRECT {streamSettings.resolution} {streamSettings.fps}FPS
                      </span>
                    )}
                  </div>
                </div>

                {/* Remote WebRTC Stream Tiles */}
                {remoteStreams.map(({ peerKey, peerMeta, stream }) => {
                  const hasVideo = stream?.getVideoTracks()?.length > 0;
                  return (
                    <div key={peerKey} className="stream-tile">
                      {hasVideo ? (
                        <VideoStreamBox stream={stream} />
                      ) : (
                        <>
                          <VideoStreamBox stream={stream} />
                          <div
                            className="avatar-circle"
                            style={{
                              position: 'absolute',
                              width: 68,
                              height: 68,
                              fontSize: 24,
                              background: peerMeta?.avatarColor || '#5ec2a6',
                            }}
                          >
                            {peerMeta?.displayName?.[0]?.toUpperCase() || 'P'}
                          </div>
                        </>
                      )}
                      <div className="tile-overlay-top">
                        <span className="tile-badge">{peerMeta?.displayName || 'Pair P2P'}</span>
                        <span className="p2p-e2ee-tag">E2EE DIRECT</span>
                      </div>
                    </div>
                  );
                })}

                {/* Room peers without media tracks yet */}
                {activeRoomPeers
                  .filter(
                    (p) =>
                      p.userId !== me?.id && !remoteStreams.some((rs) => rs.peerKey === p.peerKey)
                  )
                  .map((p) => (
                    <div key={p.peerKey} className="stream-tile">
                      <div
                        className="avatar-circle"
                        style={{
                          width: 68,
                          height: 68,
                          fontSize: 24,
                          background: p.avatarColor || '#5ec2a6',
                        }}
                      >
                        {p.displayName?.[0]?.toUpperCase()}
                      </div>
                      <div className="tile-overlay-top">
                        <span className="tile-badge">{p.displayName}</span>
                        {p.deviceType?.includes('mobile') && (
                          <span className="p2p-e2ee-tag">📱 MOBILE</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Chat Messages Stream */}
          {!stageExpanded && (
            <>
              <div className="messages-viewport">
                {currentMessages.map((msg) => {
                  const author = usersMap.get(msg.authorId) || {
                    displayName: 'Pair P2P',
                    avatarColor: '#e8a849',
                  };
                  return (
                    <div key={msg.id} className="msg-row">
                      <div
                        className="avatar-circle"
                        style={{ background: author.avatarColor || '#e8a849' }}
                      >
                        {author.displayName?.[0]?.toUpperCase()}
                      </div>
                      <div className="msg-body">
                        <div className="msg-meta">
                          <span className="msg-author">{author.displayName}</span>
                          <span className="msg-time">
                            {new Date(msg.createdAt).toLocaleTimeString('fr-FR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="p2p-e2ee-tag">P2P E2EE</span>
                        </div>
                        {msg.content && <div className="msg-text">{msg.content}</div>}

                        {msg.attachment?.dataUrl && (
                          <div style={{ marginTop: 8 }}>
                            {msg.attachment.type?.startsWith('image/') ? (
                              <img
                                src={msg.attachment.dataUrl}
                                alt={msg.attachment.name}
                                style={{
                                  maxWidth: 360,
                                  maxHeight: 260,
                                  borderRadius: 10,
                                  border: '1px solid var(--border-strong)',
                                }}
                              />
                            ) : (
                              <a
                                href={msg.attachment.dataUrl}
                                download={msg.attachment.name}
                                className="btn-chip"
                                style={{ display: 'inline-block', textDecoration: 'none' }}
                              >
                                📎 Télécharger {msg.attachment.name}
                              </a>
                            )}
                          </div>
                        )}

                        <div className="reactions-bar">
                          {Object.entries(msg.reactions || {}).map(([emoji, uids]) => (
                            <button
                              key={emoji}
                              type="button"
                              className={`reaction-pill ${uids.includes(me?.id) ? 'mine' : ''}`}
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                            >
                              <span>{emoji}</span>
                              <span>{uids.length}</span>
                            </button>
                          ))}
                          {QUICK_EMOJIS.map((em) =>
                            !msg.reactions?.[em] ? (
                              <button
                                key={em}
                                type="button"
                                className="reaction-pill"
                                style={{ opacity: 0.45 }}
                                onClick={() => handleToggleReaction(msg.id, em)}
                                title={`Réagir avec ${em}`}
                              >
                                {em}
                              </button>
                            ) : null
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer */}
              <div className="composer-wrap">
                {typingUser && (
                  <div style={{ fontSize: 11, color: 'var(--gold-bright)', marginBottom: 4 }}>
                    {typingUser} est en train d&apos;écrire en P2P...
                  </div>
                )}
                <form onSubmit={handleSendMessage} className="composer-box">
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={handleFileAttachment}
                  />
                  <button
                    type="button"
                    className="win-btn"
                    title="Partager une image ou un fichier en P2P"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={17} />
                  </button>
                  <input
                    id="chat-composer-input"
                    className="composer-input"
                    placeholder={`Envoyer un message chiffré dans ${currentChannelTitle}...`}
                    value={composerText}
                    onChange={(e) => {
                      setComposerText(e.target.value);
                      if (wsRef.current?.readyState === 1) {
                        wsRef.current.send(
                          JSON.stringify({ type: 'chat:typing', channelId: selectedChannelId })
                        );
                      }
                    }}
                  />
                  <button type="submit" className="btn-chip" style={{ padding: '6px 12px' }}>
                    <Send size={14} />
                  </button>
                </form>
              </div>
            </>
          )}
        </main>

        {/* 4. Right Server Roles & Members Sidebar */}
        {currentServer && (
          <aside className="members-sidebar" aria-label="Membres du serveur">
            {groupedRoleMembers.map(({ role, members }) => (
              <div key={role.id}>
                <div className="cat-header" style={{ color: role.color }}>
                  <span>
                    {role.name} — {members.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                  {members.map(({ user, topRole }) => (
                    <div
                      key={user.id}
                      className="member-item"
                      style={{ cursor: user.id !== me?.id ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (user.id === me?.id) return;
                        const dmId = `dm:${[me.id, user.id].sort().join(':')}`;
                        setSelectedServerId('dms');
                        setSelectedChannelId(dmId);
                      }}
                      title={
                        user.id !== me?.id ? `Envoyer un message privé à ${user.displayName}` : ''
                      }
                    >
                      <div
                        className="avatar-circle"
                        style={{
                          width: 30,
                          height: 30,
                          fontSize: 12,
                          background: user.avatarColor || '#e8a849',
                        }}
                      >
                        {user.displayName?.[0]?.toUpperCase()}
                        <span className={`presence-dot ${user.status || 'online'}`} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: topRole?.color || 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {user.displayName}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {user.activity
                            ? `${user.activity.type === 'streaming' ? '🟣 Stream:' : '🎮'} ${user.activity.name}`
                            : user.customStatus || 'Connecté P2P'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        )}
      </div>

      {showSettings && (
        <SettingsModal
          me={me}
          sessionToken={sessionToken}
          hwConfig={hwConfig}
          onUpdateHwConfig={onUpdateHwConfig}
          streamSettings={streamSettings}
          onUpdateStreamSettings={handleUpdateStreamSettings}
          simulatedGame={simulatedGame}
          onToggleSimulatedGame={() => setSimulatedGame((v) => !v)}
          updaterStatus={updaterStatus}
          onCheckUpdates={onCheckUpdates}
          onProfileUpdated={(u) => setMe(u)}
          onLogout={onLogout}
          onClose={() => setShowSettings(false)}
        />
      )}

      {serverModalMode && (
        <ServerRoleModal
          mode={serverModalMode}
          server={currentServer}
          usersMap={usersMap}
          sessionToken={sessionToken}
          onJoinRemoteServer={(code) => {
            globalMeshRef.current?.requestJoinServerByInvite(code);
            sendViaTunnel(null, {
              type: 'srv:join-request',
              inviteCode: String(code || '').trim().toUpperCase(),
              from: meRef.current,
            });
          }}
          onServerChange={(srv, switchNow, newCh) => {
            setWorkspace((prev) => {
              const exists = prev.servers.some((s) => s.id === srv.id);
              const servers = exists
                ? prev.servers.map((s) => (s.id === srv.id ? srv : s))
                : [...prev.servers, srv];
              return { ...prev, servers };
            });
            if (switchNow) {
              setSelectedServerId(srv.id);
              const firstTxt = srv.channels.find((c) => c.type === 'text');
              if (firstTxt) setSelectedChannelId(firstTxt.id);
            } else if (newCh && newCh.type === 'text') {
              setSelectedChannelId(newCh.id);
            }
          }}
          onClose={() => setServerModalMode(null)}
        />
      )}
    </div>
  );
}
