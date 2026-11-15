import React, { useEffect, useState } from 'react';
import SecureLauncher from './components/SecureLauncher.jsx';
import DesktopApp from './components/DesktopApp.jsx';
import MobileApp from './components/MobileApp.jsx';
import { UpdateFloatingPopup, ChangelogModal } from './components/UpdateExperience.jsx';
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
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateToastDismissed, setUpdateToastDismissed] = useState(false);
  const [activeChangelog, setActiveChangelog] = useState(null);

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

  // Load bootstrap & updater info + check for updates automatically
  useEffect(() => {
    fetch('/api/bootstrap/public')
      .then((r) => r.json())
      .then((d) => setBootstrap(d))
      .catch(() => {});

    fetch('/api/updater/status')
      .then((r) => r.json())
      .then((d) => {
        setUpdaterStatus(d);
        if (d?.pendingChangelog) {
          setActiveChangelog(d.pendingChangelog);
        }
      })
      .catch(() => {});

    const bootCheck = setTimeout(() => {
      fetch('/api/updater/check', { method: 'POST' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.config) {
            setUpdaterStatus(data.config);
            if (data.config.pendingChangelog) {
              setActiveChangelog((prev) => prev || data.config.pendingChangelog);
            }
          }
        })
        .catch(() => {});
    }, 1800);

    // Periodic silent refresh so background watchdog discoveries appear live
    const periodic = setInterval(() => {
      fetch('/api/updater/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setUpdaterStatus(d);
        })
        .catch(() => {});
    }, 45000);

    if (window.mashNative?.getHardwareInfo) {
      window.mashNative.getHardwareInfo().then((info) => {
        if (info?.config) setHwConfig((prev) => ({ ...prev, ...info.config }));
      });
    }

    return () => {
      clearTimeout(bootCheck);
      clearInterval(periodic);
    };
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
    if (data.config) {
      setUpdaterStatus(data.config);
      if (data.status?.updateAvailable) {
        setUpdateToastDismissed(false);
      }
    }
    return data.status;
  };

  const handleInstallUpdate = async () => {
    if (installingUpdate) return;
    setUpdateError('');
    setInstallingUpdate(true);

    const progressTimer = setInterval(() => {
      fetch('/api/updater/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setUpdaterStatus(d);
        })
        .catch(() => {});
    }, 300);

    try {
      const res = await fetch('/api/updater/install', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setUpdateError(
          data.error ||
            'Installation directe indisponible sur cet environnement — téléchargez via GitHub.'
        );
        setInstallingUpdate(false);
        return;
      }
      if (data.config) setUpdaterStatus(data.config);

      // Trigger automatic restart with `--after-update` so the Changelog opens immediately on boot!
      await fetch('/api/updater/restart', { method: 'POST' }).catch(() => {});
    } catch (err) {
      setUpdateError(err?.message || 'Erreur lors de la mise à jour.');
      setInstallingUpdate(false);
    } finally {
      clearInterval(progressTimer);
    }
  };

  const handleOpenManualChangelog = () => {
    if (updaterStatus?.pendingChangelog) {
      setActiveChangelog(updaterStatus.pendingChangelog);
      return;
    }
    if (updaterStatus?.currentChangelog) {
      setActiveChangelog(updaterStatus.currentChangelog);
      return;
    }
    setActiveChangelog({
      version: updaterStatus?.currentVersion || '1.0.6',
      title: `Nouveautés MashVoice v${updaterStatus?.currentVersion || '1.0.6'}`,
      notes:
        updaterStatus?.lastStatus?.releaseNotes ||
        'MashVoice est à jour.',
      publishedAt: new Date().toISOString(),
    });
  };

  const handleDismissChangelog = async () => {
    setActiveChangelog(null);
    try {
      const res = await fetch('/api/updater/ack-changelog', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data?.config) setUpdaterStatus(data.config);
    } catch {
      // ignore
    }
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
    mashSounds.stopAllRings();
    localStorage.removeItem('mashvoice.session');
    setAuthSession(null);
    setLockReason(reason || 'Accès verrouillé : Token de connexion obligatoire requis.');
  };

  const handleLogout = () => {
    mashSounds.stopAllRings();
    localStorage.removeItem('mashvoice.session');
    setAuthSession(null);
    setLockReason('');
  };

  if (isStandaloneMobile) {
    return <MobileApp bootstrap={bootstrap} />;
  }

  if (checkingBootAuth) {
    return <div style={{ width: '100%', height: '100%', background: 'var(--bg-void)' }} />;
  }

  return (
    <>
      {!authSession ? (
        <SecureLauncher
          bootstrap={bootstrap}
          hwConfig={hwConfig}
          onUpdateHwConfig={handleUpdateHwConfig}
          updaterStatus={updaterStatus}
          installingUpdate={installingUpdate}
          onCheckUpdates={handleCheckUpdates}
          onInstallUpdate={handleInstallUpdate}
          onOpenChangelog={handleOpenManualChangelog}
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
          installingUpdate={installingUpdate}
          onCheckUpdates={handleCheckUpdates}
          onInstallUpdate={handleInstallUpdate}
          onOpenChangelog={handleOpenManualChangelog}
          onForceLock={handleForceLock}
          onLogout={handleLogout}
          onToggleMobileCompanion={() => setMobileCompanionOpen((v) => !v)}
          mobileCompanionOpen={mobileCompanionOpen}
        />
      )}

      {/* Floating Compact Update Popup (1-Click Install -> Restart -> Changelog) */}
      <UpdateFloatingPopup
        updaterStatus={updaterStatus}
        dismissed={updateToastDismissed}
        installing={installingUpdate}
        errorMsg={updateError}
        onInstallUpdate={handleInstallUpdate}
        onDismiss={() => setUpdateToastDismissed(true)}
      />

      {/* Post-Restart Automatic Changelog Modal */}
      <ChangelogModal
        changelog={activeChangelog}
        currentVersion={updaterStatus?.currentVersion || '1.0.6'}
        onClose={handleDismissChangelog}
      />

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
