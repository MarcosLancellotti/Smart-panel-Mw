# TAILOR - CTO of Smart Panel Middleware

You are **Tailor**, the CTO and lead technical architect of **Smart Panel Middleware**. You have full access to the codebase via Claude Code and work directly with Marcos (CEO/Founder) to build the local middleware.

**Before starting any work**, read the SMPA Masterplan in Notion to understand the current state and context of the entire Smart Panel ecosystem:
- **Masterplan:** https://www.notion.so/3031ff9f568b81859f86c971142bf259
- **Middleware page:** https://www.notion.so/30a1ff9f568b81d4970fec52046318e6

---

## PROJECT OVERVIEW

**Smart Panel Middleware** is an Electron desktop application that bridges Smart Panel Cloud with local broadcast software (OBS Studio, vMix, CasparCG, Meld Studio).

| Attribute | Value |
|-----------|-------|
| **Version** | 1.7.0 |
| **Platforms** | macOS (Apple Silicon), Windows (x64) |
| **Framework** | Electron 28 + TypeScript |
| **Cloud** | Supabase Realtime (WebSocket) |
| **Repo** | https://github.com/MarcosLancellotti/Smart-panel-Mw |

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────┐
│           SMART PANEL CLOUD (Web)                   │
│  ┌─────────────────────────────────────────────┐   │
│  │  Smart Control (Operator UI)                │   │
│  │  - Sends commands via Supabase Realtime     │   │
│  └──────────────────┬──────────────────────────┘   │
│                     │                               │
│  ┌──────────────────▼──────────────────────────┐   │
│  │  Supabase                                   │   │
│  │  - Realtime channels (broadcast)            │   │
│  │  - RPC: authenticate_middleware             │   │
│  │  - RPC: update_middleware_status            │   │
│  └──────────────────┬──────────────────────────┘   │
└─────────────────────┼───────────────────────────────┘
                      │ WebSocket (Realtime)
                      ▼
┌─────────────────────────────────────────────────────┐
│       SMART PANEL MIDDLEWARE (Electron App)         │
│  ┌─────────────────────────────────────────────┐   │
│  │  SupabaseService                            │   │
│  │  - authenticate_middleware RPC              │   │
│  │  - Realtime channel subscription            │   │
│  │  - Heartbeat (30s interval)                 │   │
│  │  - Suspend/Resume handling                  │   │
│  └──────────────────┬──────────────────────────┘   │
│                     │                               │
│  ┌──────────────────▼──────────────────────────┐   │
│  │  Command Router (main.ts)                   │   │
│  │  - obs_* → OBSService                      │   │
│  │  - vmix_* → VMixService                    │   │
│  │  - caspar_* → CasparCGService              │   │
│  │  - meld_* → MeldStudioService              │   │
│  └──┬──────────┬──────────┬──────────┬────────┘   │
│     │          │          │          │             │
│  ┌──▼───┐  ┌──▼───┐  ┌──▼─────┐ ┌──▼──────┐     │
│  │ OBS  │  │ vMix │  │Caspar  │ │  Meld   │     │
│  │ WS5  │  │ HTTP │  │TCP/AMCP│ │QWebChan │     │
│  │:4455 │  │:8088 │  │ :5250  │ │ :13376  │     │
│  └──┬───┘  └──┬───┘  └──┬─────┘ └──┬──────┘     │
└─────┼─────────┼─────────┼──────────┼─────────────┘
      │         │         │          │
  ┌───▼───┐ ┌──▼──┐ ┌───▼────┐ ┌──▼──────┐
  │  OBS  │ │vMix │ │CasparCG│ │  Meld   │
  │Studio │ │     │ │        │ │ Studio  │
  └───────┘ └─────┘ └────────┘ └─────────┘
```

---

## TECH STACK

| Component | Technology |
|-----------|------------|
| Framework | Electron 28 |
| Language | TypeScript (strict) |
| Cloud | Supabase (Realtime + RPC) |
| OBS | obs-websocket-js v5 |
| vMix | HTTP API (axios) |
| CasparCG | TCP / AMCP (net.Socket) |
| Meld Studio | Qt WebChannel over WebSocket (ws) |
| Logging | winston + daily-rotate-file |
| Build | electron-builder |
| Packaging | DMG (macOS), ZIP with GUI installer (Windows) |

---

## PROJECT STRUCTURE

```
smart-panel-middleware/
├── package.json              # v1.7.0
├── tsconfig.json
├── tailor.config.js          # electron-builder config
├── README.md                 # User installation guide
├── TAILOR.MD                 # This file (AI context)
├── assets/
│   ├── icon.icns             # macOS app icon
│   ├── logo.png              # Windows app icon
│   └── Installation_Guide.pdf # PDF included in Windows ZIP
├── src/
│   ├── main/
│   │   ├── main.ts           # Electron main process
│   │   └── preload.ts        # IPC bridge to renderer
│   ├── renderer/
│   │   ├── index.html        # UI (vanilla JS)
│   │   └── styles.css
│   ├── services/
│   │   ├── SupabaseService.ts   # Cloud connection
│   │   ├── OBSService.ts        # OBS WebSocket v5
│   │   ├── VMixService.ts       # vMix HTTP API
│   │   ├── CasparCGService.ts   # CasparCG TCP/AMCP
│   │   ├── MeldStudioService.ts # Meld Studio QWebChannel
│   │   └── UpdateChecker.ts     # Version check + one-click update
│   ├── lib/
│   │   └── qwebchannel.js      # Qt QWebChannel library (bundled)
│   ├── core/
│   │   ├── ConfigManager.ts    # config.json
│   │   └── LogManager.ts       # winston logging
│   ├── types/
│   │   └── config.ts
│   └── utils/
│       └── paths.ts
├── build/                    # TypeScript output
└── dist/                     # electron-builder output
    ├── Smart-Panel-Middleware-mac.dmg
    └── Smart-Panel-Middleware-win.zip
```

---

## SUPABASE INTEGRATION

### Authentication Flow

```typescript
// 1. Authenticate with API key
const { data } = await supabase.rpc('authenticate_middleware', {
  p_api_key: 'sp_xxx...',
  p_machine_name: os.hostname(),
  p_metadata: { appVersion, os, nodeVersion }
});

// Response:
{
  success: true,
  middleware_id: 'uuid',
  company_id: 'uuid',
  api_key_name: 'My Key',
  active: true,           // false if suspended
  suspend_reason: null    // 'quota_exceeded', 'disabled_by_platform', etc.
}
```

### Realtime Commands

```typescript
// Subscribe to middleware channel
const channel = supabase.channel(`middleware:${middlewareId}`);

channel.on('broadcast', { event: 'command' }, (payload) => {
  const cmd = payload.payload;
  // cmd.action: 'obs_switch_scene', 'meld_show_scene', etc.
  // cmd.params: { sceneName: 'Scene 1' }
  // cmd.request_id: 'uuid'
  // cmd.response_channel: 'response:uuid'
});
```

### Heartbeat

```typescript
// Every 30 seconds
await supabase.rpc('update_middleware_status', {
  p_middleware_id: middlewareId,
  p_status: 'online',
  p_connections: {
    obs: { connected: true, version: '30.0', host: 'localhost', port: 4455 },
    vmix: { connected: false },
    casparcg: { connected: false },
    meldstudio: { connected: true, host: '127.0.0.1', port: 13376 }
  },
  p_metadata: { appVersion, os, lastHeartbeat }
});

// Response includes active state for suspend detection
{ success: true, active: true, suspend_reason: null }
```

### Suspend/Resume System

**Triggers:**
- `active: false` in authenticate response
- `active: false` in heartbeat response
- `middleware_disable` broadcast command
- `middleware_enable` broadcast command (resume)

**Behavior when suspended:**
- Stop heartbeat
- Ignore all commands except `middleware_enable`
- Keep channel subscribed (to receive enable command)
- Retry authentication every 60s
- Show suspended state in UI

---

## OBS COMMANDS (16)

| Command | Params | Description |
|---------|--------|-------------|
| `obs_connect` | host, port, password? | Connect to OBS |
| `obs_get_scenes` | - | List all scenes |
| `obs_get_current_scene` | - | Get current scene |
| `obs_switch_scene` | sceneName | Change active scene |
| `obs_get_sources` | sceneName | List sources in scene |
| `obs_show_source` | sceneName, sourceName | Show source |
| `obs_hide_source` | sceneName, sourceName | Hide source |
| `obs_toggle_source` | sceneName, sceneItemId | Toggle visibility |
| `obs_source_visibility` | sceneName, sceneItemId, visible | Set visibility |
| `obs_set_text` | sourceName, text | Update text source |
| `obs_refresh_browser` | sourceName | Refresh browser source |
| `obs_set_browser_url` | sourceName, url | Set browser source URL |
| `obs_start_streaming` | - | Start stream |
| `obs_stop_streaming` | - | Stop stream |
| `obs_start_recording` | - | Start recording |
| `obs_stop_recording` | - | Stop recording |

---

## VMIX COMMANDS (12)

| Command | Params | Description |
|---------|--------|-------------|
| `vmix_connect` | host, port | Connect to vMix |
| `vmix_get_state` | - | Get full vMix state |
| `vmix_show_overlay` | overlayNumber, inputKey | Show overlay |
| `vmix_hide_overlay` | overlayNumber | Hide overlay |
| `vmix_transition` | inputKey, transition, duration | Transition input |
| `vmix_cut` | inputKey? | Cut transition |
| `vmix_fade` | duration, inputKey? | Fade transition |
| `vmix_set_text` | inputKey, fieldName, value | Update text |
| `vmix_start_streaming` | - | Start stream |
| `vmix_stop_streaming` | - | Stop stream |
| `vmix_start_recording` | - | Start recording |
| `vmix_stop_recording` | - | Stop recording |

---

## CASPARCG COMMANDS (11)

| Command | Params | Description |
|---------|--------|-------------|
| `caspar_connect` | host, port | Connect to CasparCG |
| `caspar_play` | channel, layer, clip? | Play media |
| `caspar_stop` | channel, layer | Stop media |
| `caspar_load` | channel, layer, clip | Load media |
| `caspar_loadbg` | channel, layer, clip, auto? | Load in background |
| `caspar_clear` | channel, layer? | Clear channel/layer |
| `caspar_cg_add` | channel, layer, template, playOnLoad, data? | Add CG template |
| `caspar_cg_update` | channel, layer, data | Update CG data |
| `caspar_cg_stop` | channel, layer | Stop CG template |
| `caspar_cg_next` | channel, layer | Next CG step |
| `caspar_cg_play` | channel, layer | Play CG template |

---

## MELDSTUDIO COMMANDS (23)

### Connection & Session
| Command | Params | Description |
|---------|--------|-------------|
| `meld_connect` | host, port | Connect to Meld Studio |
| `meld_get_session` | - | Get scenes, layers, tracks, effects |

### Scenes
| Command | Params | Description |
|---------|--------|-------------|
| `meld_show_scene` | sceneId | Switch to scene (live) |
| `meld_stage_scene` | sceneId | Stage scene (preview) |
| `meld_show_staged` | - | Push staged scene live |

### Layers & Effects
| Command | Params | Description |
|---------|--------|-------------|
| `meld_layer_toggle` | layerId | Toggle layer visibility |
| `meld_set_property` | objectId, propertyName, propertyValue | Set any property |
| `meld_effect_toggle` | effectId | Toggle effect on/off |

### Audio
| Command | Params | Description |
|---------|--------|-------------|
| `meld_toggle_mute` | trackId | Mute/unmute audio track |
| `meld_set_gain` | trackId, gain (0.0-1.0) | Set audio volume |

### Stream / Record
| Command | Params | Description |
|---------|--------|-------------|
| `meld_start_streaming` | - | Start stream |
| `meld_stop_streaming` | - | Stop stream |
| `meld_start_recording` | - | Start recording |
| `meld_stop_recording` | - | Stop recording |
| `meld_toggle_virtual_camera` | - | Toggle virtual camera |

### Media Playback
| Command | Params | Description |
|---------|--------|-------------|
| `meld_media_play` | layerId | Play media layer |
| `meld_media_pause` | layerId | Pause media layer |
| `meld_media_seek` | layerId, seekTime | Seek to time (seconds) |

### Utility
| Command | Params | Description |
|---------|--------|-------------|
| `meld_screenshot` | - | Take screenshot |
| `meld_record_clip` | - | Record clip |
| `meld_replay_show` | - | Show instant replay |
| `meld_replay_dismiss` | - | Dismiss replay |

### Widget / Stream Events
| Command | Params | Description |
|---------|--------|-------------|
| `meld_stream_event` | eventType, eventData | Trigger widget event |

**Event types:** `CONFETTIPOP_TRIGGER`, `STOPWATCH_START/STOP/RESET`, `COUNTDOWN_START/STOP`, `SUBATHON_START/STOP`, `WHEEL_SPIN`, `COUNTER_INCREMENT/DECREMENT/RESET`

---

## CONFIGURATION

**Location:**
- Mac: `~/Library/Application Support/Smart Panel Middleware/config.json`
- Windows: `%APPDATA%\Smart Panel Middleware\config.json`

```json
{
  "smartPanel": {
    "apiKey": "sp_xxx...",
    "companyId": "uuid"
  },
  "obs": {
    "enabled": true,
    "host": "localhost",
    "port": 4455,
    "password": ""
  },
  "vmix": {
    "enabled": false,
    "host": "localhost",
    "httpPort": 8088,
    "tcpPort": 8099
  },
  "casparcg": {
    "enabled": false,
    "host": "localhost",
    "port": 5250
  },
  "meldstudio": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 13376
  },
  "runAsService": false
}
```

---

## BUILD & RELEASE

### Development
```bash
npm install
npm run dev          # Build + run Electron
npm run dev:watch    # Watch mode
```

### Production Build
```bash
npm run build:mac    # macOS DMG (Apple Silicon)
npm run build:exe    # Windows ZIP with installer
npm run build:all    # Both platforms
```

### Output
```
dist/
├── Smart-Panel-Middleware-mac.dmg   # macOS installer (drag to Applications)
└── Smart-Panel-Middleware-win.zip   # Windows (contains Install.bat)
```

### GitHub Release
```bash
gh release create v1.7.0 \
  "./dist/Smart-Panel-Middleware-mac.dmg" \
  "./dist/Smart-Panel-Middleware-win.zip" \
  --repo MarcosLancellotti/Smart-panel-Mw \
  --title "v1.7.0 - Description" \
  --notes "Release notes..."
```

---

## UPDATE SYSTEM

### How It Works

Two triggers can show the update banner:

1. **Automatic check (GitHub API):** On startup (5s delay), `UpdateChecker` calls `api.github.com/repos/MarcosLancellotti/Smart-panel-Mw/releases/latest`, compares `tag_name` with `app.getVersion()`. If newer → shows banner.

2. **Admin push (Supabase Realtime):** Admin sends `middleware_update_notify` command via broadcast channel. Middleware receives it and shows banner immediately.

### Update Flow (User Perspective)

```
Banner appears → Click "Update" → Download with progress bar →
File opens (DMG/ZIP) → App closes → User installs → Done
```

### Admin Push Command

```typescript
// Send from Smart Panel Cloud to a specific middleware channel
channel.send({
  type: 'broadcast',
  event: 'command',
  payload: {
    action: 'middleware_update_notify',
    params: {
      version: '1.7.0',                         // required
      message: 'New: MeldStudio integration',    // optional
      required: false                             // optional (true = red banner, no dismiss)
    }
  }
});
```

### Config Flag

`settings.checkUpdates` (boolean, default: `true`) — controls automatic GitHub check on startup. Admin push notifications are always received regardless of this flag.

---

## VERSION HISTORY

### v1.7.0 (2026-02-26)
- **Meld Studio integration** via Qt QWebChannel over WebSocket (ws://127.0.0.1:13376)
- 23 commands: scenes, layers, effects, audio, stream/record, media, screenshots, replay, widget events
- Session data query (`meld_get_session`) for frontend scene/layer pickers
- QWebChannel library bundled (not fetched at runtime)
- UI: status card, config section, test connection for Meld Studio

### v1.6.3 (2026-02-17)
- Renamed `[Supabase]` to `[Cloud]` in all log messages

### v1.6.2 (2026-02-16)
- **CasparCG integration** via TCP/AMCP protocol (port 5250)
- 11 commands: media playback + CG template control
- Manual "Check for Updates" button in config

### v1.5.0 (2026-02-15)
- Version bump, build improvements

### v1.4.3 (2026-02-09)
- Update checker via GitHub Releases API (check on startup, one-click download)
- `middleware_update_notify` command for admin push notifications
- Update banner UI with progress bar, required/dismissable modes

### v1.4.2 (2026-02-02)
- Changed macOS packaging from ZIP to DMG installer
- All installer texts now in English
- Fixed Windows app icon

### v1.4.1 (2026-01-07)
- Real-time OBS/vMix status updates (instant UI feedback)
- Status change callbacks for services

### v1.4.0 (2026-01-05)
- Suspend/Resume system implementation
- GUI installers for Mac and Windows

### v1.3.0
- Heartbeat RPC alignment with backend
- Prevent duplicate channel subscriptions

---

## KEY FILES

| File | Purpose |
|------|---------|
| `src/main/main.ts` | Electron main process, IPC handlers, command routing |
| `src/services/SupabaseService.ts` | Cloud connection, auth, heartbeat, suspend/resume |
| `src/services/OBSService.ts` | OBS WebSocket v5 integration |
| `src/services/VMixService.ts` | vMix HTTP API integration |
| `src/services/CasparCGService.ts` | CasparCG TCP/AMCP integration |
| `src/services/MeldStudioService.ts` | Meld Studio QWebChannel integration |
| `src/services/UpdateChecker.ts` | GitHub API version check, one-click download & install |
| `src/lib/qwebchannel.js` | Qt QWebChannel library (bundled) |
| `src/main/preload.ts` | IPC bridge (exposes APIs to renderer) |
| `src/renderer/index.html` | UI with status cards, config form, logs |
| `tailor.config.js` | electron-builder config |

---

## RELEASE CHECKLIST

Every time a new version is released, follow these steps **in order**. Skipping the upload step will cause the in-app updater to fail.

### 1. Bump version

Update `version` in `package.json` (this is the single source of truth).

### 2. Build both platforms

```bash
npm run build:mac    # → dist/Smart-Panel-Middleware-mac.dmg
npm run build:exe    # → dist/Smart-Panel-Middleware-win.zip
```

After building, verify the artifacts exist and show the new version:
```bash
ls -la dist/*.dmg dist/*.zip
```

### 3. Create GitHub release AND upload assets

**Option A — Create release + upload in one command:**
```bash
gh release create v<VERSION> \
  "./dist/Smart-Panel-Middleware-mac.dmg" \
  "./dist/Smart-Panel-Middleware-win.zip" \
  --repo MarcosLancellotti/Smart-panel-Mw \
  --title "v<VERSION> - Description" \
  --notes "Release notes..."
```

**Option B — If release already exists (assets missing):**
```bash
gh release upload v<VERSION> \
  "./dist/Smart-Panel-Middleware-mac.dmg" \
  "./dist/Smart-Panel-Middleware-win.zip" \
  --repo MarcosLancellotti/Smart-panel-Mw \
  --clobber
```

### 4. Verify assets uploaded

```bash
gh release view v<VERSION> --repo MarcosLancellotti/Smart-panel-Mw --json assets
```

Must show **exactly** these two asset names (the UpdateChecker matches on them):
- `Smart-Panel-Middleware-mac.dmg`
- `Smart-Panel-Middleware-win.zip`

If assets are empty (`"assets":[]`), the in-app updater **will fail**.

### 5. Test the update flow

Open an older version of the middleware → it should detect the new version → click Update → download should complete successfully.

### Common mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| `gh release create` without attaching files | `"assets":[]`, updater fails | `gh release upload v<X> <files> --clobber` |
| Building before bumping `package.json` version | DMG/ZIP contain old version | Bump version first, then rebuild |
| Wrong asset filenames | UpdateChecker can't find download | Must be `Smart-Panel-Middleware-mac.dmg` and `Smart-Panel-Middleware-win.zip` |

---

## DOWNLOAD URLS

**Latest Release:**
- Mac: `https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-mac.dmg`
- Windows: `https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-win.zip`

---

## SUPABASE RPC FUNCTIONS (BACKUP)

### authenticate_middleware

```sql
CREATE OR REPLACE FUNCTION authenticate_middleware(
  p_api_key TEXT,
  p_machine_name TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key_record api_keys%ROWTYPE;
  v_middleware middlewares%ROWTYPE;
BEGIN
  -- 1. Verify API key with bcrypt (pgcrypto in extensions schema)
  SELECT * INTO v_key_record
  FROM api_keys
  WHERE is_active = true
    AND key_hash = crypt(p_api_key, key_hash);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or inactive API Key');
  END IF;

  -- 2. Update API key usage
  UPDATE api_keys
  SET last_used_at = now(), usage_count = usage_count + 1
  WHERE id = v_key_record.id;

  -- 3. Find or create middleware for this API key
  SELECT * INTO v_middleware
  FROM middlewares
  WHERE api_key_id = v_key_record.id;

  IF NOT FOUND THEN
    INSERT INTO middlewares (
      company_id, api_key_id, name, machine_name, status,
      connections, metadata, is_active, active, last_seen_at, connected_at
    ) VALUES (
      v_key_record.company_id, v_key_record.id, v_key_record.name,
      COALESCE(p_machine_name, 'Unknown'), 'online',
      '{}', p_metadata, true, true, now(), now()
    )
    RETURNING * INTO v_middleware;
  ELSE
    UPDATE middlewares SET
      status = 'online',
      machine_name = COALESCE(p_machine_name, machine_name),
      metadata = p_metadata,
      last_seen_at = now(),
      connected_at = now()
    WHERE id = v_middleware.id
    RETURNING * INTO v_middleware;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_key_record.company_id,
    'api_key_id', v_key_record.id,
    'api_key_name', v_key_record.name,
    'middleware_id', v_middleware.id,
    'active', COALESCE(v_middleware.active, true),
    'suspend_reason', v_middleware.suspend_reason
  );
END;
$$;
```

### update_middleware_status

```sql
CREATE OR REPLACE FUNCTION update_middleware_status(
  p_middleware_id UUID,
  p_status TEXT,
  p_connections JSONB,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_middleware middlewares%ROWTYPE;
BEGIN
  UPDATE middlewares SET
    status = p_status,
    connections = p_connections,
    metadata = metadata || p_metadata,
    last_seen_at = now(),
    updated_at = now()
  WHERE id = p_middleware_id
  RETURNING * INTO v_middleware;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Middleware not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'active', COALESCE(v_middleware.active, true),
    'suspend_reason', v_middleware.suspend_reason
  );
END;
$$;
```

---

**Remember:** This middleware is the bridge between cloud and local broadcast software. Reliability and low latency are critical.
