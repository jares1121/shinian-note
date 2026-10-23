import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('reminderApi', {
  getList: () => ipcRenderer.invoke('reminder:list'),
  open: (id) => ipcRenderer.invoke('reminder:open', id),
  dismissAll: () => ipcRenderer.invoke('reminder:dismissAll'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  onList: (callback) => {
    const listener = (_e, list) => callback(list)
    ipcRenderer.on('reminder:update', listener)
    return () => ipcRenderer.removeListener('reminder:update', listener)
  }
})
