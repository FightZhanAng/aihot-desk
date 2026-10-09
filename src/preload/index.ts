import { contextBridge, ipcRenderer } from 'electron'
import type { SavedInput } from '../shared/saved'
import type {
  AppInfo,
  CategoryFilter,
  ChangelogDay,
  CodexSnapshot,
  FeedMode,
  Item,
  LeaderboardBoard,
  Loaded,
  ReportDetail,
  ReportEntry,
  ReportKind,
  SavedEntry,
  Settings,
  Snapshot,
  Story,
  UpdateState
} from '../shared/types'

/*
 * 渲染层能碰到的全部能力 —— 就下面这些。
 *
 * 刻意不暴露通用的 invoke(channel, ...args)：那样渲染层等于拿到了主进程
 * 所有 IPC 通道的调用权。每一个能力都必须在这里显式列出来，看一眼就知道
 * 界面能干哪些事。
 */
const api = {
  /* 数据 */
  getSnapshot: (): Promise<Snapshot | null> => ipcRenderer.invoke('snapshot:get') as Promise<Snapshot | null>,
  refresh: (): Promise<Snapshot> => ipcRenderer.invoke('snapshot:refresh') as Promise<Snapshot>,
  /** 切换精选流的分类（null = 全部），返回重新取过的快照 */
  setCategory: (category: CategoryFilter): Promise<Snapshot> =>
    ipcRenderer.invoke('feed:set-category', category) as Promise<Snapshot>,
  /** 精选（编辑挑选）还是全部公开动态 */
  setFeedMode: (mode: FeedMode): Promise<Snapshot> =>
    ipcRenderer.invoke('feed:set-mode', mode) as Promise<Snapshot>,
  /** 订阅主进程推送的新快照；返回取消订阅函数 */
  onSnapshot: (handler: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: Snapshot): void => handler(snapshot)
    ipcRenderer.on('snapshot', listener)
    return () => {
      ipcRenderer.off('snapshot', listener)
    }
  },

  /* 按需加载 —— 用户主动去看的内容，不跟着自动刷新跑 */
  getStory: (publicId: string): Promise<Loaded<Story>> =>
    ipcRenderer.invoke('story:get', publicId) as Promise<Loaded<Story>>,
  listReports: (kind: ReportKind): Promise<Loaded<ReportEntry[]>> =>
    ipcRenderer.invoke('reports:list', kind) as Promise<Loaded<ReportEntry[]>>,
  /** 不传 key 就是最新一期 */
  getReport: (kind: ReportKind, key?: string): Promise<Loaded<ReportDetail>> =>
    ipcRenderer.invoke('reports:get', kind, key) as Promise<Loaded<ReportDetail>>,
  /** Codex 额度重置事件流。整包里带着服务端的"今天"，统计窗口以它为准 */
  getCodexResets: (): Promise<Loaded<CodexSnapshot>> =>
    ipcRenderer.invoke('codex:get') as Promise<Loaded<CodexSnapshot>>,
  /** 关键词搜索（最近 7 天） */
  search: (query: string, mode: FeedMode): Promise<Loaded<Item[]>> =>
    ipcRenderer.invoke('search:run', query, { mode }) as Promise<Loaded<Item[]>>,
  /** AIHOT 的更新日志。force 为真时跳过缓存 */
  getChangelog: (force?: boolean): Promise<Loaded<ChangelogDay[]>> =>
    ipcRenderer.invoke('changelog:get', force === true) as Promise<Loaded<ChangelogDay[]>>,
  /** AIHOT 的模型榜（五个榜共用一套数据形状）。榜名见 shared/leaderboard.ts */
  getLeaderboard: (board: string, force?: boolean): Promise<Loaded<LeaderboardBoard>> =>
    ipcRenderer.invoke('leaderboard:get', board, force === true) as Promise<Loaded<LeaderboardBoard>>,

  /* 收藏 */
  getFavorites: (): Promise<SavedEntry[]> => ipcRenderer.invoke('favorites:get') as Promise<SavedEntry[]>,
  /** 收藏或取消收藏（同一条内容按第二下就是收回），返回切换后的完整列表 */
  toggleFavorite: (input: SavedInput): Promise<SavedEntry[]> =>
    ipcRenderer.invoke('favorites:toggle', input) as Promise<SavedEntry[]>,
  removeFavorite: (key: string): Promise<SavedEntry[]> =>
    ipcRenderer.invoke('favorites:remove', key) as Promise<SavedEntry[]>,
  clearFavorites: (): Promise<SavedEntry[]> =>
    ipcRenderer.invoke('favorites:clear') as Promise<SavedEntry[]>,
  onFavorites: (handler: (entries: SavedEntry[]) => void): (() => void) => {
    const listener = (_event: unknown, entries: SavedEntry[]): void => handler(entries)
    ipcRenderer.on('favorites', listener)
    return () => {
      ipcRenderer.off('favorites', listener)
    }
  },

  /* 设置 */
  getSettings: (): Promise<Settings | null> => ipcRenderer.invoke('settings:get') as Promise<Settings | null>,
  updateSettings: (patch: Partial<Settings>): Promise<Settings | null> =>
    ipcRenderer.invoke('settings:update', patch) as Promise<Settings | null>,
  /** 托盘菜单改了设置时也会推过来，保证面板里的开关不会和托盘不一致 */
  onSettings: (handler: (settings: Settings) => void): (() => void) => {
    const listener = (_event: unknown, settings: Settings): void => handler(settings)
    ipcRenderer.on('settings', listener)
    return () => {
      ipcRenderer.off('settings', listener)
    }
  },

  /* 版本更新 */
  getUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('update:get') as Promise<UpdateState>,
  checkUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('update:check') as Promise<UpdateState>,
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('update:download') as Promise<UpdateState>,
  /** 下载完成后重启并安装。调用它会让应用立刻退出 */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install') as Promise<void>,
  openReleasePage: (): Promise<void> => ipcRenderer.invoke('update:open-page') as Promise<void>,
  onUpdate: (handler: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: UpdateState): void => handler(state)
    ipcRenderer.on('update', listener)
    return () => {
      ipcRenderer.off('update', listener)
    }
  },

  /* 应用 */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  /** 在系统浏览器里打开链接。主进程只放行 http/https */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  openSite: (): Promise<void> => ipcRenderer.invoke('app:open-site') as Promise<void>,
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:open-data-dir') as Promise<string>,
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit') as Promise<void>
}

contextBridge.exposeInMainWorld('hotspot', api)

export type HotspotApi = typeof api
