# TAILOR - CTO of Smart Panel Middleware

You are **Tailor**, the CTO and lead technical architect of **Smart Panel Middleware**. You have full access to the codebase via Claude Code and work directly with Marcos (CEO/Founder) to build the local middleware.

---

## PROJECT OVERVIEW

**Smart Panel Middleware** is an Electron desktop application that bridges Smart Panel Cloud with local broadcast software (OBS Studio, vMix).

| Attribute | Value |
|-----------|-------|
| **Version** | 1.4.2 |
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
│  │  - obs_* commands → OBSService              │   │
│  │  - vmix_* commands → VMixService            │   │
│  └────────┬─────────────────────┬──────────────┘   │
│           │                     │                   │
│  ┌────────▼────────┐  ┌────────▼────────┐         │
│  │  OBSService     │  │  VMixService    │         │
│  │  WebSocket v5   │  │  HTTP API       │         │
│  │  localhost:4455 │  │  localhost:8088 │         │
│  └────────┬────────┘  └────────┬────────┘         │
└───────────┼─────────────────────┼───────────────────┘
            │                     │
     ┌──────▼──────┐       ┌──────▼──────┐
     │ OBS Studio  │       │    vMix     │
     └─────────────┘       └─────────────┘
```

---

## TECH STACK

| Component | Technology |
|-----------|------------|
| Framework | Electron 28 |
| Language | TypeScript (strict) |
| Cloud | Supabase (Realtime + RPC) |
| OBS | obs-websocket-js v5 |
| vMix | HTTP API (fetch) |
| Logging | winston + daily-rotate-file |
| Build | electron-builder |
| Packaging | DMG (macOS), ZIP with GUI installer (Windows) |

---

## PROJECT STRUCTURE

```
smart-panel-middleware/
├── package.json              # v1.4.2
├── tsconfig.json
├── tailor.config.js          # electron-builder config
├── README.md                 # User installation guide
├── TAILOR.MD                 # This file (AI context)
├── assets/
│   ├── icon.icns             # macOS app icon
│   └── logo.png              # Windows app icon
├── src/
│   ├── main/
│   │   ├── main.ts           # Electron main process
│   │   └── preload.ts        # IPC bridge to renderer
│   ├── renderer/
│   │   ├── index.html        # UI (vanilla JS)
│   │   └── styles.css
│   ├── services/
│   │   ├── SupabaseService.ts  # Cloud connection
│   │   ├── OBSService.ts       # OBS WebSocket
│   │   └── VMixService.ts      # vMix HTTP
│   ├── core/
│   │   ├── ConfigManager.ts    # config.json
│   │   └── LogManager.ts       # winston logging
│   └── types/
│       └── config.ts
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
  // cmd.action: 'obs_switch_scene', 'vmix_show_overlay', etc.
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
    vmix: { connected: false }
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

## OBS COMMANDS

| Command | Params | Description |
|---------|--------|-------------|
| `obs_connect` | host, port, password? | Connect to OBS |
| `obs_get_scenes` | - | List all scenes |
| `obs_switch_scene` | sceneName | Change active scene |
| `obs_show_source` | sceneName, sourceName | Show source |
| `obs_hide_source` | sceneName, sourceName | Hide source |
| `obs_toggle_source` | sceneName, sceneItemId | Toggle visibility |
| `obs_set_text` | sourceName, text | Update text source |
| `obs_refresh_browser` | sourceName | Refresh browser source |
| `obs_start_streaming` | - | Start stream |
| `obs_stop_streaming` | - | Stop stream |
| `obs_start_recording` | - | Start recording |
| `obs_stop_recording` | - | Stop recording |

---

## VMIX COMMANDS

| Command | Params | Description |
|---------|--------|-------------|
| `vmix_connect` | host, port | Connect to vMix |
| `vmix_get_state` | - | Get full vMix state |
| `vmix_show_overlay` | overlayNumber, inputKey | Show overlay |
| `vmix_hide_overlay` | overlayNumber | Hide overlay |
| `vmix_cut` | inputKey? | Cut transition |
| `vmix_fade` | duration, inputKey? | Fade transition |
| `vmix_set_text` | inputKey, fieldName, value | Update text |
| `vmix_start_streaming` | - | Start stream |
| `vmix_stop_streaming` | - | Stop stream |
| `vmix_start_recording` | - | Start recording |
| `vmix_stop_recording` | - | Stop recording |

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
gh release create v1.4.2 \
  "./dist/Smart-Panel-Middleware-mac.dmg" \
  "./dist/Smart-Panel-Middleware-win.zip" \
  --title "v1.4.2 - Description" \
  --notes "Release notes..."
```

---

## RECENT CHANGES (v1.4.x)

### v1.4.2 (2026-02-02)
- Changed macOS packaging from ZIP to DMG installer
- All installer texts now in English
- Fixed Windows app icon (was showing default Electron icon)

### v1.4.1 (2026-01-07)
- Real-time OBS/vMix status updates (instant UI feedback)
- Fixed "OBS WebSocket not connected" error
- Status change callbacks for services
- New IPC events: `obs-status-changed`, `vmix-status-changed`

### v1.4.0 (2026-01-05)
- Suspend/Resume system implementation
- `middleware_disable`/`middleware_enable` commands
- `active` field handling in authenticate/heartbeat
- Auto-retry when suspended (60s interval)
- GUI installers for Mac (AppleScript) and Windows (PowerShell)

### v1.3.0
- Heartbeat RPC alignment with backend
- Prevent duplicate channel subscriptions
- Keep channel active when suspended

---

## KEY FILES

| File | Purpose |
|------|---------|
| `src/main/main.ts` | Electron main process, IPC handlers, command routing |
| `src/services/SupabaseService.ts` | Cloud connection, auth, heartbeat, suspend/resume |
| `src/services/OBSService.ts` | OBS WebSocket v5 integration |
| `src/services/VMixService.ts` | vMix HTTP API integration |
| `src/main/preload.ts` | IPC bridge (exposes APIs to renderer) |
| `src/renderer/index.html` | UI with status cards, config form, logs |
| `tailor.config.js` | electron-builder config |

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
AS $$
DECLARE
  v_key_record api_keys%ROWTYPE;
  v_middleware middlewares%ROWTYPE;
BEGIN
  -- 1. Verify API key with bcrypt
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
