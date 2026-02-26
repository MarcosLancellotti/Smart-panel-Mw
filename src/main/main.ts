import { app, BrowserWindow, ipcMain, shell, nativeImage, Tray, Menu } from 'electron';
import path from 'path';
import { LogManager } from '../core/LogManager';
import { ConfigManager } from '../core/ConfigManager';
import { ConnectorConfig } from '../types/config';
import { SupabaseService, CommandPayload } from '../services/SupabaseService';
import { OBSService } from '../services/OBSService';
import { VMixService } from '../services/VMixService';
import { CasparCGService } from '../services/CasparCGService';
import { MeldStudioService } from '../services/MeldStudioService';
import { UpdateChecker } from '../services/UpdateChecker';

// Get icon path based on platform
function getIconPath(): string {
  const isDev = !app.isPackaged;
  const basePath = isDev
    ? path.join(__dirname, '../../assets')
    : path.join(process.resourcesPath, 'assets');

  return path.join(basePath, 'logo.png');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let logger: LogManager;
let configManager: ConfigManager;
let supabaseService: SupabaseService;
let obsService: OBSService;
let vmixService: VMixService;
let casparService: CasparCGService;
let meldService: MeldStudioService;
let updateChecker: UpdateChecker;

// Check for headless/service mode
const isHeadless = process.argv.includes('--headless') || process.argv.includes('--service');

function createTray(): void {
  const iconPath = getIconPath();

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Smart Panel Middleware');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    logger.info('[Tray] System tray created');
  } catch (e) {
    logger.warn('[Tray] Could not create system tray');
  }
}

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
    const config = configManager.get();
    // If runAsService is enabled, start minimized to tray
    if (config.runAsService) {
      logger.info('Running as service - starting minimized');
    } else {
      mainWindow?.center();
      mainWindow?.show();
      mainWindow?.focus();
    }
    logger.info('Main window ready');
    updateChecker.setWindow(mainWindow);
  });

  // Minimize to tray instead of closing (if runAsService is enabled)
  mainWindow.on('close', (event) => {
    const config = configManager.get();
    if (config.runAsService && !(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      logger.info('Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    updateChecker.setWindow(null);
  });
}

// Get current connection status for heartbeat
function getConnections() {
  const obsStatus = obsService.getStatus();
  const vmixStatus = vmixService.getStatus();
  const casparStatus = casparService.getStatus();
  const meldStatus = meldService.getStatus();
  return {
    obs: {
      connected: obsStatus.connected,
      version: obsStatus.version,
      host: obsStatus.host,
      port: obsStatus.port
    },
    vmix: {
      connected: vmixStatus.connected,
      version: vmixStatus.version,
      host: vmixStatus.host,
      port: vmixStatus.port
    },
    casparcg: {
      connected: casparStatus.connected,
      host: casparStatus.host,
      port: casparStatus.port
    },
    meldstudio: {
      connected: meldStatus.connected,
      host: meldStatus.host,
      port: meldStatus.port
    }
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
        // Update connection status in Smart Panel
        await supabaseService.updateConnectionStatus(getConnections());
        await supabaseService.sendResponse(requestId!, {
          success: result.connected,
          data: result.connected ? { version: result.version } : undefined,
          error: result.error || null
        }, responseChannel);
        break;
      }

      case 'obs_get_scenes': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const sceneList = await obsService.getScenes();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: {
            scenes: sceneList.scenes.map((s: any) => ({ sceneName: s.sceneName, sceneIndex: s.sceneIndex })),
            currentScene: sceneList.currentProgramSceneName
          }
        }, responseChannel);
        break;
      }

      case 'obs_get_current_scene': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const currentScene = await obsService.getCurrentScene();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: { sceneName: currentScene }
        }, responseChannel);
        break;
      }

      case 'obs_switch_scene':
      case 'obs_set_scene': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
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
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
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

      case 'obs_show_source': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sceneName, sourceName } = cmd.params as any;
        const sceneItemId = await obsService.getSceneItemId(sceneName, sourceName);
        await obsService.setSourceVisibility(sceneName, sceneItemId, true);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_hide_source': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sceneName: hideScene, sourceName: hideSource } = cmd.params as any;
        const hideItemId = await obsService.getSceneItemId(hideScene, hideSource);
        await obsService.setSourceVisibility(hideScene, hideItemId, false);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_source_visibility': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
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
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sceneName: sn, scene: sc, sceneItemId: siId, sourceId: srcId, sourceName: toggleSrcName } = cmd.params as any;
        const toggleScene = sn || sc;
        let toggleId = siId || srcId;
        if (!toggleId && toggleSrcName) {
          toggleId = await obsService.getSceneItemId(toggleScene, toggleSrcName);
        }
        const newState = await obsService.toggleSource(toggleScene, toggleId);
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: { enabled: newState }
        }, responseChannel);
        break;
      }

      case 'obs_set_text': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sourceName: textSource, text } = cmd.params as any;
        await obsService.setText(textSource, text);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_refresh_browser': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sourceName: browserSource } = cmd.params as any;
        await obsService.refreshBrowser(browserSource);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_set_browser_url': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        const { sourceName: urlSource, url } = cmd.params as any;
        await obsService.setBrowserUrl(urlSource, url);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_start_streaming': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        await obsService.startStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_stop_streaming': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        await obsService.stopStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_start_recording': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        await obsService.startRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_stop_recording': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
          break;
        }
        await obsService.stopRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'obs_get_streaming_status':
      case 'obs_get_stream_status': {
        if (!obsService.isConnected()) {
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
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
          await supabaseService.sendError(requestId!, 'OBS WebSocket not connected', responseChannel);
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
        await supabaseService.sendError(requestId!, `Unknown command: ${cmd.action}`, responseChannel);
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

// Handle vMix commands from Smart Panel
async function handleVMixCommand(cmd: CommandPayload): Promise<void> {
  const requestId = cmd.request_id;
  const responseChannel = cmd.response_channel;

  try {
    switch (cmd.action) {
      case 'vmix_connect': {
        const host = (cmd.params.host as string) || 'localhost';
        const port = (cmd.params.port as number) || 8088;

        const result = await vmixService.connect({ host, port });
        // Update connection status in Smart Panel
        await supabaseService.updateConnectionStatus(getConnections());
        await supabaseService.sendResponse(requestId!, {
          success: result.connected,
          data: result.connected ? { version: result.version } : undefined,
          error: result.error || null
        }, responseChannel);
        break;
      }

      case 'vmix_get_state': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const state = await vmixService.getState();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: state
        }, responseChannel);
        break;
      }

      case 'vmix_show_overlay': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { overlayNumber, inputKey, inputNumber } = cmd.params as any;
        const input = inputKey || inputNumber;
        await vmixService.showOverlay(overlayNumber, input);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_hide_overlay': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { overlayNumber: ovNum } = cmd.params as any;
        await vmixService.hideOverlay(ovNum);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_transition': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { inputKey: transInput, transition, duration } = cmd.params as any;
        if (transition === 'Cut' || !transition) {
          await vmixService.cut(transInput);
        } else {
          await vmixService.fade(duration || 1000, transInput);
        }
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_set_text': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { inputKey, input, selectedName, fieldName, textValue, value } = cmd.params as any;
        const inputId = inputKey || input;
        const field = selectedName || fieldName;
        const text = textValue || value;
        await vmixService.setText(inputId, field, text);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_cut': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { inputKey: cutKey, inputNumber: cutInput } = cmd.params as any;
        await vmixService.cut(cutKey || cutInput);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_fade': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        const { duration, inputKey: fadeKey, inputNumber: fadeInput } = cmd.params as any;
        await vmixService.fade(duration, fadeKey || fadeInput);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_start_streaming': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        await vmixService.startStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_stop_streaming': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        await vmixService.stopStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_start_recording': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        await vmixService.startRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'vmix_stop_recording': {
        if (!vmixService.isConnected()) {
          await supabaseService.sendError(requestId!, 'vMix not connected', responseChannel);
          break;
        }
        await vmixService.stopRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      default:
        await supabaseService.sendError(requestId!, `Unknown command: ${cmd.action}`, responseChannel);
        break;
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[vMix] Command failed: ${cmd.action} - ${errorMsg}`);
    if (requestId) {
      await supabaseService.sendError(requestId, errorMsg, responseChannel);
    }
  }
}

// Handle CasparCG commands from Smart Panel
async function handleCasparCGCommand(cmd: CommandPayload): Promise<void> {
  const requestId = cmd.request_id;
  const responseChannel = cmd.response_channel;

  try {
    switch (cmd.action) {
      case 'caspar_connect': {
        const host = (cmd.params.host as string) || 'localhost';
        const port = (cmd.params.port as number) || 5250;

        const result = await casparService.connect({ host, port });
        await supabaseService.updateConnectionStatus(getConnections());
        await supabaseService.sendResponse(requestId!, {
          success: result.connected,
          error: result.error || null
        }, responseChannel);
        break;
      }

      case 'caspar_play': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer, clip } = cmd.params as any;
        const result = await casparService.play(channel, layer, clip);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_stop': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.stop(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_load': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer, clip } = cmd.params as any;
        const result = await casparService.load(channel, layer, clip);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_loadbg': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer, clip, auto } = cmd.params as any;
        const result = await casparService.loadBg(channel, layer, clip, auto);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_clear': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.clear(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_add': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer, template, playOnLoad, data } = cmd.params as any;
        const result = await casparService.cgAdd(channel, layer, template, playOnLoad, data);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_update': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer, data } = cmd.params as any;
        const result = await casparService.cgUpdate(channel, layer, data);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_stop': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.cgStop(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_next': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.cgNext(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_clear': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.cgClear(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      case 'caspar_cg_play': {
        if (!casparService.isConnected()) {
          await supabaseService.sendError(requestId!, 'CasparCG not connected', responseChannel);
          break;
        }
        const { channel, layer } = cmd.params as any;
        const result = await casparService.cgPlay(channel, layer);
        await supabaseService.sendResponse(requestId!, { success: result.code >= 200 && result.code < 300 }, responseChannel);
        break;
      }

      default:
        await supabaseService.sendError(requestId!, `Unknown command: ${cmd.action}`, responseChannel);
        break;
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[CasparCG] Command failed: ${cmd.action} - ${errorMsg}`);
    if (requestId) {
      await supabaseService.sendError(requestId, errorMsg, responseChannel);
    }
  }
}

// Handle MeldStudio commands from Smart Panel
async function handleMeldStudioCommand(cmd: CommandPayload): Promise<void> {
  const requestId = cmd.request_id;
  const responseChannel = cmd.response_channel;

  try {
    switch (cmd.action) {
      case 'meld_connect': {
        const host = (cmd.params.host as string) || '127.0.0.1';
        const port = (cmd.params.port as number) || 13376;

        const result = await meldService.connect({ host, port });
        await supabaseService.updateConnectionStatus(getConnections());
        await supabaseService.sendResponse(requestId!, {
          success: result.connected,
          error: result.error || null
        }, responseChannel);
        break;
      }

      case 'meld_get_session': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const session = meldService.getSession();
        await supabaseService.sendResponse(requestId!, {
          success: true,
          data: session
        }, responseChannel);
        break;
      }

      case 'meld_show_scene': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { sceneId } = cmd.params as any;
        await meldService.showScene(sceneId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_stage_scene': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { sceneId } = cmd.params as any;
        await meldService.stageScene(sceneId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_show_staged': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.showStaged();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_layer_toggle': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { layerId } = cmd.params as any;
        await meldService.toggleLayer(layerId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_set_property': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { objectId, propertyName, propertyValue } = cmd.params as any;
        await meldService.setProperty(objectId, propertyName, propertyValue);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_effect_toggle': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { effectId } = cmd.params as any;
        await meldService.toggleEffect(effectId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_toggle_mute': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { trackId } = cmd.params as any;
        await meldService.toggleMute(trackId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_set_gain': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { trackId, gain } = cmd.params as any;
        await meldService.setGain(trackId, gain);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_start_streaming': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.startStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_stop_streaming': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.stopStreaming();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_start_recording': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.startRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_stop_recording': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.stopRecording();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_toggle_virtual_camera': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.toggleVirtualCamera();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_media_play': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { layerId } = cmd.params as any;
        await meldService.mediaPlay(layerId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_media_pause': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { layerId } = cmd.params as any;
        await meldService.mediaPause(layerId);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_media_seek': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { layerId, seekTime } = cmd.params as any;
        await meldService.mediaSeek(layerId, seekTime);
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_screenshot': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.screenshot();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_record_clip': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.recordClip();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_replay_show': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.showReplay();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_replay_dismiss': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        await meldService.dismissReplay();
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      case 'meld_stream_event': {
        if (!meldService.isConnected()) {
          await supabaseService.sendError(requestId!, 'MeldStudio not connected', responseChannel);
          break;
        }
        const { eventType, eventData } = cmd.params as any;
        await meldService.sendStreamEvent(eventType, eventData || {});
        await supabaseService.sendResponse(requestId!, { success: true }, responseChannel);
        break;
      }

      default:
        await supabaseService.sendError(requestId!, `Unknown command: ${cmd.action}`, responseChannel);
        break;
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`[MeldStudio] Command failed: ${cmd.action} - ${errorMsg}`);
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

  // vMix commands
  if (cmd.action.startsWith('vmix_')) {
    handleVMixCommand(cmd);
    return;
  }

  // CasparCG commands
  if (cmd.action.startsWith('caspar_')) {
    handleCasparCGCommand(cmd);
    return;
  }

  // MeldStudio commands
  if (cmd.action.startsWith('meld_')) {
    handleMeldStudioCommand(cmd);
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
  vmixService = new VMixService(logger);
  casparService = new CasparCGService(logger);
  meldService = new MeldStudioService(logger);

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

  // Auto-connect to vMix if configured
  if (config.vmix?.enabled && config.vmix.host) {
    logger.info('[vMix] Auto-connecting with saved config...');
    vmixService.connect({
      host: config.vmix.host,
      port: config.vmix.httpPort || 8088
    });
  }

  // Auto-connect to CasparCG if configured
  if (config.casparcg?.enabled && config.casparcg.host) {
    logger.info('[CasparCG] Auto-connecting with saved config...');
    casparService.connect({
      host: config.casparcg.host,
      port: config.casparcg.port || 5250
    });
  }

  // Auto-connect to MeldStudio if configured
  if (config.meldstudio?.enabled && config.meldstudio.host) {
    logger.info('[MeldStudio] Auto-connecting with saved config...');
    meldService.connect({
      host: config.meldstudio.host,
      port: config.meldstudio.port || 13376
    });
  }

  // Set up update notification callback (push from admin)
  supabaseService.onUpdateNotify((info) => {
    logger.info(`[Updater] Push notification from admin: v${info.version}`);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'available',
        version: info.version,
        message: info.message,
        required: info.required
      });
    }
  });

  // Set up suspend callback
  supabaseService.onSuspendChange((info) => {
    logger.info(`[API] Suspend state changed: ${JSON.stringify(info)}`);
    if (mainWindow) {
      mainWindow.webContents.send('api-suspend-changed', info);
    }
  });

  // Set up OBS status change callback
  obsService.onStatusChange((status) => {
    logger.info(`[OBS] Status changed: connected=${status.connected}`);
    if (mainWindow) {
      mainWindow.webContents.send('obs-status-changed', status);
    }
    // Update Smart Panel with new connection status
    if (supabaseService.isConnected()) {
      supabaseService.updateConnectionStatus(getConnections());
    }
  });

  // Set up vMix status change callback
  vmixService.onStatusChange((status) => {
    logger.info(`[vMix] Status changed: connected=${status.connected}`);
    if (mainWindow) {
      mainWindow.webContents.send('vmix-status-changed', status);
    }
    // Update Smart Panel with new connection status
    if (supabaseService.isConnected()) {
      supabaseService.updateConnectionStatus(getConnections());
    }
  });

  // Set up CasparCG status change callback
  casparService.onStatusChange((status) => {
    logger.info(`[CasparCG] Status changed: connected=${status.connected}`);
    if (mainWindow) {
      mainWindow.webContents.send('casparcg-status-changed', status);
    }
    // Update Smart Panel with new connection status
    if (supabaseService.isConnected()) {
      supabaseService.updateConnectionStatus(getConnections());
    }
  });

  // Set up MeldStudio status change callback
  meldService.onStatusChange((status) => {
    logger.info(`[MeldStudio] Status changed: connected=${status.connected}`);
    if (mainWindow) {
      mainWindow.webContents.send('meldstudio-status-changed', status);
    }
    // Update Smart Panel with new connection status
    if (supabaseService.isConnected()) {
      supabaseService.updateConnectionStatus(getConnections());
    }
  });

  // Auto-connect to Smart Panel if API key is saved
  if (config.smartPanel?.apiKey) {
    logger.info('[API] Auto-connecting with saved API key...');
    supabaseService.connect(config.smartPanel.apiKey, getConnections, handleCommand)
      .then(result => {
        if (result.success) {
          if (result.suspended) {
            logger.warn(`[API] Auto-connect: middleware is suspended (${result.suspend_reason})`);
            if (mainWindow) {
              mainWindow.webContents.send('api-suspended', {
                reason: result.suspend_reason
              });
            }
          } else {
            logger.info('[API] Auto-connect successful');
            if (mainWindow) {
              mainWindow.webContents.send('api-connected', {
                name: supabaseService.getApiKeyName(),
                companyId: supabaseService.getCompanyId()
              });
            }
          }
        } else {
          logger.warn(`[API] Auto-connect failed: ${result.error}`);
        }
      });
  }

  // Initialize update checker
  updateChecker = new UpdateChecker(logger, app.getVersion());
  if (config.settings?.checkUpdates !== false) {
    updateChecker.checkOnStartup();
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
  ipcMain.handle('verify-api-key', async (_event, apiKey: string): Promise<{ valid: boolean; error?: string; companyId?: string; name?: string; suspended?: boolean; suspend_reason?: string }> => {
    logger.info('[API] Verifying and connecting...');

    if (!apiKey || !apiKey.startsWith('sp_')) {
      return { valid: false, error: 'Invalid key format (must start with sp_)' };
    }

    const result = await supabaseService.connect(apiKey, getConnections, handleCommand);

    if (result.success) {
      // Save API key to config on successful connection
      const companyId = supabaseService.getCompanyId() || '';
      configManager.update({
        smartPanel: {
          ...configManager.get().smartPanel,
          apiKey,
          companyId
        }
      });

      // Check if suspended
      if (result.suspended) {
        logger.warn('[API] Connected but middleware is suspended', {
          middlewareId: supabaseService.getMiddlewareId(),
          suspend_reason: result.suspend_reason
        });
        return {
          valid: true,
          companyId: companyId || undefined,
          name: supabaseService.getApiKeyName() || undefined,
          suspended: true,
          suspend_reason: result.suspend_reason
        };
      }

      logger.info('[API] Connected successfully - API key saved', {
        middlewareId: supabaseService.getMiddlewareId(),
        companyId,
        name: supabaseService.getApiKeyName()
      });
      return {
        valid: true,
        companyId: companyId || undefined,
        name: supabaseService.getApiKeyName() || undefined,
        suspended: false
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

  ipcMain.handle('get-connection-status', (): { connected: boolean; name?: string; companyId?: string } => {
    return {
      connected: supabaseService.isConnected(),
      name: supabaseService.getApiKeyName() || undefined,
      companyId: supabaseService.getCompanyId() || undefined
    };
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

  // vMix Connection
  ipcMain.handle('test-vmix-connection', async (_event, config: { host: string; port: number }): Promise<{ success: boolean; error?: string; version?: string }> => {
    logger.info(`[vMix] Testing connection to ${config.host}:${config.port}...`);
    const result = await vmixService.connect({
      host: config.host,
      port: config.port
    });

    if (result.connected) {
      return { success: true, version: result.version };
    }
    return { success: false, error: result.error };
  });

  ipcMain.handle('disconnect-vmix', async (): Promise<void> => {
    logger.info('[vMix] Disconnecting...');
    await vmixService.disconnect();
  });

  ipcMain.handle('get-vmix-status', (): { connected: boolean; version?: string } => {
    const status = vmixService.getStatus();
    return { connected: status.connected, version: status.version };
  });

  // CasparCG Connection
  ipcMain.handle('test-casparcg-connection', async (_event, config: { host: string; port: number }): Promise<{ success: boolean; error?: string }> => {
    logger.info(`[CasparCG] Testing connection to ${config.host}:${config.port}...`);
    const result = await casparService.connect({
      host: config.host,
      port: config.port
    });

    if (result.connected) {
      return { success: true };
    }
    return { success: false, error: result.error };
  });

  ipcMain.handle('disconnect-casparcg', async (): Promise<void> => {
    logger.info('[CasparCG] Disconnecting...');
    await casparService.disconnect();
  });

  ipcMain.handle('get-casparcg-status', (): { connected: boolean } => {
    const status = casparService.getStatus();
    return { connected: status.connected };
  });

  // MeldStudio Connection
  ipcMain.handle('test-meldstudio-connection', async (_event, config: { host: string; port: number }): Promise<{ success: boolean; error?: string }> => {
    logger.info(`[MeldStudio] Testing connection to ${config.host}:${config.port}...`);
    const result = await meldService.connect({
      host: config.host,
      port: config.port
    });

    if (result.connected) {
      return { success: true };
    }
    return { success: false, error: result.error };
  });

  ipcMain.handle('disconnect-meldstudio', async (): Promise<void> => {
    logger.info('[MeldStudio] Disconnecting...');
    await meldService.disconnect();
  });

  ipcMain.handle('get-meldstudio-status', (): { connected: boolean } => {
    const status = meldService.getStatus();
    return { connected: status.connected };
  });

  // Update checker
  ipcMain.handle('check-for-updates', async (): Promise<void> => {
    await updateChecker.checkForUpdates();
  });

  ipcMain.handle('open-release-page', (): void => {
    updateChecker.openReleasePage();
  });

  ipcMain.handle('download-and-install', async (): Promise<void> => {
    logger.info('[Updater] Download and install requested');
    await updateChecker.downloadAndInstall();
  });
}

// Set app name (for Mac menu bar)
app.setName('Smart Panel Middleware');

// Track if app is quitting (vs just hiding)
(app as any).isQuitting = false;

// App lifecycle
app.whenReady().then(() => {
  initializeApp();
  setupIpcHandlers();
  createTray();

  if (isHeadless) {
    logger.info('Running in headless/service mode - no GUI');
  } else {
    createWindow();
  }

  app.on('activate', () => {
    if (!isHeadless && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  const config = configManager.get();
  if (isHeadless || config.runAsService) {
    // In service mode, don't quit when window is hidden
    logger.info('Window closed - continuing as service');
    return;
  }
  logger.info('Application closing...');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  (app as any).isQuitting = true;
  logger.info('Shutting down...');
  await obsService.disconnect();
  await vmixService.disconnect();
  await casparService.disconnect();
  await meldService.disconnect();
  await supabaseService.disconnect();
  logger.info('Goodbye!');
});
