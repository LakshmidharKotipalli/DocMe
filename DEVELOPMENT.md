# DocMe Development Guide

Complete guide for running, testing, and developing DocMe locally.

---

## 🚀 Quick Start (Development Mode)

### Prerequisites Check

```bash
# Verify installations
python3 --version  # Should be 3.11+
node --version     # Should be 18+
npm --version
```

---

## 📦 Initial Setup (First Time Only)

### 1. Install Python Dependencies

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe

# Install all Python packages
pip3 install -r requirements.txt

# Verify critical packages
pip3 list | grep -E "(fastapi|uvicorn|slowapi|sqlalchemy)"
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Initialize Configuration

```bash
# Create data directory
mkdir -p ~/Library/Application\ Support/DocMe

# Copy default config if needed
cp config/docme.yaml ~/Library/Application\ Support/DocMe/docme.yaml

# Edit config to use SQLite (IMPORTANT!)
nano ~/Library/Application\ Support/DocMe/docme.yaml
# Ensure: database.type: "sqlite"
```

---

## 🏃 Running the Application

### Option 1: All-in-One Electron App (Recommended)

This runs the complete app with automatic backend management.

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe/frontend
npm run electron:dev
```

**What this does:**
- Starts Vite dev server on http://localhost:5173
- Automatically starts Electron window
- Electron manages backend and agent processes
- Hot reload enabled for React components

**Note:** Backend won't start automatically in dev mode. Continue to Option 2.

---

### Option 2: Manual Backend + Frontend (Full Control)

Run each component separately for better debugging.

#### Terminal 1: Backend API Server

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe

# Set environment variables
export PYTHONPATH=.
export DOCME_CONFIG_PATH="$HOME/Library/Application Support/DocMe/docme.yaml"
export DOCME_DATA_PATH="$HOME/Library/Application Support/DocMe"

# Start backend
python3 -m uvicorn backend.api.main:app --port 8000 --host 127.0.0.1 --reload

# Should see:
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Test backend:**
```bash
# In another terminal
curl http://127.0.0.1:8000/health
# Expected: {"status":"ok","database":"connected"}
```

#### Terminal 2: Activity Collection Agent

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe

# Set environment variables
export PYTHONPATH=.
export DOCME_CONFIG_PATH="$HOME/Library/Application Support/DocMe/docme.yaml"

# Start agent
python3 agent/main.py

# Should see agent start logging activity
```

#### Terminal 3: Frontend Development Server

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe/frontend

# Start Vite dev server
npm run dev

# Opens: http://localhost:5173
```

#### Terminal 4: Electron App (Optional)

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe/frontend

# Start Electron pointing to dev server
npm run electron:start
```

---

## 🧪 Testing & Verification

### 1. Check Backend Health

```bash
# Health check
curl http://127.0.0.1:8000/health

# Get today's events
curl "http://127.0.0.1:8000/events?date=$(date +%Y-%m-%d)"

# Check database
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
  "SELECT COUNT(*) FROM events;"
```

### 2. Verify Agent is Collecting Data

```bash
# Check processes
ps aux | grep -E "(uvicorn|agent/main)" | grep -v grep

# Check recent events in database
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
  "SELECT app, window_title, ts FROM events ORDER BY ts DESC LIMIT 5;"
```

### 3. Test API Endpoints

```bash
# Get today's events
curl -s "http://127.0.0.1:8000/events?date=$(date +%Y-%m-%d)" | python3 -m json.tool

# Generate report
curl -X POST "http://127.0.0.1:8000/reports/generate?date=$(date +%Y-%m-%d)"

# Get report
curl -s "http://127.0.0.1:8000/reports?date=$(date +%Y-%m-%d)" | python3 -m json.tool

# Get system logs
curl -s "http://127.0.0.1:8000/logs?limit=10" | python3 -m json.tool
```

### 4. WebSocket Testing

```bash
# Install wscat if needed
npm install -g wscat

# Connect to WebSocket
wscat -c ws://127.0.0.1:8000/ws

# Should see real-time events as you switch apps
```

---

## 🐛 Common Development Issues

### Port 8000 Already in Use

```bash
# Find and kill process
lsof -i :8000
kill -9 <PID>

# Or kill all
pkill -f "uvicorn backend.api.main"
```

### Module Not Found Errors

```bash
# Reinstall dependencies
pip3 install -r requirements.txt

# Check PYTHONPATH is set
echo $PYTHONPATH  # Should show current directory or "."
```

### Database Issues

```bash
# Check database location
ls -la ~/Library/Application\ Support/DocMe/docme.sqlite

# View tables
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite ".tables"

# Reset database (CAUTION: Deletes all data)
rm ~/Library/Application\ Support/DocMe/docme.sqlite*
# Will be recreated on next backend start
```

### Frontend Not Connecting to Backend

```bash
# Check API base URL in App.jsx
# Should be: const API_BASE = "http://127.0.0.1:8000";

# Check CORS in backend/api/main.py
# Should allow localhost:5173 and 127.0.0.1:5173

# Clear browser cache
# In browser: Cmd+Shift+R (hard refresh)
```

### No Logs Appearing

1. **Check config type:**
   ```bash
   grep "type:" ~/Library/Application\ Support/DocMe/docme.yaml
   # Should show: type: "sqlite"
   ```

2. **Verify agent is running:**
   ```bash
   ps aux | grep "agent/main.py" | grep -v grep
   ```

3. **Check for events in database:**
   ```bash
   sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
     "SELECT COUNT(*) FROM events WHERE date(ts) = date('now');"
   ```

4. **Grant Accessibility permissions:**
   - System Settings → Privacy & Security → Accessibility
   - Add Terminal (or Python) to the list

---

## 🔧 Development Workflows

### Making Backend Changes

1. Edit Python files in `backend/` or `agent/`
2. Backend auto-reloads if using `--reload` flag
3. Test changes with curl commands
4. Check logs in terminal

### Making Frontend Changes

1. Edit React components in `frontend/src/`
2. Vite hot-reloads automatically
3. Changes appear instantly in browser
4. Check browser console for errors (F12)

### Making Electron Changes

1. Edit `frontend/electron/main.js` or `preload.js`
2. Restart Electron app (Cmd+Q, then restart)
3. Changes require full restart

---

## 📊 Database Development

### View Database Schema

```bash
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite ".schema"
```

### Useful Queries for Development

```sql
-- Count events by app
SELECT app, COUNT(*) as count
FROM events
GROUP BY app
ORDER BY count DESC;

-- Events from last hour
SELECT * FROM events
WHERE ts >= datetime('now', '-1 hour')
ORDER BY ts DESC;

-- Today's sessions
SELECT * FROM sessions
WHERE date(start_ts) = date('now');

-- Latest report
SELECT date, created_ts,
       substr(report_md, 1, 100) as preview
FROM reports
ORDER BY created_ts DESC
LIMIT 1;

-- System errors
SELECT * FROM system_logs
WHERE level = 'ERROR'
ORDER BY ts DESC
LIMIT 10;
```

### Reset Database for Testing

```bash
# Complete reset
rm ~/Library/Application\ Support/DocMe/docme.sqlite*

# Delete only events (keep config)
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
  "DELETE FROM events; DELETE FROM sessions; DELETE FROM reports;"
```

---

## 🏗️ Building for Distribution

### Build Frontend Assets

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe/frontend
npm run build

# Output: frontend/dist/
```

### Package as .dmg

```bash
cd /Users/lakshmidharkotipalli/Desktop/DocMe/frontend

# Prepare Python runtime
npm run dist:prepare

# Build macOS app
npm run electron:build

# Output: frontend/release/DocMe-1.1.0-arm64.dmg
```

### Test Packaged App

```bash
# Install from DMG
open frontend/release/DocMe-1.1.0-arm64.dmg

# Check logs
log show --predicate 'process == "DocMe"' --last 5m --info

# Check processes
ps aux | grep DocMe
```

---

## 📝 Development Checklist

Before committing changes:

- [ ] Backend health check passes: `curl http://127.0.0.1:8000/health`
- [ ] Frontend builds without errors: `npm run build`
- [ ] No console errors in browser DevTools
- [ ] Events are being collected and appear in UI
- [ ] Database queries work correctly
- [ ] Accessibility permissions granted
- [ ] Config file uses correct database type
- [ ] All Python dependencies in requirements.txt
- [ ] Package.json scripts are up to date

---

## 🔍 Debugging Tips

### Enable Verbose Logging

**Backend:**
```python
# In backend/api/main.py, set:
echo=True  # In create_engine()
```

**Frontend:**
```javascript
// In App.jsx, add:
console.log('API_BASE:', API_BASE);
console.log('Events:', events);
```

### View Live Logs

```bash
# Backend logs
tail -f /tmp/backend_new.log

# Agent logs
tail -f /tmp/agent_new.log

# System logs (macOS)
log stream --predicate 'process == "DocMe"' --level debug
```

### Network Debugging

```bash
# Check all listening ports
lsof -i -P | grep LISTEN | grep -E "(8000|5173|8080)"

# Test WebSocket
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: 127.0.0.1:8000" \
  http://127.0.0.1:8000/ws
```

---

## 🎯 Performance Testing

### Load Test Backend

```bash
# Install hey (HTTP load generator)
brew install hey

# Test health endpoint
hey -n 1000 -c 10 http://127.0.0.1:8000/health

# Test events endpoint
hey -n 100 -c 5 "http://127.0.0.1:8000/events?date=$(date +%Y-%m-%d)"
```

### Monitor Resource Usage

```bash
# Watch Python processes
watch -n 1 'ps aux | grep python | grep -v grep'

# Check database size
ls -lh ~/Library/Application\ Support/DocMe/docme.sqlite

# Count database rows
sqlite3 ~/Library/Application\ Support/DocMe/docme.sqlite \
  "SELECT 'events', COUNT(*) FROM events
   UNION SELECT 'sessions', COUNT(*) FROM sessions
   UNION SELECT 'reports', COUNT(*) FROM reports;"
```

---

## 📚 Additional Resources

- **SQLite Documentation:** https://www.sqlite.org/docs.html
- **FastAPI Docs:** https://fastapi.tiangolo.com/
- **Electron Docs:** https://www.electronjs.org/docs
- **React Docs:** https://react.dev/
- **Vite Docs:** https://vitejs.dev/

---

## ✅ Quick Reference Commands

```bash
# Start everything (separate terminals)
cd /Users/lakshmidharkotipalli/Desktop/DocMe
export PYTHONPATH=. DOCME_CONFIG_PATH="$HOME/Library/Application Support/DocMe/docme.yaml"
python3 -m uvicorn backend.api.main:app --port 8000 --reload  # Terminal 1
python3 agent/main.py                                          # Terminal 2
cd frontend && npm run dev                                     # Terminal 3

# Quick tests
curl http://127.0.0.1:8000/health
curl "http://127.0.0.1:8000/events?date=$(date +%Y-%m-%d)"
ps aux | grep -E "(uvicorn|agent)" | grep -v grep

# Reset
pkill -f "uvicorn|agent/main.py"
rm ~/Library/Application\ Support/DocMe/docme.sqlite*

# Build
cd frontend && npm run build && npm run electron:build
```

---

**Last Updated:** February 5, 2026
**Version:** 1.1.0
