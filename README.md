# DocMe

<div align="center">

<img src="frontend/public/icon.png" alt="DocMe Logo" width="120"/>

**A privacy-first activity tracker for macOS with on-device AI summaries.**

[Download](https://github.com/LakshmidharKotipalli/DocMe/releases/latest) • [Installation Guide](INSTALL.md) • [Troubleshooting](TROUBLESHOOTING.md) • [Changelog](CHANGELOG.md)

</div>

## Features

- **Native macOS app** with menu bar integration and a floating dashboard
- **100% local:** all data stays in SQLite on your machine
- **AI daily summaries** from a built-in llama.cpp server that downloads GGUF models from Hugging Face
- **Quick notes** popup that captures thoughts without breaking flow
- **Code change tracking** that detects and summarizes file edits
- **Privacy filters** to exclude apps and sensitive keywords
- **Zero configuration:** works out of the box

## Quick start

**Pre-built app:** download the latest `.dmg` from [Releases](https://github.com/LakshmidharKotipalli/DocMe/releases/latest),
drag DocMe to Applications, and grant permissions per the [Installation Guide](INSTALL.md).

**From source** (macOS 11+, Node.js 18+, Python 3.11+):

```bash
git clone https://github.com/LakshmidharKotipalli/DocMe.git && cd DocMe
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
(cd frontend && npm install)

python3 scripts/run_all.py --desktop   # native app
python3 scripts/run_all.py             # web dashboard at http://localhost:5173
```

## Configuration

Turn on AI summaries from **Settings** in the app; the first toggle downloads the model (~700 MB). Any GGUF
repo (for example `ggml-org/gemma-3-1b-it-GGUF`) or a local GGUF file in `llm/` works.

For finer control, edit `config/docme.yaml`:

```yaml
polling_interval_sec: 1.5
idle_threshold_sec: 300
excluded_apps: ["Keychain Access", "1Password"]
sensitive_keywords: ["password", "bank"]
llm:
  model: "ggml-org/gemma-3-1b-it-GGUF"
  base_url: "http://localhost:8080/v1"
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+D` | Toggle dashboard |
| `Cmd+Shift+N` | Quick note |
| `Cmd+G` | Generate today's report |
| `Cmd+E` | Export data |

## Development

```bash
python3 scripts/run_all.py                    # backend + agent
cd frontend && npm run dev                    # frontend dev server
npm run electron:dev                          # Electron against the dev server
python3 scripts/build_dist.py                 # build the macOS DMG into frontend/release/
python3 scripts/migrate_db.py                 # migrate schema (reset_docme.py wipes all data)
```

```
agent/      Background activity tracker
backend/    FastAPI server and processing
frontend/   React + Electron UI
config/     Configuration
scripts/    Build and utility scripts
llm/        Local models
```

Built with Electron, React, FastAPI and [llama.cpp](https://github.com/ggml-org/llama.cpp).
