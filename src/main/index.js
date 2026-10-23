import {
	app,
	BrowserWindow,
	globalShortcut,
	dialog,
	ipcMain,
	screen,
	Menu,
	Tray,
	protocol,
	net,
	nativeImage
} from 'electron'
import { basename, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { initDB, notesRepo, nextRepeatTime } from './db.js'
import { registerIpc } from './ipc.js'

const isDev = !!process.env.ELECTRON_RENDERER_URL
const QUICK_SHORTCUT = 'CommandOrControl+Shift+N'

// 自定义协议：Markdown 预览通过 shinian-img:///文件名 加载 userData/images 里的本地图片
protocol.registerSchemesAsPrivileged([
	{ scheme: 'shinian-img', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

let mainWin = null
let quickWin = null
let floatWin = null
let floatDocked = false
let tray = null
let isQuitting = false

const iconPath = () => join(import.meta.dirname, '../../assets/icon.png')

/* ---------- 主窗口位置/大小记忆 ---------- */

const stateFile = () => join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
	try {
		return JSON.parse(readFileSync(stateFile(), 'utf8'))
	} catch {
		return {}
	}
}

let saveTimer = null
function scheduleSaveWindowState(win) {
	clearTimeout(saveTimer)
	saveTimer = setTimeout(() => {
		if (win.isDestroyed()) return
		writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds()))
	}, 500)
}

/* ---------- 窗口创建 ---------- */

function createMainWindow() {
	const state = loadWindowState()
	// 旧版本默认是 1000×640，若仍是这个尺寸视为未调整过，按新版三栏布局的默认尺寸打开
	const legacy = state.width === 1000 && state.height === 640
	mainWin = new BrowserWindow({
		width: legacy ? 1200 : (state.width ?? 1200),
		height: legacy ? 780 : (state.height ?? 780),
		x: state.x,
		y: state.y,
		minWidth: 900,
		minHeight: 560,
		title: '拾念',
		icon: nativeImage.createFromPath(iconPath()),
		titleBarStyle: 'hidden',
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/index.mjs'),
			contextIsolation: true,
			sandbox: false
		}
	})

	mainWin.on('resize', () => scheduleSaveWindowState(mainWin))
	mainWin.on('move', () => scheduleSaveWindowState(mainWin))
	// 点关闭按钮不退出，而是隐藏到托盘（托盘菜单里选「退出」才真正退出）
	mainWin.on('close', (e) => {
		if (!isQuitting) {
			e.preventDefault()
			mainWin.hide()
		}
	})
	mainWin.on('closed', () => {
		mainWin = null
	})

	if (isDev) {
		mainWin.loadURL(process.env.ELECTRON_RENDERER_URL)
	} else {
		mainWin.loadFile(join(import.meta.dirname, '../renderer/index.html'))
	}
}

function createQuickWindow() {
	quickWin = new BrowserWindow({
		width: 440,
		height: 260,
		frame: false,
		resizable: false,
		show: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/quick.mjs'),
			contextIsolation: true,
			sandbox: false
		}
	})

	quickWin.on('closed', () => {
		quickWin = null
	})

	if (isDev) {
		quickWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick.html`)
	} else {
		quickWin.loadFile(join(import.meta.dirname, '../renderer/quick.html'))
	}
}

// 快捷键：已打开则隐藏，未打开则置中显示并聚焦
function toggleQuickWindow() {
	if (quickWin && quickWin.isVisible()) {
		quickWin.hide()
		return
	}
	if (!quickWin) createQuickWindow()
	quickWin.center()
	quickWin.show()
	quickWin.focus()
}

/* ---------- 悬浮速记窗（极简悬浮，贴边隐藏）---------- */

const FLOAT_WIDTH = 420
const FLOAT_HEIGHT = 220
// 贴边后缩成一个小圆球（类似 360 加速球），只留这么一截露在屏幕右边
const FLOAT_BALL = 44
const FLOAT_BALL_PEEK = 40
// dock / undock 切换后要冷却多久才允许反向切换（毫秒）—— 防止闪烁
const FLOAT_DOCK_COOLDOWN = 800
// dock 判定：窗口右边缘距离屏幕右边缘 ≤ 40px 才算"真的靠到边上了"
const FLOAT_DOCK_THRESHOLD = 40
// undock 判定：鼠标靠近贴边露出的小球并持续 ≥ 120ms
const FLOAT_UNDOCK_MARGIN = 8
const FLOAT_UNDOCK_DEBOUNCE = 120

function floatConfigPath() { return join(app.getPath('userData'), 'float-config.json') }

function loadFloatConfig() {
	try {
		return JSON.parse(readFileSync(floatConfigPath(), 'utf8'))
	} catch {
		return { alwaysOnTop: true }
	}
}

function saveFloatConfig(cfg) {
	try { writeFileSync(floatConfigPath(), JSON.stringify(cfg, null, 2), 'utf8') } catch {}
}

let dockCooldownUntil = 0 // 切换冷却到期时间
let undockCandidateAt = 0 // 鼠标第一次进入屏幕边缘的时间戳

function createFloatWindow() {
	const cfg = loadFloatConfig()
	const primary = screen.getPrimaryDisplay().workAreaSize
	floatWin = new BrowserWindow({
		width: FLOAT_WIDTH,
		height: FLOAT_HEIGHT,
		x: primary.width - FLOAT_WIDTH - 40,
		y: primary.height - FLOAT_HEIGHT - 120,
		frame: false,
		resizable: false,
		show: false,
		alwaysOnTop: cfg.alwaysOnTop,
		skipTaskbar: true,
		transparent: true,
		backgroundColor: '#00000000',
		roundedCorners: true,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/float.mjs'),
			contextIsolation: true,
			sandbox: false
		}
	})

	floatWin.on('closed', () => {
		floatWin = null
		stopUndockPolling()
		floatDocked = false
	})

	if (isDev) {
		floatWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/float.html`)
	} else {
		floatWin.loadFile(join(import.meta.dirname, '../renderer/float.html'))
	}
}

// 贴边：把窗口缩成一个小圆球贴到屏幕右边，只露 FLOAT_BALL_PEEK 这么一截
function dockFloatWindow() {
	if (!floatWin || floatDocked || floatWin.isDestroyed()) return
	const bounds = floatWin.getBounds()
	// 已经是小球状态就不要反复收缩
	if (bounds.width <= FLOAT_BALL + 1) return
	const display = screen.getDisplayMatching(bounds)
	const rightEdge = display.bounds.x + display.bounds.width
	const area = display.workArea
	const y = clamp(
		Math.round(bounds.y + bounds.height / 2 - FLOAT_BALL / 2),
		area.y,
		area.y + area.height - FLOAT_BALL
	)
	floatWin.setBounds({
		x: rightEdge - FLOAT_BALL_PEEK,
		y,
		width: FLOAT_BALL,
		height: FLOAT_BALL
	})
	floatDocked = true
	dockCooldownUntil = Date.now() + FLOAT_DOCK_COOLDOWN
	undockCandidateAt = 0
	floatWin.webContents.send('float:dock-state', true)
	startUndockPolling()
}

function clamp(v, min, max) {
	return Math.min(Math.max(v, min), Math.max(min, max))
}

// 松手时才判断要不要贴边，避免拖动过程中路过右边缘就被吸走
function checkFloatDock() {
	if (!floatWin || floatDocked || floatWin.isDestroyed()) return
	if (Date.now() < dockCooldownUntil) return
	const bounds = floatWin.getBounds()
	const display = screen.getDisplayMatching(bounds)
	const rightEdge = display.bounds.x + display.bounds.width
	if (bounds.x + bounds.width >= rightEdge - FLOAT_DOCK_THRESHOLD) dockFloatWindow()
}

// 从小球恢复成完整窗口：以小球中心为准展开到右边
function undockFloatWindow() {
	if (!floatWin || !floatDocked || floatWin.isDestroyed()) return
	const bounds = floatWin.getBounds()
	const display = screen.getDisplayMatching(bounds)
	const rightEdge = display.bounds.x + display.bounds.width
	const area = display.workArea
	const y = clamp(
		Math.round(bounds.y + bounds.height / 2 - FLOAT_HEIGHT / 2),
		area.y,
		area.y + area.height - FLOAT_HEIGHT
	)
	// 滑出后整窗可见，和屏幕右边留 12px 空隙，避免右侧按钮被裁掉
	floatWin.setBounds({
		x: rightEdge - FLOAT_WIDTH - 12,
		y,
		width: FLOAT_WIDTH,
		height: FLOAT_HEIGHT
	})
	floatDocked = false
	dockCooldownUntil = Date.now() + FLOAT_DOCK_COOLDOWN
	undockCandidateAt = 0
	floatWin.webContents.send('float:dock-state', false)
	stopUndockPolling()
}

// renderer 主动点"贴边隐藏"按钮 → 强制 dock（不管当前位置）
function dockFloatNow() { dockFloatWindow() }

let undockTimer = null

// dock 后才启动，检测鼠标是否靠近贴边后露出的小球
function startUndockPolling() {
	stopUndockPolling()
	undockTimer = setInterval(() => {
		if (!floatWin || !floatDocked) { stopUndockPolling(); return }
		if (Date.now() < dockCooldownUntil) { undockCandidateAt = 0; return }

		const pt = screen.getCursorScreenPoint()
		const bounds = floatWin.getBounds()
		const display = screen.getDisplayMatching(bounds)
		const rightEdge = display.bounds.x + display.bounds.width

		// 鼠标靠近小球（含几像素容差）就算命中，贴着球滑过去就能展开
		const nearBall =
			pt.x >= rightEdge - FLOAT_BALL_PEEK - FLOAT_UNDOCK_MARGIN &&
			pt.y >= bounds.y - FLOAT_UNDOCK_MARGIN &&
			pt.y <= bounds.y + bounds.height + FLOAT_UNDOCK_MARGIN

		if (nearBall) {
			if (undockCandidateAt === 0) undockCandidateAt = Date.now()
			if (Date.now() - undockCandidateAt >= FLOAT_UNDOCK_DEBOUNCE) {
				undockFloatWindow()
			}
		} else {
			// 鼠标离开把手区域：清零，下次重新计时
			undockCandidateAt = 0
		}
	}, 60)
}

function stopUndockPolling() {
	if (undockTimer) { clearInterval(undockTimer); undockTimer = null }
}

function showFloatWindow() {
	if (mainWin) mainWin.hide()
	if (!floatWin) createFloatWindow()
	floatDocked = false
	floatWin.show()
	floatWin.focus()
}

function hideFloatWindow() {
	// 贴边成小球时先恢复完整尺寸，避免下次打开还是一个小球
	if (floatWin && floatDocked) undockFloatWindow()
	if (floatWin) floatWin.hide()
	floatDocked = false
	stopUndockPolling()
	dockCooldownUntil = 0
}

function registerShortcut() {
	const ok = globalShortcut.register(QUICK_SHORTCUT, toggleQuickWindow)
	if (!ok) {
		dialog.showErrorBox(
			'快捷键注册失败',
			'Ctrl+Shift+N 可能已被其他程序占用。请关闭冲突程序后重启拾念。'
		)
	}
}

/* ---------- 托盘 ---------- */

function showMainWindow() {
	hideFloatWindow()
	if (!mainWin) {
		createMainWindow()
		return
	}
	if (mainWin.isMinimized()) mainWin.restore()
	mainWin.show()
	mainWin.focus()
}

function createTray() {
	tray = new Tray(nativeImage.createFromPath(iconPath()))
	tray.setToolTip('拾念')
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: '显示主窗口', click: showMainWindow },
			{ label: '速记 (Ctrl+Shift+N)', click: toggleQuickWindow },
			{ type: 'separator' },
			{
				label: '退出拾念',
				click: () => {
					isQuitting = true
					app.quit()
				}
			}
		])
	)
	tray.on('click', showMainWindow)
}

/* ---------- 定时提醒 ---------- */

// 用自定义置顶弹窗替代系统通知：不自动关闭，必须手动确认，避免被忽略
let reminderWin = null
const pendingReminders = [] // 已到点、等待用户确认的笔记 { id, title, remindAt }

function createReminderWindow() {
	reminderWin = new BrowserWindow({
		width: 380,
		height: 360,
		frame: false,
		resizable: false,
		show: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		webPreferences: {
			preload: join(import.meta.dirname, '../preload/reminder.mjs'),
			contextIsolation: true,
			sandbox: false,
			autoplayPolicy: 'no-user-gesture-required' // 允许提示音直接播放
		}
	})
	reminderWin.on('closed', () => {
		reminderWin = null
	})
	if (isDev) {
		reminderWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/reminder.html`)
	} else {
		reminderWin.loadFile(join(import.meta.dirname, '../renderer/reminder.html'))
	}
}

function pushReminderList() {
	reminderWin?.webContents.send('reminder:update', pendingReminders)
}

// 屏幕右下角弹出并聚焦；页面若尚未加载完，渲染端挂载时会主动拉取列表
function showReminderWindow() {
	if (!reminderWin) createReminderWindow()
	const { workArea } = screen.getPrimaryDisplay()
	const [w, h] = reminderWin.getSize()
	reminderWin.setPosition(workArea.x + workArea.width - w - 16, workArea.y + workArea.height - h - 16)
	reminderWin.show()
	reminderWin.focus()
	pushReminderList()
}

function checkReminders() {
	const due = notesRepo.dueReminders(Date.now())
	if (due.length === 0) return
	let advanced = false
	for (const note of due) {
		// 重复提醒：不标成已提醒，直接把 remindAt 顺延到下一次
		const next = note.remindRepeat ? nextRepeatTime(note.remindAt, note.remindRepeat) : null
		if (next) {
			notesRepo.setReminder(note.id, next, note.remindRepeat)
			advanced = true
		} else {
			notesRepo.markReminded(note.id)
		}
		if (!pendingReminders.some((n) => n.id === note.id)) {
			pendingReminders.push({ id: note.id, title: note.title, remindAt: note.remindAt })
		}
	}
	// 下次提醒时间变了，通知各窗口刷新，避免编辑器里还显示过去的提醒时间
	if (advanced) {
		for (const win of BrowserWindow.getAllWindows()) win.webContents.send('notes:changed')
	}
	showReminderWindow()
}

/* ---------- 自绘窗口拖动 ---------- */
// 原生 -webkit-app-region: drag 的可拖动区域会吞掉所有指针事件，
// 没法给用户抓手光标，所以改成渲染端上报屏幕坐标位移、主进程移动窗口。

let winDrag = null

function registerWindowDragIpc() {
	ipcMain.on('win:drag-start', (e) => {
		const win = BrowserWindow.fromWebContents(e.sender)
		if (!win || win.isDestroyed()) return
		const [x, y] = win.getPosition()
		winDrag = { win, x, y }
	})

	ipcMain.on('win:drag-move', (e, dx, dy) => {
		if (!winDrag || winDrag.win.isDestroyed()) return
		if (winDrag.win.webContents !== e.sender) return
		winDrag.win.setPosition(Math.round(winDrag.x + dx), Math.round(winDrag.y + dy))
	})

	ipcMain.on('win:drag-end', (e) => {
		if (!winDrag || winDrag.win.webContents !== e.sender) return
		const win = winDrag.win
		const startX = winDrag.x
		const startY = winDrag.y
		winDrag = null
		if (win.isDestroyed()) return
		const [x, y] = win.getPosition()
		// 只是点了一下标题栏（没真的挪动）就不要触发贴边
		if (x === startX && y === startY) return
		if (win === floatWin) checkFloatDock()
	})
}

/* ---------- 主窗口控制 IPC ---------- */

function registerWindowIpc() {
	ipcMain.handle('win:minimize', () => mainWin?.minimize())
	ipcMain.handle('win:toggleMaximize', () => {
		if (!mainWin) return false
		if (mainWin.isMaximized()) mainWin.unmaximize()
		else mainWin.maximize()
		return mainWin.isMaximized()
	})
	ipcMain.handle('win:isMaximized', () => mainWin?.isMaximized() ?? false)
	ipcMain.handle('win:close', () => mainWin?.close())
	ipcMain.handle('win:fullscreen', (_e, enter) => {
		if (mainWin) mainWin.setFullScreen(enter)
	})

	// 悬浮窗：主窗口点击悬浮按钮时调用
	ipcMain.handle('float:toggle', () => {
		if (floatWin && floatWin.isVisible()) {
			hideFloatWindow()
			mainWin?.show()
			mainWin?.focus()
			return
		}
		showFloatWindow()
	})

	// 悬浮窗请求关闭并切回主窗口
	ipcMain.handle('float:close', () => {
		hideFloatWindow()
		mainWin?.show()
		mainWin?.focus()
	})

	// 悬浮窗内主动点「贴边隐藏」按钮
	ipcMain.handle('float:dock-now', () => dockFloatNow())

	// 点贴边后露出的小把手，直接把悬浮窗滑出来
	ipcMain.handle('float:undock-now', () => {
		if (floatDocked) undockFloatWindow()
	})

	// 设置面板改 alwaysOnTop：实时生效 + 持久化
	ipcMain.handle('float:set-top', (_e, alwaysOnTop) => {
		saveFloatConfig({ alwaysOnTop: !!alwaysOnTop })
		if (floatWin) floatWin.setAlwaysOnTop(!!alwaysOnTop)
	})
	ipcMain.handle('float:get-config', () => loadFloatConfig())
}

function registerReminderIpc() {
	ipcMain.handle('reminder:list', () => pendingReminders)

	// 点「打开笔记」：从列表移除并跳转主窗口；列表空了自动关窗
	ipcMain.handle('reminder:open', (_e, id) => {
		const i = pendingReminders.findIndex((n) => n.id === id)
		if (i !== -1) pendingReminders.splice(i, 1)
		showMainWindow()
		mainWin?.webContents.send('app:openNote', id)
		if (pendingReminders.length === 0) {
			reminderWin?.close()
		} else {
			pushReminderList()
		}
	})

	// 「全部知道了」/ ✕ / Esc：确认这一批提醒并关窗
	ipcMain.handle('reminder:dismissAll', () => {
		pendingReminders.length = 0
		reminderWin?.close()
	})
}

function startReminderLoop() {
	checkReminders() // 启动时补发错过（到点未弹）的提醒
	setInterval(checkReminders, 30000)
}

/* ---------- 应用生命周期 ---------- */

// SQLite 是单写者，避免双开实例争抢数据库文件
if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	app.on('second-instance', () => {
		showMainWindow()
	})

	app.whenReady().then(() => {
		app.setAppUserModelId('com.shinian.note') // 为后续系统通知做准备
		// 关键代码：将应用菜单设置为 null
		Menu.setApplicationMenu(null)
		protocol.handle('shinian-img', (request) => {
			// basename 防路径穿越，只允许读 images 目录内的文件
			const name = basename(decodeURIComponent(new URL(request.url).pathname))
			return net.fetch(pathToFileURL(join(app.getPath('userData'), 'images', name)).toString())
		})
		initDB()
		registerIpc()
		registerWindowDragIpc()
		registerWindowIpc()
		registerReminderIpc()
		createMainWindow()
		createTray()
		registerShortcut()
		startReminderLoop()

		app.on('activate', () => {
			showMainWindow()
		})
	})

	app.on('before-quit', () => {
		isQuitting = true
		stopUndockPolling()
		if (floatWin) floatWin.close()
	})

	app.on('will-quit', () => {
		globalShortcut.unregisterAll()
	})
}
