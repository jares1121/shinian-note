import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('reminderApi', {
  getList: () => ipcRenderer.invoke('reminder:list'),
  open: (id) => ipcRenderer.invoke('reminder:open', id),
  dismissAll: () => ipcRenderer.invoke('reminder:dismissAll'),
  onList: (callback) => {
    const listener = (_e, list) => callback(list)
    ipcRenderer.on('reminder:update', listener)
    return () => ipcRenderer.removeListener('reminder:update', listener)
  }
})
