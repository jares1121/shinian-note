import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { copyFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

let db
let dbFile

// 标题取正文第一行非空内容（跳过纯图片行），截断 30 字；无内容则为「无标题」
function deriveTitle(content) {
  const line = (content || '')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s.length > 0 && !s.startsWith('!['))
  if (!line) return '无标题'
  return line.length > 30 ? line.slice(0, 30) + '…' : line
}

// LIKE 通配符转义（用 ! 作转义符）
function escapeLike(keyword) {
  return keyword.replace(/[!%_]/g, (m) => '!' + m)
}

export function initDB() {
  if (db) db.close() // 恢复备份后重开
  dbFile = join(app.getPath('userData'), 'shinian.db')
  db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS note_tags (
      noteId INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (noteId, tagId)
    );
  `)

  // 轻量迁移：老库补提醒相关列
  const cols = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name)
  if (!cols.includes('remindAt')) {
    db.exec('ALTER TABLE notes ADD COLUMN remindAt INTEGER')
  }
  if (!cols.includes('reminded')) {
    db.exec('ALTER TABLE notes ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.includes('remindRepeat')) {
    // '' 不重复 / 'daily' 每天 / 'workday' 工作日 / 'weekly:1,3,5' 每周指定星期（0=周日）
    db.exec("ALTER TABLE notes ADD COLUMN remindRepeat TEXT NOT NULL DEFAULT ''")
  }
  if (!cols.includes('deletedAt')) {
    // 回收站：NULL = 正常，非 NULL = 已删除（毫秒时间戳），30 天后自动清除
    db.exec('ALTER TABLE notes ADD COLUMN deletedAt INTEGER')
  }
  if (!cols.includes('pinned')) {
    // 置顶：0/1，置顶笔记在列表最上方单独成组
    db.exec('ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.includes('uid')) {
    // 同步用的稳定标识：本地 id 是自增整数，多台机器会撞号，云端只认 uid
    db.exec('ALTER TABLE notes ADD COLUMN uid TEXT')
  }
  if (!cols.includes('changedAt')) {
    // 任意字段变更的时间戳，只用于同步冲突判定
    // 不能复用 updatedAt：置顶/改标签不该打乱列表的时间排序
    db.exec('ALTER TABLE notes ADD COLUMN changedAt INTEGER NOT NULL DEFAULT 0')
  }

  // 给历史数据补 uid / changedAt
  const legacy = db
    .prepare("SELECT id, updatedAt FROM notes WHERE uid IS NULL OR uid = '' OR changedAt = 0")
    .all()
  if (legacy.length) {
    const fix = db.prepare('UPDATE notes SET uid = ?, changedAt = ? WHERE id = ?')
    const tx = db.transaction((rows) => {
      for (const r of rows) fix.run(randomUUID(), r.changedAt || r.updatedAt, r.id)
    })
    tx(legacy)
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_uid ON notes(uid)')

  // 彻底删除的墓碑：告诉其他设备「这条是真删了」，否则下次拉取会被云端复活
  db.exec(`
    CREATE TABLE IF NOT EXISTS tombstones (
      uid TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
  `)
}

// 回收站保留天数
export const TRASH_KEEP_DAYS = 30

// 清掉超过保留期的回收站笔记，返回条数（启动时调用）
export function purgeExpired(keepDays = TRASH_KEEP_DAYS) {
  const cutoff = Date.now() - keepDays * 86400000
  const rows = db
    .prepare('SELECT id, uid FROM notes WHERE deletedAt IS NOT NULL AND deletedAt <= ?')
    .all(cutoff)
  if (rows.length === 0) return 0

  const now = Date.now()
  const tx = db.transaction((list) => {
    const del = db.prepare('DELETE FROM notes WHERE id = ?')
    const tomb = db.prepare('INSERT OR REPLACE INTO tombstones (uid, at) VALUES (?, ?)')
    for (const r of list) {
      if (r.uid) tomb.run(r.uid, now) // 留墓碑，避免云端把已清空的笔记同步回来
      del.run(r.id)
    }
  })
  tx(rows)
  return rows.length
}

// 重复提醒规则是否命中某天（0=周日）
function matchRepeatDay(day, repeat) {
  const w = day.getDay()
  if (repeat === 'daily') return true
  if (repeat === 'workday') return w >= 1 && w <= 5
  if (repeat.startsWith('weekly:')) {
    const days = repeat.slice(7).split(',').map(Number)
    return days.includes(w)
  }
  return false
}

// 首次触发时间：沿用所选时间点，从"现在"起找最近一个匹配日
export function firstRepeatTime(pickedMs, repeat, now = Date.now()) {
  const picked = new Date(pickedMs)
  const d = new Date(now)
  d.setHours(picked.getHours(), picked.getMinutes(), picked.getSeconds(), 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  for (let i = 0; i < 8; i++) {
    if (matchRepeatDay(d, repeat)) return d.getTime()
    d.setDate(d.getDate() + 1)
  }
  return null
}

// 触发后顺延到下一次
export function nextRepeatTime(remindAt, repeat) {
  const d = new Date(remindAt)
  for (let i = 0; i < 8; i++) {
    d.setDate(d.getDate() + 1)
    if (matchRepeatDay(d, repeat)) return d.getTime()
  }
  return null
}

// 一键备份当前数据库到指定文件（better-sqlite3 在线备份，返回 Promise）
export function backupDB(dest) {
  return db.backup(dest)
}

// 用备份文件覆盖当前库并重新打开
export function restoreDB(backupFile) {
  db.close()
  copyFileSync(backupFile, dbFile)
  initDB()
}

// 整体替换某条笔记的标签关联（不触碰 changedAt，同步合并时用）
function replaceTags(noteId, names) {
  db.prepare('DELETE FROM note_tags WHERE noteId = ?').run(noteId)
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insNT = db.prepare('INSERT OR IGNORE INTO note_tags (noteId, tagId) VALUES (?, ?)')
  for (const raw of names) {
    const name = String(raw).trim()
    if (!name) continue
    insTag.run(name)
    insNT.run(noteId, getTag.get(name).id)
  }
}

// 给一组笔记挂上各自的标签数组
function attachTags(notes) {
  if (notes.length === 0) return notes
  const rows = db
    .prepare(
      `SELECT nt.noteId, t.id, t.name
       FROM note_tags nt JOIN tags t ON t.id = nt.tagId
       ORDER BY t.name`
    )
    .all()
  const byNote = new Map()
  for (const r of rows) {
    if (!byNote.has(r.noteId)) byNote.set(r.noteId, [])
    byNote.get(r.noteId).push({ id: r.id, name: r.name })
  }
  for (const n of notes) n.tags = byNote.get(n.id) ?? []
  return notes
}

export const notesRepo = {
  // filter: { keyword?, tagId?, from?, to? }（from/to 为 updatedAt 毫秒时间戳，左闭右开）
  list(filter = {}) {
    const { keyword = '', tagId = null, from = null, to = null } = filter
    let sql = 'SELECT n.* FROM notes n'
    const conds = ['n.deletedAt IS NULL'] // 回收站里的不参与所有列表/搜索
    const params = []
    if (tagId) {
      sql += ' JOIN note_tags nt ON nt.noteId = n.id'
      conds.push('nt.tagId = ?')
      params.push(tagId)
    }
    if (keyword) {
      conds.push("(n.title LIKE ? ESCAPE '!' OR n.content LIKE ? ESCAPE '!')")
      const k = `%${escapeLike(keyword)}%`
      params.push(k, k)
    }
    if (from != null) {
      conds.push('n.updatedAt >= ?')
      params.push(from)
    }
    if (to != null) {
      conds.push('n.updatedAt < ?')
      params.push(to)
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ')
    sql += ' ORDER BY n.pinned DESC, n.updatedAt DESC'
    return attachTags(db.prepare(sql).all(...params))
  },
  get(id) {
    return attachTags([db.prepare('SELECT * FROM notes WHERE id = ?').get(id)])[0]
  },
  create(content = '') {
    const now = Date.now()
    const info = db
      .prepare(
        'INSERT INTO notes (uid, title, content, createdAt, updatedAt, changedAt) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), deriveTitle(content), content, now, now, now)
    return this.get(info.lastInsertRowid)
  },
  update(id, content) {
    const now = Date.now()
    db.prepare(
      'UPDATE notes SET content = ?, title = ?, updatedAt = ?, changedAt = ? WHERE id = ?'
    ).run(content, deriveTitle(content), now, now, id)
    return this.get(id)
  },
  // 删除 = 移入回收站（软删除，30 天内可恢复）
  remove(id) {
    const now = Date.now()
    db.prepare('UPDATE notes SET deletedAt = ?, changedAt = ? WHERE id = ?').run(now, now, id)
  },

  // 置顶 / 取消置顶
  setPinned(id, pinned) {
    db.prepare('UPDATE notes SET pinned = ?, changedAt = ? WHERE id = ?').run(
      pinned ? 1 : 0,
      Date.now(),
      id
    )
  },
  // 批量移入回收站（一次事务，避免逐条广播）
  removeMany(ids) {
    const now = Date.now()
    const tx = db.transaction((list) => {
      const stmt = db.prepare('UPDATE notes SET deletedAt = ?, changedAt = ? WHERE id = ?')
      for (const id of list) stmt.run(now, now, id)
    })
    tx(ids)
  },

  /* ---------- 回收站 ---------- */
  // 回收站列表（按删除时间倒序）
  listDeleted() {
    return attachTags(
      db.prepare('SELECT * FROM notes WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC').all()
    )
  },
  // 从回收站恢复
  restoreMany(ids) {
    const now = Date.now()
    const tx = db.transaction((list) => {
      const stmt = db.prepare('UPDATE notes SET deletedAt = NULL, changedAt = ? WHERE id = ?')
      for (const id of list) stmt.run(now, id)
    })
    tx(ids)
  },
  // 彻底删除（note_tags 由外键级联清理），同时留墓碑防止云端复活
  purgeMany(ids) {
    const tx = db.transaction((list) => {
      const get = db.prepare('SELECT uid FROM notes WHERE id = ?')
      const del = db.prepare('DELETE FROM notes WHERE id = ?')
      const tomb = db.prepare('INSERT OR REPLACE INTO tombstones (uid, at) VALUES (?, ?)')
      for (const id of list) {
        const row = get.get(id)
        if (row?.uid) tomb.run(row.uid, Date.now())
        del.run(id)
      }
    })
    tx(ids)
  },
  // 切换账号时清空本地笔记与墓碑（note_tags 由外键级联清理；标签本身保留）
  clearAll() {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM tombstones').run()
      db.prepare('DELETE FROM notes').run()
    })
    tx()
  },
  // 整体替换一条笔记的标签（传标签名数组，自动建标签）
  setTags(noteId, names) {
    const tx = db.transaction(() => {
      replaceTags(noteId, names)
      db.prepare('UPDATE notes SET changedAt = ? WHERE id = ?').run(Date.now(), noteId)
    })
    tx()
    return this.get(noteId)
  },
  // 给多条笔记追加标签（保留各自原有标签）
  addTags(noteIds, names) {
    const now = Date.now()
    const tx = db.transaction(() => {
      const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
      const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
      const insNT = db.prepare('INSERT OR IGNORE INTO note_tags (noteId, tagId) VALUES (?, ?)')
      const touch = db.prepare('UPDATE notes SET changedAt = ? WHERE id = ?')
      for (const noteId of noteIds) {
        for (const raw of names) {
          const name = String(raw).trim()
          if (!name) continue
          insTag.run(name)
          insNT.run(noteId, getTag.get(name).id)
        }
        touch.run(now, noteId)
      }
    })
    tx()
  },
  // 设置/取消提醒（remindAt 为毫秒时间戳，null 表示取消；重设时重置已提醒标记）
  setReminder(id, remindAt, repeat = '') {
    db.prepare(
      'UPDATE notes SET remindAt = ?, remindRepeat = ?, reminded = 0, changedAt = ? WHERE id = ?'
    ).run(remindAt ?? null, remindAt ? repeat ?? '' : '', Date.now(), id)
    return this.get(id)
  },
  // 到点且未提醒的笔记（回收站里的不再提醒）
  dueReminders(now) {
    return db
      .prepare(
        'SELECT * FROM notes WHERE deletedAt IS NULL AND remindAt IS NOT NULL AND reminded = 0 AND remindAt <= ?'
      )
      .all(now)
  },
  markReminded(id) {
    db.prepare('UPDATE notes SET reminded = 1 WHERE id = ?').run(id)
  },
  // 统计页聚合数据（createdAt 毫秒，本地时区按天/月分组；不含回收站里的）
  stats() {
    const del = 'deletedAt IS NULL'
    const dayExpr = "date(createdAt/1000, 'unixepoch', 'localtime')"
    const monthExpr = "strftime('%Y-%m', createdAt/1000, 'unixepoch', 'localtime')"
    return {
      total: db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${del}`).get().c,
      todayCount: db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${del} AND ${dayExpr} = date('now', 'localtime')`).get().c,
      monthCount: db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${del} AND ${monthExpr} = strftime('%Y-%m', 'now', 'localtime')`).get().c,
      totalChars: db.prepare(`SELECT COALESCE(SUM(LENGTH(content)), 0) AS c FROM notes WHERE ${del}`).get().c,
      daily: db.prepare(`SELECT ${dayExpr} AS day, COUNT(*) AS count FROM notes WHERE ${del} GROUP BY day ORDER BY day`).all(),
      monthly: db.prepare(`SELECT ${monthExpr} AS month, COUNT(*) AS count FROM notes WHERE ${del} GROUP BY month ORDER BY month`).all(),
      tagCounts: db.prepare(
        `SELECT t.name, COUNT(nt.noteId) AS count
         FROM tags t JOIN note_tags nt ON nt.tagId = t.id
         WHERE EXISTS (SELECT 1 FROM notes n WHERE n.id = nt.noteId AND n.deletedAt IS NULL)
         GROUP BY t.id ORDER BY count DESC, t.name LIMIT 12`
      ).all()
    }
  },
  /* ---------- 云同步 ---------- */
  // 导出全部笔记（含回收站）+ 墓碑，给云端做快照
  snapshot() {
    const rows = db.prepare('SELECT * FROM notes ORDER BY id').all()
    attachTags(rows)
    const notes = rows.map((r) => ({
      uid: r.uid,
      title: r.title,
      content: r.content,
      tags: (r.tags || []).map((t) => t.name),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      changedAt: r.changedAt,
      deletedAt: r.deletedAt,
      pinned: r.pinned ? 1 : 0,
      remindAt: r.remindAt,
      remindRepeat: r.remindRepeat || ''
    }))
    const tombstones = db.prepare('SELECT uid, at FROM tombstones').all()
    return { notes, tombstones, updatedAt: Date.now() }
  },

  // 把云端数据合并进本地：逐条比 changedAt，远端更新才覆盖
  applyRemote(remote) {
    const result = { inserted: 0, updated: 0, skipped: 0, removed: 0 }
    if (!remote) return result

    const remoteNotes = Array.isArray(remote.notes) ? remote.notes : []
    const remoteTomb = Array.isArray(remote.tombstones) ? remote.tombstones : []

    const tx = db.transaction(() => {
      // 墓碑优先：远端明确说「彻底删了」的，本地也删掉
      for (const t of remoteTomb) {
        if (!t?.uid) continue
        db.prepare('INSERT OR IGNORE INTO tombstones (uid, at) VALUES (?, ?)').run(t.uid, t.at || 0)
        for (const row of db.prepare('SELECT id FROM notes WHERE uid = ?').all(t.uid)) {
          db.prepare('DELETE FROM notes WHERE id = ?').run(row.id)
          result.removed++
        }
      }

      const localTomb = new Set(db.prepare('SELECT uid FROM tombstones').all().map((r) => r.uid))
      const getLocal = db.prepare('SELECT * FROM notes WHERE uid = ?')

      for (const it of remoteNotes) {
        if (!it?.uid) continue
        if (localTomb.has(it.uid)) continue // 本地已彻底删除，不再复活

        const local = getLocal.get(it.uid)
        const remoteChanged = Number(it.changedAt) || Number(it.updatedAt) || 0

        if (!local) {
          const info = db
            .prepare(
              `INSERT INTO notes (uid, title, content, createdAt, updatedAt, changedAt,
                                  deletedAt, pinned, remindAt, remindRepeat)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              it.uid,
              it.title ?? '',
              it.content ?? '',
              Number(it.createdAt) || Date.now(),
              Number(it.updatedAt) || Date.now(),
              remoteChanged,
              it.deletedAt ?? null,
              it.pinned ? 1 : 0,
              it.remindAt ?? null,
              it.remindRepeat ?? ''
            )
          replaceTags(info.lastInsertRowid, it.tags || [])
          result.inserted++
          continue
        }

        if (remoteChanged <= (local.changedAt || 0)) {
          result.skipped++ // 本地更新或一样新，保留本地
          continue
        }

        db.prepare(
          `UPDATE notes SET title = ?, content = ?, createdAt = ?, updatedAt = ?,
                            changedAt = ?, deletedAt = ?, pinned = ?, remindAt = ?, remindRepeat = ?
           WHERE id = ?`
        ).run(
          it.title ?? '',
          it.content ?? '',
          Number(it.createdAt) || local.createdAt,
          Number(it.updatedAt) || local.updatedAt,
          remoteChanged,
          it.deletedAt ?? null,
          it.pinned ? 1 : 0,
          it.remindAt ?? null,
          it.remindRepeat ?? '',
          local.id
        )
        replaceTags(local.id, it.tags || [])
        result.updated++
      }
    })
    tx()
    return result
  }
}

export const tagsRepo = {
  // 所有标签 + 各自有效笔记数（回收站里的不计入；空标签也保留并显示）
  list() {
    return db
      .prepare(
        `SELECT t.id, t.name,
           (SELECT COUNT(*) FROM note_tags nt
            JOIN notes n ON n.id = nt.noteId
            WHERE nt.tagId = t.id AND n.deletedAt IS NULL) AS count
         FROM tags t
         GROUP BY t.id
         ORDER BY count DESC, t.name`
      )
      .all()
  },
  // 新建标签（已存在则直接返回）
  create(name) {
    const n = String(name).trim()
    if (!n) return null
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(n)
    return db.prepare('SELECT id, name FROM tags WHERE name = ?').get(n)
  },
  // 删除标签（只解除与笔记的关联，不删笔记）
  remove(id) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM note_tags WHERE tagId = ?').run(id)
      db.prepare('DELETE FROM tags WHERE id = ?').run(id)
    })
    tx()
  }
}
