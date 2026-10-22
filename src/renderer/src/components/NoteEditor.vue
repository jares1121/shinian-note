<script setup>
import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { marked } from 'marked'
import TagEditor from './TagEditor.vue'
import Icon from './Icon.vue'
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
const remindRef = ref(null)
const editingRemind = ref(false)
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

// datetime-local 需要的格式：YYYY-MM-DDTHH:MM（本地时区）
const remindInput = computed(() => {
  if (!props.note.remindAt) return ''
  const d = new Date(props.note.remindAt)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
})

function startEditRemind() {
  editingRemind.value = true
  nextTick(() => remindRef.value?.focus())
}

async function onRemindPick(e) {
  const value = e.target.value
  if (!value) return
  await window.api.setNoteReminder(props.note.id, new Date(value).getTime())
  editingRemind.value = false
  emit('saved')
}

async function clearReminder() {
  await window.api.setNoteReminder(props.note.id, null)
  editingRemind.value = false
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

async function remove() {
  const ok = await confirmDialog('确定删除这条笔记吗？删除后无法恢复。', {
    title: '删除笔记',
    okText: '删除',
    danger: true
  })
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
          <!-- 未设置：虚线圈 -->
          <button
            v-if="!editingRemind && !note.remindAt"
            class="h-7 px-2 rounded-full border border-dashed border-line2 text-t3 text-[11.5px] flex items-center gap-1 hover:text-brand-text hover:border-brand-line hover:bg-brand-soft transition"
            @click="startEditRemind"
          >
            <Icon name="bell" cls="w-3.5 h-3.5" />
            设置提醒
          </button>

          <!-- 已设置：品牌色胶囊 -->
          <template v-else-if="!editingRemind">
            <button
              class="h-7 px-2.5 rounded-full bg-brand-soft text-brand-text text-[11.5px] flex items-center gap-1 hover:bg-brand-soft2 transition"
              title="修改提醒时间"
              @click="startEditRemind"
            >
              <Icon name="bell" cls="w-3.5 h-3.5" />
              提醒 {{ fmtDate(note.remindAt) }}
            </button>
            <button
              class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:text-danger hover:bg-hover transition"
              title="清除提醒"
              @click="clearReminder"
            >
              <Icon name="x" cls="w-3.5 h-3.5" />
            </button>
          </template>

          <!-- 编辑时间 -->
          <template v-else>
            <input
              ref="remindRef"
              type="datetime-local"
              :value="remindInput"
              class="h-7 px-2 rounded-md bg-chip text-[11.5px] text-t2 outline-none focus:ring-2 focus:ring-brand-line dark:[color-scheme:dark]"
              @change="onRemindPick"
            />
            <button
              class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="取消"
              @click="editingRemind = false"
            >
              <Icon name="x" cls="w-3.5 h-3.5" />
            </button>
          </template>
        </div>
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
