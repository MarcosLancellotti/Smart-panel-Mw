import { contextBridge, ipcRenderer } from 'electron';
import { ConnectorConfig } from '../types/config';

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: (): Promise<ConnectorConfig> => ipcRenderer.invoke('get-config'),
  saveConfig: (updates: Partial<ConnectorConfig>): Promise<boolean> => ipcRenderer.invoke('save-config', updates),
  isFirstRun: (): Promise<boolean> => ipcRenderer.invoke('is-first-run'),

  // Logs
  getLogsPath: (): Promise<string> => ipcRenderer.invoke('get-logs-path'),
  getRecentLogs: (lines: number): Promise<string[]> => ipcRenderer.invoke('get-recent-logs', lines),

  // Utils
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  // API Key verification & connection
  verifyApiKey: (apiKey: string): Promise<{ valid: boolean; error?: string; companyId?: string; name?: string; suspended?: boolean; suspend_reason?: string }> =>
    ipcRenderer.invoke('verify-api-key', apiKey),
  getConnectionStatus: (): Promise<{ connected: boolean; name?: string; companyId?: string }> =>
    ipcRenderer.invoke('get-connection-status'),
  onApiConnected: (callback: (data: { name?: string; companyId?: string }) => void) => {
    ipcRenderer.on('api-connected', (_event, data) => callback(data));
  },
  onApiSuspended: (callback: (data: { reason?: string }) => void) => {
    ipcRenderer.on('api-suspended', (_event, data) => callback(data));
  },
  onApiSuspendChanged: (callback: (data: { suspended: boolean; reason?: string; message?: string }) => void) => {
    ipcRenderer.on('api-suspend-changed', (_event, data) => callback(data));
  },

  // Connection tests
  testOBSConnection: (config: { host: string; port: number; password?: string }): Promise<{ success: boolean; error?: string; version?: string }> =>
    ipcRenderer.invoke('test-obs-connection', config),
  testVMixConnection: (config: { host: string; port: number }): Promise<{ success: boolean; error?: string; version?: string }> =>
    ipcRenderer.invoke('test-vmix-connection', config),
  getOBSStatus: (): Promise<{ connected: boolean; version?: string }> =>
    ipcRenderer.invoke('get-obs-status'),
  getVMixStatus: (): Promise<{ connected: boolean; version?: string }> =>
    ipcRenderer.invoke('get-vmix-status')
});

// Type declarations for renderer
declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<ConnectorConfig>;
      saveConfig: (updates: Partial<ConnectorConfig>) => Promise<boolean>;
      isFirstRun: () => Promise<boolean>;
      getLogsPath: () => Promise<string>;
      getRecentLogs: (lines: number) => Promise<string[]>;
      openExternal: (url: string) => Promise<void>;
      getVersion: () => Promise<string>;
      verifyApiKey: (apiKey: string) => Promise<{ valid: boolean; error?: string; companyId?: string; name?: string; suspended?: boolean; suspend_reason?: string }>;
      getConnectionStatus: () => Promise<{ connected: boolean; name?: string; companyId?: string }>;
      onApiConnected: (callback: (data: { name?: string; companyId?: string }) => void) => void;
      onApiSuspended: (callback: (data: { reason?: string }) => void) => void;
      onApiSuspendChanged: (callback: (data: { suspended: boolean; reason?: string; message?: string }) => void) => void;
      testOBSConnection: (config: { host: string; port: number; password?: string }) => Promise<{ success: boolean; error?: string; version?: string }>;
      testVMixConnection: (config: { host: string; port: number }) => Promise<{ success: boolean; error?: string; version?: string }>;
      getOBSStatus: () => Promise<{ connected: boolean; version?: string }>;
      getVMixStatus: () => Promise<{ connected: boolean; version?: string }>;
    };
  }
}
