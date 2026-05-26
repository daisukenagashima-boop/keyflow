'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell,
  systemPreferences, Notification,
} = require('electron');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const os       = require('os');
const { execFile } = require('child_process');
const qrcode   = require('qrcode');

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

// リダイレクトを辿りながらファイルをダウンロードする（最大10回）
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const attempt = (u, redirects = 0) => {
      if (redirects > 10) {
        reject(new Error('リダイレクトが多すぎます'));
        return;
      }
      const mod = u.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      mod.get(u, { headers: { 'User-Agent': `KeyFlow/${app.getVersion()}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.destroy();
          attempt(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          file.destroy();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    attempt(url);
  });
}

// DMGをマウントして .app を上書きコピーし再起動する
async function installUpdate(dmgPath) {
  // マウント
  const stdout = await new Promise((resolve, reject) => {
    execFile('hdiutil', ['attach', '-nobrowse', '-readonly', dmgPath], (err, out) => {
      if (err) reject(err); else resolve(out);
    });
  });
  const mountPoint = stdout.trim().split('\n').pop().split('\t').pop().trim();
  const srcApp = path.join(mountPoint, 'KeyFlow.app');
  // 現在の .app の場所に上書き（/Applications 以外に置いた場合も対応）
  const dstApp = path.resolve(app.getPath('exe'), '../../..');

  // まず権限なしで試み、失敗したら管理者パスワードを求める
  const tryCopy = (withAdmin) => new Promise((resolve, reject) => {
    if (!withAdmin) {
      execFile('ditto', [srcApp, dstApp], (err) => err ? reject(err) : resolve());
    } else {
      const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"  );
      const script = `do shell script "ditto '${esc(srcApp)}' '${esc(dstApp)}'" with administrator privileges`;
      execFile('osascript', ['-e', script], (err) => err ? reject(err) : resolve());
    }
  });

  try {
    await tryCopy(false);
  } catch {
    await tryCopy(true);
  }

  execFile('hdiutil', ['detach', mountPoint, '-force'], () => {});
  try { fs.unlinkSync(dmgPath); } catch {}
}

async function checkForUpdates(manual = false) {
  try {
    const res = await fetch(LATEST_JSON_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      if (manual) await dialog.showMessageBox({ type: 'warning', title: 'KeyFlow', message: '更新情報を取得できませんでした', buttons: ['OK'] });
      return;
    }
    const data = await res.json();
    if (!isNewer(data.version, app.getVersion())) {
      if (manual) await dialog.showMessageBox({ type: 'info', title: 'KeyFlow', message: '最新バージョンを使用しています', detail: `現在: v${app.getVersion()}`, buttons: ['OK'] });
      return;
    }

    const canAutoInstall = !!data.download;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'KeyFlow アップデート',
      message: `新バージョン v${data.version} が利用可能です`,
      detail: `現在: v${app.getVersion()}${data.notes ? '\n\n' + data.notes : ''}`,
      buttons: canAutoInstall ? ['自動でインストール', '後で'] : ['ダウンロードページを開く', '後で'],
      defaultId: 0,
    });

    if (response === 1) return;

    if (!canAutoInstall) {
      shell.openExternal(data.url);
      return;
    }

    // ── 自動インストール ──────────────────────────────────────────
    const tmpDmg = path.join(os.tmpdir(), `KeyFlow-${data.version}.dmg`);

    new Notification({ title: 'KeyFlow', body: `v${data.version} をダウンロード中…` }).show();

    try {
      await downloadFile(data.download, tmpDmg);
    } catch (e) {
      await dialog.showMessageBox({ type: 'error', title: 'KeyFlow', message: 'ダウンロードに失敗しました', detail: e.message, buttons: ['OK'] });
      return;
    }

    const { response: installRes } = await dialog.showMessageBox({
      type: 'info',
      title: 'KeyFlow アップデート完了',
      message: `v${data.version} の準備ができました`,
      detail: 'インストールしてアプリを再起動します',
      buttons: ['インストールして再起動', 'あとで'],
      defaultId: 0,
    });
    if (installRes === 1) return;

    try {
      await installUpdate(tmpDmg);
    } catch (e) {
      await dialog.showMessageBox({
        type: 'error', title: 'KeyFlow',
        message: 'インストールに失敗しました',
        detail: e.message + '\n\n手動でインストールしてください',
        buttons: ['ダウンロードページを開く'],
      });
      shell.openExternal(data.url);
      return;
    }

    app.relaunch();
    app.exit(0);

  } catch (e) {
    if (manual) await dialog.showMessageBox({ type: 'warning', title: 'KeyFlow', message: '更新確認中にエラーが発生しました', detail: e.message, buttons: ['OK'] });
  }
}

let iosUrl     = null;
let androidUrl = null;
let win  = null;
let tray = null;

const QR_OPTS = { width: 200, margin: 2, color: { dark: '#000000ff', light: '#ffffffff' } };

// ── Intercept NUMPAD_URL= lines that server.js writes to stdout ──────────────
const _origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, cb) {
  const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const m = s.match(/NUMPAD_URL=(.+)/);
  if (m) {
    const url = m[1].trim();
    if (url.includes('.local')) { if (!iosUrl)     { iosUrl     = url; sendInfo(); } }
    else                        { if (!androidUrl) { androidUrl = url; sendInfo(); } }
  }
  return _origWrite(chunk, encoding, cb);
};

// ── IPC ─────────────────────────────────────────────────────────────────────
async function buildInfo() {
  if (!iosUrl && !androidUrl) return null;
  const makeQR = (u) => qrcode.toDataURL(u, QR_OPTS);
  return {
    ios:     iosUrl     ? { url: iosUrl,     qr: await makeQR(iosUrl)     } : null,
    android: androidUrl ? { url: androidUrl, qr: await makeQR(androidUrl) } : null,
  };
}

ipcMain.handle('get-server-info',    async () => buildInfo());
ipcMain.handle('get-accessibility',  () => systemPreferences.isTrustedAccessibilityClient(false));
ipcMain.handle('get-version',        () => app.getVersion());
ipcMain.on    ('open-accessibility', () => {
  // アプリ更新後は古いバイナリの登録が残り「オンなのに未許可」になる。
  // 設定を開く前に古い TCC エントリをリセットして、ユーザーに新しいバイナリを追加させる。
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    execFile('tccutil', ['reset', 'Accessibility', 'com.nagashimadaisuke.keyflow'], () => {});
  }
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
});

async function sendInfo() {
  if (!win || win.isDestroyed()) return;
  const info = await buildInfo();
  if (info) win.webContents.send('server-info', info);
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 420,
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
    if (iosUrl || androidUrl) sendInfo();
  });
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'QR コードを表示', click: () => { win?.show(); win?.focus(); } },
    { type: 'separator' },
    {
      label: 'ログイン時に自動起動',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: 'アップデートを確認…', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: '終了', click: () => app.exit(0) },
  ]);
}

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
  tray.setContextMenu(buildTrayMenu());
}

// ── Boot ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.dock?.hide();

  process.env.APP_RESOURCES_PATH = __dirname;
  process.env.APP_DATA_PATH = app.getPath('userData');
  process.env.APP_VERSION = app.getVersion();

  require('./server.js');

  createWindow();
  createTray();

  if (!app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
    tray.setContextMenu(buildTrayMenu());
  }

  setTimeout(checkForUpdates, 5000);
});

app.on('window-all-closed', () => {});
