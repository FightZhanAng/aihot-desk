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
import { savedKey, sortSaved, type SavedInput } from '../shared/saved'
import type { SavedEntry, SavedKind } from '../shared/types'

/*
 * 收藏的落盘。
 *
 * 和设置分开一个文件：设置是"应用怎么运行"，收藏是"用户攒了什么"，
 * 两者的损坏代价和读写频率都不是一回事 —— 收藏文件坏掉不该影响应用启动。
 * 写入同样是「临时文件 + fsync + rename」的原子替换。
 */

const FILE_NAME = 'saved.json'
const FILE_VERSION = 1

/**
 * 条数上限。收藏是给自己翻的地方，不是归档库；
 * 超过就丢最旧的 —— 与其让文件无限长大，不如让最早的记录体面退场。
 */
const MAX_ENTRIES = 500

const KINDS: readonly SavedKind[] = ['item', 'story']

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null
  return value.length > max ? value.slice(0, max) : value
}

/** 只收 http/https —— 收藏里存的链接将来是要点开的 */
function httpUrl(value: unknown): string | null {
  const raw = asString(value)
  if (!raw || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * 渲染层递过来的收藏请求 —— 这是安全边界。
 * 界面上能点的东西都在主进程里再校验一遍：它会直接落盘，并且链接会被点开。
 */
export function parseSavedInput(raw: unknown): SavedInput | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>

  const kind = input['kind']
  const id = asString(input['id'])
  const title = asString(input['title'])
  if (typeof kind !== 'string' || !KINDS.includes(kind as SavedKind)) return null
  if (!id || id.length > 256 || !title) return null

  return {
    kind: kind as SavedKind,
    id,
    title: clip(title, 500) as string,
    summary: clip(asString(input['summary']), 2000),
    sourceName: clip(asString(input['sourceName']), 200),
    aihotUrl: httpUrl(input['aihotUrl']),
    originalUrl: httpUrl(input['originalUrl']),
    category: clip(asString(input['category']), 64),
    at: clip(asString(input['at']), 64)
  }
}

/** 逐字段白名单：文件被手改坏时只丢坏掉的那一条，不要整体重置 */
function parseEntry(raw: unknown): SavedEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>

  const kind = input['kind']
  const id = asString(input['id'])
  const title = asString(input['title'])
  if (typeof kind !== 'string' || !KINDS.includes(kind as SavedKind)) return null
  if (!id || !title) return null

  const savedAt = input['savedAt']
  return {
    // key 不信任文件里的值，按 kind + id 重算 —— 它必须是唯一的派生值
    key: savedKey(kind as SavedKind, id),
    kind: kind as SavedKind,
    id,
    title,
    summary: asString(input['summary']),
    sourceName: asString(input['sourceName']),
    aihotUrl: asString(input['aihotUrl']),
    originalUrl: asString(input['originalUrl']),
    category: asString(input['category']),
    at: asString(input['at']),
    savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0
  }
}

export class SavedStore {
  private readonly file: string
  private entries: SavedEntry[]

  constructor() {
    this.file = join(app.getPath('userData'), FILE_NAME)
    this.entries = this.load()
  }

  get all(): SavedEntry[] {
    return this.entries
  }

  get dataFile(): string {
    return this.file
  }

  /**
   * 切换收藏。已存在就取消 —— 界面上只有一个按钮，按第二下就该收回。
   * 返回切换后的完整列表（渲染层拿它整体替换本地状态）。
   */
  toggle(entry: SavedEntry): SavedEntry[] {
    const exists = this.entries.some((current) => current.key === entry.key)
    this.entries = exists
      ? this.entries.filter((current) => current.key !== entry.key)
      : prune([...this.entries, entry])
    this.flush()
    return this.entries
  }

  remove(key: string): SavedEntry[] {
    this.entries = this.entries.filter((entry) => entry.key !== key)
    this.flush()
    return this.entries
  }

  clear(): SavedEntry[] {
    this.entries = []
    this.flush()
    return this.entries
  }

  private load(): SavedEntry[] {
    try {
      if (!existsSync(this.file)) return []
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Record<string, unknown>
      const list = raw['entries']
      if (!Array.isArray(list)) return []
      const parsed = list.map(parseEntry).filter((entry): entry is SavedEntry => entry !== null)
      // 去重：同一个 key 只留最后写入的那条
      const byKey = new Map<string, SavedEntry>()
      for (const entry of parsed) byKey.set(entry.key, entry)
      return sortSaved([...byKey.values()])
    } catch {
      // 文件坏了就当没有收藏 —— 不能让一个坏文件拦住应用启动
      return []
    }
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(
        tmp,
        JSON.stringify({ version: FILE_VERSION, entries: this.entries }, null, 2),
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
      // 写不进去也不影响这一轮的使用（内存里的列表仍然是对的）
    }
  }
}

/** 超上限时丢最旧的。先排序再切，避免丢错 */
function prune(entries: SavedEntry[]): SavedEntry[] {
  if (entries.length <= MAX_ENTRIES) return sortSaved(entries)
  return sortSaved(entries).slice(0, MAX_ENTRIES)
}
