import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import os from 'os';
import { LogManager } from '../core/LogManager';

const SUPABASE_URL = 'https://vlxgdsqawtscusdkxbyv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseGdkc3Fhd3RzY3VzZGt4Ynl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzNzYzOTEsImV4cCI6MjA3ODk1MjM5MX0.1GZdjLooB4BwE-OSPj46Ju-IPTpvUyCB2GHMzlSngb8';

export interface AuthResult {
  success: boolean;
  company_id?: string;
  api_key_id?: string;
  api_key_name?: string;
  error?: string;
}

export interface ConnectionStatus {
  obs?: {
    connected: boolean;
    version?: string;
    host?: string;
    port?: number;
  };
  vmix?: {
    connected: boolean;
    version?: string;
    host?: string;
    port?: number;
  };
}

export interface CommandPayload {
  action: string;
  params: Record<string, unknown>;
  request_id?: string;
}

export class SupabaseService {
  private supabase: SupabaseClient;
  private logger: LogManager;
  private middlewareId: string | null = null;
  private companyId: string | null = null;
  private apiKeyId: string | null = null;
  private apiKeyName: string | null = null;
  private channel: RealtimeChannel | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private onCommandCallback: ((command: CommandPayload) => void) | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.logger.info('[Supabase] Client initialized');
  }

  /**
   * Step 1: Authenticate with API Key
   */
  async authenticate(apiKey: string): Promise<AuthResult> {
    try {
      this.logger.info('[Supabase] Authenticating with API key...');

      const { data, error } = await this.supabase.rpc('authenticate_middleware', {
        p_api_key: apiKey
      });

      if (error) {
        this.logger.error('[Supabase] Auth error', error as Error);
        return { success: false, error: error.message };
      }

      if (data && data.success) {
        this.companyId = data.company_id;
        this.apiKeyId = data.api_key_id;
        this.apiKeyName = data.api_key_name;

        this.logger.info('[Supabase] Authenticated successfully', {
          companyId: this.companyId,
          apiKeyId: this.apiKeyId,
          name: this.apiKeyName
        });

        return {
          success: true,
          company_id: data.company_id,
          api_key_id: data.api_key_id,
          api_key_name: data.api_key_name
        };
      }

      return { success: false, error: data?.error || 'Authentication failed' };
    } catch (err) {
      this.logger.error('[Supabase] Auth exception', err as Error);
      return { success: false, error: 'Connection error' };
    }
  }

  /**
   * Step 2: Register/Update middleware in database via RPC
   */
  async registerMiddleware(): Promise<{ success: boolean; middleware_id?: string; error?: string }> {
    if (!this.companyId || !this.apiKeyId) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      this.logger.info('[Supabase] Registering middleware via RPC...');

      const { data, error } = await this.supabase.rpc('register_middleware', {
        p_company_id: this.companyId,
        p_api_key_id: this.apiKeyId,
        p_name: this.apiKeyName || 'Middleware',
        p_machine_name: os.hostname(),
        p_metadata: {
          appVersion: '0.1.0',
          os: `${process.platform} ${os.release()}`,
          arch: process.arch
        },
        p_connections: {
          obs: { connected: false },
          vmix: { connected: false }
        }
      });

      if (error) {
        this.logger.error(`[Supabase] Register error: ${error.message}`, error as Error);
        return { success: false, error: error.message };
      }

      if (data && data.success) {
        this.middlewareId = data.middleware_id;
        this.logger.info('[Supabase] Middleware registered', { middlewareId: this.middlewareId });
        return { success: true, middleware_id: this.middlewareId || undefined };
      }

      return { success: false, error: data?.error || 'Registration failed' };
    } catch (err) {
      this.logger.error('[Supabase] Register exception', err as Error);
      return { success: false, error: 'Registration failed' };
    }
  }

  /**
   * Step 3: Subscribe to Realtime commands
   */
  subscribeToCommands(onCommand?: (command: CommandPayload) => void): void {
    if (!this.middlewareId) {
      this.logger.warn('[Supabase] Cannot subscribe - not registered');
      return;
    }

    this.onCommandCallback = onCommand || null;

    this.logger.info('[Supabase] Subscribing to realtime channel...', {
      channel: `middleware:${this.middlewareId}`
    });

    this.channel = this.supabase
      .channel(`middleware:${this.middlewareId}`)
      .on('broadcast', { event: 'command' }, (payload) => {
        this.logger.info('[Supabase] Command received', payload);
        const cmd = payload.payload as CommandPayload;

        // Handle ping internally
        if (cmd.action === 'ping') {
          this.sendPong(cmd.request_id);
        }

        // Forward to callback
        if (this.onCommandCallback) {
          this.onCommandCallback(cmd);
        }
      })
      .subscribe((status) => {
        this.logger.info('[Supabase] Channel status', { status });
      });
  }

  /**
   * Respond to ping with pong
   */
  private async sendPong(requestId?: string): Promise<void> {
    if (!this.channel) return;

    this.logger.info('[Supabase] Sending pong response');

    await this.channel.send({
      type: 'broadcast',
      event: 'pong',
      payload: {
        request_id: requestId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Step 4: Start heartbeat (every 30 seconds)
   */
  startHeartbeat(getConnections: () => ConnectionStatus): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.logger.info('[Supabase] Starting heartbeat (30s interval)');

    // Initial heartbeat
    this.sendHeartbeat(getConnections());

    // Periodic heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat(getConnections());
    }, 30000);
  }

  /**
   * Send heartbeat update
   */
  private async sendHeartbeat(connections: ConnectionStatus): Promise<void> {
    if (!this.apiKeyId) return;

    try {
      const { error } = await this.supabase
        .from('middlewares')
        .update({
          last_seen_at: new Date().toISOString(),
          status: 'online',
          connections
        })
        .eq('api_key_id', this.apiKeyId);

      if (error) {
        this.logger.error('[Supabase] Heartbeat error', error as Error);
      } else {
        this.logger.debug('[Supabase] Heartbeat sent');
      }
    } catch (err) {
      this.logger.error('[Supabase] Heartbeat exception', err as Error);
    }
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.info('[Supabase] Heartbeat stopped');
    }
  }

  /**
   * Unsubscribe from realtime
   */
  unsubscribe(): void {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
      this.logger.info('[Supabase] Unsubscribed from realtime');
    }
  }

  /**
   * Step 5: Disconnect cleanly (set status offline)
   */
  async disconnect(): Promise<void> {
    this.logger.info('[Supabase] Disconnecting...');

    this.stopHeartbeat();
    this.unsubscribe();

    if (this.apiKeyId) {
      try {
        await this.supabase
          .from('middlewares')
          .update({
            status: 'offline',
            last_seen_at: new Date().toISOString()
          })
          .eq('api_key_id', this.apiKeyId);

        this.logger.info('[Supabase] Status set to offline');
      } catch (err) {
        this.logger.error('[Supabase] Disconnect error', err as Error);
      }
    }

    this.middlewareId = null;
    this.companyId = null;
    this.apiKeyId = null;
    this.logger.info('[Supabase] Disconnected');
  }

  /**
   * Send command result/status back
   */
  async sendStatus(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.channel) return;

    await this.channel.send({
      type: 'broadcast',
      event,
      payload
    });
  }

  /**
   * Full connect flow: authenticate → register → subscribe → heartbeat
   */
  async connect(apiKey: string, getConnections: () => ConnectionStatus): Promise<{ success: boolean; error?: string }> {
    // Step 1: Authenticate
    const auth = await this.authenticate(apiKey);
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    // Step 2: Register middleware
    const reg = await this.registerMiddleware();
    if (!reg.success) {
      return { success: false, error: reg.error };
    }

    // Step 3: Subscribe to realtime
    this.subscribeToCommands();

    // Step 4: Start heartbeat
    this.startHeartbeat(getConnections);

    return { success: true };
  }

  // Getters
  getMiddlewareId(): string | null { return this.middlewareId; }
  getCompanyId(): string | null { return this.companyId; }
  getApiKeyId(): string | null { return this.apiKeyId; }
  getApiKeyName(): string | null { return this.apiKeyName; }
  isConnected(): boolean { return this.middlewareId !== null; }
}
