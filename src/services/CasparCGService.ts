import net from 'net';
import { LogManager } from '../core/LogManager';

export interface CasparCGConfig {
  host: string;
  port: number;
}

export interface CasparCGConnectionStatus {
  connected: boolean;
  host?: string;
  port?: number;
  error?: string;
}

export class CasparCGService {
  private socket: net.Socket | null = null;
  private logger: LogManager;
  private config: CasparCGConfig | null = null;
  private _connected: boolean = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private onStatusChangeCallback: ((status: CasparCGConnectionStatus) => void) | null = null;
  private responseBuffer: string = '';
  private pendingResolve: ((value: { code: number; message: string }) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.logger.info('[CasparCG] Service initialized');
  }

  private notifyStatusChange(): void {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(this.getStatus());
    }
  }

  private startReconnect(): void {
    if (this.reconnectInterval || !this.config) return;

    this.logger.info('[CasparCG] Will attempt reconnection in 10 seconds...');
    this.reconnectInterval = setInterval(async () => {
      if (this._connected) {
        this.stopReconnect();
        return;
      }
      this.logger.info('[CasparCG] Attempting reconnection...');
      await this.connect(this.config!);
    }, 10000);
  }

  private stopReconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  async connect(config: CasparCGConfig): Promise<CasparCGConnectionStatus> {
    this.config = config;
    this.stopReconnect();

    return new Promise((resolve) => {
      try {
        this.logger.info(`[CasparCG] Connecting to ${config.host}:${config.port}...`);

        // Clean up existing socket
        if (this.socket) {
          this.socket.removeAllListeners();
          this.socket.destroy();
          this.socket = null;
        }

        this.socket = new net.Socket();
        this.responseBuffer = '';

        this.socket.on('data', (data) => {
          this.responseBuffer += data.toString();
          this.processBuffer();
        });

        this.socket.on('close', () => {
          if (this._connected) {
            this.logger.warn('[CasparCG] Connection closed');
            this._connected = false;
            this.rejectPending('Connection closed');
            this.notifyStatusChange();
            this.startReconnect();
          }
        });

        this.socket.on('error', (err) => {
          this.logger.error(`[CasparCG] Connection error: ${err.message}`);
          this._connected = false;
          this.rejectPending(err.message);
          this.notifyStatusChange();
        });

        this.socket.connect(config.port, config.host, () => {
          this._connected = true;
          this.logger.info('[CasparCG] Connected!');
          this.notifyStatusChange();
          resolve({
            connected: true,
            host: config.host,
            port: config.port
          });
        });

        // Connection timeout
        this.socket.setTimeout(5000, () => {
          this.socket?.destroy();
          this._connected = false;
          this.notifyStatusChange();
          resolve({
            connected: false,
            error: 'Connection timeout',
            host: config.host,
            port: config.port
          });
        });

      } catch (error) {
        const errorMsg = (error as Error).message;
        this.logger.error(`[CasparCG] Connection failed: ${errorMsg}`);
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

  private rejectPending(reason: string): void {
    if (this.pendingReject) {
      this.pendingReject(new Error(reason));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  private processBuffer(): void {
    // AMCP responses end with \r\n
    // Format: {code} {message}\r\n
    const lines = this.responseBuffer.split('\r\n');

    // If the last element is empty, we have a complete response
    if (lines.length >= 2 && lines[lines.length - 1] === '') {
      const responseLine = lines[0];
      this.responseBuffer = '';

      if (this.pendingResolve) {
        const code = parseInt(responseLine.substring(0, 3), 10);
        const message = responseLine.substring(4);
        this.pendingResolve({ code, message });
        this.pendingResolve = null;
        this.pendingReject = null;
      }
    }
  }

  private async sendCommand(command: string): Promise<{ code: number; message: string }> {
    if (!this._connected || !this.socket) {
      throw new Error('CasparCG not connected');
    }

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.responseBuffer = '';

      this.socket!.write(command + '\r\n', (err) => {
        if (err) {
          this.pendingResolve = null;
          this.pendingReject = null;
          reject(new Error(`Failed to send command: ${err.message}`));
        }
      });

      // Command timeout
      setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new Error('Command timeout'));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      }, 5000);
    });
  }

  async disconnect(): Promise<void> {
    this.stopReconnect();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
      this.logger.info('[CasparCG] Disconnected');
    }
    this._connected = false;
    this.rejectPending('Disconnected');
    this.notifyStatusChange();
  }

  onStatusChange(callback: (status: CasparCGConnectionStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  getStatus(): CasparCGConnectionStatus {
    return {
      connected: this._connected,
      host: this.config?.host,
      port: this.config?.port
    };
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ========== Media Commands ==========

  async play(channel: number, layer: number, clip?: string): Promise<{ code: number; message: string }> {
    const cmd = clip
      ? `PLAY ${channel}-${layer} "${clip}"`
      : `PLAY ${channel}-${layer}`;
    const result = await this.sendCommand(cmd);
    this.logger.info(`[CasparCG] PLAY ${channel}-${layer}${clip ? ` "${clip}"` : ''}`);
    return result;
  }

  async stop(channel: number, layer: number): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`STOP ${channel}-${layer}`);
    this.logger.info(`[CasparCG] STOP ${channel}-${layer}`);
    return result;
  }

  async load(channel: number, layer: number, clip: string): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`LOAD ${channel}-${layer} "${clip}"`);
    this.logger.info(`[CasparCG] LOAD ${channel}-${layer} "${clip}"`);
    return result;
  }

  async loadBg(channel: number, layer: number, clip: string, auto?: boolean): Promise<{ code: number; message: string }> {
    const cmd = `LOADBG ${channel}-${layer} "${clip}"${auto ? ' AUTO' : ''}`;
    const result = await this.sendCommand(cmd);
    this.logger.info(`[CasparCG] LOADBG ${channel}-${layer} "${clip}"${auto ? ' AUTO' : ''}`);
    return result;
  }

  async clear(channel: number, layer?: number): Promise<{ code: number; message: string }> {
    const target = layer !== undefined ? `${channel}-${layer}` : `${channel}`;
    const result = await this.sendCommand(`CLEAR ${target}`);
    this.logger.info(`[CasparCG] CLEAR ${target}`);
    return result;
  }

  // ========== CG (Template/Graphics) Commands ==========

  async cgAdd(channel: number, layer: number, template: string, playOnLoad: boolean, data?: string): Promise<{ code: number; message: string }> {
    let cmd = `CG ${channel}-${layer} ADD 1 "${template}" ${playOnLoad ? '1' : '0'}`;
    if (data) {
      cmd += ` "${data.replace(/"/g, '\\"')}"`;
    }
    const result = await this.sendCommand(cmd);
    this.logger.info(`[CasparCG] CG ADD ${channel}-${layer} "${template}"`);
    return result;
  }

  async cgUpdate(channel: number, layer: number, data: string): Promise<{ code: number; message: string }> {
    const cmd = `CG ${channel}-${layer} UPDATE 1 "${data.replace(/"/g, '\\"')}"`;
    const result = await this.sendCommand(cmd);
    this.logger.info(`[CasparCG] CG UPDATE ${channel}-${layer}`);
    return result;
  }

  async cgStop(channel: number, layer: number): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`CG ${channel}-${layer} STOP 1`);
    this.logger.info(`[CasparCG] CG STOP ${channel}-${layer}`);
    return result;
  }

  async cgNext(channel: number, layer: number): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`CG ${channel}-${layer} NEXT 1`);
    this.logger.info(`[CasparCG] CG NEXT ${channel}-${layer}`);
    return result;
  }

  async cgClear(channel: number, layer: number): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`CG ${channel}-${layer} CLEAR`);
    this.logger.info(`[CasparCG] CG CLEAR ${channel}-${layer}`);
    return result;
  }

  async cgPlay(channel: number, layer: number): Promise<{ code: number; message: string }> {
    const result = await this.sendCommand(`CG ${channel}-${layer} PLAY 1`);
    this.logger.info(`[CasparCG] CG PLAY ${channel}-${layer}`);
    return result;
  }
}
