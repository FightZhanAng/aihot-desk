import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  screen,
  shell
} from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeFeedOptions, type FeedOptions } from '../shared/feed'
import { CATEGORY_ORDER, formatClock } from '../shared/format'
import { makeSaved } from '../shared/saved'
import type {
  AppInfo,
  FeedMode,
  Loaded,
  ReportKind,
  SavedEntry,
  Settings,
  Snapshot,
  UpdateState,
  WindowBounds
} from '../shared/types'
import { AihotClient } from './aihot'
import { ChangelogFeed } from './changelog'
import { LeaderboardFeed } from './leaderboard'
import { appIconPath, hardenWindow, loadRenderer, preloadPath, trayIconPath } from './paths'
import { parseSavedInput, SavedStore } from './saved'
import { DEFAULT_SETTINGS, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SettingsStore } from './settings'
import { TrayController, type TrayState } from './tray'
import { UpdateController } from './updater'

/* ------------------------------------------------------------ 常量 */

const APP_ID = app.isPackaged ? 'com.tomcato.aihot-desk' : 'com.tomcato.aihot-desk.dev'
const SITE = 'https://aihot.news'

/**
 * 发布页 —— 「打开发布页」与更新检查失败时的兜底都指这里。
 * 它必须和 electron-builder.yml 的 publish.owner/repo 指向同一个仓库，
 * 否则应用内检查更新与手动下载会走两个地方。
 */
const RELEASE_PAGE = 'https://github.com/FightZhanAng/aihot-desk/releases'

/**
 * 自绘标题栏：窗口 chrome 由应用自己画，系统只保留三键。
 * 高度必须和 styles.css 里的 --titlebar-h 逐像素一致，
 * 对不上会出现「按钮浮在标题栏上半截」的错位。
 */
const TITLEBAR_HEIGHT = 42

/** 两套主题下的窗口底色 —— 必须和 tokens.css 的 --bg 逐字一致，否则首帧会闪一下白 */
const WINDOW_BG = { light: '#eef0f3', dark: '#0a0e14' }
/** 系统三键的符号色，同样对齐 --ink-1 */
const WINDOW_SYMBOL = { light: '#14181d', dark: '#e7ecf3' }

/** 主窗口的默认尺寸（没有记忆值时） */
const DEFAULT_BOUNDS = { width: 1120, height: 780 }

/*
 * 报告归档拉多少期。
 *
 * 这个数不只是"往期栏铺几行"——**期号是从这个列表里数出来的**
 * （见 shared/report.ts 的 issueNumber）。列表被截断，期号就会偏小：
 * 早先周报只拉 12 期，刊头上印出来的是「第 12 期 / 全年 12 期」，
 * 而站上是「第 22 期 / 全年 22 期」—— 数错了，界面上完全看不出来。
 *
 * 所以三档都往大了取：
 *   日报 —— 100 期。日报接口的上限比报告高（实测能回到 2026-07-02），
 *          而且左侧往期栏要按月折叠，30 期连一个整月都铺不满
 *   周报 —— 60 期（接口上限），当前 22 期
 *   月报 —— 60 期（接口上限），当前 5 期
 * 报告的 limit 上限是 60，超了直接 400。
 */
const REPORT_LIMIT: Record<ReportKind, number> = { daily: 100, weekly: 60, monthly: 60 }

/** 渲染层递过来的报告类型必须过白名单 —— 它会直接拼进请求路径 */
function parseReportKind(value: unknown): ReportKind | null {
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : null
}

/* ------------------------------------------------------------ 冒烟自检 */

// 结论写磁盘而不是 console.log —— Windows 上 GUI 进程不挂控制台，
// 只靠 stdout 经常什么都看不到，"跑没跑起来"都判断不了。
const SMOKE = process.env['AIHOT_DESK_SMOKE'] === '1'
const SMOKE_EXIT = process.env['AIHOT_DESK_SMOKE_EXIT'] === '1'

function smokeDir(): string {
  return join(tmpdir(), 'aihot-desk-smoke')
}

function smoke(name: string, payload: unknown): void {
  if (!SMOKE) return
  try {
    mkdirSync(smokeDir(), { recursive: true })
    writeFileSync(join(smokeDir(), `${name}.json`), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    /* 自检失败不该影响主流程 */
  }
}

// 模块最顶层就落一个探针：只有它出现、后续报告缺失，
// 说明是 requestSingleInstanceLock 之后没走通，而不是代码没加载。
smoke('boot', {
  at: Date.now(),
  pid: process.pid,
  electron: process.versions.electron,
  node: process.versions.node
})

/* ------------------------------------------------------------ 状态 */

let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null
let settingsStore: SettingsStore | null = null
let savedStore: SavedStore | null = null
let client: AihotClient | null = null
let changelogFeed: ChangelogFeed | null = null
let leaderboardFeed: LeaderboardFeed | null = null
let updater: UpdateController | null = null
let snapshot: Snapshot | null = null
/** 上一轮热榜（通知要跟它比"谁是新来的"） */
let prevHotIds: Set<string> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshing: Promise<Snapshot> | null = null
/** 刷新进行中又来了新参数时记在这里，等这一趟结束补跑 */
let pendingFeed: FeedOptions | null = null
let isQuitting = false
/** 通知对象要留引用，被 GC 掉点击回调就不再触发 */
let activeNotification: Notification | null = null

/* ------------------------------------------------------------ 主题 */

function currentBg(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light
}

function applyTheme(mode: Settings['theme']): void {
  nativeTheme.themeSource = mode
}

/**
 * 系统主题或用户选择变化时，把自绘标题栏的配色也换掉 ——
 * titleBarOverlay 是原生控件，不跟 CSS 走，漏了这步深色下三键会是浅色的。
 */
function syncTitleBarOverlay(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const dark = nativeTheme.shouldUseDarkColors
  try {
    mainWindow.setTitleBarOverlay({
      color: currentBg(),
      symbolColor: dark ? WINDOW_SYMBOL.dark : WINDOW_SYMBOL.light,
      height: TITLEBAR_HEIGHT
    })
  } catch {
    /* 某些平台不支持 overlay，忽略 */
  }
  mainWindow.setBackgroundColor(currentBg())
}

/* ------------------------------------------------------------ 数据刷新 */

function pushSnapshot(next: Snapshot): void {
  snapshot = next

  // 新热点通知：只在用户开了开关、且确有新条目进入前 3 时才响
  const settings = settingsStore?.settings
  if (settings?.notifyOnHot && prevHotIds) {
    const fresh = next.hot.items.filter((t) => t.rank <= 3 && !prevHotIds?.has(t.id))
    if (fresh.length > 0) notifyHot(fresh)
  }
  prevHotIds = new Set(next.hot.items.map((t) => t.id))

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snapshot', next)
  }
  tray?.applyState(trayState())
}

function notifyHot(topics: { title: string }[]): void {
  const first = topics[0]
  if (!first) return
  try {
    const n = new Notification({
      title: topics.length > 1 ? `热榜有 ${topics.length} 条新热点` : '热榜有新热点',
      body: first.title,
      icon: appIconPath()
    })
    n.on('click', () => showPanel())
    // 引用要留住（否则被 GC 后 click 不再触发），但关掉就该放开
    n.on('close', () => {
      if (activeNotification === n) activeNotification = null
    })
    activeNotification = n
    n.show()
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/**
 * 最近一次**已经请求出去**的取数参数 —— resolveFeed 的兜底基准。
 *
 * 兜底为什么不能用 snapshot：snapshot 要等这一趟取数回来才更新。在它更新之前
 * 拿它当基准，同一批调用里第二次点的那一下就会把第一次的参数吃掉 ——
 * 先点分类、再点模式时，第二次算出来的 category 还是旧的，补跑时分类被切回去，
 * 界面高亮着新分类、列表却是旧分类的内容，而且此后每一轮自动刷新都沿用这个错值。
 */
let currentFeed: FeedOptions = { category: null, mode: 'selected' }

/** 这一趟取数用什么参数：没显式给的就沿用最近一次请求过的那一份（合并规则见 shared/feed.ts） */
function resolveFeed(patch?: Partial<FeedOptions>): FeedOptions {
  // 基准取"最后一次请求过的参数"：有排队的补跑时以它为准，否则以当前值
  return mergeFeedOptions(pendingFeed ?? currentFeed, patch)
}

function sameFeed(a: FeedOptions, b: FeedOptions): boolean {
  return a.category === b.category && a.mode === b.mode
}

/**
 * 并发闸门：同一时刻只跑一趟，避免重复打服务端。
 *
 * 但参数不同的调用不会被无声吞掉 —— 它会排在当前这趟后面补跑一次。
 * 否则用户在上一趟还没回来时切换分类或模式，第二次点击就没反应了。
 */
function refresh(patch?: Partial<FeedOptions>): Promise<Snapshot> {
  const target = resolveFeed(patch)
  // 先记成"当前参数"，后面几次调用的缺省字段都以它为准（不能等 snapshot 回来）
  currentFeed = target
  if (refreshing) {
    pendingFeed = target
    return refreshing
  }
  refreshing = (async () => {
    try {
      const next = await (client as AihotClient).refresh(target)
      pushSnapshot(next)
      return next
    } finally {
      refreshing = null
      const follow = pendingFeed
      pendingFeed = null
      if (follow && !sameFeed(follow, target)) void refresh(follow)
    }
  })()
  return refreshing
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  const minutes = settingsStore?.settings.refreshMinutes ?? 0
  if (minutes <= 0) return
  refreshTimer = setTimeout(() => {
    void refresh().finally(() => scheduleRefresh())
  }, minutes * 60_000)
}

/* ------------------------------------------------------------ 窗口 */

/** 恢复前校验：位置得落在某块显示器里，否则拔掉外接屏后会恢复到看不见的地方 */
function usableBounds(saved: Settings['windowBounds']): WindowBounds | null {
  if (!saved) return null
  const { x, y, width, height } = saved
  const visible = screen.getAllDisplays().some(
    (d) =>
      x + width > d.workArea.x + 40 &&
      x < d.workArea.x + d.workArea.width - 40 &&
      y + height > d.workArea.y + 20 &&
      y < d.workArea.y + d.workArea.height - 20
  )
  return visible ? { x, y, width, height } : null
}

function createMainWindow(): BrowserWindow {
  const saved = settingsStore?.settings.windowBounds ?? null
  const bounds = usableBounds(saved)

  const win = new BrowserWindow({
    width: bounds?.width ?? DEFAULT_BOUNDS.width,
    height: bounds?.height ?? DEFAULT_BOUNDS.height,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: currentBg(),
    title: 'AI 热点',
    icon: appIconPath(),
    // 自绘标题栏：顶部那条是应用自己的"铭牌"，系统只保留三键
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: currentBg(),
      symbolColor: nativeTheme.shouldUseDarkColors ? WINDOW_SYMBOL.dark : WINDOW_SYMBOL.light,
      height: TITLEBAR_HEIGHT
    },
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * 渲染层是个纯本地页面：既不联网（数据全走 IPC），也没有 Node 需求。
       * preload 产物只有一行 require('electron')，不依赖任何 Node 能力，
       * 所以沙箱可以开着 —— 纵深防御，多一层不需要付代价。
       * （改 preload 时注意保持这一点：一旦它 require 了 Node 内建，这里要一起改）
       */
      sandbox: true
    }
  })

  hardenWindow(win)
  loadRenderer(win)

  // ready-to-show 才呈现，避免先白后内容的一帧闪烁
  win.once('ready-to-show', () => win.show())

  // 关闭 = 隐藏：这是个托盘常驻应用，关窗不该退出
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    rememberBounds()
    win.hide()
  })

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

function rememberBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !settingsStore) return
  if (mainWindow.isMinimized() || mainWindow.isMaximized()) return
  const [x, y] = mainWindow.getPosition()
  const [width, height] = mainWindow.getSize()
  settingsStore.patch({ windowBounds: { x, y, width, height } })
}

function showPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function togglePanel(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    rememberBounds()
    mainWindow.hide()
    return
  }
  showPanel()
}

/* ------------------------------------------------------------ 托盘 */

function trayState(): TrayState {
  const lastOkAt = client?.sourceStatus.lastOkAt ?? null
  return {
    settings: settingsStore?.settings ?? DEFAULT_SETTINGS,
    headline: snapshot?.hot.items[0]?.title ?? null,
    lastOkText: lastOkAt ? formatClock(lastOkAt) : null,
    update: updater?.describe() ?? idleUpdate()
  }
}

/** updater 还没建出来时的占位状态 —— 只在启动那一瞬间可能用到 */
function idleUpdate(): UpdateState {
  return {
    status: 'idle',
    current: app.getVersion(),
    latest: '',
    percent: 0,
    message: '',
    checkedAt: 0,
    notes: '',
    canDownload: false
  }
}

/** 更新状态变化：同时推给窗口和托盘 */
function pushUpdate(state: UpdateState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update', state)
  }
  tray?.applyState(trayState())
}

/** 收藏变化：渲染层的收藏夹和每个列表行上的按钮一起跟着变 */
function pushSaved(entries: SavedEntry[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('favorites', entries)
  }
}

/* ------------------------------------------------------------ 外部链接 */

/**
 * 打开外部链接。渲染层能把任意字符串递进来，所以这里是安全边界：
 * 只放行 http/https，其它协议（file:、自定义协议）一律丢弃。
 */
function openExternal(raw: unknown): void {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    // 外层 try 只能接住同步异常；调用本身是 promise，也要接住拒绝 ——
    // 主进程的未处理拒绝会掀翻整个应用
    void shell.openExternal(url.toString()).catch(() => {
      /* 系统里打不开这个链接（没有默认浏览器之类），忽略 */
    })
  } catch {
    /* 不是合法 URL，丢弃 */
  }
}

/* ------------------------------------------------------------ IPC */

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => snapshot)
  ipcMain.handle('snapshot:refresh', () => refresh())

  ipcMain.handle('feed:set-category', (_event, category: unknown) => {
    /*
     * 白名单校验：这个值会拼进请求路径、也会成为缓存键 ——
     * 只认界面上真实存在的五个分类（将来的新分类会先进 CATEGORY_ORDER，
     * 从这里流过去，不会静默变成"全部"）。
     */
    const next =
      typeof category === 'string' && (CATEGORY_ORDER as readonly string[]).includes(category)
        ? category
        : null
    return refresh({ category: next })
  })

  /* 精选 / 全部公开动态 */
  ipcMain.handle('feed:set-mode', (_event, mode: unknown) =>
    refresh({ mode: mode === 'all' ? 'all' : 'selected' })
  )

  /* ---------------------------------------------------------- 按需加载 */

  ipcMain.handle('story:get', (_event, publicId: unknown) => {
    if (typeof publicId !== 'string' || publicId.length === 0 || publicId.length > 128) {
      return { data: null, error: '缺少事件编号' } satisfies Loaded<never>
    }
    return (client as AihotClient).story(publicId)
  })

  ipcMain.handle('reports:list', (_event, kind: unknown) => {
    const parsed = parseReportKind(kind)
    if (!parsed) return { data: null, error: '未知的报告类型' } satisfies Loaded<never>
    return (client as AihotClient).reportList(parsed, REPORT_LIMIT[parsed])
  })

  ipcMain.handle('reports:get', (_event, kind: unknown, key: unknown) => {
    const parsed = parseReportKind(kind)
    if (!parsed) return { data: null, error: '未知的报告类型' } satisfies Loaded<never>
    const period = typeof key === 'string' && key.length > 0 && key.length <= 32 ? key : undefined
    return (client as AihotClient).reportDetail(parsed, period)
  })

  ipcMain.handle('codex:get', () => (client as AihotClient).codexResets())

  ipcMain.handle('search:run', (_event, query: unknown, feed: unknown) => {
    const q = typeof query === 'string' ? query.trim() : ''
    // 长度限制来自接口本身：短于 2 字或超过 200 字服务端会直接拒绝
    if (q.length < 2 || q.length > 200) {
      return { data: null, error: '关键词需要在 2 到 200 字之间' } satisfies Loaded<never>
    }
    const mode: FeedMode =
      feed && typeof feed === 'object' && (feed as { mode?: unknown }).mode === 'all'
        ? 'all'
        : 'selected'
    return (client as AihotClient).search(q, { category: null, mode })
  })

  ipcMain.handle('changelog:get', (_event, force: unknown) =>
    (changelogFeed as ChangelogFeed).load(force === true)
  )

  // 榜名认不出来就退回综合榜 —— 宁可给错榜，也别给一页空白
  ipcMain.handle('leaderboard:get', (_event, board: unknown, force: unknown) =>
    (leaderboardFeed as LeaderboardFeed).load(
      typeof board === 'string' ? board : 'all',
      force === true
    )
  )

  /* ---------------------------------------------------------- 收藏 */

  ipcMain.handle('favorites:get', () => savedStore?.all ?? [])

  ipcMain.handle('favorites:toggle', (_event, input: unknown) => {
    const cleaned = parseSavedInput(input)
    if (!cleaned || !savedStore) return savedStore?.all ?? []
    const next = savedStore.toggle(makeSaved(cleaned))
    pushSaved(next)
    return next
  })

  ipcMain.handle('favorites:remove', (_event, key: unknown) => {
    if (typeof key !== 'string' || !savedStore) return savedStore?.all ?? []
    const next = savedStore.remove(key)
    pushSaved(next)
    return next
  })

  ipcMain.handle('favorites:clear', () => {
    const next = savedStore?.clear() ?? []
    pushSaved(next)
    return next
  })

  ipcMain.handle('settings:get', () => settingsStore?.settings ?? null)
  ipcMain.handle('settings:update', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return settingsStore?.settings ?? null
    const before = settingsStore?.settings.autoCheckUpdate ?? false
    const applied = (settingsStore as SettingsStore).patch(patch as Partial<Settings>)
    applyTheme(applied.theme)
    syncTitleBarOverlay()
    scheduleRefresh()
    // 自动检查刚从关到开：立刻排一次，别让用户等到下次启动才生效
    if (!before && applied.autoCheckUpdate) updater?.scheduleStartupCheck()
    tray?.applyState(trayState())
    return applied
  })

  /* 版本更新 */
  ipcMain.handle('update:get', () => updater?.describe() ?? idleUpdate())
  ipcMain.handle('update:check', () => {
    updater?.check()
    return updater?.describe() ?? idleUpdate()
  })
  ipcMain.handle('update:download', () => {
    updater?.download()
    return updater?.describe() ?? idleUpdate()
  })
  ipcMain.handle('update:install', () => updater?.install())
  ipcMain.handle('update:open-page', () => updater?.openReleasePage())

  ipcMain.handle(
    'app:info',
    (): AppInfo => ({
      name: 'AI 热点',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    })
  )

  ipcMain.handle('app:open-external', (_event, url: unknown) => openExternal(url))
  ipcMain.handle('app:open-site', () => openExternal(SITE))
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })
  ipcMain.handle('app:open-data-dir', () => {
    const file = settingsStore?.dataFile
    if (file) shell.showItemInFolder(file)
    return file ?? ''
  })
}

/* ------------------------------------------------------------ 启动 */

// 单实例：第二次启动把已有窗口唤到前面，而不是开两个监听台
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showPanel())

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID)

    /*
     * Windows 上不清空菜单的话，Electron 会自己挂一条 File/Edit/View 的菜单栏出来，
     * 压在主窗口顶部 —— 而这是个自绘标题栏的窗口，那条菜单会直接破坏整个版面。
     * 它不画在 webContents 里，所以截图看不出来，只能靠显式关掉。
     */
    Menu.setApplicationMenu(null)

    settingsStore = new SettingsStore()
    savedStore = new SavedStore()
    changelogFeed = new ChangelogFeed()
    leaderboardFeed = new LeaderboardFeed()

    // 自检时允许从环境变量强制一个主题 —— 深色那套配色只有真跑一遍才看得见
    const forcedTheme = process.env['AIHOT_DESK_SMOKE_THEME']
    if (SMOKE && (forcedTheme === 'light' || forcedTheme === 'dark')) {
      settingsStore.patch({ theme: forcedTheme })
    }

    applyTheme(settingsStore.settings.theme)
    client = new AihotClient()
    updater = new UpdateController({
      getAutoCheck: () => settingsStore?.settings.autoCheckUpdate ?? true,
      onChange: pushUpdate,
      releasePage: RELEASE_PAGE
    })

    registerIpc()

    mainWindow = createMainWindow()
    tray = new TrayController(
      {
        onTogglePanel: () => togglePanel(),
        onRefresh: () => {
          void refresh().then(() => showPanel())
        },
        onPatchSettings: (patch) => {
          const applied = (settingsStore as SettingsStore).patch(patch)
          applyTheme(applied.theme)
          syncTitleBarOverlay()
          scheduleRefresh()
          tray?.applyState(trayState())
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('settings', applied)
          }
        },
        // 同一个菜单项，按当前状态决定这一下是"检查"还是"下载"还是"重启安装"
        onUpdateAction: () => {
          const state = updater?.describe()
          if (!state) return
          if (state.status === 'downloaded') updater?.install()
          else if (state.status === 'available') updater?.download()
          else updater?.check()
        },
        onOpenSite: () => openExternal(SITE),
        onQuit: () => {
          isQuitting = true
          app.quit()
        }
      },
      trayState()
    )

    nativeTheme.on('updated', () => syncTitleBarOverlay())

    // 先让界面立起来，再拉数据 —— 网络慢时用户看到的是加载态，不是白屏
    void refresh().then(() => {
      if (SMOKE) void runSmoke()
    })

    scheduleRefresh()
    updater.scheduleStartupCheck()
    updater.startPeriodicCheck()

    // 合盖/休眠会把定时器带偏，醒来重排一次
    powerMonitor.on('resume', () => {
      scheduleRefresh()
      void refresh()
    })
  })

  // 托盘常驻：窗口全关也不退出
  app.on('window-all-closed', () => {
    /* 什么都不做 —— 退出由托盘菜单与 isQuitting 决定 */
  })

  app.on('before-quit', () => {
    isQuitting = true
    rememberBounds()
  })

  app.on('will-quit', () => {
    tray?.destroy()
    updater?.dispose()
    if (refreshTimer) clearTimeout(refreshTimer)
  })
}

/* ------------------------------------------------------------ 冒烟自检的执行 */

/** 自检里把当前画面存下来 —— 设计上的问题只能靠看，不能靠读 DOM */
async function capture(name: string): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  try {
    const image = await win.webContents.capturePage()
    writeFileSync(join(smokeDir(), `${name}.png`), image.toPNG())
  } catch {
    /* 截图失败不算致命 */
  }
}

/** 把当前画面的关键 DOM 状态读出来 —— 截图看不出的东西（条数、标题）靠它 */
async function readView(win: BrowserWindow): Promise<unknown> {
  return win.webContents.executeJavaScript(
    `(() => {
       const box = (sel) => {
         const el = document.querySelector(sel)
         if (!el) return null
         const info = { w: el.clientWidth, scrollW: el.scrollWidth }
         /*
          * 溢出时顺手指出是谁撑出去的 —— "哪一栏宽了 3px" 截图上看不出来，
          * 但知道是哪一栏还不足以改，得知道是哪一行。
          */
         if (el.scrollWidth > el.clientWidth) {
           const name = (n) => (typeof n.className === 'string' ? n.className : n.tagName) || n.tagName
           // 自身超宽的（含伪元素撑出来的，那种在 DOM 里找不到）→ 找 scrollWidth 最大的子孙
           const worst = [...el.querySelectorAll('*')].reduce(
             (a, n) => (n.scrollWidth > a.scrollWidth ? n : a),
             { scrollWidth: 0, className: 'none' }
           )
           info.over = {
             worst: name(worst) + ' ' + worst.scrollWidth,
             wide: [...el.querySelectorAll('*')]
               .filter((n) => n.scrollWidth > n.clientWidth)
               .slice(0, 8)
               .map((n) => name(n) + ' ' + n.clientWidth + '→' + n.scrollWidth)
           }
         }
         return info
       }
       return {
         title: document.querySelector('[data-testid="title"]')?.textContent ?? null,
         story: document.querySelector('[data-testid="story-title"]')?.textContent ?? null,
         rows: document.querySelectorAll('[data-testid="topic-row"], [data-testid="feed-row"], [data-testid="saved-row"]').length,
         // 横排的期号条已经撤了（往期栏接管了这件事）。留着这个计数是为了确认它没回来
         periods: document.querySelectorAll('[data-testid="period-strip"] .chip').length,
         logDays: document.querySelectorAll('.log__day').length,
         logItems: document.querySelectorAll('.log__item').length,
         savedRows: document.querySelectorAll('[data-testid="saved-row"]').length,
         saveButtons: document.querySelectorAll('[data-testid="save-btn"]').length,
         // --- 报告版式（三档共用骨架，各档自己的零件另行断言）
         paper: box('.paper'),
         // 三栏各自的宽度，用来定位横向溢出是哪一栏撑出去的
         paperCols: [box('.paper__archive'), box('.paper__body'), box('.paper__aside')],
         paperIssues: document.querySelectorAll('[data-testid="report-issue"]').length,
         paperSections: document.querySelectorAll('.paper__section').length,
         paperItems: document.querySelectorAll('.paper__item').length,
         paperStats: document.querySelector('[data-testid="paper-stats"]')?.innerText.replace(/\\n+/g, ' ') ?? null,
         // 周报月报的册页零件：期号徽记 + 导读 + 版本记录
         board: box('.board'),
         boardNo: document.querySelector('.board__no')?.textContent ?? null,
         boardBig: document.querySelector('.board__big')?.textContent ?? null,
         boardTotal: document.querySelector('.board__total')?.textContent ?? null,
         boardTicks: document.querySelectorAll('.board__tick').length,
         boardTicksOn: document.querySelectorAll('.board__tick.is-past, .board__tick.is-current').length,
         rubrics: document.querySelectorAll('.paper__rubric').length,
         hasPreface: document.querySelector('.paper__preface') !== null,
         colophon: document.querySelector('.paper__colophon')?.innerText.replace(/\\n+/g, ' ') ?? null,
         // --- Codex 版式
         codexBody: box('.cxbody'),
         codexCells: document.querySelectorAll('[data-testid="codex-cell"]').length,
         codexCards: document.querySelectorAll('[data-testid="codex-card"]').length,
         codexStats: document.querySelector('[data-testid="codex-stats"]')?.innerText.replace(/\\n+/g, ' ') ?? null,
         // --- 模型榜版式
         lbTable: box('.lbtable'),
         lbRows: document.querySelectorAll('.lbrow--data').length,
         lbPending: document.querySelectorAll('.lbpend__item').length,
         // --- 更新日志的两栏（右栏 188px，和报纸版式的右栏同宽）
         logWrap: box('.logwrap'),
         logSide: box('.logside'),
         // --- 页脚工具栏：主题拨盘和设置挤在同一行 156px 里
         footTools: box('.foot__tools'),
         themeOn: document.querySelector('.themeswitch__seg.is-on')?.getAttribute('aria-label') ?? null,
         // 三档各自的实宽 —— 挤到 30px 以下"哪一档亮着"就看不出来了
         themeSegs: [...document.querySelectorAll('.themeswitch__seg')].map((s) => s.clientWidth),
         text: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 240)
       }
     })()`,
    true
  )
}

async function runSmoke(): Promise<void> {
  const win = mainWindow
  if (!win) return
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const run = (script: string): Promise<unknown> => win.webContents.executeJavaScript(script, true)
  /** 侧栏档位：0 热点 / 1 精选 / 2 报告 / 3 模型榜 / 4 Codex / 5 收藏 / 6 更新日志 */
  const nav = (index: number): Promise<unknown> =>
    run(`document.querySelectorAll('.nav__item')[${index}]?.click()`)

  try {
    // 等渲染层把这一轮数据画出来（首屏渲染 + 一个动画帧）
    await wait(2500)

    // 窗口几何：contentBounds 与 bounds 一致才说明没有原生菜单栏/标题栏压在内容上
    smoke('window', {
      bounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
      visible: win.isVisible(),
      title: win.getTitle()
    })

    // 托盘图标必须自证不是空图 —— nativeImage 载入失败时不抛异常，
    // 只表现为"托盘里什么都看不见"，这个检查是唯一能在无头侧发现的信号
    const trayImage = nativeImage.createFromPath(trayIconPath())
    smoke('tray', {
      empty: trayImage.isEmpty(),
      size: trayImage.getSize()
    })

    smoke('snapshot', {
      fetchedAt: snapshot?.fetchedAt ?? null,
      hotCount: snapshot?.hot.items.length ?? 0,
      hotTop: snapshot?.hot.items.slice(0, 3).map((t) => `#${t.rank} ${t.title}`) ?? [],
      hotError: snapshot?.hot.error ?? null,
      feedCount: snapshot?.feed.items.length ?? 0,
      feedMode: snapshot?.feed.mode ?? null,
      feedError: snapshot?.feed.error ?? null,
      dailyError: snapshot?.daily.error ?? null,
      dailySections: snapshot?.daily.report?.sections.map((s) => `${s.label}:${s.items.length}`) ?? []
    })

    smoke('view-hot', await readView(win))
    await capture('screen-hot')

    // 展开第一行 —— 行内详情是这一版的核心交互，必须亲眼看过
    await run(`document.querySelector('[data-testid="topic-row"]')?.click()`)
    await wait(600)
    await capture('screen-open')

    // 事件页：点详情里的「事件来龙去脉」，原来这里是跳浏览器
    await run(
      `[...document.querySelectorAll('.row.is-open .btn')].find((b) => b.textContent.includes('来龙去脉'))?.click()`
    )
    await wait(1800)
    smoke('view-story', await readView(win))
    await capture('screen-story')

    await run(`document.querySelector('.backbtn')?.click()`)
    await wait(500)

    // 精选流（模式切换 + 分类过滤 + 搜索框）
    await nav(1)
    await wait(800)
    smoke('view-feed', await readView(win))
    await capture('screen-feed')

    // 搜索：React 受控输入不能直接赋 value，要走原生 setter 再派发 input 事件
    await run(
      `(() => {
         const input = document.querySelector('[data-testid="search-input"]')
         if (!input) return false
         const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
         setter.call(input, 'Claude')
         input.dispatchEvent(new Event('input', { bubbles: true }))
         return true
       })()`
    )
    await wait(2600)
    smoke('view-search', await readView(win))
    await capture('screen-search')

    // 报告：日报（默认档位，报纸版式）
    await nav(2)
    await wait(1800)
    smoke('view-report-daily', await readView(win))
    await capture('screen-report')

    /*
     * 往期栏里那一列期号必须点得动 —— 它替代了原来横排的期号条，
     * 是进旧刊的唯一入口。点第二期，看正文有没有跟着换。
     */
    smoke(
      'view-report-archive',
      (await run(`(() => {
        const issues = [...document.querySelectorAll('[data-testid="report-issue"]')]
        const active = document.querySelector('[data-testid="report-issue"].is-active')
        const months = [...document.querySelectorAll('.paper__month')]
        const openMonths = months
          .filter((m) => m.querySelector('.paper__month-head')?.getAttribute('aria-expanded') === 'true')
          .map((m) => m.querySelector('.paper__month-name')?.textContent ?? null)
        const before = document.querySelector('.paper__masthead .stamp__day')?.textContent ?? null
        issues[1]?.click()
        return {
          // 折叠起来的月份不渲染条目，所以这个是"当前展开着几期"
          visibleIssues: issues.length,
          totalMonths: months.length,
          openMonths,
          activeDay: active?.querySelector('.paper__issue-day')?.textContent ?? null,
          before
        }
      })()`)) as unknown
    )
    await wait(1400)
    smoke(
      'view-report-archive-after',
      (await run(`({
         day: document.querySelector('.paper__masthead .stamp__day')?.textContent ?? null,
         stats: document.querySelector('[data-testid="paper-stats"]')?.innerText.replace(/\\n+/g, ' ') ?? null
       })`)) as unknown
    )
    await capture('screen-report-archive')

    // 滚到分栏区 —— 上半屏只有报头和头条，看不出条目排得怎么样
    await run(`document.querySelector('.paper__section')?.scrollIntoView({ block: 'start' })`)
    await wait(600)
    await capture('screen-report-sections')

    // 切到周报 —— 册页版式：往期栏 + 期号徽记 + 本期导读 + 头条 + 带综述的分栏
    // （切档位会自己清掉选中的期号，这里先把滚动位置收回顶部，免得截图从半截开始）
    await run(`document.querySelector('.main__scroll')?.scrollTo({ top: 0 })`)
    await run(`[...document.querySelectorAll('.chip')].find((c) => c.textContent === '周报')?.click()`)
    await wait(1800)
    smoke('view-report-weekly', await readView(win))
    await capture('screen-report-weekly')

    /*
     * 期号徽记上的数是从归档列表里自己数出来的，不是接口字段 ——
     * 数错了页面上看不出来（"第 20 期"和"第 22 期"都像模像样）。
     * 所以直接对：刻度数要等于全年期数、也要等于往期栏的行数，
     * 当前这一期落在刻度最后一格（周报最新一期就是全年最后一期）。
     */
    smoke(
      'view-report-weekly-board',
      (await run(`(() => {
         const ticks = [...document.querySelectorAll('.board__tick')]
         const issues = [...document.querySelectorAll('[data-testid="report-issue"]')]
         return {
           issues: issues.length,
           ticks: ticks.length,
           lastTickIsCurrent: ticks[ticks.length - 1]?.classList.contains('is-current') ?? null,
           firstIssueIsActive: issues[0]?.classList.contains('is-active') ?? null,
           no: document.querySelector('.board__no')?.textContent ?? null,
           stats: document.querySelector('[data-testid="paper-stats"]')?.innerText.replace(/\\n+/g, ' ') ?? null
         }
       })()`)) as unknown
    )

    // 滚到分栏区 —— 分栏带一句综述，是日报没有的东西，得看一眼排得怎么样
    await run(`document.querySelector('.paper__section')?.scrollIntoView({ block: 'start' })`)
    await wait(600)
    await capture('screen-report-weekly-sections')

    // 月报：同一个骨架，换的只是期号的读法（月份而非周次）和全年期数
    await run(`document.querySelector('.main__scroll')?.scrollTo({ top: 0 })`)
    await run(`[...document.querySelectorAll('.chip')].find((c) => c.textContent === '月报')?.click()`)
    await wait(1800)
    smoke('view-report-monthly', await readView(win))
    await capture('screen-report-monthly')

    // 模型榜：和更新日志一样，要抓页面 + 解析，给足时间
    await nav(3)
    await wait(4500)
    smoke('view-leaderboard', await readView(win))
    await capture('screen-leaderboard')

    /*
     * 表格最怕的是"某一列被顶出框" —— 截图上看不出来，因为溢出的那截
     * 被 overflow: hidden 裁掉了，而裁掉的正好是数字列的尾巴。
     * 所以逐格问一遍：谁的 scrollWidth 超过了 clientWidth。
     */
    smoke(
      'view-leaderboard-fit',
      (await run(`(() => {
        const cells = [...document.querySelectorAll('.lbrow--data .lbcol')]
        const table = document.querySelector('.lbtable')
        return {
          rows: document.querySelectorAll('.lbrow--data').length,
          cols: document.querySelectorAll('.lbrow--head .lbcol').length,
          topThree: [...document.querySelectorAll('[data-testid="lb-row"] .lbname')].slice(0, 3).map((n) => n.textContent),
          topScore: document.querySelector('.lbscore')?.textContent ?? null,
          clipped: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent),
          tableOverflow: table ? table.scrollWidth - table.clientWidth : null,
          pending: document.querySelectorAll('.lbpend__item').length,
          note: (document.querySelector('.lbnote')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 26)
        }
      })()`)) as unknown
    )

    /*
     * 换榜：五个榜是并列的档位，换过去整张表连同口径一起换。
     * 这里顺带盯一眼"切榜时旧数据有没有先清掉" —— useLoaded 在 deps 变化时
     * 会先把 loaded 置空，否则会闪出一屏上一个榜的行。
     */
    smoke(
      'view-leaderboard-switch',
      (await run(`(() => {
        const pill = [...document.querySelectorAll('.lbpick')].find((b) => b.textContent === '编程')
        pill?.click()
        return pill ? pill.textContent : null
      })()`)) as unknown
    )
    await wait(4500)
    smoke(
      'view-leaderboard-switch-after',
      (await run(`({
         on: document.querySelector('.lbpick.is-on')?.textContent ?? null,
         rows: document.querySelectorAll('.lbrow--data').length,
         top: document.querySelector('[data-testid="lb-row"] .lbname')?.textContent ?? null
       })`)) as unknown
    )
    await capture('screen-leaderboard-coding')
    await run(`[...document.querySelectorAll('.lbpick')].find((b) => b.textContent === '综合')?.click()`)
    await wait(700)

    // Codex 重置
    await nav(4)
    await wait(1800)
    smoke('view-codex', await readView(win))

    /*
     * 默认焦点。
     *
     * 打开这一页时右边不该把四十多条一次铺出来 —— 那是改版前的行为，
     * "最近一次是什么时候"要往下翻好几屏才看得见。现在默认停在服务端的"今天"，
     * 和 AIHOT 监控页一致。
     * 而今天多半还没有记录，所以右边必须是**空态 + 一条近路**，不能是一片空白。
     */
    smoke(
      'view-codex-default',
      (await run(`(() => {
        const empty = document.querySelector('[data-testid="codex-empty"]')
        return {
          focus: document.querySelector('[data-testid="codex-focus"]')?.textContent ?? null,
          cards: document.querySelectorAll('[data-testid="codex-card"]').length,
          dayBars: [...document.querySelectorAll('.cxlog__day')].map((d) => d.textContent).length,
          empty: empty ? empty.querySelector('.cxlog__empty-title')?.textContent ?? null : null,
          emptyGo: empty?.querySelector('.cxlog__empty-go')?.textContent ?? null,
          clear: document.querySelector('.cxlog__clear')?.textContent ?? null
        }
      })()`)) as unknown
    )

    /*
     * 日历格子是这一版最挤的地方：45px 见方里要塞下「发重置卡」四个字。
     * 截图看不出"是不是刚好卡住"，直接问元素自己 —— scrollWidth 超过
     * clientWidth 就是被裁了。
     */
    smoke(
      'view-codex-fit',
      (await run(`(() => {
        const badges = [...document.querySelectorAll('.cxbadge')]
        const nums = [...document.querySelectorAll('.cxcell__num')]
        const body = document.querySelector('.cxbody')
        return {
          badges: [...new Set(badges.map((b) => b.textContent))],
          clippedBadges: badges.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
          clippedNums: nums.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
          bodyOverflow: body ? body.scrollWidth - body.clientWidth : null,
          // 今天那一格必须有环，否则"你在这里"就没标出来
          todayRinged: document.querySelectorAll('.cxcell.is-today').length
        }
      })()`)) as unknown
    )
    await capture('screen-codex')

    /*
     * 点一天，右侧只看那天的记录 —— 日历和合订本必须对得上，
     * 这是"点了日期跳过去看到的是另一批东西"这类 bug 的探针。
     */
    smoke(
      'view-codex-pick',
      (await run(`(() => {
        const cells = [...document.querySelectorAll('[data-testid="codex-cell"]')]
        const target = cells[0]
        const day = target?.dataset.day ?? null
        target?.click()
        return { day, cardsBefore: document.querySelectorAll('[data-testid="codex-card"]').length }
      })()`)) as unknown
    )
    await wait(700)
    smoke(
      'view-codex-pick-after',
      (await run(`({
         cardsAfter: document.querySelectorAll('[data-testid="codex-card"]').length,
         dayBars: [...document.querySelectorAll('.cxlog__day')].map((d) => d.textContent),
         clearLabel: document.querySelector('.cxlog__clear')?.textContent ?? null,
         // 点了格子，头牌上的焦点日期必须跟着走 —— 否则"在看哪天"就对不上了
         focus: document.querySelector('[data-testid="codex-focus"]')?.textContent ?? null,
         /*
          * 选中的格子必须真的是信号红。这里读 computed style 而不是看类名 ——
          * 类挂上了但被后面一条同特异性的规则盖掉，是 CSS 里最容易犯又最难看出的错
          * （第一版就是这样：.is-picked 写在四档之前，点了日期整格纹丝不动）。
          */
         pickedBg: (() => {
           const el = document.querySelector('.cxcell.is-picked')
           return el ? getComputedStyle(el).backgroundColor : null
         })(),
         signal: getComputedStyle(document.documentElement).getPropertyValue('--signal').trim()
       })`)) as unknown
    )
    await capture('screen-codex-picked')

    // 复原，免得后面几屏跟着被过滤
    await run(`document.querySelector('.cxlog__clear')?.click()`)
    await wait(500)

    // 翻到上个月：日历的月份切换和"本月 N 次"那行要跟着走
    smoke(
      'view-codex-month',
      (await run(`(() => {
        const pick = (label) => [...document.querySelectorAll('.cxcal__step')].find((b) => b.getAttribute('aria-label') === label)
        pick('上个月')?.click()
        return true
      })()`)) as unknown
    )
    await wait(600)
    smoke(
      'view-codex-month-after',
      (await run(`({
         month: document.querySelector('.cxcal__month')?.textContent ?? null,
         cells: document.querySelectorAll('[data-testid="codex-cell"]').length,
         sub: document.querySelector('.cxcal__sub')?.textContent ?? null
       })`)) as unknown
    )
    await capture('screen-codex-month')
    await run(`[...document.querySelectorAll('.cxcal__link')].find((b) => b.textContent === '今天')?.click()`)
    await wait(500)

    // 收藏：先回精选收两条，再看收藏夹
    await nav(1)
    await wait(700)
    await run(
      `[...document.querySelectorAll('[data-testid="feed-row"] [data-testid="save-btn"]')].slice(0, 2).forEach((b) => b.click())`
    )
    await wait(900)
    await nav(5)
    await wait(700)
    smoke('view-saved', await readView(win))
    smoke('favorites', savedStore?.all.map((e) => e.key) ?? [])
    await capture('screen-saved')

    // 更新日志：要抓页面 + 解析，给足时间
    await nav(6)
    await wait(4000)
    smoke('view-changelog', await readView(win))
    await capture('screen-changelog')

    /*
     * 两栏版式 + 两把索引。
     *
     * 索引是"筛"不是"跳" —— 点了「优化」之后左边应该只剩优化。
     * 这里同时盯两件事：
     *   1. 类型计数必须和四档之和相等（站上就是按这个口径印的，
     *      而特稿那天的「重大更新」要算进「更新」，差一条总数就对不上）；
     *   2. 右侧栏不能被内容顶宽 —— 它和报纸版式的右栏同宽 188px。
     */
    smoke(
      'view-changelog-index',
      (await run(`(() => {
        const side = document.querySelector('.logside')
        return {
          kinds: [...document.querySelectorAll('[data-testid="log-kinds"] .logside__opt')].map((o) => o.textContent),
          months: document.querySelectorAll('[data-testid="log-months"] .logside__opt').length,
          on: document.querySelector('.logside__opt.is-on')?.textContent ?? null,
          days: document.querySelectorAll('.log__day').length,
          scope: (document.querySelector('[data-testid="log-scope"]')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 34),
          sideOverflow: side ? side.scrollWidth - side.clientWidth : null
        }
      })()`)) as unknown
    )

    smoke(
      'view-changelog-filter',
      (await run(`(() => {
        const opt = [...document.querySelectorAll('[data-testid="log-kinds"] .logside__opt')].find((o) => o.textContent.includes('优化'))
        opt?.click()
        return opt ? opt.textContent : null
      })()`)) as unknown
    )
    await wait(600)
    smoke(
      'view-changelog-filter-after',
      (await run(`({
         filter: document.querySelector('.log__filter')?.textContent ?? null,
         kinds: [...new Set([...document.querySelectorAll('.log__kind')].map((k) => k.textContent))],
         days: document.querySelectorAll('.log__day').length
       })`)) as unknown
    )
    await capture('screen-changelog-filter')
    await run(`[...document.querySelectorAll('[data-testid="log-kinds"] .logside__opt')].find((o) => o.textContent.includes('全部'))?.click()`)
    await wait(600)

    /*
     * 日志里那篇"特稿"（2026-09-28 的 AIHOT 2.0）单独看一眼：
     * 它是整份日志里唯一一种长得不一样的条目 —— 既最容易被解析漏掉，
     * 也最容易被版式挤坏。滚过去拍一张，顺便断言卡片没被裁掉
     * （scrollWidth > clientWidth 就是有内容顶出了框）。
     */
    const feature = (await run(`(() => {
      const card = document.querySelector('.log__item.is-feature')
      if (!card) return null
      // 滚整天而不是卡片本身：日期抬头（"9 月 28 日 周一"）要一起入镜，
      // 否则这张图看不出"重大更新"是发生在哪一天
      const day = card.closest('.log__day') ?? card
      day.scrollIntoView({ block: 'start' })
      return {
        title: card.querySelector('.log__title')?.textContent ?? null,
        kind: card.querySelector('.log__kind')?.textContent ?? null,
        time: card.querySelector('.log__time')?.textContent ?? null,
        paras: card.querySelectorAll('.log__para').length,
        sections: card.querySelectorAll('.log__bullets li').length,
        caption: card.querySelector('.log__caption')?.textContent ?? null,
        clientWidth: card.clientWidth,
        scrollWidth: card.scrollWidth
      }
    })()`)) as Record<string, unknown> | null
    smoke('view-changelog-feature', feature)
    await wait(500)
    await capture('screen-changelog-feature')

    // 更新检查：注入的假版本会立刻走完「检查 → 发现新版本」，
    // 然后打开设置抽屉把更新区拍下来
    updater?.check()
    await wait(500)
    await run(`document.querySelector('.sidebar__foot .foot__set')?.click()`)
    await wait(600)
    await capture('screen-update-available')

    // 点「下载」——假版本同样立刻走完下载，落到「已就绪」态
    await run(
      `[...document.querySelectorAll('.drawer button')].find((b) => b.textContent.includes('下载'))?.click()`
    )
    await wait(500)
    await capture('screen-update-downloaded')

    /*
     * 主题拨盘：三档 + 设置挤在页脚同一行里。
     *
     * 这里要盯住三件事 ——
     *   1. 拨盘上"亮着的那一档"必须和实际生效的主题一致。这一项特别容易
     *      悄悄错：主进程换的是 nativeTheme，整套配色跟着 prefers-color-scheme
     *      就变了，而拨盘的选中态是另一回事（React 状态），两者可以各走各的，
     *      矛盾的样子是"颜色变了、灯还亮在原来那一档"，光看截图不一定反应过来。
     *   2. 点一下要真的换主题，不是只把高亮挪一格。
     *   3. 这一行总共只有 156px，谁都不许被顶出去。
     *
     * 放在所有截图之后：这一段会真的把主题翻过来再翻回去。万一翻不回来，
     * 前面那些图不该跟着遭殃。
     */
    await run(`[...document.querySelectorAll('.drawer .icon-btn')].find((b) => b.title === '关闭')?.click()`)
    await wait(400)
    const themeBefore = (await run(`({
       on: document.querySelector('.themeswitch__seg.is-on')?.getAttribute('aria-label') ?? null,
       scheme: getComputedStyle(document.documentElement).colorScheme,
       sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
       segs: [...document.querySelectorAll('.themeswitch__seg')].map((s) => s.clientWidth),
       overflow: (() => {
         const row = document.querySelector('.foot__tools')
         return row ? row.scrollWidth - row.clientWidth : null
       })()
     })`)) as { on: string | null; scheme: string }
    smoke('view-theme-switch', themeBefore)
    await capture('screen-theme-switch')

    /*
     * 只翻"强制浅色 / 强制深色"这两档 —— 「跟随系统」翻出来是什么取决于
     * 跑自检这台机器当时的系统设置，拿它当断言会不稳。
     */
    const flipTo = themeBefore.on === '深色' ? '浅色' : '深色'
    await run(
      `[...document.querySelectorAll('.themeswitch__seg')].find((s) => s.getAttribute('aria-label') === '${flipTo}')?.click()`
    )
    await wait(700)
    smoke(
      'view-theme-switch-after',
      (await run(`({
         on: document.querySelector('.themeswitch__seg.is-on')?.getAttribute('aria-label') ?? null,
         scheme: getComputedStyle(document.documentElement).colorScheme,
         sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
         onBg: (() => {
           const el = document.querySelector('.themeswitch__seg.is-on')
           return el ? getComputedStyle(el).backgroundColor : null
         })()
       })`)) as unknown
    )
    await capture('screen-theme-switch-flipped')

    // 翻回来 —— 自检不能把用户机器上的主题留在别的档
    if (themeBefore.on) {
      await run(
        `[...document.querySelectorAll('.themeswitch__seg')].find((s) => s.getAttribute('aria-label') === '${themeBefore.on}')?.click()`
      )
      await wait(700)
    }
    smoke(
      'view-theme-switch-back',
      (await run(`({
         on: document.querySelector('.themeswitch__seg.is-on')?.getAttribute('aria-label') ?? null,
         scheme: getComputedStyle(document.documentElement).colorScheme
       })`)) as unknown
    )

    smoke('update', updater?.describe() ?? null)
  } catch (error) {
    smoke('smoke-error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    /*
     * 收尾对一次账：这一轮有没有被服务端拒掉的请求。
     *
     * 这个必须写进文件。被拒的请求不会让任何断言失败 —— 组件自己会重试或
     * 降级，最后呈现出来的状态照样是对的（比如切报告档位时拿错期号打了一次
     * 400，下一帧就自愈了）。所以"空数组"才是一轮干净的冒烟该有的样子。
     */
    smoke('api-failures', (client as AihotClient).failures)
    smoke('done', { at: Date.now() })
    if (SMOKE_EXIT) {
      isQuitting = true
      app.quit()
    }
  }
}
