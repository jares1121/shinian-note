# 拾念 · 随时记录

一款基于 Electron + Vue3 + SQLite 的本地桌面笔记应用。

轻量、离线、隐私优先，专注把「随手记」做得顺手。

## 截图

> 界面预览：`design-preview.html`（浏览器直接打开即可）

## 功能特性

### 笔记管理
- 新建 / 编辑 / 删除笔记，自动保存（400ms 防抖）
- Markdown 编辑与预览切换
- 标签分类，支持批量加标签 / 批量删除
- 全文搜索（标题 + 正文，支持清空）

### 时间与提醒
- 按天分组（今天 / 昨天 / 具体日期）
- 时间筛选：今天 / 本周 / 本月 / 自定义日期范围（自绘日历）
- 定时提醒：到点右下角弹窗提示，支持多条合并、跳转对应笔记

### 速记
- 全局快捷键 `Ctrl + Shift + N` 唤起速记窗
- `Ctrl + Enter` 保存、`Esc` 隐藏，随时记录灵感

### 统计
- 总笔记数 / 今日 / 本月
- 近 12 个月趋势图、当年日历热力图
- 按标签 TOP 统计、连续记录天数（streak）

### 主题与外观
- 浅色 / 深色 / 跟随系统三种主题
- 微信绿 / 琥珀黄 / 蓝色三套主题色
- 三栏布局，分栏线可拖动调整宽度并记忆

### 数据安全
- 本地 SQLite（WAL 模式）存储，数据完全离线
- 一键备份 / 恢复整个数据库
- 导出全部笔记为 Markdown 文件夹
- 图片粘贴保存（本地 `userData/images`，自定义协议预览）

### 系统集成
- 系统托盘常驻、关闭到托盘
- 窗口位置 / 大小记忆
- 单实例锁

## 技术栈

- **壳**：Electron 31
- **构建**：electron-vite 2
- **前端**：Vue 3 (`<script setup>`) + Vite 5
- **样式**：Tailwind CSS 4
- **数据库**：better-sqlite3（原生模块，WAL 模式）
- **图表**：ECharts 6
- **Markdown**：marked
- **打包**：electron-builder 25（NSIS + Portable）
- **进程安全**：`contextIsolation` + preload 白名单 IPC

## 快速开始

环境要求：Node.js 18+（建议 20+）、pnpm（推荐）或 npm。

```bash
# 安装依赖
pnpm install

# 启动开发模式（带热更新）
pnpm dev

# 构建产物
pnpm build

# 打包 Windows 安装包 + 免安装便携版（输出到 release/）
pnpm dist

# 只打包免安装便携版
pnpm dist:portable

# 只解包目录（调试用）
pnpm dist:dir
```

国内用户打包前建议先设镜像，避免下载 Electron / NSIS 超时：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

如果 `better-sqlite3` 在 Electron 里加载失败，重新编译原生模块：

```bash
pnpm rebuild
```

## 数据位置

- 数据库：`%APPDATA%\拾念\shinian.db`
- 图片：`%APPDATA%\拾念\images\`
- 窗口状态：`%APPDATA%\拾念\window-state.json`

卸载应用不会删除以上数据，可手动清理。

## 目录结构

```
shinian-note/
├── assets/                  # 应用图标
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── index.js         # 入口：窗口/托盘/快捷键/协议
│   │   ├── db.js            # SQLite 数据层
│   │   └── ipc.js           # IPC 白名单
│   ├── preload/             # preload 桥接（contextBridge）
│   └── renderer/            # Vue 渲染层
│       ├── index.html       # 主窗口
│       ├── quick.html       # 速记窗
│       ├── reminder.html    # 提醒窗
│       └── src/
│           ├── App.vue      # 主界面（三栏布局）
│           ├── components/  # NoteList / NoteEditor / StatsView 等
│           ├── theme.js     # 主题切换
│           └── ui.js        # 应用内弹层 / Toast
├── electron-builder.yml     # 打包配置
└── electron.vite.config.js  # 构建配置
```

## 设计理念

- **本地优先**：不依赖任何云端服务，数据始终在你手上
- **层级清晰**：高频操作（新建、搜索）放一级界面，低频（导出、备份、恢复）收进设置面板
- **克制的配色**：默认微信绿，仅在关键操作节点使用主色，避免大面积铺色
- **应用内反馈**：所有确认、提示均为应用内弹层，跟随窗口，不使用系统原生弹窗

## 许可证

MIT
