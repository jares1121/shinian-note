<script setup>
import { ref, computed, nextTick } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  tags: { type: Array, default: () => [] }
})
const emit = defineEmits(['change'])

const input = ref('')
const editing = ref(false)
const inputEl = ref(null)

const names = computed(() => props.tags.map((t) => t.name))

function startEdit() {
  editing.value = true
  nextTick(() => inputEl.value?.focus())
}

function commit() {
  const v = input.value.trim()
  if (v && !names.value.includes(v)) {
    emit('change', [...names.value, v])
  }
  input.value = ''
  editing.value = false
}

function remove(name) {
  emit(
    'change',
    names.value.filter((n) => n !== name)
  )
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    commit()
  } else if (e.key === 'Escape') {
    input.value = ''
    editing.value = false
  } else if (e.key === 'Backspace' && !input.value && names.value.length) {
    // 输入框为空时按退格，删掉最后一个标签
    remove(names.value[names.value.length - 1])
  }
}
</script>

<template>
  <div class="flex items-center gap-1.5 flex-wrap min-w-0">
    <span
      v-for="tag in tags"
      :key="tag.id"
      class="inline-flex items-center gap-1 pl-2 pr-0.5 py-0.5 text-[11.5px] rounded-full bg-brand-soft2 text-brand-text"
    >
      #{{ tag.name }}
      <button
        class="w-4 h-4 rounded-full flex items-center justify-center hover:bg-brand-soft hover:text-danger transition"
        title="移除标签"
        @click="remove(tag.name)"
      >
        <Icon name="x" cls="w-3 h-3" />
      </button>
    </span>
    <input
      v-if="editing"
      ref="inputEl"
      v-model="input"
      type="text"
      placeholder="标签名，回车确认"
      class="w-28 shrink-0 px-2 py-0.5 text-[11.5px] rounded-md bg-chip text-t1 outline-none select-text placeholder:text-t3 focus:ring-2 focus:ring-brand-line"
      @keydown="onKeydown"
      @blur="commit"
    />
    <button
      v-else
      class="shrink-0 px-2 py-0.5 text-[11.5px] rounded-full text-t3 hover:bg-hover hover:text-brand-text transition flex items-center gap-1"
      @click="startEdit"
    >
      <Icon name="plus" cls="w-3 h-3" />
      标签
    </button>
  </div>
</template>
