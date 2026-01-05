import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import os from 'os';
import WebSocket from 'ws';
import { LogManager } from '../core/LogManager';

// Make WebSocket available globally for Supabase Realtime in Node.js
(global as any).WebSocket = WebSocket;

const SUPABASE_URL = 'https://vlxgdsqawtscusdkxbyv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseGdkc3Fhd3RzY3VzZGt4Ynl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzNzYzOTEsImV4cCI6MjA3ODk1MjM5MX0.1GZdjLooB4BwE-OSPj46Ju-IPTpvUyCB2GHMzlSngb8';

const APP_VERSION = '1.3.0';

export interface AuthResult {
  success: boolean;
  middleware_id?: string;
  company_id?: string;
  api_key_id?: string;
  api_key_name?: string;
  message?: string;
  error?: string;
  active?: boolean;
  suspend_reason?: string;
}

export interface SuspendInfo {
  suspended: boolean;
  reason?: string;
  message?: string;
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
  response_channel?: string;
  timestamp?: number;
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
  private retryInterval: NodeJS.Timeout | null = null;
  private onCommandCallback: ((command: CommandPayload) => void) | null = null;
  private onSuspendCallback: ((info: SuspendInfo) => void) | null = null;
  private suspended: boolean = false;
  private suspendReason: string | null = null;
  private savedApiKey: string | null = null;
  private savedGetConnections: (() => ConnectionStatus) | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;

    // Check WebSocket availability
    const wsAvailable = typeof WebSocket !== 'undefined';
    this.logger.info(`[Supabase] WebSocket available: ${wsAvailable}`);

    // Log connection attempt
    this.logger.info(`[Supabase] Connecting to: ${SUPABASE_URL}`);

    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: {
        params: {
          eventsPerSecond: 10
        },
        timeout: 30000 // 30 second timeout
      }
    });

    // Test if we can reach Supabase
    this.testConnection();

    this.logger.info('[Supabase] Client initialized with Realtime config');
  }

  private testRealtimeChannel(): void {
    this.logger.info('[Supabase] Testing Realtime with simple channel...');
    const testChannel = this.supabase.channel('test-channel-' + Date.now());
    testChannel.subscribe((status, err) => {
      this.logger.info(`[Supabase] TEST CHANNEL STATUS: ${status}`);
      if (err) {
        this.logger.error(`[Supabase] TEST CHANNEL ERROR: ${JSON.stringify(err)}`);
      }
      if (status === 'SUBSCRIBED') {
        this.logger.info('✅ Realtime works!');
        // Cleanup test channel
        this.supabase.removeChannel(testChannel);
      } else if (status === 'TIMED_OUT') {
        this.logger.error('❌ Realtime test TIMED_OUT');
      }
    });
  }

  private async testConnection(): Promise<void> {
    try {
      const { data, error } = await this.supabase.from('middlewares').select('count').limit(1);
      if (error) {
        this.logger.error(`[Supabase] Connection test failed: ${error.message}`);
      } else {
        this.logger.info('[Supabase] Connection test OK - can reach database');
      }
    } catch (err) {
      this.logger.error(`[Supabase] Connection test exception: ${(err as Error).message}`);
    }
  }

  /**
   * Authenticate with API Key using authenticate_middleware RPC
   * Returns middleware_id directly
   */
  async authenticate(apiKey: string): Promise<AuthResult> {
    try {
      this.logger.info('[Supabase] Authenticating with API key...');

      const { data, error } = await this.supabase.rpc('authenticate_middleware', {
        p_api_key: apiKey,
        p_machine_name: os.hostname(),
        p_metadata: {
          appVersion: APP_VERSION,
          os: process.platform,
          nodeVersion: process.version
        }
      });

      this.logger.info(`[Supabase] RPC response: ${JSON.stringify({ data, error })}`);

      if (error) {
        this.logger.error(`[Supabase] Auth error: ${error.message}`, error as Error);
        return { success: false, error: error.message };
      }

      if (!data) {
        this.logger.error('[Supabase] Auth failed: No data returned from RPC');
        return { success: false, error: 'No response from server' };
      }

      if (data.success) {
        this.middlewareId = data.middleware_id;
        this.companyId = data.company_id;
        this.apiKeyName = data.api_key_name || data.name;

        // Check if middleware is active (not suspended)
        const isActive = data.active !== false; // Default to true if not specified

        this.logger.info('[Supabase] Authenticated successfully', {
          middlewareId: this.middlewareId,
          companyId: this.companyId,
          name: this.apiKeyName,
          active: isActive
        });

        // If suspended, handle it
        if (!isActive) {
          this.logger.warn(`[Supabase] Middleware is suspended: ${data.suspend_reason || 'No reason provided'}`);
          this.handleSuspend(data.suspend_reason || 'disabled_by_platform', data.suspend_message);
          return {
            success: true,
            middleware_id: data.middleware_id,
            company_id: data.company_id,
            api_key_name: data.api_key_name || data.name,
            active: false,
            suspend_reason: data.suspend_reason
          };
        }

        // If was suspended but now active, resume
        if (this.suspended) {
          this.handleResume();
        }

        return {
          success: true,
          middleware_id: data.middleware_id,
          company_id: data.company_id,
          api_key_name: data.api_key_name || data.name,
          active: true
        };
      }

      this.logger.error(`[Supabase] Auth failed: ${data.error || 'Unknown error'}`);
      return { success: false, error: data.error || 'Authentication failed' };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Unknown error';
      this.logger.error(`[Supabase] Auth exception: ${errorMsg}`, err as Error);
      return { success: false, error: `Connection error: ${errorMsg}` };
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
        this.logger.info(`[Supabase] Middleware registered with ID: ${this.middlewareId}`);
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

    const channelName = `middleware:${this.middlewareId}`;

    // Check if already subscribed to this channel
    if (this.channel) {
      this.logger.info('[Supabase] Already subscribed, skipping duplicate subscription');
      // Just update the callback if provided
      if (onCommand) {
        this.onCommandCallback = onCommand;
      }
      return;
    }

    this.onCommandCallback = onCommand || null;

    this.logger.info(`[Supabase] Subscribing to realtime channel: ${channelName}`);

    // Create channel with explicit config
    this.channel = this.supabase.channel(channelName, {
      config: {
        broadcast: { self: false }
      }
    });

    // Listen specifically for command events
    this.channel.on('broadcast', { event: 'command' }, async (payload) => {
      const cmd = payload.payload as CommandPayload;
      this.logger.info(`📥 Command: ${cmd.action} (request_id: ${cmd.request_id})`);

      // Handle middleware_disable - suspend immediately
      if (cmd.action === 'middleware_disable') {
        const reason = (cmd.params?.reason as string) || 'disabled_by_platform';
        const message = (cmd.params?.message as string) || undefined;
        this.logger.warn(`⛔ Middleware disabled: ${reason}`);

        // Send response before suspending
        if (cmd.response_channel) {
          await this.sendResponse(cmd.request_id!, {
            success: true,
            data: { acknowledged: true }
          }, cmd.response_channel);
        }

        this.handleSuspend(reason, message);
        return;
      }

      // Handle middleware_enable - resume
      if (cmd.action === 'middleware_enable') {
        this.logger.info('✅ Middleware enabled');

        if (cmd.response_channel) {
          await this.sendResponse(cmd.request_id!, {
            success: true,
            data: { acknowledged: true }
          }, cmd.response_channel);
        }

        this.handleResume();
        return;
      }

      // If suspended, ignore other commands
      if (this.suspended) {
        this.logger.warn(`[Supabase] Ignoring command while suspended: ${cmd.action}`);
        if (cmd.response_channel) {
          await this.sendError(cmd.request_id!, 'Middleware is suspended', cmd.response_channel);
        }
        return;
      }

      // Handle ping internally - send both pong AND response to response_channel
      if (cmd.action === 'ping') {
        this.logger.info('🏓 Responding with pong...');
        // 1. Send pong event on main channel (for latency measurement)
        this.sendPong(cmd.request_id);
        // 2. Send response to response_channel
        if (cmd.response_channel) {
          await this.sendResponse(cmd.request_id!, {
            success: true,
            data: { pong: true, timestamp: Date.now() }
          }, cmd.response_channel);
        }
      }

      // Forward to callback for other commands
      if (this.onCommandCallback) {
        this.onCommandCallback(cmd);
      }
    });

    // Subscribe to the channel
    this.channel.subscribe((status, err) => {
      this.logger.info(`[Supabase] Channel status: ${status}`);
      if (err) {
        this.logger.error(`[Supabase] Channel error: ${JSON.stringify(err)}`);
      }
      if (status === 'SUBSCRIBED') {
        this.logger.info('✅ Channel SUBSCRIBED - ready to receive commands');
      } else if (status === 'TIMED_OUT') {
        this.logger.error('❌ Channel TIMED_OUT - Realtime connection failed');
      } else if (status === 'CHANNEL_ERROR') {
        this.logger.error('❌ Channel ERROR');
      }
    });
  }

  /**
   * Respond to ping with pong
   */
  private async sendPong(requestId?: string): Promise<void> {
    if (!this.channel) {
      this.logger.error('❌ Cannot send pong - no channel');
      return;
    }

    try {
      this.logger.info(`🏓 Sending pong with request_id: ${requestId}`);
      await this.channel.send({
        type: 'broadcast',
        event: 'pong',
        payload: {
          request_id: requestId,
          timestamp: Date.now()
        }
      });
      this.logger.info('✅ Pong sent successfully');
    } catch (err) {
      this.logger.error(`❌ Pong failed: ${(err as Error).message}`);
    }
  }

  /**
   * Send response back to Smart Panel via response_channel
   */
  async sendResponse(requestId: string, data: Record<string, unknown>, responseChannel?: string): Promise<void> {
    const payload = {
      request_id: requestId,
      ...data
    };

    // If response_channel is provided, use it
    if (responseChannel) {
      this.logger.info(`📤 Sending response to channel: ${responseChannel}`);
      const respChannel = this.supabase.channel(responseChannel);

      respChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          respChannel.send({
            type: 'broadcast',
            event: 'response',
            payload
          }).then(() => {
            this.logger.info(`✅ Response sent to ${responseChannel}`);
            this.supabase.removeChannel(respChannel);
          }).catch((err) => {
            this.logger.error(`❌ Response failed: ${err.message}`);
            this.supabase.removeChannel(respChannel);
          });
        }
      });
      return;
    }

    // Fallback to main channel
    if (!this.channel) {
      this.logger.error('❌ Cannot send response - no channel');
      return;
    }

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'response',
        payload
      });
      this.logger.info(`📤 Response sent for request: ${requestId}`);
    } catch (err) {
      this.logger.error(`❌ Response failed: ${(err as Error).message}`);
    }
  }

  /**
   * Send error response back to Smart Panel
   */
  async sendError(requestId: string, error: string, responseChannel?: string): Promise<void> {
    const payload = {
      request_id: requestId,
      success: false,
      error
    };

    // If response_channel is provided, use it
    if (responseChannel) {
      this.logger.info(`📤 Sending error response to channel: ${responseChannel}`);
      const respChannel = this.supabase.channel(responseChannel);

      respChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          respChannel.send({
            type: 'broadcast',
            event: 'response',
            payload
          }).then(() => {
            this.logger.info(`✅ Error response sent to ${responseChannel}`);
            this.supabase.removeChannel(respChannel);
          }).catch((err) => {
            this.logger.error(`❌ Error response failed: ${err.message}`);
            this.supabase.removeChannel(respChannel);
          });
        }
      });
      return;
    }

    // Fallback to main channel
    if (!this.channel) return;

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'response',
        payload
      });
      this.logger.info(`📤 Error response sent for request: ${requestId}`);
    } catch (err) {
      this.logger.error(`❌ Error response failed: ${(err as Error).message}`);
    }
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
   * Send heartbeat update using update_middleware_status RPC
   * Also checks if middleware is still active
   */
  private async sendHeartbeat(connections: ConnectionStatus): Promise<void> {
    if (!this.middlewareId) return;

    try {
      const { data, error } = await this.supabase.rpc('update_middleware_status', {
        p_middleware_id: this.middlewareId,
        p_status: 'online',
        p_connections: connections,
        p_metadata: {
          appVersion: APP_VERSION,
          os: process.platform,
          lastHeartbeat: new Date().toISOString()
        }
      });

      if (error) {
        this.logger.error(`[Supabase] Heartbeat error: ${error.message} (code: ${error.code})`);
      } else {
        this.logger.debug('[Supabase] Heartbeat sent');

        // Check if middleware is still active (if response includes this info)
        if (data && data.active === false) {
          this.logger.warn(`[Supabase] Heartbeat indicates middleware is suspended: ${data.suspend_reason}`);
          this.handleSuspend(data.suspend_reason || 'disabled_by_platform', data.suspend_message);
        }
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
   * Handle middleware suspension
   */
  private handleSuspend(reason: string, message?: string): void {
    if (this.suspended) return; // Already suspended

    this.suspended = true;
    this.suspendReason = reason;

    this.logger.warn(`⛔ [Supabase] Middleware SUSPENDED: ${reason}`);

    // Stop heartbeat (but keep channel to receive middleware_enable)
    this.stopHeartbeat();

    // DON'T unsubscribe - we need to keep listening for middleware_enable
    // Commands are already ignored when suspended (see subscribeToCommands)

    // Notify callback
    if (this.onSuspendCallback) {
      this.onSuspendCallback({
        suspended: true,
        reason,
        message
      });
    }

    // Start retry interval as backup (every 60 seconds)
    this.startRetry();
  }

  /**
   * Handle middleware resume
   */
  private handleResume(): void {
    if (!this.suspended) return; // Not suspended

    this.logger.info('✅ [Supabase] Middleware RESUMED');

    this.suspended = false;
    this.suspendReason = null;

    // Stop retry interval
    this.stopRetry();

    // Notify callback
    if (this.onSuspendCallback) {
      this.onSuspendCallback({
        suspended: false
      });
    }

    // If channel still exists, just restart heartbeat
    // If channel was lost, do full reconnect
    if (this.channel && this.savedGetConnections) {
      this.logger.info('[Supabase] Restarting heartbeat after resume...');
      this.startHeartbeat(this.savedGetConnections);
    } else if (this.savedApiKey && this.savedGetConnections) {
      this.logger.info('[Supabase] Channel lost, doing full reconnect...');
      this.connect(this.savedApiKey, this.savedGetConnections, this.onCommandCallback || undefined);
    }
  }

  /**
   * Start retry interval to check if middleware is re-enabled
   */
  private startRetry(): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }

    this.logger.info('[Supabase] Starting retry check (60s interval)');

    this.retryInterval = setInterval(async () => {
      if (!this.savedApiKey) return;

      this.logger.info('[Supabase] Checking if middleware is re-enabled...');

      // Try to authenticate again
      const auth = await this.authenticate(this.savedApiKey);

      if (auth.success && auth.active !== false) {
        this.logger.info('[Supabase] Middleware is now active!');
        this.handleResume();
      } else {
        this.logger.info('[Supabase] Middleware still suspended');
      }
    }, 60000);
  }

  /**
   * Stop retry interval
   */
  private stopRetry(): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
      this.logger.info('[Supabase] Retry check stopped');
    }
  }

  /**
   * Set suspend state change callback
   */
  onSuspendChange(callback: (info: SuspendInfo) => void): void {
    this.onSuspendCallback = callback;
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
   * Disconnect cleanly (set status offline)
   */
  async disconnect(): Promise<void> {
    this.logger.info('[Supabase] Disconnecting...');

    this.stopHeartbeat();
    this.stopRetry();
    this.unsubscribe();
    this.suspended = false;
    this.suspendReason = null;

    if (this.middlewareId) {
      try {
        await this.supabase.rpc('update_middleware_status', {
          p_middleware_id: this.middlewareId,
          p_status: 'offline',
          p_connections: {},
          p_metadata: {
            appVersion: APP_VERSION,
            os: process.platform,
            disconnectedAt: new Date().toISOString()
          }
        });

        this.logger.info('[Supabase] Status set to offline');
      } catch (err) {
        this.logger.error('[Supabase] Disconnect error', err as Error);
      }
    }

    this.middlewareId = null;
    this.companyId = null;
    this.apiKeyId = null;
    this.apiKeyName = null;
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
   * Full connect flow: authenticate → subscribe → heartbeat
   * authenticate_middleware already creates/updates the middleware record
   */
  async connect(
    apiKey: string,
    getConnections: () => ConnectionStatus,
    onCommand?: (command: CommandPayload) => void
  ): Promise<{ success: boolean; error?: string; suspended?: boolean; suspend_reason?: string }> {
    // Save for retry
    this.savedApiKey = apiKey;
    this.savedGetConnections = getConnections;

    // Step 1: Authenticate (also registers middleware)
    const auth = await this.authenticate(apiKey);
    if (!auth.success) {
      return { success: false, error: auth.error };
    }

    // Check if suspended
    if (auth.active === false) {
      return {
        success: true,
        suspended: true,
        suspend_reason: auth.suspend_reason
      };
    }

    // Step 2: Subscribe to realtime with command handler
    this.subscribeToCommands(onCommand);

    // Step 3: Start heartbeat
    this.startHeartbeat(getConnections);

    return { success: true, suspended: false };
  }

  /**
   * Update connection status for OBS/vMix in database
   */
  async updateConnectionStatus(connections: ConnectionStatus): Promise<void> {
    if (!this.middlewareId) return;

    try {
      const { error } = await this.supabase.rpc('update_middleware_status', {
        p_middleware_id: this.middlewareId,
        p_status: 'online',
        p_connections: connections,
        p_metadata: {
          appVersion: APP_VERSION,
          os: process.platform,
          lastUpdate: new Date().toISOString()
        }
      });

      if (error) {
        this.logger.error('[Supabase] Update connections error', error as Error);
      } else {
        this.logger.info('[Supabase] Connection status updated', connections);
      }
    } catch (err) {
      this.logger.error('[Supabase] Update connections exception', err as Error);
    }
  }

  // Getters
  getMiddlewareId(): string | null { return this.middlewareId; }
  getCompanyId(): string | null { return this.companyId; }
  getApiKeyId(): string | null { return this.apiKeyId; }
  getApiKeyName(): string | null { return this.apiKeyName; }
  isConnected(): boolean { return this.middlewareId !== null && !this.suspended; }
  isSuspended(): boolean { return this.suspended; }
  getSuspendReason(): string | null { return this.suspendReason; }
}
