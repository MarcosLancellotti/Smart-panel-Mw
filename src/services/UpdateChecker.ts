import { app, BrowserWindow, shell } from 'electron';
import { LogManager } from '../core/LogManager';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';

const GITHUB_OWNER = 'MarcosLancellotti';
const GITHUB_REPO = 'Smart-panel-Mw';
const CHECK_DELAY_MS = 5000;

// Asset names in GitHub Releases
const MAC_ASSET = 'Smart-Panel-Middleware-mac.dmg';
const WIN_ASSET = 'Smart-Panel-Middleware-win.zip';

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  downloadUrl?: string;
  message?: string;
  required?: boolean;
  error?: string;
  progress?: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

export class UpdateChecker {
  private logger: LogManager;
  private mainWindow: BrowserWindow | null = null;
  private currentVersion: string;
  private latestRelease: GitHubRelease | null = null;

  constructor(logger: LogManager, currentVersion: string) {
    this.logger = logger;
    this.currentVersion = currentVersion;
  }

  setWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  checkOnStartup(): void {
    setTimeout(() => {
      this.checkForUpdates();
    }, CHECK_DELAY_MS);
  }

  async checkForUpdates(): Promise<void> {
    this.sendToRenderer({ status: 'checking' });
    this.logger.info('[Updater] Checking for updates...');

    try {
      const release = await this.fetchLatestRelease();
      this.latestRelease = release;
      const latestVersion = release.tag_name.replace(/^v/, '');

      if (this.isNewerVersion(latestVersion, this.currentVersion)) {
        this.logger.info(`[Updater] New version available: v${latestVersion} (current: v${this.currentVersion})`);
        this.sendToRenderer({
          status: 'available',
          version: latestVersion,
          downloadUrl: release.html_url
        });
      } else {
        this.logger.info('[Updater] App is up to date');
        this.sendToRenderer({ status: 'not-available' });
      }
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`[Updater] Check failed: ${message}`);
      this.sendToRenderer({ status: 'error', error: message });
    }
  }

  /**
   * Download the correct artifact for this platform and open it
   */
  async downloadAndInstall(): Promise<void> {
    const assetName = process.platform === 'darwin' ? MAC_ASSET : WIN_ASSET;

    // Find the download URL from the cached release
    let downloadUrl: string | null = null;

    if (this.latestRelease) {
      const asset = this.latestRelease.assets.find(a => a.name === assetName);
      if (asset) {
        downloadUrl = asset.browser_download_url;
      }
    }

    // Fallback: use the /releases/latest/download/ URL pattern
    if (!downloadUrl) {
      downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${assetName}`;
    }

    const destPath = path.join(os.tmpdir(), assetName);
    this.logger.info(`[Updater] Downloading ${assetName} to ${destPath}`);
    this.sendToRenderer({ status: 'downloading', progress: 0 });

    try {
      await this.downloadFile(downloadUrl, destPath);

      this.logger.info(`[Updater] Download complete: ${destPath}`);
      this.sendToRenderer({ status: 'downloaded' });

      // Open the downloaded file (mounts DMG on macOS, opens ZIP on Windows)
      shell.openPath(destPath);

      // Give the OS a moment to open the file, then quit so the user can install
      setTimeout(() => {
        app.quit();
      }, 1500);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`[Updater] Download failed: ${message}`);
      this.sendToRenderer({ status: 'error', error: message });
    }
  }

  openReleasePage(): void {
    shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const request = (reqUrl: string) => {
        https.get(reqUrl, (res) => {
          // Handle GitHub redirects (302 → S3)
          if (res.statusCode === 302 && res.headers.location) {
            request(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;

          res.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const progress = Math.round((downloadedBytes / totalBytes) * 100);
              this.sendToRenderer({ status: 'downloading', progress });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close(() => resolve());
          });
        }).on('error', (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      };

      request(url);
    });
  }

  private fetchLatestRelease(): Promise<GitHubRelease> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': 'Smart-Panel-Middleware' }
      };

      https.get(options, (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Invalid JSON from GitHub API'));
            }
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}`));
          }
        });
      }).on('error', (err) => reject(err));
    });
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  private sendToRenderer(status: UpdateStatus): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', status);
    }
  }
}
