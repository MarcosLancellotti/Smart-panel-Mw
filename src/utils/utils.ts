import path from 'path';
import os from 'os';

/**
 * Get AppData path for Windows
 * %APPDATA%\Smart Panel Connector\
 */
export function getAppDataPath(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Smart Panel Connector');
}

/**
 * Get config.json path
 * %APPDATA%\Smart Panel Connector\config.json
 */
export function getConfigPath(): string {
  return path.join(getAppDataPath(), 'config.json');
}

/**
 * Get logs directory path
 * %APPDATA%\Smart Panel Connector\logs\
 */
export function getLogsPath(): string {
  return path.join(getAppDataPath(), 'logs');
}

/**
 * Get installation path (where the .exe is located)
 */
export function getInstallPath(): string {
  // When packaged with pkg, process.execPath points to the .exe
  return path.dirname(process.execPath);
}