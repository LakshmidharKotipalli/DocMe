from fastapi import FastAPI, HTTPException, Query, Body, WebSocket, WebSocketDisconnect
import json
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import yaml
import os
from datetime import datetime
from agent.store.models import init_db, Event, Session as DbSession, Report
from backend.session_builder.builder import SessionBuilder
from backend.report_generator.generator import ReportGenerator

app = FastAPI(title="DocMe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load config
CONFIG_PATH = "config/docme.yaml"
with open(CONFIG_PATH, 'r') as f:
    config = yaml.safe_load(f)

DB_PATH = config.get('db_path', 'data/docme.sqlite')
SessionLocal = init_db(DB_PATH)

builder = SessionBuilder(SessionLocal)
reporter = ReportGenerator(SessionLocal)

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
