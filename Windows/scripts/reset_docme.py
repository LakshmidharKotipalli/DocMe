import os
import sqlite3
import yaml
import subprocess
import sys
from loguru import logger

def reset_db():
    # 1. Kill any running DocMe processes to release file locks
    logger.info("Stopping any running DocMe processes...")
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/IM", "python.exe", "/T"], capture_output=True)
        else:
            subprocess.run(["pkill", "-f", "uvicorn"], capture_output=True)
            subprocess.run(["pkill", "-f", "agent.main"], capture_output=True)
    except Exception as e:
        logger.warning(f"Process cleanup failed (might already be stopped): {e}")

    # 2. Get DB path from config
    config_path = "config/docme.yaml"
    db_path = "data/docme.sqlite"
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
            db_path = config.get('db_path', db_path)

    # 3. Delete the database and WAL files
    logger.info(f"Checking for database files at {db_path}...")
    files_to_remove = [
        db_path,
        f"{db_path}-journal",
        f"{db_path}-wal",
        f"{db_path}-shm"
    ]

    for f in files_to_remove:
        if os.path.exists(f):
            try:
                os.remove(f)
                logger.success(f"Deleted: {f}")
            except Exception as e:
                logger.error(f"Failed to delete {f}: {e}")
        else:
            logger.debug(f"File not found, skipping: {f}")

    logger.success("DocMe database has been successfully reset. Run 'python3 scripts/run_all.py' to start fresh.")

if __name__ == "__main__":
    confirm = input("This will PERMANENTLY delete all activity logs. Are you sure? (y/N): ")
    if confirm.lower() == 'y':
        reset_db()
    else:
        print("Reset cancelled.")
