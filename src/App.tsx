import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
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

interface Application {
  id: string;
  title: string;
  icon: {
    type: 'emoji' | 'image' | 'gradient';
    value: string;
  };
  iconText?: string;
  iconTextColor?: string;
  description?: string;
  routePath?: string;
  url?: string;
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
  const [activeTab, setActiveTab] = useState<'apps' | 'routes' | 'raw' | 'history'>('apps');
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
  const [publicUrl, setPublicUrl] = useState('http://localhost');
  const [savedRoutes, setSavedRoutes] = useState<RouteRule[]>([]);
  const hasUnsavedChanges = JSON.stringify(routes) !== JSON.stringify(savedRoutes);
  const [showDiff, setShowDiff] = useState(false);

  // Applications state
  const [applications, setApplications] = useState<Application[]>([]);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [showAppForm, setShowAppForm] = useState(false);
  const [appLinkMode, setAppLinkMode] = useState<'route' | 'url'>('route');
  const [appSearchQuery, setAppSearchQuery] = useState('');

  const filteredApplications = useMemo(() => {
    const q = appSearchQuery.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter(app =>
      app.title.toLowerCase().includes(q) ||
      (app.description?.toLowerCase().includes(q) ?? false) ||
      (app.routePath?.toLowerCase().includes(q) ?? false) ||
      (app.url?.toLowerCase().includes(q) ?? false)
    );
  }, [applications, appSearchQuery]);

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (showDiff || showForm || previewSnapshot) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [showDiff, showForm, previewSnapshot]);

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
      setSavedRoutes(parsed.routes);
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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data = await res.json();
      setPublicUrl(data.publicUrl || 'http://localhost');
    } catch {
      // fallback to default
    }
  }, []);

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/applications`);
      const data = await res.json();
      setApplications(data);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchHistory();
    fetchSettings();
    fetchApplications();
  }, [fetchConfig, fetchHistory, fetchSettings, fetchApplications]);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

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
    if (!confirm('确定保存并应用配置？此操作将立即更新 Caddy 路由。')) return;
    const content = generateCaddyfile(port, routes);
    saveConfig(content, description || `Update routes (${routes.length} rules)`);
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
    if (!editingRoute.comment) {
      showToast('描述不能为空', 'error');
      return;
    }
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

  const getRouteUrl = (matchPath: string) => {
    const base = publicUrl.replace(/\/$/, '');
    const p = matchPath.startsWith('/') ? matchPath : '/' + matchPath;
    return `${base}${p}`;
  };

  const handleAppDelete = async (id: string) => {
    if (!confirm('确定删除该应用？')) return;
    try {
      await fetch(`${API_BASE}/applications/${id}`, { method: 'DELETE' });
      fetchApplications();
      showToast('应用已删除', 'success');
    } catch {
      showToast('删除失败', 'error');
    }
  };

  const handleAppFormSubmit = async () => {
    if (!editingApp) return;
    if (!editingApp.title.trim()) {
      showToast('标题不能为空', 'error');
      return;
    }

    if (appLinkMode === 'url' && !editingApp.url?.trim()) {
      showToast('URL 不能为空', 'error');
      return;
    }

    // 根据链接模式清空另一个字段，避免歧义
    const payload: Application = {
      ...editingApp,
      routePath: appLinkMode === 'url' ? '' : editingApp.routePath || '',
      url: appLinkMode === 'route' ? '' : editingApp.url || '',
    };

    try {
      if (editingApp.id) {
        // Update
        await fetch(`${API_BASE}/applications/${editingApp.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // Create
        await fetch(`${API_BASE}/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      fetchApplications();
      setShowAppForm(false);
      setEditingApp(null);
      showToast('应用已保存', 'success');
    } catch {
      showToast('保存失败', 'error');
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
        <div className="header-left">
          <h1>Caddy Manager</h1>
          <span className="header-subtitle">反向代理配置管理面板</span>
        </div>
        <div className="header-right">
          <div className="status">:{port} active</div>
          {routes.length > 0 && <div className="route-count">{routes.length} routes</div>}
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${activeTab === 'apps' ? 'active' : ''}`} onClick={() => setActiveTab('apps')}>
          Applications
        </button>
        <button className={`tab ${activeTab === 'routes' ? 'active' : ''}`} onClick={() => setActiveTab('routes')}>
          Routes
        </button>
        <button className={`tab ${activeTab === 'raw' ? 'active' : ''}`} onClick={() => { setActiveTab('raw'); fetchConfig(); }}>
          Preview
        </button>
        <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); fetchHistory(); }}>
          History ({history.length})
        </button>
        {activeTab === 'apps' && (
          <button className="btn btn-ghost add-route-btn" onClick={() => {
            setEditingApp({
              id: '',
              title: '',
              icon: { type: 'emoji', value: '📦' },
              iconText: '',
              description: '',
              routePath: '',
              url: '',
            });
            setAppLinkMode('url');
            setShowAppForm(true);
          }}>+ Add App</button>
        )}
        {activeTab === 'routes' && (
          <button className="btn btn-ghost add-route-btn" onClick={handleAddRoute}>+ Add Route</button>
        )}
      </div>

      {/* ===== Applications Tab ===== */}
      {activeTab === 'apps' && (
        <div>
          <div className="app-search-bar">
            <span className="app-search-icon">🔍</span>
            <input
              type="text"
              className="app-link-input app-search-input"
              placeholder="搜索应用名称、描述、链接..."
              value={appSearchQuery}
              onChange={(e) => setAppSearchQuery(e.target.value)}
            />
            {appSearchQuery && (
              <button className="app-search-clear" onClick={() => setAppSearchQuery('')} title="清空">✕</button>
            )}
          </div>

          {filteredApplications.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🔍</div>
              <h2>{applications.length === 0 ? '还没有应用' : '未找到匹配应用'}</h2>
              <p>{applications.length === 0 ? '点击右上角按钮创建第一个应用，绑定路由，快速访问你的服务' : '换个关键词试试，或点击右上角创建新应用'}</p>
              <button className="btn btn-primary" onClick={() => {
                setEditingApp({
                  id: '',
                  title: '',
                  icon: { type: 'emoji', value: '📦' },
                  description: '',
                  routePath: '',
                  url: '',
                });
                setAppLinkMode('url');
                setShowAppForm(true);
              }} style={{ marginTop: 16 }}>+ Add App</button>
            </div>
          ) : (
            <div className="app-grid">
              {filteredApplications.map((app) => {
                const hasUrl = !!app.url?.trim();
                const boundRoute = routes.find(r => r.matchPath === app.routePath);
                const isUnbound = !hasUrl && !app.routePath;
                const isRouteMissing = !hasUrl && !!app.routePath && !boundRoute;

                const handleCardClick = () => {
                  if (isUnbound) {
                    showToast('该应用未设置链接', 'error');
                    return;
                  }
                  if (isRouteMissing) {
                    showToast('绑定的路由已不存在', 'error');
                    return;
                  }
                  if (hasUrl) {
                    window.open(app.url, '_blank');
                  } else {
                    window.open(getRouteUrl(app.routePath!), '_blank');
                  }
                };

                return (
                  <div
                    key={app.id}
                    className={`app-card ${isRouteMissing || isUnbound ? 'app-card-unbound' : ''}`}
                    onClick={handleCardClick}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(); }}
                  >
                    <div className="app-card-actions">
                      <button className="btn-icon" onClick={(e) => {
                        e.stopPropagation();
                        setEditingApp({ ...app });
                        setAppLinkMode(app.url?.trim() ? 'url' : 'route');
                        setShowAppForm(true);
                      }} title="Edit">✏️</button>
                      <button className="btn-icon" onClick={(e) => {
                        e.stopPropagation();
                        handleAppDelete(app.id);
                      }} title="Delete">🗑️</button>
                    </div>
                    <div className="app-card-icon">
                      {app.icon.type === 'emoji' && <span className="app-icon-emoji">{app.icon.value}</span>}
                      {app.icon.type === 'image' && <img src={app.icon.value} alt={app.title} className="app-icon-img" />}
                      {app.icon.type === 'gradient' && (
                        <div className="app-icon-gradient" style={{ background: `linear-gradient(135deg, ${app.icon.value.split(',')[0] || '#7DC395'}, ${app.icon.value.split(',')[1] || '#19c8b9'})` }}>
                          {app.iconText && <span className="app-icon-text" style={{ color: app.iconTextColor || '#fff' }}>{app.iconText}</span>}
                        </div>
                      )}
                    </div>
                    <div className="app-card-info">
                      <div className="app-card-title">{app.title}</div>
                      {app.description && <div className="app-card-desc">{app.description}</div>}
                      <div className="app-card-route">
                        {isUnbound && <span className="app-route-tag app-route-unbound">未设置链接</span>}
                        {isRouteMissing && <span className="app-route-tag app-route-missing">⚠ 路由已失效</span>}
                        {hasUrl && <span className="app-route-tag">{app.url}</span>}
                        {boundRoute && !hasUrl && <span className="app-route-tag">{app.routePath}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* App Form Modal */}
          {showAppForm && editingApp && (
            <div className="modal-overlay">
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>{editingApp.id ? '编辑应用' : '创建应用'}</h3>
                  <button className="btn-icon" onClick={() => { setShowAppForm(false); setEditingApp(null); }} style={{ fontSize: '1.2rem' }}>✕</button>
                </div>

                <div className="form-group">
                  <label>标题 *</label>
                  <input
                    type="text"
                    value={editingApp.title}
                    onChange={(e) => setEditingApp({ ...editingApp, title: e.target.value })}
                    placeholder="例如：管理后台、API 文档..."
                  />
                </div>

                <div className="form-group">
                  <label>图标</label>
                  <div className="icon-type-tabs">
                    <button
                      className={`icon-tab ${editingApp.icon.type === 'emoji' ? 'active' : ''}`}
                      onClick={() => setEditingApp({ ...editingApp, icon: { type: 'emoji', value: '📦' } })}
                    >Emoji</button>
                    <button
                      className={`icon-tab ${editingApp.icon.type === 'image' ? 'active' : ''}`}
                      onClick={() => setEditingApp({ ...editingApp, icon: { type: 'image', value: '' } })}
                    >图片</button>
                    <button
                      className={`icon-tab ${editingApp.icon.type === 'gradient' ? 'active' : ''}`}
                      onClick={() => setEditingApp({ ...editingApp, icon: { type: 'gradient', value: '#7DC395,#19c8b9' } })}
                    >渐变</button>
                  </div>
                  <div className="icon-preview-area">
                    <div className="icon-preview-box">
                      {editingApp.icon.type === 'emoji' && <span className="app-icon-emoji">{editingApp.icon.value || '📦'}</span>}
                      {editingApp.icon.type === 'image' && editingApp.icon.value && <img src={editingApp.icon.value} alt="" className="app-icon-img" />}
                      {editingApp.icon.type === 'image' && !editingApp.icon.value && <span className="icon-preview-placeholder">📷</span>}
                      {editingApp.icon.type === 'gradient' && (
                        <div className="app-icon-gradient" style={{ background: `linear-gradient(135deg, ${editingApp.icon.value.split(',')[0] || '#7DC395'}, ${editingApp.icon.value.split(',')[1] || '#19c8b9'})` }}>
                          {editingApp.iconText && <span className="app-icon-text" style={{ color: editingApp.iconTextColor || '#fff' }}>{editingApp.iconText}</span>}
                        </div>
                      )}
                    </div>
                    <div className="icon-input-area">
                      {editingApp.icon.type === 'emoji' && (
                        <input
                          type="text"
                          value={editingApp.icon.value}
                          onChange={(e) => setEditingApp({ ...editingApp, icon: { ...editingApp.icon, value: e.target.value } })}
                          placeholder="输入 emoji，如 📦 🚀 🎯"
                        />
                      )}
                      {editingApp.icon.type === 'image' && (
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                setEditingApp({ ...editingApp, icon: { ...editingApp.icon, value: ev.target?.result as string } });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      )}
                      {editingApp.icon.type === 'gradient' && (
                        <div className="gradient-input-wrapper">
                          <div className="gradient-colors">
                            <div className="gradient-color-row">
                              <input
                                type="color"
                                value={editingApp.icon.value.split(',')[0] || '#7DC395'}
                                onChange={(e) => {
                                  const colors = editingApp.icon.value.split(',');
                                  setEditingApp({ ...editingApp, icon: { ...editingApp.icon, value: `${e.target.value},${colors[1] || '#19c8b9'}` } });
                                }}
                              />
                              <span className="color-value">{editingApp.icon.value.split(',')[0] || '#7DC395'}</span>
                            </div>
                            <div className="gradient-color-row">
                              <input
                                type="color"
                                value={editingApp.icon.value.split(',')[1] || '#19c8b9'}
                                onChange={(e) => {
                                  const colors = editingApp.icon.value.split(',');
                                  setEditingApp({ ...editingApp, icon: { ...editingApp.icon, value: `${colors[0] || '#7DC395'},${e.target.value}` } });
                                }}
                              />
                              <span className="color-value">{editingApp.icon.value.split(',')[1] || '#19c8b9'}</span>
                            </div>
                          </div>
                          <div className="gradient-text-row">
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>图标文字（0-3字）</label>
                            <input
                              type="text"
                              value={editingApp.iconText || ''}
                              maxLength={3}
                              onChange={(e) => setEditingApp({ ...editingApp, iconText: e.target.value })}
                              placeholder="如：API、管理"
                              style={{ marginTop: 4 }}
                            />
                          </div>
                          <div className="gradient-text-row">
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>文字颜色</label>
                            <div className="color-picker-wrapper" style={{ marginTop: 4 }}>
                              <input
                                type="color"
                                value={editingApp.iconTextColor || '#ffffff'}
                                onChange={(e) => setEditingApp({ ...editingApp, iconTextColor: e.target.value })}
                              />
                              <span className="color-value">{editingApp.iconTextColor || '#ffffff'}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>简介</label>
                  <input
                    type="text"
                    value={editingApp.description || ''}
                    onChange={(e) => setEditingApp({ ...editingApp, description: e.target.value })}
                    placeholder="一句话描述这个应用的用途"
                  />
                </div>

                <div className="form-group">
                  <label>应用链接</label>
                  <div className="icon-type-tabs" style={{ marginBottom: 12 }}>
                    <button
                      className={`icon-tab ${appLinkMode === 'url' ? 'active' : ''}`}
                      onClick={() => setAppLinkMode('url')}
                    >自定义 URL</button>
                    <button
                      className={`icon-tab ${appLinkMode === 'route' ? 'active' : ''}`}
                      onClick={() => setAppLinkMode('route')}
                    >绑定路由</button>
                  </div>

                  {appLinkMode === 'url' ? (
                    <input
                      type="url"
                      className="app-link-input"
                      value={editingApp.url || ''}
                      onChange={(e) => setEditingApp({ ...editingApp, url: e.target.value })}
                      placeholder="https://example.com 或 http://localhost:3000"
                    />
                  ) : (
                    <select
                      value={editingApp.routePath || ''}
                      onChange={(e) => setEditingApp({ ...editingApp, routePath: e.target.value })}
                      className="route-select app-link-input"
                    >
                      <option value="">不绑定</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.matchPath}>
                          {r.comment || r.matchPath} ({r.matchPath})
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="form-hint">
                    {appLinkMode === 'url'
                      ? '点击卡片将直接在新标签页打开该 URL'
                      : '选择该应用对应的路由，点击卡片跳转到对应路径'}
                  </span>
                </div>

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => { setShowAppForm(false); setEditingApp(null); }}>取消</button>
                  <button className="btn btn-primary" onClick={handleAppFormSubmit}>
                    {editingApp.id ? '更新' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Routes Tab ===== */}
      {activeTab === 'routes' && (
        <div>
          <div className="routes-header">
            <input
              className="description-input"
              placeholder="变更描述（必填）..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ flex: 1 }}
            />
            <div className="routes-header-actions">
              <button className={`btn ${hasUnsavedChanges ? 'btn-warning' : 'btn-primary'}`} onClick={handleSaveRoutes} disabled={loading || !description.trim()}>
                {loading ? '...' : hasUnsavedChanges ? '⬆ 有修改 · 保存' : '⬆ Save & Apply'}
              </button>
            </div>
          </div>

          {hasUnsavedChanges && (
            <div className="unsaved-banner">
              <span className="unsaved-icon">⚠️</span>
              <span className="unsaved-text">你有未保存的修改，请点击 Save & Apply 应用配置</span>
              <button className="unsaved-preview-btn" onClick={() => setShowDiff(true)}>
                🔍 预览
              </button>
            </div>
          )}

          {routes.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🛤️</div>
              <h2>还没有配置路由</h2>
              <p>点击下方按钮添加第一条路由，开始管理你的反向代理</p>
              <button className="btn btn-primary" onClick={handleAddRoute} style={{ marginTop: 16 }}>+ Add Route</button>
            </div>
          ) : (
            <div className="route-list">
              {routes.map((route) => (
                <div key={route.id} className="route-card">
                  <div className="route-card-header">
                    <div className="route-path">
                      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {route.comment || route.matchPath}
                      </span>
                    </div>
                    <div className="route-card-actions">
                      <a className="route-open-btn" href={getRouteUrl(route.matchPath)} target="_blank" rel="noopener noreferrer" title="Open in new tab">
                        ↗
                      </a>
                      <button className="btn-icon" onClick={() => handleEditRoute(route)} title="Edit">✏️</button>
                      <button className="btn-icon" onClick={() => handleDeleteRoute(route.id)} title="Delete">🗑️</button>
                    </div>
                  </div>
                  <div className="route-card-body">
                    <div className="route-target">
                      <code style={{ color: 'var(--text-secondary)' }}>{route.matchPath}*</code>
                      <span className="route-arrow">►</span>
                      <code>{route.target}{!route.stripPrefix ? route.matchPath : ''}</code>
                    </div>
                    {route.headers && route.headers.length > 0 && (
                      <div className="route-headers">
                        {route.headers.map((h, idx) => (
                          <span key={idx} className="route-header-tag">{h.key}: {h.value}</span>
                        ))}
                      </div>
                    )}
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
                  <label>描述 *</label>
                  <input
                    type="text"
                    value={editingRoute.comment || ''}
                    onChange={(e) => setEditingRoute({ ...editingRoute, comment: e.target.value })}
                    placeholder="例如：md查看器、管理面板、前端项目..."
                  />
                  <span className="form-hint">必填，用于标识这条路由的用途</span>
                </div>
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

      {/* ===== Preview Tab ===== */}
      {activeTab === 'raw' && (
        <div>
          <div className="editor-container">
            <div className="editor-toolbar">
              <span className="filename">Caddyfile (只读)</span>
              <div className="editor-actions">
                <button className="btn btn-ghost" onClick={fetchConfig} disabled={loading}>↻ Refresh</button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      await fetch(`${API_BASE}/open-config-dir`, { method: 'POST' });
                    } catch (e) {
                      showToast('打开失败', 'error');
                    }
                  }}
                >
                  📂 打开文件位置
                </button>
              </div>
            </div>
            <textarea
              className="editor"
              value={caddyfile}
              readOnly
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
              <h2>暂无历史记录</h2>
              <p>保存一次配置后，这里会显示所有版本快照</p>
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
            <div className="modal-overlay" onClick={() => setPreviewSnapshot(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{previewSnapshot.description}</h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatTime(previewSnapshot.timestamp)}</span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => setPreviewSnapshot(null)}>✕</button>
                </div>
                <pre style={{ flex: 1, overflow: 'auto', background: 'var(--bg-content)', padding: 16, borderRadius: 12, border: '2px solid var(--border-light)', fontSize: 12, lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace" }}>{previewSnapshot.caddyfile}</pre>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-danger" onClick={() => handleRollback(previewSnapshot.id)} disabled={loading}>
                    Rollback to this version
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showDiff && (
        <div className="modal-overlay">
          <div className="modal diff-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>配置变更预览</h3>
              <button className="btn-icon" onClick={() => setShowDiff(false)} style={{ fontSize: '1.2rem' }}>✕</button>
            </div>
            <div className="diff-container">
              <ReactDiffViewer
                oldValue={generateCaddyfile(port, savedRoutes)}
                newValue={generateCaddyfile(port, routes)}
                splitView={false}
                leftTitle="修改前"
                rightTitle="修改后"
                compareMethod={DiffMethod.LINES}
                useDarkTheme={false}
                showDiffOnly={false}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowDiff(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

export default App;
