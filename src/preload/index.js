import { contextBridge, ipcRenderer } from 'electron'

// 渲染进程只能访问这里暴露的白名单 API
contextBridge.exposeInMainWorld('api', {
  listNotes: (filter) => ipcRenderer.invoke('notes:list', filter),
  createNote: (content) => ipcRenderer.invoke('notes:create', content),
  updateNote: (id, content) => ipcRenderer.invoke('notes:update', id, content),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  deleteNotes: (ids) => ipcRenderer.invoke('notes:deleteMany', ids),
  setNotePin: (id, pinned) => ipcRenderer.invoke('notes:set-pin', id, pinned),
  listDeletedNotes: () => ipcRenderer.invoke('notes:listDeleted'),
  restoreNotes: (ids) => ipcRenderer.invoke('notes:restoreMany', ids),
  purgeNotes: (ids) => ipcRenderer.invoke('notes:purgeMany', ids),
  addTagsToNotes: (ids, names) => ipcRenderer.invoke('notes:addTags', ids, names),
  createTag: (name) => ipcRenderer.invoke('tags:create', name),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  setNoteTags: (id, names) => ipcRenderer.invoke('notes:setTags', id, names),
  setNoteReminder: (id, remindAt, repeat) => ipcRenderer.invoke('notes:setReminder', id, remindAt, repeat),
  getStats: () => ipcRenderer.invoke('notes:stats'),
  exportNote: (id) => ipcRenderer.invoke('notes:exportOne', id),
  exportAllNotes: () => ipcRenderer.invoke('notes:exportAll'),
  backupNow: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  saveImage: (bytes, mime) => ipcRenderer.invoke('images:save', bytes, mime),
  listTags: () => ipcRenderer.invoke('tags:list'),

  // 云同步：本地快照 / 合并云端数据
  syncSnapshot: () => ipcRenderer.invoke('sync:snapshot'),
  syncApply: (remote) => ipcRenderer.invoke('sync:apply', remote),
  syncClear: () => ipcRenderer.invoke('sync:clear'),

  // 退出前补同步：主进程通知渲染进程跑一轮，完成后回执
  onFlushSync: (callback) => {
    ipcRenderer.on('app:flush-sync', () => callback())
  },
  flushSyncDone: () => ipcRenderer.send('sync:flush-done'),

  // 通用配置 / 关于 / 检查更新
  getAppConfig: () => ipcRenderer.invoke('app:get-config'),
  setAppConfig: (patch) => ipcRenderer.invoke('app:set-config', patch),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateInfo: () => ipcRenderer.invoke('app:get-update'),
  checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: (info) => ipcRenderer.invoke('app:download-update', info),
  cancelUpdateDownload: () => ipcRenderer.invoke('app:cancel-update-download'),
  installUpdate: (path) => ipcRenderer.invoke('app:install-update', path),
  onUpdateProgress: (callback) => {
    const listener = (_e, progress) => callback(progress)
    ipcRenderer.on('app:update-progress', listener)
    return () => ipcRenderer.removeListener('app:update-progress', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onUpdateAvailable: (callback) => {
    const listener = (_e, info) => callback(info)
    ipcRenderer.on('app:update-available', listener)
    return () => ipcRenderer.removeListener('app:update-available', listener)
  },
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
  },

  // 窗口控制（自绘标题栏用）
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winToggleFloat: () => ipcRenderer.invoke('float:toggle'),
  floatGetConfig: () => ipcRenderer.invoke('float:get-config'),
  floatSetTop: (v) => ipcRenderer.invoke('float:set-top', v),

  // 自绘拖拽：拖动区域需要抓手光标，原生 app-region 做不到
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('win:drag-end')
})
