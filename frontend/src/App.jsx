import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity, Calendar, Code, Cpu, Globe, HardDrive,
  MessageSquare, Terminal, X, FileText, List, Download, Settings, RefreshCw, Trash2, PieChart as PieChartIcon, BarChart3, Edit3, Minimize2, Maximize2, ArrowUp, ArrowDown
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
// Recharts removed as Stats tab is gone

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
      const initialNote = params.get('initialNote');
      if (initialNote) {
        setNoteText(`[Copied] ${initialNote}`);
        setUserResponded(true); // Don't auto-close if we have content
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
  const getLocalDate = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [activeTab, setActiveTab] = useState('logs');
  const [activeDate, setActiveDate] = useState(getLocalDate());
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [report, setReport] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [reverseSort, setReverseSort] = useState(false); // Default: latest on top
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

  useEffect(() => {
    // Immediate fetch on mount and date change
    fetchData();
    // Poll every 5 seconds for faster updates
    const interval = setInterval(fetchData, 5000);
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
              // Only pop up if the window/app has actually changed
              const hasChanged = data.app !== lastActivityRef.current.app ||
                data.window_title !== lastActivityRef.current.title;

              if (hasChanged) {
                const previous = { ...lastActivityRef.current };

                // Update ref with NEW activity data
                lastActivityRef.current = {
                  id: data.id,
                  app: data.app,
                  title: data.window_title
                };

                // Only trigger popup for the activity we just LEFT
                // and only if it was a real activity (foreground or browser)
                const isTrackedSource = data.source === 'foreground_window' || data.source === 'browser';

                if (previous.app && previous.id && isTrackedSource) {
                  setTimeout(() => {
                    if (isElectron) {
                      window.electronAPI.createPopupWindow({
                        id: previous.id,
                        app: previous.app,
                        window_title: previous.title
                      });
                    }
                  }, 500);
                }

                fetchData();
              } else {
                // Even if we don't pop up, still refresh data to show logs in dashboard
                fetchData();
              }
            }
          } catch (err) {
            console.error("WS Message Error:", err);
          }
        };

        socket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        socket.onclose = () => {
          console.log('WebSocket disconnected');
          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            console.log(`Attempting WebSocket reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
            reconnectTimer = setTimeout(connectWebSocket, delay);
          }
        };
      } catch (err) {
        console.error('WebSocket connection failed:', err);
      }
    };

    // Initial connection
    connectWebSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
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

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/logs?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data);
        setViewingLogs(true);
      }
    } catch (err) {
      console.error("Fetch Logs Error:", err);
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
    } catch (err) {
      console.error("Save Quick Note Error:", err);
    }
  };

  const saveMiniNote = async () => {
    const eventId = events[0]?.id;
    if (!eventId || !miniNoteText.trim()) {
      return;
    }
    try {
      await fetch(`${API_BASE}/events/${eventId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: miniNoteText })
      });
      setMiniNoteText("");
      fetchData();
      if (isElectron) window.electronAPI.showNotification("Note Saved", `Note added to: ${events[0]?.app}`);
    } catch (err) {
      console.error("Save Mini Note Error:", err);
    }
  };

  const deleteEvent = async (eventId) => {
    if (!confirm("Are you sure you want to delete this log? It will be removed from future summaries.")) return;
    try {
      await fetch(`${API_BASE}/events/${eventId}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error("Delete Error:", err);
    }
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
    } catch (err) {
      console.error("Clear Day Error:", err);
    }
  };

  const getActivityIcon = (source, label) => {
    if (source === 'logic_tracker') return <Cpu size={16} color="#f59e0b" />;
    if (source === 'browser') return <Globe size={16} color="#2dd4bf" />;
    switch (label) {
      case 'coding': return <Code size={16} color="#a3e635" />;
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

  const toggleLLMServer = async () => {
    if (!isElectron) return;
    if (llmServerRunning) {
      await window.electronAPI.stopLLM();
    } else {
      const res = await window.electronAPI.startLLM(appSettings.llmModel || 'ggml-org/gemma-3-1b-it-GGUF');
      if (res.status === 'error') {
        alert(`Failed to start LLM Server: ${res.message}`);
      }
    }
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

    // fetchData already reverses the order (default: latest first)
    // If reverseSort is true, we want oldest first (un-reverse the reversed array)
    if (reverseSort) {
      return result.reverse();
    }
    return result;
  }, [events, searchQuery, reverseSort]);

  return (
    <div className="main-container">
      {/* Native-feeling Drag Header */}
      <header className="native-header">
        <div className="header-title-area">
          <img src="./logo.png" alt="DocMe Logo" style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
          <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9', marginLeft: '8px' }}>DocMe</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="glass-panel no-drag" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px' }}>
            <Calendar size={14} color="#a3e635" />
            <input
              type="date"
              value={activeDate}
              onChange={(e) => setActiveDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}
            />
          </div>
        </div>

        <div style={{ position: 'absolute', right: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '20px' }}>
            <span style={{ fontSize: '10px', fontWeight: '600', color: llmServerRunning ? '#a3e635' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              LLM {llmServerRunning ? 'Live' : 'Off'}
            </span>
            <div
              onClick={toggleLLMServer}
              style={{
                width: '32px',
                height: '18px',
                background: llmServerRunning ? 'rgba(163, 230, 53, 0.2)' : 'rgba(255,255,255,0.1)',
                borderRadius: '10px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                border: llmServerRunning ? '1px solid rgba(163, 230, 53, 0.3)' : '1px solid rgba(255,255,255,0.1)'
              }}
            >
              <div style={{
                position: 'absolute',
                top: '2px',
                left: llmServerRunning ? '16px' : '2px',
                width: '12px',
                height: '12px',
                background: llmServerRunning ? '#a3e635' : '#94a3b8',
                borderRadius: '50%',
                transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: llmServerRunning ? '0 0 8px rgba(163, 230, 53, 0.5)' : 'none'
              }} />
            </div>
          </div>

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

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {activeTab === 'logs' && (
            <>
              <button
                onClick={() => setReverseSort(!reverseSort)}
                className="secondary-btn small"
                title={reverseSort ? "Oldest First" : "Latest First"}
                style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {reverseSort ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                Sort
              </button>
              <div className="glass-panel" style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px' }}>
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', fontSize: '12px', width: '150px' }}
                />
                <X size={14} style={{ cursor: 'pointer', opacity: searchQuery ? 0.5 : 0 }} onClick={() => setSearchQuery("")} />
              </div>
            </>
          )}
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
            {filteredEvents.length > 0 ? filteredEvents.map((event, i) => (
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
                            if (p.ai_summary) return <span className="ai-badge" style={{ fontSize: '11px', padding: '2px 8px', color: '#a3e635', background: 'rgba(163, 230, 53, 0.1)' }}>🤖 {p.ai_summary}</span>;
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
                            style={{ flex: 1, padding: '6px 10px', fontSize: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid #a3e635', color: 'white', outline: 'none', borderRadius: '6px' }}
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
                    <MessageSquare size={18} color={editingNoteId === event.id ? "#a3e635" : (event.note ? "#2dd4bf" : "currentColor")} />
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
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px', gap: '10px' }}>
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
                    className="secondary-btn small"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={14} /> Download MD
                  </button>
                </div>
                <div className="markdown-content">
                  <ReactMarkdown>{report.report_md}</ReactMarkdown>
                </div>
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

      {/* Persistent Mini-Note Widget */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px'
        }}
      >
        {miniNoteOpen && (
          <div
            className="glass-panel"
            style={{
              width: '300px',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(163, 230, 53, 0.2)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }}
          >
            <div className="flex-between" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Edit3 size={14} color="#a3e635" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#a3e635' }}>Quick Note</span>
              </div>
              <button onClick={() => setMiniNoteOpen(false)} className="icon-btn" style={{ padding: '4px' }}>
                <Minimize2 size={14} />
              </button>
            </div>
            <p style={{ fontSize: '10px', color: '#64748b', marginBottom: '8px' }}>
              Current: {events[0]?.app || 'No activity'} {events[0]?.window_title ? `- ${events[0].window_title.slice(0, 30)}...` : ''}
            </p>
            <textarea
              value={miniNoteText}
              onChange={(e) => setMiniNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveMiniNote(); }
              }}
              placeholder="What are you working on?"
              style={{
                width: '100%',
                minHeight: '60px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '10px',
                color: 'white',
                fontSize: '12px',
                resize: 'none',
                outline: 'none'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button onClick={saveMiniNote} className="primary-btn small" style={{ fontSize: '11px', padding: '6px 14px' }}>
                Save Note
              </button>
            </div>
          </div>
        )}
        <button
          onClick={() => setMiniNoteOpen(!miniNoteOpen)}
          className="primary-btn"
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(163, 230, 53, 0.3)',
            padding: 0
          }}
        >
          {miniNoteOpen ? <X size={20} /> : <Edit3 size={20} />}
        </button>
      </div>

      {/* MODALS */}
      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ width: '380px', padding: '24px' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} color="#2dd4bf" />
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
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#a3e635', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intelligence Settings</p>

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

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', marginTop: '8px' }}>
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#ef4444', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Danger Zone</p>
                <div className="flex-between">
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '500' }}>Clear Day's Data</p>
                    <p style={{ fontSize: '11px', color: '#64748b' }}>Delete everything for {activeDate}</p>
                  </div>
                  <button
                    onClick={clearDayData}
                    className="secondary-btn small"
                    style={{ borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)' }}
                  >
                    <Trash2 size={14} style={{ marginRight: '6px' }} /> Clear {activeDate}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', marginTop: '8px' }}>
                <p style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Support</p>
                <button
                  onClick={fetchLogs}
                  className="secondary-btn small"
                  style={{ width: '100%', justifyContent: 'center', gap: '8px' }}
                >
                  <Terminal size={14} /> View System Diagnostics
                </button>
              </div>

              {viewingLogs && (
                <div className="glass-panel" style={{ marginTop: '16px', maxHeight: '200px', overflowY: 'auto', padding: '10px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="flex-between" style={{ marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', color: '#a3e635' }}>System Logs (Last 50)</span>
                    <button onClick={() => setViewingLogs(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '10px' }}>Close</button>
                  </div>
                  {systemLogs.length > 0 ? systemLogs.map((log, idx) => (
                    <div key={idx} style={{ fontSize: '10px', color: log.level === 'ERROR' ? '#f87171' : '#cbd5e1', marginBottom: '4px', fontFamily: 'monospace', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                      <span style={{ opacity: 0.5 }}>[{new Date(log.ts).toLocaleTimeString()}]</span> {log.message}
                    </div>
                  )) : <p style={{ fontSize: '10px', color: '#64748b' }}>No logs found.</p>}
                </div>
              )}
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
                <MessageSquare size={16} color="#a3e635" />
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
        .hover-scale:hover { transform: scale(1.2) !important; color: #a3e635 !important; }
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
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      alignItems: 'flex-end',
      background: 'transparent'
    }}>
      {expanded && (
        <div className="glass-panel" style={{
          width: '300px',
          height: '180px',
          padding: '16px',
          marginBottom: '8px',
          borderRadius: '12px',
          border: '1px solid rgba(163, 230, 53, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div className="flex-between">
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#a3e635' }}>Write a Note</span>
            <button onClick={toggleExpanded} className="icon-btn"><Minimize2 size={14} /></button>
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
            style={{
              flex: 1,
              background: 'rgba(0,0,0,0.2)',
              border: 'none',
              borderRadius: '8px',
              padding: '10px',
              color: 'white',
              fontSize: '12px',
              resize: 'none',
              outline: 'none'
            }}
          />
          <div className="flex-end">
            <button onClick={saveNote} className="primary-btn small">Save</button>
          </div>
        </div>
      )}
      <button
        onClick={toggleExpanded}
        className="primary-btn"
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
          padding: 0
        }}
      >
        {expanded ? <X size={20} /> : <Edit3 size={20} />}
      </button>

      <style>{`
        body { background: transparent !important; overflow: hidden; }
        .electron-app { padding-top: 0 !important; }
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
  if (mode === 'floating') {
    return <FloatingNoteWidget />;
  }
  return <Dashboard />;
};

export default App;
