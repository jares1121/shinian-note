<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  from: { type: String, default: '' },
  to: { type: String, default: '' }
})
const emit = defineEmits(['apply', 'close'])

const p2 = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const parse = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const today = new Date()
const start = ref(parse(props.from))
const end = ref(parse(props.to))
const view = ref(parse(props.from) ?? new Date())

const week = ['一', '二', '三', '四', '五', '六', '日']
const monthText = computed(() => `${view.value.getFullYear()}年${view.value.getMonth() + 1}月`)

// 周一为一周开始的月历格子，前后补空
const cells = computed(() => {
  const first = new Date(view.value.getFullYear(), view.value.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(view.value.getFullYear(), view.value.getMonth() + 1, 0).getDate()
  const list = []
  for (let i = 0; i < offset; i++) list.push(null)
  for (let d = 1; d <= days; d++) {
    list.push(new Date(view.value.getFullYear(), view.value.getMonth(), d))
  }
  while (list.length % 7 !== 0) list.push(null)
  return list
})

const same = (a, b) => a && b && keyOf(a) === keyOf(b)

function inRange(d) {
  if (!start.value || !end.value) return false
  const t = d.getTime()
  return t > start.value.getTime() && t < end.value.getTime()
}

// 第一次点选开始日，第二次点选结束日（早于开始日则重设开始日）
function pick(d) {
  if (!start.value || (start.value && end.value)) {
    start.value = d
    end.value = null
  } else if (d.getTime() < start.value.getTime()) {
    start.value = d
  } else {
    end.value = d
  }
}

function shift(delta) {
  view.value = new Date(view.value.getFullYear(), view.value.getMonth() + delta, 1)
}

function preset(days) {
  const e = new Date()
  const s = new Date()
  s.setDate(s.getDate() - (days - 1))
  start.value = s
  end.value = e
  view.value = new Date(s.getFullYear(), s.getMonth(), 1)
}

function thisMonth() {
  const n = new Date()
  start.value = new Date(n.getFullYear(), n.getMonth(), 1)
  end.value = n
  view.value = new Date(n.getFullYear(), n.getMonth(), 1)
}

function clear() {
  start.value = null
  end.value = null
}

function apply() {
  emit('apply', {
    from: start.value ? keyOf(start.value) : '',
    to: end.value ? keyOf(end.value) : ''
  })
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
        title="上月"
        @click="shift(-1)"
      >
        <Icon name="chevron-left" cls="w-3.5 h-3.5" />
      </button>
      <span class="text-xs font-semibold tabular-nums">{{ monthText }}</span>
      <button
        class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
        title="下月"
        @click="shift(1)"
      >
        <Icon name="chevron-right" cls="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="mt-1.5 grid grid-cols-7 text-center text-[10px] text-t3">
      <span v-for="w in week" :key="w" class="h-5 leading-5">{{ w }}</span>
    </div>

    <div class="grid grid-cols-7 justify-items-center">
      <template v-for="(d, i) in cells" :key="i">
        <span v-if="!d" class="h-6 w-6"></span>
        <button
          v-else
          class="h-6 w-6 rounded-md text-[11px] tabular-nums transition"
          :class="[
            same(d, start) || same(d, end)
              ? 'bg-brand text-white font-semibold'
              : inRange(d)
                ? 'bg-brand-soft text-brand-text'
                : 'text-t2 hover:bg-hover',
            same(d, today) && !same(d, start) && !same(d, end) ? 'ring-1 ring-brand-line' : ''
          ]"
          @click="pick(d)"
        >
          {{ d.getDate() }}
        </button>
      </template>
    </div>

    <div class="mt-1.5 flex items-center gap-1 text-[10.5px] text-t3">
      <button class="px-1.5 h-5 rounded bg-chip hover:bg-hover text-t2 transition" @click="preset(7)">
        近7天
      </button>
      <button class="px-1.5 h-5 rounded bg-chip hover:bg-hover text-t2 transition" @click="preset(30)">
        近30天
      </button>
      <button class="px-1.5 h-5 rounded bg-chip hover:bg-hover text-t2 transition" @click="thisMonth">
        本月
      </button>
      <button class="ml-auto px-1.5 h-5 rounded hover:bg-hover transition" @click="clear">
        清除
      </button>
    </div>

    <div class="mt-2 flex items-center justify-between border-t border-line pt-2">
      <span class="text-[10px] text-t3 tabular-nums">
        {{ start ? keyOf(start) : '开始' }} → {{ end ? keyOf(end) : '结束' }}
      </span>
      <div class="flex gap-1.5">
        <button
          class="h-6 px-2 text-[11px] rounded-md border border-line text-t2 hover:bg-hover transition"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          class="h-6 px-2 text-[11px] rounded-md bg-brand text-white font-semibold hover:bg-brand-hover transition"
          @click="apply"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>
