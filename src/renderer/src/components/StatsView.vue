<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import Icon from './Icon.vue'

const props = defineProps({
  isDark: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const stats = ref(null)
const monthEl = ref(null)
const calEl = ref(null)
const tagEl = ref(null)
let charts = []

const year = new Date().getFullYear()

const p2 = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

// streak / 最活跃的一天 / 活跃日均，由按天数据在本地计算
const derived = computed(() => {
  const s = stats.value
  if (!s) return { streak: 0, bestDay: null, avgActive: '0' }
  const daySet = new Set(s.daily.map((d) => d.day))
  // 今天没记不打断连续，从昨天往前数
  const cursor = new Date()
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (daySet.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  const bestDay = s.daily.reduce((m, d) => (d.count > (m?.count ?? 0) ? d : m), null)
  const avgActive = s.daily.length ? (s.total / s.daily.length).toFixed(1) : '0'
  return { streak, bestDay, avgActive }
})

function disposeCharts() {
  for (const c of charts) c.dispose()
  charts = []
}

function renderCharts() {
  const s = stats.value
  if (!s) return
  disposeCharts()
  const dark = props.isDark
  // 颜色从设计令牌里取，跟着主题深/浅与主题色一起变
  const cs = getComputedStyle(document.documentElement)
  const token = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  const accent = token('--brand', '#07c160')
  const text = token('--t2', '#5b6762')
  const line = token('--line2', '#dde3df')
  const soft = token('--surface', '#ffffff')
  const init = (el) => {
    const c = echarts.init(el, dark ? 'dark' : null)
    charts.push(c)
    return c
  }

  // 月度趋势（最近 12 个月）
  const monthly = s.monthly.slice(-12)
  init(monthEl.value).setOption({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: soft,
      borderColor: line,
      textStyle: { color: text }
    },
    xAxis: {
      type: 'category',
      data: monthly.map((m) => m.month),
      axisLabel: { color: text },
      axisLine: { lineStyle: { color: line } }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: line } }
    },
    series: [
      {
        type: 'bar',
        data: monthly.map((m) => m.count),
        barMaxWidth: 28,
        itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] }
      }
    ]
  })

  // 今年记录热力图
  const maxCount = Math.max(3, ...s.daily.map((d) => d.count))
  init(calEl.value).setOption({
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (p) => `${p.data[0]} · ${p.data[1]} 条`,
      backgroundColor: soft,
      borderColor: line,
      textStyle: { color: text }
    },
    visualMap: {
      min: 0,
      max: maxCount,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 90,
      textStyle: { color: text },
      inRange: { color: dark ? ['#262626', accent] : ['#f0f2f1', accent] }
    },
    calendar: {
      range: String(year),
      top: 28,
      left: 56,
      right: 24,
      bottom: 60,
      cellSize: ['auto', 13],
      splitLine: false,
      itemStyle: { borderColor: line, borderWidth: 2, color: 'transparent' },
      dayLabel: { color: text, firstDay: 1, nameMap: 'ZH' },
      monthLabel: { color: text, nameMap: 'ZH' },
      yearLabel: { show: false }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: s.daily.map((d) => [d.day, d.count])
      }
    ]
  })

  // 标签 TOP（横向条形，最多的在上面）
  const tags = [...s.tagCounts].reverse()
  if (tags.length && tagEl.value) {
    init(tagEl.value).setOption({
      backgroundColor: 'transparent',
      grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: soft,
        borderColor: line,
        textStyle: { color: text }
      },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: line } }
      },
      yAxis: {
        type: 'category',
        data: tags.map((t) => t.name),
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: line } }
      },
      series: [
        {
          type: 'bar',
          data: tags.map((t) => t.count),
          barMaxWidth: 16,
          itemStyle: { color: accent, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: text }
        }
      ]
    })
  }
}

function resizeCharts() {
  for (const c of charts) c.resize()
}

async function load() {
  stats.value = await window.api.getStats()
  await nextTick()
  renderCharts()
}

let offChanged = null
onMounted(() => {
  load()
  // 任何窗口改了笔记，统计页跟着刷新
  offChanged = window.api.onNotesChanged(load)
  window.addEventListener('resize', resizeCharts)
})

onBeforeUnmount(() => {
  offChanged?.()
  window.removeEventListener('resize', resizeCharts)
  disposeCharts()
})

// 主题切换后用对应主题重建图表
watch(() => props.isDark, renderCharts)
</script>

<template>
  <div class="h-full overflow-y-auto p-6 select-none">
    <div class="max-w-4xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-[15px] font-semibold">
          <Icon name="chart" cls="w-4 h-4 text-brand-text" />
          统计
        </h2>
        <button
          class="h-8 px-3 text-xs rounded-lg border border-line text-t2 hover:bg-hover transition"
          @click="emit('close')"
        >
          返回笔记
        </button>
      </div>

      <template v-if="stats && stats.total > 0">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="p-4 rounded-xl bg-surface border border-line shadow-sm">
            <p class="text-[11px] text-t3">总笔记</p>
            <p class="mt-1 text-2xl font-bold tabular-nums">{{ stats.total }}</p>
          </div>
          <div class="p-4 rounded-xl bg-surface border border-line shadow-sm">
            <p class="text-[11px] text-t3">本月新增</p>
            <p class="mt-1 text-2xl font-bold tabular-nums">{{ stats.monthCount }}</p>
          </div>
          <div class="p-4 rounded-xl bg-surface border border-line shadow-sm">
            <p class="text-[11px] text-t3">今日新增</p>
            <p class="mt-1 text-2xl font-bold tabular-nums">{{ stats.todayCount }}</p>
          </div>
          <div class="p-4 rounded-xl bg-surface border border-line shadow-sm">
            <p class="text-[11px] text-t3">连续记录</p>
            <p class="mt-1 text-2xl font-bold tabular-nums">{{ derived.streak }} 天</p>
          </div>
          <div class="p-4 rounded-xl bg-surface border border-line shadow-sm">
            <p class="text-[11px] text-t3">总字数</p>
            <p class="mt-1 text-2xl font-bold tabular-nums">{{ stats.totalChars }}</p>
          </div>
        </div>

        <p v-if="derived.bestDay" class="px-1 text-[11px] text-t3">
          最活跃的一天：{{ derived.bestDay.day }}（{{ derived.bestDay.count }} 条） · 活跃日平均 {{ derived.avgActive }} 条/天
        </p>

        <section class="p-4 rounded-xl bg-surface border border-line shadow-sm">
          <h3 class="text-xs font-semibold mb-3 text-t2">月度趋势（近 12 个月）</h3>
          <div ref="monthEl" class="h-56"></div>
        </section>

        <section class="p-4 rounded-xl bg-surface border border-line shadow-sm">
          <h3 class="text-xs font-semibold mb-3 text-t2">记录热力图（{{ year }}）</h3>
          <div ref="calEl" class="h-52"></div>
        </section>

        <section
          v-if="stats.tagCounts.length > 0"
          class="p-4 rounded-xl bg-surface border border-line shadow-sm"
        >
          <h3 class="text-xs font-semibold mb-3 text-t2">标签 TOP {{ stats.tagCounts.length }}</h3>
          <div ref="tagEl" class="h-64"></div>
        </section>
      </template>

      <div v-else-if="stats" class="py-24 flex flex-col items-center gap-3 text-t3">
        <div class="w-14 h-14 rounded-2xl bg-brand-soft flex items-center justify-center">
          <Icon name="chart" cls="w-7 h-7 text-brand-text" />
        </div>
        <p class="text-sm">还没有笔记，先去记一条吧</p>
      </div>
    </div>
  </div>
</template>
