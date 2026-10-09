import { app } from 'electron'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings, WindowBounds } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  // 10 分钟：热榜接口的最短轮询间隔是 60s，但内容实际变化没那么快
  // （精选集合一天变几次到几十次），10 分钟对"看一眼今天发生了什么"足够及时，
  // 又不会让应用整天在后台敲接口。
  refreshMinutes: 10,
  // 通知默认关：这是个安静的监听台，响不响应该由用户自己决定
  notifyOnHot: false,
  // 检查更新默认开（只查不装，发现新版也只是一条提示）；
  // 下载与安装永远要用户自己点 —— 见 main/updater.ts 的说明
  autoCheckUpdate: true,
  windowBounds: null
}

/** 可选的自动刷新档位（分钟） */
export const REFRESH_CHOICES = [0, 5, 10, 30, 60] as const

/** 窗口最小尺寸 —— 落盘校验与 BrowserWindow 的 minWidth/minHeight 必须同源 */
export const MIN_WINDOW_WIDTH = 900
export const MIN_WINDOW_HEIGHT = 620

const FILE_VERSION = 1
const FILE_NAME = 'aihot-desk.json'

const THEME_MODES = ['system', 'light', 'dark'] as const

function isTheme(value: unknown): value is Settings['theme'] {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
}

function isRefreshMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (REFRESH_CHOICES as readonly number[]).includes(value)
  )
}

function parseBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Partial<WindowBounds>
  const nums = [point.x, point.y, point.width, point.height]
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  const width = Math.max(MIN_WINDOW_WIDTH, Math.round(point.width as number))
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(point.height as number))
  return { x: Math.round(point.x as number), y: Math.round(point.y as number), width, height }
}

/** 逐字段校验：配置文件被手改坏时只回退那一个字段，不要整体重置 */
function parseSettings(raw: unknown): Settings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: isTheme(input['theme']) ? input['theme'] : DEFAULT_SETTINGS.theme,
    refreshMinutes: isRefreshMinutes(input['refreshMinutes'])
      ? input['refreshMinutes']
      : DEFAULT_SETTINGS.refreshMinutes,
    notifyOnHot:
      typeof input['notifyOnHot'] === 'boolean' ? input['notifyOnHot'] : DEFAULT_SETTINGS.notifyOnHot,
    autoCheckUpdate:
      typeof input['autoCheckUpdate'] === 'boolean'
        ? input['autoCheckUpdate']
        : DEFAULT_SETTINGS.autoCheckUpdate,
    windowBounds: parseBounds(input['windowBounds'])
  }
}

/**
 * 设置持久化。用「临时文件 + fsync + rename」做原子替换，
 * 避免断电 / 强杀进程时留下半个 JSON。
 */
export class SettingsStore {
  private readonly file: string
  private current: Settings

  constructor() {
    this.file = join(app.getPath('userData'), FILE_NAME)
    this.current = this.load()
  }

  get settings(): Settings {
    return this.current
  }

  get dataFile(): string {
    return this.file
  }

  patch(patch: Partial<Settings>): Settings {
    // 运行期来的字段也要过一遍白名单 —— parseSettings 必须是唯一收口
    this.current = parseSettings({ ...this.current, ...patch })
    this.flush()
    return this.current
  }

  private load(): Settings {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Record<string, unknown>
        return parseSettings(raw['settings'])
      }
    } catch {
      // 配置文件坏了就回默认值 —— 不能因为一个设置文件起不来
    }
    return { ...DEFAULT_SETTINGS }
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(
        tmp,
        JSON.stringify({ version: FILE_VERSION, settings: this.current }, null, 2),
        'utf-8'
      )
      const fd = openSync(tmp, 'r+')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, this.file)
    } catch {
      // 写不进去也不能影响主流程
    }
  }
}
