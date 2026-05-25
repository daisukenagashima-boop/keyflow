'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell,
} = require('electron');
const path = require('path');
const qrcode = require('qrcode');

const LATEST_JSON_URL =
  'https://raw.githubusercontent.com/daisukenagashima-boop/keyflow/main/latest.json';

// ── Update check ─────────────────────────────────────────────────────────────
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  try {
    const res = await fetch(LATEST_JSON_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const data = await res.json();
    if (!isNewer(data.version, app.getVersion())) return;

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'KeyFlow アップデート',
      message: `新バージョン ${data.version} が利用可能です`,
      detail: `現在: ${app.getVersion()}${data.notes ? '\n\n' + data.notes : ''}`,
      buttons: ['ダウンロード', '後で'],
      defaultId: 0,
    });
    if (response === 0) shell.openExternal(data.url);
  } catch { /* ネットワーク不可などは無視 */ }
}

let serverUrls = [];
let win = null;
let tray = null;

// ── Intercept NUMPAD_URL= lines that server.js writes to stdout ──────────────
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, cb) {
  const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const m = s.match(/NUMPAD_URL=(.+)/);
  if (m) {
    const url = m[1].trim();
    if (!serverUrls.includes(url)) {
      serverUrls.push(url);
      sendInfo();
    }
  }
  return _origWrite(chunk, encoding, cb);
};

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-server-info', async () => {
  const url = serverUrls[0];
  if (!url) return null;
  const qr = await qrcode.toDataURL(url, { width: 256, margin: 2,
    color: { dark: '#000000ff', light: '#ffffffff' } });
  return { url, qr };
});

async function sendInfo() {
  if (!win || win.isDestroyed() || !serverUrls[0]) return;
  const url = serverUrls[0];
  const qr = await qrcode.toDataURL(url, { width: 256, margin: 2,
    color: { dark: '#000000ff', light: '#ffffffff' } });
  win.webContents.send('server-info', { url, qr });
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 340,
    height: 430,
    resizable: false,
    title: 'KeyFlow',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  win.webContents.on('did-finish-load', () => {
    if (serverUrls.length > 0) sendInfo();
  });
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const imgPath = path.join(__dirname, 'public', 'icon-192.png');
  const img = nativeImage.createFromPath(imgPath).resize({ width: 16, height: 16 });
  img.setTemplateImage(false);
  tray = new Tray(img);
  tray.setToolTip('KeyFlow');
  tray.on('click', () => {
    if (!win) return;
    win.isVisible() ? win.focus() : win.show();
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'QR コードを表示', click: () => { win?.show(); win?.focus(); } },
    { type: 'separator' },
    { label: '終了', click: () => app.exit(0) },
  ]));
}

// ── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.dock?.hide();

  // Pass resource/data paths to server.js before requiring it
  process.env.APP_RESOURCES_PATH = __dirname;
  process.env.APP_DATA_PATH = app.getPath('userData');

  require('./server.js');

  createWindow();
  createTray();

  // 起動5秒後にアップデート確認（起動を遅らせないため遅延）
  setTimeout(checkForUpdates, 5000);
});

app.on('window-all-closed', () => {}); // never auto-quit; tray keeps app alive
