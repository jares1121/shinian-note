<script setup>
import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { marked } from 'marked'
import TagEditor from './TagEditor.vue'
import Icon from './Icon.vue'
import ReminderPicker from './ReminderPicker.vue'
import { confirmDialog } from '../ui'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps({
  note: { type: Object, required: true }
})
const emit = defineEmits(['saved', 'deleted'])

const draft = ref(props.note.content)
const dirty = ref(false)
const saving = ref(false)
const lastSavedAt = ref(null)
const mode = ref('edit') // 'edit' | 'preview'
const textareaRef = ref(null)
const showReminderPicker = ref(false)
const reminderAnchor = ref(null)
let timer = null

const previewHtml = computed(() => marked.parse(draft.value || ''))
const wordCount = computed(() => draft.value.replace(/\s/g, '').length)

function onInput() {
  dirty.value = true
  clearTimeout(timer)
  timer = setTimeout(save, 400)
}

// 切走/关闭前把未保存的内容立即落库
async function flush() {
  clearTimeout(timer)
  if (!dirty.value) return
  await save()
}

async function save() {
  if (!dirty.value) return
  dirty.value = false
  saving.value = true
  await window.api.updateNote(props.note.id, draft.value)
  saving.value = false
  lastSavedAt.value = new Date()
  emit('saved')
}

// 进预览前先落库
async function setMode(next) {
  if (next === mode.value) return
  if (next === 'preview') await flush()
  mode.value = next
}

async function onTagsChange(names) {
  await window.api.setNoteTags(props.note.id, names)
  emit('saved')
}

// 提醒时间回填格式：YYYY-MM-DDTHH:MM:SS（本地时区）
const remindInput = computed(() => {
  if (!props.note.remindAt) return ''
  const d = new Date(props.note.remindAt)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

function openReminderPicker(e) {
  // 直接以被点的按钮为锚点弹出时间面板，不再经过「选择时间」这一步
  const rect = e.currentTarget.getBoundingClientRect()
  reminderAnchor.value = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
  showReminderPicker.value = true
}

// 弹层底部展示的重复规则文案
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEK_LONG = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const repeatLabel = computed(() => {
  const r = props.note.remindRepeat || ''
  if (r === 'daily') return '每天'
  if (r === 'workday') return '工作日'
  if (!r.startsWith('weekly:')) return ''
  const days = r.slice(7).split(',').map(Number)
  const sorted = WEEK_ORDER.filter((d) => days.includes(d))
  if (sorted.length === 7) return '每天'
  const pos = sorted.map((d) => WEEK_ORDER.indexOf(d))
  const consecutive = pos.every((v, i) => i === 0 || v === pos[i - 1] + 1)
  if (consecutive && sorted.length >= 3) {
    return `${WEEK_LONG[sorted[0]]}至${WEEK_LONG[sorted[sorted.length - 1]]}`
  }
  return sorted.map((d) => WEEK_LONG[d]).join('、')
})

async function onRemindConfirm({ date, time, repeat }) {
  if (!date) return
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi, s] = time.split(':').map(Number)
  await window.api.setNoteReminder(
    props.note.id,
    new Date(y, m - 1, d, h, mi, s || 0).getTime(),
    repeat || ''
  )
  showReminderPicker.value = false
  emit('saved')
}

async function clearReminder() {
  await window.api.setNoteReminder(props.note.id, null, '')
  emit('saved')
}

// 导出为 Markdown 前先落库，保证导出的是最新内容
async function exportNote() {
  await flush()
  await window.api.exportNote(props.note.id)
}

// 粘贴图片：存到 userData/images 后在光标处插入 Markdown 图片链接
async function onPaste(e) {
  const images = [...(e.clipboardData?.items ?? [])].filter(
    (it) => it.kind === 'file' && it.type.startsWith('image/')
  )
  if (images.length === 0) return
  e.preventDefault()
  for (const it of images) {
    const file = it.getAsFile()
    const bytes = new Uint8Array(await file.arrayBuffer())
    const url = await window.api.saveImage(bytes, file.type)
    insertAtCursor(`![图片](${url})\n`)
  }
}

function insertAtCursor(text) {
  const el = textareaRef.value
  if (!el) {
    draft.value += text
    onInput()
    return
  }
  const start = el.selectionStart ?? draft.value.length
  const end = el.selectionEnd ?? start
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end)
  onInput() // 走 400ms 防抖自动保存
  nextTick(() => {
    el.focus()
    el.selectionStart = el.selectionEnd = start + text.length
  })
}

/* ---------- Markdown 快捷插入 ---------- */

// 应用一次编辑并恢复光标选区
function applyEdit(nextValue, selStart, selEnd) {
  draft.value = nextValue
  onInput()
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}

// 用前后标记包裹选区（无选区时插入占位文字并选中它）
function wrapSel(before, after, placeholder = '') {
  const el = textareaRef.value
  if (!el) return
  const s = el.selectionStart ?? draft.value.length
  const e = el.selectionEnd ?? s
  const v = draft.value
  const sel = v.slice(s, e) || placeholder
  applyEdit(v.slice(0, s) + before + sel + after + v.slice(e), s + before.length, s + before.length + sel.length)
}

// 行前缀开关：选区覆盖的每一行加/去前缀（## 、- 、> 等）
function toggleLinePrefix(prefix) {
  const el = textareaRef.value
  if (!el) return
  const v = draft.value
  const s = el.selectionStart ?? 0
  const e = el.selectionEnd ?? s
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  let lineEnd = v.indexOf('\n', e)
  if (lineEnd === -1) lineEnd = v.length
  const lines = v.slice(lineStart, lineEnd).split('\n')
  const all = lines.every((l) => l.startsWith(prefix))
  const nextBlock = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n')
  applyEdit(v.slice(0, lineStart) + nextBlock + v.slice(lineEnd), lineStart, lineStart + nextBlock.length)
}

const TABLE_TEMPLATE = '| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n'

// 工具栏配置：label 文字按钮 / icon 图标按钮
const TOOLBAR = [
  { title: '加粗 (Ctrl+B)', label: 'B', labelClass: 'font-bold', run: () => wrapSel('**', '**', '加粗文字') },
  { title: '斜体 (Ctrl+I)', label: 'I', labelClass: 'italic', run: () => wrapSel('*', '*', '文字') },
  { title: '删除线', label: 'S', labelClass: 'line-through', run: () => wrapSel('~~', '~~', '删除文字') },
  { title: '标题', label: 'H', labelClass: 'font-semibold', run: () => toggleLinePrefix('## ') },
  { title: '无序列表', icon: 'list', run: () => toggleLinePrefix('- ') },
  { title: '引用', icon: 'quote', run: () => toggleLinePrefix('> ') },
  { title: '代码块', icon: 'code', run: () => wrapSel('\n```\n', '\n```\n', '代码') },
  { title: '表格', icon: 'table', run: () => insertAtCursor(TABLE_TEMPLATE) },
  { title: '链接', icon: 'link', run: () => wrapSel('[', '](https://)', '链接文字') }
]

// 编辑器内 Ctrl+B / Ctrl+I
function onTextKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const k = e.key.toLowerCase()
  if (k === 'b') {
    e.preventDefault()
    wrapSel('**', '**', '加粗文字')
  } else if (k === 'i') {
    e.preventDefault()
    wrapSel('*', '*', '文字')
  }
}

async function remove() {
  const ok = await confirmDialog(
    `「${props.note.title || '无标题'}」将移入回收站，30 天内可随时恢复。`,
    {
      title: '删除笔记',
      okText: '移入回收站',
      danger: true
    }
  )
  if (!ok) return
  clearTimeout(timer)
  dirty.value = false
  await window.api.deleteNote(props.note.id)
  emit('deleted', props.note.id)
}

function fmtTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtDate(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${fmtTime(d)}`
}

onBeforeUnmount(flush)
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 工具栏 -->
    <header class="h-14 shrink-0 flex items-center justify-between gap-4 px-4 border-b border-line">
      <div class="flex items-center gap-2 min-w-0 text-xs text-t2">
        <Icon name="calendar" cls="w-4 h-4 text-t3" />
        <span class="truncate tabular-nums">{{ fmtDate(note.createdAt) }}</span>
        <span class="w-px h-3.5 bg-line2 mx-1"></span>
        <span class="flex items-center gap-1.5 text-[11.5px]" :class="saving ? 'text-t3' : 'text-brand-text'">
          <span class="w-1.5 h-1.5 rounded-full bg-brand" :class="{ 'animate-pulse': saving }"></span>
          <template v-if="saving">保存中…</template>
          <template v-else-if="lastSavedAt">已保存 {{ fmtTime(lastSavedAt) }}</template>
          <template v-else>自动保存</template>
        </span>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <div class="flex gap-0.5 p-0.5 rounded-lg bg-chip">
          <button
            class="h-[26px] px-2.5 rounded-md text-xs flex items-center gap-1.5 transition"
            :class="mode === 'edit' ? 'bg-surface text-t1 font-semibold shadow-sm' : 'text-t2 hover:text-t1'"
            @click="setMode('edit')"
          >
            <Icon name="pencil" cls="w-3.5 h-3.5" />
            编辑
          </button>
          <button
            class="h-[26px] px-2.5 rounded-md text-xs flex items-center gap-1.5 transition"
            :class="mode === 'preview' ? 'bg-surface text-t1 font-semibold shadow-sm' : 'text-t2 hover:text-t1'"
            @click="setMode('preview')"
          >
            <Icon name="eye" cls="w-3.5 h-3.5" />
            预览
          </button>
        </div>
        <span class="w-px h-4 bg-line2 mx-0.5"></span>
        <button
          class="w-[30px] h-[30px] rounded-md flex items-center justify-center text-t2 hover:bg-hover hover:text-t1 transition"
          title="导出为 Markdown 文件"
          @click="exportNote"
        >
          <Icon name="download" cls="w-4 h-4" />
        </button>
        <button
          class="w-[30px] h-[30px] rounded-md flex items-center justify-center text-t2 hover:bg-[#e5484d]/10 hover:text-danger transition"
          title="删除这条笔记"
          @click="remove"
        >
          <Icon name="trash" cls="w-4 h-4" />
        </button>
      </div>
    </header>

    <!-- 标签 / 提醒 -->
    <div class="shrink-0 border-b border-line">
      <div class="max-w-[632px] mx-auto px-8 py-2.5 flex items-center gap-2">
        <Icon name="tag" cls="w-4 h-4 text-t3 shrink-0" />
        <TagEditor :tags="note.tags" @change="onTagsChange" />

        <div class="ml-auto flex items-center gap-1 shrink-0">
          <!-- 未设置：点一下直接弹时间面板 -->
          <button
            v-if="!note.remindAt"
            class="h-7 px-2 rounded-full border border-dashed border-line2 text-t3 text-[11.5px] flex items-center gap-1 hover:text-brand-text hover:border-brand-line hover:bg-brand-soft transition"
            @click="openReminderPicker"
          >
            <Icon name="bell" cls="w-3.5 h-3.5" />
            设置提醒
          </button>

          <!-- 已设置：品牌色胶囊，点一下直接改 -->
          <template v-else>
            <button
              class="h-7 px-2.5 rounded-full bg-brand-soft text-brand-text text-[11.5px] flex items-center gap-1 hover:bg-brand-soft2 transition"
              title="修改提醒"
              @click="openReminderPicker"
            >
              <Icon name="bell" cls="w-3.5 h-3.5" />
              提醒 {{ fmtDate(note.remindAt) }}
              <span v-if="repeatLabel" class="text-[10.5px] text-brand-text/75">{{ repeatLabel }}</span>
            </button>
            <button
              class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:text-danger hover:bg-hover transition"
              title="清除提醒"
              @click="clearReminder"
            >
              <Icon name="x" cls="w-3.5 h-3.5" />
            </button>
          </template>

          <ReminderPicker
            v-if="showReminderPicker && reminderAnchor"
            :anchor="reminderAnchor"
            :date="remindInput.split('T')[0] || ''"
            :time="remindInput.split('T')[1] || ''"
            :repeat="note.remindRepeat || ''"
            @apply="onRemindConfirm"
            @close="showReminderPicker = false"
          />
        </div>
      </div>
    </div>

    <!-- Markdown 工具栏（仅编辑模式） -->
    <div v-if="mode === 'edit'" class="shrink-0 border-b border-line">
      <div class="max-w-[632px] mx-auto px-8 py-1 flex items-center gap-0.5">
        <button
          v-for="btn in TOOLBAR"
          :key="btn.title"
          class="h-7 min-w-7 px-1.5 rounded-md flex items-center justify-center text-t2 hover:bg-hover hover:text-t1 transition"
          :title="btn.title"
          @click="btn.run()"
        >
          <span v-if="btn.label" class="text-[12.5px] leading-none" :class="btn.labelClass">{{ btn.label }}</span>
          <Icon v-else :name="btn.icon" cls="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- 编辑区 -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <textarea
        v-if="mode === 'edit'"
        ref="textareaRef"
        v-model="draft"
        class="block w-full max-w-[608px] h-full mx-auto px-8 py-6 resize-none outline-none bg-transparent text-[15px] leading-[1.9] text-t1 placeholder:text-t3"
        placeholder="开始记录…支持 Markdown，可直接粘贴图片"
        autofocus
        @input="onInput"
        @blur="flush"
        @paste="onPaste"
        @keydown="onTextKeydown"
      ></textarea>
      <div
        v-else
        class="max-w-[608px] mx-auto px-8 py-6 text-[14.5px] md-preview"
        v-html="previewHtml"
      ></div>
    </div>

    <!-- 状态栏 -->
    <footer class="h-7 shrink-0 px-4 flex items-center justify-between border-t border-line text-[10.5px] text-t3">
      <span>Markdown · 输入即保存</span>
      <span class="tabular-nums">{{ saving ? '保存中…' : '已自动保存' }} · {{ wordCount }} 字</span>
    </footer>
  </div>
</template>
