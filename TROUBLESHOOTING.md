# Troubleshooting

## No Logs Appearing in Activity Tab ⚠️

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

## Missing Python Dependency

**Error:** `ModuleNotFoundError: No module named 'slowapi'`

**Fix:**
```bash
pip3 install slowapi==0.1.9
```

## Blank Page or No Data

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

## Port 8000 Already in Use

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

## LLM Toggle Not Working

**First Time Setup:**
- Ensure internet connectivity (for model download)
- Wait 30-60 seconds for download to complete
- Check `~/Library/Application Support/DocMe/llm/` for cached models

**Manual Installation:**
- Download a GGUF model file
- Place in `llm/` directory in project root (for dev)
- Or `~/Library/Application Support/DocMe/llm/` (for packaged app)

## Backend Services Not Starting

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

## Data Directory Issues

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
