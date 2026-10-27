import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { notesRepo, tagsRepo, backupDB, restoreDB, firstRepeatTime } from './db.js'

// 任何数据变更后广播给所有窗口（主窗口 + 速记窗），各窗口自行刷新
function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('notes:changed')
  }
}

// Windows 文件名非法字符替换
function safeName(s) {
  return (s || '无标题').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 50)
}

export function registerIpc() {
  /* ---------- 云同步 ---------- */
  // 本地快照（全部笔记 + 墓碑），由渲染层上传给云函数
  ipcMain.handle('sync:snapshot', () => notesRepo.snapshot())

  // 把云端数据合并进本地；有实际变化时通知各窗口刷新
  ipcMain.handle('sync:apply', (_e, remote) => {
    const result = notesRepo.applyRemote(remote)
    if (result.inserted || result.updated || result.removed) broadcast()
    return result
  })

  // 切换账号时清空本地数据（避免 A 的笔记被推到 B 的云端）
  ipcMain.handle('sync:clear', () => {
    notesRepo.clearAll()
    broadcast()
  })

  // filter: { keyword?, tagId? }，支持搜索 + 标签筛选
  ipcMain.handle('notes:list', (_e, filter) => notesRepo.list(filter ?? {}))

  ipcMain.handle('notes:create', (_e, content) => {
    const note = notesRepo.create(content ?? '')
    broadcast()
    return note
  })

  ipcMain.handle('notes:update', (_e, id, content) => {
    const note = notesRepo.update(id, content ?? '')
    broadcast()
    return note
  })

  ipcMain.handle('notes:delete', (_e, id) => {
    notesRepo.remove(id)
    broadcast()
  })

  // 批量移入回收站
  ipcMain.handle('notes:deleteMany', (_e, ids) => {
    notesRepo.removeMany(Array.isArray(ids) ? ids : [])
    broadcast()
  })

  // 置顶 / 取消置顶
  ipcMain.handle('notes:set-pin', (_e, id, pinned) => {
    notesRepo.setPinned(id, !!pinned)
    broadcast()
  })

  /* ---------- 回收站 ---------- */
  ipcMain.handle('notes:listDeleted', () => notesRepo.listDeleted())

  ipcMain.handle('notes:restoreMany', (_e, ids) => {
    notesRepo.restoreMany(Array.isArray(ids) ? ids : [])
    broadcast()
  })

  ipcMain.handle('notes:purgeMany', (_e, ids) => {
    notesRepo.purgeMany(Array.isArray(ids) ? ids : [])
    broadcast()
  })

  // 批量追加标签
  ipcMain.handle('notes:addTags', (_e, ids, names) => {
    notesRepo.addTags(Array.isArray(ids) ? ids : [], Array.isArray(names) ? names : [])
    broadcast()
  })

  ipcMain.handle('notes:setTags', (_e, id, names) => {
    const note = notesRepo.setTags(id, Array.isArray(names) ? names : [])
    broadcast()
    return note
  })

  ipcMain.handle('tags:list', () => tagsRepo.list())

  // 新建标签（左侧标签区行内新增）
  ipcMain.handle('tags:create', (_e, name) => {
    const tag = tagsRepo.create(name)
    broadcast()
    return tag
  })

  // 删除标签（不删除笔记）
  ipcMain.handle('tags:delete', (_e, id) => {
    tagsRepo.remove(id)
    broadcast()
  })

  // 设置/取消提醒（remindAt 毫秒时间戳，null 取消；repeat 为空表示不重复）
  ipcMain.handle('notes:setReminder', (_e, id, remindAt, repeat) => {
    const rep = remindAt ? repeat || '' : ''
    // 重复提醒：时间点沿用所选时分秒，日期由规则决定最近一次
    const at = remindAt && rep ? firstRepeatTime(remindAt, rep) : remindAt
    const note = notesRepo.setReminder(id, at, rep)
    broadcast()
    return note
  })

  ipcMain.handle('notes:stats', () => notesRepo.stats())

  // 导出单条笔记为 Markdown（返回 true/false，取消返回 null）
  ipcMain.handle('notes:exportOne', async (e, id) => {
    const note = notesRepo.get(id)
    if (!note) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出笔记',
      defaultPath: `${safeName(note.title)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return null
    writeFileSync(filePath, note.content, 'utf8')
    return true
  })

  // 导出全部笔记到所选文件夹，每条一个 .md（返回条数，取消返回 null）
  ipcMain.handle('notes:exportAll', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths[0]) return null
    const notes = notesRepo.list()
    for (const n of notes) {
      const d = new Date(n.createdAt)
      const p = (x) => String(x).padStart(2, '0')
      const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      writeFileSync(join(filePaths[0], `${day}_${n.id}_${safeName(n.title)}.md`), n.content, 'utf8')
    }
    return notes.length
  })

  // 备份数据库到所选文件
  ipcMain.handle('backup:create', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const day = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '备份数据库',
      defaultPath: `shinian-backup-${day}.db`,
      filters: [{ name: '拾念备份', extensions: ['db'] }]
    })
    if (canceled || !filePath) return null
    await backupDB(filePath)
    return true
  })

  // 从备份文件恢复（覆盖当前库）
  ipcMain.handle('backup:restore', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择备份文件（将覆盖当前全部数据）',
      filters: [{ name: '拾念备份', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    restoreDB(filePaths[0])
    broadcast()
    return true
  })

  // 保存粘贴的图片到 userData/images，返回自定义协议 URL
  ipcMain.handle('images:save', (_e, bytes, mime) => {
    const ext =
      { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] ??
      'png'
    const dir = join(app.getPath('userData'), 'images')
    mkdirSync(dir, { recursive: true })
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    writeFileSync(join(dir, name), bytes)
    return `shinian-img:///${name}`
  })

  // 速记窗请求隐藏自己
  ipcMain.handle('quick:hide', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.hide()
  })
}
