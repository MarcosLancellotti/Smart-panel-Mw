// tailor.config.js - Smart Panel Middleware Build Configuration
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');

const version = require('./package.json').version;
const productName = 'Smart Panel Middleware';

module.exports = {
  appId: 'app.smart-panel.middleware',
  productName: productName,

  directories: {
    output: 'dist'
  },

  files: [
    'build/**/*',
    'node_modules/**/*'
  ],

  extraResources: [
    {
      from: 'assets',
      to: 'assets',
      filter: ['**/*']
    }
  ],

  // macOS - DMG installer (drag to Applications)
  mac: {
    target: 'dmg',
    icon: 'assets/icon.icns',
    identity: null,
    category: 'public.app-category.utilities'
  },

  dmg: {
    title: '${productName}',
    icon: 'assets/icon.icns',
    background: null,
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ],
    window: {
      width: 540,
      height: 380
    }
  },

  // Windows - Directory (we create custom installer)
  win: {
    target: [
      {
        target: 'dir',
        arch: ['x64']
      }
    ],
    icon: 'assets/logo.png'
  },

  afterPack: async (context) => {
    const { appOutDir, electronPlatformName } = context;

    // Create custom installer for Windows
    if (electronPlatformName === 'win32') {
      await createWindowsInstaller(appOutDir, version, productName);
    }
  },

  afterAllArtifactBuild: async () => {
    const distPath = path.join(__dirname, 'dist');

    // Rename DMG to standard name for GitHub Releases
    const dmgFile = fs.readdirSync(distPath).find(f => f.endsWith('.dmg') && !f.includes('blockmap'));
    if (dmgFile && dmgFile !== 'Smart-Panel-Middleware-mac.dmg') {
      await fs.move(
        path.join(distPath, dmgFile),
        path.join(distPath, 'Smart-Panel-Middleware-mac.dmg'),
        { overwrite: true }
      );
    }

    console.log('\n✅ BUILD COMPLETED!\n');
    console.log('📦 Generated artifacts:\n');

    const files = fs.readdirSync(distPath).filter(f => f.endsWith('.dmg') || f.endsWith('.zip'));
    files.forEach(file => {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  📦 ${file} (${sizeMB} MB)`);
    });
  }
};

/**
 * Creates Windows installer with GUI
 */
async function createWindowsInstaller(outDir, version, productName) {
  console.log('🪟 Creating Windows installer with GUI...');

  const installerDir = path.join(path.dirname(outDir), 'installer-windows');
  const actualAppPath = outDir;

  await fs.remove(installerDir);
  await fs.ensureDir(installerDir);

  console.log('  📋 Copying application...');
  await fs.copy(actualAppPath, path.join(installerDir, 'SmartPanelMiddleware'));

  // Create PowerShell installer script
  const powershellContent = `# ${productName} - GUI Installer
# Version: ${version}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$appName = "${productName}"
$appFolder = "SmartPanelMiddleware"
$exeName = "${productName}.exe"
$version = "${version}"

function Show-Message {
    param($Title, $Message, $Icon)
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon)
}

function Show-Confirm {
    param($Title, $Message)
    $result = [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    return $result -eq [System.Windows.Forms.DialogResult]::Yes
}

$welcomeMessage = @"
Welcome to the $appName installer!

This wizard will install the application on your PC.

Version: $version

Do you want to continue with the installation?
"@

if (-not (Show-Confirm "$appName - Installer" $welcomeMessage)) {
    exit
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $scriptPath $appFolder
$destPath = Join-Path $env:ProgramFiles $appFolder

if (-not (Test-Path $sourcePath)) {
    Show-Message "Error" "Could not find the '$appFolder' folder" "Error"
    exit
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    $relaunch = Show-Confirm "Administrator privileges required" "This installer needs administrator privileges.\`n\`nDo you want to continue?"

    if ($relaunch) {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"$($MyInvocation.MyCommand.Path)\`"" -Verb RunAs
        exit
    } else {
        exit
    }
}

if (Test-Path $destPath) {
    $replace = Show-Confirm "Existing version" "A version is already installed.\`n\`nDo you want to replace it?"

    if (-not $replace) {
        exit
    }

    try {
        $processName = [System.IO.Path]::GetFileNameWithoutExtension($exeName)
        $running = Get-Process -Name $processName -ErrorAction SilentlyContinue

        if ($running) {
            $close = Show-Confirm "Application running" "$appName is currently running.\`n\`nDo you want to close it to continue?"

            if ($close) {
                Stop-Process -Name $processName -Force
                Start-Sleep -Seconds 2
            } else {
                exit
            }
        }
    } catch {}

    try {
        Remove-Item -Path $destPath -Recurse -Force -ErrorAction Stop
    } catch {
        Show-Message "Error" "Could not remove the previous version." "Error"
        exit
    }
}

# Progress window
$form = New-Object System.Windows.Forms.Form
$form.Text = "Installing $appName"
$form.Size = New-Object System.Drawing.Size(400, 150)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = "Installing $appName v$version...\`n\`nThis will only take a few seconds."
$label.AutoSize = $false
$label.Size = New-Object System.Drawing.Size(360, 50)
$label.Location = New-Object System.Drawing.Point(20, 20)
$form.Controls.Add($label)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(20, 80)
$progressBar.Size = New-Object System.Drawing.Size(350, 25)
$progressBar.Style = "Marquee"
$form.Controls.Add($progressBar)

$form.Show()
$form.Refresh()

try {
    Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 800
} catch {
    $form.Close()
    Show-Message "Error" "Error during installation." "Error"
    exit
}

$form.Close()

$createShortcut = Show-Confirm "Desktop shortcut" "Do you want to create a desktop shortcut?"

if ($createShortcut) {
    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$appName.lnk"
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $destPath $exeName
        $shortcut.WorkingDirectory = $destPath
        $shortcut.Save()
    } catch {}
}

# Start menu shortcut
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $startMenuPath = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "$appName.lnk"
    $shortcut = $WshShell.CreateShortcut($startMenuPath)
    $shortcut.TargetPath = Join-Path $destPath $exeName
    $shortcut.WorkingDirectory = $destPath
    $shortcut.Save()
} catch {}

$launch = Show-Confirm "Installation complete!" "Installation completed!\`n\`n$appName v$version is ready.\`n\`nDo you want to open the application now?"

if ($launch) {
    try {
        Start-Process (Join-Path $destPath $exeName)
    } catch {}
}
`;

  await fs.writeFile(path.join(installerDir, 'install.ps1'), powershellContent);

  // Create batch launcher
  const batchContent = `@echo off
title ${productName} - Installer v${version}
echo.
echo =====================================
echo  ${productName}
echo  Installer v${version}
echo =====================================
echo.
echo Starting installer...
echo.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0install.ps1"

if %errorlevel% neq 0 (
    echo.
    echo Error during installation.
    pause
)
`;

  await fs.writeFile(path.join(installerDir, 'Install.bat'), batchContent);

  // Create README
  const readmeContent = `${productName.toUpperCase()} - Windows
${'='.repeat(productName.length + 12)}

VERSION: ${version}
DATE: ${new Date().toISOString().split('T')[0]}

QUICK INSTALLATION:
===================

1. Double-click "Install.bat"
2. If "Windows protected your PC" appears:
   - Click "More info"
   - Then click "Run anyway"
3. Follow the instructions

MANUAL INSTALLATION:
====================

1. Copy the "SmartPanelMiddleware" folder to:
   C:\\Program Files\\SmartPanelMiddleware

2. Create a shortcut to:
   C:\\Program Files\\SmartPanelMiddleware\\${productName}.exe

UNINSTALLATION:
===============

Delete the folder:
C:\\Program Files\\SmartPanelMiddleware

SUPPORT:
========

Email: support@smart-panel.app
Web: https://smart-panel.app

================================
Smart Panel (c) ${new Date().getFullYear()}
`;

  await fs.writeFile(path.join(installerDir, 'README.txt'), readmeContent);

  // Create ZIP
  const zipPath = path.join(path.dirname(outDir), `Smart-Panel-Middleware-win.zip`);
  await createZip(installerDir, zipPath);

  console.log(`  ✅ Installer created: Smart-Panel-Middleware-win.zip`);

  await fs.remove(installerDir);
}

/**
 * Creates a ZIP file
 */
function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`  📦 ZIP created: ${sizeMB} MB`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
