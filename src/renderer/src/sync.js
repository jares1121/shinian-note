// 云同步编排：拉取云端 → 合并到本地 → 回传合并后的快照
// 冲突策略：逐条比 changedAt，谁新谁赢；本地彻底删除的记录不会被云端复活
import { callFunction } from './cloud'

// 云端文件 ID 缓存：云函数返回过就存下来，下次省一次探测
const FILE_ID_KEY = 'shinian.sync.fileId'
const LAST_SYNC_KEY = 'shinian.sync.lastAt'

function getCachedFileId() {
  try {
    return localStorage.getItem(FILE_ID_KEY) || ''
  } catch {
    return ''
  }
}

function setCachedFileId(id) {
  if (!id) return
  try {
    localStorage.setItem(FILE_ID_KEY, id)
  } catch {
    /* 忽略 */
  }
}

export function getLastSyncAt() {
  try {
    return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0
  } catch {
    return 0
  }
}

// 切换账号时清掉上一个账号的缓存，避免拿旧 fileID 去探测
export function clearCachedFileId() {
  try {
    localStorage.removeItem(FILE_ID_KEY)
  } catch {
    /* 忽略 */
  }
}

let running = false
let currentRun = null
let pushTimer = null

// 完整同步一轮
// 已有同步在跑时直接复用它的结果，避免误报「正在同步中」为失败
export async function syncNow() {
  if (running) return currentRun || { ok: false, message: '正在同步中' }
  running = true
  const run = (async () => {
    try {
      const pullRes = await callFunction('pull', { fileID: getCachedFileId() })
      if (!pullRes.ok) return pullRes

      const payload = pullRes.data
      if (!payload || payload.ok === false) {
        return { ok: false, message: payload?.message || '拉取失败' }
      }
      if (payload.fileID) setCachedFileId(payload.fileID)

      const remote = payload.data
      const missing = payload.missing === true
      console.log('[云同步] pull:', missing ? '云端无文件' : JSON.stringify(remote)?.slice(0, 200))
      // 云函数明确报错，或既没有数据也没说明「文件不存在」：视为读取失败，绝不上传
      if (!remote && !missing) {
        return { ok: false, message: payload.message || '读取云端数据失败，已取消上传' }
      }

      let applied = { inserted: 0, updated: 0, removed: 0 }
      if (remote?.notes?.length || remote?.tombstones?.length) {
        applied = await window.api.syncApply(remote)
      }

      // 合并后的本地快照才是权威版本，回传云端
      const snap = await window.api.syncSnapshot()
      // 本地一条都没有时一律不上传：宁可空的，也不能覆盖云端已有数据
      if (!snap.notes.length && !snap.tombstones.length) {
        return { ok: true, applied, total: 0, empty: true }
      }
      const pushRes = await callFunction('push', snap)
      if (!pushRes.ok || pushRes.data?.ok === false) {
        return { ok: false, message: pushRes.message || pushRes.data?.message || '上传失败' }
      }
      if (pushRes.data?.fileID) setCachedFileId(pushRes.data.fileID)

      try {
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
      } catch {
        /* 忽略 */
      }
      return { ok: true, applied, total: snap.notes.length }
    } catch (e) {
      console.error('[云同步] 异常', e)
      return { ok: false, message: '同步失败，请稍后重试' }
    }
  })()
  currentRun = run
  try {
    return await run
  } finally {
    running = false
    if (currentRun === run) currentRun = null
  }
}

// 退出前补同步：有在跑的就等它结束，没有就立刻跑一轮
export function flushSync() {
  return currentRun || syncNow()
}

// 本地有改动时延迟上传，避免每敲一个字都发请求
export function schedulePush(delay = 10000) {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    syncNow()
  }, delay)
}

// 关掉自动同步时，取消排队中的上传
export function cancelPendingPush() {
  clearTimeout(pushTimer)
  pushTimer = null
}
