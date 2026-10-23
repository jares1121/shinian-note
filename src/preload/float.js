import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('floatApi', {
  // 写一条笔记（直接创建，不走主编辑区）
  submit: (content) => ipcRenderer.invoke('notes:create', content),
  // 关闭悬浮窗，换回主窗口
  close: () => ipcRenderer.invoke('float:close'),
  // 主动收进右边
  dockNow: () => ipcRenderer.invoke('float:dock-now'),
  // 点贴边后露出的小把手，把窗口滑出来
  undockNow: () => ipcRenderer.invoke('float:undock-now'),
  // 自绘拖拽：拖动区域需要抓手光标，原生 app-region 做不到
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  // 主进程通知：拖到右边 → 贴边；贴边后鼠标进入 → 滑出
  onDockState: (cb) => {
    const listener = (_e, docked) => cb(docked)
    ipcRenderer.on('float:dock-state', listener)
    return () => ipcRenderer.removeListener('float:dock-state', listener)
  }
})
