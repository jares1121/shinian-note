<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

defineProps({
  mode: { type: String, default: 'system' },
  accent: { type: String, default: 'green' }
})
const emit = defineEmits(['close', 'set-mode', 'set-accent', 'export-all', 'backup', 'restore'])

const modes = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' }
]

const accents = [
  { value: 'green', label: '微信绿', color: '#07c160' },
  { value: 'amber', label: '琥珀', color: '#f59e0b' },
  { value: 'blue', label: '蓝', color: '#2563eb' }
]

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/50" @click.self="emit('close')">
    <div class="w-[420px] max-h-[80vh] flex flex-col rounded-2xl overflow-hidden bg-surface border border-line shadow-2xl select-none">
      <header class="h-14 shrink-0 px-5 flex items-center justify-between border-b border-line">
        <h2 class="text-[15px] font-semibold tracking-wide">设置</h2>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
          title="关闭（Esc）"
          @click="emit('close')"
        >
          <Icon name="x" cls="w-4 h-4" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <!-- 外观 -->
        <section>
          <p class="mb-2 text-[11px] font-semibold tracking-wider text-t3">外观</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in modes"
              :key="opt.value"
              class="h-9 rounded-lg border flex items-center justify-center gap-1.5 text-xs transition"
              :class="mode === opt.value
                ? 'bg-brand-soft border-brand-line text-brand-text font-semibold'
                : 'border-line text-t2 hover:bg-hover'"
              @click="emit('set-mode', opt.value)"
            >
              <Icon :name="opt.icon" cls="w-4 h-4" />
              {{ opt.label }}
            </button>
          </div>

          <div class="mt-2 grid grid-cols-3 gap-2">
            <button
              v-for="a in accents"
              :key="a.value"
              class="h-9 rounded-lg border flex items-center justify-center gap-2 text-xs transition"
              :class="accent === a.value
                ? 'bg-brand-soft border-brand-line font-semibold'
                : 'border-line text-t2 hover:bg-hover'"
              @click="emit('set-accent', a.value)"
            >
              <span
                class="w-3.5 h-3.5 rounded-full"
                :class="{ 'ring-2 ring-offset-2 ring-offset-surface': accent === a.value }"
                :style="{ background: a.color, '--tw-ring-color': a.color }"
              ></span>
              {{ a.label }}
            </button>
          </div>
        </section>

        <!-- 数据 -->
        <section>
          <p class="mb-2 text-[11px] font-semibold tracking-wider text-t3">数据</p>
          <div class="rounded-xl border border-line overflow-hidden">
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-hover transition"
              @click="emit('export-all')"
            >
              <Icon name="download" cls="w-4 h-4 text-t3" />
              <span class="flex-1">
                <span class="block text-[13px]">导出全部笔记</span>
                <span class="block text-[11px] text-t3 mt-0.5">导出为 Markdown 文件到指定文件夹</span>
              </span>
              <Icon name="chevron-right" cls="w-3.5 h-3.5 text-t3" />
            </button>
            <div class="h-px bg-line"></div>
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-hover transition"
              @click="emit('backup')"
            >
              <Icon name="archive" cls="w-4 h-4 text-t3" />
              <span class="flex-1">
                <span class="block text-[13px]">备份数据库</span>
                <span class="block text-[11px] text-t3 mt-0.5">把全部笔记保存为一个 .db 文件</span>
              </span>
              <Icon name="chevron-right" cls="w-3.5 h-3.5 text-t3" />
            </button>
            <div class="h-px bg-line"></div>
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:text-danger hover:bg-hover transition"
              @click="emit('restore')"
            >
              <Icon name="restore" cls="w-4 h-4 text-t3" />
              <span class="flex-1">
                <span class="block text-[13px]">从备份恢复</span>
                <span class="block text-[11px] text-t3 mt-0.5">会用备份覆盖当前数据，操作不可撤销</span>
              </span>
              <Icon name="chevron-right" cls="w-3.5 h-3.5 text-t3" />
            </button>
          </div>
        </section>

        <!-- 关于 -->
        <section>
          <p class="mb-2 text-[11px] font-semibold tracking-wider text-t3">关于</p>
          <div class="flex items-center gap-3 px-1">
            <div class="w-9 h-9 rounded-[10px] bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-base font-bold shadow-sm">拾</div>
            <div class="text-[11.5px] leading-5 text-t3">
              <p class="text-[13px] text-t1 font-medium">拾念 v0.1</p>
              <p>数据只保存在本机，不联网、不上传</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
