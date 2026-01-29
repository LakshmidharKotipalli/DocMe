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
let llmProcess;
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
    const configPath = WRITABLE_CONFIG_PATH;
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
            console.log('Updated WRITABLE config at:', configPath);
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

ipcMain.handle('get-llm-status', () => {
    return !!llmProcess;
});

ipcMain.handle('start-llm', async (event, { model }) => {
    if (llmProcess) return { status: 'already_running' };

    // Try to find llama-server
    const possiblePaths = [
        path.join(RESOURCE_ROOT, 'llm', 'llama-server'),
        path.join(app.getAppPath(), '..', 'llm', 'llama-server'),
        '/usr/local/bin/llama-server',
        '/opt/homebrew/bin/llama-server'
    ];

    let llmBin = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            llmBin = p;
            break;
        }
    }

    if (!llmBin) {
        llmBin = 'llama-server';
    }

    console.log(`Starting LLM Server with: ${llmBin}`);

    // Build arguments
    const args = ['--port', '8080', '-c', '2048'];

    // If model name looks like a repo (contains / but isn't a path)
    if (model.includes('/') && !model.startsWith('/') && !model.includes('\\') && !fs.existsSync(model)) {
        args.push('--hf-repo', model);
    } else {
        // Resolve local model path
        let modelPath = model;
        if (!model.startsWith('/')) {
            const possibleModelPaths = [
                path.join(RESOURCE_ROOT, 'llm', model),
                path.join(app.getAppPath(), '..', 'llm', model)
            ];
            for (const p of possibleModelPaths) {
                if (fs.existsSync(p)) {
                    modelPath = p;
                    break;
                }
            }
        }

        if (!fs.existsSync(modelPath)) {
            return {
                status: 'error',
                message: `Model file not found: ${model}. If you intended to use a Hugging Face repo, use the 'org/repo' format. Otherwise, ensure the GGUF file is in the 'llm' directory.`
            };
        }
        args.push('-m', modelPath);
    }

    try {
        console.log(`Spawning: ${llmBin} ${args.join(' ')}`);
        llmProcess = spawn(llmBin, args, {
            stdio: 'pipe'
        });

        llmProcess.stdout.on('data', (data) => console.log(`LLM: ${data}`));
        llmProcess.stderr.on('data', (data) => console.error(`LLM Error: ${data}`));

        llmProcess.on('exit', () => {
            console.log('LLM Server stopped');
            llmProcess = null;
            mainWindow?.webContents.send('llm-status-changed', false);
        });

        mainWindow?.webContents.send('llm-status-changed', true);
        return { status: 'success' };
    } catch (err) {
        console.error('Failed to start LLM:', err);
        return { status: 'error', message: err.message };
    }
});

ipcMain.handle('stop-llm', async () => {
    if (llmProcess) {
        llmProcess.kill('SIGTERM');
        llmProcess = null;
        return { status: 'success' };
    }
    return { status: 'not_running' };
});

const isDev = !app.isPackaged;
const RESOURCE_ROOT = isDev
    ? path.join(__dirname, '..', '..')
    : path.join(process.resourcesPath, 'backend');

const USER_DATA_PATH = app.getPath('userData');
const CONFIG_DIR = path.join(USER_DATA_PATH, 'config');
const WRITABLE_CONFIG_PATH = path.join(USER_DATA_PATH, 'docme.yaml'); // Backend looks here too

// Ensure writable config exists
function ensureConfig() {
    if (!fs.existsSync(USER_DATA_PATH)) {
        fs.mkdirSync(USER_DATA_PATH, { recursive: true });
    }

    if (!fs.existsSync(WRITABLE_CONFIG_PATH)) {
        const defaultConfigPath = path.join(RESOURCE_ROOT, 'config', 'docme.yaml');
        if (fs.existsSync(defaultConfigPath)) {
            console.log('Copying default config to:', WRITABLE_CONFIG_PATH);
            fs.copyFileSync(defaultConfigPath, WRITABLE_CONFIG_PATH);
        } else {
            console.error('Could not find default config at:', defaultConfigPath);
        }
    }
}
ensureConfig();

// Store for settings
let settings = {
    launchAtLogin: false,
    showInDock: true,
    notificationsEnabled: true,
    trackingEnabled: true,
    llmApiKey: '',
    llmModel: 'ggml-org/gemma-3-1b-it-GGUF'
};

// Sync settings with docme.yaml on boot
try {
    const configPath = WRITABLE_CONFIG_PATH;
    if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const apiKeyMatch = configContent.match(/api_key:\s*["']?(.*?)["']?(\s*#|$)/m);
        const modelMatch = configContent.match(/model:\s*["']?(.*?)["']?(\s*#|$)/m);

        if (apiKeyMatch && apiKeyMatch[1]) settings.llmApiKey = apiKeyMatch[1].trim();
        if (modelMatch && modelMatch[1]) settings.llmModel = modelMatch[1].trim();

        // Auto-migrate old model names to HF repo format
        if (settings.llmModel === 'gemma3:1b-it' || settings.llmModel === 'gemma3:1b' || settings.llmModel === 'gemma-3-1b-it-q4_k_m.gguf') {
            console.log(`Migrating old model name '${settings.llmModel}' to HF repo format...`);
            settings.llmModel = 'ggml-org/gemma-3-1b-it-GGUF';
        }
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
        if (!mainWindow) {
            createWindow();
        } else {
            // Only force position if it's the first time or we want to snap it 
            // Better: only position if it was hidden
            const trayBounds = tray.getBounds();
            const windowBounds = mainWindow.getBounds();

            // If it's already visible but lost focus, just focus it
            // If it was hidden, we calculate position but maybe the user wants it to stay where it was?
            // Standard tray app behavior: reposition if it's "snapped", but here let's let it persist
            // unless it's the first time it's shown in this session.

            if (!mainWindow.isVisible()) {
                const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
                const y = Math.round(trayBounds.y + trayBounds.height + 4);

                // Only set position if it hasn't been "moved" (roughly)
                // For simplicity, we'll just check if it's in the initial state or let user drag freely
                // A better approach is to reposition ONLY if it was never moved.
                if (!mainWindow.hasBeenMoved) {
                    mainWindow.setPosition(x, y, false);
                }
            }
        }

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

    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.hasBeenMoved = false;

    mainWindow.on('move', () => {
        mainWindow.hasBeenMoved = true;
    });

    mainWindow.on('resize', () => {
        mainWindow.hasBeenMoved = true;
    });

    // Load content
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    mainWindow.once('ready-to-show', () => {
        // Only position if we haven't manually moved it yet
        if (tray && !mainWindow.hasBeenMoved) {
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
        console.log('Starting backend services from:', RESOURCE_ROOT);

        const serviceEnv = {
            ...process.env,
            PYTHONPATH: RESOURCE_ROOT
        };

        backendProcess = spawn('python3', [
            '-m', 'uvicorn', 'backend.api.main:app',
            '--port', '8000',
            '--host', '127.0.0.1' // Explicitly bind to localhost
        ], {
            cwd: RESOURCE_ROOT,
            env: serviceEnv,
            stdio: 'pipe'
        });

        agentProcess = spawn('python3', ['agent/main.py'], {
            cwd: RESOURCE_ROOT,
            env: serviceEnv,
            stdio: 'pipe'
        });

        backendProcess.stdout.on('data', (data) => {
            const msg = data.toString();
            console.log(`[Backend] ${msg}`);
            if (msg.includes('ERROR') || msg.includes('Exception')) {
                showNotification('Backend Error', 'Check Console.app logs for details.');
            }
        });
        backendProcess.stderr.on('data', (data) => {
            console.error(`[Backend Error] ${data.toString()}`);
        });

        agentProcess.stdout.on('data', (data) => {
            console.log(`[Agent] ${data.toString()}`);
        });
        agentProcess.stderr.on('data', (data) => {
            console.error(`[Agent Error] ${data.toString()}`);
        });

        // Process error handlers
        backendProcess.on('error', (err) => {
            console.error('[Backend Process Error]', err);
            showNotification('Backend Failed', `Could not start backend: ${err.message}`);
        });

        agentProcess.on('error', (err) => {
            console.error('[Agent Process Error]', err);
            showNotification('Agent Failed', `Could not start agent: ${err.message}`);
        });

        backendProcess.on('exit', (code, signal) => {
            console.error(`[Backend] Exited with code ${code}, signal ${signal}`);
            if (code !== 0 && code !== null) {
                showNotification('Backend Stopped', `Exit code: ${code}. App may not function correctly.`);
            }
        });

        agentProcess.on('exit', (code, signal) => {
            console.error(`[Agent] Exited with code ${code}, signal ${signal}`);
        });
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

// Health check for backend startup
async function checkBackendHealth() {
    const maxAttempts = 30; // 30 seconds max
    let attempts = 0;

    console.log('[Health Check] Waiting for backend...');

    const checkInterval = setInterval(async () => {
        attempts++;
        try {
            const response = await fetch('http://localhost:8000/events?date=2020-01-01');
            if (response.ok) {
                clearInterval(checkInterval);
                console.log('[Health Check] Backend is ready!');
                createWindow();
            }
        } catch (e) {
            // Backend not ready yet
            if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.error('[Health Check] Backend failed to start in time');
                showNotification('Backend Error', 'Backend services did not start. Try restarting the app.');
                // Still create window so user can see the UI
                createWindow();
            }
        }
    }, 1000);
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
        // Wait for backend to be ready with health checks
        checkBackendHealth();
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
