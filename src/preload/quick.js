import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('quickApi', {
  submit: (content) => ipcRenderer.invoke('notes:create', content),
  hide: () => ipcRenderer.invoke('quick:hide')
})
