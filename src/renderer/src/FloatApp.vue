<script setup>
import { ref, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import { applyTheme } from './theme'
import { startWindowDrag } from './drag'

const text = ref('')
const inputRef = ref(null)
const docked = ref(false)
const now = ref(new Date())
let tickTimer = null

function syncTheme() { applyTheme() }

async function submit() {
  const content = text.value.trim()
  if (!content) return
  await window.floatApi.submit(content)
  text.value = ''
  await nextTick()
  inputRef.value?.focus()
}

function close() { window.floatApi.close() }
function dock() { window.floatApi.dockNow() }
function undock() { window.floatApi.undockNow() }

// 标题栏拖动（自定义实现，方便显示抓手光标）
function onHeaderDrag(e) { startWindowDrag(window.floatApi, e) }

function onKeydown(e) {
  if (e.key === 'Escape') {
    close()
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

// 每秒更新时间，标题栏显示当前时分
function startTick() {
  stopTick()
  tickTimer = setInterval(() => { now.value = new Date() }, 1000)
}
function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}

const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

onMounted(() => {
  applyTheme()
  inputRef.value?.focus()
  startTick()

  window.addEventListener('focus', () => {
    syncTheme()
    if (!docked.value) inputRef.value?.focus()
  })

  window.floatApi.onDockState((v) => {
    docked.value = v
    if (!v) nextTick(() => inputRef.value?.focus())
  })
})

onBeforeUnmount(() => stopTick())
</script>

<template>
  <!-- 正常态：完整悬浮速记条 -->
  <div
    v-if="!docked"
    class="w-full h-full rounded-xl overflow-hidden bg-surface border border-line shadow-2xl flex flex-col"
  >
    <!-- 标题条（可拖动） -->
    <header
      class="h-9 flex items-center justify-between px-3 shrink-0 border-b border-line drag-handle"
      @pointerdown="onHeaderDrag"
    >
      <div class="flex items-center gap-2">
        <span
          class="w-4 h-4 rounded-[5px] bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-[9px] font-bold"
        >
          拾
        </span>
        <span class="text-[11px] text-t2 font-medium tracking-wide">
          悬浮速记
        </span>
        <span class="text-[10.5px] tabular-nums text-t3">
          {{ hhmm(now) }}
        </span>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          class="w-6 h-6 rounded flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 text-[13px] leading-none transition"
          title="贴边隐藏"
          @click="dock"
        >
          ‹
        </button>
        <button
          class="w-6 h-6 rounded flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 text-[13px] leading-none transition"
          title="关闭（回到主窗口） Esc"
          @click="close"
        >
          ×
        </button>
      </div>
    </header>

    <!-- 输入区 -->
    <textarea
      ref="inputRef"
      v-model="text"
      class="flex-1 min-h-0 p-3 text-[13px] resize-none outline-none bg-transparent text-t1 placeholder:text-t3 leading-6"
      placeholder="随手一记…"
      @keydown="onKeydown"
    ></textarea>

    <!-- 底部操作栏 -->
    <footer
      class="h-9 shrink-0 flex items-center justify-between px-2.5 border-t border-line bg-surface"
    >
      <button
        class="h-7 px-2.5 text-[11.5px] rounded-md text-t2 hover:bg-hover hover:text-t1 transition flex items-center gap-1"
        title="贴边隐藏"
        @click="dock"
      >
        <span class="text-[13px] leading-none">‹</span>
        贴边隐藏
      </button>
      <div class="flex items-center gap-1.5">
        <span class="text-[10.5px] text-t3">Ctrl+Enter 保存</span>
        <button
          class="h-7 px-3 text-[11.5px] rounded-md bg-brand text-white hover:bg-brand-hover font-semibold transition disabled:opacity-40 disabled:hover:bg-brand"
          :disabled="!text.trim()"
          @click="submit"
        >
          保存
        </button>
        <button
          class="h-7 px-2.5 text-[11.5px] rounded-md text-t2 hover:bg-hover hover:text-t1 transition"
          title="返回主窗口 Esc"
          @click="close"
        >
          返回
        </button>
      </div>
    </footer>
  </div>

  <!-- 贴边态：缩成贴着屏幕右边的小圆球（类似加速球），鼠标靠过去或点击就展开 -->
  <div v-else class="w-full h-full flex items-center justify-center">
    <button
      class="w-full h-full rounded-full bg-gradient-to-br from-brand to-brand-hover text-white shadow-lg flex items-center justify-center text-[15px] font-bold cursor-pointer hover:brightness-110 transition"
      title="点击展开悬浮速记（鼠标靠近也会自动滑出）"
      @click="undock"
    >
      拾
    </button>
  </div>
</template>
