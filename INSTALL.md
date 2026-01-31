# 🚀 DocMe Installation Guide (macOS)

Welcome to **DocMe**, your privacy-first personal activity tracker. Follow these steps to get up and running with your new release.

---

## 📋 Prerequisites

Before running the application, ensure your system has the following:

1.  **Python 3.11+**: Required for the background activity agent and API.
    - Check with: `python3 --version`
    - [Download Python](https://www.python.org/downloads/)
2.  **Required Python Packages (Legacy/Dev only)**:
    - *Note: As of v1.1.0, these are automatically bundled in the DMG! You only need this if running from source.*
    - If needed: `pip3 install -r requirements.txt`
3.  **llama-server (Optional but Recommended)**:
    - To use the built-in AI summary toggle, you should have `llama-server` installed.
    - If you use Homebrew: `brew install llama.cpp`

---

## 🛠 Step 1: Install the Application

### Method A: Command Line (For Developers)
If you have the source code, you can install the `docme` command globally and use it to set up the app:
1. Open your terminal in the project root.
2. Run: `npm install -g .`
3. Run: `docme install`

### Method B: Manual (Traditional)
1. Open the `DocMe-1.1.0-arm64.dmg` file.
2. Drag the **DocMe** icon into your **Applications** folder.
3. Launch **DocMe** from your Applications or via Spotlight (`Cmd + Space`).

---

## 🔐 Step 2: Grant Permissions (Crucial)

Because DocMe tracks your foreground window to generate summaries, macOS requires special permissions. If these aren't granted, the app will appear blank or show "Unknown" for all activities.

1.  Go to **System Settings > Privacy & Security**.
2.  **Accessibility**: Find "DocMe" in the list and toggle it **ON**.
3.  **Screen Recording**: Ensure "DocMe" is toggled **ON** (this is used to read window titles, no actual video is recorded).

---

## 🤖 Step 3: Setup AI Summaries

Once the app is running in your Menu Bar:

1.  Click the **DocMe icon** in the top menu bar and select **Open Dashboard**.
2.  Click the **Gear Icon (Settings)** in the top right.
3.  **Model Selection**:
    - By default, it uses `ggml-org/gemma-3-1b-it-GGUF`.
    - Turn the **LLM Toggle** to **ON**. 
    - *Note: On first run, it will download the model from Hugging Face (~700MB). This may take a minute.*
4.  Once the toggle is green, your daily reports will be automatically summarized!

---

## ⌨️ Global Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd + Shift + D` | Toggle Dashboard |
| `Cmd + Shift + N` | Quick Note Popup |
| `Cmd + G` | Generate Today's Report |

---

## 🛠 Troubleshooting

- **App is blank?**: Ensure the backend is starting. You can check logs by running the app from the terminal if needed.
- **No data appearing?**: Double-check the **Accessibility** permissions in System Settings.
- **LLM fails to start?**: Ensure you have an active internet connection for the first download, or manually place a `.gguf` file in the `~/Library/Application Support/docme/llm` folder.

---

*DocMe is a local-only tool. Your data never leaves your machine.*
