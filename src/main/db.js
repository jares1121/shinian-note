import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { copyFileSync } from 'node:fs'

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
    const conds = []
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
    sql += ' ORDER BY n.updatedAt DESC'
    return attachTags(db.prepare(sql).all(...params))
  },
  get(id) {
    return attachTags([db.prepare('SELECT * FROM notes WHERE id = ?').get(id)])[0]
  },
  create(content = '') {
    const now = Date.now()
    const info = db
      .prepare('INSERT INTO notes (title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
      .run(deriveTitle(content), content, now, now)
    return this.get(info.lastInsertRowid)
  },
  update(id, content) {
    db.prepare('UPDATE notes SET content = ?, title = ?, updatedAt = ? WHERE id = ?').run(
      content,
      deriveTitle(content),
      Date.now(),
      id
    )
    return this.get(id)
  },
  remove(id) {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  },
  // 批量删除（一次事务，避免逐条广播）
  removeMany(ids) {
    const tx = db.transaction((list) => {
      const stmt = db.prepare('DELETE FROM notes WHERE id = ?')
      for (const id of list) stmt.run(id)
    })
    tx(ids)
  },
  // 整体替换一条笔记的标签（传标签名数组，自动建标签）
  setTags(noteId, names) {
    const tx = db.transaction(() => {
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
    })
    tx()
    return this.get(noteId)
  },
  // 给多条笔记追加标签（保留各自原有标签）
  addTags(noteIds, names) {
    const tx = db.transaction(() => {
      const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
      const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
      const insNT = db.prepare('INSERT OR IGNORE INTO note_tags (noteId, tagId) VALUES (?, ?)')
      for (const noteId of noteIds) {
        for (const raw of names) {
          const name = String(raw).trim()
          if (!name) continue
          insTag.run(name)
          insNT.run(noteId, getTag.get(name).id)
        }
      }
    })
    tx()
  },
  // 设置/取消提醒（remindAt 为毫秒时间戳，null 表示取消；重设时重置已提醒标记）
  setReminder(id, remindAt) {
    db.prepare('UPDATE notes SET remindAt = ?, reminded = 0 WHERE id = ?').run(remindAt ?? null, id)
    return this.get(id)
  },
  // 到点且未提醒的笔记
  dueReminders(now) {
    return db
      .prepare('SELECT * FROM notes WHERE remindAt IS NOT NULL AND reminded = 0 AND remindAt <= ?')
      .all(now)
  },
  markReminded(id) {
    db.prepare('UPDATE notes SET reminded = 1 WHERE id = ?').run(id)
  },
  // 统计页聚合数据（createdAt 毫秒，本地时区按天/月分组）
  stats() {
    const dayExpr = "date(createdAt/1000, 'unixepoch', 'localtime')"
    const monthExpr = "strftime('%Y-%m', createdAt/1000, 'unixepoch', 'localtime')"
    return {
      total: db.prepare('SELECT COUNT(*) AS c FROM notes').get().c,
      todayCount: db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${dayExpr} = date('now', 'localtime')`).get().c,
      monthCount: db.prepare(`SELECT COUNT(*) AS c FROM notes WHERE ${monthExpr} = strftime('%Y-%m', 'now', 'localtime')`).get().c,
      totalChars: db.prepare('SELECT COALESCE(SUM(LENGTH(content)), 0) AS c FROM notes').get().c,
      daily: db.prepare(`SELECT ${dayExpr} AS day, COUNT(*) AS count FROM notes GROUP BY day ORDER BY day`).all(),
      monthly: db.prepare(`SELECT ${monthExpr} AS month, COUNT(*) AS count FROM notes GROUP BY month ORDER BY month`).all(),
      tagCounts: db.prepare(
        `SELECT t.name, COUNT(nt.noteId) AS count
         FROM tags t JOIN note_tags nt ON nt.tagId = t.id
         GROUP BY t.id ORDER BY count DESC, t.name LIMIT 12`
      ).all()
    }
  }
}

export const tagsRepo = {
  // 所有标签 + 各自笔记数（没有笔记的空标签也保留并显示）
  list() {
    return db
      .prepare(
        `SELECT t.id, t.name, COUNT(nt.noteId) AS count
         FROM tags t LEFT JOIN note_tags nt ON nt.tagId = t.id
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
