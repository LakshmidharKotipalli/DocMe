import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import os
import hashlib
from loguru import logger
import json
from datetime import datetime
from agent.store.models import init_db, Event

class DocMeFileEventHandler(FileSystemEventHandler):
    def __init__(self, record_callback):
        self.record_callback = record_callback
        self.ignore_patterns = [
            "/data/", 
            ".sqlite", 
            ".sqlite-journal",
            ".sqlite-wal",
            ".sqlite-shm",
            ".db",
            "__pycache__", 
            ".git/",
            "node_modules/",
            ".vite/",
            ".venv/",
            ".DS_Store"
        ]
        self.content_hashes = {}

    def _is_ignored(self, path):
        return any(pattern in path for pattern in self.ignore_patterns)
    def _get_hash(self, path):
        try:
            if not os.path.exists(path) or os.path.isdir(path):
                return None
            # Skip very large files (max 1MB) to avoid memory spikes
            if os.path.getsize(path) > 1 * 1024 * 1024:
                return f"large_file_{os.path.getmtime(path)}"
            with open(path, "rb") as f:
                return hashlib.md5(f.read()).hexdigest()
        except:
            return None

    def on_modified(self, event):
        if not event.is_directory and not self._is_ignored(event.src_path):
            current_hash = self._get_hash(event.src_path)
            if current_hash:
                # If we haven't seen this file yet, record its state and wait for a real change
                if event.src_path not in self.content_hashes:
                    self.content_hashes[event.src_path] = current_hash
                    return
                
                last_hash = self.content_hashes.get(event.src_path)
                if current_hash != last_hash:
                    self.record_callback("fswatch", "File System", f"Modified: {os.path.basename(event.src_path)}", {"path": event.src_path, "action": "modified"})
                    self.content_hashes[event.src_path] = current_hash

    def on_created(self, event):
        if not event.is_directory and not self._is_ignored(event.src_path):
            current_hash = self._get_hash(event.src_path)
            if current_hash:
                self.content_hashes[event.src_path] = current_hash
            self.record_callback("fswatch", "File System", f"Created: {os.path.basename(event.src_path)}", {"path": event.src_path, "action": "created"})

class FileWatcher:
    def __init__(self, config_path=None, record_callback=None):
        import yaml
        import sys
        
        # Find config file using same logic as other components
        search_paths = []
        if config_path and os.path.exists(config_path):
            search_paths.append(config_path)
        
        # Check environment variable first (set by Electron)
        env_config = os.environ.get('DOCME_CONFIG_PATH')
        if env_config and os.path.exists(env_config):
            search_paths.insert(0, env_config)
        
        if sys.platform == "darwin":
            search_paths.append(os.path.expanduser("~/Library/Application Support/DocMe/docme.yaml"))
        elif sys.platform == "win32":
            search_paths.append(os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.yaml"))
        
        search_paths.append("config/docme.yaml")
        
        self.config = {}
        for p in search_paths:
            if os.path.exists(p):
                try:
                    with open(p, 'r') as f:
                        self.config = yaml.safe_load(f)
                        logger.info(f"FileWatcher loaded config from: {p}")
                        break
                except Exception as e:
                    logger.warning(f"Failed to load config from {p}: {e}")
        
        self.directories = self.config.get('watched_directories', [])
        self.record_callback = record_callback
        self.observer = Observer()

    def start(self):
        if not self.config.get('toggles', {}).get('fswatch', False):
            logger.info("fswatch is disabled in config.")
            return

        handler = DocMeFileEventHandler(self.record_callback)
        for directory in self.directories:
            full_path = os.path.expanduser(directory)
            if os.path.exists(full_path):
                logger.info(f"Watching directory: {full_path}")
                self.observer.schedule(handler, full_path, recursive=True)
            else:
                logger.warning(f"Watched directory does not exist: {full_path}")
        
        self.observer.start()

    def stop(self):
        self.observer.stop()
        self.observer.join()
