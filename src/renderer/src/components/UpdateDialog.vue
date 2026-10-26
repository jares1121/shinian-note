<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  // { version, url, assetUrl, assetName, assetSize }
  info: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const phase = ref('idle') // idle | downloading | done | error
const received = ref(0)
const total = ref(props.info.assetSize || 0)
const errMsg = ref('')

const percent = computed(() =>
  total.value ? Math.min(100, Math.round((received.value / total.value) * 100)) : 0
)
const mb = (n) => (n / 1048576).toFixed(1)

let unProgress = null

async function start() {
  phase.value = 'downloading'
  const res = await window.api.downloadUpdate(props.info)
  if (res?.ok) {
    phase.value = 'done'
    // 常规软件节奏：下载完成稍作停顿即静默安装并重启
    setTimeout(() => window.api.installUpdate(res.path), 1200)
  } else if (res?.reason === 'cancelled') {
    phase.value = 'idle'
  } else {
    errMsg.value = res?.reason === 'no-asset' ? '该版本未提供安装包' : res?.reason || '网络错误'
    phase.value = 'error'
  }
}

function cancel() {
  window.api.cancelUpdateDownload()
}

function goPage() {
  window.api.openExternal(props.info.url)
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape' && (phase.value === 'idle' || phase.value === 'error')) emit('close')
}

onMounted(() => {
  unProgress = window.api.onUpdateProgress((p) => {
    received.value = p.received
    if (p.total) total.value = p.total
  })
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  unProgress?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 dark:bg-black/50"
    @click.self="phase === 'idle' || phase === 'error' ? emit('close') : null"
  >
    <div class="w-[400px] rounded-2xl overflow-hidden bg-surface border border-line shadow-2xl select-none">
      <header class="h-14 pl-4 pr-3 flex items-center gap-2.5 border-b border-line">
        <span class="w-9 h-9 rounded-[10px] bg-brand-soft2 text-brand-text flex items-center justify-center shrink-0">
          <Icon name="download" cls="w-[18px] h-[18px]" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold tracking-wide leading-5">发现新版本</h2>
          <p class="mt-0.5 text-[10.5px] text-t3 leading-4">
            v{{ info.version }} · {{ info.assetUrl ? '下载完成后自动安装并重启' : '便携版请手动下载' }}
          </p>
        </div>
        <button
          v-if="phase !== 'downloading'"
          class="w-7 h-7 rounded-md flex items-center justify-center text-t3 hover:bg-hover hover:text-t1 transition shrink-0"
          title="关闭（Esc）"
          @click="emit('close')"
        >
          <Icon name="x" cls="w-4 h-4" />
        </button>
      </header>

      <div class="px-5 py-4">
        <!-- 待开始 -->
        <template v-if="phase === 'idle'">
          <p v-if="info.assetUrl" class="text-[12.5px] leading-6 text-t2">
            下载完成后将自动安装并重启应用，无需手动操作。安装包约
            <span class="tabular-nums font-medium text-t1">{{ info.assetSize ? mb(info.assetSize) : '?' }} MB</span>。
          </p>
          <p v-else class="text-[12.5px] leading-6 text-t2">
            当前为便携版，无法自动安装，请前往下载页获取新版本。
          </p>
        </template>

        <!-- 下载中 / 完成 -->
        <template v-else-if="phase === 'downloading' || phase === 'done'">
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-[12.5px] font-medium text-t1">
              {{ phase === 'done' ? '下载完成，即将自动安装…' : '正在下载新版本…' }}
            </span>
            <span class="text-[11px] text-t3 tabular-nums">{{ percent }}%</span>
          </div>
          <div class="h-2 rounded-full bg-chip overflow-hidden">
            <div
              class="h-full rounded-full bg-brand transition-[width] duration-200"
              :style="{ width: percent + '%' }"
            ></div>
          </div>
          <p class="mt-2 text-[10.5px] text-t3 tabular-nums">
            {{ mb(received) }} / {{ total ? mb(total) + ' MB' : '—' }}
          </p>
        </template>

        <!-- 失败 -->
        <template v-else-if="phase === 'error'">
          <p class="text-[12.5px] leading-6 text-t2">下载失败：{{ errMsg }}</p>
          <p class="text-[11px] text-t3 mt-1">可重试，或前往下载页手动获取。</p>
        </template>
      </div>

      <footer class="h-14 px-4 flex items-center justify-end gap-2 border-t border-line">
        <template v-if="phase === 'idle'">
          <button
            class="h-8 px-3.5 text-[12.5px] rounded-lg text-t2 hover:bg-hover transition"
            @click="info.assetUrl ? emit('close') : goPage()"
          >
            {{ info.assetUrl ? '暂不更新' : '关闭' }}
          </button>
          <button
            class="h-8 px-3.5 text-[12.5px] font-semibold rounded-lg text-white bg-brand hover:bg-brand-hover transition"
            @click="info.assetUrl ? start() : goPage()"
          >
            {{ info.assetUrl ? '下载并安装' : '前往下载页' }}
          </button>
        </template>
        <template v-else-if="phase === 'downloading'">
          <button
            class="h-8 px-3.5 text-[12.5px] rounded-lg text-t2 hover:bg-hover transition"
            @click="cancel"
          >
            取消下载
          </button>
        </template>
        <template v-else-if="phase === 'error'">
          <button
            class="h-8 px-3.5 text-[12.5px] rounded-lg text-t2 hover:bg-hover transition"
            @click="goPage"
          >
            前往下载页
          </button>
          <button
            class="h-8 px-3.5 text-[12.5px] font-semibold rounded-lg text-white bg-brand hover:bg-brand-hover transition"
            @click="start"
          >
            重试
          </button>
        </template>
      </footer>
    </div>
  </div>
</template>
