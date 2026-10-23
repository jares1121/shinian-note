<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  year: { type: Number, required: true },
  month: { type: Number, required: true } // 1-12
})
const emit = defineEmits(['apply', 'close'])

const today = new Date()
const viewYear = ref(props.year)
const viewMonth = ref(props.month) // 1-12

const monthText = () => `${viewYear.value}年${viewMonth.value}月`

// 月份网格：4 行 × 3 列 = 12 个月
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

// 年/月 双数字比较
function isSelected(y, m) { return y === props.year && m === props.month }
function isToday(y, m) { return y === today.getFullYear() && m === today.getMonth() + 1 }

function shiftYear(delta) { viewYear.value += delta }

function pickMonth(m) {
  viewMonth.value = m
  emit('apply', { year: viewYear.value, month: m })
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-surface border border-line shadow-xl p-2.5 select-none"
  >
    <div class="flex items-center justify-between px-0.5">
      <button
        class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
        title="上一年"
        @click="shiftYear(-1)"
      >
        <Icon name="chevron-left" cls="w-3.5 h-3.5" />
      </button>
      <span class="text-xs font-semibold tabular-nums">{{ viewYear.value }}年</span>
      <button
        class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
        title="下一年"
        @click="shiftYear(1)"
      >
        <Icon name="chevron-right" cls="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- 月份网格 -->
    <div class="mt-2 grid grid-cols-3 gap-1">
      <button
        v-for="(label, idx) in MONTH_NAMES"
        :key="idx"
        class="h-9 rounded-md text-[11.5px] tabular-nums transition"
        :class="[
          isSelected(viewYear, idx + 1)
            ? 'bg-brand text-white font-semibold'
            : 'text-t2 hover:bg-hover',
          isToday(viewYear, idx + 1) && !isSelected(viewYear, idx + 1)
            ? 'ring-1 ring-brand-line'
            : ''
        ]"
        @click="pickMonth(idx + 1)"
      >
        {{ label }}
      </button>
    </div>

    <!-- 快捷操作 -->
    <div class="mt-2 flex items-center gap-1 text-[10.5px]">
      <button
        class="px-1.5 h-5 rounded bg-chip hover:bg-hover text-t2 transition"
        @click="pickMonth(today.getMonth() + 1); viewYear = today.getFullYear()"
      >
        跳本月
      </button>
      <button
        class="ml-auto px-1.5 h-5 rounded hover:bg-hover text-t2 transition"
        @click="emit('close')"
      >
        关闭
      </button>
    </div>
  </div>
</template>
