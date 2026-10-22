<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { overlay, resolveConfirm } from '../ui'

function onKeydown(e) {
  if (!overlay.confirm) return
  if (e.key === 'Escape') resolveConfirm(false)
  else if (e.key === 'Enter') resolveConfirm(true)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- 确认框：居中于软件窗口，不是屏幕 -->
    <div
      v-if="overlay.confirm"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/25"
      @click.self="resolveConfirm(false)"
    >
      <div class="w-[340px] rounded-xl bg-surface border border-line shadow-xl p-5">
        <h3 class="text-sm font-semibold">{{ overlay.confirm.title }}</h3>
        <p class="mt-2 text-[12.5px] leading-relaxed text-t2 whitespace-pre-wrap">
          {{ overlay.confirm.message }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            class="h-8 px-3.5 text-xs rounded-lg border border-line text-t2 hover:bg-hover transition"
            @click="resolveConfirm(false)"
          >
            {{ overlay.confirm.cancelText }}
          </button>
          <button
            class="h-8 px-3.5 text-xs rounded-lg font-semibold text-white transition"
            :class="overlay.confirm.danger
              ? 'bg-danger hover:bg-danger/90'
              : 'bg-brand hover:bg-brand-hover'"
            @click="resolveConfirm(true)"
          >
            {{ overlay.confirm.okText }}
          </button>
        </div>
      </div>
    </div>

    <!-- 操作结果提示 -->
    <div
      v-if="overlay.toast"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-3.5 py-2 rounded-lg bg-t1 text-surface text-xs shadow-lg"
    >
      {{ overlay.toast }}
    </div>
  </Teleport>
</template>
