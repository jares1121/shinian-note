<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  notes: { type: Array, required: true },
  selectedId: { type: [Number, null], default: null },
  selecting: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] },
  // 是否处于搜索/标签/时间筛选中（决定空状态文案）
  filtered: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'toggle', 'remove', 'remind', 'export', 'pin', 'create'])

/* ---------- 悬停「⋯」更多操作菜单 ---------- */
const MENU_W = 152
const MENU_H = 140
const menu = ref(null) // { note, rect, top, left }

function openMenu(note, e) {
  e.stopPropagation()
  const r = e.currentTarget.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = r.right - MENU_W
  left = Math.min(Math.max(left, 8), vw - MENU_W - 8)
  let top = r.bottom + 6
  if (top + MENU_H > vh - 8) top = Math.max(8, r.top - MENU_H - 6)
  menu.value = {
    note,
    rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
    top,
    left
  }
}
function closeMenu() {
  menu.value = null
}
function pick(action) {
  const item = menu.value
  menu.value = null
  if (!item) return
  if (action === 'remind') emit('remind', { note: item.note, rect: item.rect })
  else emit(action, item.note)
}
function onDocDown(e) {
  if (!menu.value) return
  if (e.target.closest?.('[data-note-menu], [data-note-more]')) return
  closeMenu()
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('blur', closeMenu)
  window.addEventListener('scroll', closeMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('blur', closeMenu)
  window.removeEventListener('scroll', closeMenu, true)
})

function isChecked(id) {
  return props.selectedIds.includes(id)
}

// 多选模式下点击卡片是勾选，否则是切换笔记
function onClick(id) {
  emit(props.selecting ? 'toggle' : 'select', id)
}

const DAY = 86400000

function dayLabel(d) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = startOfToday - startOfDay
  if (diff === 0) return '今天'
  if (diff === DAY) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// 置顶笔记单独成组排在最前，其余按更新日期分组（notes 已按 pinned+updatedAt 排序）
const groups = computed(() => {
  const result = []
  const pinnedNotes = props.notes.filter((n) => n.pinned)
  if (pinnedNotes.length) {
    result.push({ key: 'pinned', label: '置顶', notes: pinnedNotes })
  }
  let current = null
  for (const note of props.notes) {
    if (note.pinned) continue
    const d = new Date(note.updatedAt)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(d), notes: [] }
      result.push(current)
    }
    current.notes.push(note)
  }
  return result
})

function hhmm(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function snippet(content) {
  // 图片语法显示为占位符，不出现在摘要里
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 40 ? text.slice(0, 40) + '…' : text
}
</script>

<template>
  <ul class="flex-1 overflow-y-auto px-2 pb-3">
    <template v-for="group in groups" :key="group.key">
      <li
        class="sticky top-0 z-10 px-2 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-wider text-t3 bg-list"
      >
        {{ group.label }}
      </li>
      <li
        v-for="note in group.notes"
        :key="note.id"
        class="group relative mx-0.5 mb-0.5 px-3 py-2.5 rounded-[9px] cursor-pointer transition"
        :class="(selecting ? isChecked(note.id) : note.id === selectedId)
          ? 'bg-brand-soft shadow-[inset_3px_0_0_var(--brand)]'
          : 'hover:bg-hover'"
        @click="onClick(note.id)"
      >
        <div class="flex items-start gap-2">
          <span
            v-if="selecting"
            class="mt-[3px] w-4 h-4 shrink-0 rounded-[4px] border flex items-center justify-center transition"
            :class="isChecked(note.id)
              ? 'bg-brand border-brand text-white'
              : 'border-line2 bg-surface'"
          >
            <Icon v-if="isChecked(note.id)" name="check" cls="w-3 h-3" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-1.5">
              <Icon
                v-if="note.pinned"
                name="pin"
                cls="w-3 h-3 text-brand-text shrink-0 self-center"
              />
              <span class="flex-1 text-[13px] font-semibold leading-5 truncate">{{ note.title }}</span>
              <span
                class="shrink-0 text-[10.5px] tabular-nums transition-opacity"
                :class="(selecting ? isChecked(note.id) : note.id === selectedId) ? 'text-brand-text' : 'text-t3'"
              >
                {{ hhmm(note.updatedAt) }}
              </span>
            </div>
            <p class="mt-1 text-[11.5px] leading-relaxed text-t2 line-clamp-2">
              {{ snippet(note.content) || '（空）' }}
            </p>
            <div
              v-if="(note.tags && note.tags.length) || note.remindAt"
              class="mt-1.5 flex items-center gap-1.5 flex-wrap"
            >
              <span
                v-for="tag in note.tags"
                :key="tag.id"
                class="px-1.5 py-px text-[10.5px] rounded-[5px] bg-brand-soft2 text-brand-text"
              >
                {{ tag.name }}
              </span>
              <span v-if="note.remindAt" class="flex items-center gap-1 text-[10.5px] text-t3">
                <Icon name="bell" cls="w-3 h-3 text-brand-text" />
                {{ hhmm(note.remindAt) }}
              </span>
            </div>
          </div>
        </div>

        <!-- 悬停时右下角出现「⋯」，点开为更多操作（不遮挡右上角时间） -->
        <button
          v-if="!selecting"
          data-note-more
          class="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center bg-surface text-t3 hover:text-t1 hover:bg-hover shadow-sm opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition"
          title="更多操作"
          @click="openMenu(note, $event)"
        >
          <Icon name="more" cls="w-3.5 h-3.5" />
        </button>
      </li>
    </template>
    <li v-if="notes.length === 0" class="px-4 py-10 text-center">
      <template v-if="!filtered">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-brand-soft2 text-brand-text flex items-center justify-center">
          <Icon name="feather" cls="w-5 h-5" />
        </div>
        <p class="mt-3 text-[13px] font-medium text-t2">记下第一笔</p>
        <p class="mt-1 text-[11px] text-t3">随手记录想法、待办和灵感</p>
        <button
          class="mt-4 h-8 px-4 text-[12.5px] font-semibold rounded-lg text-white bg-brand hover:bg-brand-hover transition"
          @click="emit('create')"
        >
          新建笔记
        </button>
      </template>
      <p v-else class="text-xs text-t3">没有匹配的笔记</p>
    </li>
  </ul>

  <!-- 更多操作菜单：挂到 body，避免被列表滚动容器裁剪 -->
  <Teleport to="body">
    <div
      v-if="menu"
      data-note-menu
      class="fixed z-[90] rounded-lg bg-surface border border-line shadow-xl p-1 select-none"
      :style="{ width: MENU_W + 'px', top: menu.top + 'px', left: menu.left + 'px' }"
    >
      <button
        class="w-full h-7 px-2 rounded-md flex items-center gap-2 text-[12px] text-t2 hover:bg-hover hover:text-t1 transition"
        @click="pick('remind')"
      >
        <Icon name="bell" cls="w-3.5 h-3.5 text-t3" />
        设置提醒
      </button>
      <button
        class="w-full h-7 px-2 rounded-md flex items-center gap-2 text-[12px] text-t2 hover:bg-hover hover:text-t1 transition"
        @click="pick('pin')"
      >
        <Icon name="pin" cls="w-3.5 h-3.5 text-t3" />
        {{ menu.note.pinned ? '取消置顶' : '置顶' }}
      </button>
      <button
        class="w-full h-7 px-2 rounded-md flex items-center gap-2 text-[12px] text-t2 hover:bg-hover hover:text-t1 transition"
        @click="pick('export')"
      >
        <Icon name="download" cls="w-3.5 h-3.5 text-t3" />
        导出为 Markdown
      </button>
      <div class="my-1 h-px bg-line"></div>
      <button
        class="w-full h-7 px-2 rounded-md flex items-center gap-2 text-[12px] text-danger hover:bg-[#e5484d]/10 transition"
        @click="pick('remove')"
      >
        <Icon name="trash" cls="w-3.5 h-3.5" />
        删除
      </button>
    </div>
  </Teleport>
</template>
