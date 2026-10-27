// CloudBase 客户端封装
// 只负责：登录、注册、登出、登录态检查、调云函数
// 业务层（同步笔记等）通过 callFunction 调用云函数实现

import cloudbase from '@cloudbase/js-sdk'

const ENV_ID = 'clear-cat-d9gspzahc8648a472'

let app = null
let auth = null

// 初始化 CloudBase SDK（只调一次）
export function initCloud() {
  if (app) return app
  app = cloudbase.init({ env: ENV_ID })
  auth = app.auth({ mode: 'USERNAME' })
  return app
}

export function getAuth() {
  if (!app) initCloud()
  return auth
}

export function getApp() {
  if (!app) initCloud()
  return app
}

// 检查本地是否有登录态（同步，返回 LoginState | null）
export function hasLogin() {
  try {
    initCloud()
    return auth.hasLoginState()
  } catch {
    return null
  }
}

// SDK 的写操作失败时不抛异常，而是返回 { data, error }，必须显式检查
function pickError(res) {
  if (!res) return null
  return res.error ?? null
}

// 登录：必须用 signInWithPassword 走「用户名密码登录」通道
// 注意 signUp/signIn 走的是验证码通道，与用户名密码不是同一套，会静默失败
// account 可以是用户名或邮箱（服务端都认）
export async function signIn(account, password) {
  try {
    initCloud()
    const res = await auth.signInWithPassword({ username: account, password })
    const err = pickError(res)
    const user = res?.data?.user
    if (err || !user) {
      console.error('[cloud] signIn failed', res)
      // 凭据错误时 SDK 不返回 error 对象，只能靠 user 为空判定
      return { ok: false, message: err ? extractError(err) : '账号或密码不正确' }
    }
    return { ok: true, user }
  } catch (e) {
    console.error('[cloud] signIn threw', e)
    return { ok: false, message: extractError(e) }
  }
}

// 注册第一步：向邮箱发验证码
// 返回 { ok: true, verificationId } —— verificationId 要交给 signUpWithEmail 用
export async function sendEmailCode(email) {
  try {
    initCloud()
    const res = await auth.getVerification({ email })
    // getVerification 直接返回 { verification_id }，不走 {data,error} 包装
    const vid = res?.verification_id ?? res?.data?.verification_id
    if (!vid) {
      console.error('[cloud] getVerification no id', res)
      return { ok: false, message: '验证码发送失败，请稍后重试' }
    }
    return { ok: true, verificationId: vid }
  } catch (e) {
    console.error('[cloud] getVerification threw', e)
    return { ok: false, message: extractError(e) }
  }
}

// 注册第二步：验码 → 建号 → 自动登录
export async function signUpWithEmail({ email, password, code, verificationId }) {
  try {
    initCloud()
    // 1. 验码换 token（错码会抛异常）
    const v = await auth.verify({
      verification_id: verificationId,
      verification_code: code
    })
    const token = v?.verification_token ?? v?.data?.verification_token
    if (!token) {
      console.error('[cloud] verify no token', v)
      return { ok: false, message: '验证失败，请重新获取验证码' }
    }
    // 2. 带 token 建号（返回 {data,error} 包装）
    const r = await auth.signUp({
      email,
      password,
      verification_code: code,
      verification_token: token
    })
    const err = pickError(r)
    if (err) {
      console.error('[cloud] signUp failed', err)
      return { ok: false, message: extractError(err) }
    }
    // 3. 注册成功，直接登录
    return await signIn(email, password)
  } catch (e) {
    console.error('[cloud] signUpWithEmail threw', e)
    return { ok: false, message: extractError(e) }
  }
}

// 登出
export async function signOut() {
  try {
    initCloud()
    await auth.signOut()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: extractError(e) }
  }
}

// 获取当前用户信息（可能是同步读取本地缓存）
export function getCurrentUser() {
  try {
    initCloud()
    const state = auth.hasLoginState()
    if (!state) return null
    return state.user ?? null
  } catch {
    return null
  }
}

// 调云函数：统一入口
// action: 'test' | 'list' | 'upsert' | 'remove' ...
// payload: 任意 JSON 数据
export async function callFunction(action, payload) {
  try {
    initCloud()
    const res = await app.callFunction({
      name: 'sync-notes',
      data: { action, payload }
    })
    // CloudBase 返回格式：{ result: {...} }
    let result = res?.result ?? res
    // 某些情况下 result 是 JSON 字符串，统一转成对象再交给上层
    if (typeof result === 'string') {
      try {
        result = JSON.parse(result)
      } catch {
        /* 不是 JSON 就原样返回 */
      }
    }
    return { ok: true, data: result }
  } catch (e) {
    return { ok: false, message: extractError(e) }
  }
}

// 把 CloudBase SDK 的错误对象提取成可读消息
// 注意：不要用正则去「清洗」message，会把真实原因吃掉
function extractError(e) {
  if (!e) return '未知错误'
  if (typeof e === 'string') return translate(e)

  const raw = e.message || e.error_description || e.error_message || e.errMsg || e.helpMessage || ''
  if (!raw) return e.code ? translate(String(e.code)) : '未知错误'
  return translate(raw)
}

// 常见错误翻译成用户能看懂的话
const ERROR_TEXT = [
  [/provider email not found/i, '服务端还没开通「邮箱登录」方式，请在控制台开启后重试'],
  [/provider .* not found/i, '服务端还没开通该登录方式'],
  [/invalid_argument.*username or verification_token/i, '缺少用户名参数'],
  [/凭据验证失败|credential.*fail/i, '账号或密码不正确'],
  [/username or password (incorrect|not match)/i, '账号或密码不正确'],
  [/invalid_username_or_password/i, '账号或密码不正确'],
  [/无效的验证码|verification code does not match|invalid.*(verification|otp)|wrong.*code/i, '验证码不正确或已过期'],
  [/verification.*expired|验证码.*过期/i, '验证码已过期，请重新发送'],
  [/missing required param 'email\|phone'/i, '账号缺少邮箱或手机号，无法注册'],
  [/missing_required_param/i, '提交的信息不完整'],
  [/user not found/i, '账号不存在'],
  [/invalid password|password is incorrect|wrong password/i, '密码不正确'],
  [/already (exist|registered|in use)|duplicate/i, '该邮箱已注册，请直接登录'],
  [/invalid_?email/i, '邮箱格式不正确'],
  [/send.*(limit|frequency)|too (many|frequent)|发送.*频繁/i, '发送太频繁了，请稍后再试'],
  [/network|timeout|ECONN|fetch failed|Failed to fetch/i, '网络连接失败，请检查网络后重试']
]

function translate(msg) {
  // 服务端 Go 报错常带 %!(EXTRA ...) 乱码尾巴，去掉
  let text = String(msg).replace(/%!\(EXTRA[^)]*\)?/g, '').trim()
  for (const [re, friendly] of ERROR_TEXT) {
    if (re.test(text)) return friendly
  }
  // 没匹配到时原样返回，方便排查
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}
