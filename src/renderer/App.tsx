import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { formatClock, formatMonthDay, formatToday } from '@shared/format'
import { savedKeySet, type SavedInput } from '@shared/saved'
import type {
  AppInfo,
  CategoryFilter,
  FeedMode,
  SavedEntry,
  Settings,
  Snapshot,
  UpdateState,
  ViewKind
} from '@shared/types'
import { updateNeedsAttention } from '@shared/update'
import { ChangelogView } from './components/ChangelogView'
import { CodexView } from './components/CodexView'
import { FeedView } from './components/FeedView'
import { HotView } from './components/HotView'
import { LeaderboardView } from './components/LeaderboardView'
import { ReportView } from './components/ReportView'
import { SavedView } from './components/SavedView'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Sidebar } from './components/Sidebar'
import { LoadingState } from './components/States'
import { StoryView } from './components/StoryView'
import { TitleBar } from './components/TitleBar'

/*
 * 顶层：状态与视图路由。
 *
 * 数据分两类，走两条路：
 *   - 常驻的（热榜 / 精选 / 日报 / 设置 / 收藏 / 版本）由主进程主动推，
 *     这里只是订阅 + 展示；
 *   - 按需的（事件页 / 报告归档 / Codex / 更新日志）由各自的视图自己加载，
 *     离开视图就丢掉 —— 它们不值得占用常驻内存，主进程那边有缓存兜着。
 *
 * 渲染层不缓存业务数据、不做网络请求 —— 它连 fetch 的权限都没有（见 preload）。
 */

/** 手动操作的最小可见时长：再快的响应也要让"转了一下"被看见，否则像没反应 */
const MIN_BUSY_MS = 650

/*
 * IPC 偶发失败（主进程侧异常）不该变成未处理的拒绝 —— 界面保持现状即可，
 * 各视图自己还有加载态 / 错误态兜着。所有 invoke 链都挂上它收尾。
 */
const ignoreFailure = (): void => {}

/**
 * 不依赖常驻快照的视图 —— 它们自己按需加载，所以首屏还没拿到数据时也能进。
 * 其余几栏要靠快照里的热榜 / 精选 / 日报，没数据就只能先转圈。
 */
const SELF_LOADING = new Set<ViewKind>(['leaderboard', 'codex', 'saved', 'changelog'])

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [favorites, setFavorites] = useState<SavedEntry[]>([])

  const [view, setView] = useState<ViewKind>('hot')
  const [category, setCategory] = useState<CategoryFilter>(null)
  const [feedMode, setFeedMode] = useState<FeedMode>('selected')
  const [openId, setOpenId] = useState<string | null>(null)
  /** 打开的事件（publicId）。它盖在当前视图上，不是并列的档位 */
  const [storyId, setStoryId] = useState<string | null>(null)
  /** Codex 事件数 —— 只有进过那一栏才知道，用来点亮侧栏徽标 */
  const [codexCount, setCodexCount] = useState<number | null>(null)

  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [, setNowTick] = useState(0)

  /* ---------------------------------------------------------- 订阅 */

  useEffect(() => {
    // 先订阅再拉当前值：主进程可能在我们挂载的同一瞬间推送，反过来的话那一条会丢
    const offSnapshot = window.hotspot.onSnapshot((next) => setSnapshot(next))
    const offSettings = window.hotspot.onSettings((next) => setSettings(next))
    const offUpdate = window.hotspot.onUpdate((next) => setUpdate(next))
    const offFavorites = window.hotspot.onFavorites((next) => setFavorites(next))

    void window.hotspot.getSnapshot().then((current) => {
      if (current) setSnapshot((prev) => prev ?? current)
    }).catch(ignoreFailure)
    void window.hotspot.getSettings().then((current) => {
      if (current) setSettings((prev) => prev ?? current)
    }).catch(ignoreFailure)
    void window.hotspot.getUpdate().then((current) => {
      if (current) setUpdate((prev) => prev ?? current)
    }).catch(ignoreFailure)
    void window.hotspot.getFavorites().then(setFavorites).catch(ignoreFailure)
    void window.hotspot.getAppInfo().then(setAppInfo).catch(ignoreFailure)

    return () => {
      offSnapshot()
      offSettings()
      offUpdate()
      offFavorites()
    }
  }, [])

  // 相对时间（"3 小时前"）每分钟重算一次，否则它会一直停在打开应用的那一刻
  useEffect(() => {
    const timer = setInterval(() => setNowTick((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  // 首屏入场动画只做一次；之后的刷新是静默替换，不该让列表再抖一遍
  const firstDataSeen = useRef(false)
  useEffect(() => {
    if (!snapshot || firstDataSeen.current) return
    firstDataSeen.current = true
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), 900)
    return () => clearTimeout(timer)
  }, [snapshot])

  /* ---------------------------------------------------------- 动作 */

  const runBusy = useCallback(async (task: () => Promise<unknown>) => {
    setBusy(true)
    const started = Date.now()
    try {
      await task()
    } catch {
      /* 失败由主进程写进快照的 error 字段，这里不额外处理 */
    } finally {
      const elapsed = Date.now() - started
      if (elapsed < MIN_BUSY_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_BUSY_MS - elapsed))
      }
      setBusy(false)
    }
  }, [])

  const refresh = useCallback(() => void runBusy(() => window.hotspot.refresh()), [runBusy])

  const pickCategory = useCallback(
    (next: CategoryFilter) => {
      if (next === category) return
      setCategory(next)
      setOpenId(null)
      void runBusy(() => window.hotspot.setCategory(next))
    },
    [category, runBusy]
  )

  const pickMode = useCallback(
    (next: FeedMode) => {
      if (next === feedMode) return
      setFeedMode(next)
      setOpenId(null)
      void runBusy(() => window.hotspot.setFeedMode(next))
    },
    [feedMode, runBusy]
  )

  const switchView = useCallback((next: ViewKind) => {
    setView(next)
    setOpenId(null)
    setStoryId(null)
  }, [])

  const toggleRow = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id))
  }, [])

  const openStory = useCallback((publicId: string) => {
    setStoryId(publicId)
    setOpenId(null)
  }, [])

  const closeStory = useCallback(() => setStoryId(null), [])

  /* ---------------------------------------------------------- 收藏 */

  const savedKeys = useMemo(() => savedKeySet(favorites), [favorites])

  const toggleSave = useCallback((input: SavedInput) => {
    void window.hotspot.toggleFavorite(input).then(setFavorites).catch(ignoreFailure)
  }, [])

  const removeSaved = useCallback((key: string) => {
    void window.hotspot.removeFavorite(key).then(setFavorites).catch(ignoreFailure)
  }, [])

  const clearSaved = useCallback(() => {
    void window.hotspot.clearFavorites().then(setFavorites).catch(ignoreFailure)
  }, [])

  /* ---------------------------------------------------------- 其它 */

  // Ctrl/Cmd+R 应该是"重新取一份数据"，而不是 Electron 默认的重载整个页面 ——
  // 重载会丢掉当前视图、展开的行和设置抽屉的状态
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        refresh()
        return
      }
      if (event.key === 'Escape') {
        // 逐层退出：先关抽屉，再退出事件页
        if (settingsOpen) setSettingsOpen(false)
        else if (storyId) setStoryId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [refresh, settingsOpen, storyId])

  const openUrl = useCallback((url: string) => {
    void window.hotspot.openExternal(url)
  }, [])

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    void window.hotspot
      .updateSettings(patch)
      .then((next) => {
        if (next) setSettings(next)
      })
      .catch(ignoreFailure)
  }, [])

  /*
   * 主题拨盘和设置抽屉里的「主题」是同一件事的入口 —— 都打给同一个 patch。
   * 主进程负责把选择灌进 nativeTheme.themeSource，渲染层的配色由
   * prefers-color-scheme 自动跟着变，这里不需要同步任何主题状态。
   */
  const pickTheme = useCallback(
    (next: Settings['theme']) => patchSettings({ theme: next }),
    [patchSettings]
  )

  /* 版本更新：四个动作都直接打给主进程，状态靠 onUpdate 推回来 */
  const checkUpdate = useCallback(() => {
    void window.hotspot.checkUpdate().then(setUpdate).catch(ignoreFailure)
  }, [])
  const downloadUpdate = useCallback(() => {
    void window.hotspot.downloadUpdate().then(setUpdate).catch(ignoreFailure)
  }, [])
  const installUpdate = useCallback(() => {
    void window.hotspot.installUpdate().catch(ignoreFailure)
  }, [])
  const openRelease = useCallback(() => {
    void window.hotspot.openReleasePage().catch(ignoreFailure)
  }, [])

  const reportCodexCount = useCallback((count: number) => setCodexCount(count), [])

  /* ---------------------------------------------------------- 派生 */

  const status = useMemo(() => {
    const hot = snapshot?.hot
    const hasData = (hot?.items.length ?? 0) > 0 || (snapshot?.feed.items.length ?? 0) > 0
    const error = hot?.error ?? snapshot?.feed.error ?? snapshot?.daily.error ?? null
    const time = snapshot ? formatClock(snapshot.fetchedAt) : null

    if (!snapshot) return { kind: 'off' as const, text: '正在连接…' }
    if (hasData && !error) return { kind: 'ok' as const, text: time ? `${time} 已同步` : '已同步' }
    if (hasData && error) return { kind: 'warn' as const, text: '显示的是上次取到的数据' }
    return { kind: 'warn' as const, text: error ?? '还没有数据' }
  }, [snapshot])

  const reportDate = snapshot?.daily.report ? formatMonthDay(snapshot.daily.report.date) : null

  /* ---------------------------------------------------------- 渲染 */

  return (
    <div className="app">
      <TitleBar
        dateText={formatToday()}
        busy={busy}
        updatedText={snapshot ? formatClock(snapshot.fetchedAt) : null}
        onRefresh={refresh}
      />

      <div className="app__body">
        <Sidebar
          view={view}
          hotCount={snapshot?.hot.items.length ?? 0}
          feedCount={snapshot?.feed.items.length ?? 0}
          reportDate={reportDate}
          codexCount={codexCount}
          savedCount={favorites.length}
          statusKind={status.kind}
          statusText={status.text}
          theme={settings?.theme ?? null}
          updateAlert={update ? updateNeedsAttention(update.status) : false}
          onView={switchView}
          onPickTheme={pickTheme}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="main">
          <div className="main__scroll">
            {storyId ? (
              <StoryView
                publicId={storyId}
                savedKeys={savedKeys}
                onToggleSave={toggleSave}
                onOpenUrl={openUrl}
                onOpenStory={openStory}
                onBack={closeStory}
              />
            ) : snapshot === null && !SELF_LOADING.has(view) ? (
              <LoadingState />
            ) : view === 'hot' && snapshot ? (
              <HotView
                snapshot={snapshot}
                openId={openId}
                fresh={fresh}
                savedKeys={savedKeys}
                onToggle={toggleRow}
                onOpenUrl={openUrl}
                onOpenStory={openStory}
                onToggleSave={toggleSave}
                onRetry={refresh}
              />
            ) : view === 'feed' && snapshot ? (
              <FeedView
                snapshot={snapshot}
                category={category}
                feedMode={feedMode}
                openId={openId}
                fresh={fresh}
                savedKeys={savedKeys}
                onToggle={toggleRow}
                onOpenUrl={openUrl}
                onPickCategory={pickCategory}
                onPickMode={pickMode}
                onToggleSave={toggleSave}
                onRetry={refresh}
              />
            ) : view === 'report' ? (
              <ReportView savedKeys={savedKeys} onToggleSave={toggleSave} onOpenUrl={openUrl} />
            ) : view === 'leaderboard' ? (
              <LeaderboardView onOpenUrl={openUrl} />
            ) : view === 'codex' ? (
              <CodexView onCount={reportCodexCount} onOpenUrl={openUrl} />
            ) : view === 'saved' ? (
              <SavedView
                entries={favorites}
                onRemove={removeSaved}
                onClear={clearSaved}
                onOpenUrl={openUrl}
                onOpenStory={openStory}
              />
            ) : view === 'changelog' ? (
              <ChangelogView onOpenUrl={openUrl} />
            ) : null}

            <footer className="foot">
              <span>数据来自</span>
              <button
                type="button"
                className="foot__link"
                onClick={() => void window.hotspot.openSite().catch(ignoreFailure)}
              >
                AIHOT
              </button>
              <span>· 编辑精选与热点由 AIHOT 生成，版权归原始信源所有</span>
            </footer>
          </div>
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        appInfo={appInfo}
        update={update}
        onClose={() => setSettingsOpen(false)}
        onPatch={patchSettings}
        onCheckUpdate={checkUpdate}
        onDownloadUpdate={downloadUpdate}
        onInstallUpdate={installUpdate}
        onOpenRelease={openRelease}
        onOpenDataDir={() => void window.hotspot.openDataDir().catch(ignoreFailure)}
        onOpenSite={() => void window.hotspot.openSite().catch(ignoreFailure)}
      />
    </div>
  )
}
