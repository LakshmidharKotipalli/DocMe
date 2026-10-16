# Changelog

## v1.1.0 (February 4, 2026)

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

## v1.0.0 (January 29, 2026)

**Initial Release:**
- 🖥️ Native macOS Electron app
- 🔒 100% local data storage with SQLite
- 🤖 Built-in LLM support with Ollama
- 📝 Activity tracking and note-taking
- 📊 AI-powered daily summaries
- 🎨 Beautiful glassmorphism UI
