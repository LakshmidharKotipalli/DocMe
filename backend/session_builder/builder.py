import hashlib
import json
from datetime import datetime, timedelta
from typing import List, Optional
from loguru import logger
from agent.store.models import Event, Session as DbSession
from sqlalchemy import asc
from backend.enrichment.enricher import Enricher

class SessionBuilder:
    def __init__(self, db_session_factory):
        self.SessionLocal = db_session_factory
        self.enricher = Enricher()

    def generate_context_signature(self, app, title, project=""):
        """
        Generate a hash signature for grouping similar contexts.
        SHA-256 is appropriate for non-security use cases like context grouping.
        """
        sig_str = f"{app}|{title}|{project}"
        return hashlib.sha256(sig_str.encode()).hexdigest()

    def get_activity_label(self, app):
        """
        Classify application type based on app name.
        """
        app = app.lower() if app else ""
        if any(x in app for x in ["code", "cursor", "vsc", "intellij", "pycharm", "sublime"]):
            return "coding"
        if any(x in app for x in ["terminal", "iterm", "zsh", "bash", "warp"]):
            return "terminal"
        if any(x in app for x in ["chrome", "safari", "firefox", "edge", "arc"]):
            return "browsing"
        if "slack" in app or "discord" in app or "teams" in app:
            return "communication"
        return "other"

    def build_sessions(self, date_str: str):
        """
        Processes events for a specific date and creates/updates sessions.
        """
        db_session = self.SessionLocal()
        try:
            # Get events for the date
            start_of_day = datetime.strptime(date_str, "%Y-%m-%d")
            end_of_day = start_of_day + timedelta(days=1)

            events = db_session.query(Event).filter(
                Event.ts >= start_of_day,
                Event.ts < end_of_day
            ).order_by(asc(Event.ts)).all()

            if not events:
                return

            current_session = None

            for event in events:
                app = event.app or "Unknown"
                title = event.window_title or "No Title"
                source = event.source

                if source == "idle":
                    app = "Idle"
                    title = "System Idle"
                    activity_label = "idle"
                    project = "Unknown"
                    tags = []
                else:
                    activity_label = self.get_activity_label(app)
                    project, tags = self.enricher.infer_project_and_tags(app, title)

                # Extract hint (e.g. URL from browser events)
                summary_hint = None
                if event.payload_json:
                    try:
                        payload = json.loads(event.payload_json)
                        if "url" in payload:
                            summary_hint = payload["url"]
                        elif "diff_summary" in payload:
                            summary_hint = payload["diff_summary"]
                    except json.JSONDecodeError:
                        logger.debug(f"Failed to parse payload for event {event.id}")
                    except Exception as e:
                        logger.debug(f"Error processing payload: {e}")

                sig = self.generate_context_signature(app, title, project)

                if current_session is None:
                    # Start first session
                    current_session = DbSession(
                        start_ts=event.ts,
                        end_ts=event.ts,
                        duration_sec=0,
                        primary_app=app,
                        window_title=title,
                        context_signature=sig,
                        activity_label=activity_label,
                        project=project,
                        tags_json=json.dumps(tags),
                        summary_hint=summary_hint
                    )
                elif current_session.context_signature == sig:
                    # Extend current session
                    current_session.end_ts = event.ts
                    current_session.duration_sec = int((current_session.end_ts - current_session.start_ts).total_seconds())
                    # Upate hint if new one found
                    if summary_hint and not current_session.summary_hint:
                        current_session.summary_hint = summary_hint
                else:
                    # Different context, save current and start new
                    db_session.add(current_session)

                    # Start new session
                    current_session = DbSession(
                        start_ts=event.ts,
                        end_ts=event.ts,
                        duration_sec=0,
                        primary_app=app,
                        window_title=title,
                        context_signature=sig,
                        activity_label=activity_label,
                        project=project,
                        tags_json=json.dumps(tags),
                        summary_hint=summary_hint
                    )

            if current_session:
                db_session.add(current_session)

            db_session.commit()

            # Post-processing: merge tiny sessions and enrich
            self.post_process_sessions(db_session, start_of_day, end_of_day)

        except ValueError as e:
            logger.error(f"Invalid date format for session building: {e}")
            db_session.rollback()
        except Exception as e:
            logger.error(f"Error building sessions: {e}")
            db_session.rollback()
        finally:
            db_session.close()

    def post_process_sessions(self, db_session, start_dt, end_dt):
        """
        Post-process sessions to merge tiny sessions and apply enrichment.
        """
        sessions = db_session.query(DbSession).filter(
            DbSession.start_ts >= start_dt,
            DbSession.start_ts < end_dt
        ).order_by(asc(DbSession.start_ts)).all()

        # Merge logic (simplified: merge sessions < 20s if they are between same apps)
        # For MVP, we'll just keep them but it's a good place for refinement.
        pass
