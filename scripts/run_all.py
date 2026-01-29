import subprocess
import time
import sys
import os
import yaml
import argparse

def run_all(mode='web'):
    # 0. Load Config to check DB type
    config_path = "config/docme.yaml"
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    db_type = config.get('database', {}).get('type', 'sqlite')

    # 0. Cleanup ports
    if sys.platform != "win32":
        print("Cleaning up ports 8000 and 5173 (LISTEN only)...")
        # Only kill processes that are LISTENING, avoid killing the client app itself
        os.system("lsof -t -iTCP:8000 -sTCP:LISTEN | xargs kill -9 2>/dev/null")
        os.system("lsof -t -iTCP:5173 -sTCP:LISTEN | xargs kill -9 2>/dev/null")
        time.sleep(1)

    # 0.1 Start Postgres if requested
    if db_type == 'postgresql':
        print("Checking PostgreSQL status...")
        # Check if already running (local)
        res = subprocess.run(["pg_isready"], capture_output=True)
        if res.returncode != 0:
            print("PostgreSQL is not running. Attempting to start via Docker...")
            try:
                subprocess.run(["docker-compose", "up", "-d"], check=True)
                print("Waiting for Docker DB to be ready...")
                time.sleep(5)
            except Exception as e:
                print(f"Docker failed: {e}. Trying Homebrew services...")
                subprocess.run(["brew", "services", "start", "postgresql@14"])
                time.sleep(3)
        
        # Ensure database exists
        print("Ensuring 'docme' database exists...")
        subprocess.run(["createdb", "docme"], capture_output=True)

    # 0.2 Run Migrations
    print("Running database migrations...")
    from scripts.migrate_db import migrate
    migrate()

    # 1. Start Backend (FastAPI)
    print(f"Starting Backend (reload={mode == 'web'})...")
    backend_cmd = [sys.executable, "-m", "uvicorn", "backend.api.main:app", "--port", "8000"]
    if mode == 'web':
        backend_cmd.append("--reload")
        
    backend_proc = subprocess.Popen(
        backend_cmd,
        env=os.environ.copy()
    )

    # 2. Start Agent
    print("Starting Agent...")
    agent_proc = subprocess.Popen(
        [sys.executable, "-m", "agent.main"],
        env=os.environ.copy()
    )

    ui_proc = None
    electron_proc = None

    if mode == 'desktop':
        # 3. Start Vite dev server then Electron
        print("Starting Desktop App...")
        
        # Start Vite first
        ui_proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd="frontend",
            env=os.environ.copy()
        )
        
        # Wait for Vite to be ready
        print("Waiting for Vite server...")
        time.sleep(3)
        
        # Start Electron
        electron_proc = subprocess.Popen(
            ["npm", "run", "electron:start"],
            cwd="frontend",
            env=os.environ.copy()
        )
        
        print("\nDocMe Desktop App is running!")
    elif mode == 'web':
        # 3. Start UI (Vite only for web mode)
        print("Starting UI...")
        ui_proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd="frontend",
            env=os.environ.copy()
        )
        
        print("\nDocMe is running!")
        print("- UI: http://localhost:5173")
    print(f"Mode: {db_type.upper()}")
    print("- Backend: http://localhost:8000")
    print("\nPress Ctrl+C to stop all services.")

    try:
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None:
                print("Backend stopped.")
                break
            if agent_proc.poll() is not None:
                print("Agent stopped.")
                break
            if ui_proc and ui_proc.poll() is not None:
                print("UI stopped.")
                break
            if electron_proc and electron_proc.poll() is not None:
                print("Desktop app closed.")
                break
    except KeyboardInterrupt:
        print("\nStopping services...")
    finally:
        backend_proc.terminate()
        agent_proc.terminate()
        if ui_proc:
            ui_proc.terminate()
        if electron_proc:
            electron_proc.terminate()
        if db_type == 'postgresql':
            print("Note: PostgreSQL service/container might still be running in background.")

if __name__ == "__main__":
    # Ensure current directory is in python path
    os.environ["PYTHONPATH"] = os.path.abspath(os.path.dirname(__file__) + "/..")
    # Also insert into sys.path for the current process
    sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + "/.."))
    
    parser = argparse.ArgumentParser(description='Run DocMe')
    parser.add_argument('--desktop', action='store_true', help='Launch as desktop app (Electron)')
    args = parser.parse_args()
    
    mode = 'web'
    if args.desktop: mode = 'desktop'
    
    run_all(mode=mode)
