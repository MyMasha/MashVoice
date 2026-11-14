import React, { useEffect, useState } from 'react';
import SecureLauncher from './components/SecureLauncher.jsx';
import DesktopApp from './components/DesktopApp.jsx';
import MobileApp from './components/MobileApp.jsx';
import { mashSounds } from './lib/soundEffects.js';

const DEFAULT_HW = {
  renderBackend: 'gpu-dedicated',
  videoEncoder: 'nvenc-av1-h264',
  maxRamMb: 2048,
  cpuThreads: 4,
  processPriority: 'below_normal_in_game',
  shaderPreset: 'balanced',
  turboFpsMode: true,
  autoDetectGames: true,
  pauseShaderInGame: true,
  zeroCopyCapture: true,
};

export default function App() {
  const isStandaloneMobile =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/mobile') ||
      new URLSearchParams(window.location.search).get('view') === 'mobile' ||
      window.innerWidth < 640);

  const [bootstrap, setBootstrap] = useState(null);
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [hwConfig, setHwConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('mashvoice.hwConfig');
      return saved ? { ...DEFAULT_HW, ...JSON.parse(saved) } : DEFAULT_HW;
    } catch {
      return DEFAULT_HW;
    }
  });

  const [authSession, setAuthSession] = useState(null); // { sessionToken, user, tokenInfo }
  const [checkingBootAuth, setCheckingBootAuth] = useState(true);
  const [lockReason, setLockReason] = useState('');
  const [mobileCompanionOpen, setMobileCompanionOpen] = useState(false);

  // Load bootstrap & updater info
  useEffect(() => {
    fetch('/api/bootstrap/public')
      .then((r) => r.json())
      .then((d) => setBootstrap(d))
      .catch(() => {});

    fetch('/api/updater/status')
      .then((r) => r.json())
      .then((d) => setUpdaterStatus(d))
      .catch(() => {});

    if (window.mashNative?.getHardwareInfo) {
      window.mashNative.getHardwareInfo().then((info) => {
        if (info?.config) setHwConfig((prev) => ({ ...prev, ...info.config }));
      });
    }
  }, []);

  // Verify stored session against mandatory Connection Token gatekeeper on boot
  useEffect(() => {
    const savedSession = localStorage.getItem('mashvoice.session');
    if (!savedSession) {
      setCheckingBootAuth(false);
      return;
    }
    try {
      const parsed = JSON.parse(savedSession);
      fetch('/api/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${parsed.sessionToken}` },
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setAuthSession({ ...parsed, user: data.user });
          } else {
            const err = await res.json().catch(() => ({}));
            localStorage.removeItem('mashvoice.session');
            setLockReason(err.error || 'Votre Token de Connexion a expiré ou a été révoqué.');
          }
        })
        .catch(() => {})
        .finally(() => setCheckingBootAuth(false));
    } catch {
      setCheckingBootAuth(false);
    }
  }, []);

  const handleUpdateHwConfig = (patch) => {
    setHwConfig((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem('mashvoice.hwConfig', JSON.stringify(next));
      window.mashNative?.saveHardwareConfig?.(patch);
      return next;
    });
  };

  const handleCheckUpdates = async () => {
    const res = await fetch('/api/updater/check', { method: 'POST' });
    const data = await res.json();
    if (data.config) setUpdaterStatus(data.config);
    return data.status;
  };

  const handleAuthenticated = ({
    sessionToken,
    connectionToken,
    user,
    tokenInfo,
    rememberVault,
  }) => {
    mashSounds.unlockGate();
    setLockReason('');
    const bundle = { sessionToken, user, tokenInfo };
    setAuthSession(bundle);

    if (rememberVault) {
      localStorage.setItem('mashvoice.session', JSON.stringify(bundle));
      if (connectionToken) {
        localStorage.setItem('mashvoice.vault.token', connectionToken);
        localStorage.setItem('mashvoice.vault.username', user.username);
        window.mashNative?.setVault?.({
          connectionToken,
          savedUsername: user.username,
        });
      }
    }
  };

  const handleForceLock = (reason) => {
    localStorage.removeItem('mashvoice.session');
    setAuthSession(null);
    setLockReason(reason || 'Accès verrouillé : Token de connexion obligatoire requis.');
  };

  const handleLogout = () => {
    localStorage.removeItem('mashvoice.session');
    setAuthSession(null);
    setLockReason('');
  };

  if (isStandaloneMobile) {
    return <MobileApp bootstrap={bootstrap} />;
  }

  if (checkingBootAuth) {
    return <div style={{ width: '100%', height: '100%', background: '#030305' }} />;
  }

  return (
    <>
      {!authSession ? (
        <SecureLauncher
          bootstrap={bootstrap}
          hwConfig={hwConfig}
          onUpdateHwConfig={handleUpdateHwConfig}
          updaterStatus={updaterStatus}
          onCheckUpdates={handleCheckUpdates}
          onAuthenticated={handleAuthenticated}
          onToggleMobileCompanion={() => setMobileCompanionOpen((v) => !v)}
          mobileCompanionOpen={mobileCompanionOpen}
          lockReason={lockReason}
        />
      ) : (
        <DesktopApp
          me={authSession.user}
          setMe={(nextUser) =>
            setAuthSession((prev) => (prev ? { ...prev, user: nextUser } : prev))
          }
          sessionToken={authSession.sessionToken}
          hwConfig={hwConfig}
          onUpdateHwConfig={handleUpdateHwConfig}
          updaterStatus={updaterStatus}
          onCheckUpdates={handleCheckUpdates}
          onForceLock={handleForceLock}
          onLogout={handleLogout}
          onToggleMobileCompanion={() => setMobileCompanionOpen((v) => !v)}
          mobileCompanionOpen={mobileCompanionOpen}
        />
      )}

      {mobileCompanionOpen && (
        <div className="mobile-drawer-Float" role="dialog" aria-label="Application Mobile MashVoice">
          <MobileApp
            bootstrap={bootstrap}
            isDrawer
            onCloseDrawer={() => setMobileCompanionOpen(false)}
          />
        </div>
      )}
    </>
  );
}
