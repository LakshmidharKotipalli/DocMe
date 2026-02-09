# DocMe - Privacy-First Activity Tracker

<div align="center">

<img src="frontend/public/icon.png" alt="DocMe Logo" width="120"/>

**A beautiful, privacy-first activity tracker that runs entirely on your Mac.**

[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-blue.svg)](https://www.apple.com/macos/)

[Download Latest Release](https://github.com/LakshmidharKotipalli/DocMe/releases/latest) • [Installation Guide](INSTALL.md) • [Report Issue](https://github.com/LakshmidharKotipalli/DocMe/issues)

</div>

---

## ✨ Features

- 🖥️ **Native macOS App** - Beautiful menu bar integration with drag-to-position dashboard
- 🔒 **100% Private** - All data stays on your machine, never sent to any server
- 🤖 **AI-Powered Summaries** - Built-in LLM server with automatic model download from Hugging Face
- 📝 **Smart Quick Notes** - Non-intrusive popup for capturing thoughts without breaking flow
- 📊 **Beautiful Daily Reports** - Markdown summaries of your day's work and achievements
- 🔍 **Code Change Tracking** - Automatically detects and summarizes file modifications
- 🌓 **Premium UI** - Glassmorphism design with cyber lime accents and smooth animations
- ⚡ **Zero Configuration** - Works out of the box with SQLite, no database setup needed

---

## 🚀 Quick Start

### Option 1: Download Pre-built App (Recommended)

1. **Download** the latest `DocMe-1.1.0-arm64.dmg` from [Releases](https://github.com/LakshmidharKotipalli/DocMe/releases/latest)
2. **Open** the DMG and drag DocMe to Applications
3. **Launch** DocMe from Applications/Spotlight
4. **Grant Permissions** (see [Installation Guide](INSTALL.md))

### Option 2: Run from Source

#### Prerequisites
- **macOS**: 11.0 (Big Sur) or later
- **Node.js**: 18.0+ ([Download](https://nodejs.org/))
- **Python**: 3.11+ ([Download](https://www.python.org/))

#### Installation Steps

```bash
# 1. Clone the repository
git clone https://github.com/LakshmidharKotipalli/DocMe.git
cd DocMe

# 2. Set up Python environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Install frontend dependencies
cd frontend
npm install
cd ..
```

#### Running the Application

**Desktop Mode (Native App):**
```bash
python3 scripts/run_all.py --desktop
```

**Web Mode (Browser Dashboard):**
```bash
python3 scripts/run_all.py
```
Then open `http://localhost:5173` in your browser.

---

## ⚙️ Configuration

### AI Summaries

DocMe includes a built-in LLM server that automatically downloads models from Hugging Face.

1. **Open Settings** (gear icon in top-right)
2. **Toggle LLM On** - First activation downloads the model (~700MB)
3. **Change Model** (optional): Edit the model name to any GGUF-compatible repo

**Supported Model Formats:**
- Hugging Face repos: `ggml-org/gemma-3-1b-it-GGUF`
- Local GGUF files: Place in `llm/` directory

### Advanced Configuration

Edit `config/docme.yaml` for granular control:

```yaml
# Activity tracking
polling_interval_sec: 1.5
idle_threshold_sec: 300

# Privacy filters
excluded_apps:
  - "Keychain Access"
  - "1Password"
  
sensitive_keywords:
  - "password"
  - "bank"

# LLM settings
llm:
  model: "ggml-org/gemma-3-1b-it-GGUF"
  base_url: "http://localhost:8080/v1"

# Database (default: SQLite)
database:
  type: "sqlite"
  sqlite_path: "data/docme.sqlite"
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+D` | Toggle Dashboard |
| `Cmd+Shift+N` | Quick Note Popup |
| `Cmd+G` | Generate Today's Report |
| `Cmd+E` | Export Data |

---

## 🏗️ Building from Source

### Create macOS DMG

```bash
python3 scripts/build_dist.py
```

Output: `frontend/release/DocMe-1.0.0-arm64.dmg`

### Project Structure

```
DocMe/
├── agent/              # Background activity tracker
├── backend/            # FastAPI server & processing
├── frontend/           # React + Electron UI
│   ├── electron/       # Electron main process
│   ├── src/            # React components
│   └── public/         # Static assets
├── config/             # Configuration files
├── scripts/            # Build & utility scripts
└── llm/                # LLM models directory
```

---

## 🛠 Troubleshooting

### No Logs Appearing in Activity Tab ⚠️

**Most Common Issue (v1.1.0 Fix):**

1. **Check Database Configuration:**
   ```bash
   cat ~/Library/Application\ Support/DocMe/docme.yaml | grep -A 3 "database:"
   ```
   Should show:
   ```yaml
   database:
     type: "sqlite"  # NOT "postgresql"
     sqlite_path: "~/Library/Application Support/DocMe/docme.sqlite"
   ```

2. **Fix if using PostgreSQL:**
   ```bash
   # Edit config file
   nano ~/Library/Application\ Support/DocMe/docme.yaml
   # Change: type: "postgresql" → type: "sqlite"
   ```

3. **Verify Backend Health:**
   ```bash
   curl http://127.0.0.1:8000/health
   # Should return: {"status":"ok","database":"connected"}
   ```

4. **Check Events in Database:**
   ```bash
   sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
     "SELECT COUNT(*) FROM events WHERE date(ts) = date('now');"
   ```

### Missing Python Dependency

**Error:** `ModuleNotFoundError: No module named 'slowapi'`

**Fix:**
```bash
pip3 install slowapi==0.1.9
```

### Blank Page or No Data

**Check Permissions:**
1. Go to `System Settings → Privacy & Security`
2. Enable **Accessibility** for DocMe (required for window titles)
3. Enable **Screen Recording** for DocMe (optional, for screenshots)

**Verify Backend:**
```bash
# Check if backend is running
lsof -i :8000

# Check for errors
curl http://127.0.0.1:8000/health

# View logs (development mode)
cat /tmp/backend_new.log
```

### Port 8000 Already in Use

**Error:** `address already in use`

**Fix:**
```bash
# Find process using port 8000
lsof -i :8000

# Kill the process
kill -9 <PID>

# Or kill all Python processes
pkill -f "uvicorn backend.api.main"
```

### LLM Toggle Not Working

**First Time Setup:**
- Ensure internet connectivity (for model download)
- Wait 30-60 seconds for download to complete
- Check `~/Library/Application Support/DocMe/llm/` for cached models

**Manual Installation:**
- Download a GGUF model file
- Place in `llm/` directory in project root (for dev)
- Or `~/Library/Application Support/DocMe/llm/` (for packaged app)

### Backend Services Not Starting

**Check Python Dependencies:**
```bash
pip3 install -r requirements.txt

# Or install individually:
pip3 install uvicorn fastapi sqlalchemy psutil pytz loguru pyyaml slowapi
```

**View Detailed Logs:**
```bash
# For development
python3 scripts/run_all.py --desktop

# Check backend directly
cd backend
PYTHONPATH=.. python3 -m uvicorn api.main:app --reload

# Check agent
PYTHONPATH=. python3 agent/main.py
```

### Data Directory Issues

**View Data Location:**
```bash
ls -la ~/Library/Application\ Support/DocMe/
```

**Should contain:**
- `docme.sqlite` - Database file
- `docme.yaml` - Configuration
- `README.md` - Usage guide

**Reset Data (CAUTION - Deletes Everything):**
```bash
rm -rf ~/Library/Application\ Support/DocMe/
# Will be recreated on next launch
```

---

## 🔧 Development

### Database Migrations

```bash
# Reset database (CAUTION: deletes all data)
python3 scripts/reset_docme.py

# Migrate schema
python3 scripts/migrate_db.py
```

### Hot Reload Development

```bash
# Terminal 1: Backend + Agent
python3 scripts/run_all.py

# Terminal 2: Frontend (dev server)
cd frontend
npm run dev

# Terminal 3: Electron (pointing to dev server)
npm run electron:dev
```

---

## 📋 Changelog

### v1.1.0 (February 4, 2026)

**🐛 Bug Fixes:**
- ✅ Fixed logs not appearing in packaged .dmg app
- ✅ Fixed database configuration defaulting to PostgreSQL instead of SQLite
- ✅ Fixed CORS blocking file:// protocol for Electron packaged apps
- ✅ Fixed API authentication preventing frontend from accessing backend
- ✅ Fixed SQLAlchemy 2.0 compatibility in health check endpoint
- ✅ Added missing `slowapi` dependency to requirements.txt

**🔧 Improvements:**
- ✅ Better error messages and status indicators in UI
- ✅ Improved backend startup health checks (increased timeout to 60s)
- ✅ More reliable connections using 127.0.0.1 instead of localhost
- ✅ Added backend loading and error states in dashboard
- ✅ Cleaned up data directory (removed Electron cache files)
- ✅ Created comprehensive README in data directory

**📝 Files Modified:**
- `requirements.txt` - Added slowapi dependency
- `backend/api/main.py` - CORS & auth fixes, health check SQLAlchemy 2.0 fix
- `frontend/src/App.jsx` - Better error handling and user feedback
- `frontend/electron/main.js` - Improved backend health checks
- `frontend/electron/preload.js` - Added backend status IPC handlers
- `config/docme.yaml` - Default to SQLite instead of PostgreSQL

### v1.0.0 (January 29, 2026)

**Initial Release:**
- 🖥️ Native macOS Electron app
- 🔒 100% local data storage with SQLite
- 🤖 Built-in LLM support with Ollama
- 📝 Activity tracking and note-taking
- 📊 AI-powered daily summaries
- 🎨 Beautiful glassmorphism UI

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), and [FastAPI](https://fastapi.tiangolo.com/)
- LLM integration powered by [llama.cpp](https://github.com/ggml-org/llama.cpp)
- Icons from [Lucide](https://lucide.dev/)
- Models from [Hugging Face](https://huggingface.co/)

---

<div align="center">

**Made with ❤️ for productivity and privacy**

[⬆ Back to Top](#docme---privacy-first-activity-tracker)

</div>
