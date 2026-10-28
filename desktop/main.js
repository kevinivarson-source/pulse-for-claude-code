// Pulse Disc: the Pulse player as a disc floating on your desktop, with no window around it.
// A see-through, frameless, always-on-top window the size of the disc. The corners let clicks through,
// so only the disc itself is there. Test version: plays the starter pack.
const { app, BrowserWindow, Menu, ipcMain, protocol, net, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const SIZE = 240;
const UI = path.join(__dirname, 'disc');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'pulse', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null, dragTimer = null, prefs = {};
const prefsFile = () => path.join(app.getPath('userData'), 'disc.json');
function loadPrefs() { try { prefs = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) || {}; } catch { prefs = {}; } }
function savePrefs() { try { fs.mkdirSync(path.dirname(prefsFile()), { recursive: true }); fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch { /* not critical */ } }

// Where the disc was left last time, if that spot is still on a screen; else the bottom-right corner.
function startPosition() {
  const p = prefs.pos;
  const onScreen = p && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return p.x + SIZE / 2 >= a.x && p.y + SIZE / 2 >= a.y && p.x + SIZE / 2 <= a.x + a.width && p.y + SIZE / 2 <= a.y + a.height;
  });
  if (onScreen) return p;
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - SIZE - 24, y: a.y + a.height - SIZE - 24 };
}

function createWindow() {
  const pos = startPosition();
  win = new BrowserWindow({
    width: SIZE, height: SIZE, x: pos.x, y: pos.y,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: prefs.onTop !== false, show: false, title: 'Pulse Disc',
    icon: path.join(UI, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (prefs.onTop !== false) win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true }); // corners click through until the pointer is on the disc
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.loadURL('pulse://app/index.html');
}

const send = cmd => win && win.webContents.send('cmd', cmd);

// The page tells us whether the pointer is over the disc; outside it, clicks go to whatever is underneath.
ipcMain.on('hit', (e, inside) => { if (win && !dragTimer) win.setIgnoreMouseEvents(!inside, { forward: true }); });

// Dragging: follow the pointer until the page reports the button is up.
ipcMain.on('drag', (e, phase) => {
  if (!win) return;
  clearInterval(dragTimer); dragTimer = null;
  if (phase === 'start') {
    const c = screen.getCursorScreenPoint(), [wx, wy] = win.getPosition(), dx = c.x - wx, dy = c.y - wy;
    dragTimer = setInterval(() => { const p = screen.getCursorScreenPoint(); win.setBounds({ x: p.x - dx, y: p.y - dy, width: SIZE, height: SIZE }); }, 8);
  } else {
    const [x, y] = win.getPosition(); prefs.pos = { x, y }; savePrefs();
  }
});

ipcMain.on('menu', (e, s) => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: s && s.title ? s.title : 'Pulse', enabled: false },
    { type: 'separator' },
    { label: s && s.playing ? 'Pause' : 'Play', click: () => send('toggle') },
    { label: 'Next track', click: () => send('next') },
    { label: s && s.muted ? 'Sound on' : 'Sound off', click: () => send('mute') },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: win.isAlwaysOnTop(), click: m => { win.setAlwaysOnTop(m.checked, 'floating'); prefs.onTop = m.checked; savePrefs(); } },
    { type: 'separator' },
    { label: 'Quit Pulse Disc', click: () => app.quit() },
  ]).popup({ window: win });
});

app.on('second-instance', () => { if (win) win.show(); });
app.whenReady().then(() => {
  loadPrefs();
  // Serve the disc's own files, and nothing outside its folder.
  protocol.handle('pulse', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(UI, rel));
    if (!file.startsWith(UI + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
