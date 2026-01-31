const {
    app, BrowserWindow, Menu, Tray, shell, nativeImage,
    Notification, globalShortcut, dialog, nativeTheme,
    systemPreferences, powerMonitor, ipcMain, screen, clipboard
} = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let tray;
let popupWindow;
let floatingNoteWindow;
let backendProcess;
let agentProcess;
let llmProcess;
let isQuitting = false;
let activityCount = 0;
let lastClipboardText = clipboard.readText();

// Helper to get YYYY-MM-DD in local time
function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

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
    showPopupWindow(data);
});

app.on('trigger-clipboard-popup', (data) => {
    showPopupWindow(data);
});

function showPopupWindow(data) {
    if (popupWindow && !popupWindow.isDestroyed()) {
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
        focusable: true,
        show: false,
        skipTaskbar: true,
        visibleOnAllWorkspaces: true,
        level: 'floating',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    popupWindow = win;

    const params = {
        mode: 'popup',
        eventId: data.id,
        app: data.app || '',
        title: data.window_title || ''
    };

    if (data.note) {
        params.initialNote = data.note;
    }

    const queryParams = new URLSearchParams(params).toString();

    const url = isDev
        ? `http://localhost:5173/?${queryParams}`
        : `file://${path.join(__dirname, '../dist/index.html')}?${queryParams}`;

    win.loadURL(url);
    win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) {
            win.show();
        }
    });
    win.on('closed', () => {
        if (popupWindow === win) popupWindow = null;
    });
}

// Floating Note Button - System-wide always-on-top mini window
let floatingNoteExpanded = false;

ipcMain.on('toggle-floating-note', () => {
    if (floatingNoteWindow && !floatingNoteWindow.isDestroyed()) {
        floatingNoteExpanded = !floatingNoteExpanded;
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;

        if (floatingNoteExpanded) {
            floatingNoteWindow.setSize(320, 200);
            floatingNoteWindow.setPosition(width - 330, height - 210);
        } else {
            floatingNoteWindow.setSize(70, 70);
            floatingNoteWindow.setPosition(width - 80, height - 80);
        }
    }
});

ipcMain.on('save-floating-note', async (event, noteText) => {
    if (!noteText.trim()) return;

    try {
        // Get the latest event to attach note to
        const today = getLocalDateString();
        const eventsRes = await fetch(`http://localhost:8000/events?date=${today}&limit=1`);
        const events = await eventsRes.json();

        if (events && events.length > 0) {
            await fetch(`http://localhost:8000/events/${events[0].id}/note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: noteText })
            });
            showNotification('Note Saved', `Added to: ${events[0].app}`);
        }
    } catch (err) {
        console.error('Failed to save floating note:', err);
    }
});

function createFloatingNoteWindow() {
    if (floatingNoteWindow && !floatingNoteWindow.isDestroyed()) {
        floatingNoteWindow.show();
        return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    floatingNoteWindow = new BrowserWindow({
        width: 70,
        height: 70,
        x: width - 80,
        y: height - 80,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        hasShadow: false,
        focusable: true,
        skipTaskbar: true,
        visibleOnAllWorkspaces: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Higher level for macOS to show over full-screen apps and other spaces
    floatingNoteWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    // Extra options for macOS spaces/full-screen support
    floatingNoteWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
    });
    floatingNoteWindow.setFullScreenable(false);

    const url = isDev
        ? `http://localhost:5173/?mode=floating`
        : `file://${path.join(__dirname, '../dist/index.html')}?mode=floating`;

    floatingNoteWindow.loadURL(url);
    floatingNoteWindow.showInactive();

    floatingNoteWindow.on('closed', () => {
        floatingNoteWindow = null;
        floatingNoteExpanded = false;
    });
}

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

    // Apply certain settings immediately (macOS only)
    if (app.dock) {
        if (settings.showInDock) app.dock.show();
        else app.dock.hide();
    }
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

    // Note: Removed setVisibleOnAllWorkspaces to allow proper minimize behavior
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

    // Log web content errors for debugging
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer Console] ${message}`);
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`[Load Failed] ${errorDescription} (${errorCode}) for ${validatedURL}`);
    });

    // Open DevTools for debugging in production (can be removed later)
    // mainWindow.webContents.openDevTools({ mode: 'detach' });

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
        console.log('Starting backend services...');
        console.log('RESOURCE_ROOT:', RESOURCE_ROOT);
        console.log('WRITABLE_CONFIG_PATH:', WRITABLE_CONFIG_PATH);
        console.log('USER_DATA_PATH:', USER_DATA_PATH);

        // Find Python - try common locations based on platform
        let pythonPaths = [];

        if (process.platform === 'darwin') {
            // macOS paths
            pythonPaths = [
                '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
                '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
                '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
                '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
                '/opt/homebrew/bin/python3',
                '/usr/local/bin/python3',
                '/usr/bin/python3',
                'python3'
            ];
        } else if (process.platform === 'win32') {
            // Windows paths
            const userHome = process.env.USERPROFILE || '';
            pythonPaths = [
                path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
                path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
                path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
                'C:\\Python312\\python.exe',
                'C:\\Python311\\python.exe',
                'C:\\Python310\\python.exe',
                'python'
            ];
        } else {
            // Linux paths
            pythonPaths = [
                '/usr/bin/python3',
                '/usr/local/bin/python3',
                'python3'
            ];
        }

        let pythonPath = process.platform === 'win32' ? 'python' : 'python3';

        // 1. Check if we have a bundled venv (ideal for distribution)
        const bundledVenv = process.platform === 'win32'
            ? path.join(process.resourcesPath, 'python_runtime', 'Scripts', 'python.exe')
            : path.join(process.resourcesPath, 'python_runtime', 'bin', 'python3');

        if (fs.existsSync(bundledVenv)) {
            pythonPath = bundledVenv;
            console.log('Using bundled virtual environment:', pythonPath);
        } else {
            // 2. Fallback to system python searching
            for (const p of pythonPaths) {
                if (fs.existsSync(p)) {
                    pythonPath = p;
                    console.log('Found System Python at:', pythonPath);
                    break;
                }
            }
        }

        // Build platform-specific PATH additions
        let pathAdditions = '';
        if (process.platform === 'darwin') {
            pathAdditions = '/usr/local/bin:/opt/homebrew/bin:/usr/bin';
        } else if (process.platform === 'win32') {
            const userHome = process.env.USERPROFILE || '';
            pathAdditions = [
                path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python312'),
                path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python311'),
                'C:\\Python312',
                'C:\\Python311'
            ].join(';');
        } else {
            pathAdditions = '/usr/local/bin:/usr/bin';
        }

        // Build environment
        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        let envPath = `${process.env.PATH}${pathSeparator}${pathAdditions}`;

        // If using bundled venv, put its bin/Scripts at the front of the PATH
        if (pythonPath === bundledVenv) {
            const venvBin = path.dirname(bundledVenv);
            envPath = `${venvBin}${pathSeparator}${envPath}`;
        }

        const serviceEnv = {
            ...process.env,
            PYTHONPATH: RESOURCE_ROOT,
            PATH: envPath,
            DOCME_CONFIG_PATH: WRITABLE_CONFIG_PATH,
            DOCME_DATA_PATH: USER_DATA_PATH,
            PYTHONUNBUFFERED: '1',
            // Ensure sqlite and other native libs find their dependencies
            DYLD_LIBRARY_PATH: process.platform === 'darwin' ? `${path.join(process.resourcesPath, 'python_runtime', 'lib')}${pathSeparator}${process.env.DYLD_LIBRARY_PATH || ''}` : undefined
        };

        // 3. Pre-flight check: Verify if dependencies are installed
        // We do this by trying to import one of our core dependencies
        exec(`"${pythonPath}" -c "import fastapi, uvicorn, sqlalchemy, loguru, watchdog, psutil"`, { env: serviceEnv }, (err) => {
            if (err) {
                console.error('Python dependency check failed:', err.message);
                showNotification(
                    'Setup Required',
                    'DocMe needs some Python libraries. Please see the Installation Guide or run: pip3 install -r requirements.txt'
                );

                // If it's a critical failure, we should probably stop here or provide more info
                if (mainWindow) {
                    mainWindow.webContents.send('backend-error', 'Missing Python dependencies. Please install required packages.');
                }
            }
        });

        // In packaged mode, the structure is:
        // RESOURCE_ROOT/backend/ (contains api/, etc.)
        // RESOURCE_ROOT/agent/ (contains main.py, collectors/, etc.)
        console.log('Starting uvicorn with PYTHONPATH:', RESOURCE_ROOT);

        backendProcess = spawn(pythonPath, [
            '-m', 'uvicorn', 'backend.api.main:app',
            '--port', '8000',
            '--host', '127.0.0.1'
        ], {
            cwd: RESOURCE_ROOT,
            env: serviceEnv,
            stdio: 'pipe',
            detached: false,
            windowsHide: true
        });

        const agentMainPath = path.join(RESOURCE_ROOT, 'agent', 'main.py');
        console.log('Starting agent from:', agentMainPath);

        agentProcess = spawn(pythonPath, [agentMainPath], {
            cwd: RESOURCE_ROOT,
            env: serviceEnv,
            stdio: 'pipe',
            detached: false,
            windowsHide: true
        });

        backendProcess.stdout.on('data', (data) => {
            try {
                const msg = data.toString();
                console.log(`[Backend] ${msg}`);
                if (msg.includes('ERROR') || msg.includes('Exception')) {
                    showNotification('Backend Error', 'Check Console.app logs for details.');
                }
            } catch (e) {
                // Ignore EPIPE errors when process exits
            }
        });
        backendProcess.stderr.on('data', (data) => {
            try {
                console.error(`[Backend Error] ${data.toString()}`);
            } catch (e) {
                // Ignore EPIPE errors when process exits
            }
        });

        agentProcess.stdout.on('data', (data) => {
            try {
                console.log(`[Agent] ${data.toString()}`);
            } catch (e) {
                // Ignore EPIPE errors when process exits
            }
        });
        agentProcess.stderr.on('data', (data) => {
            try {
                console.error(`[Agent Error] ${data.toString()}`);
            } catch (e) {
                // Ignore EPIPE errors when process exits
            }
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
    let windowCreated = false;

    console.log('[Health Check] Waiting for backend to start...');

    const checkInterval = setInterval(async () => {
        attempts++;
        try {
            const response = await fetch('http://localhost:8000/health');
            if (response.ok) {
                clearInterval(checkInterval);
                console.log('[Health Check] Backend is ready!');
                if (!windowCreated) {
                    windowCreated = true;
                    createWindow();
                }
            }
        } catch (e) {
            console.log(`[Health Check] Attempt ${attempts}/${maxAttempts} - Backend not ready yet (${e.message})`);

            // Create window after 5 seconds even if backend isn't ready
            // This allows the user to see the app is loading
            if (attempts >= 5 && !windowCreated) {
                windowCreated = true;
                console.log('[Health Check] Creating window while waiting for backend...');
                createWindow();
            }

            if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.error('[Health Check] Backend failed to start after 30 seconds');
                showNotification('Backend Starting Slowly', 'Backend services are still starting. Please wait or restart the app.');
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

function startClipboardWatcher() {
    setInterval(async () => {
        const currentText = clipboard.readText();
        if (currentText && currentText !== lastClipboardText && currentText.trim().length > 0) {
            lastClipboardText = currentText;

            // Only trigger if it's a "meaningful" length and looks like something the user might want to note
            // (e.g., > 2 chars to avoid single character selections)
            if (currentText.trim().length > 2) {
                console.log(`[Clipboard] New text detected (${currentText.substring(0, 20)}...), triggering popup...`);

                // Delay to allow agent to record the focal point
                setTimeout(async () => {
                    try {
                        const date = getLocalDateString();
                        const response = await fetch(`http://localhost:8000/events?date=${date}&limit=1`);
                        const events = await response.json();

                        if (events && events.length > 0) {
                            const data = events[0];
                            console.log(`[Clipboard] Attaching note to: ${data.app} | ${data.window_title}`);

                            app.emit('trigger-clipboard-popup', {
                                id: data.id,
                                app: data.app,
                                window_title: data.window_title,
                                note: currentText
                            });
                        } else {
                            console.warn('[Clipboard] No events found for today to attach note to.');
                        }
                    } catch (e) {
                        console.error('[Clipboard] Failed to fetch latest event:', e);
                    }
                }, 800);
            }
        }
    }, 1500); // Check every 1.5s
}

// ==================== APP INITIALIZATION ====================

app.whenReady().then(() => {
    // Show dock icon always for better visibility (macOS only)
    if (app.dock) {
        app.dock.show();
    }

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
    createFloatingNoteWindow();
    startClipboardWatcher();

    // Show startup notification
    setTimeout(() => {
        showNotification('DocMe Active', 'Activity tracking has started. Look for the icon in your menu bar.');
    }, 3000);
});

app.on('activate', () => {
    if (!mainWindow) {
        createWindow();
    } else {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    // On macOS, keep running in the tray when all windows are closed
    // Only quit if the user explicitly quits from the tray menu
    if (process.platform !== 'darwin') {
        app.quit();
    }
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
