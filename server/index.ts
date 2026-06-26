import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const app = express();
const PORT = config.server.port;
const CADDY_ADMIN = config.caddy.adminApi;
const BASE_PATH = config.frontend.basePath;
const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
// 指向真实的 Caddyfile 路径（Caddy 实际加载的文件）
const CURRENT_FILE = config.caddy.caddyfilePath;
const MAX_SNAPSHOTS = config.history.maxSnapshots;

// Ensure directories exist
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

// --- Helper functions ---

interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  filename: string;
}

function readHistory(): HistoryEntry[] {
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
}

function writeHistory(history: HistoryEntry[]) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function getCurrentCaddyfile(): string {
  return fs.readFileSync(CURRENT_FILE, 'utf-8');
}

function saveSnapshot(description: string): HistoryEntry {
  const currentContent = getCurrentCaddyfile();
  const id = Date.now().toString();
  const filename = `${id}.Caddyfile`;
  fs.writeFileSync(path.join(SNAPSHOTS_DIR, filename), currentContent);

  const entry: HistoryEntry = { id, timestamp: Date.now(), description, filename };
  const history = readHistory();
  history.push(entry);
  // Keep max snapshots
  if (history.length > MAX_SNAPSHOTS) {
    const removed = history.shift()!;
    const removedPath = path.join(SNAPSHOTS_DIR, removed.filename);
    if (fs.existsSync(removedPath)) fs.unlinkSync(removedPath);
  }
  writeHistory(history);
  return entry;
}

async function loadToCaddy(_caddyfileContent: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Use caddy reload command instead of Admin API to avoid Origin restriction
    execSync(`caddy reload --config "${CURRENT_FILE}"`, {
      timeout: 10000,
      stdio: 'pipe',
    });
    return { ok: true };
  } catch (e: any) {
    const stderr = e.stderr?.toString() || e.message;
    return { ok: false, error: `caddy reload failed: ${stderr}` };
  }
}

// --- API Routes ---

// Get current config
app.get(`${BASE_PATH}/api/config`, (_req, res) => {
  res.json({ caddyfile: getCurrentCaddyfile() });
});

// Get public settings (non-sensitive)
app.get(`${BASE_PATH}/api/settings`, (_req, res) => {
  res.json({ publicUrl: config.caddy.publicUrl || 'http://localhost' });
});

// Save new config
app.post(`${BASE_PATH}/api/config`, async (req, res) => {
  const { caddyfile, description } = req.body;
  if (!caddyfile) return res.status(400).json({ error: 'caddyfile content required' });

  // Save current as snapshot before overwriting
  saveSnapshot(description || 'Manual save');

  // Write new config
  fs.writeFileSync(CURRENT_FILE, caddyfile);

  // Load to Caddy
  const result = await loadToCaddy(caddyfile);
  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ success: true, message: 'Config applied successfully' });
});

// Get history list
app.get(`${BASE_PATH}/api/history`, (_req, res) => {
  const history = readHistory().reverse(); // newest first
  res.json(history);
});

// Get a specific snapshot content
app.get(`${BASE_PATH}/api/history/:id`, (req, res) => {
  const history = readHistory();
  const entry = history.find(h => h.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Snapshot not found' });

  const filePath = path.join(SNAPSHOTS_DIR, entry.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Snapshot file missing' });

  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ ...entry, caddyfile: content });
});

// Rollback to a specific version
app.post(`${BASE_PATH}/api/rollback/:id`, async (req, res) => {
  const history = readHistory();
  const entry = history.find(h => h.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Snapshot not found' });

  const filePath = path.join(SNAPSHOTS_DIR, entry.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Snapshot file missing' });

  // Save current config before rollback
  saveSnapshot(`Rollback前备份 (即将回滚到 ${new Date(entry.timestamp).toLocaleString()})`);

  // Restore snapshot
  const snapshotContent = fs.readFileSync(filePath, 'utf-8');
  fs.writeFileSync(CURRENT_FILE, snapshotContent);

  // Load to Caddy
  const result = await loadToCaddy(snapshotContent);
  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ success: true, message: `Rolled back to version ${entry.id}` });
});

// Reload current config to Caddy (without changes)
app.post(`${BASE_PATH}/api/reload`, async (_req, res) => {
  const content = getCurrentCaddyfile();
  const result = await loadToCaddy(content);
  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }
  res.json({ success: true, message: 'Reloaded successfully' });
});

// Open Caddyfile location in Finder (macOS only)
app.post(`${BASE_PATH}/api/open-config-dir`, (_req, res) => {
  try {
    execSync(`open -R "${CURRENT_FILE}"`, { timeout: 5000 });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend static files in production
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(BASE_PATH, express.static(distPath));
  // SPA fallback: any non-API request under BASE_PATH returns index.html
  app.use(BASE_PATH, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Caddy Manager server running at http://localhost:${PORT}`);
  console.log(`📂 Data directory: ${DATA_DIR}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}/caddy/`);
});
