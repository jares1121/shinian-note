import { reactive } from 'vue'

// 全局轻量提示层：确认框 + 顶部/底部 toast（跟随窗口，不会像原生弹窗那样跑到屏幕中央）
export const overlay = reactive({ confirm: null, toast: null })

export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    overlay.confirm = {
      title: opts.title ?? '请确认',
      message,
      okText: opts.okText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      danger: !!opts.danger,
      resolve
    }
  })
}

export function resolveConfirm(ok) {
  const c = overlay.confirm
  overlay.confirm = null
  c?.resolve(ok)
}

let toastTimer = null
export function showToast(message) {
  overlay.toast = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    overlay.toast = null
  }, 2200)
}
