import { Engine, ECHO_PRESETS } from './audio.js';
import { LyricsView, searchLyrics, cleanTitle } from './lyrics.js';
import { library, newId } from './library.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const desktop = window.desktop || null;
document.body.classList.toggle('is-desktop', !!desktop);

// ---------- 저장해 두는 값 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('jab.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jab.' + k, JSON.stringify(v)); } catch {} },
};

const engine = new Engine(store.get('latency', 'fast'));
engine.set(store.get('audio', {}));
const saveAudio = () => store.set('audio', engine.settings);

const video = $('#video');
const lyricsView = new LyricsView($('#lyrics'));

let songs = [];
let current = null;          // 지금 부르는 곡
let queue = store.get('queue', []);
let ytPlayer = null;         // 웹에서 쓰는 유튜브 재생기
let pendingDelete = null;

const fmt = s => !isFinite(s) || s < 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 알림 ----------
let toastTimer;
function toast(msg, action, onAction, ms = 4000) {
  clearTimeout(toastTimer);
  $('#toastMsg').textContent = msg;
  const btn = $('#toastAct');
  btn.hidden = !action;
  if (action) { btn.textContent = action; btn.onclick = () => { $('#toast').hidden = true; onAction(); }; }
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

// ---------- 말풍선 (마우스를 올리면 바로) ----------
const tip = $('#tip');
document.addEventListener('pointerover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el || e.pointerType === 'touch') return;
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
  let x = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), innerWidth - tr.width - 8);
  let y = r.bottom + 8;
  if (y + tr.height > innerHeight - 8) y = r.top - tr.height - 8;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) tip.hidden = true; });

// ---------- 화면 나누기 (폰) ----------
function setPane(p) {
  document.body.dataset.pane = p;
  $$('.mtabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === p));
  store.set('pane', p);
}
$$('.mtabs button').forEach(b => b.onclick = () => setPane(b.dataset.pane));
setPane(store.get('pane', 'songs'));

function setLibTab(t) {
  $$('[data-libtab]').forEach(b => b.classList.toggle('on', b.dataset.libtab === t));
  $('#viewMine').hidden = t !== 'mine';
  $('#viewYt').hidden = t !== 'yt';
  store.set('libtab', t);
}
$$('[data-libtab]').forEach(b => b.onclick = () => setLibTab(b.dataset.libtab));
setLibTab(store.get('libtab', 'mine'));

// ---------- 내 노래 목록 ----------
function songUrl(s) {
  if (s.src) return s.src;
  if (s.fileName) return `/media/${encodeURIComponent(s.fileName)}`;
  if (s.blob) { s._url ||= URL.createObjectURL(s.blob); return s._url; }
  return null;
}

function kindBadge(s) {
  if (s.isRec) return '내 녹음';
  if (s.builtin) return '기본 곡';
  if (s.ytId && !s.fileName) return '유튜브 링크';
  if (s.ytId) return s.isVideo ? '노래방 영상' : '원곡';
  return s.isVideo ? '영상 파일' : '음악 파일';
}

// 기본 곡(app/songs)은 화면 파일과 같이 온다. 자막 시간·가사를 고치면 그 값만 따로 저장한다.
let builtins = null;
async function loadBuiltins() {
  if (builtins) return builtins;
  try {
    const list = await fetch('songs/index.json').then(r => r.json());
    builtins = list.map(b => ({ ...b, builtin: true, isVideo: false, addedAt: 0 }));
  } catch { builtins = []; }
  return builtins;
}

async function refreshSongs() {
  const [db, base] = await Promise.all([library.all(), loadBuiltins()]);
  const saved = new Map(db.filter(s => s.builtin).map(s => [s.id, s]));
  songs = [
    ...db.filter(s => !s.builtin),
    ...base.map(b => {
      const o = saved.get(b.id);
      return o ? { ...b, lyricsOffset: o.lyricsOffset || 0, lrc: 'lrc' in o ? o.lrc : b.lrc } : { ...b };
    }),
  ];
  if (current) current = songs.find(s => s.id === current.id) || current;
  renderSongs();
  renderQueue();
}

function renderSongs() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const list = songs.filter(s => s.id !== pendingDelete?.id && (!q || `${s.title} ${s.artist || ''}`.toLowerCase().includes(q)));
  $('#libEmpty').hidden = songs.length > 0;
  $('#songList').innerHTML = list.map(s => `
    <li data-id="${s.id}" class="${current?.id === s.id ? 'playing' : ''}">
      <div class="meta">
        <div class="t">${esc(s.title)}</div>
        <div class="s"><span class="badge">${kindBadge(s)}</span>${s.lrc ? '<span class="badge ly">가사</span>' : ''}${s.artist ? `<span>${esc(s.artist)}</span>` : ''}${s.duration ? `<span>${fmt(s.duration)}</span>` : ''}</div>
      </div>
      <div class="acts">
        ${s.isRec
          ? `<button class="btn primary" data-act="play">듣기</button><button class="btn" data-act="save" data-tip="녹음을 파일로 내려받습니다">저장</button>`
          : `<button class="btn primary" data-act="play">부르기</button><button class="btn" data-act="queue" data-tip="다음에 부를 곡으로 예약합니다">예약</button>`}
        ${s.builtin ? '' : '<button class="btn del" data-act="del" aria-label="지우기" data-tip="목록에서 지웁니다 (받은 파일은 휴지통으로)">🗑</button>'}
      </div>
    </li>`).join('');
  if (!list.length && songs.length) $('#songList').innerHTML = `<li class="empty">「${esc(q)}」에 맞는 노래가 없습니다</li>`;
}

$('#libSearch').oninput = renderSongs;
$('#songList').onclick = e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const song = songs.find(s => s.id === btn.closest('li').dataset.id);
  if (!song) return;
  if (btn.dataset.act === 'play') playSong(song);
  else if (btn.dataset.act === 'queue') addToQueue(song);
  else if (btn.dataset.act === 'del') deleteSong(song);
  else if (btn.dataset.act === 'save') downloadRec(song);
};

function deleteSong(song) {
  if (pendingDelete) finishDelete();
  pendingDelete = song;
  queue = queue.filter(id => id !== song.id);
  saveQueue();
  renderSongs();
  toast(`「${song.title}」을 지웠습니다`, '되돌리기', () => { pendingDelete = null; renderSongs(); }, 6000);
  pendingDelete.timer = setTimeout(finishDelete, 6000);
}
async function finishDelete() {
  const s = pendingDelete;
  if (!s) return;
  clearTimeout(s.timer);
  pendingDelete = null;
  await library.remove(s.id);
  if (s.fileName && desktop && !songs.some(o => o.id !== s.id && o.fileName === s.fileName)) await desktop.trash(s.fileName);
  songs = songs.filter(o => o.id !== s.id);
  renderSongs();
}
addEventListener('beforeunload', () => { if (pendingDelete) { library.remove(pendingDelete.id); } });

// ---------- 파일 올리기 ----------
$('#addFiles').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
const dropZone = $('#paneSongs');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drop-on'); });
dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drop-on'); });
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drop-on'); addFiles([...e.dataTransfer.files]); });

const baseName = n => n.replace(/\.[^.]+$/, '').toLowerCase();

async function addFiles(files) {
  const lrcs = files.filter(f => /\.lrc$/i.test(f.name));
  const media = files.filter(f => !/\.lrc$/i.test(f.name) && (/^(audio|video)\//.test(f.type) || /\.(mp3|m4a|mp4|wav|flac|ogg|webm|mkv|aac)$/i.test(f.name)));
  const added = [];
  for (const f of media) {
    const lrcFile = lrcs.find(l => baseName(l.name) === baseName(f.name));
    const song = {
      id: newId(), title: cleanTitle(f.name) || f.name, blob: f, mime: f.type,
      isVideo: f.type.startsWith('video/') || /\.(mp4|webm|mkv)$/i.test(f.name),
      lrc: lrcFile ? await lrcFile.text() : null, addedAt: Date.now(),
    };
    await library.put(song);
    added.push(song);
  }
  // 이미 있는 곡에 가사 파일만 따로 올린 경우
  let attached = 0;
  for (const l of lrcs) {
    if (added.some(s => s.lrc && baseName(s.title) === baseName(l.name))) continue;
    const target = songs.find(s => baseName(s.title) === cleanTitle(l.name).toLowerCase()) || (lrcs.length === 1 && !media.length ? current : null);
    if (target) { target.lrc = await l.text(); await library.put(stripRuntime(target)); attached++; if (target === current) lyricsView.load(current); }
  }
  await refreshSongs();
  if (added.length) {
    toast(`${added.length}곡을 넣었습니다`, '바로 부르기', () => playSong(songs.find(s => s.id === added[0].id)));
    for (const s of added) if (!s.lrc && !s.isVideo) autoLyrics(s);
  } else if (attached) toast(`가사 ${attached}개를 붙였습니다`);
  else if (files.length) toast('노래 파일이 아닙니다. MP3·M4A·MP4·WAV 파일을 올려 주세요.');
}

const stripRuntime = s => { const { _url, timer, ...rest } = s; return rest; };

// 원곡에는 가사를 자동으로 찾아 붙인다.
async function autoLyrics(song) {
  try {
    const found = (await searchLyrics(cleanTitle(song.title))).find(r => r.lrc);
    if (!found) return;
    const fresh = await library.get(song.id);
    if (!fresh || fresh.lrc) return;
    fresh.lrc = found.lrc;
    fresh.artist ||= found.artist;
    await library.put(fresh);
    await refreshSongs();
    if (current?.id === song.id) { current.lrc = found.lrc; lyricsView.load(current); }
  } catch { /* 가사 서버가 안 되면 조용히 넘어간다 */ }
}

// ---------- 예약 ----------
const saveQueue = () => store.set('queue', queue);
function addToQueue(song) {
  if (!current) return playSong(song);
  queue.push(song.id);
  saveQueue();
  renderQueue();
  toast(`「${song.title}」 예약 — ${queue.length}번째`);
}
function renderQueue() {
  queue = queue.filter(id => songs.some(s => s.id === id));
  const items = queue.map((id, i) => ({ s: songs.find(x => x.id === id), i }));
  $('#queueBox').hidden = !items.length;
  $('#queueList').innerHTML = items.map(({ s, i }) => `<li>${i + 1}. ${esc(s.title)}<button data-qi="${i}" aria-label="예약 빼기">✕</button></li>`).join('');
  $('#nextBtn').disabled = !items.length;
}
$('#queueList').onclick = e => {
  const b = e.target.closest('[data-qi]');
  if (!b) return;
  queue.splice(+b.dataset.qi, 1);
  saveQueue(); renderQueue();
};
function playNext() {
  const id = queue.shift();
  saveQueue();
  const s = songs.find(x => x.id === id);
  if (s) playSong(s); else { renderQueue(); endOfSongs(); }
}
$('#nextBtn').onclick = playNext;

// ---------- 재생 ----------
const player = {
  get mode() { return current?.ytId && !current?.fileName ? 'yt' : 'media'; },
  time() { return this.mode === 'yt' ? (ytPlayer?.getCurrentTime?.() || 0) : video.currentTime; },
  duration() { return this.mode === 'yt' ? (ytPlayer?.getDuration?.() || 0) : (video.duration || 0); },
  paused() { return this.mode === 'yt' ? ytPlayer?.getPlayerState?.() !== 1 : video.paused; },
  play() { this.mode === 'yt' ? ytPlayer?.playVideo() : video.play(); },
  pause() { this.mode === 'yt' ? ytPlayer?.pauseVideo() : video.pause(); },
  seek(t) { this.mode === 'yt' ? ytPlayer?.seekTo(t, true) : (video.currentTime = t); },
};

async function playSong(song) {
  await engine.ensure();
  engine.connectMedia(video);
  video.pause();
  if (ytPlayer?.stopVideo) ytPlayer.stopVideo();
  current = song;
  $('#screenMsg').hidden = true;
  $('#nowTitle').textContent = song.title;
  $('#idleTitle').textContent = song.title;
  $('#idleSub').textContent = song.artist || '';
  lyricsView.load(song);
  updateOffset();
  ['#playBtn', '#seek', '#lyricsBtn', '[data-off="0.25"]', '[data-off="-0.25"]'].forEach(s => $(s).disabled = false);

  if (player.mode === 'yt') {
    video.hidden = true;
    $('#ytWrap').hidden = false;
    $('#idle').hidden = true;
    $('#screen').classList.remove('audio-only');
    await loadYt(song.ytId);
  } else {
    $('#ytWrap').hidden = true;
    const url = songUrl(song);
    if (desktop && song.fileName && !(await desktop.exists(song.fileName))) {
      showScreenMsg('받은 파일을 찾을 수 없습니다. 폴더에서 지웠다면 유튜브에서 다시 받아 주세요.');
      return;
    }
    video.hidden = !song.isVideo;
    $('#idle').hidden = song.isVideo;
    $('#screen').classList.toggle('audio-only', !song.isVideo);
    video.src = url;
    video.play().catch(() => {});
  }
  renderSongs();
  keepScreenOn();
  if (innerWidth <= 900) scrollTo({ top: 0, behavior: 'smooth' });
}

function endOfSongs() {
  current = null;
  video.removeAttribute('src'); video.load(); video.hidden = true;
  $('#ytWrap').hidden = true;
  $('#idle').hidden = false;
  $('#screen').classList.remove('audio-only');
  $('#idleTitle').textContent = '주아방';
  $('#idleSub').textContent = '노래를 고르고 「부르기」를 누르세요';
  $('#nowTitle').textContent = '고른 노래 없음';
  lyricsView.load(null);
  ['#playBtn', '#seek', '#lyricsBtn', '[data-off="0.25"]', '[data-off="-0.25"]'].forEach(s => $(s).disabled = true);
  renderSongs();
}

video.addEventListener('ended', () => queue.length ? playNext() : endOfSongs());
video.addEventListener('error', () => { if (current && player.mode === 'media' && video.getAttribute('src')) showScreenMsg('이 파일은 재생할 수 없는 형식입니다. MP3·M4A·MP4 로 바꿔 올려 주세요.'); });

function showScreenMsg(html) {
  $('#screenMsg').innerHTML = html;
  $('#screenMsg').hidden = false;
}

$('#playBtn').onclick = async () => {
  await engine.ensure();
  player.paused() ? player.play() : player.pause();
};
let seeking = false;
$('#seek').addEventListener('input', () => { seeking = true; $('#tCur').textContent = fmt($('#seek').value / 1000 * player.duration()); });
$('#seek').addEventListener('change', () => { player.seek($('#seek').value / 1000 * player.duration()); seeking = false; });

// 스페이스 = 재생/멈춤
addEventListener('keydown', e => {
  if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName) || !current) return;
  e.preventDefault();
  $('#playBtn').click();
});

// ---------- 유튜브 재생기 (웹·폰) ----------
let ytApi;
function ytApiReady() {
  ytApi ||= new Promise(resolve => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return ytApi;
}
async function loadYt(id) {
  await ytApiReady();
  if (ytPlayer) { ytPlayer.loadVideoById(id); return; }
  await new Promise(resolve => {
    ytPlayer = new YT.Player('ytEmbed', {
      videoId: id,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: e => { e.target.playVideo(); resolve(); },
        onStateChange: e => { if (e.data === 0) queue.length ? playNext() : endOfSongs(); },
        onError: e => {
          const blocked = e.data === 101 || e.data === 150;
          showScreenMsg(blocked
            ? `이 영상은 올린 사람이 다른 곳 재생을 막아 두었습니다.<br><a class="btn primary" href="https://www.youtube.com/watch?v=${current.ytId}" target="_blank" rel="noopener">유튜브에서 열기 ↗</a>`
            : '영상을 불러오지 못했습니다. 링크를 확인해 주세요.');
          resolve();
        },
      },
    });
  });
}

// ---------- 유튜브에서 찾기 ----------
let ytMode = store.get('ytmode', 'karaoke');
function setYtMode(m) {
  ytMode = m;
  $$('[data-ytmode]').forEach(b => b.classList.toggle('on', b.dataset.ytmode === m));
  store.set('ytmode', m);
  updateYtOpen();
}
$$('[data-ytmode]').forEach(b => b.onclick = () => setYtMode(b.dataset.ytmode));
function updateYtOpen() {
  const q = $('#ytQuery').value.trim();
  $('#ytOpen').href = `https://www.youtube.com/results?search_query=${encodeURIComponent((q ? q + ' ' : '') + (ytMode === 'karaoke' ? '노래방' : ''))}`;
}
$('#ytQuery').addEventListener('input', updateYtOpen);
setYtMode(ytMode);

const ytIdFrom = s => (/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(s) || [])[1] || (/^[\w-]{11}$/.test(s) ? s : null);

let ytResults = [];
const ytState = {};   // id → {percent} 받는 중

$('#ytForm').onsubmit = async e => {
  e.preventDefault();
  const q = $('#ytQuery').value.trim();
  if (!q) return;
  const linkId = ytIdFrom(q);
  if (!desktop) {
    if (!linkId) { toast('유튜브 링크를 붙여 넣어 주세요. 찾기는 「유튜브에서 노래방 영상 찾기」를 누르세요.'); return; }
    return addYtLink(linkId);
  }
  const go = $('#ytGo');
  if (go.disabled) return;
  go.disabled = true; go.textContent = '찾는 중…';
  $('#ytList').innerHTML = '<li class="empty">유튜브에서 찾고 있습니다…</li>';
  try {
    ytResults = linkId
      ? [{ id: linkId, title: '붙여 넣은 링크의 영상', channel: '', thumb: `https://i.ytimg.com/vi/${linkId}/mqdefault.jpg` }]
      : await desktop.search(ytMode === 'karaoke' ? `${q} 노래방` : q);
    renderYt();
  } catch (err) {
    $('#ytList').innerHTML = `<li class="empty">찾지 못했습니다: ${esc(err.message)}<br>인터넷 연결을 확인하고 다시 「찾기」를 누르세요.</li>`;
  } finally { go.disabled = false; go.textContent = '찾기'; }
};

function renderYt() {
  if (!ytResults.length) { $('#ytList').innerHTML = '<li class="empty">결과가 없습니다. 다른 이름으로 찾아보세요.</li>'; return; }
  $('#ytList').innerHTML = ytResults.map(r => {
    const have = songs.find(s => s.ytId === r.id && s.fileName);
    const st = ytState[r.id];
    const acts = have
      ? `<span class="note">받아 둔 곡</span><button class="btn primary" data-yt="play" data-sid="${have.id}">부르기</button>`
      : st
        ? `<div class="prog"><i style="width:${st.percent}%"></i></div><span class="note">${st.percent.toFixed(0)}% 받는 중</span><button class="btn" data-yt="cancel">취소</button>`
        : `<button class="btn primary" data-yt="get" data-tip="${ytMode === 'karaoke' ? '영상째 받습니다 (화면에 가사)' : '소리만 받고 가사를 자동으로 붙입니다'}">받아서 부르기</button>`;
    return `<li data-id="${r.id}">
      <img src="${r.thumb}" alt="" loading="lazy">
      <div class="meta"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.channel)}${r.duration ? ` · ${fmt(r.duration)}` : ''}</div></div>
      <div class="acts">${acts}</div>
    </li>`;
  }).join('');
}

$('#ytList').onclick = async e => {
  const btn = e.target.closest('[data-yt]');
  if (!btn) return;
  const id = btn.closest('li').dataset.id;
  if (btn.dataset.yt === 'play') return playSong(songs.find(s => s.id === btn.dataset.sid));
  if (btn.dataset.yt === 'cancel') return desktop.cancel(id);
  if (ytState[id]) return;
  const kind = ytMode === 'karaoke' ? 'video' : 'audio';
  ytState[id] = { percent: 0 };
  renderYt();
  try {
    const r = await desktop.download(id, kind);
    const info = ytResults.find(x => x.id === id);
    const song = {
      id: newId(), ytId: id, fileName: r.fileName, isVideo: kind === 'video',
      title: cleanTitle(r.title || info?.title || '') || r.title || id, artist: shortChannel(r.channel || info?.channel || ''), duration: r.duration || info?.duration || 0,
      addedAt: Date.now(),
    };
    await library.put(song);
    await refreshSongs();
    toast(`「${song.title}」 받았습니다`, current ? '예약' : '부르기', () => addToQueue(song), 8000);
    if (kind === 'audio') autoLyrics(song);
  } catch (err) {
    toast(`받지 못했습니다: ${err.message}`, '다시 받기', () => btn.click(), 8000);
  } finally {
    delete ytState[id];
    renderYt();
  }
};
desktop?.onProgress(({ id, percent }) => {
  if (!ytState[id]) return;
  ytState[id].percent = percent;
  const li = $(`#ytList li[data-id="${id}"]`);
  if (li?.querySelector('.prog i')) {
    li.querySelector('.prog i').style.width = percent + '%';
    li.querySelector('.note').textContent = `${percent.toFixed(0)}% 받는 중`;
  } else renderYt();
});

// 노래방 채널 이름은 짧게
function shortChannel(c) {
  if (/TJ/i.test(c)) return 'TJ 노래방';
  if (/금영|KY/i.test(c)) return '금영 노래방';
  return c;
}

async function addYtLink(id) {
  let title = '유튜브 노래', artist = '';
  try {
    const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`).then(r => r.json());
    if (r.title) { title = cleanTitle(r.title) || r.title; artist = shortChannel(r.author_name || ''); }
  } catch {}
  const song = { id: newId(), ytId: id, title, artist, isVideo: true, addedAt: Date.now() };
  await library.put(song);
  await refreshSongs();
  $('#ytQuery').value = '';
  setLibTab('mine');
  current ? addToQueue(song) : playSong(song);
}

$('#openFolder').onclick = () => desktop?.openFolder();

// ---------- 가사 ----------
const lyDlg = $('#lyricsDlg');
let lyFound = [];
$('#lyricsBtn').onclick = () => {
  if (!current) return;
  $('#lyQuery').value = cleanTitle(current.title) + (current.artist && !current.ytId ? ' ' + current.artist : '');
  $('#lyText').value = current.lrc || '';
  $('#lyList').innerHTML = current.lrc ? '<li class="empty">지금 붙어 있는 가사가 있습니다. 바꾸려면 다시 찾으세요.</li>' : '';
  lyDlg.showModal();
  if (!current.lrc) $('#lyGo').click();
};
lyDlg.addEventListener('click', e => { if (e.target === lyDlg) lyDlg.close(); });
$('#lyGo').onclick = async () => {
  const q = $('#lyQuery').value.trim();
  if (!q || $('#lyGo').disabled) return;
  $('#lyGo').disabled = true;
  $('#lyList').innerHTML = '<li class="empty">가사를 찾고 있습니다…</li>';
  try {
    lyFound = await searchLyrics(q);
    $('#lyList').innerHTML = lyFound.length ? lyFound.map((r, i) => `
      <li><div class="meta"><div class="t">${esc(r.title)}</div>
        <div class="s"><span class="badge ${r.lrc ? 'ly' : ''}">${r.lrc ? '자막 맞춤' : '글만'}</span>${esc(r.artist)} · ${fmt(r.duration)}</div></div>
        <div class="acts"><button class="btn primary" data-ly="${i}">이 가사 쓰기</button></div></li>`).join('')
      : '<li class="empty">찾은 가사가 없습니다. 제목만 넣거나 가수 이름을 빼고 다시 찾아보세요.</li>';
  } catch (err) {
    $('#lyList').innerHTML = `<li class="empty">${esc(err.message)}</li>`;
  } finally { $('#lyGo').disabled = false; }
};
$('#lyQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lyGo').click(); } });
$('#lyList').onclick = e => {
  const b = e.target.closest('[data-ly]');
  if (!b) return;
  const r = lyFound[+b.dataset.ly];
  if (!r.lrc) { toast('이 가사는 시간이 없어 자막으로 띄울 수 없습니다. 「자막 맞춤」 표시가 있는 가사를 고르세요.'); return; }
  saveLyrics(r.lrc, r.artist);
};
$('#lySave').onclick = () => {
  const t = $('#lyText').value.trim();
  if (!/\[\d+:\d+/.test(t)) { toast('줄마다 [분:초] 시간이 붙은 가사여야 자막으로 나옵니다.'); return; }
  saveLyrics(t);
};
$('#lyClear').onclick = () => saveLyrics(null);
async function saveLyrics(lrc, artist) {
  current.lrc = lrc;
  if (artist && !current.artist) current.artist = artist;
  await library.put(stripRuntime(current));
  lyricsView.load(current);
  lyDlg.close();
  await refreshSongs();
  toast(lrc ? '가사를 붙였습니다' : '가사를 지웠습니다');
}

// 자막 시간 맞추기 (곡마다 기억)
function updateOffset() {
  const v = current?.lyricsOffset || 0;
  $('#offsetVal').textContent = `${v > 0 ? '+' : ''}${v.toFixed(2).replace(/0$/, '')}초`;
}
$$('[data-off]').forEach(b => b.onclick = async () => {
  if (!current) return;
  current.lyricsOffset = Math.round(((current.lyricsOffset || 0) + +b.dataset.off) * 100) / 100;
  lyricsView.offset = current.lyricsOffset;
  updateOffset();
  await library.put(stripRuntime(current));
});

// ---------- 노래 소리 ----------
function bindRange(input, key, show) {
  const label = input.parentElement.querySelector('span');
  const paint = () => { if (label) label.textContent = show(+input.value); };
  input.value = engine.settings[key];
  paint();
  input.addEventListener('input', () => {
    engine.set({ [key]: +input.value });
    paint();
    saveAudio();
    if (input.dataset.fx) markPreset();
  });
}
const pct = v => `${Math.round(v * 100)}%`;
bindRange($('#songVol'), 'songVolume', pct);

function paintVocal() { $('#vocalBtn').classList.toggle('on', engine.settings.vocalCut); }
$('#vocalBtn').onclick = () => { engine.set({ vocalCut: !engine.settings.vocalCut }); saveAudio(); paintVocal(); if (current?.ytId && !current.fileName) toast('유튜브 링크 곡은 목소리 줄이기가 되지 않습니다. PC 앱에서 받은 곡에 쓰세요.'); };
paintVocal();

// ---------- 마이크 ----------
let micOn = false;
const micPrefs = store.get('mics', ['', 'none']);

async function fillDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const ins = devs.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  $$('.microw').forEach((row, slot) => {
    const sel = row.querySelector('.mic-sel');
    const first = slot === 0 ? '<option value="">기본 마이크</option>' : '<option value="none">쓰지 않음</option>';
    sel.innerHTML = first + ins.map(d => `<option value="${d.deviceId}">${esc(d.label || '마이크')}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === micPrefs[slot]) ? micPrefs[slot] : sel.options[0].value;
  });
  const outs = devs.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const canPick = 'setSinkId' in AudioContext.prototype && outs.length;
  $('#outRow').hidden = !canPick;
  if (canPick) {
    $('#outSel').innerHTML = '<option value="">기본 스피커</option>' + outs.map(d => `<option value="${d.deviceId}">${esc(d.label || '스피커')}</option>`).join('');
    const want = store.get('out', '');
    $('#outSel').value = [...$('#outSel').options].some(o => o.value === want) ? want : '';
  }
  paintBtHint();
}

function paintBtHint() {
  const labels = $$('.mic-sel').map(s => s.selectedOptions[0]?.textContent || '');
  $('#btHint').hidden = !labels.some(l => /bluetooth|hands-?free|핸즈프리|헤드셋|headset|\bBT\b|airpods|buds/i.test(l));
}

async function startMic(slot) {
  const sel = $$('.mic-sel')[slot];
  if (sel.value === 'none') { engine.stopMic(slot); return; }
  await engine.setMic(slot, sel.value || '');
}

async function turnMicOn() {
  const btn = $('#micBtn');
  btn.disabled = true; btn.textContent = '켜는 중…';
  try {
    await engine.ensure();
    if (store.get('out', '')) await engine.setOutput(store.get('out', '')).catch(() => {});
    await engine.setMic(0, micPrefs[0] || '');
    await fillDevices();
    if ($$('.mic-sel')[0].value !== (micPrefs[0] || '')) await startMic(0);
    await startMic(1);
    micOn = true;
  } catch (err) {
    micOn = false;
    engine.stopMic(0); engine.stopMic(1);
    const denied = err.name === 'NotAllowedError';
    toast(denied ? '마이크 사용이 막혀 있습니다. 주소창 왼쪽 자물쇠 → 마이크 「허용」 후 다시 누르세요.' : `마이크를 켜지 못했습니다: ${err.message}`, '다시 켜기', turnMicOn, 10000);
  } finally {
    btn.disabled = false;
    paintMicBtn();
  }
}
function turnMicOff() {
  engine.stopMic(0); engine.stopMic(1);
  micOn = false;
  paintMicBtn();
}
function paintMicBtn() {
  const b = $('#micBtn');
  b.classList.toggle('on', micOn);
  b.textContent = micOn ? '🎤 마이크 켜짐' : '🎤 마이크 켜기';
  b.dataset.tip = micOn ? '다시 누르면 마이크를 끕니다' : '마이크를 켜서 내 목소리를 스피커로 내보냅니다';
}
$('#micBtn').onclick = () => micOn ? turnMicOff() : turnMicOn();
paintMicBtn();

$$('.mic-sel').forEach((sel, slot) => sel.onchange = async () => {
  micPrefs[slot] = sel.value;
  store.set('mics', micPrefs);
  paintBtHint();
  if (micOn) {
    try { await startMic(slot); toast(`마이크 ${slot + 1}: ${sel.selectedOptions[0].textContent}`); }
    catch (err) { toast(`이 마이크를 켜지 못했습니다: ${err.message}`); }
  }
});
$$('.mic-vol').forEach((inp, slot) => {
  const label = inp.parentElement.querySelector('span');
  inp.value = engine.settings.micVolume[slot];
  label.textContent = pct(inp.value);
  inp.oninput = () => {
    const mv = [...engine.settings.micVolume]; mv[slot] = +inp.value;
    engine.set({ micVolume: mv }); saveAudio();
    label.textContent = pct(inp.value);
  };
});
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (micOn) fillDevices(); });

$('#outSel').onchange = async () => {
  try { await engine.setOutput($('#outSel').value); store.set('out', $('#outSel').value); toast(`스피커: ${$('#outSel').selectedOptions[0].textContent}`); }
  catch (err) { toast(err.message); }
};

function paintMonitor() { $$('[data-monitor]').forEach(b => b.classList.toggle('on', (b.dataset.monitor === '1') === engine.settings.monitor)); }
$$('[data-monitor]').forEach(b => b.onclick = () => { engine.set({ monitor: b.dataset.monitor === '1' }); saveAudio(); paintMonitor(); });
paintMonitor();

const latMode = store.get('latency', 'fast');
$$('[data-lat]').forEach(b => {
  b.classList.toggle('on', b.dataset.lat === latMode);
  b.onclick = () => {
    if (b.dataset.lat === latMode) return;
    store.set('latency', b.dataset.lat);
    toast('바꾼 설정으로 소리를 다시 켭니다…');
    setTimeout(() => location.reload(), 600);
  };
});

// ---------- 에코 ----------
const fxInputs = $$('[data-fx]');
const fxShow = { echo: pct, time: v => `${Math.round(v * 1000)}ms`, feedback: pct, reverb: pct };
fxInputs.forEach(inp => bindRange(inp, inp.dataset.fx, fxShow[inp.dataset.fx]));
function markPreset() {
  const s = engine.settings;
  const match = Object.entries(ECHO_PRESETS).find(([, p]) => Object.keys(p).every(k => Math.abs(p[k] - s[k]) < 0.005));
  $$('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === match?.[0]));
}
$$('[data-preset]').forEach(b => b.onclick = () => {
  engine.set(ECHO_PRESETS[b.dataset.preset]);
  saveAudio();
  fxInputs.forEach(inp => { inp.value = engine.settings[inp.dataset.fx]; inp.parentElement.querySelector('span').textContent = fxShow[inp.dataset.fx](+inp.value); });
  markPreset();
});
markPreset();
$('#fine').open = store.get('fineOpen', false);
$('#fine').addEventListener('toggle', () => store.set('fineOpen', $('#fine').open));

// ---------- 녹음 ----------
let recStart = 0;
$('#recBtn').onclick = async () => {
  const b = $('#recBtn');
  if (!recStart) {
    await engine.ensure();
    try { engine.startRecording(); } catch (err) { toast(`녹음을 시작하지 못했습니다: ${err.message}`); return; }
    recStart = Date.now();
    b.classList.add('on');
    b.dataset.tip = '다시 누르면 녹음을 멈추고 파일로 저장합니다';
    if (!micOn) toast('마이크가 꺼져 있어 목소리가 녹음되지 않습니다. 「🎤 마이크 켜기」를 누르세요.', '마이크 켜기', turnMicOn, 8000);
    else if (current?.ytId && !current.fileName) toast('유튜브 링크 곡은 반주가 녹음되지 않고 목소리만 녹음됩니다.');
  } else {
    recStart = 0;
    b.classList.remove('on');
    b.textContent = '● 녹음';
    b.dataset.tip = '노래와 목소리를 함께 녹음합니다. 다시 누르면 멈추고 「내 노래」에 넣습니다.';
    const blob = await engine.stopRecording();
    if (!blob?.size) return toast('녹음된 소리가 없습니다');
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const rec = {
      id: newId(), isRec: true, isVideo: false, blob, mime: blob.type, addedAt: Date.now(),
      title: `녹음 ${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${current ? ' · ' + current.title : ''}`,
    };
    await library.put(rec);
    await refreshSongs();
    setLibTab('mine');
    toast('녹음을 「내 노래」에 넣었습니다', '듣기', () => playSong(songs.find(s => s.id === rec.id)), 8000);
  }
};

function downloadRec(song) {
  const ext = song.mime?.includes('mp4') ? 'm4a' : 'webm';
  const name = `주아방 ${song.title.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`;
  Object.assign(document.createElement('a'), { href: songUrl(song), download: name }).click();
}

// ---------- 화면 켜 두기 (폰) ----------
let wakeLock = null;
async function keepScreenOn() {
  try { if (!wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => wakeLock = null; } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current) keepScreenOn(); });

// ---------- 매 화면 갱신 ----------
let lastLat = 0;
function frame() {
  if (current) {
    const t = player.time(), d = player.duration();
    lyricsView.update(t);
    if (!seeking) {
      $('#tCur').textContent = fmt(t);
      $('#seek').value = d ? Math.round(t / d * 1000) : 0;
    }
    $('#tDur').textContent = fmt(d);
    const paused = player.paused();
    $('#playBtn').textContent = paused ? '▶' : '❚❚';
    $('#playBtn').setAttribute('aria-label', paused ? '재생' : '멈춤');
  }
  $$('.meter i').forEach((m, i) => { m.style.width = `${Math.min(100, Math.sqrt(engine.level(i)) * 110)}%`; });
  if (recStart) $('#recBtn').textContent = `■ 녹음 ${fmt((Date.now() - recStart) / 1000)}`;
  if (performance.now() - lastLat > 1000) {
    lastLat = performance.now();
    const ms = micOn ? engine.latencyMs() : null;
    const chip = $('#latency');
    chip.textContent = ms == null ? '목소리 지연 —' : `목소리 지연 ${ms}ms`;
    chip.className = 'chip ' + (ms == null ? '' : ms <= 35 ? 'good' : ms <= 70 ? 'mid' : 'slow');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- 시작 ----------
refreshSongs();
if (!desktop && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
