# Smart Panel Middleware

Local middleware for Smart Panel - Bridge between cloud and OBS/vMix.

## Download

| Platform | Download |
|----------|----------|
| **Mac (Apple Silicon)** | [Smart-Panel-Middleware-mac.zip](https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-mac.zip) |
| **Windows (64-bit)** | [Smart-Panel-Middleware-win.zip](https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-win.zip) |

---

## Installation

### Mac

1. **Download** `Smart-Panel-Middleware-mac.zip`
2. **Unzip** the file (double-click)
3. **Open Terminal** and run:
   ```bash
   cd ~/Downloads/Smart-Panel-Middleware-mac
   chmod +x install.command
   ./install.command
   ```
   Or double-click `install.command`
4. **Follow the prompts** to install

> **Note:** If you see "file is damaged", run: `xattr -cr ~/Downloads/Smart-Panel-Middleware-mac`

### Windows

1. **Download** `Smart-Panel-Middleware-win.zip`
2. **Unzip** the file (right-click → Extract All)
3. **Double-click** `Install.bat`
4. If Windows SmartScreen appears:
   - Click "More info"
   - Click "Run anyway"
5. **Follow the prompts** to install

---

## First Run Setup

1. **Open** Smart Panel Middleware
2. Go to **Configuration** tab
3. Enter your **API Key** (get it from [smart-panel.app/integrations](https://smart-panel.app/integrations))
4. Click **Verify**
5. Enable **OBS** and/or **vMix** if needed
6. Click **Save Configuration**

---

## Features

- Remote control OBS/vMix from Smart Panel web interface
- Zero latency local execution
- Real-time connection status
- Auto-reconnect on connection loss

---

## Supported Integrations

### OBS Studio
- Switch scenes
- Show/hide sources
- Control streaming & recording
- Update text sources
- Refresh browser sources

### vMix
- Show/hide overlays
- Cut/fade transitions
- Update text inputs
- Control streaming & recording

---

## Troubleshooting

### "OBS connection failed"
1. Open OBS Studio
2. Go to: Tools → WebSocket Server Settings
3. Enable server
4. Note the port (default: 4455) and password
5. Enter these in Smart Panel Middleware configuration

### "vMix connection failed"
1. Open vMix
2. Verify Web Controller is enabled (Settings → Web Controller)
3. Note the port (default: 8088)
4. Enter these in Smart Panel Middleware configuration

### Check logs
- **Mac:** `~/Library/Application Support/Smart Panel Middleware/logs/`
- **Windows:** `%APPDATA%\Smart Panel Middleware\logs\`

---

## Support

- Email: support@smart-panel.app
- Web: https://smart-panel.app

---

## License

Private - Smart Panel © 2024
