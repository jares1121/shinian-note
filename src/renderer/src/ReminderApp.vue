<script setup>
import { ref, onMounted } from 'vue'
import { applyTheme } from './theme'
import Icon from './components/Icon.vue'
import { startWindowDrag } from './drag'

const items = ref([])
let audioCtx = null

// 标题栏拖动（自定义实现，方便显示抓手光标）
function onHeaderDrag(e) { startWindowDrag(window.reminderApi, e) }

// 主窗口切换主题后，提醒窗下次显示时同步
function syncTheme() {
  applyTheme()
}

function fmt(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 提示音：Web Audio 合成两声短音，无需音频文件
function beep() {
  try {
    audioCtx ??= new AudioContext()
    const t0 = audioCtx.currentTime
    for (const [freq, start] of [[880, 0], [660, 0.25]]) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.001, t0 + start)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + start + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + 0.25)
      osc.start(t0 + start)
      osc.stop(t0 + start + 0.3)
    }
  } catch {
    // 没声音也不影响弹窗本身
  }
}

function open(id) {
  window.reminderApi.open(id)
}

function dismissAll() {
  window.reminderApi.dismissAll()
}

onMounted(async () => {
  items.value = await window.reminderApi.getList()
  if (items.value.length) beep()
  // 主进程追加新提醒时推送最新列表；数量变多再响一次
  window.reminderApi.onList((list) => {
    if (list.length > items.value.length) beep()
    items.value = list
  })
  window.addEventListener('focus', syncTheme)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismissAll()
  })
})
</script>

<template>
  <div class="h-screen flex flex-col bg-surface rounded-xl overflow-hidden border border-brand-line shadow-2xl">
    <div
      class="px-3.5 py-2.5 bg-gradient-to-r from-brand to-brand-hover text-white flex items-center justify-between select-none drag-handle"
      @pointerdown="onHeaderDrag"
    >
      <span class="flex items-center gap-2 text-[13px] font-semibold">
        <Icon name="bell" cls="w-4 h-4" />
        拾念提醒 · {{ items.length }} 条
      </span>
      <button
        class="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/20 transition"
        title="全部关闭（Esc）"
        @click="dismissAll"
      >
        <Icon name="x" cls="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div
        v-for="n in items"
        :key="n.id"
        class="flex items-center gap-2 p-2 rounded-lg bg-brand-soft"
      >
        <div class="flex-1 min-w-0">
          <p class="text-[13px] font-medium truncate text-t1">{{ n.title }}</p>
          <p class="text-[11px] text-t3 mt-0.5">{{ fmt(n.remindAt) }}</p>
        </div>
        <button
          class="shrink-0 h-7 px-2.5 text-[11.5px] rounded-md bg-brand text-white hover:bg-brand-hover active:scale-95 transition"
          @click="open(n.id)"
        >
          打开笔记
        </button>
      </div>

      <p v-if="items.length === 0" class="py-10 text-center text-xs text-t3">暂时没有提醒</p>
    </div>

    <div class="px-3 py-2 border-t border-line flex items-center justify-between">
      <span class="text-[11px] text-t3">窗口不会自动关闭</span>
      <button
        class="h-7 px-2.5 text-[11.5px] rounded-md text-t2 hover:bg-hover transition"
        @click="dismissAll"
      >
        全部知道了
      </button>
    </div>
  </div>
</template>
