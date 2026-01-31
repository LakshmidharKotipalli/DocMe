# Release Notes - DocMe v1.1.0

## 🆕 New Features

### 📊 Visual Analytics Dashboard
- **Activity Overview Chart**: Donut chart showing time distribution across categories (Coding, Browsing, Communication, etc.)
- **Daily Trend Chart**: Bar chart visualizing your productivity throughout the day
- **Top Apps Panel**: Ranked list of your most-used applications with duration bars

### 🔍 Search & Filtering
- **Smart Search**: Filter activity logs by app name, window title, or notes
- **Real-time Filtering**: Instant results as you type

### 📝 Enhanced Note-Taking
- **Persistent Mini-Note Widget**: Floating button to quickly add notes anytime
- **Extended Popup Timer**: Notes popup now stays for 5 seconds (up from 3)
- **Keep Alive on Typing**: Popup won't auto-close while you're writing

### 📥 Report Export
- **Download Reports**: One-click download of daily reports as Markdown files

### 🧠 AI Integration
- **Extended AI App Tracking**: Special context capture for ChatGPT, Claude, Cursor, Copilot, Gemini, Comet, and Perplexity
- **Improved Prompts**: Better structured LLM prompts for clearer, bullet-point summaries

### 🌐 Browser Extension (DocMe Highlighter)
- **Save Highlights**: Select text on any webpage and save it to DocMe notes
- **Context Menu**: Right-click to save selected text
- **Visual Feedback**: Toast notifications confirm saves

### 🔒 Privacy Improvements
- **DocMe Self-Exclusion**: The app no longer logs its own activity

---

# Release Notes - DocMe v1.0.0

## 🎉 What's New

- **Privacy-First Activity Tracking**: All data stays on your machine
- **AI-Powered Summaries**: Integrated LLM server with automatic model download
- **Native macOS Integration**: Menu bar app with global shortcuts
- **Smart Quick Notes**: Non-intrusive popup for capturing thoughts
- **Daily Reports**: Beautiful markdown summaries of your work

## 🔧 Fixed in This Build

- ✅ **Logo Display**: Fixed broken logo in packaged app
- ✅ **Database**: Changed default to SQLite for better portability
- ✅ **Backend Logging**: Added comprehensive error logging and health checks
- ✅ **Service Startup**: Improved backend/agent startup reliability
- ✅ **LLM Integration**: Automatic model download from Hugging Face

## 📦 Installation

1. **Download** `DocMe-1.0.0-arm64.dmg`
2. **Open** the DMG and drag DocMe to Applications
3. **Launch** DocMe from Applications
4. **Grant Permissions**:
   - Go to System Settings → Privacy & Security
   - Enable **Accessibility** for DocMe
   - Enable **Screen Recording** for DocMe
5. **First Run**: The LLM toggle will download the Gemma 3 model (~700MB) on first activation

## 🐛 Troubleshooting

**If you see a blank page or no data:**
- Check that you granted Accessibility & Screen Recording permissions
- Open Console.app and filter for "DocMe" to see backend logs
- The backend needs Python 3.11+ with these packages:
  ```bash
  pip3 install uvicorn fastapi sqlalchemy psutil pytz loguru pyyaml
  ```

**If the LLM toggle doesn't work:**
- Ensure you have internet connectivity for the first download
- For manual model installation, place `.gguf` files in:
  `~/Library/Application Support/DocMe/llm/`

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+D` | Toggle Dashboard |
| `Cmd+Shift+N` | Quick Note |
| `Cmd+G` | Generate Report |

## 📝 System Requirements

- **macOS**: 11.0 (Big Sur) or later
- **Architecture**: Apple Silicon (M1/M2/M3) or Intel
- **Python**: 3.11+ (for backend services)
- **Storage**: ~2GB (including model cache)

---

**Full documentation**: See `INSTALL.md` and `README.md` in the repository.
