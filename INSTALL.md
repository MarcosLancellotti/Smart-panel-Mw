# Smart Panel Middleware - Installation Guide

## macOS Installation

### Step 1: Download the installer

Download the file from this link:

**[Download for Mac](https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-mac.dmg)**

### Step 2: Open the downloaded file

1. Go to your **Downloads** folder
2. Find the file named `Smart-Panel-Middleware-mac.dmg`
3. **Double-click** on it to open

A new window will appear with the app icon and an "Applications" folder.

### Step 3: Install the app

1. **Drag** the "Smart Panel Middleware" icon
2. **Drop** it onto the "Applications" folder
3. Wait for the copy to complete
4. Close the window

### Step 4: Eject the disk image

1. On your Desktop, find the "Smart Panel Middleware" disk icon
2. **Right-click** on it
3. Select **"Eject"**

### Step 5: Remove security block (IMPORTANT)

macOS blocks apps from unidentified developers. You need to remove this block.

1. Click on the **magnifying glass** icon in the top-right corner of your screen (Spotlight)
2. Type **Terminal**
3. Press **Enter** to open Terminal
4. **Copy** the following line:

```
xattr -cr /Applications/Smart\ Panel\ Middleware.app
```

5. **Paste** it in Terminal (press **Command + V**)
6. Press **Enter**
7. Close Terminal

### Step 6: Open the app

1. Click on the **magnifying glass** icon (Spotlight)
2. Type **Smart Panel Middleware**
3. Press **Enter**

The app should now open without any problems.

---

## Windows Installation

### Step 1: Download the installer

Download the file from this link:

**[Download for Windows](https://github.com/MarcosLancellotti/Smart-panel-Mw/releases/latest/download/Smart-Panel-Middleware-win.zip)**

### Step 2: Extract the ZIP file

1. Go to your **Downloads** folder
2. Find the file named `Smart-Panel-Middleware-win.zip`
3. **Right-click** on it
4. Select **"Extract All..."**
5. Click **"Extract"**

### Step 3: Run the installer

1. Open the extracted folder
2. Find the file named `Install.bat`
3. **Double-click** on it

### Step 4: Allow the installer to run

If you see a blue window saying "Windows protected your PC":

1. Click on **"More info"**
2. Click on **"Run anyway"**

### Step 5: Follow the installer

1. Click **"Yes"** when asked for administrator permissions
2. Follow the on-screen instructions
3. Choose whether to create a desktop shortcut

### Step 6: Open the app

You can find the app in:
- The **Start Menu**
- Your **Desktop** (if you created a shortcut)

---

## Troubleshooting

### Mac: "Smart Panel Middleware is damaged and can't be opened"

This means the security block was not removed. Follow Step 5 again.

Open Terminal and run:
```
xattr -cr /Applications/Smart\ Panel\ Middleware.app
```

### Mac: "Smart Panel Middleware can't be opened because it is from an unidentified developer"

1. Open **System Preferences** (or System Settings on newer Macs)
2. Go to **Security & Privacy**
3. Click the **lock** icon and enter your password
4. Click **"Open Anyway"** next to the Smart Panel Middleware message

### Windows: The installer doesn't start

Make sure you extracted the ZIP file first. You cannot run the installer directly from inside the ZIP.

---

## Need Help?

Contact us at: **support@smart-panel.app**
