import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { getLogsPath } from '../utils/paths';

export class LogManager {
  private logger!: winston.Logger;
  private logsPath: string;

  constructor() {
    this.logsPath = getLogsPath();
    this.ensureLogsDirectory();
    this.initLogger();
  }

  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsPath)) {
      fs.mkdirSync(this.logsPath, { recursive: true });
    }
  }

  private initLogger(): void {
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        return stack
          ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
          : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      })
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      transports: [
        // Combined log (info + error)
        new DailyRotateFile({
          filename: path.join(this.logsPath, 'app-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d', // Keep logs for 14 days
          zippedArchive: true
        }),

        // Error log (only errors)
        new DailyRotateFile({
          filename: path.join(this.logsPath, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '30d',
          zippedArchive: true
        }),

        // Debug log (verbose, only if DEBUG=true)
        ...(process.env.DEBUG === 'true' ? [
          new DailyRotateFile({
            filename: path.join(this.logsPath, 'debug-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'debug',
            maxSize: '50m',
            maxFiles: '7d',
            zippedArchive: true
          })
        ] : [])
      ]
    });

    this.logger.info('LogManager initialized');
    this.logger.info(`Logs directory: ${this.logsPath}`);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  error(message: string, error?: Error, meta?: any): void {
    this.logger.error(message, { error, ...meta });
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  // Log connection events
  logConnection(
    type: 'obs' | 'vmix' | 'smartpanel',
    status: 'connected' | 'disconnected' | 'error',
    details?: any
  ): void {
    this.info(`[${type.toUpperCase()}] ${status}`, details);
  }

  // Log commands executed
  logCommand(source: string, command: string, params?: any, result?: any): void {
    this.info(`[COMMAND] ${source} -> ${command}`, { params, result });
  }

  // Get logs path for UI display
  getLogsPath(): string {
    return this.logsPath;
  }

  // Read recent logs (last N lines) - newest first
  async getRecentLogs(lines: number = 50): Promise<string[]> {
    const logFile = path.join(
      this.logsPath,
      `app-${new Date().toISOString().split('T')[0]}.log`
    );

    if (!fs.existsSync(logFile)) {
      return ['No logs available for today'];
    }

    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(line => line.trim());
    return allLines.slice(-lines).reverse();
  }
}