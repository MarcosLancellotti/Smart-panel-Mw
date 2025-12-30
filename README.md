# Smart Panel Connector

Local middleware for Smart Panel - Bridge between cloud and OBS/vMix

## What is This?

Smart Panel Connector is a Windows desktop application that acts as a bridge between Smart Panel Cloud (web interface) and local broadcast software like OBS Studio and vMix.

**Features:**
- Remote control OBS/vMix from Smart Panel web interface
- Zero latency local execution
- Offline cache for graphics
- Local data sources (Excel, CSV)

## Installation (Development)

### Prerequisites
- Node.js 18+ installed
- OBS Studio (for OBS integration)
- vMix (for vMix integration)

### Setup

1. **Clone the repository:**
```bash
git clone https://github.com/MarcosLancellotti/smart-panel-connector.git
cd smart-panel-connector
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure:**

On first run, the app will create a config file at:
```
%APPDATA%\Smart Panel Connector\config.json
```

Edit this file with your Smart Panel API credentials:
```json
{
  "smartPanel": {
    "apiUrl": "wss://api.smart-panel.app/middleware",
    "apiKey": "sp_live_YOUR_API_KEY_HERE",
    "companyId": "your-company-uuid-here"
  },
  "obs": {
    "enabled": true,
    "host": "localhost",
    "port": 4455,
    "password": "your-obs-password"
  }
}
```

Get your API key from: https://smart-panel.app/settings/api-keys

4. **Run in development mode:**
```bash
npm run dev
```

## Building

### Build TypeScript
```bash
npm run build
```

### Create .exe (Windows)
```bash
npm run build:exe
```

This creates: `dist/smart-panel-connector.exe` (~50MB)

### Create Installer
```bash
npm run build:installer
```

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php) installed.

## Project Structure

```
smart-panel-connector/
├── src/
│   ├── index.ts              # Entry point
│   ├── core/
│   │   ├── LogManager.ts     # Logging system
│   │   └── ConfigManager.ts  # Configuration
│   ├── types/
│   │   └── config.ts         # TypeScript types
│   └── utils/
│       └── paths.ts          # Windows paths
├── build/                    # Compiled JS
└── dist/                     # Final .exe
```

## Logs

Logs are stored in:
```
%APPDATA%\Smart Panel Connector\logs\
├── app-2024-12-30.log       # Combined logs (14 days)
├── error-2024-12-30.log     # Errors only (30 days)
└── debug-2024-12-30.log     # Debug (7 days, if DEBUG=true)
```

## Troubleshooting

### "Config file not found"
Run the app once to create the default config, then edit:
```
%APPDATA%\Smart Panel Connector\config.json
```

### "OBS connection failed"
1. Open OBS Studio
2. Go to: Tools → WebSocket Server Settings
3. Enable server
4. Note the port (default: 4455) and password
5. Update config.json with these values

### Check logs
Open logs folder:
```bash
explorer "%APPDATA%\Smart Panel Connector\logs"
```

## Development

### Watch mode
```bash
npm run dev
```

### Debug mode
```bash
DEBUG=true npm run dev
```

This enables verbose logging.

## License

Private - Smart Panel

## Support

Email: marcos@smart-panel.app