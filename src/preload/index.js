import { contextBridge, ipcRenderer } from 'electron'

// 渲染进程只能访问这里暴露的白名单 API
contextBridge.exposeInMainWorld('api', {
  listNotes: (filter) => ipcRenderer.invoke('notes:list', filter),
  createNote: (content) => ipcRenderer.invoke('notes:create', content),
  updateNote: (id, content) => ipcRenderer.invoke('notes:update', id, content),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  deleteNotes: (ids) => ipcRenderer.invoke('notes:deleteMany', ids),
  addTagsToNotes: (ids, names) => ipcRenderer.invoke('notes:addTags', ids, names),
  createTag: (name) => ipcRenderer.invoke('tags:create', name),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  setNoteTags: (id, names) => ipcRenderer.invoke('notes:setTags', id, names),
  setNoteReminder: (id, remindAt) => ipcRenderer.invoke('notes:setReminder', id, remindAt),
  getStats: () => ipcRenderer.invoke('notes:stats'),
  exportNote: (id) => ipcRenderer.invoke('notes:exportOne', id),
  exportAllNotes: () => ipcRenderer.invoke('notes:exportAll'),
  backupNow: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  saveImage: (bytes, mime) => ipcRenderer.invoke('images:save', bytes, mime),
  listTags: () => ipcRenderer.invoke('tags:list'),
  onNotesChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('notes:changed', listener)
    return () => ipcRenderer.removeListener('notes:changed', listener)
  },
  // 主进程通知点击系统提醒后跳转指定笔记
  onOpenNote: (callback) => {
    const listener = (_e, id) => callback(id)
    ipcRenderer.on('app:openNote', listener)
    return () => ipcRenderer.removeListener('app:openNote', listener)
  }
})
