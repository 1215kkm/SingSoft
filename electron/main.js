// 주아방 PC 앱 — 화면(app/)을 로컬 서버로 띄우고, 유튜브 검색·받기를 yt-dlp 로 처리한다.
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

// 포트를 고정해야 IndexedDB(노래 목록)가 매번 같은 곳에 남는다.
const PORT = 47821;
const APP_DIR = path.join(__dirname, '..', 'app');
const SONGS_DIR = path.join(app.getPath('music'), '주아방 노래');
fs.mkdirSync(SONGS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    }
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url.startsWith('/media/')) {
      const file = path.join(SONGS_DIR, path.basename(url));
      return sendFile(req, res, file);
    }
    const rel = url === '/' ? 'index.html' : url.slice(1);
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
    sendFile(req, res, file);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// ---- yt-dlp ----
function ytDlpPath() {
  const bundled = path.join(process.resourcesPath, 'bin', 'yt-dlp.exe');
  if (fs.existsSync(bundled)) return bundled;
  const dev = path.join(__dirname, '..', 'vendor', 'yt-dlp.exe');
  if (fs.existsSync(dev)) return dev;
  return 'yt-dlp';
}

function ffmpegPath() {
  try { return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'); } catch { return null; }
}

// 유튜브는 JS 런타임이 있어야 영상을 받을 수 있다. 앱 자신(Electron)을 node 로 돌려서 쓴다.
function ytArgs(extra) {
  const args = ['--js-runtimes', `node:${process.execPath}`, '--no-playlist', '--encoding', 'utf-8'];
  const ff = ffmpegPath();
  if (ff) args.push('--ffmpeg-location', ff);
  return args.concat(extra);
}
const ytEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' });

function runYt(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytDlpPath(), ytArgs(args), { env: ytEnv(), windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(lastError(err) || `yt-dlp 종료 코드 ${code}`)));
  });
}
const lastError = s => (s.split(/\r?\n/).filter(l => l.startsWith('ERROR')).pop() || '').replace(/^ERROR:\s*/, '');

ipcMain.handle('yt:search', async (_e, query) => {
  const out = await runYt(['--flat-playlist', '-J', `ytsearch15:${query}`]);
  const data = JSON.parse(out);
  return (data.entries || []).map(e => ({
    id: e.id, title: e.title, duration: e.duration, channel: e.channel || e.uploader || '',
    thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
  }));
});

const downloads = new Map();
ipcMain.handle('yt:download', (e, { id, kind }) => new Promise((resolve, reject) => {
  if (downloads.has(id)) return reject(new Error('이미 받는 중입니다'));
  const fmt = kind === 'audio'
    ? ['-f', 'ba[ext=m4a]/ba', '-o', path.join(SONGS_DIR, '%(id)s.%(ext)s')]
    : ['-f', 'bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4',
       '-o', path.join(SONGS_DIR, '%(id)s.%(ext)s')];
  const args = [...fmt, '--http-chunk-size', '10M', '--retries', '10', '--newline', '--progress',
    '--progress-template', 'download:PCT %(progress._percent_str)s',
    '--print', 'after_move:FILE %(filepath)s', '--print', 'after_move:META %(title)s\t%(duration)s\t%(channel)s',
    `https://www.youtube.com/watch?v=${id}`];
  const p = spawn(ytDlpPath(), ytArgs(args), { env: ytEnv(), windowsHide: true });
  downloads.set(id, p);
  // 영상+소리 두 덩어리를 차례로 받으므로 진행률을 반씩 나눠 보여 준다.
  let part = 0, lastPct = 0, file = null, meta = null, err = '';
  const parts = kind === 'audio' ? 1 : 2;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', chunk => {
    for (const line of chunk.split(/\r?\n/)) {
      let m;
      if ((m = /^PCT\s+([\d.]+)%/.exec(line.trim()))) {
        const pct = +m[1];
        if (pct < lastPct - 50) part++;
        lastPct = pct;
        e.sender.send('yt:progress', { id, percent: Math.min(99, ((Math.min(part, parts - 1) + pct / 100) / parts) * 100) });
      } else if (line.startsWith('FILE ')) file = line.slice(5).trim();
      else if (line.startsWith('META ')) {
        const [title, duration, channel] = line.slice(5).split('\t');
        meta = { title, duration: +duration || 0, channel };
      }
    }
  });
  p.stderr.on('data', d => err += d);
  p.on('error', er => { downloads.delete(id); reject(er); });
  p.on('close', code => {
    downloads.delete(id);
    if (code === 0 && file) resolve({ fileName: path.basename(file), ...meta });
    else if (p.killed) reject(new Error('취소했습니다'));
    else reject(new Error(lastError(err) || '받기에 실패했습니다'));
  });
}));

ipcMain.handle('yt:cancel', (_e, id) => {
  const p = downloads.get(id);
  if (p) { p.kill(); return true; }
  return false;
});

ipcMain.handle('lib:trash', async (_e, fileName) => {
  const file = path.join(SONGS_DIR, path.basename(fileName));
  if (fs.existsSync(file)) await shell.trashItem(file);
  return true;
});
ipcMain.handle('lib:openFolder', () => shell.openPath(SONGS_DIR));
ipcMain.handle('lib:exists', (_e, fileName) => fs.existsSync(path.join(SONGS_DIR, path.basename(fileName))));

// 유튜브는 자주 바뀌어서 yt-dlp 를 하루 한 번 조용히 최신으로 올린다.
function updateYtDlpDaily() {
  const stamp = path.join(app.getPath('userData'), 'ytdlp-updated');
  try { if (Date.now() - fs.statSync(stamp).mtimeMs < 86400000) return; } catch {}
  const p = spawn(ytDlpPath(), ['-U'], { windowsHide: true });
  p.on('close', () => { try { fs.writeFileSync(stamp, String(Date.now())); } catch {} });
  p.on('error', () => {});
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'speaker-selection', 'audioCapture'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'speaker-selection', 'audioCapture'].includes(perm));
  try { await startServer(); }
  catch {
    // 같은 앱이 이미 켜져 있으면 포트가 겹친다.
  }
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 380, minHeight: 600, backgroundColor: '#1d1a26', title: '주아방',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  updateYtDlpDaily();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.restore(); w.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
