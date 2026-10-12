/**
 * 版本更新检查与下载。
 *
 * 引擎用 electron-updater：它读打包时生成的 app-update.yml（来自
 * electron-builder.yml 的 publish 配置），先去 GitHub Release 上拉 latest.yml
 * 比对版本，再按需下载差分包。
 *
 * 下载策略：**永远由用户手点**。检查可以在后台自动做，但下载是占带宽、
 * 往磁盘写东西的行为，不该在用户没同意时发生。所以 autoDownload 恒为 false。
 *
 * 两种形态走不通，必须显式说明而不是假装「已是最新」：
 *   - 开发模式：没有 app-update.yml，checkForUpdates 直接抛错
 *   - 免安装版（portable）：没有一个稳定的安装目录可以覆盖，electron-updater
 *     自己也会拒绝。这两种情况下界面只提供「打开发布页」。
 */
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { isNewerVersion, normalizeVersion } from '../shared/update'

/** 自动检查的间隔：24 小时。启动时那一次由 scheduleStartupCheck 单独安排 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 启动后延迟这么久再检查 —— 别和首屏那轮取数抢网络 */
const STARTUP_DELAY_MS = 10_000

export interface UpdateOptions {
  /** 每次检查现读设置，用户改了开关立刻生效 */
  getAutoCheck(): boolean
  /** 状态变化时回调（主进程负责广播给窗口、刷新托盘） */
  onChange(state: UpdateState): void
  /** 发布页地址，「打开发布页」用它 */
  releasePage: string
}

/** 把 electron-updater 的英文错误翻成能看懂的一句话 */
function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (!raw) return '检查更新失败'
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::/i.test(raw)) {
    return '网络不可达，稍后再试'
  }
  if (/app-update\.yml/i.test(raw)) return '缺少更新配置，需重新安装本应用'
  if (/\b404\b|not found|Cannot find/i.test(raw)) return '更新源上找不到版本信息'
  if (/403|rate limit|API rate/i.test(raw)) return '更新源访问受限，稍后再试'
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw
}

/** releaseNotes 有 string / 对象数组两种形态，统一压成一段纯文本 */
function flattenNotes(info: UpdateInfo): string {
  const notes = info.releaseNotes
  if (typeof notes === 'string') return notes.trim()
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        const note = (entry as { note?: unknown }).note
        return typeof note === 'string' ? note : ''
      })
      .join('\n')
      .trim()
  }
  return ''
}

/** 当前运行形态能不能用 electron-updater */
function supportOf(): { ok: boolean; reason: string } {
  if (!app.isPackaged) return { ok: false, reason: '开发模式：更新检查在打包后才生效' }
  // electron-builder 的 portable target 会注入这个变量
  if (process.env['PORTABLE_EXECUTABLE_DIR']) {
    return { ok: false, reason: '免安装版：请到发布页下载新版本' }
  }
  return { ok: true, reason: '' }
}

export class UpdateController {
  private state: UpdateState
  private readonly supported: boolean
  private readonly supportReason: string
  private wired = false
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  /** 自检/开发用的假版本号：设了它就不走网络，直接装成「发现新版本」 */
  private readonly fakeVersion: string

  constructor(private readonly options: UpdateOptions) {
    const support = supportOf()
    this.fakeVersion =
      (process.env['AIHOT_DESK_FAKE_UPDATE'] ?? '').trim() ||
      // 自检默认注入一个假版本：否则 dev 下永远是 unsupported，
      // 「发现新版本」这一整套界面根本没机会被测到
      (process.env['AIHOT_DESK_SMOKE'] === '1' ? '9.9.9' : '')
    // 注入假版本时，即使处在开发模式也当作「可检查」
    this.supported = support.ok || this.fakeVersion !== ''
    this.supportReason = support.reason

    this.state = {
      status: this.supported ? 'idle' : 'unsupported',
      current: safeVersion(),
      latest: '',
      percent: 0,
      message: this.supported ? '' : support.reason,
      checkedAt: 0,
      notes: '',
      canDownload: false
    }
  }

  describe(): UpdateState {
    return { ...this.state }
  }

  /**
   * 手动检查。
   * 正在检查/下载时直接忽略，免得连点堆出一串请求 —— electron-updater 对
   * 并发 checkForUpdates 的处理并不友好。
   */
  check(): void {
    if (!this.supported) {
      this.set({ message: this.supportReason })
      return
    }
    if (this.state.status === 'checking' || this.state.status === 'downloading') return

    if (this.fakeVersion) {
      this.set({ status: 'checking', message: '' })
      this.finishCheck(this.fakeVersion, '（自检注入的假版本）')
      return
    }

    this.set({ status: 'checking', message: '' })
    this.wire()
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        // 没有新版本时 electron-updater 只发事件、不回 info，这里兜一下底，
        // 免得状态永远停在 checking。
        if (!result?.updateInfo && this.state.status === 'checking') {
          this.set({ status: 'latest', latest: '', checkedAt: Date.now(), message: '' })
        }
      })
      .catch((error: unknown) => {
        this.set({ status: 'error', message: describeError(error), checkedAt: Date.now() })
      })
  }

  /** 手动开始下载（autoDownload 恒为 false，所以这一步总是用户点的） */
  download(): void {
    if (!this.supported) return
    if (this.state.status !== 'available') return
    if (this.fakeVersion) {
      this.set({ status: 'downloading', percent: 0 })
      // 和真实路径（update-downloaded 事件）保持同一个终态 ——
      // 下载完就不该再有"可下载"的标记（冒烟里 canDownload 一直是 true，就是这么漏出来的）
      this.set({ status: 'downloaded', percent: 100, canDownload: false })
      return
    }
    this.set({ status: 'downloading', percent: 0 })
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      this.set({ status: 'error', message: describeError(error) })
    })
  }

  /**
   * 装完了重启。只有用户明确点过按钮才会走到这里。
   * quitAndInstall 自己会触发 app.quit()，所以不需要额外去设「正在退出」的标记。
   */
  install(): void {
    if (this.state.status !== 'downloaded') return
    if (this.fakeVersion) return
    setImmediate(() => autoUpdater.quitAndInstall())
  }

  openReleasePage(): void {
    // 主进程的未处理拒绝会掀翻整个应用 —— 打不开就当没点过，不往上抛
    void shell.openExternal(this.options.releasePage).catch(() => {})
  }

  /** 启动时那一次自动检查（延迟一点，别和首屏取数抢网络） */
  scheduleStartupCheck(): void {
    if (!this.supported || !this.options.getAutoCheck()) return
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      if (this.options.getAutoCheck()) this.check()
    }, STARTUP_DELAY_MS)
    this.startupTimer.unref?.()
  }

  /** 每 24 小时一次的后台检查 */
  startPeriodicCheck(): void {
    if (!this.supported || this.timer) return
    this.timer = setInterval(() => {
      if (this.options.getAutoCheck()) this.check()
    }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.timer = null
    this.startupTimer = null
  }

  /* ---------------------------------------------------------- 内部 */

  private finishCheck(latest: string, notes: string): void {
    const available = isNewerVersion(latest, this.state.current)
    this.set({
      status: available ? 'available' : 'latest',
      latest: available ? latest : '',
      notes: available ? notes : '',
      percent: 0,
      message: '',
      checkedAt: Date.now(),
      canDownload: available
    })
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.options.onChange(this.describe())
  }

  /** 只在第一次真正要用的时候接线，免得开发模式下白注册一堆监听 */
  private wire(): void {
    if (this.wired) return
    this.wired = true

    // Windows 上 GUI 进程没有控制台，默认的 console 日志等于丢掉
    autoUpdater.logger = null
    autoUpdater.autoDownload = false
    /*
     * 关掉"退出时自动安装"。它的默认值是 true，语义是「只要下载过，
     * 之后退出应用时就把新版静默装上」—— 那和界面上的承诺是两回事：
     * 设置面板与 README 都写着"下载与安装都必须由用户点"。
     * 关掉它，安装就只剩 install() 里那一条路径：用户点「重启并安装」。
     */
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = true
    // 只吃正式版：预发布包不该推给普通用户
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => {
      this.set({ status: 'checking', message: '' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      const latest = normalizeVersion(info.version)
      const available = isNewerVersion(latest, this.state.current)
      this.set({
        status: available ? 'available' : 'latest',
        latest: available ? latest : '',
        notes: available ? flattenNotes(info) : '',
        percent: 0,
        message: '',
        checkedAt: Date.now(),
        canDownload: available
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.set({
        status: 'latest',
        latest: '',
        notes: '',
        percent: 0,
        message: '',
        checkedAt: Date.now(),
        canDownload: false
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.set({
        status: 'downloading',
        percent: Number.isFinite(progress?.percent) ? progress.percent : 0
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      const latest = normalizeVersion(info.version) || this.state.latest
      this.set({
        status: 'downloaded',
        latest,
        percent: 100,
        message: '',
        checkedAt: Date.now(),
        canDownload: false
      })
    })

    autoUpdater.on('error', (error: Error) => {
      // 下载中途出错也要落到 error，用户才知道没在下了
      this.set({ status: 'error', message: describeError(error), checkedAt: Date.now() })
    })
  }
}

/* ------------------------------------------------ 小工具 */

function safeVersion(): string {
  try {
    return normalizeVersion(app.getVersion())
  } catch {
    return ''
  }
}
