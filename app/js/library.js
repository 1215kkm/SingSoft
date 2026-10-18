// 노래 목록 저장소 (IndexedDB). 직접 올린 파일은 통째로, PC 에서 받은 유튜브 노래는 파일 이름만 기억한다.
const DB = 'juabang', STORE = 'songs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const library = {
  all: () => tx('readonly', s => s.getAll()).then(list => list.sort((a, b) => b.addedAt - a.addedAt)),
  get: id => tx('readonly', s => s.get(id)),
  put: song => tx('readwrite', s => s.put(song)),
  remove: id => tx('readwrite', s => s.delete(id)),
};

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
