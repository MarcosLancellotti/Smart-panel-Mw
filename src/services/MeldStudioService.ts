import WebSocket from 'ws';
import { LogManager } from '../core/LogManager';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QWebChannel } = require('../lib/qwebchannel');

export interface MeldStudioConfig {
  host: string;
  port: number;
}

export interface MeldStudioConnectionStatus {
  connected: boolean;
  host?: string;
  port?: number;
  error?: string;
}

export interface MeldSessionData {
  scenes: Array<{ id: string; name: string }>;
  layers: Array<{ id: string; name: string; sceneId?: string }>;
  tracks: Array<{ id: string; name: string }>;
  effects: Array<{ id: string; name: string; layerId?: string }>;
}

export class MeldStudioService {
  private ws: WebSocket | null = null;
  private meld: any = null;
  private channel: any = null;
  private logger: LogManager;
  private config: MeldStudioConfig | null = null;
  private _connected: boolean = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private onStatusChangeCallback: ((status: MeldStudioConnectionStatus) => void) | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.logger.info('[MeldStudio] Service initialized');
  }

  private notifyStatusChange(): void {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(this.getStatus());
    }
  }

  private startReconnect(): void {
    if (this.reconnectInterval || !this.config) return;

    this.logger.info('[MeldStudio] Will attempt reconnection in 10 seconds...');
    this.reconnectInterval = setInterval(async () => {
      if (this._connected) {
        this.stopReconnect();
        return;
      }
      this.logger.info('[MeldStudio] Attempting reconnection...');
      await this.connect(this.config!);
    }, 10000);
  }

  private stopReconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  async connect(config: MeldStudioConfig): Promise<MeldStudioConnectionStatus> {
    this.config = config;
    this.stopReconnect();

    return new Promise((resolve) => {
      try {
        const url = `ws://${config.host}:${config.port}`;
        this.logger.info(`[MeldStudio] Connecting to ${url}...`);

        // Clean up existing connection
        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws.close();
          this.ws = null;
          this.meld = null;
          this.channel = null;
        }

        this.ws = new WebSocket(url);

        // Connection timeout
        const timeout = setTimeout(() => {
          if (!this._connected) {
            this.ws?.removeAllListeners();
            this.ws?.close();
            this.ws = null;
            this.notifyStatusChange();
            resolve({
              connected: false,
              error: 'Connection timeout',
              host: config.host,
              port: config.port
            });
          }
        }, 5000);

        this.ws.on('open', () => {
          this.logger.info('[MeldStudio] WebSocket connected, initializing QWebChannel...');

          // Create a transport adapter for QWebChannel
          // QWebChannel expects: transport.send(data) and transport.onmessage(msg)
          const transport = {
            send: (data: string) => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(data);
              }
            },
            onmessage: (_msg: any) => {
              // QWebChannel will set this
            }
          };

          // Forward WebSocket messages to QWebChannel transport
          this.ws!.on('message', (data: WebSocket.Data) => {
            if (transport.onmessage) {
              transport.onmessage({ data: data.toString() });
            }
          });

          // Initialize QWebChannel
          try {
            this.channel = new QWebChannel(transport, (channel: any) => {
              clearTimeout(timeout);
              this.meld = channel.objects.meld;

              if (!this.meld) {
                this.logger.error('[MeldStudio] QWebChannel initialized but "meld" object not found');
                this._connected = false;
                this.notifyStatusChange();
                resolve({
                  connected: false,
                  error: 'Meld object not found in QWebChannel',
                  host: config.host,
                  port: config.port
                });
                return;
              }

              this._connected = true;
              this.logger.info('[MeldStudio] Connected and QWebChannel initialized!');
              this.subscribeToSignals();
              this.notifyStatusChange();
              resolve({
                connected: true,
                host: config.host,
                port: config.port
              });
            });
          } catch (err) {
            clearTimeout(timeout);
            const errorMsg = (err as Error).message;
            this.logger.error(`[MeldStudio] QWebChannel init failed: ${errorMsg}`);
            this._connected = false;
            this.notifyStatusChange();
            resolve({
              connected: false,
              error: `QWebChannel init failed: ${errorMsg}`,
              host: config.host,
              port: config.port
            });
          }
        });

        this.ws.on('close', () => {
          if (this._connected) {
            this.logger.warn('[MeldStudio] Connection closed');
            this._connected = false;
            this.meld = null;
            this.channel = null;
            this.notifyStatusChange();
            this.startReconnect();
          }
        });

        this.ws.on('error', (err) => {
          clearTimeout(timeout);
          this.logger.error(`[MeldStudio] Connection error: ${err.message}`);
          if (!this._connected) {
            resolve({
              connected: false,
              error: err.message,
              host: config.host,
              port: config.port
            });
          }
          this._connected = false;
          this.meld = null;
          this.channel = null;
          this.notifyStatusChange();
        });

      } catch (error) {
        const errorMsg = (error as Error).message;
        this.logger.error(`[MeldStudio] Connection failed: ${errorMsg}`);
        this._connected = false;
        this.notifyStatusChange();
        resolve({
          connected: false,
          error: errorMsg,
          host: config.host,
          port: config.port
        });
      }
    });
  }

  private subscribeToSignals(): void {
    if (!this.meld) return;

    try {
      if (this.meld.sessionChanged) {
        this.meld.sessionChanged.connect(() => {
          this.logger.debug('[MeldStudio] Session changed');
        });
      }

      if (this.meld.isStreamingChanged) {
        this.meld.isStreamingChanged.connect((isStreaming: boolean) => {
          this.logger.info(`[MeldStudio] Streaming: ${isStreaming}`);
        });
      }

      if (this.meld.isRecordingChanged) {
        this.meld.isRecordingChanged.connect((isRecording: boolean) => {
          this.logger.info(`[MeldStudio] Recording: ${isRecording}`);
        });
      }
    } catch (err) {
      this.logger.warn(`[MeldStudio] Could not subscribe to signals: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.stopReconnect();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
      this.logger.info('[MeldStudio] Disconnected');
    }
    this._connected = false;
    this.meld = null;
    this.channel = null;
    this.notifyStatusChange();
  }

  onStatusChange(callback: (status: MeldStudioConnectionStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  getStatus(): MeldStudioConnectionStatus {
    return {
      connected: this._connected,
      host: this.config?.host,
      port: this.config?.port
    };
  }

  isConnected(): boolean {
    return this._connected && this.meld !== null;
  }

  // ========== Session Data ==========

  getSession(): MeldSessionData {
    if (!this.meld || !this.meld.session) {
      return { scenes: [], layers: [], tracks: [], effects: [] };
    }

    const items = this.meld.session.items || {};
    const scenes: MeldSessionData['scenes'] = [];
    const layers: MeldSessionData['layers'] = [];
    const tracks: MeldSessionData['tracks'] = [];
    const effects: MeldSessionData['effects'] = [];

    for (const [id, item] of Object.entries(items as Record<string, any>)) {
      switch (item.type) {
        case 'scene':
          scenes.push({ id, name: item.name || id });
          break;
        case 'layer':
          layers.push({ id, name: item.name || id, sceneId: item.sceneId });
          break;
        case 'track':
          tracks.push({ id, name: item.name || id });
          break;
        case 'effect':
          effects.push({ id, name: item.name || id, layerId: item.layerId });
          break;
      }
    }

    return { scenes, layers, tracks, effects };
  }

  // ========== Scene Commands ==========

  async showScene(sceneId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.showScene(sceneId);
    this.logger.info(`[MeldStudio] showScene: ${sceneId}`);
  }

  async stageScene(sceneId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.stageScene(sceneId);
    this.logger.info(`[MeldStudio] stageScene: ${sceneId}`);
  }

  async showStaged(): Promise<void> {
    this.ensureConnected();
    await this.meld.showStaged();
    this.logger.info('[MeldStudio] showStaged');
  }

  // ========== Layer Commands ==========

  async toggleLayer(layerId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.toggleLayer(layerId);
    this.logger.info(`[MeldStudio] toggleLayer: ${layerId}`);
  }

  async setProperty(objectId: string, propertyName: string, value: any): Promise<void> {
    this.ensureConnected();
    await this.meld.setProperty(objectId, propertyName, value);
    this.logger.info(`[MeldStudio] setProperty: ${objectId}.${propertyName}`);
  }

  // ========== Effect Commands ==========

  async toggleEffect(effectId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.toggleEffect(effectId);
    this.logger.info(`[MeldStudio] toggleEffect: ${effectId}`);
  }

  // ========== Audio Commands ==========

  async toggleMute(trackId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.toggleMute(trackId);
    this.logger.info(`[MeldStudio] toggleMute: ${trackId}`);
  }

  async setGain(trackId: string, gain: number): Promise<void> {
    this.ensureConnected();
    await this.meld.setGain(trackId, gain);
    this.logger.info(`[MeldStudio] setGain: ${trackId} = ${gain}`);
  }

  // ========== Stream / Record Commands ==========

  async startStreaming(): Promise<void> {
    this.ensureConnected();
    await this.meld.startStreaming();
    this.logger.info('[MeldStudio] startStreaming');
  }

  async stopStreaming(): Promise<void> {
    this.ensureConnected();
    await this.meld.stopStreaming();
    this.logger.info('[MeldStudio] stopStreaming');
  }

  async startRecording(): Promise<void> {
    this.ensureConnected();
    await this.meld.startRecording();
    this.logger.info('[MeldStudio] startRecording');
  }

  async stopRecording(): Promise<void> {
    this.ensureConnected();
    await this.meld.stopRecording();
    this.logger.info('[MeldStudio] stopRecording');
  }

  async toggleVirtualCamera(): Promise<void> {
    this.ensureConnected();
    await this.meld.toggleVirtualCamera();
    this.logger.info('[MeldStudio] toggleVirtualCamera');
  }

  // ========== Media Playback Commands ==========

  async mediaPlay(layerId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.mediaPlay(layerId);
    this.logger.info(`[MeldStudio] mediaPlay: ${layerId}`);
  }

  async mediaPause(layerId: string): Promise<void> {
    this.ensureConnected();
    await this.meld.mediaPause(layerId);
    this.logger.info(`[MeldStudio] mediaPause: ${layerId}`);
  }

  async mediaSeek(layerId: string, seconds: number): Promise<void> {
    this.ensureConnected();
    await this.meld.mediaSeek(layerId, seconds);
    this.logger.info(`[MeldStudio] mediaSeek: ${layerId} @ ${seconds}s`);
  }

  // ========== Utility Commands ==========

  async screenshot(): Promise<void> {
    this.ensureConnected();
    await this.meld.screenshot();
    this.logger.info('[MeldStudio] screenshot');
  }

  async recordClip(): Promise<void> {
    this.ensureConnected();
    await this.meld.recordClip();
    this.logger.info('[MeldStudio] recordClip');
  }

  async showReplay(): Promise<void> {
    this.ensureConnected();
    await this.meld.showReplay();
    this.logger.info('[MeldStudio] showReplay');
  }

  async dismissReplay(): Promise<void> {
    this.ensureConnected();
    await this.meld.dismissReplay();
    this.logger.info('[MeldStudio] dismissReplay');
  }

  // ========== Widget / Stream Events ==========

  async sendStreamEvent(eventType: string, eventData: Record<string, any>): Promise<void> {
    this.ensureConnected();
    await this.meld.sendStreamEvent(eventType, eventData);
    this.logger.info(`[MeldStudio] sendStreamEvent: ${eventType}`);
  }

  // ========== Helpers ==========

  private ensureConnected(): void {
    if (!this._connected || !this.meld) {
      throw new Error('MeldStudio not connected');
    }
  }
}
