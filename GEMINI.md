# MashVoice — Design System & Figma MCP Integration Rules

This document defines the architecture, design tokens, component conventions, and Figma MCP integration rules (`figma_figma`) for **MashVoice** (Rust + Tauri v2 + React 19 P2P voice, chat, and 4K/120 FPS streaming client).

---

## 1. Token Definitions

### Where Tokens Are Defined
All visual design tokens are defined as native **CSS Custom Properties** on `:root` at the top of [`src/styles/index.css`](src/styles/index.css) (lines 1–44). There is **no** Style Dictionary, Tailwind config, or Sass preprocessor transformation step — tokens are consumed directly via `var(--token-name)` in CSS and inline React styles.

### Token Format & Current Structure
```css
/* src/styles/index.css */
:root {
  /* Surfaces (v5 « Obsidian Air » Tonal Layering) */
  --bg-void: #090a0d;
  --bg-obsidian: #0b0d12;
  --bg-rail: #08090c;
  --bg-sidebar: #0e1015;
  --bg-stage: #11141b;
  --bg-elevated: #161a23;
  --bg-card: #13161e;
  --bg-glass: rgba(14, 16, 21, 0.86);
  --bg-hover: rgba(255, 255, 255, 0.045);
  --bg-active: rgba(229, 169, 82, 0.12);

  /* Brand Accent (Warm Amber — reserved for primary CTA, focus & active rail) */
  --gold-ivory: #f9eed8;
  --gold-bright: #efc075;
  --gold-primary: #e5a952;
  --gold-deep: #c98a32;
  --gold-muted: rgba(229, 169, 82, 0.12);
  --gold-border: rgba(229, 169, 82, 0.28);

  /* Borders & Neutral Hairlines */
  --border-subtle: rgba(255, 255, 255, 0.065);
  --border-strong: rgba(255, 255, 255, 0.11);

  /* Typography Colors */
  --text-primary: #f3f5f8;
  --text-secondary: #9ca3b4;
  --text-muted: #606778;

  /* Semantic Status */
  --emerald: #3ecf8e;
  --emerald-bg: rgba(62, 207, 142, 0.12);
  --amber-warn: #e5a952;
  --crimson: #ef5a5a;
  --crimson-bg: rgba(239, 90, 90, 0.14);

  /* Font Stacks */
  --font-display: 'Inter', 'Space Grotesk', system-ui, sans-serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Border Radii */
  --radius-xs: 7px;
  --radius-sm: 9px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  /* Elevation */
  --shadow-elevated: 0 24px 60px rgba(0, 0, 0, 0.54), inset 0 1px 0 rgba(255, 255, 255, 0.045);
}
```

### Figma Variables Mapping (v5 « Obsidian Air » — Clean, Modern, Not Empty)
When creating or syncing Figma Variables and Frames via Figma MCP:
- **Surfaces**: `surface/canvas` (`#090A0D`), `surface/sidebar` (`#0E1015`), `surface/stage` (`#11141B`), `surface/elevated` (`#161A23`).
- **Strokes**: Use neutral `1px` hairlines (`rgba(255, 255, 255, 0.065)`) instead of glowing gold borders on containers. Reserve `--gold-primary` / `#E5A952` strictly for the **single primary CTA**, active rail indicator, or focused states.
- **Typography Scale**: Base `14px` (`1.45` line-height) in `Inter`; telemetry/FPS/ping/tags (`#0001`, `120 FPS`, `12 ms`) in `JetBrains Mono` (`11px–12px`, tabular numerals).

---

## 2. Component Library

### Component Location & Architecture
All UI components live flat under [`src/components/`](src/components) as ES module functional React 19 `.jsx` components using standard React hooks (`useState`, `useEffect`, `useMemo`, `useRef`). There is no Storybook or external UI primitive library (Radix/MUI/shadcn are not used; modals, context menus, and segmented controls are custom-built).

### Core Screen & Modal Inventory
| File | Role & Figma Frame Equivalent |
| :--- | :--- |
| [`src/App.jsx`](src/App.jsx) | Root session router: switches between `SecureLauncher`, `DesktopApp`, standalone `MobileApp`, and global `UpdateExperience` overlays. |
| [`src/components/SecureLauncher.jsx`](src/components/SecureLauncher.jsx) | Pre-auth gatekeeper (`1440×900`): `MASH-SV4` token login, ephemeral WebSocket QR challenge, hardware presets, and updater status. |
| [`src/components/DesktopApp.jsx`](src/components/DesktopApp.jsx) | Main 4-zone P2P workspace: Server Rail (`64–72px`) + Channel/DM Sidebar (`248–264px`) with unified Voice/Profile Dock + Main Chat/120 FPS Stream Stage + optional Members drawer. |
| [`src/components/MobileApp.jsx`](src/components/MobileApp.jsx) | Companion mobile view (`375×812` standalone or floating drawer): QR scanner (`jsqr`), pocket servers/DMs, and mobile WebRTC voice/camera. |
| [`src/components/StreamLaunchModal.jsx`](src/components/StreamLaunchModal.jsx) | P2P screen-share configurator (`720p` / `1080p` / `2K` / `4K` × `15` / `30` / `60` / `120 FPS`, codec & bitrate readout). |
| [`src/components/SettingsModal.jsx`](src/components/SettingsModal.jsx) | Multi-tab user/pro settings (`1000×700` 2-column modal): Audio & **MashKrisp™** live loopback meter, Profile, Hardware/GPU, Gaming detection, Security tokens, Auto-Updater. |
| [`src/components/ServerSettingsModal.jsx`](src/components/ServerSettingsModal.jsx) | Community server admin modal + `SERVER_BANNER_PRESETS`. |
| [`src/components/ServerRoleModal.jsx`](src/components/ServerRoleModal.jsx) | Role & RBAC permission editor (`FOUNDER`, `ADMIN`, `MEMBER`, `STREAM_HD`). |
| [`src/components/ServerContextMenu.jsx`](src/components/ServerContextMenu.jsx) | Right-click server context menu & `ServerMediaViewerModal`. |
| [`src/components/UpdateExperience.jsx`](src/components/UpdateExperience.jsx) | Exports `UpdateTopPill`, `UpdateFloatingPopup`, and post-restart `ChangelogModal`. |
| [`src/components/BlackHoleCanvas.jsx`](src/components/BlackHoleCanvas.jsx) | Background WebGL Schwarzschild raymarching canvas (auto-pauses when a game is detected). |

### Component Pattern Example
```jsx
// Modal & Segmented Choice Pattern (src/components/StreamLaunchModal.jsx)
<div className="modal-backdrop" onClick={onClose}>
  <form className="gatekeeper-card" onClick={(e) => e.stopPropagation()} onSubmit={handleConfirm}>
    <div className="hw-card">
      <div className="field-label">
        <span>Qualité / Résolution d&apos;image</span>
        <span>{resMeta.sub}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {STREAM_RESOLUTIONS.map((res) => (
          <button
            key={res}
            type="button"
            className={`hw-choice ${resolution === res ? 'selected' : ''}`}
            onClick={() => setResolution(res)}
          >
            <strong>{res}</strong>
          </button>
        ))}
      </div>
    </div>
  </form>
</div>
```

---

## 3. Frameworks & Libraries

- **UI Framework**: **React 19** (`react@^19.0.0`, `react-dom@^19.0.0`) mounted in [`src/main.jsx`](src/main.jsx).
- **Desktop Shell**: **Tauri v2** (`@tauri-apps/api@^2.2.0`, `@tauri-apps/cli@^2.2.0`) configured in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):
  - Default viewport: **`1440 × 900`** (`minWidth: 1024`, `minHeight: 680`).
  - Frameless window (`"decorations": false`) requiring custom titlebars with `-webkit-app-region: drag` and window control buttons (`Minus`, `Square`, `X`).
- **Styling**: **Vanilla CSS** ([`src/styles/index.css`](src/styles/index.css)) — no Tailwind, CSS-in-JS, or CSS Modules in production code.
- **Bundler**: **Vite 6** (`vite@^6.2.0`, `@vitejs/plugin-react@^4.3.4`) in [`vite.config.js`](vite.config.js), targeting `es2022` and proxying `/api` and `/ws` to the local Rust Axum engine (`127.0.0.1:3080`).
- **Backend Workspace**: **Rust** (`Cargo.toml` workspace with `crates/mashvoice-core`, `crates/mashvoice-server`, and `src-tauri`).

---

## 4. Asset Management

- **Static Web Assets**: Stored in [`public/`](public) and referenced from root `/` (`public/icon.svg` → `/icon.svg`, `public/manifest.json` → `/manifest.json`).
- **Native Bundle Icons**: Stored in `src-tauri/icons/` (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns`).
- **Fonts**: Loaded via Google Fonts in [`index.html`](index.html) (`Inter` 400–800, `JetBrains Mono` 400–600, `Space Grotesk` 600–700).
- **Visual Backgrounds**: Procedural GPU shader ([`src/components/BlackHoleCanvas.jsx`](src/components/BlackHoleCanvas.jsx)) and CSS radial gradients rather than heavy raster PNG/MP4 backgrounds, keeping bundle size minimal.
- **Sound Effects (`SFX`)**: Managed centrally through [`src/lib/soundEffects.js`](src/lib/soundEffects.js) (`mashSounds` singleton persisted via `localStorage` key `mashvoice.sfxConfig`). Studio `.mp3` assets (once validated) belong in `public/sfx/` and should be pre-decoded via WebAudio `AudioBuffer` or played through `mashSounds` category gates (`callMusic`, `voiceSounds`, `messageSounds`).

---

## 5. Icon System

- **Library**: **`lucide-react`** (`^0.475.0`).
- **Import & Usage Convention**: Named `PascalCase` imports directly from `'lucide-react'`. Do **not** inline raw `<svg>` paths in React components when a Lucide icon exists (only custom brand marks like `/icon.svg` use custom SVG).
- **Sizing & Color Rules**:
  - Compact pills / inline metadata: `size={11}` to `size={13}`
  - Sidebar channels / dock controls / buttons: `size={14}` to `size={16}`
  - Stage headers / modal icons: `size={18}`
  - Colors inherit `currentColor` by default; semantic overrides pass CSS variables or hex (`color="#e55353"` for muted/danger, `color="#48c78e"` for active voice/E2EE).

```jsx
import { Mic, MicOff, Headphones, MonitorUp, Settings } from 'lucide-react';

<button type="button" className="win-btn" onClick={toggleMic}>
  {micMuted ? <MicOff size={16} color="#e55353" /> : <Mic size={16} />}
</button>
```

---

## 6. Styling Approach

- **Methodology**: Single global stylesheet ([`src/styles/index.css`](src/styles/index.css)) organized into numbered architectural sections:
  1. `Singularity Launcher` (`.launcher-root`, `.launcher-topbar`, `.gatekeeper-card`)
  2. `P2P Workspace` (`.workspace-shell`, `.workspace-grid`, `.server-rail`, `.channel-sidebar`, `.center-stage`, `.user-profile-dock`)
  3. `Voice, Stream & Chat` (`.voice-dock`, `.stage-header`, `.call-banner`)
  4. `Auto-Updater & Changelog` (`.update-pill`, `.update-floating-toast`, `.changelog-modal`)
  5. `Modals & Hardware/Security Settings` (`.modal-backdrop`, `.settings-modal`, `.hw-card`, `.hw-choice`)
  6. `Mobile App & Companion Drawer` (`.mobile-app-shell`, `.mobile-topbar`, `.mobile-tabbar`)
- **Frameless Window Drag Rules**:
  - Any custom topbar (`.launcher-topbar`, `.workspace-titlebar`) **must** set `-webkit-app-region: drag;` on the bar and `-webkit-app-region: no-drag;` on all interactive children (`button`, `a`, `input`).
- **Responsive & Multi-Form-Factor Rules**:
  - `html, body, #root` use `overflow: hidden; height: 100%;` (desktop app shell behavior, internal panes scroll independently).
  - Below `960px` (`@media (max-width: 960px)` in [`src/styles/index.css`](src/styles/index.css#L1965-L1989)), `.workspace-grid` collapses to `60px 210px 1fr`, `.members-sidebar` hides, and `.settings-modal` switches to single-column.
  - Below `640px` or with `?view=mobile` ([`src/App.jsx`](src/App.jsx#L22-L26)), the app renders `MobileApp` directly.

---

## 7. Project Structure

```text
MashVoice/
├── index.html                  # HTML entry, Google Fonts, PWA manifest link
├── package.json                # React 19, Lucide, Vite 6, Tauri CLI scripts
├── vite.config.js              # Dev server (:5173) + proxy to Rust (:3080)
├── Cargo.toml                  # Rust workspace root
├── public/
│   ├── icon.svg                # Vector brand mark
│   └── manifest.json           # Standalone mobile PWA manifest
├── src/
│   ├── main.jsx                # React root + installRustBridge() + index.css
│   ├── App.jsx                 # Session gatekeeper, updater & layout switcher
│   ├── styles/
│   │   └── index.css           # Global tokens + all component/layout rules
│   ├── components/             # UI screens, modals, context menus, WebGL canvas
│   └── lib/
│       ├── globalMesh.js       # Zero-IP WebSocket/REST E2EE client (zyntra.win)
│       ├── p2pEngine.js        # WebRTC DTLS-SRTP audio & 4K/120FPS video engine
│       ├── krispEngine.js      # Real-time AudioWorklet noise/keyboard isolation
│       ├── rustBridge.js       # Tauri IPC / HTTP bridge to Rust backend
│       └── soundEffects.js     # UI, call ringtones & event sound controller
├── crates/
│   ├── mashvoice-core/         # Rust crypto (MASH-SV4, AES-256-GCM), hardware, store
│   └── mashvoice-server/       # Local Axum HTTP/WS server & CLI
└── src-tauri/                  # Native Tauri v2 shell (1440×900 frameless)
```

---

## 8. Figma-to-Code & Code-to-Figma Design Rules

1. **Modern & Clean Aesthetic (« Épuré mais pas vide »)**:
   - Favor calm tonal contrast (`#090A0D` → `#0E1015` → `#13161E`) and crisp `1px` neutral borders (`rgba(255,255,255,0.065)`) over heavy drop-shadows, neon glows, or stacked decorative badges.
   - Never use purple/violet accents on dark surfaces; maintain MashVoice's signature warm amber (`#E5A952` / `--gold-primary`) for primary actions and emerald (`#3ECF8E` / `--emerald`) for live voice/E2EE/MashKrisp indicators.
   - Keep screens alive with meaningful real-time context (connected peers in voice channels, compact latency/FPS telemetry in `JetBrains Mono`, subtle speaking rings, clean MashKrisp dB meter) rather than empty whitespace or filler bento cards.
2. **Figma Frame Dimensions**:
   - Desktop Frames: **`1440 × 900`** (matching `tauri.conf.json` window size) with Auto-Layout.
   - Settings Modal Frame: **`1000 × 700`** centered over backdrop (`236px` left nav + `1fr` content).
   - Stream / Utility Modal Frame: **`520px`** width Auto-Layout vertical stack.
   - Mobile Companion Frame: **`375 × 812`** (`52px` topbar + `1fr` body + `62px` 4-tab bar).
