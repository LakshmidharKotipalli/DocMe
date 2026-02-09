import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Activity, Calendar, Code, Cpu, Globe, HardDrive,
  MessageSquare, Terminal, X, FileText, List, Download, Settings, RefreshCw, Trash2, Edit3, Minimize2, ArrowUp, ArrowDown, Search, ChevronRight, Sparkles, Zap
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { A2UIProvider, A2UIRenderer } from '@a2ui-sdk/react/0.8';

const API_BASE = "http://localhost:8000";
const isElectron = window.electronAPI?.isElectron || false;

/* ═══════════════════════════════════════════════
   A2UI HELPERS — Build A2UI messages from data
   ═══════════════════════════════════════════════ */

/**
 * Build A2UI messages to render a summary surface from sessions data
 */
function buildSessionsSurface(sessions, date) {
  if (!sessions || sessions.length === 0) return [];

  // Group sessions by app
  const appGroups = {};
  sessions.forEach(s => {
    const app = s.primary_app || 'Unknown';
    if (!appGroups[app]) appGroups[app] = { count: 0, totalDuration: 0 };
    appGroups[app].count += 1;
    appGroups[app].totalDuration += (s.duration_sec || 0);
  });

  const sortedApps = Object.entries(appGroups)
    .sort((a, b) => b[1].totalDuration - a[1].totalDuration)
    .slice(0, 8);

  // Build component tree
  const components = [
    {
      id: 'root',
      component: {
        Column: {
          children: { explicitList: ['header-row', 'divider-1', 'apps-list'] },
          gap: 12,
        }
      }
    },
    {
      id: 'header-row',
      component: {
        Row: {
          children: { explicitList: ['stat-sessions', 'stat-apps'] },
          gap: 16,
        }
      }
    },
    {
      id: 'stat-sessions',
      component: {
        Card: {
          child: 'stat-sessions-content',
        }
      }
    },
    {
      id: 'stat-sessions-content',
      component: {
        Column: {
          children: { explicitList: ['stat-sessions-num', 'stat-sessions-label'] },
          gap: 2,
        }
      }
    },
    {
      id: 'stat-sessions-num',
      component: {
        Text: {
          text: { literalString: String(sessions.length) },
          usageHint: 'h2',
        }
      }
    },
    {
      id: 'stat-sessions-label',
      component: {
        Text: {
          text: { literalString: 'Sessions' },
          usageHint: 'body2',
        }
      }
    },
    {
      id: 'stat-apps',
      component: {
        Card: {
          child: 'stat-apps-content',
        }
      }
    },
    {
      id: 'stat-apps-content',
      component: {
        Column: {
          children: { explicitList: ['stat-apps-num', 'stat-apps-label'] },
          gap: 2,
        }
      }
    },
    {
      id: 'stat-apps-num',
      component: {
        Text: {
          text: { literalString: String(Object.keys(appGroups).length) },
          usageHint: 'h2',
        }
      }
    },
    {
      id: 'stat-apps-label',
      component: {
        Text: {
          text: { literalString: 'Applications' },
          usageHint: 'body2',
        }
      }
    },
    {
      id: 'divider-1',
      component: { Divider: {} }
    },
    {
      id: 'apps-list',
      component: {
        Column: {
          children: { explicitList: ['apps-title', ...sortedApps.map((_, i) => `app-row-${i}`)] },
          gap: 8,
        }
      }
    },
    {
      id: 'apps-title',
      component: {
        Text: {
          text: { literalString: 'Top Applications' },
          usageHint: 'h3',
        }
      }
    },
    ...sortedApps.flatMap(([app, data], i) => {
      const mins = Math.round(data.totalDuration / 60);
      return [
        {
          id: `app-row-${i}`,
          component: {
            Row: {
              children: { explicitList: [`app-name-${i}`, `app-time-${i}`] },
              gap: 8,
            }
          }
        },
        {
          id: `app-name-${i}`,
          weight: 1,
          component: {
            Text: {
              text: { literalString: app },
              usageHint: 'body1',
            }
          }
        },
        {
          id: `app-time-${i}`,
          component: {
            Text: {
              text: { literalString: mins > 0 ? `${mins}m · ${data.count} session${data.count !== 1 ? 's' : ''}` : `${data.count} session${data.count !== 1 ? 's' : ''}` },
              usageHint: 'body2',
            }
          }
        },
      ];
    }),
  ];

  return [
    { surfaceUpdate: { surfaceId: 'day-summary', components } },
    { beginRendering: { surfaceId: 'day-summary', root: 'root' } },
  ];
}

/**
 * A2UI Surface wrapper component with glass styling
 */
const A2UISurface = ({ messages, title, onAction }) => {
  if (!messages || messages.length === 0) return null;

  return (
    <div className="a2ui-surface-container">
      <div className="a2ui-surface-header">
        <span className="a2ui-badge">A2UI</span>
        <span className="a2ui-surface-title">{title}</span>
      </div>
      <A2UIProvider messages={messages} onAction={onAction}>
        <A2UIRenderer onAction={onAction || (() => {})} />
      </A2UIProvider>
    </div>
  );
};

/* ═══════════════════════════════════════════════
   POPUP NOTE — Electron floating window
   ═══════════════════════════════════════════════ */
const PopupNote = () => {
  const [noteText, setNoteText] = useState("");
  const [event, setEvent] = useState(null);
  const quickNoteRef = useRef(null);
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('eventId');
  const [userResponded, setUserResponded] = useState(false);

  useEffect(() => {
    if (eventId) {
      const initialNote = params.get('initialNote');
      if (initialNote) {
        setNoteText(`[Copied] ${initialNote}`);
        setUserResponded(true);
      }
      const app = params.get('app');
      const title = params.get('title');
      setEvent({ id: eventId, app, window_title: title });
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId && !userResponded) {
      const timer = setTimeout(() => {
        if (isElectron) window.electronAPI.closeWindow();
      }, 5000);
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
          <MessageSquare size={16} style={{ color: 'var(--vermillion)' }} />
          <span style={{ fontWeight: '600', fontSize: '14px' }}>What did you do?</span>
        </div>
        <button onClick={() => window.electronAPI.closeWindow()} className="icon-btn"><X size={16} /></button>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--ink-muted)', marginBottom: '10px' }}>
        Logged: <span style={{ color: 'var(--ink-primary)' }}>{event?.app || 'None'}</span>
        {event?.window_title && <span style={{ opacity: 0.6, marginLeft: '4px' }}>— {event.window_title}</span>}
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
        style={{ minHeight: '80px', marginBottom: '16px' }}
        autoFocus
      />
      <div className="flex-end" style={{ gap: '8px' }}>
        <button onClick={() => window.electronAPI.closeWindow()} className="secondary-btn small">Skip</button>
        <button onClick={saveNote} className="primary-btn small">Save Note</button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════
   DASHBOARD — Main application view
   ═══════════════════════════════════════════════ */
const Dashboard = () => {
  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [activeTab, setActiveTab] = useState('logs');
  const [activeDate, setActiveDate] = useState(getLocalDate());
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [report, setReport] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [reverseSort, setReverseSort] = useState(false);
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
    llmModel: 'ggml-org/gemma-3-1b-it-GGUF'
  });
  const [llmServerRunning, setLlmServerRunning] = useState(false);
  const [targetEvent, setTargetEvent] = useState(null);
  const [miniNoteOpen, setMiniNoteOpen] = useState(false);
  const [miniNoteText, setMiniNoteText] = useState("");
  const [backendError, setBackendError] = useState(null);
  const [viewingLogs, setViewingLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState([]);
  const quickNoteRef = useRef(null);
  const lastActivityRef = useRef({ app: '', title: '', id: null });

  // ─── Data fetching ───
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [activeDate]);

  useEffect(() => {
    if (activeTab === 'report') fetchReport();
  }, [activeTab, activeDate]);

  // ─── Electron listeners ───
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
      window.electronAPI.getLLMStatus().then(status => setLlmServerRunning(status));
      window.electronAPI.onLLMStatusChanged((status) => setLlmServerRunning(status));
      if (window.electronAPI.onBackendError) {
        window.electronAPI.onBackendError((msg) => {
          setBackendError(msg);
          setLoading(false);
        });
      }
    }
  }, []);

  // ─── WebSocket ───
  useEffect(() => {
    let socket = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    const connectWebSocket = () => {
      try {
        socket = new WebSocket('ws://localhost:8000/ws');
        socket.onopen = () => {
          console.log('WebSocket connected');
          reconnectAttempts = 0;
        };
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'new_event') {
              const hasChanged = data.app !== lastActivityRef.current.app ||
                data.window_title !== lastActivityRef.current.title;
              if (hasChanged) {
                const previous = { ...lastActivityRef.current };
                lastActivityRef.current = { id: data.id, app: data.app, title: data.window_title };
                const isTrackedSource = data.source === 'foreground_window' || data.source === 'browser';
                if (previous.app && previous.id && isTrackedSource) {
                  setTimeout(() => {
                    if (isElectron) {
                      window.electronAPI.createPopupWindow({
                        id: previous.id, app: previous.app, window_title: previous.title
                      });
                    }
                  }, 500);
                }
                fetchData();
              } else {
                fetchData();
              }
            }
          } catch (err) { console.error("WS Message Error:", err); }
        };
        socket.onerror = (error) => console.error('WebSocket error:', error);
        socket.onclose = () => {
          console.log('WebSocket disconnected');
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            console.log(`Attempting WebSocket reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
            reconnectTimer = setTimeout(connectWebSocket, delay);
          }
        };
      } catch (err) { console.error('WebSocket connection failed:', err); }
    };
    connectWebSocket();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, []);

  // ─── Actions ───
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
    } catch (err) { console.error("Fetch Error:", err); }
    finally { setLoading(false); }
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

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/logs?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data);
        setViewingLogs(true);
      }
    } catch (err) { console.error("Fetch Logs Error:", err); }
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
    } catch (err) { console.error("Save Note Error:", err); }
  };

  const saveQuickNote = async () => {
    const eventId = targetEvent?.id || events[0]?.id;
    if (!eventId || !noteText.trim()) {
      setQuickNoteOpen(false);
      setTargetEvent(null);
      return;
    }
    try {
      await fetch(`${API_BASE}/events/${eventId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText })
      });
      setQuickNoteOpen(false);
      setTargetEvent(null);
      setNoteText("");
      fetchData();
      if (isElectron) window.electronAPI.showNotification("Note Saved", "Your activity has been updated.");
    } catch (err) { console.error("Save Quick Note Error:", err); }
  };

  const saveMiniNote = async () => {
    const eventId = events[0]?.id;
    if (!eventId || !miniNoteText.trim()) return;
    try {
      await fetch(`${API_BASE}/events/${eventId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: miniNoteText })
      });
      setMiniNoteText("");
      fetchData();
      if (isElectron) window.electronAPI.showNotification("Note Saved", `Note added to: ${events[0]?.app}`);
    } catch (err) { console.error("Save Mini Note Error:", err); }
  };

  const deleteEvent = async (eventId) => {
    if (!confirm("Are you sure you want to delete this log? It will be removed from future summaries.")) return;
    try {
      await fetch(`${API_BASE}/events/${eventId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) { console.error("Delete Error:", err); }
  };

  const clearDayData = async () => {
    if (!confirm(`Are you sure you want to delete ALL data for ${activeDate}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/events/clear-day?date=${activeDate}`, { method: 'POST' });
      if (res.ok) {
        fetchData();
        setReport(null);
        if (isElectron) window.electronAPI.showNotification("Data Cleared", `All logs for ${activeDate} have been deleted.`);
      }
    } catch (err) { console.error("Clear Day Error:", err); }
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/reports/generate?date=${activeDate}`, { method: 'POST' });
      if (res.ok) {
        fetchReport();
        setActiveTab('report');
      }
    } catch (err) { console.error("Report gen error:", err); }
    finally { setGenerating(false); }
  };

  const toggleLLMServer = async () => {
    if (!isElectron) return;
    if (llmServerRunning) {
      await window.electronAPI.stopLLM();
    } else {
      const res = await window.electronAPI.startLLM(appSettings.llmModel || 'ggml-org/gemma-3-1b-it-GGUF');
      if (res.status === 'error') alert(`Failed to start LLM Server: ${res.message}`);
    }
  };

  const getIconClass = (source, label) => {
    if (source === 'logic_tracker') return 'logic';
    if (source === 'browser') return 'browser';
    if (label === 'coding') return 'coding';
    if (label === 'terminal') return 'terminal';
    return 'default';
  };

  const getActivityIcon = (source, label) => {
    const color = {
      logic: '#b5860a',
      browser: '#2a7c6f',
      coding: '#2a7c6f',
      terminal: '#5c5550',
      default: '#9c9590',
    };
    const cls = getIconClass(source, label);
    if (source === 'logic_tracker') return <Cpu size={16} color={color[cls]} />;
    if (source === 'browser') return <Globe size={16} color={color[cls]} />;
    if (label === 'coding') return <Code size={16} color={color[cls]} />;
    if (label === 'terminal') return <Terminal size={16} color={color[cls]} />;
    return <Activity size={16} color={color[cls]} />;
  };

  const filteredEvents = useMemo(() => {
    let result = [...events];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(e =>
        (e.app?.toLowerCase().includes(query)) ||
        (e.window_title?.toLowerCase().includes(query)) ||
        (e.note?.toLowerCase().includes(query))
      );
    }
    if (reverseSort) return result.reverse();
    return result;
  }, [events, searchQuery, reverseSort]);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Build A2UI messages from sessions for the report view
  const a2uiMessages = useMemo(() => {
    return buildSessionsSurface(sessions, activeDate);
  }, [sessions, activeDate]);

  const handleA2UIAction = useCallback((action) => {
    console.log('A2UI Action:', action);
  }, []);

  /* ─────────────────────────────────────
     RENDER
     ───────────────────────────────────── */
  return (
    <div className="main-container">

      {/* ═══ HEADER ═══ */}
      <header className="native-header">
        <div className="header-brand">
          <img src="./logo.png" alt="DocMe" className="header-brand-logo" />
          <span className="header-brand-name">DocMe</span>
        </div>

        <div className="header-center no-drag">
          <div className="date-picker-wrapper">
            <Calendar size={14} style={{ color: 'var(--vermillion)', opacity: 0.7 }} />
            <input
              type="date"
              value={activeDate}
              onChange={(e) => setActiveDate(e.target.value)}
            />
          </div>
        </div>

        <div className="header-right no-drag">
          <div className="llm-toggle">
            <span className={`llm-toggle-label ${llmServerRunning ? 'on' : 'off'}`}>
              LLM {llmServerRunning ? 'Live' : 'Off'}
            </span>
            <div className={`llm-switch ${llmServerRunning ? 'on' : 'off'}`} onClick={toggleLLMServer}>
              <div className="llm-switch-knob" />
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} className="btn-icon">
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* ═══ NAV BAR ═══ */}
      <nav className="nav-bar">
        <div className="nav-tabs">
          <button
            onClick={() => setActiveTab('logs')}
            className={`nav-tab ${activeTab === 'logs' ? 'active' : ''}`}
          >
            <List size={16} className="tab-icon" />
            Activity
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`nav-tab ${activeTab === 'report' ? 'active' : ''}`}
          >
            <FileText size={16} className="tab-icon" />
            Report
          </button>
        </div>

        <div className="nav-controls">
          {activeTab === 'logs' && (
            <>
              <button
                onClick={() => setReverseSort(!reverseSort)}
                className="btn-secondary"
                title={reverseSort ? "Oldest First" : "Latest First"}
              >
                {reverseSort ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                Sort
              </button>
              <div className="search-input-wrapper">
                <Search size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <X size={14} style={{ cursor: 'pointer', color: 'var(--ink-muted)' }} onClick={() => setSearchQuery("")} />
                )}
              </div>
            </>
          )}
          <button
            onClick={generateReport}
            disabled={generating}
            className="btn-primary"
          >
            <RefreshCw size={14} className={generating ? 'pulse' : ''} />
            {generating ? 'Summarizing...' : 'Summarize Day'}
          </button>
        </div>
      </nav>

      {/* ═══ DATE SUBTITLE ═══ */}
      <div style={{
        padding: '12px 24px 0',
        display: 'flex',
        alignItems: 'baseline',
        gap: '12px'
      }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.5rem',
          fontWeight: 400,
          color: 'var(--ink-primary)',
          letterSpacing: '-0.01em',
        }}>
          {formatDate(activeDate)}
        </h2>
        {events.length > 0 && (
          <span style={{
            fontSize: '0.78rem',
            color: 'var(--ink-muted)',
          }}>
            {events.length} {events.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="content-area">
        {activeTab === 'logs' ? (
          <div className="event-list">
            {filteredEvents.length > 0 ? filteredEvents.map((event, i) => (
              <div
                key={event.id || i}
                className="event-row"
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <div className="event-card">
                  <div className={`event-icon ${getIconClass(event.source, event.activity_label)}`}>
                    {getActivityIcon(event.source, event.activity_label)}
                  </div>
                  <div className="event-body">
                    <div className="event-header">
                      <span className="event-title">{event.window_title || event.app}</span>
                      <span className="event-time">
                        {new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="event-meta">
                      <span className="event-app-name">{event.app}</span>
                      {(() => {
                        try {
                          const p = JSON.parse(event.payload_json);
                          if (p.ai_summary) return <span className="ai-badge">AI: {p.ai_summary}</span>;
                          if (p.url) return <span className="event-url">{p.url}</span>;
                        } catch (e) { }
                        return null;
                      })()}
                    </div>

                    {editingNoteId === event.id ? (
                      <div className="note-inline-editor">
                        <input
                          type="text"
                          autoFocus
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveNote(event.id);
                            if (e.key === 'Escape') setEditingNoteId(null);
                          }}
                          placeholder="Add a note..."
                        />
                        <button onClick={() => saveNote(event.id)} className="primary-btn small">Save</button>
                        <button onClick={() => setEditingNoteId(null)} className="secondary-btn small">Cancel</button>
                      </div>
                    ) : event.note && (
                      <div className="note-display">
                        "{event.note}"
                      </div>
                    )}
                  </div>
                </div>

                <div className="event-actions">
                  <button
                    onClick={() => deleteEvent(event.id)}
                    className="event-action-btn delete"
                    title="Delete Log"
                  >
                    <Trash2 size={15} />
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
                    className={`event-action-btn ${event.note ? 'has-note' : ''}`}
                    title="Add Note"
                  >
                    <MessageSquare size={15} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="empty-state" style={{ height: 'calc(100vh - 220px)' }}>
                <Activity size={40} className="empty-state-icon" />
                <h3>No activity yet</h3>
                <p>Nothing recorded for this date. Start working and your activity will appear here.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="report-container">
            {/* A2UI Interactive Surface — Session Analytics */}
            {sessions.length > 0 && (
              <A2UISurface
                messages={a2uiMessages}
                title="Day Analytics"
                onAction={handleA2UIAction}
              />
            )}

            {report ? (
              <div>
                <div className="report-actions" style={{ marginTop: sessions.length > 0 ? '20px' : 0 }}>
                  <button
                    onClick={() => {
                      const blob = new Blob([report.report_md], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `DocMe-Report-${activeDate}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="btn-secondary"
                  >
                    <Download size={14} /> Download .md
                  </button>
                </div>
                <div className="markdown-content">
                  <ReactMarkdown>{report.report_md}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ height: sessions.length > 0 ? 'auto' : 'calc(100vh - 220px)', minHeight: sessions.length > 0 ? '200px' : '300px', paddingTop: sessions.length > 0 ? '20px' : '40px' }}>
                <FileText size={40} className="empty-state-icon" />
                <h3>Today's Summary</h3>
                <p>Analyze your progress and generate a daily report.</p>
                <button onClick={generateReport} className="btn-primary" style={{ marginTop: '20px' }}>
                  Generate Report
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ═══ FLOATING NOTE BUTTON (FAB) ═══ */}
      <div className="fab-container">
        {miniNoteOpen && (
          <div className="fab-panel">
            <div className="fab-panel-header">
              <div className="fab-panel-title">
                <Edit3 size={14} />
                Quick Note
              </div>
              <button onClick={() => setMiniNoteOpen(false)} className="btn-icon" style={{ padding: '4px' }}>
                <Minimize2 size={14} />
              </button>
            </div>
            <p className="fab-panel-context">
              Current: {events[0]?.app || 'No activity'} {events[0]?.window_title ? `— ${events[0].window_title.slice(0, 30)}...` : ''}
            </p>
            <textarea
              value={miniNoteText}
              onChange={(e) => setMiniNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveMiniNote(); }
              }}
              placeholder="What are you working on?"
            />
            <div className="fab-panel-actions">
              <button onClick={saveMiniNote} className="primary-btn small">Save Note</button>
            </div>
          </div>
        )}
        <button
          onClick={() => setMiniNoteOpen(!miniNoteOpen)}
          className="fab-button"
        >
          {miniNoteOpen ? <X size={20} /> : <Edit3 size={20} />}
        </button>
      </div>

      {/* ═══ SETTINGS MODAL ═══ */}
      {settingsOpen && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="modal-title">
                <Settings size={18} style={{ color: 'var(--ink-muted)' }} />
                <span>Settings</span>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="btn-icon"><X size={18} /></button>
            </div>

            {/* General */}
            <div className="settings-section">
              <div className="settings-section-title">General</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <p>Recording</p>
                  <p>Capture active applications</p>
                </div>
                <input type="checkbox" checked={appSettings.trackingEnabled} onChange={(e) => updateSetting('trackingEnabled', e.target.checked)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <p>Native Alerts</p>
                  <p>macOS system notifications</p>
                </div>
                <input type="checkbox" checked={appSettings.notificationsEnabled} onChange={(e) => updateSetting('notificationsEnabled', e.target.checked)} />
              </div>
            </div>

            {/* Intelligence */}
            <div className="settings-section">
              <div className="settings-section-title">Intelligence</div>
              <div style={{ marginBottom: '12px' }}>
                <label className="settings-input-label">LLM API Key (optional for local)</label>
                <input
                  type="password"
                  value={appSettings.llmApiKey}
                  onChange={(e) => updateSetting('llmApiKey', e.target.value)}
                  placeholder="sk-..."
                  className="settings-input"
                />
              </div>
              <div>
                <label className="settings-input-label">Model Name</label>
                <input
                  type="text"
                  value={appSettings.llmModel}
                  onChange={(e) => updateSetting('llmModel', e.target.value)}
                  placeholder="gemma3:1b"
                  className="settings-input"
                />
              </div>
            </div>

            {/* Danger Zone */}
            <div className="settings-section">
              <div className="settings-section-title danger">Danger Zone</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <p>Clear Day's Data</p>
                  <p>Delete everything for {activeDate}</p>
                </div>
                <button onClick={clearDayData} className="btn-danger">
                  <Trash2 size={14} /> Clear
                </button>
              </div>
            </div>

            {/* Support */}
            <div className="settings-section">
              <div className="settings-section-title">Support</div>
              <button
                onClick={fetchLogs}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Terminal size={14} /> View System Diagnostics
              </button>

              {viewingLogs && (
                <div className="system-logs-panel">
                  <div className="system-logs-header">
                    <span>System Logs (Last 50)</span>
                    <button onClick={() => setViewingLogs(false)}>Close</button>
                  </div>
                  {systemLogs.length > 0 ? systemLogs.map((log, idx) => (
                    <div key={idx} className={`log-entry ${log.level === 'ERROR' ? 'error' : ''}`}>
                      <span className="log-entry-time">[{new Date(log.ts).toLocaleTimeString()}]</span> {log.message}
                    </div>
                  )) : <p style={{ fontSize: '0.7rem', color: 'var(--ink-faint)' }}>No logs found.</p>}
                </div>
              )}
            </div>

            <button
              onClick={() => setSettingsOpen(false)}
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            >
              Save & Close
            </button>
          </div>
        </div>
      )}

      {/* ═══ QUICK NOTE TOAST ═══ */}
      {quickNoteOpen && (
        <div className="toast-container">
          <div className="toast-content" style={{ padding: '20px' }}>
            <div className="flex-between" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={16} style={{ color: 'var(--vermillion)' }} />
                <span style={{ fontWeight: '600', fontSize: '14px' }}>What did you do?</span>
              </div>
              <button onClick={() => { setQuickNoteOpen(false); setTargetEvent(null); }} className="btn-icon"><X size={16} /></button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', marginBottom: '10px' }}>
              Logged: <span style={{ color: 'var(--ink-primary)' }}>{(targetEvent?.app || events[0]?.app) || 'None'}</span>
              {targetEvent?.window_title && <span style={{ opacity: 0.6, marginLeft: '4px' }}>— {targetEvent.window_title}</span>}
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
              style={{ minHeight: '80px', marginBottom: '16px' }}
              autoFocus
            />
            <div className="flex-end" style={{ gap: '8px' }}>
              <button onClick={() => { setQuickNoteOpen(false); setTargetEvent(null); }} className="secondary-btn small">Skip</button>
              <button onClick={saveQuickNote} className="primary-btn small">Save Note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════
   FLOATING NOTE WIDGET — Electron overlay
   ═══════════════════════════════════════════════ */
const FloatingNoteWidget = () => {
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");

  const toggleExpanded = () => {
    setExpanded(!expanded);
    if (window.electronAPI) window.electronAPI.toggleFloatingNote();
  };

  const saveNote = () => {
    if (!noteText.trim()) return;
    if (window.electronAPI) window.electronAPI.saveFloatingNote(noteText);
    setNoteText("");
    toggleExpanded();
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end', alignItems: 'flex-end',
      background: 'transparent'
    }}>
      {expanded && (
        <div className="fab-panel" style={{ marginBottom: '8px' }}>
          <div className="fab-panel-header">
            <div className="fab-panel-title">
              <Edit3 size={14} />
              Write a Note
            </div>
            <button onClick={toggleExpanded} className="btn-icon" style={{ padding: '4px' }}>
              <Minimize2 size={14} />
            </button>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); }
              if (e.key === 'Escape') toggleExpanded();
            }}
            placeholder="About current window..."
            autoFocus
          />
          <div className="fab-panel-actions">
            <button onClick={saveNote} className="primary-btn small">Save</button>
          </div>
        </div>
      )}
      <button onClick={toggleExpanded} className="fab-button">
        {expanded ? <X size={20} /> : <Edit3 size={20} />}
      </button>

      <style>{`
        body { background: transparent !important; overflow: hidden; }
        .electron-app { padding-top: 0 !important; }
      `}</style>
    </div>
  );
};

/* ═══════════════════════════════════════════════
   APP — Root router
   ═══════════════════════════════════════════════ */
const App = () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'popup') return <PopupNote />;
  if (mode === 'floating') return <FloatingNoteWidget />;
  return <Dashboard />;
};

export default App;
