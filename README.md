# DocMe - Personal Activity Tracker

A privacy-first, local activity tracker designed to run seamlessly on **macOS**. DocMe captures your work activity, generates AI-powered summaries, and helps you document your day without ever sending your data to the cloud.

---

## ✨ Features

- 🖥️ **Native Desktop App** - Tray/Menu bar integration with global shortcuts.
- 🔒 **Privacy First** - All data (logs, notes, reports) is stored locally on your machine.
- 🤖 **AI-Powered Summaries** - Integrated with LLMs (Ollama/OpenAI) to summarize your work and code changes.
- 📝 **Smart Quick Notes** - Non-intrusive popup for capturing thoughts on the fly.
- 📊 **Daily Reports** - Beautifully formatted markdown reports of your day's achievements.
- 🔍 **Code Change Tracking** - Automatically detects and summarizes code diffs across your projects.
- 🌓 **Dynamic UI** - Premium glassmorphism design with auto-switching dashboards.

---

## 🚀 Installation & Setup

### 1. Prerequisites
Before installing, ensure you have the following tools:
- **Node.js**: 18.0 or higher ([Download](https://nodejs.org/))
- **Python**: 3.11 or higher ([Download](https://www.python.org/))
- **Ollama** (Required for AI summaries): [Download Ollama](https://ollama.com/)
  - Once installed, run: `ollama run gemma3:1b` (or your preferred small model)
- **PostgreSQL** (Optional): The app defaults to SQLite, but supports Postgres for better performance.

### 2. Clone and Install
```bash
# Clone the repository
git clone <repository-url>
cd DocMe

# Set up Python environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup
DocMe provides dedicated builds for each platform. Navigate to your platform's directory:

**For macOS:**
```bash
cd macOS/frontend
npm install
cd ../..
```

---

## 🏃 Running the Application

Wait until you have completed the installation steps above.

### Desktop Mode (Recommended)
This launches the native tray application and all background services (Agent & API).

```bash
# Running from the root directory
python3 scripts/run_all.py --desktop
```

### Development/Web Mode
If you only want to run the dashboard in your browser:
```bash
python3 scripts/run_all.py
```

---

## ⚙️ Configuration

### Intelligence (AI) Settings
You can configure your model and API keys directly in the **Settings** menu within the app UI.
- **Local (Ollama)**: Leave API Key empty and set URL to `http://localhost:11434/v1`.
- **Cloud (OpenAI)**: Enter your `sk-...` key and set the model to `gpt-4o` or similar.

### Advanced Settings (`config/docme.yaml`)
You can manually edit the config file for more granular control:
- `polling_interval_sec`: Frequency of activity checks.
- `excluded_apps`: Apps to never track (e.g., Password managers).
- `sensitive_keywords`: Titles that trigger automatic redaction.

---

## 📦 Packaging (Generating Downloadable Files)

To create a standalone installer that you can share or install on other computers:

**For macOS (.dmg):**
```bash
python3 scripts/build_dist.py macOS
```
*Output:* `macOS/frontend/release/DocMe-1.0.0.dmg`

---

## ⌨️ Keyboard Shortcuts (Default)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + D` | Open/Hide Dashboard |
| `Cmd/Ctrl + Shift + N` | Trigger Quick Note Popup |
| `Cmd/Ctrl + G` | Generate Today's Report |
| `Cmd/Ctrl + E` | Export Data |

---

## 🛠 Troubleshooting

- **macOS Permissions**: If you see "Could not retrieve foreground window," ensure you have granted **Accessibility** and **Screen Recording** permissions to the terminal/app in `System Settings > Privacy & Security`.
- **Port Conflict**: If the app fails to start, ensure port `8000` (Backend) and `5173` (Frontend) are not being used by other apps.

---

## 📄 License
MIT License - Developed with ❤️ for productivity.
