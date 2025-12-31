import { LogManager } from '../core/LogManager';
import { XMLParser } from 'fast-xml-parser';

export interface VMixConfig {
  host: string;
  port: number;
}

export interface VMixConnectionStatus {
  connected: boolean;
  version?: string;
  host?: string;
  port?: number;
  error?: string;
}

export class VMixService {
  private logger: LogManager;
  private config: VMixConfig | null = null;
  private _connected: boolean = false;
  private _version: string | null = null;
  private xmlParser: XMLParser;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    this.logger.info('[vMix] Service initialized');
  }

  private getBaseUrl(): string {
    if (!this.config) throw new Error('vMix not configured');
    return `http://${this.config.host}:${this.config.port}/api/`;
  }

  async connect(config: VMixConfig): Promise<VMixConnectionStatus> {
    this.config = config;

    try {
      this.logger.info(`[vMix] Connecting to http://${config.host}:${config.port}...`);

      const response = await fetch(this.getBaseUrl(), {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      const parsed = this.xmlParser.parse(xml);
      this._version = parsed.vmix?.version || 'Unknown';
      this._connected = true;

      this.logger.info(`[vMix] Connected! Version: ${this._version}`);

      return {
        connected: true,
        version: this._version || undefined,
        host: config.host,
        port: config.port
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      this.logger.error(`[vMix] Connection failed: ${errorMsg}`);
      this._connected = false;

      return {
        connected: false,
        error: errorMsg,
        host: config.host,
        port: config.port
      };
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.logger.info('[vMix] Disconnected');
  }

  getStatus(): VMixConnectionStatus {
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

  // ========== vMix API Commands ==========

  private async apiCall(params: string): Promise<void> {
    if (!this._connected) throw new Error('vMix not connected');

    const url = `${this.getBaseUrl()}?${params}`;
    this.logger.info(`[vMix] API call: ${params}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`vMix API error: HTTP ${response.status}`);
    }
  }

  async getState(): Promise<any> {
    if (!this._connected) throw new Error('vMix not connected');

    const response = await fetch(this.getBaseUrl(), {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`vMix API error: HTTP ${response.status}`);
    }

    const xml = await response.text();
    const parsed = this.xmlParser.parse(xml);
    this.logger.info('[vMix] State retrieved');
    return parsed.vmix;
  }

  async showOverlay(overlayNumber: number, inputNumber: number): Promise<void> {
    await this.apiCall(`Function=OverlayInput${overlayNumber}&Input=${inputNumber}`);
    this.logger.info(`[vMix] Overlay ${overlayNumber} shown with input ${inputNumber}`);
  }

  async hideOverlay(overlayNumber: number): Promise<void> {
    await this.apiCall(`Function=OverlayInput${overlayNumber}Off`);
    this.logger.info(`[vMix] Overlay ${overlayNumber} hidden`);
  }

  async setText(input: string | number, fieldName: string, value: string): Promise<void> {
    await this.apiCall(`Function=SetText&Input=${input}&SelectedName=${fieldName}.Text&Value=${encodeURIComponent(value)}`);
    this.logger.info(`[vMix] Text set: ${fieldName} = ${value}`);
  }

  async cut(inputNumber?: number): Promise<void> {
    const params = inputNumber ? `Function=Cut&Input=${inputNumber}` : 'Function=Cut';
    await this.apiCall(params);
    this.logger.info(`[vMix] Cut${inputNumber ? ` to input ${inputNumber}` : ''}`);
  }

  async fade(duration: number, inputNumber?: number): Promise<void> {
    let params = `Function=Fade&Duration=${duration}`;
    if (inputNumber) params += `&Input=${inputNumber}`;
    await this.apiCall(params);
    this.logger.info(`[vMix] Fade (${duration}ms)${inputNumber ? ` to input ${inputNumber}` : ''}`);
  }

  async startStreaming(): Promise<void> {
    await this.apiCall('Function=StartStreaming');
    this.logger.info('[vMix] Streaming started');
  }

  async stopStreaming(): Promise<void> {
    await this.apiCall('Function=StopStreaming');
    this.logger.info('[vMix] Streaming stopped');
  }

  async startRecording(): Promise<void> {
    await this.apiCall('Function=StartRecording');
    this.logger.info('[vMix] Recording started');
  }

  async stopRecording(): Promise<void> {
    await this.apiCall('Function=StopRecording');
    this.logger.info('[vMix] Recording stopped');
  }
}
