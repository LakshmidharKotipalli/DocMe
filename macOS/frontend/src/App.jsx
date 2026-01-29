import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, Calendar, Code, Cpu, Globe, HardDrive,
  MessageSquare, Terminal, X, FileText, List, Download, Settings, RefreshCw, Trash2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const API_BASE = "http://localhost:8000";
const isElectron = window.electronAPI?.isElectron || false;

const PopupNote = () => {
  const [noteText, setNoteText] = useState("");
  const [event, setEvent] = useState(null);
  const quickNoteRef = useRef(null);
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('eventId');

  const [userResponded, setUserResponded] = useState(false);

  useEffect(() => {
    if (eventId) {
      // Removed automatic focus to avoid stealing window focus

      const app = params.get('app');
      const title = params.get('title');
      setEvent({ id: eventId, app, window_title: title });
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId && !userResponded) {
      const timer = setTimeout(() => {
        if (isElectron) window.electronAPI.closeWindow();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [eventId, userResponded]);

  const handleTextChange = (e) => {
    setNoteText(e.target.value);
    if (!userResponded && e.target.value.trim().length > 0) {
      setUserResponded(true);
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) {
      if (isElectron) window.electronAPI.closeWindow();
      return;
    }
    try {
      await fetch(`${API_BASE}/events/${event.id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText })
      });
      if (isElectron) {
        window.electronAPI.showNotification("Note Saved", `Note added to: ${event.app}`);
        window.electronAPI.closeWindow();
      }
    } catch (err) { }
  };

  return (
    <div className="toast-content" style={{ padding: '20px', height: '100vh', borderRadius: '0' }}>
      <div className="flex-between" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={16} color="#818cf8" />
          <span style={{ fontWeight: '600', fontSize: '14px' }}>What did you do?</span>
        </div>
        <button onClick={() => window.electronAPI.closeWindow()} className="icon-btn"><X size={16} /></button>
      </div>
      <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
        Logged: <span style={{ color: '#f1f5f9' }}>{event?.app || 'None'}</span>
        {event?.window_title && <span style={{ opacity: 0.6, marginLeft: '4px' }}>- {event.window_title}</span>}
      </p>
      <textarea
        ref={quickNoteRef}
        value={noteText}
        onChange={handleTextChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); }
          if (e.key === 'Escape') { window.electronAPI.closeWindow(); }
        }}
        placeholder="Add some notes..."
        className="note-textarea"
        style={{ minHeight: '80px', fontSize: '13px', padding: '12px', marginBottom: '16px' }}
        autoFocus
      />
      <div className="flex-end" style={{ gap: '8px' }}>
        <button onClick={() => window.electronAPI.closeWindow()} className="secondary-btn small">Skip</button>
        <button onClick={saveNote} className="primary-btn small">Save Note</button>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('logs');
  const [activeDate, setActiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [report, setReport] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState({
    trackingEnabled: true,
    notificationsEnabled: true,
    showInDock: true,
    llmApiKey: '',
    llmModel: 'gemma3:1b'
  });
  const [targetEvent, setTargetEvent] = useState(null);
  const quickNoteRef = useRef(null);
  const lastActivityRef = useRef({ app: '', title: '' });

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [activeDate]);

  useEffect(() => {
    if (activeTab === 'report') {
      fetchReport();
    }
  }, [activeTab, activeDate]);

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getSettings().then(settings => {
        if (settings) setAppSettings(settings);
      });
      window.electronAPI.onNavigate((tab) => setActiveTab(tab));
      window.electronAPI.onNavigateToReport(() => {
        setActiveTab('report');
        fetchReport();
      });
      window.electronAPI.onQuickNote(() => {
        setQuickNoteOpen(true);
        setTimeout(() => quickNoteRef.current?.focus(), 100);
      });
    }
  }, []);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000/ws');
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_event') {
          // Only pop up if the window/app has actually changed
          const hasChanged = data.app !== lastActivityRef.current.app ||
            data.window_title !== lastActivityRef.current.title;

          if (hasChanged) {
            lastActivityRef.current = { app: data.app, title: data.window_title };

            // Trigger system-wide popup via Electron main process
            setTimeout(() => {
              if (isElectron) {
                window.electronAPI.createPopupWindow(data);
              }
              fetchData();
            }, 1000);
          } else {
            // Even if we don't pop up, still refresh data to show logs in dashboard
            fetchData();
          }
        }
      } catch (err) {
        console.error("WS Message Error:", err);
      }
    };
    return () => socket.close();
  }, []);

  const updateSetting = async (key, value) => {
    const newSettings = { ...appSettings, [key]: value };
    setAppSettings(newSettings);
    if (isElectron) await window.electronAPI.saveSettings(newSettings);
  };

  const fetchData = async () => {
    try {
      const sessRes = await fetch(`${API_BASE}/sessions?date=${activeDate}`);
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        setSessions(Array.isArray(sessData) ? sessData : []);
      }
      const eventRes = await fetch(`${API_BASE}/events?date=${activeDate}`);
      if (eventRes.ok) {
        const eventData = await eventRes.json();
        setEvents(Array.isArray(eventData) ? [...eventData].reverse() : []);
      }
    } catch (err) {
      console.error("Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/reports?date=${activeDate}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data && data.length > 0 ? data[0] : null);
      }
    } catch (err) {
      console.error("Fetch Report Error:", err);
      setReport(null);
    }
  };

  const saveNote = async (eventId) => {
    try {
      await fetch(`${API_BASE}/events/${eventId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText })
      });
      setEditingNoteId(null);
      fetchData();
    } catch (err) {
      console.error("Save Note Error:", err);
    }
  }; const deleteEvent = async (eventId) => {
    if (!confirm("Are you sure you want to delete this log? It will be removed from future summaries.")) return;
    try {
      await fetch(`${API_BASE}/events/${eventId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error("Delete Error:", err);
    }
  };

  const getActivityIcon = (source, label) => {
    if (source === 'logic_tracker') return <Cpu size={16} color="#f59e0b" />;
    if (source === 'browser') return <Globe size={16} color="#3b82f6" />;
    switch (label) {
      case 'coding': return <Code size={16} color="#818cf8" />;
      case 'terminal': return <Terminal size={16} color="#94a3b8" />;
      default: return <Activity size={16} color="#64748b" />;
    }
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/reports/generate?date=${activeDate}`, { method: 'POST' });
      if (res.ok) {
        fetchReport();
        setActiveTab('report');
      }
    } catch (err) {
      console.error("Report gen error:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="main-container">
      {/* Native-feeling Drag Header */}
      <header className="native-header">
        <div className="header-title-area">
          <HardDrive size={14} color="#94a3b8" />
          <span style={{ fontSize: '13px', fontWeight: '600', color: '#94a3b8' }}>DocMe</span>
        </div>

        <div className="no-drag">
          <div className="glass-panel" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px' }}>
            <Calendar size={14} color="#818cf8" />
            <input
              type="date"
              value={activeDate}
              onChange={(e) => setActiveDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}
            />
          </div>
        </div>

        <div style={{ position: 'absolute', right: '16px' }}>
          <button onClick={() => setSettingsOpen(true)} className="icon-btn no-drag">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Main Navigation */}
      <nav style={{ padding: '16px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '10px' }}>
          <button
            onClick={() => setActiveTab('logs')}
            className={`tab-btn small ${activeTab === 'logs' ? 'active logs' : ''}`}
            style={{ borderRadius: '8px', padding: '6px 16px', fontSize: '13px' }}
          >
            <List size={16} /> Activity
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`tab-btn small ${activeTab === 'report' ? 'active report' : ''}`}
            style={{ borderRadius: '8px', padding: '6px 16px', fontSize: '13px' }}
          >
            <FileText size={16} /> Report
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={generateReport}
            disabled={generating}
            className="primary-btn small"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={generating ? 'pulse' : ''} />
            {generating ? 'Summarizing...' : 'Summarize Day'}
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, overflowY: 'auto', padding: '20px' }} className="custom-scrollbar">
        {activeTab === 'logs' ? (
          <div className="event-list">
            {events.length > 0 ? events.map((event, i) => (
              <div key={i} className="event-row-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div className="event-item" style={{ flex: 1, border: '1px solid rgba(255,255,255,0.03)', position: 'relative' }}>
                  <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                    <div className="stat-icon" style={{ width: '32px', height: '32px' }}>
                      {getActivityIcon(event.source, event.activity_label)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex-between">
                        <p className="event-title" style={{ fontSize: '14px' }}>{event.window_title || event.app}</p>
                        <span className="timestamp" style={{ fontSize: '10px', opacity: 0.6 }}>
                          {new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="event-meta" style={{ marginTop: '2px', fontSize: '11px' }}>
                        <span style={{ fontWeight: '500' }}>{event.app}</span>
                        {(() => {
                          try {
                            const p = JSON.parse(event.payload_json);
                            if (p.ai_summary) return <span className="ai-badge" style={{ fontSize: '11px', padding: '2px 8px' }}>🤖 {p.ai_summary}</span>;
                            if (p.url) return <span className="url">{p.url}</span>;
                          } catch (e) { }
                          return null;
                        })()}
                      </div>

                      {editingNoteId === event.id ? (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            autoFocus
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveNote(event.id);
                              if (e.key === 'Escape') setEditingNoteId(null);
                            }}
                            className="glass-panel"
                            style={{ flex: 1, padding: '6px 10px', fontSize: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid #818cf8', color: 'white', outline: 'none', borderRadius: '6px' }}
                            placeholder="Add a note..."
                          />
                          <button onClick={() => saveNote(event.id)} className="primary-btn small" style={{ borderRadius: '6px' }}>Save</button>
                          <button onClick={() => setEditingNoteId(null)} className="secondary-btn small" style={{ borderRadius: '6px' }}>Cancel</button>
                        </div>
                      ) : event.note && (
                        <div className="note-display" style={{ marginTop: '8px', padding: '8px 12px', fontSize: '12px' }}>
                          "{event.note}"
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    onClick={() => deleteEvent(event.id)}
                    className="icon-btn hover-scale delete-row-btn"
                    style={{ opacity: 0.3, transition: 'all 0.2s', padding: '10px' }}
                    title="Delete Log"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    onClick={() => {
                      if (editingNoteId === event.id) {
                        setEditingNoteId(null);
                      } else {
                        setEditingNoteId(event.id);
                        setNoteText(event.note || "");
                      }
                    }}
                    className={`icon-btn hover-scale note-action-btn ${editingNoteId === event.id ? 'active' : ''}`}
                    style={{
                      opacity: event.note || editingNoteId === event.id ? 1 : 0.4,
                      transition: 'all 0.2s',
                      padding: '10px'
                    }}
                    title="Add Note"
                  >
                    <MessageSquare size={18} color={editingNoteId === event.id ? "#818cf8" : (event.note ? "#10b981" : "currentColor")} />
                  </button>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                <Activity size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
                <p>No activity recorded for this date.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="report-container">
            {report ? (
              <div className="markdown-content">
                <ReactMarkdown>{report.report_md}</ReactMarkdown>
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: '300px' }}>
                <FileText size={40} color="#64748b" style={{ opacity: 0.3 }} />
                <h3>Today's Summary</h3>
                <p>Analyze your progress and generate a daily report.</p>
                <button onClick={generateReport} className="primary-btn" style={{ marginTop: '20px' }}>
                  Generate Report
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODALS */}
      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ width: '380px', padding: '24px' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} color="#10b981" />
                <span style={{ fontWeight: '600' }}>Settings</span>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="icon-btn"><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="flex-between">
                <div><p style={{ fontSize: '13px', fontWeight: '500' }}>Recording</p><p style={{ fontSize: '11px', color: '#64748b' }}>Capture active applications</p></div>
                <input type="checkbox" checked={appSettings.trackingEnabled} onChange={(e) => updateSetting('trackingEnabled', e.target.checked)} />
              </div>
              <div className="flex-between">
                <div><p style={{ fontSize: '13px', fontWeight: '500' }}>Native Alerts</p><p style={{ fontSize: '11px', color: '#64748b' }}>macOS system notifications</p></div>
                <input type="checkbox" checked={appSettings.notificationsEnabled} onChange={(e) => updateSetting('notificationsEnabled', e.target.checked)} />
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', marginTop: '8px' }}>
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#818cf8', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intelligence Settings</p>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>LLM API Key (optional for local)</label>
                  <input
                    type="password"
                    value={appSettings.llmApiKey}
                    onChange={(e) => updateSetting('llmApiKey', e.target.value)}
                    placeholder="sk-..."
                    style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px', color: 'white', fontSize: '12px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Model Name</label>
                  <input
                    type="text"
                    value={appSettings.llmModel}
                    onChange={(e) => updateSetting('llmModel', e.target.value)}
                    placeholder="gemma3:1b"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px', color: 'white', fontSize: '12px' }}
                  />
                </div>
              </div>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="primary-btn" style={{ width: '100%', marginTop: '24px', background: '#333' }}>Save & Close</button>
          </div>
        </div>
      )}

      {quickNoteOpen && (
        <div className="toast-container">
          <div className="toast-content" style={{ padding: '20px' }}>
            <div className="flex-between" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={16} color="#818cf8" />
                <span style={{ fontWeight: '600', fontSize: '14px' }}>What did you do?</span>
              </div>
              <button onClick={() => { setQuickNoteOpen(false); setTargetEvent(null); }} className="icon-btn"><X size={16} /></button>
            </div>
            <p style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
              Logged: <span style={{ color: '#f1f5f9' }}>{(targetEvent?.app || events[0]?.app) || 'None'}</span>
              {targetEvent?.window_title && <span style={{ opacity: 0.6, marginLeft: '4px' }}>- {targetEvent.window_title}</span>}
            </p>
            <textarea
              ref={quickNoteRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveQuickNote(); }
                if (e.key === 'Escape') { setQuickNoteOpen(false); setTargetEvent(null); }
              }}
              placeholder="Add some notes..."
              className="note-textarea"
              style={{ minHeight: '80px', fontSize: '13px', padding: '12px', marginBottom: '16px' }}
              autoFocus
            />
            <div className="flex-end" style={{ gap: '8px' }}>
              <button onClick={() => { setQuickNoteOpen(false); setTargetEvent(null); }} className="secondary-btn small">Skip</button>
              <button onClick={saveQuickNote} className="primary-btn small">Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* Hover Styles for event items (injected via style tag for simplicity) */}
      <style>{`
        .event-item:hover .icon-btn { opacity: 1 !important; transform: scale(1.2); }
        .hover-scale:hover { transform: scale(1.2) !important; color: #818cf8 !important; }
        .delete-row-btn:hover { color: #ef4444 !important; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; }
        .markdown-content { font-size: 14px; line-height: 1.6; color: #d1d5db; }
        .markdown-content h1, .markdown-content h2 { margin-top: 20px; color: #fff; }
      `}</style>
    </div>
  );
};

const App = () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');

  if (mode === 'popup') {
    return <PopupNote />;
  }
  return <Dashboard />;
};

export default App;
