<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import NoteList from './components/NoteList.vue'
import NoteEditor from './components/NoteEditor.vue'
import StatsView from './components/StatsView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TrashDialog from './components/TrashDialog.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import DateRangePicker from './components/DateRangePicker.vue'
import MonthPicker from './components/MonthPicker.vue'
import ReminderPicker from './components/ReminderPicker.vue'
import OverlayHost from './components/OverlayHost.vue'
import Icon from './components/Icon.vue'
import LoginDialog from './components/LoginDialog.vue'
import { startWindowDrag } from './drag'
import { confirmDialog, showToast } from './ui'
import { hasLogin, signOut, callFunction, getCurrentUser } from './cloud'
import { syncNow, schedulePush, cancelPendingPush, clearCachedFileId, flushSync, getLastSyncAt } from './sync'
import {
  getThemeMode,
  getAccent,
  setThemeMode,
  setAccent,
  onSystemThemeChange
} from './theme'

const notes = ref([])
const tags = ref([])
const selectedId = ref(null)
const keyword = ref('')
const activeTagId = ref(null)
const isDark = ref(document.documentElement.classList.contains('dark'))
const showStats = ref(false)
const showSettings = ref(false)

// ---- 悬浮窗置顶配置（从主进程读取并同步）----
const floatTop = ref(true)

// ---- 回收站 ----
const showTrash = ref(false)

// ---- 通用配置（自动备份 / 检查更新）----
const appConfig = ref({ autoBackup: true, checkUpdate: true, autoSync: true })

async function setAppConfig(patch) {
  appConfig.value = await window.api.setAppConfig(patch)
  // 关掉自动同步时，丢掉还排着队的上传
  if (patch.autoSync === false) cancelPendingPush()
}

// 设置面板「检查更新」：有新版弹下载提示，没有就 toast
// 发现新版本统一走 UpdateDialog（应用内下载 + 自动安装）
const updateDialog = ref(null)
const showShortcuts = ref(false)

// ---- 云同步登录态 ----
const showLogin = ref(false)
const cloudUser = ref(null) // { username, sub(openid), ... }
const syncing = ref(false)
// 同步状态角标：idle / syncing / ok / fail
const syncState = ref({ status: 'idle', at: 0, message: '' })

const syncText = computed(() => {
  const s = syncState.value
  if (s.status === 'syncing') return '同步中…'
  if (s.status === 'fail') return '同步失败'
  const at = s.at || getLastSyncAt()
  if (!at) return '尚未同步'
  const d = new Date(at)
  return `已同步 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

const syncDotClass = computed(() => {
  const s = syncState.value.status
  if (s === 'syncing') return 'bg-brand animate-pulse'
  if (s === 'fail') return 'bg-danger'
  return 'bg-brand'
})
function openUpdateDialog(info) {
  if (info?.version) updateDialog.value = info
}

async function onManualCheckUpdate() {
  const info = await window.api.checkForUpdate()
  if (info?.version) openUpdateDialog(info)
  else showToast('当前已是最新版本')
}

// ---- 云同步登录 ----
const LAST_SYNC_UID_KEY = 'shinian.sync.lastUid'
function getLastSyncUid() { try { return localStorage.getItem(LAST_SYNC_UID_KEY) || '' } catch { return '' } }
function setLastSyncUid(uid) { try { localStorage.setItem(LAST_SYNC_UID_KEY, uid || '') } catch {} }

function checkCloudLogin() {
  const state = hasLogin()
  cloudUser.value = state?.user ?? null
}

function openLogin() {
  showLogin.value = true
}

async function handleLoginSuccess(user) {
  cloudUser.value = user ?? getCurrentUser()
  showToast('登录成功')
  const newUid = await resolveCloudUid()
  const oldUid = getLastSyncUid()
  // 账号变了：先清空本地所有笔记/墓碑，避免把旧用户数据合并进新用户
  const switched = !!newUid && !!oldUid && newUid !== oldUid
  if (switched) {
    await window.api.syncClear()
    clearCachedFileId()
    selectedId.value = null
    await refresh()
  }
  if (newUid) setLastSyncUid(newUid)
  if (switched) showToast('已切换账号，本地数据已清空')
  // 登录/切换后同步：不静默，拉取失败要能看见原因
  await runSync(false)
  if (switched) {
    await refresh()
    if (!selectedId.value && notes.value.length) selectedId.value = notes.value[0].id
  }
}

// 云函数从 JWT 里解出的 uid 才是同步用的账号标识（客户端 user 字段各版本叫法不一）
async function resolveCloudUid() {
  const res = await callFunction('test')
  if (res.ok && res.data?.uid) return String(res.data.uid)
  const u = cloudUser.value
  return String(u?.uid || u?.sub || '')
}

// 手动/自动同步。silent=true 时不打扰用户（仅在失败或无变化时静默）
async function runSync(silent = false) {
  if (syncing.value) return
  syncing.value = true
  syncState.value = { ...syncState.value, status: 'syncing' }
  try {
    const res = await syncNow()
    if (!res.ok) {
      syncState.value = { status: 'fail', at: Date.now(), message: res.message || '同步失败' }
      if (!silent) showToast(res.message || '同步失败')
      return
    }
    syncState.value = { status: 'ok', at: Date.now(), message: '' }
    const { inserted = 0, updated = 0, removed = 0 } = res.applied || {}
    if (!silent) {
      const changed = inserted + updated + removed
      if (res.empty) showToast('该账号云端还没有数据')
      else showToast(changed ? `已同步，${changed} 条笔记有更新` : '已是最新')
    }
  } catch (e) {
    syncState.value = { status: 'fail', at: Date.now(), message: '同步失败' }
    if (!silent) showToast('同步失败')
  } finally {
    syncing.value = false
  }
}

// 主进程退出前通知：把没传完的改动立刻同步一轮，完成后回执放行退出
async function handleFlushSync() {
  try {
    if (cloudUser.value && appConfig.value.autoSync) await flushSync()
  } catch {
    /* 异常也放行退出，数据在本地不丢 */
  }
  window.api.flushSyncDone()
}

async function handleLogout() {
  const ok = await confirmDialog('确定退出登录吗？\n本地数据不会被删除。', {
    title: '退出登录',
    okText: '退出',
    danger: true
  })
  if (!ok) return
  const res = await signOut()
  if (res.ok) {
    cloudUser.value = null
    syncState.value = { status: 'idle', at: 0, message: '' }
    showToast('已退出登录')
  } else {
    showToast(res.message || '退出失败')
  }
}

// ---- 应用版本（关于面板显示）----
const appVersion = ref('')

// ---- 专注模式 ----
const focusMode = ref(false)

// ---- 窗口状态（自绘标题栏用）----
const maximized = ref(false)

// ---- 批量选择 ----
const selecting = ref(false)
const selectedIds = ref([])
const batchTag = ref('')

// ---- 左侧新建标签 ----
const addingTag = ref(false)
const newTagName = ref('')
const tagInputRef = ref(null)

// ---- 自定义时间弹层 ----
const showRange = ref(false)
const showMonthPicker = ref(false)

// 打开自定义范围时关闭月份选择，反之亦然
function openRange() {
  showMonthPicker.value = false
  showRange.value = true
}
function openMonthPicker() {
  showRange.value = false
  showMonthPicker.value = true
}

// ---- 三栏宽度（可拖动分栏线，记住上次设置）----
const railWidth = ref(Number(localStorage.getItem('shinian-rail-w')) || 228)
const listWidth = ref(Number(localStorage.getItem('shinian-list-w')) || 316)
const dragging = ref(null) // 'rail' | 'list'

function startResize(which, e) {
  dragging.value = which
  const startX = e.clientX
  const startW = which === 'rail' ? railWidth.value : listWidth.value
  const min = which === 'rail' ? 180 : 240
  const max = which === 'rail' ? 320 : 460

  const onMove = (ev) => {
    const w = Math.min(max, Math.max(min, startW + ev.clientX - startX))
    if (which === 'rail') railWidth.value = w
    else listWidth.value = w
  }
  const onUp = () => {
    dragging.value = null
    localStorage.setItem(
      which === 'rail' ? 'shinian-rail-w' : 'shinian-list-w',
      String(which === 'rail' ? railWidth.value : listWidth.value)
    )
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// ---- 主题 ----
const themeMode = ref(getThemeMode())
const accent = ref(getAccent())

function setMode(mode) {
  themeMode.value = mode
  isDark.value = setThemeMode(mode)
}

function toggleTheme() {
  setMode(isDark.value ? 'light' : 'dark')
}

function chooseAccent(value) {
  accent.value = value
  setAccent(value)
}

// ---- 时间筛选 ----
const timeMode = ref('all') // all | today | week | month | custom
const now0 = new Date()
const viewYear = ref(now0.getFullYear())
const viewMonth = ref(now0.getMonth() + 1)
const customFrom = ref('')
const customTo = ref('')
const DAY = 86400000

const timeRange = computed(() => {
  const t = new Date()
  const startOfToday = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  switch (timeMode.value) {
    case 'today':
      return { from: startOfToday, to: startOfToday + DAY }
    case 'week': {
      // 周一为一周开始
      const offset = (t.getDay() + 6) % 7
      return { from: startOfToday - offset * DAY, to: startOfToday + DAY }
    }
    case 'month':
      return {
        from: new Date(viewYear.value, viewMonth.value - 1, 1).getTime(),
        to: new Date(viewYear.value, viewMonth.value, 1).getTime()
      }
    case 'custom': {
      const r = {}
      if (customFrom.value) {
        const [y, m, d] = customFrom.value.split('-').map(Number)
        r.from = new Date(y, m - 1, d).getTime()
      }
      if (customTo.value) {
        const [y, m, d] = customTo.value.split('-').map(Number)
        r.to = new Date(y, m - 1, d).getTime() + DAY
      }
      return r
    }
    default:
      return {}
  }
})

const monthValue = computed(
  () => `${viewYear.value}-${String(viewMonth.value).padStart(2, '0')}`
)

function shiftMonth(delta) {
  const t = new Date(viewYear.value, viewMonth.value - 1 + delta, 1)
  viewYear.value = t.getFullYear()
  viewMonth.value = t.getMonth() + 1
  timeMode.value = 'month'
}

function gotoCurrentMonth() {
  const t = new Date()
  viewYear.value = t.getFullYear()
  viewMonth.value = t.getMonth() + 1
  timeMode.value = 'month'
}

function onMonthPick(e) {
  if (!e.target.value) return
  const [y, m] = e.target.value.split('-').map(Number)
  viewYear.value = y
  viewMonth.value = m
  timeMode.value = 'month'
}

// 时间筛选 chip：点「自定义」时打开日历弹层；点「本月」时重置到当前月
function pickTimeMode(mode) {
  timeMode.value = mode
  if (mode === 'custom') openRange()
  else showRange.value = false
  showMonthPicker.value = false
  if (mode === 'month') {
    const t = new Date()
    viewYear.value = t.getFullYear()
    viewMonth.value = t.getMonth() + 1
    openMonthPicker()
  }
}

function onRangeApply({ from, to }) {
  customFrom.value = from
  customTo.value = to
  showRange.value = false
  timeMode.value = from && to ? 'custom' : 'all'
}

const isCurrentMonth = computed(() => {
  const t = new Date()
  return viewYear.value === t.getFullYear() && viewMonth.value === t.getMonth() + 1
})

const footerText = computed(() =>
  timeMode.value === 'month'
    ? `${viewYear.value}年${viewMonth.value}月 · 共 ${notes.value.length} 条`
    : `共 ${notes.value.length} 条`
)

const listTitle = computed(() => {
  const tag = tags.value.find((t) => t.id === activeTagId.value)
  return tag ? `#${tag.name}` : '全部笔记'
})

const selectedNote = computed(
  () => notes.value.find((n) => n.id === selectedId.value) ?? null
)

async function refresh() {
  const filter = {
    keyword: keyword.value.trim(),
    tagId: activeTagId.value,
    ...timeRange.value
  }
  const [noteRows, tagRows] = await Promise.all([
    window.api.listNotes(filter),
    window.api.listTags()
  ])
  // 复用已有对象引用，避免每次自动保存刷新都让编辑区重新渲染（会打断输入）
  const prev = new Map(notes.value.map((n) => [n.id, n]))
  notes.value = noteRows.map((row) => {
    const old = prev.get(row.id)
    if (!old) return row
    Object.assign(old, row)
    return old
  })
  tags.value = tagRows
}

// 搜索/标签/时间筛选：200ms 防抖查询
let searchTimer = null
// 输入法组词期间先不刷新，等上屏后再查，否则会打断中文输入
let composing = false

function scheduleRefresh() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refresh, 200)
}

watch([keyword, activeTagId, timeRange], () => {
  if (composing) return
  scheduleRefresh()
})

function onCompositionStart() {
  composing = true
}

function onCompositionEnd() {
  composing = false
  scheduleRefresh()
}

async function createNote() {
  const note = await window.api.createNote('')
  await refresh()
  selectedId.value = note.id
}

// 列表是否有筛选条件（决定空状态显示引导还是「没有匹配」）
const hasFilter = computed(
  () => !!(keyword.value.trim() || activeTagId.value || timeRange.value?.from || timeRange.value?.to)
)

// 置顶 / 取消置顶
async function togglePin(note) {
  await window.api.setNotePin(note.id, !note.pinned)
  await refresh()
}

function selectNote(id) {
  selectedId.value = id
}

function toggleTagFilter(tagId) {
  activeTagId.value = activeTagId.value === tagId ? null : tagId
}

// 编辑器自动保存成功后刷新列表（排序/摘要更新）
async function onSaved() {
  await refresh()
}

// 导出全部笔记到文件夹（取消时返回 null，不提示）
async function onExportAll() {
  const count = await window.api.exportAllNotes()
  if (count !== null) showToast(`已导出 ${count} 条笔记`)
}

async function onBackup() {
  const ok = await window.api.backupNow()
  if (ok) showToast('备份完成')
}

async function onRestore() {
  const ok = await confirmDialog('恢复会用备份文件覆盖当前全部数据，且无法撤销。确定继续吗？', {
    title: '恢复备份',
    okText: '恢复',
    danger: true
  })
  if (!ok) return
  const done = await window.api.restoreBackup()
  if (done) {
    await refresh()
    selectedId.value = notes.value[0]?.id ?? null
    showToast('恢复完成')
  }
}

async function onDeleted(id) {
  await refresh()
  if (selectedId.value === id) {
    selectedId.value = notes.value[0]?.id ?? null
  }
}

// ---- 批量操作 ----
function toggleSelectMode() {
  selecting.value = !selecting.value
  selectedIds.value = []
  batchTag.value = ''
}

function toggleNoteSelect(id) {
  const i = selectedIds.value.indexOf(id)
  if (i === -1) selectedIds.value.push(id)
  else selectedIds.value.splice(i, 1)
}

function selectAllNotes() {
  selectedIds.value = notes.value.map((n) => n.id)
}

async function batchDelete() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const ok = await confirmDialog(`选中的 ${ids.length} 条笔记将移入回收站，30 天内可随时恢复。`, {
    title: '批量删除',
    okText: '移入回收站',
    danger: true
  })
  if (!ok) return
  await window.api.deleteNotes(ids)
  selecting.value = false
  selectedIds.value = []
  await refresh()
  if (ids.includes(selectedId.value)) selectedId.value = notes.value[0]?.id ?? null
  showToast(`已移入回收站 ${ids.length} 条`)
}

// 列表项悬停删除：移入回收站，不用先打开笔记
async function removeNote(note) {
  const ok = await confirmDialog(`「${note.title || '无标题'}」将移入回收站，30 天内可随时恢复。`, {
    title: '删除笔记',
    okText: '移入回收站',
    danger: true
  })
  if (!ok) return
  await window.api.deleteNotes([note.id])
  await refresh()
  if (selectedId.value === note.id) selectedId.value = notes.value[0]?.id ?? null
  showToast('已移入回收站')
}

// ---- 列表「⋯」菜单：设置提醒 / 导出 ----
const p2 = (n) => String(n).padStart(2, '0')
const listRemind = ref(null) // { note, anchor }
const remindBase = computed(() => {
  const t = listRemind.value?.note?.remindAt
  return t ? new Date(t) : new Date()
})
const listRemindDate = computed(() => {
  const d = remindBase.value
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
})
const listRemindTime = computed(() => {
  const d = remindBase.value
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
})

function onListRemind({ note, rect }) {
  listRemind.value = { note, anchor: rect }
}

async function applyListRemind({ date, time, repeat }) {
  const target = listRemind.value
  if (!target || !date) return
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi, s] = time.split(':').map(Number)
  const ts = new Date(y, m - 1, d, h, mi, s || 0).getTime()
  await window.api.setNoteReminder(target.note.id, ts, repeat || '')
  listRemind.value = null
  await refresh()
  showToast('提醒已设置')
}

async function exportFromList(note) {
  await window.api.exportNote(note.id)
}

async function batchAddTag() {
  const name = batchTag.value.trim()
  const ids = [...selectedIds.value]
  if (!name || ids.length === 0) return
  await window.api.addTagsToNotes(ids, [name])
  batchTag.value = ''
  await refresh()
}

// ---- 左侧新建标签 ----
function startAddTag() {
  addingTag.value = true
  nextTick(() => tagInputRef.value?.focus())
}

function cancelAddTag() {
  addingTag.value = false
  newTagName.value = ''
}

async function commitNewTag() {
  const name = newTagName.value.trim()
  addingTag.value = false
  newTagName.value = ''
  if (!name) return
  await window.api.createTag(name)
  await refresh()
}

// 删除标签（只删标签本身，笔记保留）
async function removeTag(tag) {
  const ok = await confirmDialog(`删除标签「${tag.name}」？\n只删除标签本身，不会删除任何笔记。`, {
    title: '删除标签',
    okText: '删除',
    danger: true
  })
  if (!ok) return
  await window.api.deleteTag(tag.id)
  if (activeTagId.value === tag.id) activeTagId.value = null
  await refresh()
}

// 点击系统提醒通知后跳转：先清筛选保证笔记在列表里，再选中
async function openNote(id) {
  keyword.value = ''
  activeTagId.value = null
  timeMode.value = 'all'
  await refresh()
  selectedId.value = id
}

let offSystemTheme = null
let offMaximize = null
let offMinimize = null
let offFocusSync = null

// 自绘标题栏的窗口控制
async function onMinimize() { await window.api.winMinimize() }
async function onMaximize() { maximized.value = await window.api.winToggleMaximize() }
async function onClose() { await window.api.winClose() }

// 标题栏拖动（自定义实现，方便显示抓手光标）；最大化时交给系统还原逻辑，不拖
function onHeaderDrag(e) {
  if (maximized.value) return
  startWindowDrag(window.api, e)
}
// 双击标题栏 = 最大化 / 还原（原生拖动区域的默认行为）
function onHeaderDblClick(e) {
  if (e.target.closest('button')) return
  onMaximize()
}

// 退出专注模式
function exitFocus() {
  focusMode.value = false
}

// 切换专注模式（极简编辑器）
function toggleFocusMode() {
  focusMode.value = !focusMode.value
}

// 切换悬浮速记窗
async function onToggleFloat() {
  await window.api.winToggleFloat()
}

// 设置面板改悬浮窗置顶
async function onSetFloatTop(v) {
  floatTop.value = v
  await window.api.floatSetTop(v)
}

onMounted(async () => {
  // 通用配置要先读出来：启动同步等行为依赖 autoSync 开关
  try {
    appConfig.value = await window.api.getAppConfig()
  } catch {}
  // 先检查云端登录态（读本地缓存，同步）
  checkCloudLogin()
  // 记住当前登录账号，之后换账号时才能识别出「切换」
  if (cloudUser.value) resolveCloudUid().then((u) => { if (u) setLastSyncUid(u) })
  // 退出前补同步
  window.api.onFlushSync(handleFlushSync)

  await refresh()
  if (notes.value.length > 0) selectedId.value = notes.value[0].id
  // 速记窗等其他窗口改了数据，主窗口跟着刷新
  window.api.onNotesChanged(() => {
    refresh()
    // 已登录时，本地一有改动就排队上传（10 秒防抖，避免频繁请求）
    if (cloudUser.value && appConfig.value.autoSync) schedulePush()
  })
  window.api.onOpenNote(openNote)

  // 已登录：启动后同步一轮；窗口重新获得焦点时再拉一次
  if (cloudUser.value && appConfig.value.autoSync) runSync(true)
  offFocusSync = () => {
    if (cloudUser.value && appConfig.value.autoSync && document.visibilityState === 'visible') runSync(true)
  }
  window.addEventListener('focus', offFocusSync)
  // 「跟随系统」时，系统切换深浅色要实时跟随
  offSystemTheme = onSystemThemeChange((dark) => {
    isDark.value = dark
  })

  // 标题栏：窗口最大化状态同步
  maximized.value = await window.api.winIsMaximized()
  offMaximize = () => { maximized.value = true }
  offMinimize = () => { maximized.value = false }
  window.addEventListener('maximize', offMaximize)
  window.addEventListener('unmaximize', offMinimize)

  // 悬浮窗置顶初始状态
  try {
    const cfg = await window.api.floatGetConfig()
    if (cfg && typeof cfg.alwaysOnTop === 'boolean') floatTop.value = cfg.alwaysOnTop
  } catch {}

  // 版本号 / 检查更新提示
  try {
    appVersion.value = await window.api.getAppVersion()
  } catch {}
  // 主进程启动时发现新版本会推送；这里兜底拉一次（渲染端加载晚于推送的情况）
  let updateShown = false
  const showUpdate = (info) => {
    if (updateShown || !info?.version) return
    updateShown = true
    openUpdateDialog(info)
  }
  window.api.onUpdateAvailable(showUpdate)
  try {
    const info = await window.api.getUpdateInfo()
    if (info) showUpdate(info)
  } catch {}

  // 快捷键：Ctrl+Shift+M 专注模式、Ctrl+N 新建笔记、F1 快捷键帮助
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm' && !e.altKey) {
      e.preventDefault()
      toggleFocusMode()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      createNote()
    }
    if (e.key === 'F1') {
      e.preventDefault()
      showShortcuts.value = true
    }
    if (e.key === 'Escape' && focusMode.value) {
      focusMode.value = false
    }
  })
})

onBeforeUnmount(() => {
  offSystemTheme?.()
  offMaximize && window.removeEventListener('maximize', offMaximize)
  offMinimize && window.removeEventListener('unmaximize', offMinimize)
  offFocusSync && window.removeEventListener('focus', offFocusSync)
})
</script>

<template>
  <div class="h-screen flex flex-col bg-surface text-t1 select-none overflow-hidden">
    <!-- ============ 自绘标题栏（隐藏原生 title bar 后自己画）============ -->
    <header
      class="shrink-0 h-10 flex items-center justify-between px-3 border-b border-line bg-surface drag-handle"
      @pointerdown="onHeaderDrag"
      @dblclick="onHeaderDblClick"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="w-6 h-6 rounded-md bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-[11px] font-bold"
        >
          拾
        </div>
        <span class="text-[12.5px] font-semibold tracking-wide">拾念</span>
      </div>

      <div class="flex items-center gap-0.5">
        <!-- 悬浮窗切换 -->
        <button
          class="w-8 h-8 rounded-md flex items-center justify-center text-t2 hover:bg-hover hover:text-t1 transition"
          title="悬浮速记窗"
          @click="onToggleFloat"
        >
          <Icon name="float" cls="w-3.5 h-3.5" />
        </button>

        <!-- 最小化 -->
        <button
          class="w-10 h-8 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
          title="最小化"
          @click="onMinimize"
        >
          <Icon name="minimize" cls="w-3 h-3" />
        </button>
        <!-- 最大化 / 还原 -->
        <button
          class="w-10 h-8 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
          :title="maximized ? '还原' : '最大化'"
          @click="onMaximize"
        >
          <Icon :name="maximized ? 'restore' : 'maximize'" cls="w-3 h-3" />
        </button>
        <!-- 关闭 -->
        <button
          class="w-10 h-8 rounded-md flex items-center justify-center text-t3 hover:bg-danger hover:text-white transition"
          title="关闭"
          @click="onClose"
        >
          <Icon name="x" cls="w-3.5 h-3.5" />
        </button>
      </div>
    </header>

    <!-- ============ 主体三栏 ============ -->
    <div class="flex-1 min-h-0 flex">
      <!-- ============ 左侧导航 ============ -->
      <aside
        v-show="!focusMode"
        class="relative shrink-0 flex flex-col bg-rail border-r border-line px-3 pt-3.5 pb-2.5"
        :style="{ width: railWidth + 'px' }"
      >
      <header class="flex items-center justify-between px-1 pb-3.5">
        <div class="flex items-center gap-2.5">
          <div
            class="w-8 h-8 rounded-[9px] bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-[15px] font-bold shadow-sm"
          >
            拾
          </div>
          <div>
            <h1 class="text-[15px] font-bold leading-5 tracking-wide">拾念</h1>
            <p class="text-[11px] leading-4 text-t3">随手一记 · 拾回思绪</p>
          </div>
        </div>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center transition"
          :class="showStats
            ? 'bg-brand-soft text-brand-text'
            : 'text-t3 hover:bg-hover hover:text-t1'"
          title="统计"
          @click="showStats = !showStats"
        >
          <Icon name="chart" cls="w-4 h-4" />
        </button>
      </header>

      <button
        class="w-full h-[38px] rounded-[9px] bg-brand text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-brand-hover active:scale-[0.985] transition shadow-sm"
        @click="createNote"
      >
        <Icon name="plus" cls="w-4 h-4" />
        新建笔记
      </button>

      <div class="relative mt-3 mb-4">
        <Icon
          name="search"
          cls="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-t3 pointer-events-none"
        />
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索标题和正文…"
          class="w-full h-[34px] pl-8 pr-8 text-[12.5px] rounded-[9px] border border-line bg-surface text-t1 outline-none placeholder:text-t3 focus:border-brand-line focus:ring-2 focus:ring-brand-line transition select-text"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
        />
        <button
          v-if="keyword"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-t3 hover:text-t1 hover:bg-hover transition"
          title="清空搜索"
          @click="keyword = ''"
        >
          <Icon name="x" cls="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="relative mb-4">
        <div class="flex items-center justify-between px-1 pb-2">
          <span class="text-[11px] font-semibold tracking-wider text-t3">时间</span>
          <Icon name="calendar" cls="w-3.5 h-3.5 text-t3" />
        </div>
        <div class="flex flex-wrap gap-1.5 px-0.5">
          <button
            v-for="opt in [
              { mode: 'all', label: '全部' },
              { mode: 'today', label: '今天' },
              { mode: 'week', label: '本周' },
              { mode: 'month', label: '本月' },
              { mode: 'custom', label: '自定义' }
            ]"
            :key="opt.mode"
            class="h-6 px-2.5 text-[11.5px] rounded-full transition"
            :class="timeMode === opt.mode
              ? 'bg-brand-soft2 text-brand-text font-semibold'
              : 'bg-chip text-t2 hover:bg-hover'"
            @click="pickTimeMode(opt.mode)"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- 月度选择器：只在「本月」模式下出现 -->
        <template v-if="timeMode === 'month'">
          <div class="relative">
            <div class="flex items-center justify-between h-7 mt-2 px-0.5">
              <button
                class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
                title="上月"
                @click="shiftMonth(-1)"
              >
                <Icon name="chevron-left" cls="w-4 h-4" />
              </button>
              <button
                class="h-6 px-2 rounded-md bg-chip text-[12px] text-t2 font-semibold tabular-nums hover:bg-hover hover:text-t1 transition flex items-center gap-1"
                title="选择月份"
                @click.stop="showMonthPicker = !showMonthPicker"
              >
                {{ viewYear }}年{{ viewMonth }}月
                <Icon name="chevron-right" cls="w-2.5 h-2.5 rotate-90 text-t3" />
              </button>
              <button
                class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
                title="下月"
                @click="shiftMonth(1)"
              >
                <Icon name="chevron-right" cls="w-4 h-4" />
              </button>
            </div>
            <MonthPicker
              v-if="showMonthPicker"
              :year="viewYear"
              :month="viewMonth"
              @apply="(v) => { viewYear = v.year; viewMonth = v.month; showMonthPicker = false }"
              @close="showMonthPicker = false"
            />
          </div>

          <button
            v-if="!isCurrentMonth"
            class="w-full h-6 mt-1 text-[11.5px] rounded-full bg-chip text-t2 hover:bg-hover transition"
            @click="gotoCurrentMonth"
          >
            回到本月
          </button>
        </template>

        <button
          v-if="timeMode === 'custom'"
          class="w-full h-7 mt-2 px-2 rounded-[7px] bg-chip text-[11.5px] text-t2 flex items-center justify-between gap-1 hover:bg-hover transition"
          title="修改自定义时间段"
          @click="showRange = true"
        >
          <span class="tabular-nums truncate">
            {{ customFrom || '开始日期' }} → {{ customTo || '结束日期' }}
          </span>
          <Icon name="calendar" cls="w-3.5 h-3.5 text-t3 shrink-0" />
        </button>

        <DateRangePicker
          v-if="showRange"
          :from="customFrom"
          :to="customTo"
          @apply="onRangeApply"
          @close="showRange = false"
        />
      </div>

      <div class="mb-2">
        <div class="flex items-center justify-between px-1 pb-2">
          <span class="text-[11px] font-semibold tracking-wider text-t3">标签</span>
          <Icon name="tag" cls="w-3.5 h-3.5 text-t3" />
        </div>
        <div class="max-h-[246px] overflow-y-auto pr-0.5">
          <button
            class="w-full h-[29px] px-2 rounded-[7px] flex items-center text-xs transition"
            :class="activeTagId === null
              ? 'bg-brand-soft2 text-brand-text font-semibold'
              : 'text-t2 hover:bg-hover'"
            @click="activeTagId = null"
          >
            <span class="text-t3 mr-1.5">#</span>
            全部标签
          </button>
          <div
            v-for="tag in tags"
            :key="tag.id"
            class="group w-full h-[29px] px-2 rounded-[7px] flex items-center text-xs transition cursor-pointer"
            :class="activeTagId === tag.id
              ? 'bg-brand-soft2 text-brand-text font-semibold'
              : 'text-t2 hover:bg-hover'"
            @click="toggleTagFilter(tag.id)"
          >
            <span class="text-t3 mr-1.5">#</span>
            <span class="truncate">{{ tag.name }}</span>
            <span class="ml-auto text-[10.5px] text-t3 tabular-nums group-hover:hidden">
              {{ tag.count }}
            </span>
            <button
              class="hidden group-hover:flex ml-auto w-4 h-4 rounded items-center justify-center text-t3 hover:text-danger hover:bg-[#e5484d]/10 transition shrink-0"
              title="删除标签（不影响笔记）"
              @click.stop="removeTag(tag)"
            >
              <Icon name="x" cls="w-3 h-3" />
            </button>
          </div>
        </div>
        <input
          v-if="addingTag"
          ref="tagInputRef"
          v-model="newTagName"
          type="text"
          placeholder="标签名，回车创建"
          class="mt-0.5 w-full h-[29px] px-2 rounded-[7px] bg-surface border border-brand-line text-xs text-t1 outline-none select-text focus:ring-2 focus:ring-brand-line"
          @keydown.enter.prevent="commitNewTag"
          @keydown.esc="cancelAddTag"
          @blur="commitNewTag"
        />
        <button
          v-else
          class="mt-0.5 w-full h-[29px] px-2 rounded-[7px] flex items-center gap-1.5 text-xs text-t3 hover:bg-hover hover:text-brand-text transition"
          @click="startAddTag"
        >
          <Icon name="plus" cls="w-3.5 h-3.5" />
          新建标签
        </button>
      </div>

      <div class="flex-1"></div>

      <!-- 云同步登录入口 -->
      <div class="px-1 pb-2">
        <!-- 已登录：显示用户名 + 登出 -->
        <div v-if="cloudUser" class="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-brand-soft hover:bg-brand-soft2 transition">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_4px_rgba(7,193,96,0.6)]" :class="syncDotClass"></span>
          <div class="flex-1 min-w-0">
            <div class="text-[11.5px] text-brand-text font-medium truncate leading-tight">
              {{ cloudUser.username || cloudUser.email || '已登录' }}
            </div>
            <div class="text-[10px] leading-tight truncate" :class="syncState.status === 'fail' ? 'text-danger' : 'text-t3'">
              {{ syncText }}
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 text-[11px] text-t2 hover:text-brand-text transition shrink-0"
            title="立即同步"
            :disabled="syncing"
            @click="runSync(false)"
          >
            {{ syncing ? '同步中' : '同步' }}
          </button>
          <button
            class="opacity-0 group-hover:opacity-100 text-[11px] text-t2 hover:text-danger transition shrink-0"
            title="退出登录"
            @click="handleLogout"
          >
            退出
          </button>
        </div>
        <!-- 未登录：登录按钮 -->
        <button
          v-else
          class="w-full h-7 px-2 rounded-lg flex items-center justify-center gap-1.5 text-[11.5px] text-t2 hover:bg-brand-soft hover:text-brand-text border border-line hover:border-brand-line transition"
          @click="openLogin"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-t3"></span>
          登录同步
        </button>
      </div>

      <div class="border-t border-line pt-2">
        <div class="flex items-center justify-between">
          <span class="px-1 text-[11px] text-t3 truncate">{{ footerText }}</span>
          <div class="flex items-center gap-0.5">
            <button
              class="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="回收站"
              @click="showTrash = true"
            >
              <Icon name="trash" cls="w-4 h-4" />
            </button>
            <button
              class="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              :title="isDark ? '切换到浅色' : '切换到深色'"
              @click="toggleTheme"
            >
              <Icon :name="isDark ? 'sun' : 'moon'" cls="w-4 h-4" />
            </button>
            <button
              class="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="设置"
              @click="showSettings = true"
            >
              <Icon name="settings" cls="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- 可拖动的分栏线 -->
      <div
        class="absolute inset-y-0 -right-[3px] w-[6px] z-20 cursor-col-resize hover:bg-brand/20 transition-colors"
        :class="dragging === 'rail' ? 'bg-brand/30' : ''"
        title="拖动调整宽度"
        @mousedown.prevent="startResize('rail', $event)"
      ></div>
    </aside>

    <!-- ============ 笔记列表 ============ -->
    <section
      v-show="!focusMode"
      class="relative shrink-0 flex flex-col bg-list border-r border-line"
      :style="{ width: listWidth + 'px' }"
    >
      <header class="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <h2 class="text-sm font-semibold truncate">
          {{ selecting ? `已选 ${selectedIds.length} 条` : listTitle }}
        </h2>
        <span
          v-if="!selecting"
          class="text-[10.5px] font-semibold text-brand-text bg-brand-soft2 px-1.5 py-px rounded-full tabular-nums"
        >
          {{ notes.length }}
        </span>
        <div v-if="selecting" class="ml-auto flex items-center gap-2.5">
          <button class="text-[11.5px] text-t2 hover:text-brand-text transition" @click="selectAllNotes">
            全选
          </button>
          <button class="text-[11.5px] text-t2 hover:text-t1 transition" @click="toggleSelectMode">
            取消
          </button>
        </div>
        <button
          v-else
          class="ml-auto text-[11.5px] text-t2 hover:text-brand-text transition"
          title="批量选择笔记"
          @click="toggleSelectMode"
        >
          多选
        </button>
      </header>

      <div
        v-if="selecting"
        class="shrink-0 h-12 px-3 flex items-center gap-1.5 border-b border-line bg-brand-soft"
      >
        <input
          v-model="batchTag"
          type="text"
          placeholder="给选中笔记加标签"
          class="flex-1 min-w-0 h-7 px-2 text-xs rounded-md bg-surface border border-brand-line text-t1 outline-none select-text placeholder:text-t3 focus:ring-2 focus:ring-brand-line"
          @keydown.enter.prevent="batchAddTag"
        />
        <button
          class="h-7 px-2.5 text-[11.5px] font-semibold rounded-md bg-brand text-white hover:bg-brand-hover disabled:opacity-40 disabled:hover:bg-brand transition shrink-0"
          :disabled="!selectedIds.length || !batchTag.trim()"
          @click="batchAddTag"
        >
          加标签
        </button>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-danger hover:bg-[#e5484d]/10 disabled:opacity-40 transition shrink-0"
          :disabled="!selectedIds.length"
          title="删除所选"
          @click="batchDelete"
        >
          <Icon name="trash" cls="w-4 h-4" />
        </button>
      </div>

      <NoteList
        :notes="notes"
        :selected-id="selectedId"
        :selecting="selecting"
        :selected-ids="selectedIds"
        :filtered="hasFilter"
        @select="selectNote"
        @toggle="toggleNoteSelect"
        @remove="removeNote"
        @remind="onListRemind"
        @export="exportFromList"
        @pin="togglePin"
        @create="createNote"
      />

      <!-- 可拖动的分栏线 -->
      <div
        class="absolute inset-y-0 -right-[3px] w-[6px] z-20 cursor-col-resize hover:bg-brand/20 transition-colors"
        :class="dragging === 'list' ? 'bg-brand/30' : ''"
        title="拖动调整宽度"
        @mousedown.prevent="startResize('list', $event)"
      ></div>
    </section>

    <!-- ============ 编辑 / 统计 ============ -->
    <main class="flex-1 min-w-0 bg-surface">
      <StatsView v-if="showStats" :is-dark="isDark" @close="showStats = false" />
      <template v-else>
        <NoteEditor
          v-if="selectedNote"
          :key="selectedNote.id"
          :note="selectedNote"
          @saved="onSaved"
          @deleted="onDeleted"
        />
        <div v-else class="h-full flex flex-col items-center justify-center text-t3 gap-3">
          <div
            class="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-3xl font-bold shadow-lg select-none"
          >
            拾
          </div>
          <p class="text-sm text-t2">没有选中的笔记</p>
          <p class="text-xs">
            点左侧「新建笔记」开始记录 · 任何窗口下按
            <kbd class="mx-0.5 px-1.5 py-0.5 rounded bg-chip text-[11px] font-mono text-t2">Ctrl+Shift+N</kbd>
            唤起速记
          </p>
        </div>
      </template>
    </main>
    </div>

    <SettingsDialog
      v-if="showSettings"
      :mode="themeMode"
      :accent="accent"
      :float-top="floatTop"
      :auto-backup="appConfig.autoBackup"
      :check-update="appConfig.checkUpdate"
      :auto-sync="appConfig.autoSync"
      :version="appVersion"
      @close="showSettings = false"
      @set-mode="setMode"
      @set-accent="chooseAccent"
      @set-float-top="onSetFloatTop"
      @set-autobackup="setAppConfig({ autoBackup: $event })"
      @set-checkupdate="setAppConfig({ checkUpdate: $event })"
      @set-autosync="setAppConfig({ autoSync: $event })"
      @check-update="onManualCheckUpdate"
      @show-shortcuts="showShortcuts = true"
      @export-all="onExportAll"
      @backup="onBackup"
      @restore="onRestore"
    />

    <TrashDialog
      v-if="showTrash"
      @close="showTrash = false"
      @changed="refresh"
    />

    <UpdateDialog
      v-if="updateDialog"
      :info="updateDialog"
      @close="updateDialog = null"
    />

    <ShortcutsDialog
      v-if="showShortcuts"
      @close="showShortcuts = false"
    />

    <ReminderPicker
      v-if="listRemind"
      :anchor="listRemind.anchor"
      :date="listRemindDate"
      :time="listRemindTime"
      :repeat="listRemind.note.remindRepeat || ''"
      @apply="applyListRemind"
      @close="listRemind = null"
    />

    <LoginDialog
      v-if="showLogin"
      @close="showLogin = false"
      @success="handleLoginSuccess"
    />

    <OverlayHost />
  </div>
</template>
