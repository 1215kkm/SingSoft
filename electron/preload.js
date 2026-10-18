const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  search: q => ipcRenderer.invoke('yt:search', q),
  download: (id, kind) => ipcRenderer.invoke('yt:download', { id, kind }),
  cancel: id => ipcRenderer.invoke('yt:cancel', id),
  onProgress: fn => ipcRenderer.on('yt:progress', (_e, p) => fn(p)),
  trash: fileName => ipcRenderer.invoke('lib:trash', fileName),
  exists: fileName => ipcRenderer.invoke('lib:exists', fileName),
  openFolder: () => ipcRenderer.invoke('lib:openFolder'),
});
