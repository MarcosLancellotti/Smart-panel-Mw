# Smart Panel Middleware - Technical Documentation

**Version:** 1.6.2
**Last Updated:** 2026-02-16
**Platform:** macOS (Apple Silicon), Windows (x64)

---

## 1. GENERAL ARCHITECTURE

### Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Electron | 28.x |
| Language | TypeScript | 5.3.x |
| Cloud | Supabase (Realtime + RPC) | 2.89.x |
| OBS Integration | obs-websocket-js | 5.0.5 |
| vMix Integration | HTTP API (axios) | - |
| CasparCG Integration | TCP (AMCP protocol) | - |
| Logging | winston + daily-rotate-file | 3.11.x |
| Build | electron-builder | 24.x |

### Project Structure

```
smart-panel-middleware/
├── src/
│   ├── main/
│   │   ├── main.ts           # Electron main process, command routing
│   │   └── preload.ts        # IPC bridge (contextBridge)
│   ├── renderer/
│   │   ├── index.html        # UI
│   │   └── styles.css
│   ├── services/
│   │   ├── SupabaseService.ts  # Cloud connection, auth, realtime
│   │   ├── OBSService.ts       # OBS WebSocket client
│   │   ├── VMixService.ts      # vMix HTTP client
│   │   └── CasparCGService.ts  # CasparCG TCP client (AMCP)
│   ├── core/
│   │   ├── ConfigManager.ts    # Local config persistence
│   │   └── LogManager.ts       # Logging with rotation
│   └── types/
│       └── config.ts           # TypeScript interfaces
├── assets/
│   ├── icon.icns               # macOS icon
│   └── logo.png                # Windows icon
├── tailor.config.js            # electron-builder config
└── package.json
```

### Key Dependencies

```json
{
  "@supabase/supabase-js": "^2.89.0",
  "obs-websocket-js": "^5.0.5",
  "axios": "^1.6.0",
  "winston": "^3.11.0",
  "ws": "^8.14.0"
}
```

---

## 2. AUTHENTICATION FLOW

### Step 1: User enters API Key

The user enters their API key in the UI (format: `sp_xxxxxxxxxxxx`).

### Step 2: RPC Call - `authenticate_middleware`

```typescript
const { data, error } = await supabase.rpc('authenticate_middleware', {
  p_api_key: apiKey,
  p_machine_name: os.hostname(),
  p_metadata: {
    appVersion: '1.6.2',
    os: process.platform,
    nodeVersion: process.version
  }
});
```

### Step 3: RPC Response

```json
{
  "success": true,
  "company_id": "uuid",
  "api_key_id": "uuid",
  "api_key_name": "My API Key",
  "middleware_id": "uuid",      // IMPORTANT: Used for channel subscription
  "active": true,
  "suspend_reason": null
}
```

### Step 4: Data Saved Locally

After successful authentication, the middleware saves:

```json
// Location: ~/Library/Application Support/Smart Panel Middleware/config.json
{
  "smartPanel": {
    "apiKey": "sp_xxxx...",
    "companyId": "uuid"
  }
}
```

### Reconnection Handling

- On app startup, if `apiKey` exists in config, auto-connects
- If connection fails, shows error in UI
- If suspended, retries every 60 seconds

---

## 3. SUPABASE REALTIME CHANNELS

### Channel Subscription

After authentication, subscribes to:

```typescript
const channelName = `middleware:${middlewareId}`;
// Example: middleware:15d2393a-131d-4e04-a999-f64b5721dd4e

const channel = supabase.channel(channelName, {
  config: { broadcast: { self: false } }
});

channel.on('broadcast', { event: 'command' }, (payload) => {
  // Handle incoming commands
});

channel.subscribe();
```

### Events Listened

| Event | Purpose |
|-------|---------|
| `command` | Incoming commands from Smart Panel Cloud |

### Reconnection Handling

- Supabase client handles automatic reconnection
- If channel times out, logs error
- Heartbeat failure triggers status update

---

## 4. SUPPORTED COMMANDS

### System Commands

| Action | Parameters | Description | Response |
|--------|------------|-------------|----------|
| `ping` | - | Test connectivity | `{ pong: true, timestamp: number }` |
| `middleware_disable` | `reason`, `message` | Suspend middleware | `{ acknowledged: true }` |
| `middleware_enable` | - | Resume middleware | `{ acknowledged: true }` |

### OBS Commands

| Action | Parameters | Description |
|--------|------------|-------------|
| `obs_connect` | `host`, `port`, `password?` | Connect to OBS |
| `obs_get_scenes` | - | Get all scenes |
| `obs_get_current_scene` | - | Get active scene |
| `obs_switch_scene` | `sceneName` | Change scene |
| `obs_set_scene` | `sceneName` or `scene` | Alias for switch |
| `obs_get_sources` | `sceneName` | Get scene sources |
| `obs_show_source` | `sceneName`, `sourceName` | Show source |
| `obs_hide_source` | `sceneName`, `sourceName` | Hide source |
| `obs_toggle_source` | `sceneName`, `sceneItemId` or `sourceName` | Toggle visibility |
| `obs_source_visibility` | `sceneName`, `sceneItemId`, `visible` | Set visibility |
| `obs_set_text` | `sourceName`, `text` | Update text source |
| `obs_refresh_browser` | `sourceName` | Refresh browser source |
| `obs_set_browser_url` | `sourceName`, `url` | Change browser URL |
| `obs_start_streaming` | - | Start stream |
| `obs_stop_streaming` | - | Stop stream |
| `obs_start_recording` | - | Start recording |
| `obs_stop_recording` | - | Stop recording |
| `obs_get_stream_status` | - | Get stream status |
| `obs_get_record_status` | - | Get record status |

### vMix Commands

| Action | Parameters | Description |
|--------|------------|-------------|
| `vmix_connect` | `host`, `port` | Connect to vMix |
| `vmix_get_state` | - | Get full vMix state |
| `vmix_show_overlay` | `overlayNumber`, `inputKey` | Show overlay |
| `vmix_hide_overlay` | `overlayNumber` | Hide overlay |
| `vmix_transition` | `inputKey`, `transition`, `duration` | Transition input |
| `vmix_cut` | `inputKey?` | Cut transition |
| `vmix_fade` | `duration`, `inputKey?` | Fade transition |
| `vmix_set_text` | `inputKey`, `fieldName`, `value` | Update text |
| `vmix_start_streaming` | - | Start stream |
| `vmix_stop_streaming` | - | Stop stream |
| `vmix_start_recording` | - | Start recording |
| `vmix_stop_recording` | - | Stop recording |

### CasparCG Commands

| Action | Parameters | Description |
|--------|------------|-------------|
| `caspar_connect` | `host`, `port` | Connect to CasparCG |
| `caspar_play` | `channel`, `layer`, `clip?` | Play media on channel/layer |
| `caspar_stop` | `channel`, `layer` | Stop playback |
| `caspar_load` | `channel`, `layer`, `clip` | Load media (paused) |
| `caspar_loadbg` | `channel`, `layer`, `clip`, `auto?` | Load in background |
| `caspar_clear` | `channel`, `layer?` | Clear channel or layer |
| `caspar_cg_add` | `channel`, `layer`, `template`, `playOnLoad`, `data?` | Add CG template |
| `caspar_cg_update` | `channel`, `layer`, `data` | Update template data |
| `caspar_cg_stop` | `channel`, `layer` | Stop template |
| `caspar_cg_next` | `channel`, `layer` | Trigger next in template |
| `caspar_cg_clear` | `channel`, `layer` | Clear all templates |
| `caspar_cg_play` | `channel`, `layer` | Play stopped template |

---

## 5. MESSAGE FORMAT

### Incoming Command (from Smart Panel Cloud)

```json
{
  "action": "obs_switch_scene",
  "params": {
    "sceneName": "Main Scene"
  },
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "response_channel": "response:550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1706871234567
}
```

### Success Response

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "data": {
    "sceneName": "Main Scene"
  }
}
```

### Error Response

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "success": false,
  "error": "OBS WebSocket not connected"
}
```

### Response Delivery

Responses are sent to the `response_channel` specified in the command:

```typescript
const respChannel = supabase.channel(responseChannel);
respChannel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    respChannel.send({
      type: 'broadcast',
      event: 'response',
      payload: { request_id, success, data }
    });
  }
});
```

---

## 6. LOCAL CONNECTIONS

### OBS Connection

| Property | Value |
|----------|-------|
| Protocol | WebSocket |
| Library | obs-websocket-js v5 |
| Default Host | localhost |
| Default Port | 4455 |
| Authentication | Optional password |

```typescript
// Connection
const obs = new OBSWebSocket();
await obs.connect(`ws://${host}:${port}`, password);

// Status reporting
{
  connected: true,
  version: "30.0.0",
  host: "localhost",
  port: 4455
}
```

### vMix Connection

| Property | Value |
|----------|-------|
| Protocol | HTTP |
| Library | axios |
| Default Host | localhost |
| Default Port | 8088 |
| API Endpoint | `http://{host}:{port}/api` |

```typescript
// Connection test
const response = await axios.get(`http://${host}:${port}/api`);

// Status reporting
{
  connected: true,
  version: "27.0.0.45",
  host: "localhost",
  port: 8088
}
```

### CasparCG Connection

| Property | Value |
|----------|-------|
| Protocol | TCP (AMCP) |
| Library | Node.js `net.Socket` |
| Default Host | localhost |
| Default Port | 5250 |
| Command Format | `COMMAND\r\n` |
| Response Format | `{code} {message}\r\n` |

```typescript
// Connection
const socket = new net.Socket();
socket.connect(5250, 'localhost');

// Send AMCP command
socket.write('PLAY 1-10 "clip"\r\n');

// Status reporting
{
  connected: true,
  host: "localhost",
  port: 5250
}
```

### Status Reporting

Connection status is reported:
1. On initial connection
2. On status change (connect/disconnect)
3. Every heartbeat (30s)

```typescript
// Status update to Smart Panel
await supabaseService.updateConnectionStatus({
  obs: { connected: true, version: "30.0", host: "localhost", port: 4455 },
  vmix: { connected: false },
  casparcg: { connected: true, host: "localhost", port: 5250 }
});
```

---

## 7. HEARTBEAT / KEEP-ALIVE

### Configuration

| Property | Value |
|----------|-------|
| Interval | 30 seconds |
| RPC | `update_middleware_status` |

### Heartbeat Payload

```typescript
await supabase.rpc('update_middleware_status', {
  p_middleware_id: middlewareId,
  p_status: 'online',
  p_connections: {
    obs: { connected: true, version: '30.0', host: 'localhost', port: 4455 },
    vmix: { connected: false },
    casparcg: { connected: true, host: 'localhost', port: 5250 }
  },
  p_metadata: {
    appVersion: '1.6.2',
    os: 'darwin',
    lastHeartbeat: '2026-02-02T10:00:00.000Z'
  }
});
```

### Heartbeat Response

```json
{
  "success": true,
  "active": true,
  "suspend_reason": null
}
```

If `active: false`, middleware enters suspended state.

---

## 8. ERROR HANDLING

### OBS Not Connected

```typescript
if (!obsService.isConnected()) {
  await supabaseService.sendError(requestId, 'OBS WebSocket not connected', responseChannel);
  return;
}
```

### Supabase Connection Lost

- Supabase client handles automatic reconnection
- Heartbeat failures are logged
- UI shows disconnected state

### Logging

```typescript
// Log levels: info, warn, error, debug
logger.info('[OBS] Connected!');
logger.warn('[API] Auto-connect failed');
logger.error('[OBS] Command failed', error);
```

Logs are stored in:
- **Mac:** `~/Library/Application Support/Smart Panel Middleware/logs/`
- **Windows:** `%APPDATA%/Smart Panel Middleware/logs/`

---

## 9. LOCAL STORAGE

### Config File Location

- **Mac:** `~/Library/Application Support/Smart Panel Middleware/config.json`
- **Windows:** `%APPDATA%/Smart Panel Middleware/config.json`

### Config Structure

```json
{
  "smartPanel": {
    "apiKey": "sp_xxxxxxxxxxxx",
    "companyId": "5e0c19eb-3b7b-4530-8ec8-85fe5dee693f"
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
  "runAsService": false
}
```

### Storage Method

Uses Node.js `fs` module with JSON serialization (via ConfigManager class).

---

## 10. KEY CODE SNIPPETS

### Authentication Function

```typescript
// src/services/SupabaseService.ts
async authenticate(apiKey: string): Promise<AuthResult> {
  const { data, error } = await this.supabase.rpc('authenticate_middleware', {
    p_api_key: apiKey,
    p_machine_name: os.hostname(),
    p_metadata: {
      appVersion: APP_VERSION,
      os: process.platform,
      nodeVersion: process.version
    }
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data.success) {
    this.middlewareId = data.middleware_id;  // Used for channel subscription
    this.companyId = data.company_id;
    this.apiKeyName = data.api_key_name;
    return { success: true, ...data };
  }

  return { success: false, error: data.error };
}
```

### Channel Subscription

```typescript
// src/services/SupabaseService.ts
subscribeToCommands(onCommand?: (command: CommandPayload) => void): void {
  const channelName = `middleware:${this.middlewareId}`;

  this.channel = this.supabase.channel(channelName, {
    config: { broadcast: { self: false } }
  });

  this.channel.on('broadcast', { event: 'command' }, async (payload) => {
    const cmd = payload.payload as CommandPayload;

    // Handle ping
    if (cmd.action === 'ping') {
      this.sendPong(cmd.request_id);
      if (cmd.response_channel) {
        await this.sendResponse(cmd.request_id!, {
          success: true,
          data: { pong: true, timestamp: Date.now() }
        }, cmd.response_channel);
      }
      return;
    }

    // Forward to handler
    if (onCommand) {
      onCommand(cmd);
    }
  });

  this.channel.subscribe();
}
```

### Command Handler (Router)

```typescript
// src/main/main.ts
function handleCommand(cmd: CommandPayload): void {
  logger.info(`[Command] Received: ${cmd.action}`);

  if (cmd.action.startsWith('obs_')) {
    handleOBSCommand(cmd);
    return;
  }

  if (cmd.action.startsWith('vmix_')) {
    handleVMixCommand(cmd);
    return;
  }

  if (cmd.action.startsWith('caspar_')) {
    handleCasparCGCommand(cmd);
    return;
  }
}
```

### OBS Connection

```typescript
// src/services/OBSService.ts
async connect(config: { host: string; port: number; password?: string }) {
  try {
    const url = `ws://${config.host}:${config.port}`;
    await this.obs.connect(url, config.password);

    const version = await this.obs.call('GetVersion');
    this.status = {
      connected: true,
      version: version.obsVersion,
      host: config.host,
      port: config.port
    };

    return { connected: true, version: version.obsVersion };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}
```

### vMix Connection

```typescript
// src/services/VMixService.ts
async connect(config: { host: string; port: number }) {
  try {
    const url = `http://${config.host}:${config.port}/api`;
    const response = await axios.get(url);

    // Parse XML response for version
    const parser = new XMLParser();
    const result = parser.parse(response.data);
    const version = result.vmix?.version;

    this.status = {
      connected: true,
      version,
      host: config.host,
      port: config.port
    };

    return { connected: true, version };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}
```

### CasparCG Connection

```typescript
// src/services/CasparCGService.ts
async connect(config: { host: string; port: number }) {
  const socket = new net.Socket();
  socket.connect(config.port, config.host, () => {
    this._connected = true;
  });

  // AMCP commands: write command + \r\n, parse response code
  async sendCommand(command: string) {
    socket.write(command + '\r\n');
    // Response: "{code} {message}\r\n"
    // 2xx = success, 4xx/5xx = error
  }
}
```

---

## 11. SUPABASE RPC FUNCTIONS

### `authenticate_middleware`

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
    'middleware_id', v_middleware.id,  -- IMPORTANT: Real middleware ID
    'active', COALESCE(v_middleware.active, true),
    'suspend_reason', v_middleware.suspend_reason
  );
END;
$$;
```

### `update_middleware_status`

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

## 12. VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 1.6.2 | 2026-02-16 | CasparCG integration (AMCP/TCP), manual Check for Updates button |
| 1.5.0 | 2026-02-15 | Version bump, build improvements |
| 1.4.2 | 2026-02-02 | DMG installer, English UI, fixed auth bcrypt vs SHA256, fixed middleware_id channel |
| 1.4.1 | 2026-01-07 | Real-time OBS/vMix status updates |
| 1.4.0 | 2026-01-05 | Suspend/Resume system, GUI installers |
| 1.3.0 | - | Heartbeat RPC alignment |

---

## 13. TROUBLESHOOTING

### "Invalid or inactive API Key"

**Cause:** The RPC function was using SHA256 instead of bcrypt to verify the key hash.

**Fix:** Update `authenticate_middleware` to use `crypt(p_api_key, key_hash)`.

### "Ping timeout" / Commands not received

**Cause:** Middleware subscribing to wrong channel (using `api_key_id` instead of `middleware_id`).

**Fix:** Ensure `authenticate_middleware` returns the real `middleware_id` from the `middlewares` table, not the `api_key_id`.

### "Smart Panel Middleware is damaged" (macOS)

**Cause:** App is not signed, macOS quarantine blocks it.

**Fix:** Run in Terminal:
```bash
xattr -cr /Applications/Smart\ Panel\ Middleware.app
```
