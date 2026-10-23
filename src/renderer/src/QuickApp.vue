<script setup>
import { ref, onMounted } from 'vue'
import { applyTheme } from './theme'
import Icon from './components/Icon.vue'
import { startWindowDrag } from './drag'

const text = ref('')
const inputRef = ref(null)

// 标题栏拖动（自定义实现，方便显示抓手光标）
function onHeaderDrag(e) { startWindowDrag(window.quickApi, e) }

// 主窗口切换主题后，速记窗下次显示时同步
function syncTheme() {
  applyTheme()
}

async function submit() {
  const content = text.value.trim()
  if (content) {
    await window.quickApi.submit(content)
  }
  text.value = ''
  await window.quickApi.hide()
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    window.quickApi.hide()
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    submit()
  }
}

onMounted(() => {
  inputRef.value?.focus()
  // 每次窗口重新显示（获得焦点）时，光标回到输入框，并同步最新主题
  window.addEventListener('focus', () => {
    syncTheme()
    inputRef.value?.focus()
  })
})
</script>

<template>
  <div class="h-screen flex flex-col bg-surface rounded-lg overflow-hidden border border-brand-line shadow-xl">
    <div
      class="px-3 py-2 bg-gradient-to-r from-brand to-brand-hover text-white text-xs flex items-center justify-between select-none drag-handle"
      @pointerdown="onHeaderDrag"
    >
      <span class="flex items-center gap-1.5 font-semibold tracking-wide">
        <Icon name="feather" cls="w-3.5 h-3.5" />
        拾念 · 速记
      </span>
      <span class="text-white/75">Ctrl+Enter 保存 · Esc 关闭</span>
    </div>
    <textarea
      ref="inputRef"
      v-model="text"
      class="flex-1 w-full p-3 resize-none outline-none text-sm leading-6 bg-transparent text-t1 placeholder:text-t3"
      placeholder="此刻在想什么？"
      @keydown="onKeydown"
    ></textarea>
  </div>
</template>
