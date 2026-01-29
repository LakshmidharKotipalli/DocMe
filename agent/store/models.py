from sqlalchemy import Column, Integer, String, Text, Float, DateTime, create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import os
import yaml

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

def get_engine_url(config_path="config/docme.yaml"):
    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        db_config = config.get('database', {})
        if db_config.get('type') == 'postgresql':
            pg = db_config.get('postgres', {})
            return f"postgresql://{pg['user']}:{pg['password']}@{pg['host']}:{pg['port']}/{pg['dbname']}"
        
        # Default to SQLite
        sqlite_path = db_config.get('sqlite_path', config.get('db_path', 'data/docme.sqlite'))
        os.makedirs(os.path.dirname(sqlite_path), exist_ok=True)
        return f'sqlite:///{sqlite_path}'
    except:
        return 'sqlite:///data/docme.sqlite'

def init_db(db_path_unused=None):
    url = get_engine_url()
    
    if url.startswith('sqlite'):
        engine = create_engine(url, connect_args={'timeout': 30, 'check_same_thread': False})
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
    else:
        # Postgres or other
        engine = create_engine(url)

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)
