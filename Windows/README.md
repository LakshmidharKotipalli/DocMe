# DocMe - Personal Activity Tracker

A privacy-first, local activity tracker that runs on macOS. Captures your work activity, generates AI-powered summaries, and helps you document your day.

## ✨ Features

- 🖥️ **Native Desktop App** - Menu bar integration with global shortcuts
- 🔒 **Privacy First** - All data stored locally, never uploaded
- 🤖 **AI-Powered Summaries** - Uses local LLM (Ollama) to summarize your work
- 📝 **Smart Notes** - Add notes to activities, auto-save code change summaries
- 📊 **Daily Reports** - Generate comprehensive daily work reports
- 🔍 **Code Change Tracking** - Automatically detects and summarizes code changes

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (optional, SQLite works too)
- Ollama with gemma3:1b model (for AI features)

### Installation

```bash
# Clone the repository
cd ~/Desktop/DocMe

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start Ollama (for AI features)
ollama run gemma3:1b
```

### Running the App

**Desktop Mode (Recommended):**
```bash
python3 scripts/run_all.py --desktop
```

**Web Mode:**
```bash
python3 scripts/run_all.py
```

## 📁 Project Structure

```
DocMe/
├── agent/              # Background activity tracker
│   ├── main.py        # Agent entry point
│   ├── collectors/    # Data collectors (foreground, browser, code)
│   └── store/         # Database models
│
├── backend/           # API server
│   ├── api/           # FastAPI REST endpoints
│   ├── enrichment/    # Data enrichment & privacy
│   ├── report_generator/  # AI report generation
│   └── session_builder/   # Session aggregation
│
├── frontend/          # Desktop & web UI
│   ├── electron/      # Native macOS app (Electron)
│   └── src/           # React components
│
├── config/            # Configuration files
│   ├── docme.yaml    # Main configuration
│   ├── redact.yaml   # Privacy redaction rules
│   └── rules.yaml    # Activity classification
│
├── scripts/           # Utility scripts
│   ├── run_all.py    # Main launcher
│   ├── migrate_db.py # Database migrations
│   └── reset_docme.py # Reset database
│
├── data/              # Local data storage (gitignored)
│   ├── exports/      # Exported reports
│   └── logs/         # Application logs
│
└── docs/              # Documentation
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+D` | Open DocMe from anywhere |
| `Cmd+Shift+N` | Quick note |
| `Cmd+G` | Generate report |
| `Cmd+E` | Export report |
| `Cmd+1` | View Activity Logs |
| `Cmd+2` | View Daily Report |

## ⚙️ Configuration

Edit `config/docme.yaml` to customize:

```yaml
# Polling intervals
polling_interval_sec: 1.5
idle_threshold_sec: 60.0

# LLM for AI summaries
llm:
  base_url: "http://localhost:11434/v1"
  model: "gemma3:1b"

# Feature toggles
toggles:
  logic_tracker: true  # Code change detection
  auto_reports: false  # Auto-generate reports
```

## 📄 License

MIT License - Use freely for personal productivity.
