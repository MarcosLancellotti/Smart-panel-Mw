import fs from 'fs';
import path from 'path';
import { getConfigPath } from '../utils/paths';
import { LogManager } from './LogManager';
import { ConnectorConfig } from '../types/config';

export class ConfigManager {
  private configPath: string;
  private config: ConnectorConfig | null = null;
  private logger: LogManager;

  constructor(logger: LogManager) {
    this.logger = logger;
    this.configPath = getConfigPath();
    this.ensureConfigDirectory();
  }

  private ensureConfigDirectory(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created config directory: ${dir}`);
    }
  }

  // Load existing config or create default
  load(): ConnectorConfig {
    if (!fs.existsSync(this.configPath)) {
      this.logger.warn('Config file not found, creating default');
      this.config = this.getDefaultConfig();
      this.save();
    } else {
      try {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(content);
        this.logger.info('Config loaded successfully');
      } catch (error) {
        this.logger.error('Failed to parse config.json', error as Error);
        throw new Error('Invalid config.json format');
      }
    }

    return this.config!;
  }

  // Save current config
  save(): void {
    if (!this.config) {
      throw new Error('No config to save');
    }

    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
      this.logger.info('Config saved successfully');
    } catch (error) {
      this.logger.error('Failed to save config.json', error as Error);
      throw error;
    }
  }

  // Update partial config
  update(updates: Partial<ConnectorConfig>): void {
    if (!this.config) {
      throw new Error('Config not loaded');
    }

    this.config = {
      ...this.config,
      ...updates
    };

    this.save();
  }

  get(): ConnectorConfig {
    if (!this.config) {
      throw new Error('Config not loaded');
    }
    return this.config;
  }

  // Check if first run (no API key configured)
  isFirstRun(): boolean {
    return !this.config || !this.config.smartPanel.apiKey;
  }

  private getDefaultConfig(): ConnectorConfig {
    return {
      smartPanel: {
        apiUrl: 'wss://api.smart-panel.app/middleware',
        apiKey: '',
        companyId: ''
      },
      obs: {
        enabled: false,
        host: 'localhost',
        port: 4455,
        password: ''
      },
      vmix: {
        enabled: false,
        host: 'localhost',
        httpPort: 8088,
        tcpPort: 8099
      },
      casparcg: {
        enabled: false,
        host: 'localhost',
        port: 5250
      },
      meldstudio: {
        enabled: false,
        host: '127.0.0.1',
        port: 13376
      },
      dataSources: [],
      settings: {
        autoStart: false,
        minimizeToTray: false,
        logLevel: 'info',
        checkUpdates: true
      }
    };
  }
}