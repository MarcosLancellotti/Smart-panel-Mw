import OBSWebSocket from 'obs-websocket-js';
import { LogManager } from '../core/LogManager';

export interface OBSConfig {
  host: string;
  port: number;
  password?: string;
}

export interface OBSConnectionStatus {
  connected: boolean;
  version?: string;
  host?: string;
  port?: number;
  error?: string;
}

export class OBSService {
  private obs: OBSWebSocket;
  private logger: LogManager;
  private config: OBSConfig | null = null;
  private _connected: boolean = false;
  private _version: string | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private onStatusChangeCallback: ((status: OBSConnectionStatus) => void) | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.obs = new OBSWebSocket();
    this.setupEventListeners();
    this.logger.info('[OBS] Service initialized');
  }

  private setupEventListeners(): void {
    this.obs.on('ConnectionClosed', () => {
      this.logger.warn('[OBS] Connection closed');
      this._connected = false;
      this.notifyStatusChange();
      this.startReconnect();
    });

    this.obs.on('ConnectionError', (err) => {
      this.logger.error(`[OBS] Connection error: ${err.message}`);
      this._connected = false;
      this.notifyStatusChange();
    });
  }

  private notifyStatusChange(): void {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(this.getStatus());
    }
  }

  private startReconnect(): void {
    if (this.reconnectInterval || !this.config) return;

    this.logger.info('[OBS] Will attempt reconnection in 10 seconds...');
    this.reconnectInterval = setInterval(async () => {
      if (this._connected) {
        this.stopReconnect();
        return;
      }
      this.logger.info('[OBS] Attempting reconnection...');
      await this.connect(this.config!);
    }, 10000);
  }

  private stopReconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  async connect(config: OBSConfig): Promise<OBSConnectionStatus> {
    this.config = config;
    this.stopReconnect();

    try {
      this.logger.info(`[OBS] Connecting to ws://${config.host}:${config.port}...`);

      await this.obs.connect(
        `ws://${config.host}:${config.port}`,
        config.password || undefined
      );

      const version = await this.obs.call('GetVersion');
      this._version = version.obsVersion;
      this._connected = true;

      this.logger.info(`[OBS] Connected! OBS version: ${this._version}`);
      this.notifyStatusChange();

      return {
        connected: true,
        version: this._version,
        host: config.host,
        port: config.port
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.logger.error(`[OBS] Connection failed: ${errorMsg}`);
      this._connected = false;
      this.notifyStatusChange();

      return {
        connected: false,
        error: errorMsg,
        host: config.host,
        port: config.port
      };
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect();
    if (this._connected) {
      try {
        await this.obs.disconnect();
        this.logger.info('[OBS] Disconnected');
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    this._connected = false;
    this.notifyStatusChange();
  }

  onStatusChange(callback: (status: OBSConnectionStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  getStatus(): OBSConnectionStatus {
    return {
      connected: this._connected,
      version: this._version || undefined,
      host: this.config?.host,
      port: this.config?.port
    };
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ========== OBS Commands ==========

  async getScenes(): Promise<any> {
    if (!this._connected) throw new Error('OBS not connected');
    return await this.obs.call('GetSceneList');
  }

  async setScene(sceneName: string): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('SetCurrentProgramScene', { sceneName });
    this.logger.info(`[OBS] Scene changed to: ${sceneName}`);
  }

  async getSources(sceneName: string): Promise<any> {
    if (!this._connected) throw new Error('OBS not connected');
    return await this.obs.call('GetSceneItemList', { sceneName });
  }

  async setSourceVisibility(sceneName: string, sceneItemId: number, visible: boolean): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled: visible
    });
    this.logger.info(`[OBS] Source ${sceneItemId} visibility set to: ${visible}`);
  }

  async toggleSource(sceneName: string, sceneItemId: number): Promise<boolean> {
    if (!this._connected) throw new Error('OBS not connected');

    const item = await this.obs.call('GetSceneItemEnabled', {
      sceneName,
      sceneItemId
    });

    const newState = !item.sceneItemEnabled;
    await this.obs.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled: newState
    });

    this.logger.info(`[OBS] Source ${sceneItemId} toggled to: ${newState}`);
    return newState;
  }

  async startStreaming(): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('StartStream');
    this.logger.info('[OBS] Streaming started');
  }

  async stopStreaming(): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('StopStream');
    this.logger.info('[OBS] Streaming stopped');
  }

  async startRecording(): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('StartRecord');
    this.logger.info('[OBS] Recording started');
  }

  async stopRecording(): Promise<void> {
    if (!this._connected) throw new Error('OBS not connected');
    await this.obs.call('StopRecord');
    this.logger.info('[OBS] Recording stopped');
  }

  async getStreamStatus(): Promise<any> {
    if (!this._connected) throw new Error('OBS not connected');
    return await this.obs.call('GetStreamStatus');
  }

  async getRecordStatus(): Promise<any> {
    if (!this._connected) throw new Error('OBS not connected');
    return await this.obs.call('GetRecordStatus');
  }
}
