// 自绘窗口拖动
// 原生 -webkit-app-region: drag 的区域会吞掉全部指针事件，连光标样式都设不了，
// 所以这里自己接管 pointerdown，把屏幕坐标位移交给主进程移动窗口。
export function startWindowDrag(api, e, { onEnd } = {}) {
  if (!api || e.button !== 0) return
  // 标题栏里的按钮、输入框保持原有行为
  if (e.target.closest('button, a, input, textarea, select, [data-no-drag]')) return

  const el = e.currentTarget
  const startX = e.screenX
  const startY = e.screenY
  let lastX = startX
  let lastY = startY
  let frame = 0
  let moved = false

  try {
    el.setPointerCapture?.(e.pointerId)
  } catch {}

  api.dragStart()

  const flush = () => {
    frame = 0
    api.dragMove(lastX - startX, lastY - startY)
  }

  const onMove = (ev) => {
    lastX = ev.screenX
    lastY = ev.screenY
    if (!moved && Math.abs(lastX - startX) + Math.abs(lastY - startY) > 2) moved = true
    // 用 rAF 合并高频 pointermove，避免每帧发多次 IPC
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const finish = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
      if (moved) api.dragMove(lastX - startX, lastY - startY)
    }
    api.dragEnd()
    if (moved) onEnd?.()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('blur', finish)
}
