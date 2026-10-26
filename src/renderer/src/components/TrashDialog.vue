<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { confirmDialog, showToast } from '../ui'

const emit = defineEmits(['close', 'changed'])

const TRASH_KEEP_DAYS = 30
const DAY = 86400000
const items = ref([])
const loading = ref(true)

const p2 = (n) => String(n).padStart(2, '0')
function fmtDate(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
// 剩余保留天数（不足 1 天按 1 天算，避免显示 0 天）
function daysLeft(ts) {
  return Math.max(1, Math.ceil((ts + TRASH_KEEP_DAYS * DAY - Date.now()) / DAY))
}
// 行入场动画的逐条延迟（最多 12 条，封顶避免长列表等待）
function rowDelay(i) {
  return { animationDelay: Math.min(i, 12) * 30 + 'ms' }
}

async function load() {
  loading.value = true
  items.value = await window.api.listDeletedNotes()
  loading.value = false
}

async function restore(item) {
  await window.api.restoreNotes([item.id])
  await load()
  emit('changed')
  showToast(`已恢复「${item.title || '无标题'}」`)
}

async function purge(item) {
  const ok = await confirmDialog(`彻底删除「${item.title || '无标题'}」？此操作不可恢复。`, {
    title: '彻底删除',
    okText: '彻底删除',
    danger: true
  })
  if (!ok) return
  await window.api.purgeNotes([item.id])
  await load()
  emit('changed')
  showToast('已彻底删除')
}

async function clearAll() {
  if (items.value.length === 0) return
  const ok = await confirmDialog(`清空回收站的 ${items.value.length} 条笔记？此操作不可恢复。`, {
    title: '清空回收站',
    okText: '全部彻底删除',
    danger: true
  })
  if (!ok) return
  await window.api.purgeNotes(items.value.map((n) => n.id))
  await load()
  emit('changed')
  showToast('回收站已清空')
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/50"
    @click.self="emit('close')"
  >
    <div class="trash-pop w-[540px] max-h-[78vh] flex flex-col rounded-2xl overflow-hidden bg-surface border border-line shadow-2xl select-none">
      <!-- 头部：图标 + 标题（副标题即保留说明） -->
      <header class="shrink-0 pl-4 pr-3 py-2.5 flex items-center gap-2.5 border-b border-line">
        <span class="w-9 h-9 rounded-[10px] bg-brand-soft2 text-brand-text flex items-center justify-center shrink-0">
          <Icon name="trash" cls="w-[18px] h-[18px]" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="text-[15px] font-semibold tracking-wide leading-5">回收站</h2>
            <span
              v-if="items.length"
              class="text-[10.5px] font-semibold text-brand-text bg-brand-soft2 px-1.5 py-px rounded-full tabular-nums leading-4"
            >
              {{ items.length }}
            </span>
          </div>
          <p class="mt-0.5 text-[10.5px] text-t3 leading-4">删除的笔记保留 {{ TRASH_KEEP_DAYS }} 天，超期自动清除</p>
        </div>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition shrink-0"
          title="关闭（Esc）"
          @click="emit('close')"
        >
          <Icon name="x" cls="w-4 h-4" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-2 py-2">
        <p v-if="loading" class="py-12 text-center text-xs text-t3">加载中…</p>

        <!-- 空状态 -->
        <div v-else-if="items.length === 0" class="py-12 flex flex-col items-center gap-2.5">
          <span class="w-12 h-12 rounded-full bg-chip text-t3 flex items-center justify-center">
            <Icon name="trash" cls="w-5 h-5" />
          </span>
          <p class="text-[13px] text-t2 font-medium">回收站是空的</p>
          <p class="text-[11px] text-t3">删除的笔记会先到这里，随时可以恢复</p>
        </div>

        <!-- 列表 -->
        <template v-else>
          <div
            v-for="(item, i) in items"
            :key="item.id"
            class="trash-row flex items-center gap-3 pl-2.5 pr-2 py-2 rounded-xl hover:bg-hover transition"
            :style="rowDelay(i)"
          >
            <span class="shrink-0 w-8 h-8 rounded-[9px] bg-chip text-t3 flex items-center justify-center">
              <Icon name="feather" cls="w-4 h-4" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-t1 truncate leading-5">
                {{ item.title || '无标题' }}
              </p>
              <div class="mt-0.5 flex items-center gap-2 text-[10.5px] text-t3 tabular-nums">
                <span>删除于 {{ fmtDate(item.deletedAt) }}</span>
                <span
                  class="px-1.5 py-px rounded-full"
                  :class="daysLeft(item.deletedAt) <= 3
                    ? 'text-danger bg-[#e5484d]/10 font-medium'
                    : 'bg-chip'"
                >
                  剩 {{ daysLeft(item.deletedAt) }} 天
                </span>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1">
              <button
                class="h-7 pl-2 pr-2.5 flex items-center gap-1 text-[11.5px] font-semibold rounded-md bg-brand-soft text-brand-text hover:bg-brand-soft2 transition"
                title="恢复到笔记列表"
                @click="restore(item)"
              >
                <Icon name="undo" cls="w-3.5 h-3.5" />
                恢复
              </button>
              <button
                class="w-7 h-7 rounded-md flex items-center justify-center text-t3 hover:text-danger hover:bg-[#e5484d]/10 transition"
                title="彻底删除，不可恢复"
                @click="purge(item)"
              >
                <Icon name="trash" cls="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- 底部：清空 / 计数 -->
      <footer
        v-if="items.length"
        class="shrink-0 h-12 px-3.5 flex items-center justify-between border-t border-line"
      >
        <button
          class="h-7 pl-2 pr-2.5 flex items-center gap-1.5 text-[11.5px] rounded-md text-danger hover:bg-[#e5484d]/10 transition"
          @click="clearAll"
        >
          <Icon name="trash" cls="w-3.5 h-3.5" />
          清空回收站
        </button>
        <span class="text-[10.5px] text-t3 tabular-nums">共 {{ items.length }} 条</span>
      </footer>
    </div>
  </div>
</template>

<style>
.trash-pop {
  animation: trash-pop 0.16s ease-out;
}
.trash-row {
  animation: trash-row 0.22s ease-out both;
}
@keyframes trash-pop {
  from {
    transform: scale(0.96) translateY(8px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}
@keyframes trash-row {
  from {
    transform: translateY(5px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
