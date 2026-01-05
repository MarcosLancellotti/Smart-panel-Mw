// tailor.config.js - Smart Panel Middleware Installer Builder
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
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

  mac: {
    target: 'dir',
    icon: 'assets/icon.icns',
    identity: null,
    category: 'public.app-category.utilities'
  },

  win: {
    target: 'dir',
    icon: 'assets/icon.icns'
  },

  // Hook después de empaquetar cada plataforma
  afterPack: async (context) => {
    const { appOutDir, electronPlatformName, arch } = context;

    console.log(`\n🎨 Procesando build para ${electronPlatformName}-${arch}...`);
    console.log(`   📁 Output dir: ${appOutDir}\n`);

    if (electronPlatformName === 'darwin') {
      await createMacInstaller(appOutDir, version, productName);
    } else if (electronPlatformName === 'win32') {
      await createWindowsInstaller(appOutDir, version, productName);
    }
  },

  afterAllArtifactBuild: async (buildResult) => {
    console.log('\n✅ ¡BUILD COMPLETADO!\n');
    console.log('📦 Artefactos generados:\n');

    // List files in dist
    const distPath = path.join(__dirname, 'dist');
    const files = fs.readdirSync(distPath).filter(f => f.endsWith('.zip'));
    files.forEach(file => {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  📦 ${file} (${sizeMB} MB)`);
    });
  }
};

/**
 * Crea instalador para macOS con GUI
 */
async function createMacInstaller(outDir, version, productName) {
  console.log('🍎 Creando instalador macOS con GUI...');

  const installerDir = path.join(path.dirname(outDir), 'installer-macos');
  const appName = `${productName}.app`;
  const appPath = path.join(outDir, appName);

  console.log(`  🔍 Buscando app en: ${appPath}`);

  if (!fs.existsSync(appPath)) {
    console.error(`❌ No se encontró ${appName} en ${outDir}`);
    // List contents
    try {
      const contents = fs.readdirSync(outDir);
      console.log(`   📁 Contenido de ${outDir}: ${contents.join(', ')}`);
    } catch (e) {}
    return;
  }

  await fs.remove(installerDir);
  await fs.ensureDir(installerDir);

  console.log('  📋 Copiando aplicación...');
  await fs.copy(appPath, path.join(installerDir, appName));

  // Crear script AppleScript del instalador
  const applescriptContent = `#!/usr/bin/osascript

-- ${productName} - Instalador Visual
-- Versión: ${version}

set appName to "${productName}"
set appFile to "${productName}.app"

-- Ventana de bienvenida
set welcomeMessage to "¡Bienvenido al instalador de " & appName & "!" & return & return & "Este asistente instalará la aplicación en tu Mac." & return & return & "Versión: ${version}" & return & "Build: ${new Date().toISOString().split('T')[0]}"

set welcomeResponse to display dialog welcomeMessage buttons {"Cancelar", "Continuar"} default button "Continuar" with icon note with title appName

if button returned of welcomeResponse is "Cancelar" then
    return
end if

-- Obtener ruta actual
tell application "Finder"
    set currentPath to POSIX path of ((container of (path to me)) as alias)
end tell

set sourcePath to currentPath & appFile
set destPath to "/Applications/" & appFile

-- Verificar que existe la app en la carpeta
try
    do shell script "test -d " & quoted form of sourcePath
on error
    display dialog "❌ Error: No se encontró '" & appFile & "'" & return & return & "Asegúrate de ejecutar el instalador desde la carpeta descomprimida." buttons {"OK"} default button "OK" with icon stop with title "Error"
    return
end try

-- Verificar si ya existe una instalación previa
try
    do shell script "test -d " & quoted form of destPath

    set replaceResponse to display dialog "⚠️ Ya existe una versión de " & appName & " instalada." & return & return & "¿Deseas reemplazarla con la nueva versión?" buttons {"Cancelar", "Reemplazar"} default button "Reemplazar" with icon caution with title "Versión existente detectada"

    if button returned of replaceResponse is "Cancelar" then
        return
    end if

    try
        do shell script "rm -rf " & quoted form of destPath with administrator privileges
    on error errMsg
        display dialog "❌ Error al eliminar la versión anterior:" & return & errMsg buttons {"OK"} default button "OK" with icon stop with title "Error"
        return
    end try
end try

-- Ventana de progreso
display dialog "📦 Instalando " & appName & "..." & return & return & "Esto tomará solo unos segundos..." buttons {} giving up after 1 with icon note with title "Instalando"

-- Paso 1: Eliminar quarantine flag
try
    do shell script "xattr -cr " & quoted form of sourcePath
on error
    -- No crítico, continuar
end try

-- Paso 2: Copiar a /Applications
try
    do shell script "cp -R " & quoted form of sourcePath & " " & quoted form of destPath with administrator privileges
on error errMsg
    display dialog "❌ Error durante la instalación:" & return & return & errMsg buttons {"OK"} default button "OK" with icon stop with title "Error de instalación"
    return
end try

-- Paso 3: Eliminar quarantine de la copia instalada
try
    do shell script "xattr -cr " & quoted form of destPath with administrator privileges
on error
    -- No crítico, continuar
end try

-- Paso 4: Asegurar permisos de ejecución
try
    do shell script "chmod -R +x " & quoted form of destPath & "/Contents/MacOS/" with administrator privileges
on error
    -- No crítico, continuar
end try

-- Ventana de éxito
set successMessage to "✅ ¡Instalación completada!" & return & return & appName & " versión ${version} está listo para usar." & return & return & "Puedes encontrarlo en:" & return & "• Aplicaciones" & return & "• Launchpad" & return & "• Spotlight (Cmd+Space)" & return & return & "¿Deseas abrir la aplicación ahora?"

set successResponse to display dialog successMessage buttons {"Cerrar", "Abrir " & appName} default button "Abrir " & appName with icon note with title "Instalación completada!"

if button returned of successResponse is "Abrir " & appName then
    try
        do shell script "open " & quoted form of destPath
    on error
        display dialog "No se pudo abrir la aplicación automáticamente." & return & return & "Búscala en la carpeta Aplicaciones." buttons {"OK"} with icon note
    end try
end if
`;

  const scriptPath = path.join(installerDir, 'install.applescript');
  await fs.writeFile(scriptPath, applescriptContent);

  // Compilar AppleScript a aplicación
  if (process.platform === 'darwin') {
    try {
      console.log('  🔨 Compilando instalador...');
      const installerAppPath = path.join(installerDir, `Install ${productName}.app`);
      execSync(`osacompile -o "${installerAppPath}" "${scriptPath}"`, { stdio: 'pipe' });
      execSync(`chmod +x "${installerAppPath}/Contents/MacOS/applet"`, { stdio: 'pipe' });
      await fs.remove(scriptPath);
      console.log('  ✅ Instalador compilado');
    } catch (error) {
      console.warn('  ⚠️ No se pudo compilar AppleScript');
    }
  }

  // Crear README
  const readmeContent = `${productName.toUpperCase()} - macOS
${'='.repeat(productName.length + 10)}

VERSIÓN: ${version}
FECHA: ${new Date().toISOString().split('T')[0]}

INSTALACIÓN RÁPIDA (RECOMENDADO):
==================================

1. Haz doble clic en "Install ${productName}.app"
2. Sigue las instrucciones en pantalla
3. Si aparece un aviso de seguridad:
   - Abre Preferencias del Sistema → Seguridad y Privacidad
   - Haz clic en "Abrir de todas formas"

INSTALACIÓN MANUAL:
===================

1. Arrastra "${productName}.app" a la carpeta Aplicaciones
2. Abre Terminal y ejecuta:

   xattr -cr "/Applications/${productName}.app"

3. Ahora puedes abrir la aplicación normalmente

DESINSTALACIÓN:
===============

Arrastra la app a la Papelera desde:
/Applications/${productName}.app

SOPORTE:
========

📧 Email: support@smart-panel.app
🌐 Web: https://smart-panel.app

================================
Smart Panel © ${new Date().getFullYear()}
`;

  await fs.writeFile(path.join(installerDir, 'README.txt'), readmeContent);

  // Crear ZIP final
  const zipPath = path.join(path.dirname(outDir), `Smart-Panel-Middleware-mac.zip`);
  await createZip(installerDir, zipPath);

  console.log(`  ✅ Instalador creado: Smart-Panel-Middleware-mac.zip`);

  await fs.remove(installerDir);
}

/**
 * Crea instalador para Windows con GUI
 */
async function createWindowsInstaller(outDir, version, productName) {
  console.log('🪟 Creando instalador Windows con GUI...');

  const installerDir = path.join(path.dirname(outDir), 'installer-windows');

  // outDir ya es la carpeta con los archivos (ej: dist/win-arm64-unpacked)
  const actualAppPath = outDir;

  await fs.remove(installerDir);
  await fs.ensureDir(installerDir);

  console.log('  📋 Copiando aplicación...');
  await fs.copy(actualAppPath, path.join(installerDir, 'SmartPanelMiddleware'));

  // Crear script PowerShell del instalador
  const powershellContent = `# ${productName} - Instalador con GUI
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
Bienvenido al instalador de $appName!

Este asistente instalara la aplicacion en tu PC.

Version: $version

Deseas continuar con la instalacion?
"@

if (-not (Show-Confirm "$appName - Instalador" $welcomeMessage)) {
    exit
}

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $scriptPath $appFolder
$destPath = Join-Path $env:ProgramFiles $appFolder

if (-not (Test-Path $sourcePath)) {
    Show-Message "Error" "No se encontro la carpeta '$appFolder'" "Error"
    exit
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    $relaunch = Show-Confirm "Se requieren permisos de administrador" "Este instalador necesita permisos de administrador.\`n\`nDeseas continuar?"

    if ($relaunch) {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"$($MyInvocation.MyCommand.Path)\`"" -Verb RunAs
        exit
    } else {
        exit
    }
}

if (Test-Path $destPath) {
    $replace = Show-Confirm "Version existente" "Ya existe una version instalada.\`n\`nDeseas reemplazarla?"

    if (-not $replace) {
        exit
    }

    try {
        $processName = [System.IO.Path]::GetFileNameWithoutExtension($exeName)
        $running = Get-Process -Name $processName -ErrorAction SilentlyContinue

        if ($running) {
            $close = Show-Confirm "Aplicacion en ejecucion" "$appName esta corriendo.\`n\`nDeseas cerrarla para continuar?"

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
        Show-Message "Error" "No se pudo eliminar la version anterior." "Error"
        exit
    }
}

# Progress window
$form = New-Object System.Windows.Forms.Form
$form.Text = "Instalando $appName"
$form.Size = New-Object System.Drawing.Size(400, 150)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = "Instalando $appName v$version...\`n\`nEsto tomara solo unos segundos."
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
    Show-Message "Error" "Error durante la instalacion." "Error"
    exit
}

$form.Close()

$createShortcut = Show-Confirm "Acceso directo" "Deseas crear un acceso directo en el escritorio?"

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

$launch = Show-Confirm "Instalacion completada!" "Instalacion completada!\`n\`n$appName v$version esta listo.\`n\`nDeseas abrir la aplicacion ahora?"

if ($launch) {
    try {
        Start-Process (Join-Path $destPath $exeName)
    } catch {}
}
`;

  await fs.writeFile(path.join(installerDir, 'install.ps1'), powershellContent);

  // Crear batch launcher
  const batchContent = `@echo off
title ${productName} - Instalador v${version}
echo.
echo =====================================
echo  ${productName}
echo  Instalador v${version}
echo =====================================
echo.
echo Iniciando instalador...
echo.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0install.ps1"

if %errorlevel% neq 0 (
    echo.
    echo Error durante la instalacion.
    pause
)
`;

  await fs.writeFile(path.join(installerDir, 'Install.bat'), batchContent);

  // Crear README
  const readmeContent = `${productName.toUpperCase()} - Windows
${'='.repeat(productName.length + 12)}

VERSION: ${version}
FECHA: ${new Date().toISOString().split('T')[0]}

INSTALACION RAPIDA:
===================

1. Haz doble clic en "Install.bat"
2. Si aparece "Windows protegió tu PC":
   - Clic en "Más información"
   - Luego en "Ejecutar de todas formas"
3. Sigue las instrucciones

INSTALACION MANUAL:
===================

1. Copia la carpeta "SmartPanelMiddleware" a:
   C:\\Program Files\\SmartPanelMiddleware

2. Crea un acceso directo a:
   C:\\Program Files\\SmartPanelMiddleware\\${productName}.exe

DESINSTALACION:
===============

Elimina la carpeta:
C:\\Program Files\\SmartPanelMiddleware

SOPORTE:
========

Email: support@smart-panel.app
Web: https://smart-panel.app

================================
Smart Panel (c) ${new Date().getFullYear()}
`;

  await fs.writeFile(path.join(installerDir, 'README.txt'), readmeContent);

  // Crear ZIP final
  const zipPath = path.join(path.dirname(outDir), `Smart-Panel-Middleware-win.zip`);
  await createZip(installerDir, zipPath);

  console.log(`  ✅ Instalador creado: Smart-Panel-Middleware-win.zip`);

  await fs.remove(installerDir);
}

/**
 * Crea un archivo ZIP
 */
function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`  📦 ZIP creado: ${sizeMB} MB`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
