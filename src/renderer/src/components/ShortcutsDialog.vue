<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const emit = defineEmits(['close'])

const groups = [
  {
    label: '全局',
    items: [
      { name: '速记悬浮窗', keys: ['Ctrl', 'Shift', 'N'] },
      { name: '打开主窗口', text: '点击托盘图标' }
    ]
  },
  {
    label: '主窗口',
    items: [
      { name: '新建笔记', keys: ['Ctrl', 'N'] },
      { name: '专注模式', keys: ['Ctrl', 'Shift', 'M'] },
      { name: '关闭弹层 / 退出专注', keys: ['Esc'] },
      { name: '快捷键帮助', keys: ['F1'] }
    ]
  },
  {
    label: '编辑器',
    items: [
      { name: '加粗', keys: ['Ctrl', 'B'] },
      { name: '斜体', keys: ['Ctrl', 'I'] }
    ]
  },
  {
    label: '速记窗',
    items: [
      { name: '保存并关闭', keys: ['Ctrl', 'Enter'] },
      { name: '收起', keys: ['Esc'] }
    ]
  }
]

function onKeydown(e) {
  if (e.key === 'Escape' || e.key === 'F1') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/50"
    @click.self="emit('close')"
  >
    <div class="w-[380px] max-h-[76vh] flex flex-col rounded-2xl overflow-hidden bg-surface border border-line shadow-2xl select-none">
      <header class="shrink-0 pl-4 pr-3 py-2.5 flex items-center gap-2.5 border-b border-line">
        <span class="w-9 h-9 rounded-[10px] bg-brand-soft2 text-brand-text flex items-center justify-center shrink-0">
          <Icon name="enter" cls="w-[18px] h-[18px]" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold tracking-wide leading-5">快捷键</h2>
          <p class="mt-0.5 text-[10.5px] text-t3 leading-4">Mac 上 Ctrl 对应 Cmd</p>
        </div>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition shrink-0"
          title="关闭（Esc）"
          @click="emit('close')"
        >
          <Icon name="x" cls="w-4 h-4" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-3">
        <section v-for="group in groups" :key="group.label" class="mb-3 last:mb-0">
          <p class="mb-1.5 text-[10.5px] font-semibold tracking-wider text-t3">{{ group.label }}</p>
          <div class="rounded-xl border border-line overflow-hidden">
            <div
              v-for="(item, i) in group.items"
              :key="item.name"
              class="h-9 px-3 flex items-center justify-between"
              :class="i > 0 ? 'border-t border-line' : ''"
            >
              <span class="text-[12.5px] text-t1">{{ item.name }}</span>
              <span v-if="item.text" class="text-[10.5px] text-t3">{{ item.text }}</span>
              <span v-else class="flex items-center gap-1">
                <kbd
                  v-for="k in item.keys"
                  :key="k"
                  class="h-5.5 px-1.5 min-w-5 inline-flex items-center justify-center rounded-[5px] bg-chip border border-line text-[10.5px] font-medium text-t2 leading-none"
                >
                  {{ k }}
                </kbd>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
