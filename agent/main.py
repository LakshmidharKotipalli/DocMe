import os
import sys
import time
import yaml
import json
import threading
import requests
from loguru import logger
from datetime import datetime

from agent.collectors.base import get_foreground_window, get_idle_time
from agent.store.models import init_db, Event, SystemLog
from agent.collectors.fswatch.watcher import FileWatcher
from agent.collectors.logic_tracker import LogicTracker
import sys

if sys.platform == "darwin":
    from agent.collectors.browser.macos import is_browser as is_browser_macos, get_browser_url_macos
elif sys.platform == "win32":
    from agent.collectors.browser.windows import is_browser_windows, get_browser_url_windows

class DocMeAgent:
    def __init__(self, config_path=None):
        # Search for config in multiple locations
        search_paths = []
        if config_path:
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
        self.config_path = config_path # Store intended path
        
        for p in search_paths:
            if os.path.exists(p):
                with open(p, 'r') as f:
                    self.config = yaml.safe_load(f)
                    self.config_path = p # Store discovered path
                    break
        
        if not self.config:
            # Fallback or default values if no config found
            self.config = {"database": {"type": "sqlite"}}
            if not self.config_path:
                self.config_path = "config/docme.yaml"
        
        self.db_path = self.config.get('db_path', 'data/docme.sqlite')
        self.SessionLocal = init_db(self.db_path)
        
        self.polling_interval = self.config.get('polling_interval_sec', 1.5)
        self.heartbeat_interval = self.config.get('heartbeat_interval_sec', 60.0)
        self.idle_threshold = self.config.get('idle_threshold_sec', 180.0)
        self.excluded_apps = self.config.get('excluded_apps', [])
        self.sensitive_keywords = self.config.get('sensitive_keywords', [])
        
        # Periodic report generation (default: every 30 minutes)
        self.auto_report_interval = self.config.get('auto_report_interval_min', 30) * 60
        self.auto_report_enabled = self.config.get('toggles', {}).get('auto_reports', True)
        self.last_auto_report = time.time()
        
        self.last_app = None
        self.last_title = None
        self.last_url = None
        self.last_idle_state = False
        self.last_heartbeat = time.time()
        
        # Initialize FileWatcher
        self.fswatcher = FileWatcher(self.config_path, self.record_event)
        
        # Initialize LogicTracker
        self.logic_interval = self.config.get('logic_tracking_interval_sec', 30)
        watched_dirs = self.config.get('watched_directories', [os.getcwd()])
        # Expand ~ in watched directories
        watched_dirs = [os.path.expanduser(d) for d in watched_dirs]
        self.logic_tracker = LogicTracker(self.logic_interval, self.record_event, watch_dirs=watched_dirs, config_path=self.config_path)

        # Log startup info
        logger.info(f"Config loaded from: {self.config_path}")
        logger.info(f"Watching directories: {watched_dirs}")

        # Setup Database Logger
        self._setup_db_logger()

    def _setup_db_logger(self):
        def db_sink(message):
            record = message.record
            session = self.SessionLocal()
            try:
                log = SystemLog(
                    level=record["level"].name,
                    message=record["message"],
                    module=record["module"],
                    ts=record["time"]
                )
                session.add(log)
                session.commit()
            except:
                session.rollback()
            finally:
                session.close()

        logger.add(db_sink, level="INFO", format="{message}")

    def is_idle(self):
        return get_idle_time() > self.idle_threshold

    def generate_periodic_report(self):
        """Generate a report in a background thread."""
        try:
            date = datetime.now().strftime("%Y-%m-%d")
            response = requests.post(f"http://localhost:8000/reports/generate?date={date}", timeout=60)
            if response.ok:
                logger.info(f"Auto-generated report for {date}")
            else:
                logger.warning(f"Auto-report generation failed: {response.status_code}")
        except Exception as e:
            logger.debug(f"Auto-report error: {e}")


    def record_event(self, source, app, title, payload=None, note=None):
        # Check system idle state first
        idle_time = get_idle_time()
        if idle_time > self.idle_threshold:
            # We don't log anything (foreground, fswatch, logic_tracker) if idle
            logger.debug(f"Skipping {source} event: System is idle ({idle_time:.1f}s)")
            return

        session = self.SessionLocal()
        try:
            event = Event(
                source=source,
                app=app,
                window_title=title,
                payload_json=json.dumps(payload) if payload else None,
                note=note,  # Auto-save note if provided (e.g., AI summary)
                ts=datetime.now()
            )
            session.add(event)
            session.commit()
            
            # Notify backend for real-time popup
            try:
                requests.post("http://localhost:8000/events/notify", json={
                    "type": "new_event",
                    "id": event.id,
                    "app": event.app,
                    "window_title": event.window_title,
                    "source": event.source
                }, timeout=2)
            except Exception as e:
                logger.debug(f"Failed to notify backend: {e}")

            if note:
                logger.info(f"Recorded event with note: {source} | {app} | {title}")
            else:
                logger.info(f"Recorded event: {source} | {app} | {title}")
            print(f"[DocMe] Logged: {app} | {title}")
        except Exception as e:
            logger.error(f"Failed to record event: {e}")
            session.rollback()
        finally:
            session.close()

    def run(self):
        logger.info("DocMe Agent started...")
        self.fswatcher.start()
        
        if self.config.get('toggles', {}).get('logic_tracker', True):
            self.logic_tracker.start()
            
        try:
            while True:
                current_idle = self.is_idle()
                app, title, pid = get_foreground_window()
                
                if not app or not title:
                    logger.warning(f"Could not retrieve foreground window info. App: {app}, Title: {title}. Check macOS permissions.")
                
                # Trusted apps that should never be redacted (terminal apps, code editors, etc.)
                trusted_apps = ["terminal", "iterm", "iterm2", "warp", "hyper", "alacritty", 
                                "kitty", "code", "cursor", "visual studio code", "sublime", 
                                "pycharm", "intellij", "webstorm", "vim", "neovim", "emacs"]
                
                app_lower = app.lower() if app else ""
                is_trusted = any(trusted in app_lower for trusted in trusted_apps)
                
                # Redact excluded apps and sensitive keywords (but NOT for trusted apps)
                is_sensitive = (app in self.excluded_apps or 
                                (not is_trusted and any(kw.lower() in title.lower() for kw in self.sensitive_keywords)))
                
                if is_sensitive:
                    title = "[REDACTED]"
                    app = "[SENSITIVE]"
                
                url = None
                payload = None
                source = "foreground_window"
                if not current_idle:
                    if sys.platform == "darwin" and is_browser_macos(app):
                        source = "browser"
                        url = get_browser_url_macos(app)
                        if url: payload = {"url": url}
                    elif sys.platform == "win32" and is_browser_windows(app):
                        source = "browser"
                        url = get_browser_url_windows(app)
                        if url: payload = {"url": url}
                elif current_idle:
                    source = "idle"

                now = time.time()
                is_heartbeat = (now - self.last_heartbeat) >= self.heartbeat_interval

                changed = (app != self.last_app or 
                           title != self.last_title or 
                           url != self.last_url or
                           current_idle != self.last_idle_state)

                if changed or is_heartbeat:
                    if source != "idle":
                        self.record_event(source, app, title, payload=payload)
                        if not (is_heartbeat and not changed):
                            print(f"[Event] {app} | {title}")
                    else:
                        logger.debug("System is idle; skipping log as per user preference.")
                    
                    self.last_app = app
                    self.last_title = title
                    self.last_url = url
                    self.last_idle_state = current_idle
                    self.last_heartbeat = now
                
                # Check for periodic auto-report generation
                if self.auto_report_enabled and (now - self.last_auto_report) >= self.auto_report_interval:
                    self.last_auto_report = now
                    logger.info(f"Triggering auto-report generation (every {self.auto_report_interval // 60} min)...")
                    threading.Thread(target=self.generate_periodic_report, daemon=True).start()
                
                time.sleep(self.polling_interval)
        except KeyboardInterrupt:
            logger.info("DocMe Agent stopping...")
        finally:
            self.fswatcher.stop()
            self.logic_tracker.stop()

if __name__ == "__main__":
    agent = DocMeAgent()
    agent.run()
