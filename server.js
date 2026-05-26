'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Server } = require('socket.io');
const { systemPreferences } = require('electron');

const PORT    = Number(process.env.PORT) || 3000;
const HOST    = process.env.HOST || '0.0.0.0';
const VERSION = process.env.APP_VERSION || '?';

// When running as a Tauri sidecar, these env vars are passed in.
const BASE_DIR = process.env.APP_RESOURCES_PATH || __dirname;
const DATA_DIR = process.env.APP_DATA_PATH
  ? path.join(process.env.APP_DATA_PATH, 'iphone-numpad')
  : __dirname;

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const TOKEN_FILE = path.join(DATA_DIR, '.token');
const TOKEN = (() => {
  if (process.env.NUMPAD_TOKEN) return process.env.NUMPAD_TOKEN;
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch {}
  const t = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
})();

const KEY_CODES = {
  enter: 36,
  tab: 48,
  backspace: 51,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
};

function escapeForAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildAppleScript(payload) {
  if (!payload || typeof payload !== 'object') return null;

  if (payload.type === 'char') {
    const v = String(payload.value ?? '');
    if (!v || v.length > 8) return null;
    return `tell application "System Events" to keystroke "${escapeForAppleScript(v)}"`;
  }

  if (payload.type === 'key') {
    const code = KEY_CODES[payload.value];
    if (code == null) return null;
    return `tell application "System Events" to key code ${code}`;
  }

  if (payload.type === 'clear') {
    // Cmd+A (全選択) → Backspace (削除)
    return [
      'tell application "System Events"',
      '  keystroke "a" using {command down}',
      '  key code 51',
      'end tell',
    ].join('\n');
  }

  return null;
}

function sendKeystroke(payload) {
  return new Promise((resolve, reject) => {
    // osascript を呼ぶ前にアクセシビリティ権限を確認する。
    // 権限がない状態で osascript を呼ぶと macOS 自身がダイアログを表示してしまうため、
    // ここで止めてエラーを返す。
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      reject(new Error('アクセシビリティ権限がありません（Mac の設定で KeyFlow を許可してください）'));
      return;
    }

    const script = buildAppleScript(payload);
    if (!script) {
      reject(new Error('invalid payload'));
      return;
    }
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve();
    });
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: false });

// Serve manifest dynamically so start_url includes the token.
// iOS uses start_url when launching from home screen, so the token must be baked in.
app.get('/manifest.webmanifest', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: 'KeyFlow',
    short_name: 'KeyFlow',
    description: 'iPhone を MacBook 用の表入力補助テンキーにする',
    start_url: `/?t=${TOKEN}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#111111',
    theme_color: '#111111',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon.svg',     sizes: 'any',      type: 'image/svg+xml' },
    ],
  });
});

app.use(express.static(path.join(BASE_DIR, 'public'), {
  extensions: ['html'],
  setHeaders: (res) => {
    // ブラウザキャッシュを使わず毎回サーバーに確認させる
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/healthz', (_req, res) => res.json({ ok: true, version: VERSION }));

io.use((socket, next) => {
  const auth = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (auth !== TOKEN) return next(new Error('auth_error'));
  next();
});

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[${new Date().toISOString()}] connected ${socket.id} (${ip})`);

  socket.on('input', async (payload, ack) => {
    try {
      await sendKeystroke(payload);
      const label = payload?.type === 'key' ? `<${payload.value}>` : JSON.stringify(payload?.value);
      console.log(`  ${socket.id} -> ${label}`);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      console.error('  send error:', e.message);
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[${new Date().toISOString()}] disconnected ${socket.id} (${reason})`);
  });
});

function lanIPs() {
  const ifs = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips;
}

// Get the Mac's stable mDNS hostname (e.g. "my-macbook.local").
// This never changes even when the IP changes, so home-screen PWAs keep working.
function mdnsHostname() {
  try {
    const name = require('child_process')
      .execSync('scutil --get LocalHostName 2>/dev/null', { timeout: 2000 })
      .toString().trim();
    return name ? `${name}.local` : null;
  } catch { return null; }
}

// Find first available port starting from `start`.
const net = require('net');
function findFreePort(start, cb) {
  const probe = net.createServer();
  probe.listen(start, HOST, () => {
    const port = probe.address().port;
    probe.close(() => cb(null, port));
  });
  probe.on('error', (e) => {
    if (e.code === 'EADDRINUSE') findFreePort(start + 1, cb);
    else cb(e);
  });
}

findFreePort(PORT, (err, port) => {
  if (err) throw err;
  server.listen(port, HOST, () => {
    const ips  = lanIPs();
    const mdns = mdnsHostname();

    // Primary URL: .local hostname (stable across IP changes) → IP fallback
    const primaryHost = mdns || ips[0] || 'localhost';
    const primaryUrl  = `http://${primaryHost}:${port}/?t=${TOKEN}`;

    console.log('');
    console.log('================ KeyFlow ================');
    console.log(` primary URL : ${primaryUrl}`);
    if (mdns && ips.length > 0) {
      for (const ip of ips) console.log(`  IP fallback : http://${ip}:${port}/?t=${TOKEN}`);
    }
    console.log('=========================================');
    console.log('');

    // Send URLs to Electron window (used for QR codes).
    // .local  → iPhone: stable across IP changes, ideal for home screen PWA
    // IP      → Android: mDNS unreliable on Android, IP is safer
    if (mdns) {
      process.stdout.write(`NUMPAD_URL=http://${mdns}:${port}/?t=${TOKEN}\n`);
    }
    if (ips.length > 0) {
      process.stdout.write(`NUMPAD_URL=http://${ips[0]}:${port}/?t=${TOKEN}\n`);
    } else if (!mdns) {
      process.stdout.write(`NUMPAD_URL=http://localhost:${port}/?t=${TOKEN}\n`);
    }
  });
});
