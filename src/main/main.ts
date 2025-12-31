import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
import path from 'path';
import { LogManager } from '../core/LogManager';
import { ConfigManager } from '../core/ConfigManager';
import { ConnectorConfig } from '../types/config';
import { SupabaseService, CommandPayload } from '../services/SupabaseService';
import { OBSService } from '../services/OBSService';

// Get icon path based on platform
function getIconPath(): string {
  const isDev = !app.isPackaged;
  const basePath = isDev
    ? path.join(__dirname, '../../assets')
    : path.join(process.resourcesPath, 'assets');

  return path.join(basePath, 'logo.png');
}

let mainWindow: BrowserWindow | null = null;
let logger: LogManager;
let configManager: ConfigManager;
let supabaseService: SupabaseService;
let obsService: OBSService;

function createWindow(): void {
  const iconPath = getIconPath();
  const fs = require('fs');
  const iconExists = fs.existsSync(iconPath);

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

  if (process.platform === 'darwin' && app.dock && iconExists) {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        app.dock.setIcon(image);
      }
    } catch (e) {
      // Ignore icon errors
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

// Get current connection status for heartbeat
function getConnections() {
  const obsStatus = obsService.getStatus();
  return {
    obs: {
      connected: obsStatus.connected,
      version: obsStatus.version,
      host: obsStatus.host,
      port: obsStatus.port
    },
    vmix: { connected: false }
  };
}

// Handle OBS commands from Smart Panel
async function handleOBSCommand(cmd: CommandPayload): Promise<void> {
  const requestId = cmd.request_id;
  const responseChannel = cmd.response_channel;

  try {
    switch (cmd.action) {
      case 'obs_connect': {
        const host = (cmd.params.host as string) || 'localhost';
        const port = (cmd.params.port as number) || 4455;
        const password = cmd.params.password as string | undefined;

        const result = await obsService.connect({ host, port, password });
        await supabaseService.sendResponse(requestId!, {
          success: result.connected,
          data: result.connected ? { version: result.version } : undefined,
          error: result.error || null
        }, responseChannel);
        break;
      }

      case 'obs_get_scenes': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const sceneList = await obsService.getScenes();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: {
            scenes: sceneList.scenes.map((s: any) => ({ name: s.sceneName, index: s.sceneIndex })),
            currentScene: sceneList.currentProgramSceneName
          }
        }, responseChannel);
        break;
      }

      case 'obs_set_scene': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const sceneName = (cmd.params.sceneName || cmd.params.scene) as string;
        await obsService.setScene(sceneName);
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: { sceneName }
        }, responseChannel);
        break;
      }

      case 'obs_get_sources': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const sceneForSources = (cmd.params.sceneName || cmd.params.scene) as string;
        const sources = await obsService.getSources(sceneForSources);
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: { sources: sources.sceneItems }
        }, responseChannel);
        break;
      }

      case 'obs_source_visibility': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const { sceneName, scene, sceneItemId, sourceId, visible, sceneItemEnabled } = cmd.params as any;
        const sName = sceneName || scene;
        const sId = sceneItemId || sourceId;
        const vis = visible !== undefined ? visible : sceneItemEnabled;
        await obsService.setSourceVisibility(sName, sId, vis);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_toggle_source': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const { sceneName: sn, scene: sc, sceneItemId: siId, sourceId: srcId } = cmd.params as any;
        const toggleScene = sn || sc;
        const toggleId = siId || srcId;
        const newState = await obsService.toggleSource(toggleScene, toggleId);
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: { enabled: newState }
        }, responseChannel);
        break;
      }

      case 'obs_start_streaming': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        await obsService.startStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_stop_streaming': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        await obsService.stopStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_start_recording': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        await obsService.startRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_stop_recording': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        await obsService.stopRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_get_stream_status': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const streamStatus = await obsService.getStreamStatus();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: streamStatus
        }, responseChannel);
        break;
      }

      case 'obs_get_record_status': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS not connected', responseChannel);
          break;
        }
        const recordStatus = await obsService.getRecordStatus();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: recordStatus
        }, responseChannel);
        break;
      }

      default:
        await supabaseService.sendError(requestId!, `Unknown action: ${cmd.action}`, responseChannel);
        break;
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[OBS] Command failed: ${cmd.action} - ${errorMsg}`);
    if (requestId) {
      await supabaseService.sendError(requestId, errorMsg, responseChannel);
    }
  }
}

// Handle all commands from Smart Panel
function handleCommand(cmd: CommandPayload): void {
  logger.info(`[Command] Received: ${cmd.action}`);

  // OBS commands
  if (cmd.action.startsWith('obs_')) {
    handleOBSCommand(cmd);
    return;
  }

  // vMix commands (future)
  if (cmd.action.startsWith('vmix_')) {
    logger.warn('[vMix] Not yet implemented');
    if (cmd.request_id) {
      supabaseService.sendError(cmd.request_id, 'vMix not yet implemented');
    }
    return;
  }
}

function initializeApp(): void {
  logger = new LogManager();
  logger.info('Smart Panel Middleware starting...');

  configManager = new ConfigManager(logger);
  configManager.load();

  supabaseService = new SupabaseService(logger);
  obsService = new OBSService(logger);

  // Auto-connect to OBS if configured
  const config = configManager.get();
  if (config.obs?.enabled && config.obs.host) {
    logger.info('[OBS] Auto-connecting with saved config...');
    obsService.connect({
      host: config.obs.host,
      port: config.obs.port || 4455,
      password: config.obs.password
    });
  }

  logger.info('Application initialized');
}

// IPC Handlers
function setupIpcHandlers(): void {
  ipcMain.handle('get-config', (): ConnectorConfig => {
    return configManager.get();
  });

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

  ipcMain.handle('is-first-run', (): boolean => {
    return configManager.isFirstRun();
  });

  ipcMain.handle('get-logs-path', (): string => {
    return logger.getLogsPath();
  });

  ipcMain.handle('get-recent-logs', async (_event, lines: number): Promise<string[]> => {
    return await logger.getRecentLogs(lines);
  });

  ipcMain.handle('open-external', (_event, url: string): void => {
    shell.openExternal(url);
  });

  ipcMain.handle('get-version', (): string => {
    return app.getVersion();
  });

  // Verify API Key AND connect
  ipcMain.handle('verify-api-key', async (_event, apiKey: string): Promise<{ valid: boolean; error?: string; companyId?: string; name?: string }> => {
    logger.info('[API] Verifying and connecting...');

    if (!apiKey || !apiKey.startsWith('sp_')) {
      return { valid: false, error: 'Invalid key format (must start with sp_)' };
    }

    const result = await supabaseService.connect(apiKey, getConnections, handleCommand);

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

  ipcMain.handle('connect-middleware', async (_event, apiKey: string): Promise<{ success: boolean; error?: string }> => {
    logger.info('[API] Connecting middleware...');
    return await supabaseService.connect(apiKey, getConnections, handleCommand);
  });

  ipcMain.handle('disconnect-middleware', async (): Promise<void> => {
    logger.info('[API] Disconnecting middleware...');
    await supabaseService.disconnect();
  });

  ipcMain.handle('is-connected', (): boolean => {
    return supabaseService.isConnected();
  });

  // OBS Connection
  ipcMain.handle('test-obs-connection', async (_event, config: { host: string; port: number; password?: string }): Promise<{ success: boolean; error?: string; version?: string }> => {
    logger.info(`[OBS] Testing connection to ${config.host}:${config.port}...`);
    const result = await obsService.connect({
      host: config.host,
      port: config.port,
      password: config.password
    });

    if (result.connected) {
      return { success: true, version: result.version };
    }
    return { success: false, error: result.error };
  });

  ipcMain.handle('disconnect-obs', async (): Promise<void> => {
    logger.info('[OBS] Disconnecting...');
    await obsService.disconnect();
  });

  ipcMain.handle('get-obs-status', (): { connected: boolean; version?: string } => {
    const status = obsService.getStatus();
    return { connected: status.connected, version: status.version };
  });

  // vMix Connection (placeholder)
  ipcMain.handle('test-vmix-connection', async (_event, config: { host: string; port: number }): Promise<{ success: boolean; error?: string }> => {
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
  await obsService.disconnect();
  await supabaseService.disconnect();
  logger.info('Goodbye!');
});
