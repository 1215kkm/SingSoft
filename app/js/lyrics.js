// 가사: LRC 읽기, LRCLIB 에서 찾기, 노래방식 두 줄 자막 그리기

export function parseLrc(text) {
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '');
    // 글자 단위 시간(<분:초>)이 있으면 글자마다 채운다
    const parts = body.split(/<(\d+):(\d+(?:\.\d+)?)>/);
    let segs = null;
    if (parts.length > 1) {
      segs = [];
      for (let k = 1; k < parts.length; k += 3) segs.push({ t: +parts[k] * 60 + +parts[k + 1], text: parts[k + 2] });
    }
    const words = (segs ? segs.map(x => x.text).join('') : body).trim();
    for (const s of stamps) lines.push({ t: +s[1] * 60 + parseFloat(s[2].replace(':', '.')), text: words, segs });
  }
  return lines.sort((a, b) => a.t - b.t);
}

export async function searchLyrics(query) {
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('가사 서버에 연결하지 못했습니다');
  const list = await res.json();
  return list
    .filter(r => r.syncedLyrics || r.plainLyrics)
    .sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics)
    .slice(0, 12)
    .map(r => ({
      title: r.trackName, artist: r.artistName, duration: r.duration,
      lrc: r.syncedLyrics || null, plain: r.plainLyrics || null,
    }));
}

// 파일 이름에서 노래방 군더더기를 걷어 내고 검색어로 쓴다.
const JUNK = /\b(m\/?v|official|audio|video|lyrics?|live|hd|4k|karaoke|inst\.?|instrumental|mr|teaser)\b|노래방|가사|뮤직비디오|공식|멜로디제거|코러스/i;

export function cleanTitle(name) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/\(([^)]*)\)/g, (m, inner) => JUNK.test(inner) ? ' ' : m)
    .replace(/(TJ|KY|금영)\s*(노래방|karaoke)|\bkaraoke\b|노래방|\bM\/?V\b|\(KY\.\d+\)/gi, ' ')
    .replace(/\s\/\s.*$/, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim();
}

// 두 줄을 번갈아 쓰는 노래방 자막
export class LyricsView {
  constructor(root) {
    this.root = root;
    this.rows = [root.querySelector('[data-row="0"]'), root.querySelector('[data-row="1"]')];
    this.lines = [];
    this.plain = null;
    this.offset = 0;
    this.shown = [-1, -1];
  }

  load(song) {
    this.lines = song?.lrc ? parseLrc(song.lrc) : [];
    this.plain = !this.lines.length && song?.plain ? song.plain : null;
    this.offset = song?.lyricsOffset || 0;
    this.shown = [-1, -1];
    this.root.hidden = !this.lines.length;
    this.rows.forEach(r => { r.textContent = ''; r.style.setProperty('--p', '0%'); r.classList.remove('on'); });
  }

  // 지금 줄은 빈 줄 하나에, 다음 줄은 다른 줄에 미리 띄운다.
  update(time) {
    const L = this.lines;
    if (!L.length) return;
    const t = time + this.offset;
    let i = -1;
    for (let k = 0; k < L.length; k++) { if (L[k].t <= t) i = k; else break; }
    const cur = i < 0 ? 0 : i;
    const slot = cur % 2, other = 1 - slot;
    this._show(slot, cur);
    this._show(other, cur + 1);
    const line = L[cur], next = L[cur + 1];
    let p = 0;
    if (i >= 0 && line.segs) {
      p = this._segProgress(slot, line, next, t);
    } else if (i >= 0) {
      const dur = Math.min((next ? next.t : line.t + 5) - line.t, 10);
      p = Math.max(0, Math.min(1, (t - line.t) / (dur * 0.92)));
    }
    this.rows[slot].style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    this.rows[slot].classList.toggle('on', i >= 0);
    this.rows[other].style.setProperty('--p', '0%');
    this.rows[other].classList.remove('on');
  }

  _show(slot, idx) {
    if (this.shown[slot] === idx) return;
    this.shown[slot] = idx;
    const line = this.lines[idx];
    this.rows[slot].textContent = line ? (line.text || '♪') : '';
    this.rows[slot]._edges = null;
  }

  // 글자 경계가 줄 폭의 몇 %인지 실제 글자 위치로 잰다 (창 크기가 바뀌면 다시 잰다)
  _edges(slot, line) {
    const row = this.rows[slot], w = row.getBoundingClientRect().width;
    if (row._edges && row._edgesW === w) return row._edges;
    const node = row.firstChild, edges = [];
    if (!node || !w) return [];
    const left = row.getBoundingClientRect().left, range = document.createRange();
    let pos = 0;
    const joined = line.segs.map(x => x.text).join('');
    const lead = joined.length - joined.trimStart().length;   // 화면 글에서 잘린 앞 공백
    for (const sg of line.segs) {
      const a = Math.max(0, Math.min(node.length, pos - lead));
      const b = Math.max(0, Math.min(node.length, pos - lead + sg.text.trimEnd().length));
      range.setStart(node, a); range.setEnd(node, Math.max(a, b));
      const r = range.getBoundingClientRect();
      edges.push([(r.left - left) / w, (r.right - left) / w]);
      pos += sg.text.length;
    }
    row._edges = edges; row._edgesW = w;
    return edges;
  }

  _segProgress(slot, line, next, t) {
    const segs = line.segs, edges = this._edges(slot, line);
    if (!edges.length) return 0;
    let k = -1;
    for (let j = 0; j < segs.length; j++) { if (segs[j].t <= t) k = j; else break; }
    if (k < 0) return 0;
    const end = segs[k + 1]?.t ?? Math.min(next ? next.t : segs[k].t + 1.5, segs[k].t + 1.5);
    const f = Math.max(0, Math.min(1, (t - segs[k].t) / Math.max(0.05, Math.min(end - segs[k].t, 1.2))));
    const [a, b] = edges[k];
    return a + (b - a) * f;
  }
}
