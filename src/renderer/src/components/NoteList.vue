<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  notes: { type: Array, required: true },
  selectedId: { type: [Number, null], default: null },
  selecting: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['select', 'toggle'])

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

// 按更新日期分组（notes 已按 updatedAt 倒序）
const groups = computed(() => {
  const result = []
  let current = null
  for (const note of props.notes) {
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
        class="mx-0.5 mb-0.5 px-3 py-2.5 rounded-[9px] cursor-pointer transition"
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
            <div class="flex items-baseline gap-2">
              <span class="flex-1 text-[13px] font-semibold leading-5 truncate">{{ note.title }}</span>
              <span
                class="shrink-0 text-[10.5px] tabular-nums"
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
      </li>
    </template>
    <li v-if="notes.length === 0" class="px-4 py-10 text-center text-xs text-t3">
      没有匹配的笔记
    </li>
  </ul>
</template>
