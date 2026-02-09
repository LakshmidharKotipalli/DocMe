from fastapi import FastAPI, HTTPException, Query, Body, WebSocket, WebSocketDisconnect, Request, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import APIKeyHeader
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sys
import json
from typing import List, Optional
import yaml
import os
import secrets
import hashlib
from datetime import datetime, timedelta
from agent.store.models import init_db, Event, Session as DbSession, Report, SystemLog
from backend.session_builder.builder import SessionBuilder
from backend.report_generator.generator import ReportGenerator
from loguru import logger
from pydantic import BaseModel, validator, Field
import re

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="DocMe API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# API Key Security
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
VALID_API_KEYS = set()

def load_api_keys():
    """Load API keys from environment or config"""
    keys = os.environ.get("DOCME_API_KEYS", "")
    if keys:
        VALID_API_KEYS.update(keys.split(","))
    else:
        # Generate a default API key for development
        default_key = secrets.token_urlsafe(32)
        logger.warning(f"Using default API key for development: {default_key}")
        VALID_API_KEYS.add(default_key)

load_api_keys()

async def verify_api_key(api_key: str = Depends(API_KEY_HEADER)):
    """
    Verify API key for authentication.
    For local packaged apps (Electron) and development, API key is optional.
    """
    # If running in packaged mode (local desktop app), skip API key requirement
    if os.environ.get("DOCME_DATA_PATH"):
        return None  # Skip auth for local Electron app

    # In development mode, skip API key requirement
    if os.environ.get("DOCME_ENV", "development") != "production":
        return None

    # For remote/server deployments, require API key
    if api_key in VALID_API_KEYS:
        return api_key
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key"
    )

# Request size limit middleware
MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10MB

@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    """Limit request size to prevent DoS"""
    content_length = request.headers.get("content-length")
    if content_length:
        content_length = int(content_length)
        if content_length > MAX_REQUEST_SIZE:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"detail": "Request entity too large"}
            )
    return await call_next(request)

# Request ID middleware
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Add unique request ID for tracking"""
    request_id = secrets.token_hex(16)
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers"""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    return response

# Restrictive CORS configuration
# For packaged Electron apps, we need to allow "null" origin (file:// protocol)
_allowed_origins_str = os.environ.get("DOCME_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173")
_allowed_origins = _allowed_origins_str.split(",")

# Check if running in packaged mode (DOCME_DATA_PATH is set by Electron)
if os.environ.get("DOCME_DATA_PATH"):
    # Allow all origins for packaged app (Electron file:// sends "null" origin)
    _allowed_origins = ["*"]
    logger.info("Running in packaged mode - allowing all origins for local Electron app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["X-API-Key", "Content-Type"],
)

# Trusted host middleware for production
if os.environ.get("DOCME_ENV", "development") == "production":
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])  # Configure appropriately for production

# Load config
def load_config():
    """
    Load configuration from multiple possible locations.
    Priority: Environment variable > Platform-specific path > Default path
    """
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
            try:
                with open(p, 'r') as f:
                    return yaml.safe_load(f)
            except (IOError, yaml.YAMLError) as e:
                logger.error(f"Failed to load config from {p}: {e}")
    return {"database": {"type": "sqlite"}}

config = load_config()

# Use engine URL from models which handles location
SessionLocal = init_db()

builder = SessionBuilder(SessionLocal)
reporter = ReportGenerator(SessionLocal)

# Setup Database Logger for Backend
def db_sink(message):
    """
    Log messages to database with proper error handling.
    """
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
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to write to database log: {e}")
    finally:
        db.close()

logger.add(db_sink, level="INFO", format="{message}")
logger.info("Backend API started and logging to database enabled")

class ConnectionManager:
    """Manages WebSocket connections with proper cleanup."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        """Broadcast message to all connected clients."""
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Connection might be closed
                continue

manager = ConnectionManager()

# Input validation models
class EventNotifyModel(BaseModel):
    """Model for validating event notifications."""
    source: str = Field(..., min_length=1, max_length=100)
    app: str = Field(..., min_length=1, max_length=200)
    title: str = Field(..., max_length=500)
    note: Optional[str] = Field(None, max_length=5000)

    @validator('source')
    def validate_source(cls, v):
        """Validate source field."""
        allowed_sources = {'window', 'clipboard', 'logic_tracker', 'browser'}
        if v not in allowed_sources:
            raise ValueError(f"Invalid source. Must be one of: {allowed_sources}")
        return v

    @validator('app', 'title')
    def sanitize_strings(cls, v):
        """Sanitize string fields to prevent injection."""
        # Remove any null bytes and control characters
        if v:
            v = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', v)
        return v.strip()

class NoteUpdateModel(BaseModel):
    """Model for validating note updates."""
    note: str = Field(..., max_length=5000)

    @validator('note')
    def sanitize_note(cls, v):
        """Sanitize note content."""
        if v:
            v = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', v)
        return v

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint with rate limiting and validation.
    """
    # Apply rate limiting to WebSocket connections
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"WebSocket connection attempt from {client_ip}")

    await manager.connect(websocket)
    try:
        while True:
            # Receive and validate message
            data = await websocket.receive_text()

            # Validate message size (max 10KB)
            if len(data) > 10240:
                await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG)
                logger.warning(f"Oversized WebSocket message from {client_ip}")
                break

            # Try to parse and validate JSON
            try:
                payload = json.loads(data)
                EventNotifyModel(**payload)  # Validate
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Invalid WebSocket message from {client_ip}: {e}")
                # Keep connection alive but don't broadcast invalid messages
                continue

            # Broadcast valid messages
            await manager.broadcast(data)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected from {client_ip}")
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error from {client_ip}: {e}")
        manager.disconnect(websocket)

@app.post("/events/notify")
@limiter.limit("30/minute")
async def notify_event(request: Request, payload: EventNotifyModel, _: str = Depends(verify_api_key)):
    """
    Notify clients of new events with rate limiting and validation.
    """
    await manager.broadcast(json.dumps(payload.dict()))
    logger.info(f"Event notified: {payload.source} - {payload.app}")
    return {"status": "success"}

@app.get("/health")
@limiter.limit("60/minute")
async def health(request: Request):
    """
    Enhanced health check endpoint with system status.
    """
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # Check database connectivity
        db.execute(text("SELECT 1"))

        return {
            "status": "ok",
            "database": "connected",
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.1.0"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "error", "database": "disconnected", "error": str(e)}
        )
    finally:
        db.close()

def validate_date_string(date_str: str) -> datetime:
    """
    Validate and parse date string with additional safety checks.
    """
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        raise HTTPException(
            status_code=422,
            detail="Invalid date format. Must be YYYY-MM-DD"
        )

    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d")

        # Additional validation: reasonable date range
        min_date = datetime(2000, 1, 1)
        max_date = datetime.now() + timedelta(days=365)

        if parsed_date < min_date or parsed_date > max_date:
            raise HTTPException(
                status_code=422,
                detail="Date out of valid range (2000-01-01 to 1 year from now)"
            )

        return parsed_date
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid date: {e}")

@app.get("/events")
@limiter.limit("100/minute")
async def get_events(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Get events for a specific date with proper date validation.
    """
    db = SessionLocal()
    try:
        date_obj = validate_date_string(date)
        start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        end = date_obj.replace(hour=23, minute=59, second=59, microsecond=999999)

        events = db.query(Event).filter(Event.ts >= start, Event.ts <= end).all()
        return events
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.post("/events/{event_id}/note")
@limiter.limit("30/minute")
async def update_event_note(request: Request, event_id: int, note_data: NoteUpdateModel, _: str = Depends(verify_api_key)):
    """
    Update event note with validation and authentication.
    """
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        event.note = note_data.note
        db.commit()
        logger.info(f"Note updated for event {event_id}")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating note: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.delete("/events/{event_id}")
@limiter.limit("30/minute")
async def delete_event(request: Request, event_id: int, _: str = Depends(verify_api_key)):
    """
    Delete event with authentication and audit logging.
    """
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        db.delete(event)
        db.commit()
        logger.warning(f"Event {event_id} deleted")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting event: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.get("/sessions")
@limiter.limit("100/minute")
async def get_sessions(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Get sessions for a specific date with validation.
    """
    db = SessionLocal()
    try:
        date_obj = validate_date_string(date)
        start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        end = date_obj.replace(hour=23, minute=59, second=59, microsecond=999999)

        sessions = db.query(DbSession).filter(DbSession.start_ts >= start, DbSession.start_ts <= end).all()
        return sessions
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching sessions: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.post("/sessions/build")
@limiter.limit("10/minute")
async def build_sessions(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Build sessions for a specific date.
    """
    try:
        validate_date_string(date)
        builder.build_sessions(date)
        logger.info(f"Sessions built for {date}")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building sessions: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/reports/generate")
@limiter.limit("10/minute")
async def generate_report(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Generate report for a specific date.
    """
    try:
        validate_date_string(date)
        report = reporter.generate_daily_report(date)
        if not report:
            raise HTTPException(status_code=404, detail="No data found for this date or error generating report")
        logger.info(f"Report generated for {date}")
        return {"status": "success", "report_id": report["id"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating report: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/reports")
@limiter.limit("50/minute")
async def get_reports(request: Request, date: Optional[str] = None, _: str = Depends(verify_api_key)):
    """
    Get reports with optional date filtering.
    """
    db = SessionLocal()
    try:
        query = db.query(Report)
        if date:
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
                raise HTTPException(status_code=422, detail="Invalid date format")
            query = query.filter(Report.date == date)
        return query.order_by(Report.created_ts.desc()).all()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching reports: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.get("/reports/latest")
@limiter.limit("30/minute")
async def get_latest_report(request: Request, _: str = Depends(verify_api_key)):
    """
    Get the latest report.
    """
    db = SessionLocal()
    try:
        report = db.query(Report).order_by(Report.created_ts.desc()).first()
        if not report:
            raise HTTPException(status_code=404, detail="No reports found")
        return report
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching latest report: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.post("/events/clear-day")
@limiter.limit("5/minute")
async def clear_day_events(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Clear all events and sessions for a specific date.
    Dangerous operation - requires authentication and rate limiting.
    """
    db = SessionLocal()
    try:
        date_obj = validate_date_string(date)
        start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        end = date_obj.replace(hour=23, minute=59, second=59, microsecond=999999)

        event_count = db.query(Event).filter(Event.ts >= start, Event.ts <= end).count()
        session_count = db.query(DbSession).filter(DbSession.start_ts >= start, DbSession.start_ts <= end).count()

        db.query(Event).filter(Event.ts >= start, Event.ts <= end).delete()
        db.query(DbSession).filter(DbSession.start_ts >= start, DbSession.start_ts <= end).delete()
        db.commit()

        logger.warning(f"Cleared {event_count} events and {session_count} sessions for {date}")
        return {"status": "success", "message": f"Cleared all data for {date}", "events_deleted": event_count, "sessions_deleted": session_count}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error clearing day: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.post("/events/clear")
@limiter.limit("1/hour")
async def clear_events(request: Request, _: str = Depends(verify_api_key)):
    """
    Clear ALL events and sessions.
    EXTREMELY DANGEROUS OPERATION - heavily rate limited.
    """
    db = SessionLocal()
    try:
        event_count = db.query(Event).count()
        session_count = db.query(DbSession).count()

        db.query(Event).delete()
        db.query(DbSession).delete()
        db.commit()

        logger.critical(f"ALL DATA CLEARED: {event_count} events and {session_count} sessions deleted")
        return {"status": "success", "message": "All events and sessions cleared", "events_deleted": event_count, "sessions_deleted": session_count}
    except Exception as e:
        db.rollback()
        logger.error(f"Error clearing all: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.get("/logs")
@limiter.limit("30/minute")
async def get_logs(request: Request, limit: int = Query(100, ge=1, le=1000), _: str = Depends(verify_api_key)):
    """
    Get system logs with pagination.
    """
    db = SessionLocal()
    try:
        logs = db.query(SystemLog).order_by(SystemLog.ts.desc()).limit(limit).all()
        return logs
    except Exception as e:
        logger.error(f"Error fetching logs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()

@app.get("/stats")
@limiter.limit("50/minute")
async def get_stats(request: Request, date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _: str = Depends(verify_api_key)):
    """
    Get activity statistics for a specific date with optimized database queries.
    """
    db = SessionLocal()
    try:
        date_obj = validate_date_string(date)
        start = date_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        end = date_obj.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Use database aggregation for better performance
        from sqlalchemy import func, case

        # Aggregate by activity label
        activity_result = db.query(
            DbSession.activity_label,
            func.sum(DbSession.duration_sec).label('total_duration')
        ).filter(
            DbSession.start_ts >= start,
            DbSession.start_ts <= end
        ).group_by(DbSession.activity_label).all()

        activity_dist = {label or "other": total for label, total in activity_result}

        # Aggregate by app (top 5)
        app_result = db.query(
            DbSession.primary_app,
            func.sum(DbSession.duration_sec).label('total_duration')
        ).filter(
            DbSession.start_ts >= start,
            DbSession.start_ts <= end,
            DbSession.activity_label != 'idle'
        ).group_by(DbSession.primary_app).order_by(
            func.sum(DbSession.duration_sec).desc()
        ).limit(5).all()

        top_apps = {app: total for app, total in app_result}

        # Activity by hour
        hourly_result = db.query(
            func.extract('hour', DbSession.start_ts).label('hour'),
            func.count().label('count')
        ).filter(
            DbSession.start_ts >= start,
            DbSession.start_ts <= end,
            DbSession.activity_label != 'idle'
        ).group_by(func.extract('hour', DbSession.start_ts)).all()

        hourly_activity = [0] * 24
        for hour, count in hourly_result:
            hourly_activity[int(hour)] = count

        return {
            "activity_distribution": activity_dist,
            "top_apps": top_apps,
            "hourly_activity": [{"hour": i, "count": count} for i, count in enumerate(hourly_activity)]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        db.close()
