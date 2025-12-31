import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
import path from 'path';
import { LogManager } from '../core/LogManager';
import { ConfigManager } from '../core/ConfigManager';
import { ConnectorConfig } from '../types/config';
import { SupabaseService } from '../services/SupabaseService';

// Get icon path based on platform
function getIconPath(): string {
  const isDev = !app.isPackaged;
  const basePath = isDev
    ? path.join(__dirname, '../../assets')
    : path.join(process.resourcesPath, 'assets');

  // Use PNG for all platforms during runtime (works best)
  return path.join(basePath, 'logo.png');
}

let mainWindow: BrowserWindow | null = null;
let logger: LogManager;
let configManager: ConfigManager;
let supabaseService: SupabaseService;

function createWindow(): void {
  const iconPath = getIconPath();
  const fs = require('fs');
  const iconExists = fs.existsSync(iconPath);

  // On Mac, the app icon comes from icon.icns in the bundle, so we don't need to set it for BrowserWindow
  // On Windows/Linux, we use the PNG
  const useIcon = process.platform !== 'darwin' && iconExists;

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'Smart Panel Middleware',
    ...(useIcon && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    show: false
  });

  // Set dock icon on Mac (optional, uses icon.icns from bundle by default)
  if (process.platform === 'darwin' && app.dock && iconExists) {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        app.dock.setIcon(image);
      }
    } catch (e) {
      // Ignore icon errors - app will use default icon.icns
    }
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    logger.info('Main window ready');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initializeApp(): void {
  logger = new LogManager();
  logger.info('Smart Panel Middleware starting...');

  configManager = new ConfigManager(logger);
  configManager.load();

  supabaseService = new SupabaseService(logger);

  logger.info('Application initialized');
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Get current config
  ipcMain.handle('get-config', (): ConnectorConfig => {
    return configManager.get();
  });

  // Save config
  ipcMain.handle('save-config', (_event, updates: Partial<ConnectorConfig>): boolean => {
    try {
      configManager.update(updates);
      logger.info('Config updated via UI');
      return true;
    } catch (error) {
      logger.error('Failed to save config', error as Error);
      return false;
    }
  });

  // Check if first run
  ipcMain.handle('is-first-run', (): boolean => {
    return configManager.isFirstRun();
  });

  // Get logs path
  ipcMain.handle('get-logs-path', (): string => {
    return logger.getLogsPath();
  });

  // Get recent logs
  ipcMain.handle('get-recent-logs', async (_event, lines: number): Promise<string[]> => {
    return await logger.getRecentLogs(lines);
  });

  // Open external link
  ipcMain.handle('open-external', (_event, url: string): void => {
    shell.openExternal(url);
  });

  // Get app version
  ipcMain.handle('get-version', (): string => {
    return app.getVersion();
  });

  // Verify API Key AND connect (full flow: authenticate + register + subscribe + heartbeat)
  ipcMain.handle('verify-api-key', async (_event, apiKey: string): Promise<{ valid: boolean; error?: string; companyId?: string; name?: string }> => {
    logger.info('[API] Verifying and connecting...');

    if (!apiKey || !apiKey.startsWith('sp_')) {
      return { valid: false, error: 'Invalid key format (must start with sp_)' };
    }

    // Full connect flow
    const getConnections = () => ({
      obs: { connected: false },
      vmix: { connected: false }
    });

    const result = await supabaseService.connect(apiKey, getConnections);

    if (result.success) {
      logger.info('[API] Connected successfully', {
        middlewareId: supabaseService.getMiddlewareId(),
        companyId: supabaseService.getCompanyId(),
        name: supabaseService.getApiKeyName()
      });
      return {
        valid: true,
        companyId: supabaseService.getCompanyId() || undefined,
        name: supabaseService.getApiKeyName() || undefined
      };
    }

    return { valid: false, error: result.error };
  });

  // Full connect flow (authenticate + register + subscribe + heartbeat)
  ipcMain.handle('connect-middleware', async (_event, apiKey: string): Promise<{ success: boolean; error?: string }> => {
    logger.info('[API] Connecting middleware...');

    const getConnections = () => ({
      obs: { connected: false },
      vmix: { connected: false }
    });

    return await supabaseService.connect(apiKey, getConnections);
  });

  // Disconnect middleware
  ipcMain.handle('disconnect-middleware', async (): Promise<void> => {
    logger.info('[API] Disconnecting middleware...');
    await supabaseService.disconnect();
  });

  // Check if connected
  ipcMain.handle('is-connected', (): boolean => {
    return supabaseService.isConnected();
  });

  // Test OBS connection (placeholder)
  ipcMain.handle('test-obs-connection', async (_event, config: { host: string; port: number; password?: string }): Promise<{ success: boolean; error?: string }> => {
    // TODO: Implement actual OBS connection test
    logger.info('[OBS] Testing connection...', config);
    return { success: false, error: 'OBS integration not yet implemented' };
  });

  // Test vMix connection (placeholder)
  ipcMain.handle('test-vmix-connection', async (_event, config: { host: string; port: number }): Promise<{ success: boolean; error?: string }> => {
    // TODO: Implement actual vMix connection test
    logger.info('[vMix] Testing connection...', config);
    return { success: false, error: 'vMix integration not yet implemented' };
  });
}

// Set app name (for Mac menu bar)
app.setName('Smart Panel Middleware');

// App lifecycle
app.whenReady().then(() => {
  initializeApp();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  logger.info('Application closing...');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  logger.info('Shutting down...');
  await supabaseService.disconnect();
  logger.info('Goodbye!');
});
