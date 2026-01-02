export interface SmartPanelConfig {
    apiUrl: string;
    apiKey: string;
    companyId: string;
  }
  
  export interface OBSConfig {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
  }
  
  export interface VMixConfig {
    enabled: boolean;
    host: string;
    httpPort: number;
    tcpPort: number;
  }
  
  export interface DataSourceConfig {
    type: 'excel' | 'csv' | 'json';
    name: string;
    path: string;
    watchChanges: boolean;
  }
  
  export interface SettingsConfig {
    autoStart: boolean;
    minimizeToTray: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    checkUpdates: boolean;
  }
  
  export interface ConnectorConfig {
    smartPanel: SmartPanelConfig;
    obs?: OBSConfig;
    vmix?: VMixConfig;
    dataSources?: DataSourceConfig[];
    settings: SettingsConfig;
    runAsService?: boolean;
  }