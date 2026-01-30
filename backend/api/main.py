from fastapi import FastAPI, HTTPException, Query, Body, WebSocket, WebSocketDisconnect
import sys
import json
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import yaml
import os
from datetime import datetime
from agent.store.models import init_db, Event, Session as DbSession, Report, SystemLog
from backend.session_builder.builder import SessionBuilder
from backend.report_generator.generator import ReportGenerator
from loguru import logger

app = FastAPI(title="DocMe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load config
def load_config():
    search_paths = []
    
    # Check environment variable first (set by Electron)
    env_config = os.environ.get('DOCME_CONFIG_PATH')
    if env_config and os.path.exists(env_config):
        search_paths.append(env_config)
    
    if sys.platform == "darwin":
        search_paths.append(os.path.expanduser("~/Library/Application Support/DocMe/docme.yaml"))
    elif sys.platform == "win32":
        search_paths.append(os.path.join(os.environ.get("APPDATA", ""), "DocMe", "docme.yaml"))
    
    search_paths.append("config/docme.yaml")
    
    for p in search_paths:
        if os.path.exists(p):
            with open(p, 'r') as f:
                return yaml.safe_load(f)
    return {"database": {"type": "sqlite"}}

config = load_config()

# Use engine URL from models which handles location
SessionLocal = init_db()

builder = SessionBuilder(SessionLocal)
reporter = ReportGenerator(SessionLocal)

# Setup Database Logger for Backend
def db_sink(message):
    record = message.record
    db = SessionLocal()
    try:
        log = SystemLog(
            level=record["level"].name,
            message=record["message"],
            module=record["module"],
            ts=record["time"]
        )
        db.add(log)
        db.commit()
    except:
        db.rollback()
    finally:
        db.close()

logger.add(db_sink, level="INFO", format="{message}")
logger.info("Backend API started and logging to database enabled")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Connection might be closed
                continue

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@app.post("/events/notify")
async def notify_event(payload: dict = Body(...)):
    await manager.broadcast(json.dumps(payload))
    return {"status": "success"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/events")
def get_events(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    db = SessionLocal()
    try:
        start = datetime.strptime(date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(hour=23, minute=59, second=59, microsecond=999999)
        events = db.query(Event).filter(Event.ts >= start, Event.ts <= end).all()
        return events
    finally:
        db.close()

@app.post("/events/{event_id}/note")
def update_event_note(event_id: int, note: str = Body(..., embed=True)):
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        event.note = note
        db.commit()
        return {"status": "success"}
    finally:
        db.close()

@app.delete("/events/{event_id}")
def delete_event(event_id: int):
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        db.delete(event)
        db.commit()
        return {"status": "success"}
    finally:
        db.close()
@app.get("/sessions")
def get_sessions(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    db = SessionLocal()
    try:
        start = datetime.strptime(date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(hour=23, minute=59, second=59, microsecond=999999)
        sessions = db.query(DbSession).filter(DbSession.start_ts >= start, DbSession.start_ts <= end).all()
        return sessions
    finally:
        db.close()

@app.post("/sessions/build")
def build_sessions(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    builder.build_sessions(date)
    return {"status": "success"}

@app.post("/reports/generate")
def generate_report(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    report = reporter.generate_daily_report(date)
    if not report:
        raise HTTPException(status_code=404, detail="No data found for this date or error generating report")
    return {"status": "success", "report_id": report["id"]}

@app.get("/reports")
def get_reports(date: Optional[str] = None):
    db = SessionLocal()
    try:
        query = db.query(Report)
        if date:
            query = query.filter(Report.date == date)
        return query.order_by(Report.created_ts.desc()).all()
    finally:
        db.close()

@app.get("/reports/latest")
def get_latest_report():
    db = SessionLocal()
    try:
        report = db.query(Report).order_by(Report.created_ts.desc()).first()
        if not report:
            raise HTTPException(status_code=404, detail="No reports found")
        return report
    finally:
        db.close()
@app.post("/events/clear-day")
def clear_day_events(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    db = SessionLocal()
    try:
        start = datetime.strptime(date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(hour=23, minute=59, second=59, microsecond=999999)
        
        db.query(Event).filter(Event.ts >= start, Event.ts <= end).delete()
        db.query(DbSession).filter(DbSession.start_ts >= start, DbSession.start_ts <= end).delete()
        db.commit()
        return {"status": "success", "message": f"Cleared all data for {date}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.post("/events/clear")
def clear_events():
    db = SessionLocal()
    try:
        db.query(Event).delete()
        db.query(DbSession).delete()
        db.commit()
        return {"status": "success", "message": "All events and sessions cleared"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.get("/logs")
def get_logs(limit: int = 100):
    db = SessionLocal()
    try:
        logs = db.query(SystemLog).order_by(SystemLog.ts.desc()).limit(limit).all()
        return logs
    finally:
        db.close()
