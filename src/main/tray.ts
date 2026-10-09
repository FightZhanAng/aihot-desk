import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import type { Settings, UpdateState } from '../shared/types'
import { updateNeedsAttention, updateStatusText } from '../shared/update'
import { trayIconPath } from './paths'

/*
 * 托盘 —— 这个应用的常驻形态。
 *
 * 一个细节：菜单点开的瞬间才重建（Tray 的 'click' 不提供菜单打开事件，
 * 所以用 popUpContextMenu 前重建 / 右键前重建的方式），
 * 这样"上次更新 12:03"这类动态文案永远是最新的，不用到处手动同步。
 */

export interface TrayHandlers {
  onTogglePanel(): void
  onRefresh(): void
  onPatchSettings(patch: Partial<Settings>): void
  /** 按当前更新状态分派：待检查时检查、有新版时下载、下完时安装 */
  onUpdateAction(): void
  onOpenSite(): void
  onQuit(): void
}

export interface TrayState {
  settings: Settings
  /** 热榜第一条的标题；没有数据时为 null */
  headline: string | null
  /** 上次成功取数的时间文本（"12:03"）；从未成功为 null */
  lastOkText: string | null
  update: UpdateState
}

const THEME_LABELS: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

export class TrayController {
  private readonly tray: Tray
  private state: TrayState

  constructor(private readonly handlers: TrayHandlers, initial: TrayState) {
    this.state = initial

    // nativeImage 不支持 SVG（会静默给出空图，托盘里什么都看不见），
    // 所以图标是构建期用纯 Node 光栅化好的 PNG
    const image: NativeImage = nativeImage.createFromPath(trayIconPath())
    this.tray = new Tray(image)
    this.tray.setToolTip('AI 热点 · 正在接收信号…')

    this.tray.on('click', () => this.handlers.onTogglePanel())
    this.tray.on('right-click', () => {
      this.tray.popUpContextMenu(this.buildMenu())
    })
    // 部分 Windows 环境只发 'click' 而不区分左右键，双保险
    this.tray.on('double-click', () => this.handlers.onTogglePanel())

    this.applyState(initial)
  }

  applyState(state: TrayState): void {
    this.state = state
    const head = state.headline ? ` · ${truncate(state.headline, 42)}` : ''
    const hint = state.settings.notifyOnHot ? '（新热点通知已开）' : ''
    // 有新版本这件事要在 tooltip 里也能看见 —— 用户不一定点开菜单
    const updateMark = updateNeedsAttention(state.update.status)
      ? `⬆ 新版本 ${state.update.latest} 可用 · `
      : ''
    this.tray.setToolTip(`${updateMark}AI 热点${head}${hint}`)
  }

  private buildMenu(): Menu {
    const { settings, lastOkText } = this.state
    return Menu.buildFromTemplate([
      {
        label: '打开面板',
        click: () => this.handlers.onTogglePanel()
      },
      {
        label: lastOkText ? `立即刷新（上次更新 ${lastOkText}）` : '立即刷新',
        click: () => this.handlers.onRefresh()
      },
      { type: 'separator' },
      {
        label: '新热点通知',
        type: 'checkbox',
        checked: settings.notifyOnHot,
        click: () => this.handlers.onPatchSettings({ notifyOnHot: !settings.notifyOnHot })
      },
      {
        label: '主题',
        submenu: THEME_LABELS.map((item) => ({
          label: item.label,
          type: 'radio' as const,
          checked: settings.theme === item.value,
          click: () => this.handlers.onPatchSettings({ theme: item.value })
        }))
      },
      { type: 'separator' },
      updateMenuItem(this.state.update, () => this.handlers.onUpdateAction()),
      {
        label: '打开发布页',
        click: () => this.handlers.onOpenSite()
      },
      { type: 'separator' },
      { label: '退出', click: () => this.handlers.onQuit() }
    ])
  }

  destroy(): void {
    this.tray.destroy()
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * 更新那一项：同一个位置，文案随状态变，动作也跟着变。
 * 正在检查/下载时禁用（那两件事不能被打断，也没有"取消"的语义）。
 */
function updateMenuItem(state: UpdateState, onClick: () => void): MenuItemConstructorOptions {
  switch (state.status) {
    case 'checking':
      return { label: '正在检查更新…', enabled: false }
    case 'downloading':
      return { label: `正在下载 ${Math.round(state.percent)}%…`, enabled: false }
    case 'available':
      return { label: `下载新版本 ${state.latest}`, click: onClick }
    case 'downloaded':
      return { label: `重启安装 ${state.latest}`, click: onClick }
    case 'unsupported':
      return { label: '检查更新（当前形态不可用）', enabled: false }
    case 'error':
      return { label: `检查更新（${truncate(state.message, 20)}）`, click: onClick }
    case 'latest':
      return { label: updateStatusText(state), enabled: false }
    default:
      return { label: '检查更新', click: onClick }
  }
}
