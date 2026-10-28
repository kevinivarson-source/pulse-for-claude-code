// The only bridge between the disc page and the window around it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('disc', {
  hit: inside => ipcRenderer.send('hit', Boolean(inside)),
  drag: phase => ipcRenderer.send('drag', phase === 'start' ? 'start' : 'end'),
  menu: state => ipcRenderer.send('menu', { title: String(state.title || ''), playing: Boolean(state.playing), muted: Boolean(state.muted) }),
  on: fn => ipcRenderer.on('cmd', (e, cmd) => fn(cmd)),
});
