import json
import yaml
import os
from datetime import datetime, timedelta
from agent.store.models import Session as DbSession, Report, Event
from sqlalchemy import func
from backend.enrichment.enricher import Enricher
from openai import OpenAI

class ReportGenerator:
    def __init__(self, db_session_factory):
        self.SessionLocal = db_session_factory
        self.enricher = Enricher()
        
        # Load config
        try:
            with open("config/docme.yaml", 'r') as f:
                self.config = yaml.safe_load(f)
        except:
            self.config = {}

    def _generate_llm_summary(self, date_str, metrics, notes_text, activity_log):
        # Reload config to get latest settings from UI
        try:
            with open("config/docme.yaml", 'r') as f:
                self.config = yaml.safe_load(f)
        except:
            pass

        llm_config = self.config.get('llm', {})
        if not llm_config or not llm_config.get('base_url'):
            return None
            
        try:
            client = OpenAI(
                api_key=llm_config.get('api_key') or "dummy",
                base_url=llm_config.get('base_url')
            )
            
            # Format app breakdown better
            apps = sorted(metrics['app_breakdown'].items(), key=lambda x: x[1], reverse=True)[:5]
            apps_str = ", ".join([f"{a[0]} ({a[1]} events)" for a in apps])
            
            prompt = f"""You are a productivity AI assistant. Summarize the user's saved NOTES from their activity logs.

Date: {date_str}

USER NOTES WITH CONTEXT (Each note includes what the user was doing when they saved it):
{notes_text if notes_text else "No notes were saved today."}

INSTRUCTIONS:
1. Summarize what the user accomplished based on their notes and the context of what they were working on.
2. If no notes exist, respond: "No notes were recorded today."
3. Write in first person as if you are the user recapping their day.
4. Keep it brief (3-4 sentences max).
5. Mention the key tasks and what apps/projects they relate to.
"""
            
            response = client.chat.completions.create(
                model=llm_config.get('model', 'gemma3:1b'),
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"LLM generation failed: {e}")
            return None

    def generate_daily_report(self, date_str: str):
        db_session = self.SessionLocal()
        try:
            start_of_day = datetime.strptime(date_str, "%Y-%m-%d")
            end_of_day = start_of_day + timedelta(days=1)
            
            # Try sessions first
            sessions = db_session.query(DbSession).filter(
                DbSession.start_ts >= start_of_day,
                DbSession.start_ts < end_of_day
            ).all()

            # Always fetch events (for notes and fallback)
            events = db_session.query(Event).filter(
                Event.ts >= start_of_day,
                Event.ts < end_of_day
            ).order_by(Event.ts).all()

            # If no sessions AND no events, return None
            if not sessions and not events:
                return None

            # Build metrics from sessions if available, otherwise from events
            if sessions:
                total_sec = sum(s.duration_sec for s in sessions)
                active_sec = sum(s.duration_sec for s in sessions if s.activity_label != 'idle')
                idle_sec = total_sec - active_sec
                
                app_metrics = {}
                for s in sessions:
                    app_metrics[s.primary_app] = app_metrics.get(s.primary_app, 0) + s.duration_sec
                
                project_metrics = {}
                for s in sessions:
                    project_metrics[s.project] = project_metrics.get(s.project, 0) + s.duration_sec
            else:
                # Fallback: Use events directly (count-based instead of time-based)
                app_metrics = {}
                for e in events:
                    app_metrics[e.app] = app_metrics.get(e.app, 0) + 1
                
                project_metrics = {}
                active_sec = len(events) * 60  # Rough estimate: 1 min per event
                idle_sec = 0
                total_sec = active_sec

            # Fetch Events with Notes
            events_with_notes = [e for e in events if e.note]
            
            # Format notes with full context (time, app, window title, and note)
            notes_text = ""
            if events_with_notes:
                notes_lines = []
                for e in events_with_notes:
                    context = f"[{e.ts.strftime('%H:%M')}] App: {e.app}"
                    if e.window_title:
                        context += f" | Working on: {e.window_title}"
                    context += f"\n   Note: {e.note}"
                    notes_lines.append(context)
                notes_text = "\n\n".join(notes_lines)

            # Build activity log for LLM context
            activity_log = "\n".join([
                f"[{e.ts.strftime('%H:%M')}] {e.app}: {e.window_title or 'unknown'}" 
                for e in events[-30:]  # Last 30 events
            ])

            metrics = {
                "total_active_sec": active_sec,
                "total_idle_sec": idle_sec,
                "total_events": len(events),
                "app_breakdown": app_metrics,
                "project_breakdown": project_metrics
            }

            # Generate LLM Summary if available
            llm_narrative = self._generate_llm_summary(date_str, metrics, notes_text, activity_log)

            # Build Markdown
            md = f"# DocMe Daily Report — {date_str}\n\n"
            
            if llm_narrative:
                md += "## 🤖 AI Executive Summary\n"
                md += f"{llm_narrative}\n\n"
            
            md += "## Overview\n"
            md += f"- **Total Events:** {len(events)}\n"
            if sessions:
                md += f"- **Total Active Time:** {self._format_duration(active_sec)}\n"
                md += f"- **Context Switches:** {len(sessions)}\n"
            if events_with_notes:
                md += f"- **Logged Notes:** {len(events_with_notes)}\n"
            md += "\n"
            
            if events_with_notes:
                md += "## 📝 Your Notes & Annotations\n"
                md += "These are the notes you saved throughout the day:\n\n"
                for e in events_with_notes:
                    md += f"### {e.ts.strftime('%H:%M')} - {e.app}\n"
                    md += f"> {e.note}\n\n"
                md += "\n"

            md += "## ⏱️ Time by App\n"
            sorted_apps = sorted(app_metrics.items(), key=lambda x: x[1], reverse=True)
            for app, count in sorted_apps[:10]:  # Limit to top 10
                if sessions:
                    md += f"- **{app}**: {self._format_duration(count)}\n"
                else:
                    md += f"- **{app}**: {count} events\n"
            
            # Add AI Code Changes section if any detected
            code_changes = [e for e in events if e.source == 'logic_tracker']
            if code_changes:
                md += "\n## 🤖 AI-Detected Code Changes\n"
                for e in code_changes[:10]:
                    try:
                        import json as json_lib
                        payload = json_lib.loads(e.payload_json) if e.payload_json else {}
                        ai_summary = payload.get('ai_summary', e.window_title)
                        changed_files = payload.get('changed_files', [])
                        md += f"- **{e.ts.strftime('%H:%M')}**: {ai_summary}\n"
                        if changed_files:
                            md += f"  - Files: {', '.join(changed_files[:3])}\n"
                    except:
                        md += f"- **{e.ts.strftime('%H:%M')}**: {e.window_title}\n"
            
            if sessions:
                md += "\n## 🎯 Focus Sessions\n"
                top_sessions = sorted(sessions, key=lambda x: x.duration_sec, reverse=True)[:5]
                for s in top_sessions:
                    if s.activity_label != 'idle':
                        redacted_title = self.enricher.redact_text(s.window_title)
                        hint_str = f" ({s.summary_hint})" if s.summary_hint else ""
                        md += f"- Spent {self._format_duration(s.duration_sec)} in **{s.primary_app}** ({redacted_title}){hint_str}\n"

            # Save to DB
            report = Report(
                date=date_str,
                report_md=md,
                metrics_json=json.dumps(metrics)
            )
            db_session.add(report)
            db_session.commit()
            db_session.refresh(report)  # Ensure the ID is loaded
            report_id = report.id  # Capture before session closes
            db_session.close()
            
            # Return a simple dict instead of the ORM object
            return {"id": report_id, "date": date_str, "report_md": md}
            
        except Exception as e:
            print(f"Error generating report: {e}")
            db_session.rollback()
            db_session.close()
            return None

    def _format_duration(self, seconds):
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if hours > 0:
            return f"{hours}h {minutes}m"
        return f"{minutes}m"
