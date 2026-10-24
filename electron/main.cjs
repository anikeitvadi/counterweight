// CryptoDesk desktop shell: loads the built web app, talks to the exchanges directly
// (no relay needed — CORS headers are added in-process), keeps a tray icon and an
// always-on-top option so it can sit beside a trading screen.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.CRYPTODESK_DEV_URL; // e.g. http://localhost:5180 when running `vite`
const DIST = path.join(__dirname, '..', 'dist');
const EXCHANGE_HOSTS = ['api.india.delta.exchange', 'www.okx.com', 'www.deribit.com'];
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');

let win = null;
let tray = null;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return {};
  }
}
function saveState(patch) {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...loadState(), ...patch }));
  } catch {
    /* ignore */
  }
}

// Serve dist/ over a proper origin so fetch('/api/...'), service workers and storage behave like a website.
protocol.registerSchemesAsPrivileged([{ scheme: 'cryptodesk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

function registerAppProtocol() {
  protocol.handle('cryptodesk', async (request) => {
    const url = new URL(request.url);
    // The web build calls /api/okx/* for OKX's statistics endpoints; proxy them from the main process.
    if (url.pathname.startsWith('/api/okx/')) {
      const upstream = `https://www.okx.com/api/v5/${url.pathname.replace('/api/okx/', '')}${url.search}`;
      return net.fetch(upstream, { headers: { accept: 'application/json' } });
    }
    let file = decodeURIComponent(url.pathname);
    if (file === '/' || file === '') file = '/index.html';
    const target = path.normalize(path.join(DIST, file));
    if (!target.startsWith(DIST) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString());
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function allowExchangeCors() {
  const filter = { urls: EXCHANGE_HOSTS.map((h) => `https://${h}/*`) };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('access-control-allow-')) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    callback({ responseHeaders: headers });
  });
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width ?? 520,
    height: st.height ?? 860,
    x: st.x,
    y: st.y,
    minWidth: 380,
    minHeight: 480,
    title: 'CryptoDesk',
    backgroundColor: '#0d0d0d',
    alwaysOnTop: !!st.alwaysOnTop,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  const hash = st.widget === false ? '' : '#widget';
  if (DEV_URL) win.loadURL(`${DEV_URL}/${hash}`);
  else win.loadURL(`cryptodesk://app/${hash}`);

  win.on('close', () => {
    const b = win.getBounds();
    saveState({ ...b, alwaysOnTop: win.isAlwaysOnTop(), widget: win.webContents.getURL().includes('#widget') });
  });
  win.on('closed', () => (win = null));
  // external links open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('cryptodesk://') && !(DEV_URL && url.startsWith(DEV_URL))) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  if (process.env.CRYPTODESK_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.capturePage();
        fs.writeFileSync(process.env.CRYPTODESK_SHOT, img.toPNG());
        app.quit();
      }, Number(process.env.CRYPTODESK_SHOT_DELAY ?? 15000));
    });
  }
}

function toggleAlwaysOnTop() {
  if (!win) return;
  win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating');
  saveState({ alwaysOnTop: win.isAlwaysOnTop() });
  buildMenus();
}

function setView(widget) {
  if (!win) return;
  win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(widget ? 'widget' : '')}; void 0;`);
  saveState({ widget });
}

function buildMenus() {
  const onTop = win ? win.isAlwaysOnTop() : false;
  const viewItems = [
    { label: 'Widget view', accelerator: 'CmdOrCtrl+1', click: () => setView(true) },
    { label: 'Full desk', accelerator: 'CmdOrCtrl+2', click: () => setView(false) },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: onTop, accelerator: 'CmdOrCtrl+T', click: toggleAlwaysOnTop },
    { type: 'separator' },
    { role: 'reload' },
    { role: 'togglefullscreen' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
  ];
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] }] : []),
    { label: 'View', submenu: viewItems },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Help', submenu: [{ label: 'Keyboard shortcuts', click: () => win?.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (tray) {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show CryptoDesk', click: () => showWindow() },
        { label: 'Widget view', click: () => { showWindow(); setView(true); } },
        { label: 'Full desk', click: () => { showWindow(); setView(false); } },
        { label: 'Always on top', type: 'checkbox', checked: onTop, click: toggleAlwaysOnTop },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  }
}

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') icon.setTemplateImage(false);
  tray = new Tray(icon);
  tray.setToolTip('CryptoDesk');
  tray.on('click', () => showWindow());
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  registerAppProtocol();
  allowExchangeCors();
  createTray();
  createWindow();
  buildMenus();
  app.on('activate', () => showWindow());
});

app.on('window-all-closed', () => {
  // keep running in the tray on Windows/Linux; standard quit on macOS is via the menu
  if (process.platform !== 'darwin') {
    /* stay alive for the tray */
  }
});
