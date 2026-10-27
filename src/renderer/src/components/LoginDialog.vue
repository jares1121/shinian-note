<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { signIn, sendEmailCode, signUpWithEmail } from '../cloud'

const emit = defineEmits(['close', 'success'])

// 'login' | 'signup'
const mode = ref('login')
const account = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const showPwd = ref(false)
const loading = ref(false)
const sending = ref(false)
const countdown = ref(0)
const errorMsg = ref('')

// 发码成功后服务端给的 verification_id，注册时要带回去
let verificationId = ''

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function switchMode() {
  mode.value = mode.value === 'login' ? 'signup' : 'login'
  errorMsg.value = ''
}

async function onSendCode() {
  errorMsg.value = ''
  const email = account.value.trim()
  if (!EMAIL_RE.test(email)) { errorMsg.value = '请输入正确的邮箱地址'; return }

  sending.value = true
  const res = await sendEmailCode(email)
  sending.value = false

  if (!res.ok) { errorMsg.value = res.message; return }
  verificationId = res.verificationId
  countdown.value = 60
  const timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearInterval(timer)
  }, 1000)
}

async function onSubmit() {
  errorMsg.value = ''
  const acc = account.value.trim()
  const p = password.value

  if (mode.value === 'login') {
    if (!acc) { errorMsg.value = '请输入邮箱或用户名'; return }
    if (!p) { errorMsg.value = '请输入密码'; return }

    loading.value = true
    const result = await signIn(acc, p)
    loading.value = false
    finish(result, '登录失败，请重试')
    return
  }

  // ---- 注册 ----
  if (!EMAIL_RE.test(acc)) { errorMsg.value = '请输入正确的邮箱地址'; return }
  if (!p || p.length < 6) { errorMsg.value = '密码至少 6 位'; return }
  if (p !== confirmPassword.value) { errorMsg.value = '两次输入的密码不一致'; return }
  if (!code.value.trim()) { errorMsg.value = '请输入邮箱收到的验证码'; return }
  if (!verificationId) { errorMsg.value = '请先点击「发送验证码」'; return }

  loading.value = true
  const result = await signUpWithEmail({
    email: acc,
    password: p,
    code: code.value.trim(),
    verificationId
  })
  loading.value = false
  finish(result, '注册失败，请重试')
}

function finish(result, fallback) {
  if (result.ok) {
    emit('success', result.user)
    emit('close')
  } else {
    errorMsg.value = result.message || fallback
  }
}

function onKeydown(e) {
  if (loading.value || sending.value) return
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'Enter') onSubmit()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/50"
    @click.self="emit('close')"
  >
    <div class="w-[380px] rounded-2xl overflow-hidden bg-surface border border-line shadow-2xl select-none">
      <!-- 头部 -->
      <header class="px-6 pt-6 pb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-[10px] bg-gradient-to-br from-brand to-brand-hover text-white flex items-center justify-center text-base font-bold shadow-sm">
            拾
          </div>
          <div>
            <h2 class="text-[15px] font-semibold tracking-wide">
              {{ mode === 'login' ? '登录拾念云' : '注册拾念云' }}
            </h2>
            <p class="text-[11.5px] text-t3">
              登录后可在多台 Windows 电脑间同步笔记
            </p>
          </div>
        </div>
      </header>

      <!-- 表单 -->
      <div class="px-6 pb-5 space-y-3">
        <!-- 邮箱 / 账号 -->
        <div>
          <label class="block text-[11.5px] text-t2 mb-1">
            {{ mode === 'login' ? '邮箱或用户名' : '邮箱' }}
          </label>
          <input
            v-model="account"
            type="text"
            :placeholder="mode === 'login' ? '邮箱或用户名' : '用来接收验证码的邮箱'"
            :autocomplete="mode === 'login' ? 'username' : 'email'"
            class="w-full h-[38px] px-3 text-[13px] rounded-[9px] border border-line bg-surface text-t1 outline-none placeholder:text-t3 focus:border-brand-line focus:ring-2 focus:ring-brand-line transition select-text"
            :disabled="loading"
          />
        </div>

        <!-- 密码 -->
        <div>
          <label class="block text-[11.5px] text-t2 mb-1">密码</label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              placeholder="至少 6 位"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              class="w-full h-[38px] pl-3 pr-9 text-[13px] rounded-[9px] border border-line bg-surface text-t1 outline-none placeholder:text-t3 focus:border-brand-line focus:ring-2 focus:ring-brand-line transition select-text"
              :disabled="loading"
            />
            <button
              v-if="password"
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-t3 hover:text-t1 hover:bg-hover transition"
              :title="showPwd ? '隐藏密码' : '显示密码'"
              @click="showPwd = !showPwd"
            >
              <Icon :name="showPwd ? 'eye-off' : 'eye'" cls="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- 确认密码（注册） -->
        <div v-if="mode === 'signup'">
          <label class="block text-[11.5px] text-t2 mb-1">确认密码</label>
          <input
            v-model="confirmPassword"
            type="password"
            placeholder="再输一遍密码"
            autocomplete="new-password"
            class="w-full h-[38px] px-3 text-[13px] rounded-[9px] border border-line bg-surface text-t1 outline-none placeholder:text-t3 focus:border-brand-line focus:ring-2 focus:ring-brand-line transition select-text"
            :disabled="loading"
          />
        </div>

        <!-- 验证码（注册） -->
        <div v-if="mode === 'signup'">
          <label class="block text-[11.5px] text-t2 mb-1">邮箱验证码</label>
          <div class="flex gap-2">
            <input
              v-model="code"
              type="text"
              placeholder="邮件里的 6 位数字"
              maxlength="8"
              autocomplete="one-time-code"
              class="flex-1 h-[38px] px-3 text-[13px] rounded-[9px] border border-line bg-surface text-t1 outline-none placeholder:text-t3 focus:border-brand-line focus:ring-2 focus:ring-brand-line transition select-text"
              :disabled="loading"
            />
            <button
              type="button"
              class="h-[38px] px-3.5 rounded-[9px] border border-line text-[12px] text-t2 hover:bg-hover hover:text-t1 disabled:opacity-50 disabled:cursor-not-allowed transition shrink-0"
              :disabled="sending || countdown > 0 || loading"
              @click="onSendCode"
            >
              {{ countdown > 0 ? `${countdown}s 后重发` : (sending ? '发送中…' : '发送验证码') }}
            </button>
          </div>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="errorMsg"
          class="px-3 py-2 rounded-lg bg-[#e5484d]/10 text-[12px] text-[#e5484d] border border-[#e5484d]/20"
        >
          {{ errorMsg }}
        </div>

        <!-- 主按钮 -->
        <button
          class="w-full h-[40px] mt-1 rounded-[9px] bg-brand text-white text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-brand-hover active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
          :disabled="loading || sending"
          @click="onSubmit"
        >
          <svg
            v-if="loading"
            class="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="9" opacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" />
          </svg>
          {{ loading ? '处理中…' : (mode === 'login' ? '登录' : '注册并登录') }}
        </button>

        <!-- 切换模式 -->
        <div class="text-center pt-1">
          <button
            class="text-[12px] text-t2 hover:text-brand-text transition cursor-pointer"
            :disabled="loading"
            @click="switchMode"
          >
            {{ mode === 'login' ? '没有账号？用邮箱注册' : '已有账号？去登录' }}
          </button>
        </div>
      </div>

      <!-- 底部 -->
      <footer class="px-6 py-3 border-t border-line bg-rail/50 flex justify-end">
        <button
          class="h-8 px-3.5 text-xs rounded-lg border border-line text-t2 hover:bg-hover transition"
          :disabled="loading"
          @click="emit('close')"
        >
          取消
        </button>
      </footer>
    </div>
  </div>
</template>
