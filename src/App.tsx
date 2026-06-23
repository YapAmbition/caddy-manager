import { useState, useEffect, useCallback } from 'react';
import './index.css';

declare const __BASE_PATH__: string;
const API_BASE = `${__BASE_PATH__}/api`;

interface RouteRule {
  id: string;
  matchPath: string;
  target: string;
  stripPrefix: boolean;
  headers?: { key: string; value: string }[];
  comment?: string;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  filename: string;
  caddyfile?: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

// Parse Caddyfile into route rules (line-by-line parser)
function parseCaddyfile(content: string): { port: string; routes: RouteRule[] } {
  const routes: RouteRule[] = [];
  const portMatch = content.match(/^:(\d+)\s*\{/m);
  const port = portMatch ? portMatch[1] : '80';

  const lines = content.split('\n');
  let i = 0;
  let lastComment = '';

  while (i < lines.length) {
    const line = lines[i].trim();

    // Track comments
    if (line.startsWith('#')) {
      lastComment = line.replace(/^#\s*/, '');
      i++;
      continue;
    }

    // Match handle_path or handle directive
    const handleMatch = line.match(/^(handle_path|handle)\s+(\S+)\s*\{$/);
    if (handleMatch) {
      const directive = handleMatch[1];
      const path = handleMatch[2];
      const stripPrefix = directive === 'handle_path';

      // Collect all lines inside this handle block
      let target = '';
      const headers: { key: string; value: string }[] = [];
      let depth = 1;
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        const innerLine = lines[j].trim();
        // Simple depth tracking
        if (innerLine === '}') {
          depth--;
        } else if (innerLine.endsWith('{') && !innerLine.match(/^\s*\{[a-z_]/)) {
          depth++;
        }

        // Extract reverse_proxy target
        const proxyMatch = innerLine.match(/^reverse_proxy\s+([^\s{]+)/);
        if (proxyMatch && !target) {
          target = proxyMatch[1];
        }

        // Extract header_up directives
        const headerMatch = innerLine.match(/^header_up\s+(\S+)\s+(.+)$/);
        if (headerMatch) {
          headers.push({ key: headerMatch[1], value: headerMatch[2] });
        }
        j++;
      }

      routes.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        matchPath: path.replace(/\*$/, ''),
        target,
        stripPrefix,
        headers: headers.length > 0 ? headers : undefined,
        comment: lastComment,
      });

      lastComment = '';
      i = j;
      continue;
    }

    // Match top-level reverse_proxy (path-based, e.g. `reverse_proxy /api/* localhost:3000`)
    const simpleProxyMatch = line.match(/^reverse_proxy\s+(\/\S+)\s+([^\s{]+)/);
    if (simpleProxyMatch) {
      routes.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        matchPath: simpleProxyMatch[1].replace(/\*$/, ''),
        target: simpleProxyMatch[2],
        stripPrefix: false,
        comment: lastComment,
      });
      lastComment = '';
    } else if (line !== '' && !line.startsWith('}') && !line.match(/^:(\d+)/)) {
      lastComment = '';
    }

    i++;
  }

  return { port, routes };
}

// Generate Caddyfile from route rules
function generateCaddyfile(port: string, routes: RouteRule[]): string {
  if (routes.length === 0) {
    return `:${port} {\n    respond "Hello from Caddy!"\n}\n`;
  }

  let content = `:${port} {\n`;
  routes.forEach((route, index) => {
    if (index > 0) content += '\n';
    if (route.comment) {
      content += `    # ${route.comment}\n`;
    }
    const directive = route.stripPrefix ? 'handle_path' : 'handle';
    const matchPath = route.matchPath.endsWith('*') ? route.matchPath : route.matchPath + '*';
    content += `    ${directive} ${matchPath} {\n`;
    if (route.headers && route.headers.length > 0) {
      content += `        reverse_proxy ${route.target} {\n`;
      route.headers.forEach(h => {
        content += `            header_up ${h.key} ${h.value}\n`;
      });
      content += `        }\n`;
    } else {
      content += `        reverse_proxy ${route.target}\n`;
    }
    content += `    }\n`;
  });
  content += '}\n';
  return content;
}

function App() {
  const [activeTab, setActiveTab] = useState<'routes' | 'raw' | 'history'>('routes');
  const [caddyfile, setCaddyfile] = useState('');
  const [port, setPort] = useState('80');
  const [routes, setRoutes] = useState<RouteRule[]>([]);
  const [editingRoute, setEditingRoute] = useState<RouteRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<HistoryEntry | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      const data = await res.json();
      setCaddyfile(data.caddyfile);
      const parsed = parseCaddyfile(data.caddyfile);
      setPort(parsed.port);
      setRoutes(parsed.routes);
    } catch {
      showToast('Failed to fetch config', 'error');
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/history`);
      const data = await res.json();
      setHistory(data);
    } catch {
      showToast('Failed to fetch history', 'error');
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchHistory();
  }, [fetchConfig, fetchHistory]);

  const saveConfig = async (content: string, desc: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caddyfile: content, description: desc || 'Update config' }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Config saved & applied!', 'success');
        setDescription('');
        fetchConfig();
        fetchHistory();
      } else {
        showToast(data.error || 'Failed to save', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    }
    setLoading(false);
  };

  const handleSaveRoutes = () => {
    const content = generateCaddyfile(port, routes);
    saveConfig(content, description || `Update routes (${routes.length} rules)`);
  };

  const handleSaveRaw = () => {
    saveConfig(caddyfile, description || 'Manual edit');
  };

  const handleAddRoute = () => {
    setEditingRoute({
      id: '',
      matchPath: '/',
      target: 'localhost:3000',
      stripPrefix: false,
      comment: '',
    });
    setShowForm(true);
  };

  const handleEditRoute = (route: RouteRule) => {
    setEditingRoute({ ...route });
    setShowForm(true);
  };

  const handleDeleteRoute = (id: string) => {
    if (!confirm('确定删除该路由？')) return;
    setRoutes(routes.filter(r => r.id !== id));
  };

  const handleFormSave = () => {
    if (!editingRoute) return;
    if (!editingRoute.matchPath || !editingRoute.target) {
      showToast('路径和目标地址不能为空', 'error');
      return;
    }
    if (editingRoute.id) {
      // Edit existing
      setRoutes(routes.map(r => r.id === editingRoute.id ? editingRoute : r));
    } else {
      // Add new
      const newRoute = { ...editingRoute, id: Date.now().toString() + Math.random().toString(36).slice(2, 6) };
      setRoutes([...routes, newRoute]);
    }
    setShowForm(false);
    setEditingRoute(null);
  };

  const handleRollback = async (id: string) => {
    if (!confirm('确定要回滚到此版本？当前配置会被备份。')) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rollback/${id}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Rollback successful!', 'success');
        fetchConfig();
        fetchHistory();
        setPreviewSnapshot(null);
      } else {
        showToast(data.error || 'Rollback failed', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    }
    setLoading(false);
  };

  const handlePreview = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/history/${id}`);
      const data = await res.json();
      setPreviewSnapshot(data);
    } catch {
      showToast('Failed to load snapshot', 'error');
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <div className="app">
      <header className="header">
        <h1>⚡ Caddy Manager</h1>
        <div className="status">
          <span className="status-dot"></span>
          <span>:{port} · localhost:2019</span>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${activeTab === 'routes' ? 'active' : ''}`} onClick={() => setActiveTab('routes')}>
          Routes
        </button>
        <button className={`tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => { setActiveTab('raw'); setCaddyfile(generateCaddyfile(port, routes)); }}>
          Raw
        </button>
        <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); fetchHistory(); }}>
          History ({history.length})
        </button>
      </div>

      {/* ===== Routes Tab ===== */}
      {activeTab === 'routes' && (
        <div>
          <div className="routes-header">
            <input
              className="description-input"
              placeholder="变更描述（可选）..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ flex: 1 }}
            />
            <div className="routes-header-actions">
              <button className="btn btn-ghost" onClick={handleAddRoute}>+ Add Route</button>
              <button className="btn btn-primary" onClick={handleSaveRoutes} disabled={loading}>
                {loading ? '...' : '⬆ Save & Apply'}
              </button>
            </div>
          </div>

          {routes.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🛤️</div>
              <p>No routes configured. Click "Add Route" to create one.</p>
            </div>
          ) : (
            <div className="route-list">
              {routes.map((route) => (
                <div key={route.id} className="route-card">
                  <div className="route-card-header">
                    <div className="route-path">
                      <span className="route-badge">{route.stripPrefix ? 'STRIP' : 'KEEP'}</span>
                      <code>{route.matchPath}*</code>
                    </div>
                    <div className="route-card-actions">
                      <button className="btn-icon" onClick={() => handleEditRoute(route)} title="Edit">✏️</button>
                      <button className="btn-icon" onClick={() => handleDeleteRoute(route.id)} title="Delete">🗑️</button>
                    </div>
                  </div>
                  <div className="route-card-body">
                    <div className="route-target">
                      <span className="route-arrow">→</span>
                      <code>{route.target}</code>
                    </div>
                    {route.headers && route.headers.length > 0 && (
                      <div className="route-headers">
                        {route.headers.map((h, idx) => (
                          <span key={idx} className="route-header-tag">header_up {h.key}: {h.value}</span>
                        ))}
                      </div>
                    )}
                    {route.comment && <div className="route-comment">{route.comment}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Route Form Modal */}
          {showForm && editingRoute && (
            <div className="modal-overlay" onClick={() => setShowForm(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>{editingRoute.id ? 'Edit Route' : 'Add Route'}</h3>
                <div className="form-group">
                  <label>Match Path</label>
                  <input
                    type="text"
                    value={editingRoute.matchPath}
                    onChange={(e) => setEditingRoute({ ...editingRoute, matchPath: e.target.value })}
                    placeholder="/api, /app, /md-viewer ..."
                  />
                  <span className="form-hint">Path prefix to match (without trailing *)</span>
                </div>
                <div className="form-group">
                  <label>Target (Upstream)</label>
                  <input
                    type="text"
                    value={editingRoute.target}
                    onChange={(e) => setEditingRoute({ ...editingRoute, target: e.target.value })}
                    placeholder="localhost:3000"
                  />
                  <span className="form-hint">Backend address to proxy to</span>
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editingRoute.stripPrefix}
                      onChange={(e) => setEditingRoute({ ...editingRoute, stripPrefix: e.target.checked })}
                    />
                    <span>Strip prefix (handle_path)</span>
                  </label>
                  <span className="form-hint">
                    {editingRoute.stripPrefix
                      ? `${editingRoute.matchPath}/foo → target receives /foo`
                      : `${editingRoute.matchPath}/foo → target receives ${editingRoute.matchPath}/foo`}
                  </span>
                </div>
                <div className="form-group">
                  <label>Comment (optional)</label>
                  <input
                    type="text"
                    value={editingRoute.comment || ''}
                    onChange={(e) => setEditingRoute({ ...editingRoute, comment: e.target.value })}
                    placeholder="Description for this route"
                  />
                </div>
                <div className="form-group">
                  <label>Headers (header_up)</label>
                  {(editingRoute.headers || []).map((h, idx) => (
                    <div key={idx} className="header-row">
                      <input
                        type="text"
                        value={h.key}
                        onChange={(e) => {
                          const headers = [...(editingRoute.headers || [])];
                          headers[idx] = { ...headers[idx], key: e.target.value };
                          setEditingRoute({ ...editingRoute, headers });
                        }}
                        placeholder="Host"
                        style={{ width: '35%' }}
                      />
                      <input
                        type="text"
                        value={h.value}
                        onChange={(e) => {
                          const headers = [...(editingRoute.headers || [])];
                          headers[idx] = { ...headers[idx], value: e.target.value };
                          setEditingRoute({ ...editingRoute, headers });
                        }}
                        placeholder="{upstream_hostport}"
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn-icon"
                        onClick={() => {
                          const headers = (editingRoute.headers || []).filter((_, i) => i !== idx);
                          setEditingRoute({ ...editingRoute, headers: headers.length > 0 ? headers : undefined });
                        }}
                      >✕</button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: 6, fontSize: '0.8rem' }}
                    onClick={() => {
                      const headers = [...(editingRoute.headers || []), { key: '', value: '' }];
                      setEditingRoute({ ...editingRoute, headers });
                    }}
                  >+ Add Header</button>
                  <span className="form-hint">e.g. Host → {'{upstream_hostport}'}, X-Real-IP → {'{remote_host}'}</span>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleFormSave}>
                    {editingRoute.id ? 'Update' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Raw Tab ===== */}
      {activeTab === 'raw' && (
        <div>
          <input
            className="description-input"
            placeholder="变更描述（可选）..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="editor-container">
            <div className="editor-toolbar">
              <span className="filename">Caddyfile</span>
              <div className="editor-actions">
                <button className="btn btn-ghost" onClick={fetchConfig} disabled={loading}>↻ Refresh</button>
                <button className="btn btn-primary" onClick={handleSaveRaw} disabled={loading}>
                  {loading ? '...' : '⬆ Save & Apply'}
                </button>
              </div>
            </div>
            <textarea
              className="editor"
              value={caddyfile}
              onChange={(e) => setCaddyfile(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* ===== History Tab ===== */}
      {activeTab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📭</div>
              <p>No history yet. Save a config to create the first snapshot.</p>
            </div>
          ) : (
            <div className="history-list">
              {history.map((entry) => (
                <div key={entry.id} className="history-item">
                  <div className="info">
                    <div className="desc">{entry.description}</div>
                    <div className="time">{formatTime(entry.timestamp)} · {entry.filename}</div>
                  </div>
                  <div className="actions">
                    <button className="btn btn-ghost" onClick={() => handlePreview(entry.id)}>View</button>
                    <button className="btn btn-danger" onClick={() => handleRollback(entry.id)} disabled={loading}>Rollback</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {previewSnapshot && (
            <div className="diff-view">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Preview: {previewSnapshot.description} ({formatTime(previewSnapshot.timestamp)})
                </span>
                <button className="btn btn-ghost" onClick={() => setPreviewSnapshot(null)}>✕ Close</button>
              </div>
              <pre>{previewSnapshot.caddyfile}</pre>
            </div>
          )}
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

export default App;
