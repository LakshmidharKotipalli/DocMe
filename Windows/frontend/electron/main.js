const {
    app, BrowserWindow, Menu, Tray, shell, nativeImage,
    Notification, globalShortcut, dialog, nativeTheme,
    systemPreferences, powerMonitor, ipcMain, screen
} = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let tray;
let popupWindow;
let backendProcess;
let agentProcess;
let isQuitting = false;
let activityCount = 0;

// IPC Handlers
ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('maximize-window', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('close-window', (event) => {
    const win = screen ? BrowserWindow.fromWebContents(event.sender) : null;
    if (win === mainWindow) {
        isQuitting = true;
        app.quit();
    } else {
        win?.close();
    }
});
ipcMain.on('show-notification', (event, { title, body }) => showNotification(title, body));
ipcMain.on('focus-window', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.on('show-notification-window', () => {
    // This was the old way, keeping for compatibility or removing if unused
});

ipcMain.on('create-popup-window', (event, data) => {
    if (popupWindow) {
        popupWindow.close();
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const popupWidth = 400;
    const popupHeight = 250;

    const win = new BrowserWindow({
        width: popupWidth,
        height: popupHeight,
        x: width - popupWidth - 20,
        y: height - popupHeight - 20,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        hasShadow: true,
        focusable: true, // Keep focusable so they can click it if they WANT to type
        show: false, // Don't show immediately
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    popupWindow = win;

    const queryParams = new URLSearchParams({
        mode: 'popup',
        eventId: data.id,
        app: data.app || '',
        title: data.window_title || ''
    }).toString();

    const url = isDev
        ? `http://localhost:5173/?${queryParams}`
        : `file://${path.join(__dirname, '../dist/index.html')}?${queryParams}`;

    win.loadURL(url);
    win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) {
            win.showInactive(); // Show without stealing focus!
        }
    });
    win.on('closed', () => {
        if (popupWindow === win) popupWindow = null;
    });
});

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (event, newSettings) => {
    settings = { ...settings, ...newSettings };

    // Persist to docme.yaml for the background agent
    const configPath = path.join(PROJECT_ROOT, 'config', 'docme.yaml');
    try {
        if (fs.existsSync(configPath)) {
            let configContent = fs.readFileSync(configPath, 'utf8');

            // Basic regex-based YAML update to avoid adding dependencies
            if (newSettings.llmApiKey !== undefined) {
                configContent = configContent.replace(/api_key:\s*".*"/, `api_key: "${newSettings.llmApiKey}"`);
                configContent = configContent.replace(/api_key:\s*'.*'/, `api_key: "${newSettings.llmApiKey}"`);
                // If it was empty or unquoted
                if (!configContent.match(/api_key:\s*".*"/)) {
                    configContent = configContent.replace(/api_key:\s*.*(\n|$)/, `api_key: "${newSettings.llmApiKey}"$1`);
                }
            }
            if (newSettings.llmModel !== undefined) {
                configContent = configContent.replace(/model:\s*".*"/, `model: "${newSettings.llmModel}"`);
                configContent = configContent.replace(/model:\s*'.*'/, `model: "${newSettings.llmModel}"`);
                if (!configContent.match(/model:\s*".*"/)) {
                    configContent = configContent.replace(/model:\s*.*(\n|$)/, `model: "${newSettings.llmModel}"$1`);
                }
            }

            fs.writeFileSync(configPath, configContent, 'utf8');
            console.log('Updated docme.yaml with new settings');
        }
    } catch (err) {
        console.error('Failed to update docme.yaml:', err);
    }

    // Apply certain settings immediately
    if (settings.showInDock) app.dock.show();
    else app.dock.hide();
    updateTrayMenu();
    return settings;
});

ipcMain.handle('export-report', async () => {
    return await exportData();
});

ipcMain.handle('get-version', () => app.getVersion());

const isDev = !app.isPackaged;
const PROJECT_ROOT = isDev
    ? path.join(__dirname, '..', '..')
    : path.join(process.resourcesPath, 'backend');

// Store for settings
let settings = {
    launchAtLogin: false,
    showInDock: true,
    notificationsEnabled: true,
    trackingEnabled: true,
    llmApiKey: '',
    llmModel: 'gemma3:1b'
};

// Sync settings with docme.yaml on boot
try {
    const configPath = path.join(PROJECT_ROOT, 'config', 'docme.yaml');
    if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const apiKeyMatch = configContent.match(/api_key:\s*"(.*)"/) || configContent.match(/api_key:\s*'(.*)'/);
        const modelMatch = configContent.match(/model:\s*"(.*)"/) || configContent.match(/model:\s*'(.*)'/);

        if (apiKeyMatch) settings.llmApiKey = apiKeyMatch[1];
        if (modelMatch) settings.llmModel = modelMatch[1];
    }
} catch (err) {
    console.error('Failed to sync settings from docme.yaml:', err);
}

// ==================== WINDOW MANAGEMENT ====================

// Toggles the main window, positioning it under the tray icon
function toggleWindow() {
    if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        if (!mainWindow) createWindow();

        const trayBounds = tray.getBounds();
        const windowBounds = mainWindow.getBounds();

        // Calculate window position relative to tray
        const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
        const y = Math.round(trayBounds.y + trayBounds.height + 4);

        mainWindow.setPosition(x, y, false);
        mainWindow.show();
        mainWindow.focus();
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 850,
        height: 700,
        minWidth: 400,
        minHeight: 300,
        show: false,
        frame: false,
        resizable: true,
        movable: true,
        hasShadow: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 15, y: 15 },
        vibrancy: 'menu', // Modern macOS vibrancy
        visualEffectState: 'active',
        backgroundColor: '#00000000', // Fully transparent
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Make the window look like a system panel
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Load content
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    mainWindow.once('ready-to-show', () => {
        // Position relative to tray on first open
        if (tray) {
            const trayBounds = tray.getBounds();
            const windowBounds = mainWindow.getBounds();
            const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
            const y = Math.round(trayBounds.y + trayBounds.height + 4);
            mainWindow.setPosition(x, y, false);
        }
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        app.quit();
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// ==================== TRAY / MENU BAR ====================

function createTray() {
    // Create a template image for proper macOS display
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3scGFwZ.orZ5vuPBoAAADASURBVDiN7dOxDcIwEAXQFxYgDUNQsAEjsACiYANGYAPWoGADRmADNnAHfZHlOD4nCIkPWXL5/vvuJNuSqj/HQNI0pOYAfAJYSZpLGgB4BrC0feZ+E0kvAGsASwAH21sA+zxaE9sHSasIOdu3eB6AKYCbpNd/wMxbmI7fR9iKh/S0e3CwvQxHYfsYLqM+EXSJsB8N9ynpDGAOoJF0CPqcpFNsHPYC8ARgZHsk6S7pRdIEwGgWYbY/uo3bVPr7dXRd/RxfJ0RJ5y5wjy8AAAAASUVORK5CYII='
    );
    icon.setTemplateImage(true);

    tray = new Tray(icon);
    tray.setToolTip('DocMe - Activity Tracker');

    tray.on('click', toggleWindow);
    tray.on('right-click', () => {
        const contextMenu = buildTrayMenu();
        tray.popUpContextMenu(contextMenu);
    });

    updateTrayMenu();
}

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        {
            label: `DocMe v${app.getVersion()}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'Open DocMe Dashboard',
            accelerator: 'CmdOrCtrl+Shift+D',
            click: toggleWindow
        },
        { type: 'separator' },
        {
            label: settings.trackingEnabled ? '⏸️ Pause Tracking' : '▶️ Resume Tracking',
            click: () => {
                settings.trackingEnabled = !settings.trackingEnabled;
                updateTrayMenu();
                showNotification(
                    settings.trackingEnabled ? 'Tracking Resumed' : 'Tracking Paused',
                    settings.trackingEnabled ? 'DocMe is now recording your activity.' : 'DocMe has stopped recording.'
                );
            }
        },
        {
            label: 'Generate Daily Report',
            click: async () => {
                const date = new Date().toISOString().split('T')[0];
                try {
                    const response = await fetch(`http://localhost:8000/reports/generate?date=${date}`, { method: 'POST' });
                    if (response.ok) {
                        showNotification('Report Generated', 'Your daily summary is ready. Click to view.');
                        if (mainWindow) {
                            mainWindow.show();
                            mainWindow.webContents.send('navigate-to-report');
                        }
                    }
                } catch (e) {
                    showNotification('Error', 'Failed to generate report.');
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Export Today\'s Data...',
            click: exportData
        },
        { type: 'separator' },
        {
            label: 'Preferences...',
            accelerator: 'CmdOrCtrl+,',
            click: openPreferences
        },
        { type: 'separator' },
        {
            label: 'Quit DocMe',
            accelerator: 'CmdOrCtrl+Q',
            click: quitApp
        }
    ]);
}

function updateTrayMenu() {
    if (tray) {
        tray.setContextMenu(buildTrayMenu());
    }
}

// ==================== NOTIFICATIONS ====================

function showNotification(title, body) {
    if (!settings.notificationsEnabled) return;

    const notification = new Notification({
        title,
        body,
        silent: true,
        icon: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAKnSURBVFiFxZdNSBRhGMd/M7uru+u6rmZqFlp+QCUVRIdOQV26dCiIDhId6tKhQ3TpUodC6NChQ4c6dCioDh06FEQd6mCHKCgyCisrtXRdc3d2Zn5/e3dGZ9PZXT7ogZl33uf/e573+zzzoqTEPygpIICLwFGgGvCBH8BX4DHwKN4hJUBShgL0AD3AQcAFOoE54DnwCHi+pAoQAfqBHqAVuAD0Ao+BWeABcA94uroK4LoVUIB+4C5wG5hZP4BG4DrQB4SAk8Bt4Cawn4QxRoF+4A4wGhfABW4AF4GB9QMA14CbQB8QBk4BQ8Agq0/N+D6gFxgGEjHGgAHgPjCxfgDDBiACHAfuAcNrO6M1o9frZZoNXAkJE+cJcB+YXL8GNptlAPeAYSCa0xkFbpq1Crgr5EmC0wiMfTmLATxlXQ1YdZfyOPACGEuUAR14DowD0bwtOAK8zkegATdJ0IhZSUAjEEi2W2aBUeDluhoIJvhMnEGU0sBzYG69K2BaATgDvAZmizI+aeIsMFaUBkBR4CAwBMwXqwHgOjAGzBU7C84D48BcsdMwUmwNxOPABDCf0sCktXnq7u7e3NbWRltbG52dnfT09NDf309nZ+e5RKVYLV12c9xOoBJwXdfyAMuy3N7e3rGxsbGhaDT6HgBFiZvMgbw2zMxCnI9pGBb+KHB3SQVrR27i4AYwDcwVeg6DM0E7y0pIsB2oI88dcDQQ4Gk8R0hTI3X5YoNxb3swkQlEy5bfzQKjL8NEnimMxgC0bWnhwNlz1NbWIiIJEf0ARIBe4D6JIKqBRuAiEARswB4eHt6Wl4VIxHT2iQQfJD3p+lWg2DJz9mAE6FuaBuwHxwQ9E4gCdwJBvpFgLLu72wSqbLbbt0aAO+sNuPg4B+hJxoSATkwAAAAASUVORK5CYII=')
    });

    notification.show();

    notification.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ==================== DATA EXPORT ====================

async function exportData() {
    const date = new Date().toISOString().split('T')[0];

    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Daily Report',
        defaultPath: `DocMe-Report-${date}.md`,
        filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'JSON', extensions: ['json'] }
        ]
    });

    if (!filePath) return;

    try {
        const response = await fetch(`http://localhost:8000/reports?date=${date}`);
        const data = await response.json();

        if (data && data.length > 0) {
            const content = filePath.endsWith('.json')
                ? JSON.stringify(data[0], null, 2)
                : data[0].report_md;

            fs.writeFileSync(filePath, content);
            showNotification('Export Complete', `Report saved to ${path.basename(filePath)}`);
            shell.showItemInFolder(filePath);
        } else {
            showNotification('No Data', 'No report available for today. Generate one first.');
        }
    } catch (e) {
        showNotification('Export Failed', 'Could not export report.');
    }
}

// ==================== PREFERENCES ====================

function openPreferences() {
    // For now, show a simple dialog. Can be enhanced with a proper settings window.
    dialog.showMessageBox({
        type: 'info',
        title: 'DocMe Preferences',
        message: 'Preferences',
        detail: `Tracking: ${settings.trackingEnabled ? 'Active' : 'Paused'}\nNotifications: ${settings.notificationsEnabled ? 'On' : 'Off'}\n\nMore settings coming soon!`,
        buttons: ['OK']
    });
}

// ==================== GLOBAL SHORTCUTS ====================

function registerShortcuts() {
    // Global shortcut to open DocMe from anywhere
    globalShortcut.register('CmdOrCtrl+Shift+D', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createWindow();
        }
    });

    // Quick note shortcut
    globalShortcut.register('CmdOrCtrl+Shift+N', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('quick-note');
        }
    });
}

// ==================== POWER MONITORING ====================

function setupPowerMonitor() {
    powerMonitor.on('suspend', () => {
        console.log('System suspended - pausing tracking');
    });

    powerMonitor.on('resume', () => {
        console.log('System resumed - resuming tracking');
    });

    powerMonitor.on('lock-screen', () => {
        console.log('Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
        console.log('Screen unlocked');
    });
}

// ==================== MENU BAR ====================

function createMenu() {
    const template = [
        {
            label: 'DocMe',
            submenu: [
                { label: 'About DocMe', role: 'about' },
                { type: 'separator' },
                {
                    label: 'Preferences...',
                    accelerator: 'Cmd+,',
                    click: openPreferences
                },
                { type: 'separator' },
                { label: 'Hide DocMe', accelerator: 'Cmd+H', role: 'hide' },
                { label: 'Hide Others', accelerator: 'Cmd+Shift+H', role: 'hideOthers' },
                { label: 'Show All', role: 'unhide' },
                { type: 'separator' },
                { label: 'Quit DocMe', accelerator: 'Cmd+Q', click: quitApp }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'Generate Report',
                    accelerator: 'Cmd+G',
                    click: async () => {
                        const date = new Date().toISOString().split('T')[0];
                        await fetch(`http://localhost:8000/reports/generate?date=${date}`, { method: 'POST' });
                        showNotification('Report Generated', 'Your daily summary is ready.');
                    }
                },
                {
                    label: 'Export Report...',
                    accelerator: 'Cmd+E',
                    click: exportData
                },
                { type: 'separator' },
                { label: 'Close Window', accelerator: 'Cmd+W', role: 'close' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: 'Cmd+Z', role: 'undo' },
                { label: 'Redo', accelerator: 'Cmd+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: 'Cmd+X', role: 'cut' },
                { label: 'Copy', accelerator: 'Cmd+C', role: 'copy' },
                { label: 'Paste', accelerator: 'Cmd+V', role: 'paste' },
                { label: 'Select All', accelerator: 'Cmd+A', role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Activity Logs',
                    accelerator: 'Cmd+1',
                    click: () => mainWindow?.webContents.send('navigate', 'logs')
                },
                {
                    label: 'Daily Report',
                    accelerator: 'Cmd+2',
                    click: () => mainWindow?.webContents.send('navigate', 'report')
                },
                { type: 'separator' },
                { label: 'Reload', accelerator: 'Cmd+R', role: 'reload' },
                { type: 'separator' },
                { label: 'Actual Size', accelerator: 'Cmd+0', role: 'resetZoom' },
                { label: 'Zoom In', accelerator: 'Cmd+Plus', role: 'zoomIn' },
                { label: 'Zoom Out', accelerator: 'Cmd+-', role: 'zoomOut' },
                { type: 'separator' },
                { label: 'Toggle Fullscreen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { label: 'Minimize', accelerator: 'Cmd+M', role: 'minimize' },
                { label: 'Zoom', role: 'zoom' },
                { type: 'separator' },
                { label: 'Bring All to Front', role: 'front' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'View API Docs',
                    click: () => shell.openExternal('http://localhost:8000/docs')
                },
                {
                    label: 'View on GitHub',
                    click: () => shell.openExternal('https://github.com/yourusername/docme')
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ==================== APP LIFECYCLE ====================

function quitApp() {
    isQuitting = true;
    stopServices();
    app.quit();
}

function startServices() {
    if (!isDev) {
        console.log('Starting backend services from:', PROJECT_ROOT);

        backendProcess = spawn('python3', ['-m', 'uvicorn', 'backend.api.main:app', '--port', '8000'], {
            cwd: PROJECT_ROOT,
            stdio: 'pipe'
        });

        agentProcess = spawn('python3', ['agent/main.py'], {
            cwd: PROJECT_ROOT,
            stdio: 'pipe'
        });

        backendProcess.stdout.on('data', (data) => console.log(`Backend: ${data}`));
        backendProcess.stderr.on('data', (data) => console.error(`Backend: ${data}`));
        agentProcess.stdout.on('data', (data) => console.log(`Agent: ${data}`));
        agentProcess.stderr.on('data', (data) => console.error(`Agent: ${data}`));
    }
}

function stopServices() {
    if (backendProcess) {
        backendProcess.kill('SIGTERM');
        backendProcess = null;
    }
    if (agentProcess) {
        agentProcess.kill('SIGTERM');
        agentProcess = null;
    }
}

// Poll for activity count updates
function startActivityPoller() {
    setInterval(async () => {
        try {
            const date = new Date().toISOString().split('T')[0];
            const response = await fetch(`http://localhost:8000/events?date=${date}`);
            const events = await response.json();
            if (Array.isArray(events)) {
                activityCount = events.length;
                updateTrayMenu();
            }
        } catch (e) {
            // Backend not ready yet
        }
    }, 30000); // Every 30 seconds
}

// ==================== APP INITIALIZATION ====================

app.whenReady().then(() => {
    // Show dock icon always for better visibility
    app.dock.show();

    createMenu();
    createTray();
    registerShortcuts();
    setupPowerMonitor();

    if (!isDev) {
        startServices();
        // Wait for services to start
        setTimeout(createWindow, 2000);
    } else {
        createWindow();
    }

    startActivityPoller();

    // Show startup notification
    setTimeout(() => {
        showNotification('DocMe Active', 'Activity tracking has started. Look for the icon in your menu bar.');
    }, 3000);
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopServices();
});

// Handle second instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
