// 主题与主题色的读写（主窗、速记窗、提醒窗共用）

const MODE_KEY = 'shinian-theme' // light | dark | system
const ACCENT_KEY = 'shinian-accent' // green | amber | blue

const mq = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemeMode() {
  const m = localStorage.getItem(MODE_KEY)
  return m === 'light' || m === 'dark' ? m : 'system'
}

export function isDarkMode(mode = getThemeMode()) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return mq.matches
}

export function getAccent() {
  const a = localStorage.getItem(ACCENT_KEY)
  return a === 'amber' || a === 'blue' ? a : 'green'
}

// 应用到 <html>：深色类名 + 主题色 data 属性，返回当前是否深色
export function applyTheme(mode = getThemeMode()) {
  const dark = isDarkMode(mode)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.accent = getAccent()
  return dark
}

export function setThemeMode(mode) {
  localStorage.setItem(MODE_KEY, mode)
  return applyTheme(mode)
}

export function setAccent(accent) {
  localStorage.setItem(ACCENT_KEY, accent)
  applyTheme()
}

// 「跟随系统」时，系统深浅色变化要实时跟着换
export function onSystemThemeChange(cb) {
  const handler = () => {
    if (getThemeMode() === 'system') cb(applyTheme('system'))
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
