from sqlalchemy import Column, Integer, String, Text, Float, DateTime, create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import os
import yaml
import sys

Base = declarative_base()

class Event(Base):
    __tablename__ = 'events'
    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime, default=lambda: datetime.datetime.now(), nullable=False)
    source = Column(String(50), nullable=False) # foreground_window|idle|fswatch|terminal|browser
    app = Column(String(255))
    window_title = Column(Text)
    payload_json = Column(Text) # JSON string for extra fields
    note = Column(Text)

class Session(Base):
    __tablename__ = 'sessions'
    id = Column(Integer, primary_key=True, autoincrement=True)
    start_ts = Column(DateTime, nullable=False)
    end_ts = Column(DateTime, nullable=False)
    duration_sec = Column(Integer, nullable=False)
    primary_app = Column(String(255))
    window_title = Column(Text)
    context_signature = Column(String(64)) # hash(app + title + repo)
    activity_label = Column(String(50)) # coding|browsing|terminal|idle|other
    project = Column(String(255))
    tags_json = Column(Text) # JSON array
    summary_hint = Column(Text)

class Report(Base):
    __tablename__ = 'reports'
    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), nullable=False) # YYYY-MM-DD
    created_ts = Column(DateTime, default=lambda: datetime.datetime.now())
    report_md = Column(Text, nullable=False)
    metrics_json = Column(Text)

class Artifact(Base):
    __tablename__ = 'artifacts'
    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime, default=lambda: datetime.datetime.now())
    kind = Column(String(50)) # file|git|command|link
    ref = Column(Text)
    meta_json = Column(Text)

class SystemLog(Base):
    __tablename__ = 'system_logs'
    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime, default=lambda: datetime.datetime.now())
    level = Column(String(20)) # INFO|ERROR|WARNING|DEBUG
    message = Column(Text)
    module = Column(String(100))

def get_engine_url(config_path=None):
    # Default config paths to check
    search_paths = []
    if config_path:
        search_paths.append(config_path)
    
    # Check environment variable first (set by Electron)
    env_config = os.environ.get('DOCME_CONFIG_PATH')
    if env_config and os.path.exists(env_config):
        search_paths.insert(0, env_config)
    
    # Check standard locations
    if sys.platform == "darwin":
        search_paths.append(os.path.expanduser("~/Library/Application Support/DocMe/docme.yaml"))
    elif sys.platform == "win32":
        search_paths.append(os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.yaml"))
    
    search_paths.append("config/docme.yaml")
    
    config = {}
    used_config_path = None
    for p in search_paths:
        if os.path.exists(p):
            try:
                with open(p, 'r') as f:
                    config = yaml.safe_load(f)
                    used_config_path = p
                    break
            except:
                continue

    try:
        db_config = config.get('database', {})
        if db_config.get('type') == 'postgresql':
            pg = db_config.get('postgres', {})
            return f"postgresql://{pg['user']}:{pg['password']}@{pg['host']}:{pg['port']}/{pg['dbname']}"
        
        # Default to SQLite with proper default paths for each platform
        env_data_path = os.environ.get('DOCME_DATA_PATH')
        if env_data_path:
            default_sqlite = os.path.join(env_data_path, "docme.sqlite")
        elif sys.platform == "darwin":
            default_sqlite = os.path.expanduser("~/Library/Application Support/DocMe/docme.sqlite")
        elif sys.platform == "win32":
            default_sqlite = os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.sqlite")
        else:
            default_sqlite = os.path.expanduser("~/.docme/docme.sqlite")
            
        sqlite_path = db_config.get('sqlite_path') or config.get('db_path') or default_sqlite
        
        # If path is still empty/relative, use default
        if not sqlite_path or sqlite_path == "data/docme.sqlite":
            sqlite_path = default_sqlite
        
        # Expand ~ if present in path
        sqlite_path = os.path.expanduser(sqlite_path)
        
        # Ensure parent directory exists
        parent_dir = os.path.dirname(sqlite_path)
        if parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)
        
        return f'sqlite:///{sqlite_path}'
    except Exception as e:
        # Fallback to user home directory
        fallback_path = os.path.expanduser("~/.docme/docme.sqlite")
        os.makedirs(os.path.dirname(fallback_path), exist_ok=True)
        return f'sqlite:///{fallback_path}'

def init_db(db_path_unused=None):
    url = get_engine_url()
    
    if url.startswith('sqlite'):
        # SQLite-specific optimization for multi-process access (Backend + Agent)
        engine = create_engine(url, connect_args={
            'timeout': 60, # Increase timeout to avoid 'database is locked' errors
            'check_same_thread': False
        })
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL") # Better concurrency
            cursor.execute("PRAGMA synchronous=NORMAL") # Faster writes
            cursor.execute("PRAGMA busy_timeout=60000") # Wait up to 60s for lock
            cursor.close()
    else:
        # Postgres or other
        engine = create_engine(url)

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)
