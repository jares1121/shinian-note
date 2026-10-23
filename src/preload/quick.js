import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickApi', {
  submit: (content) => ipcRenderer.invoke('notes:create', content),
  hide: () => ipcRenderer.invoke('quick:hide'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('win:drag-end')
})
