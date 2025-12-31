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

  // API Key verification
  verifyApiKey: (apiKey: string): Promise<{ valid: boolean; error?: string; companyId?: string }> =>
    ipcRenderer.invoke('verify-api-key', apiKey),

  // Connection tests
  testOBSConnection: (config: { host: string; port: number; password?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('test-obs-connection', config),
  testVMixConnection: (config: { host: string; port: number }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('test-vmix-connection', config)
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
      verifyApiKey: (apiKey: string) => Promise<{ valid: boolean; error?: string; companyId?: string }>;
      testOBSConnection: (config: { host: string; port: number; password?: string }) => Promise<{ success: boolean; error?: string }>;
      testVMixConnection: (config: { host: string; port: number }) => Promise<{ success: boolean; error?: string }>;
    };
  }
}
