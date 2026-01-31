const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Window controls (for custom title bar)
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  focusWindow: () => ipcRenderer.send('focus-window'),
  showNotificationWindow: () => ipcRenderer.send('show-notification-window'),
  createPopupWindow: (data) => ipcRenderer.send('create-popup-window', data),

  // Notifications
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // Navigation from main process
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, tab) => callback(tab)),
  onNavigateToReport: (callback) => ipcRenderer.on('navigate-to-report', () => callback()),
  onQuickNote: (callback) => ipcRenderer.on('quick-note', () => callback()),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // File operations
  exportReport: () => ipcRenderer.invoke('export-report'),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // LLM Controls
  startLLM: (model) => ipcRenderer.invoke('start-llm', { model }),
  stopLLM: () => ipcRenderer.invoke('stop-llm'),
  getLLMStatus: () => ipcRenderer.invoke('get-llm-status'),
  onLLMStatusChanged: (callback) => ipcRenderer.on('llm-status-changed', (event, status) => callback(status)),

  // Floating Note Controls
  toggleFloatingNote: () => ipcRenderer.send('toggle-floating-note'),
  saveFloatingNote: (note) => ipcRenderer.send('save-floating-note', note),

  // Error handling
  onBackendError: (callback) => ipcRenderer.on('backend-error', (event, msg) => callback(msg))
});

// Add custom CSS for native feel
window.addEventListener('DOMContentLoaded', () => {
  // Add class for Electron-specific styling
  document.body.classList.add('electron-app');

  // Inject custom styles for native macOS feel
  const style = document.createElement('style');
  style.textContent = `
    /* Native macOS window styling */
    body.electron-app {
      /* Add padding for traffic lights */
      padding-top: 32px !important;
    }
    
    /* Only header is draggable for window movement */
    body.electron-app header {
      -webkit-app-region: drag;
    }
    
    /* Make interactive elements non-draggable */
    body.electron-app button,
    body.electron-app input,
    body.electron-app textarea,
    body.electron-app select,
    body.electron-app a,
    body.electron-app [role="button"],
    body.electron-app .glass-panel,
    body.electron-app section {
      -webkit-app-region: no-drag;
    }
    
    /* Ensure scrolling works */
    body.electron-app div,
    body.electron-app main,
    body.electron-app section {
      -webkit-app-region: no-drag;
    }
    
    /* Custom scrollbar for macOS feel */
    body.electron-app ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    body.electron-app ::-webkit-scrollbar-track {
      background: transparent;
    }
    
    body.electron-app ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }
    
    body.electron-app ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `;
  document.head.appendChild(style);
});
