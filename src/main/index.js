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
import { initDB, notesRepo } from './db.js'
import { registerIpc } from './ipc.js'

const isDev = !!process.env.ELECTRON_RENDERER_URL
const QUICK_SHORTCUT = 'CommandOrControl+Shift+N'

// 自定义协议：Markdown 预览通过 shinian-img:///文件名 加载 userData/images 里的本地图片
protocol.registerSchemesAsPrivileged([
	{ scheme: 'shinian-img', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

let mainWin = null
let quickWin = null
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
	for (const note of due) {
		notesRepo.markReminded(note.id)
		if (!pendingReminders.some((n) => n.id === note.id)) {
			pendingReminders.push({ id: note.id, title: note.title, remindAt: note.remindAt })
		}
	}
	showReminderWindow()
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
	})

	app.on('will-quit', () => {
		globalShortcut.unregisterAll()
	})
}
