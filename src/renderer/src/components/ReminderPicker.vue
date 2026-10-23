<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  date: { type: String, default: '' }, // YYYY-MM-DD
  time: { type: String, default: '' }, // HH:MM:SS
  repeat: { type: String, default: '' }, // '' / daily / workday / weekly:1,3,5
  anchor: { type: Object, required: true } // { top, left, right, bottom } from getBoundingClientRect
})
const emit = defineEmits(['apply', 'close'])

const p2 = (n) => String(n).padStart(2, '0')
const parseDate = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const parseTime = (s) => {
  if (!s) return null
  const [h, mi, se] = s.split(':').map(Number)
  return { h, mi, s: se ?? 0 }
}

const ITEM_H = 22
const PAD = 1
const VISIBLE = 3
const POPUP_W = 252
const GAP = 8

const today = new Date()
const picked = ref(parseDate(props.date) ?? today)
const hour = ref(parseTime(props.time)?.h ?? today.getHours())
const minute = ref(parseTime(props.time)?.mi ?? today.getMinutes())
const second = ref(parseTime(props.time)?.s ?? 0)
const view = ref(parseDate(props.date) ?? today)
const smoothHour = ref(true)
const smoothMinute = ref(true)
const smoothSecond = ref(true)

// 弹层定位用 ref（渲染完才能拿到真实高度）
const popupEl = ref(null)
const popupStyle = ref({})

const week = ['一', '二', '三', '四', '五', '六', '日']
const monthText = computed(() => `${view.value.getFullYear()}年${view.value.getMonth() + 1}月`)
const keyOf = (d) => d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : ''
const timeStr = computed(() => `${p2(hour.value)}:${p2(minute.value)}:${p2(second.value)}`)

/* ---------- 重复规则 ---------- */
const repeatOptions = [
  { key: 'none', label: '不重复' },
  { key: 'daily', label: '每天' },
  { key: 'workday', label: '工作日' },
  { key: 'weekly', label: '每周' }
]
// 0 = 周日，与 Date.getDay() 对齐；展示顺序周一 → 周日
const weekdayOptions = [
  { v: 1, label: '一' }, { v: 2, label: '二' }, { v: 3, label: '三' },
  { v: 4, label: '四' }, { v: 5, label: '五' }, { v: 6, label: '六' }, { v: 0, label: '日' }
]
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEK_LONG = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WORKDAYS = [1, 2, 3, 4, 5]
const initialRepeat = props.repeat || ''
const repeatMode = ref(
  initialRepeat.startsWith('weekly:') ? 'weekly'
    : initialRepeat === 'daily' || initialRepeat === 'workday' ? initialRepeat : 'none'
)
const weeklyDays = ref(
  initialRepeat.startsWith('weekly:') ? initialRepeat.slice(7).split(',').map(Number) : []
)
// 连续的星期压缩成「周一至周六」，避免一串星期把弹层撑宽
function daysLabel(days) {
  const sorted = WEEK_ORDER.filter((d) => days.includes(d))
  if (sorted.length === 0) return ''
  if (sorted.length === 7) return '每天'
  const pos = sorted.map((d) => WEEK_ORDER.indexOf(d))
  const consecutive = pos.every((v, i) => i === 0 || v === pos[i - 1] + 1)
  if (consecutive && sorted.length >= 3) {
    return `${WEEK_LONG[sorted[0]]}至${WEEK_LONG[sorted[sorted.length - 1]]}`
  }
  return sorted.map((d) => WEEK_LONG[d]).join('、')
}
// 工作日默认周一至周五，但允许在下面继续加减星期（例如周六要上班）
const activeDays = computed(() => (repeatMode.value === 'workday' ? WORKDAYS : weeklyDays.value))
const repeatValue = computed(() => {
  if (repeatMode.value === 'weekly') {
    return weeklyDays.value.length ? 'weekly:' + [...weeklyDays.value].sort().join(',') : ''
  }
  return repeatMode.value === 'none' ? '' : repeatMode.value
})
const canApply = computed(() => repeatMode.value !== 'weekly' || weeklyDays.value.length > 0)
const previewText = computed(() => {
  if (repeatMode.value === 'daily') return `每天 ${timeStr.value}`
  if (repeatMode.value === 'workday') return `工作日（周一至周五） ${timeStr.value}`
  if (repeatMode.value === 'weekly') {
    return weeklyDays.value.length ? `${daysLabel(weeklyDays.value)} ${timeStr.value}` : '请选择星期'
  }
  return `${keyOf(picked.value)} ${timeStr.value}`
})
function setRepeatMode(k) {
  repeatMode.value = k
  // 每次切换都重置星期选中态：工作日固定一~五，每周回到「当前选中的那一天」
  if (k === 'workday') weeklyDays.value = [...WORKDAYS]
  else if (k === 'weekly') weeklyDays.value = [picked.value.getDay()]
  else weeklyDays.value = []
}
function toggleDay(v) {
  // 工作日模式下改星期自动转成自定义每周，勾上「六」就是周一至周六（单休）
  const base = repeatMode.value === 'workday' ? [...WORKDAYS] : [...weeklyDays.value]
  const i = base.indexOf(v)
  if (i >= 0) base.splice(i, 1)
  else base.push(v)
  weeklyDays.value = base
  repeatMode.value = 'weekly'
}

const hoursRaw = Array.from({ length: 24 }, (_, i) => i)
const hoursPadded = [...hoursRaw.slice(-PAD), ...hoursRaw, ...hoursRaw.slice(0, PAD)]
const minutesRaw = Array.from({ length: 60 }, (_, i) => i)
const minutesPadded = [...minutesRaw.slice(-PAD), ...minutesRaw, ...minutesRaw.slice(0, PAD)]
const secondsRaw = Array.from({ length: 60 }, (_, i) => i)
const secondsPadded = [...secondsRaw.slice(-PAD), ...secondsRaw, ...secondsRaw.slice(0, PAD)]

const hourY = computed(() => `translateY(${-(hour.value + PAD) * ITEM_H}px)`)
const minuteY = computed(() => `translateY(${-(minute.value + PAD) * ITEM_H}px)`)
const secondY = computed(() => `translateY(${-(second.value + PAD) * ITEM_H}px)`)

function updatePopupStyle() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = popupEl.value?.getBoundingClientRect()
  const realH = rect ? rect.height : 340 // 没渲染出来时先用估算

  // 水平：弹层右边缘对齐按钮右边缘
  let left = props.anchor.right - POPUP_W
  if (left < 8) left = 8
  if (left > vw - POPUP_W - 8) left = Math.max(8, vw - POPUP_W - 8)

  // 垂直：按钮下方够就往下弹，不够就往上弹
  const belowSpace = vh - props.anchor.bottom - 8
  const aboveSpace = props.anchor.top - 8
  const goAbove = belowSpace < realH && aboveSpace > belowSpace

  const style = { left: left + 'px' }
  if (goAbove) {
    // 往上弹，弹层底边 = 按钮顶边 - 8
    let bottom = vh - props.anchor.top + GAP
    // 防越界顶部
    if (bottom > vh - realH) bottom = vh - realH
    style.bottom = bottom + 'px'
  } else {
    // 往下弹
    let top = props.anchor.bottom + GAP
    // 防越界底部
    if (top + realH > vh - 4) top = Math.max(4, vh - realH - 4)
    style.top = top + 'px'
  }
  popupStyle.value = style
}

const cells = computed(() => {
  const first = new Date(view.value.getFullYear(), view.value.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(view.value.getFullYear(), view.value.getMonth() + 1, 0).getDate()
  const list = []
  for (let i = 0; i < offset; i++) list.push(null)
  for (let d = 1; d <= days; d++) list.push(new Date(view.value.getFullYear(), view.value.getMonth(), d))
  while (list.length % 7 !== 0) list.push(null)
  return list
})

function sameDate(a, b) { return a && b && keyOf(a) === keyOf(b) }
function isHourSelected(v) { return v === hour.value }
function isMinuteSelected(v) { return v === minute.value }
function isSecondSelected(v) { return v === second.value }
function pickDate(d) { picked.value = d }
function shiftMonth(delta) { view.value = new Date(view.value.getFullYear(), view.value.getMonth() + delta, 1) }
function clampHour(v) { smoothHour.value = true; hour.value = ((v % 24) + 24) % 24 }
function clampMinute(v) { smoothMinute.value = true; minute.value = ((v % 60) + 60) % 60 }
function clampSecond(v) { smoothSecond.value = true; second.value = ((v % 60) + 60) % 60 }

function apply() {
  if (!canApply.value) return
  emit('apply', { date: keyOf(picked.value), time: timeStr.value, repeat: repeatValue.value })
}

function onKeydown(e) { if (e.key === 'Escape') emit('close') }
function onDocClick(e) {
  if (!document.getElementById('reminder-picker-root')?.contains(e.target)) emit('close')
}

onMounted(async () => {
  // 首次 render 完后用真实高度重新定位
  await nextTick()
  updatePopupStyle()
  window.addEventListener('resize', updatePopupStyle)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePopupStyle)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocClick)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="popupEl"
      id="reminder-picker-root"
      class="fixed z-[80] rounded-xl bg-surface border border-line shadow-2xl p-2.5 select-none"
      :style="{ width: POPUP_W + 'px', ...popupStyle }"
    >
      <!-- 日期区：仅在「不重复」时出现，重复规则由星期/工作日决定日期 -->
      <template v-if="repeatMode === 'none'">
        <div class="flex items-center justify-between px-0.5">
          <button class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
            @click="shiftMonth(-1)"><Icon name="chevron-left" cls="w-3.5 h-3.5" /></button>
          <span class="text-xs font-semibold tabular-nums">{{ monthText }}</span>
          <button class="w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
            @click="shiftMonth(1)"><Icon name="chevron-right" cls="w-3.5 h-3.5" /></button>
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
                sameDate(d, picked) ? 'bg-brand text-white font-semibold' : 'text-t2 hover:bg-hover',
                sameDate(d, today) && !sameDate(d, picked) ? 'ring-1 ring-brand-line' : ''
              ]"
              @click="pickDate(d)"
            >{{ d.getDate() }}</button>
          </template>
        </div>
      </template>

      <!-- 时间区：时 / 分 / 秒 三个滚轮（步进均为 1，滚轮下滑 = 数值变大） -->
      <div :class="repeatMode === 'none' ? 'mt-2 border-t border-line pt-2' : ''">
        <div class="text-[10.5px] text-t3 mb-0.5 px-0.5">时 间</div>
        <div class="flex items-stretch gap-1.5">
          <!-- 小时列 -->
          <div class="flex-1 flex flex-col">
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="上一小时" @click="clampHour(hour - 1)"><Icon name="chevron-left" cls="w-3 h-3 rotate-90" /></button>
            <div class="relative overflow-hidden rounded-md border border-line my-0.5" :style="{ height: VISIBLE * ITEM_H + 'px' }">
              <div class="absolute left-0 right-0 bg-brand-soft pointer-events-none"
                :style="{ top: PAD * ITEM_H + 'px', height: ITEM_H + 'px' }"></div>
              <div class="will-change-transform"
                :class="smoothHour ? 'transition-transform duration-150 ease-out' : ''"
                :style="{ transform: hourY }"
                @wheel.prevent="(e) => { smoothHour = false; clampHour(hour + Math.sign(e.deltaY)) }">
                <button
                  v-for="(v, i) in hoursPadded" :key="'h'+i"
                  class="block w-full text-[11px] tabular-nums transition"
                  :class="isHourSelected(v) ? 'text-brand-text font-semibold' : 'text-t2 hover:text-t1'"
                  :style="{ height: ITEM_H + 'px', lineHeight: ITEM_H + 'px' }"
                  @click="clampHour(v)"
                >{{ p2(v) }}</button>
              </div>
            </div>
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="下一小时" @click="clampHour(hour + 1)"><Icon name="chevron-left" cls="w-3 h-3 -rotate-90" /></button>
          </div>

          <div class="w-1.5 flex items-center justify-center text-t2 font-semibold">:</div>

          <!-- 分钟列 -->
          <div class="flex-1 flex flex-col">
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="上一分钟" @click="clampMinute(minute - 1)"><Icon name="chevron-left" cls="w-3 h-3 rotate-90" /></button>
            <div class="relative overflow-hidden rounded-md border border-line my-0.5" :style="{ height: VISIBLE * ITEM_H + 'px' }">
              <div class="absolute left-0 right-0 bg-brand-soft pointer-events-none"
                :style="{ top: PAD * ITEM_H + 'px', height: ITEM_H + 'px' }"></div>
              <div class="will-change-transform"
                :class="smoothMinute ? 'transition-transform duration-150 ease-out' : ''"
                :style="{ transform: minuteY }"
                @wheel.prevent="(e) => { smoothMinute = false; clampMinute(minute + Math.sign(e.deltaY)) }">
                <button
                  v-for="(v, i) in minutesPadded" :key="'m'+i"
                  class="block w-full text-[11px] tabular-nums transition"
                  :class="isMinuteSelected(v) ? 'text-brand-text font-semibold' : 'text-t2 hover:text-t1'"
                  :style="{ height: ITEM_H + 'px', lineHeight: ITEM_H + 'px' }"
                  @click="clampMinute(v)"
                >{{ p2(v) }}</button>
              </div>
            </div>
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="下一分钟" @click="clampMinute(minute + 1)"><Icon name="chevron-left" cls="w-3 h-3 -rotate-90" /></button>
          </div>

          <div class="w-1.5 flex items-center justify-center text-t2 font-semibold">:</div>

          <!-- 秒列 -->
          <div class="flex-1 flex flex-col">
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="上一秒" @click="clampSecond(second - 1)"><Icon name="chevron-left" cls="w-3 h-3 rotate-90" /></button>
            <div class="relative overflow-hidden rounded-md border border-line my-0.5" :style="{ height: VISIBLE * ITEM_H + 'px' }">
              <div class="absolute left-0 right-0 bg-brand-soft pointer-events-none"
                :style="{ top: PAD * ITEM_H + 'px', height: ITEM_H + 'px' }"></div>
              <div class="will-change-transform"
                :class="smoothSecond ? 'transition-transform duration-150 ease-out' : ''"
                :style="{ transform: secondY }"
                @wheel.prevent="(e) => { smoothSecond = false; clampSecond(second + Math.sign(e.deltaY)) }">
                <button
                  v-for="(v, i) in secondsPadded" :key="'s'+i"
                  class="block w-full text-[11px] tabular-nums transition"
                  :class="isSecondSelected(v) ? 'text-brand-text font-semibold' : 'text-t2 hover:text-t1'"
                  :style="{ height: ITEM_H + 'px', lineHeight: ITEM_H + 'px' }"
                  @click="clampSecond(v)"
                >{{ p2(v) }}</button>
              </div>
            </div>
            <button class="h-6 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition"
              title="下一秒" @click="clampSecond(second + 1)"><Icon name="chevron-left" cls="w-3 h-3 -rotate-90" /></button>
          </div>
        </div>
      </div>

      <!-- 重复区 -->
      <div class="mt-2 border-t border-line pt-2">
        <div class="text-[10.5px] text-t3 mb-1 px-0.5">重 复</div>
        <div class="flex items-center gap-1 flex-wrap">
          <button
            v-for="opt in repeatOptions" :key="opt.key"
            class="h-6 px-2 rounded-full text-[11px] transition"
            :class="repeatMode === opt.key ? 'bg-brand text-white' : 'bg-chip text-t2 hover:bg-hover hover:text-t1'"
            @click="setRepeatMode(opt.key)"
          >{{ opt.label }}</button>
        </div>
        <!-- 工作日 / 每周 共用这一排星期，工作日默认勾一~五，可自行加「六」 -->
        <div
          v-if="repeatMode === 'workday' || repeatMode === 'weekly'"
          class="grid grid-cols-7 gap-1 mt-1.5"
        >
          <button
            v-for="d in weekdayOptions" :key="d.v"
            class="h-6 rounded-md text-[11px] transition"
            :class="activeDays.includes(d.v) ? 'bg-brand-soft text-brand-text' : 'text-t3 hover:bg-hover hover:text-t1'"
            @click="toggleDay(d.v)"
          >{{ d.label }}</button>
        </div>
      </div>

      <!-- 底部 -->
      <div class="mt-2 flex items-center justify-between border-t border-line pt-2">
        <span class="text-[10px] text-t3 tabular-nums truncate mr-2">{{ previewText }}</span>
        <div class="flex gap-1.5 shrink-0">
          <button class="h-6 px-2 text-[11px] rounded-md border border-line text-t2 hover:bg-hover transition"
            @click="emit('close')">取消</button>
          <button
            class="h-6 px-2 text-[11px] rounded-md bg-brand text-white font-semibold hover:bg-brand-hover transition"
            :class="canApply ? '' : 'opacity-50 cursor-not-allowed'"
            @click="apply">确定</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
