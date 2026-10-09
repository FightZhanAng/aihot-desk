import { net } from 'electron'
import {
  type RawCodexPayload,
  toCodexSnapshot
} from '../shared/codex'
import { type RawReport, type RawReportEntry, toReportDetail, toReportEntry } from '../shared/report'
import { findNewTopEntries } from '../shared/signal'
import type {
  CategoryFilter,
  CodexSnapshot,
  DailyReport,
  FeedMode,
  HotTopic,
  Item,
  Loaded,
  ReportDetail,
  ReportEntry,
  ReportKind,
  Snapshot,
  SourceStatus,
  Story
} from '../shared/types'

/** 精选流的取数参数 */
export interface FeedOptions {
  category: CategoryFilter
  mode: FeedMode
}

/*
 * AIHOT 公开接口客户端。
 *
 * 礼貌约束（来自官方 API 说明，不是我们自己加的）：
 *   - 同一地址的轮询间隔不得低于响应的 Cache-Control s-maxage，目前是 60s；
 *     更快只会拿到同一份共享缓存副本，既费请求又没收益。
 *   - 每次都带 If-None-Match，未变化时服务端回 304 空体 —— 这让"频繁确认"
 *     这件事变得很便宜。
 *   - 429 / 503 要按 Retry-After 等待，且不并行重试。
 * 所以这里的缓存粒度是「每个 URL 一份」，而不是「整个应用一份」：
 * 切分类会换 URL，那是一个新资源，该立刻请求；重复请求同一 URL 才需要等。
 */

const API_BASE = 'https://aihot.news'
const USER_AGENT = 'aihot-api/2.0.0'

/** 同一 URL 的最小请求间隔 */
const MIN_INTERVAL_MS = 60_000
/** 单次请求超时 */
const TIMEOUT_MS = 15_000
/** 拿不准的 Retry-After 时的兜底冷却 */
const FALLBACK_RETRY_MS = 120_000

interface CacheEntry {
  etag: string | null
  body: unknown
  at: number
}

type Outcome<T> = { ok: true; data: T } | { ok: false; message: string; stale?: T }

/** 把失败翻译成给用户看的一句话 —— 界面只展示这个，不展示 HTTP 术语堆栈 */
function describeFailure(status: number | null, error: unknown): string {
  if (status === 429) return 'AIHOT 提示请求过于频繁，稍后会自动重试'
  if (status === 503 || (status !== null && status >= 500)) return 'AIHOT 服务暂时不可用，稍后会自动重试'
  if (status !== null) return `请求失败（HTTP ${status}）`
  const detail = error instanceof Error ? error.message : String(error)
  if (/abort|timeout/i.test(detail)) return '请求超时，检查网络后重试'
  return '连不上 AIHOT，检查网络后重试'
}

export class AihotClient {
  private readonly cache = new Map<string, CacheEntry>()
  /** 429/503 之后的冷却截止时间戳 */
  private retryAt = 0
  private status: SourceStatus = { ok: true, lastOkAt: null, message: null }

  /*
   * 被服务端拒掉的请求，冒烟自检收尾时落到 api-failures.json。
   *
   * 这类失败从前只打在 stdout 上，而冒烟自检按设计"只写文件不写 stdout" ——
   * 于是一个被拒的请求可以在好几轮迭代里一直没人看见（界面上通常看不出：
   * 组件会自己重试或降级，最后呈现的状态是对的）。只留前 20 条，够定位就行。
   */
  readonly failures: string[] = []

  get sourceStatus(): SourceStatus {
    return this.status
  }

  /**
   * 拉一轮全量数据。三个接口各自独立失败 ——
   * 某个端点挂掉不该让另外两个跟着空着，所以错误是"装在每个数据里"的。
   */
  async refresh(feed: FeedOptions): Promise<Snapshot> {
    const hot = await this.request<{ items: HotTopic[] }>('/api/v1/hot-topics')
    const list = await this.request<{ items: Item[] }>(feedPath(feed))
    // 日报是按天发布的固定页，跟着热榜一起拿；失败也不影响前两个
    const daily = await this.request<{ report: DailyReport }>('/api/v1/dailies/latest')

    const failures: string[] = []
    if (!hot.ok) failures.push(hot.message)
    if (!list.ok) failures.push(list.message)
    if (!daily.ok) failures.push(daily.message)

    const anyOk = hot.ok || list.ok || daily.ok
    this.status = {
      ok: anyOk,
      lastOkAt: anyOk ? new Date().toISOString() : this.status.lastOkAt,
      message: failures[0] ?? null
    }

    return {
      fetchedAt: new Date().toISOString(),
      hot: {
        items: hot.ok ? (hot.data.items ?? []) : (hot.stale?.items ?? []),
        error: hot.ok ? null : hot.message
      },
      feed: {
        items: list.ok ? (list.data.items ?? []) : (list.stale?.items ?? []),
        error: list.ok ? null : list.message,
        category: feed.category,
        mode: feed.mode
      },
      daily: {
        report: daily.ok ? (daily.data.report ?? null) : (daily.stale?.report ?? null),
        error: daily.ok ? null : daily.message
      }
    }
  }

  /** 对比两轮热榜，找出新进前 N 名的条目 —— 通知的判据 */
  newTopEntries(prev: HotTopic[] | null, next: HotTopic[], depth = 3): HotTopic[] {
    return findNewTopEntries(prev, next, depth)
  }

  /* ---------------------------------------------------------- 按需加载 */

  /*
   * 下面这些不进自动刷新：事件页、报告归档、Codex 重置、搜索都是"用户主动去看"
   * 的内容，没必要每 10 分钟跟着热榜一起敲一遍接口。它们各自复用同一套
   * 缓存 / ETag / 退避机制，所以反复进出同一个页面不会重复打服务端。
   */

  /** 事件详情：最新进展 + AI 综述 + 报道时间线 */
  async story(publicId: string): Promise<Loaded<Story>> {
    const outcome = await this.request<{ story?: Story }>(
      `/api/v1/stories/${encodeURIComponent(publicId)}`
    )
    const raw = outcome.ok ? outcome.data : outcome.stale
    if (!raw) return { data: null, error: outcome.ok ? '这个事件没有内容' : outcome.message }
    return { data: raw.story ?? null, error: outcome.ok ? null : outcome.message }
  }

  /** 报告归档列表（日报 30 期 / 周报月报各 12 期是接口的默认上限） */
  async reportList(kind: ReportKind, limit: number): Promise<Loaded<ReportEntry[]>> {
    const outcome = await this.request<{ items?: RawReportEntry[] }>(
      `${reportBase(kind)}?limit=${limit}`
    )
    const raw = outcome.ok ? outcome.data : outcome.stale
    if (!raw) return { data: null, error: outcome.ok ? '没有归档' : outcome.message }
    const entries = (raw.items ?? [])
      .map((item) => toReportEntry(kind, item))
      .filter((entry): entry is ReportEntry => entry !== null)
    return { data: entries, error: outcome.ok ? null : outcome.message }
  }

  /** 某一期报告；不传 key 就是最新一期 */
  async reportDetail(kind: ReportKind, key?: string): Promise<Loaded<ReportDetail>> {
    const path = key
      ? `${reportBase(kind)}/${encodeURIComponent(key)}`
      : `${reportBase(kind)}/latest`
    const outcome = await this.request<{ report?: RawReport }>(path)
    const raw = outcome.ok ? outcome.data : outcome.stale
    const detail = raw?.report ? toReportDetail(kind, raw.report) : null
    return { data: detail, error: outcome.ok ? null : outcome.message }
  }

  /** Codex 额度重置与重置卡事件 */
  async codexResets(): Promise<Loaded<CodexSnapshot>> {
    const outcome = await this.request<RawCodexPayload>('/api/v1/codex-resets')
    const raw = outcome.ok ? outcome.data : outcome.stale
    if (!raw) return { data: null, error: outcome.ok ? null : outcome.message }
    return { data: toCodexSnapshot(raw), error: outcome.ok ? null : outcome.message }
  }

  /**
   * 关键词搜索（最近 7 天）。
   * 每个关键词是一个新 URL，所以这里的缓存命中率取决于用户有没有改词 ——
   * 界面上对输入做了防抖，别让每个字符都变成一次请求。
   */
  async search(query: string, feed: FeedOptions): Promise<Loaded<Item[]>> {
    const params = new URLSearchParams({ q: query, mode: feed.mode, window: '7d', limit: '40' })
    if (feed.category) params.set('category', feed.category)
    const outcome = await this.request<{ items?: Item[] }>(`/api/v1/items?${params.toString()}`)
    const raw = outcome.ok ? outcome.data : outcome.stale
    if (!raw) return { data: null, error: outcome.ok ? '没有结果' : outcome.message }
    return { data: raw.items ?? [], error: outcome.ok ? null : outcome.message }
  }

  private async request<T>(path: string): Promise<Outcome<T>> {
    const url = API_BASE + path
    const cached = this.cache.get(path)
    const now = Date.now()

    // 同一地址 60s 内重复请求：直接复用，不去敲服务端
    if (cached && now - cached.at < MIN_INTERVAL_MS) {
      return { ok: true, data: cached.body as T }
    }
    // 退避期内不发请求，有旧数据就把旧数据当"暂时可用"用
    if (now < this.retryAt) {
      if (cached) return { ok: true, data: cached.body as T }
      return { ok: false, message: 'AIHOT 正在限流，稍后自动重试' }
    }

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
    if (cached?.etag) headers['If-None-Match'] = cached.etag

    let response: Response
    try {
      response = await net.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      return this.fail<T>(path, null, error, cached)
    }

    if (response.status === 304 && cached) {
      // 内容没变 —— 刷新时间戳，仍算一次成功
      this.cache.set(path, { ...cached, at: Date.now() })
      return { ok: true, data: cached.body as T }
    }

    if (response.status === 429 || response.status === 503) {
      this.retryAt = Date.now() + parseRetryAfter(response.headers.get('retry-after'))
    }

    if (!response.ok) {
      return this.fail<T>(path, response.status, null, cached)
    }

    try {
      const body = (await response.json()) as T
      this.cache.set(path, { etag: response.headers.get('etag'), body, at: Date.now() })
      return { ok: true, data: body }
    } catch (error) {
      return this.fail<T>(path, response.status, error, cached)
    }
  }

  /*
   * 告警里必须带上是哪个地址 —— 只印一个状态码的话，冒烟自检里冒出
   * 一个孤零零的 400 就完全无从查起（端点那么多，谁被拒了看不出来）。
   */
  private fail<T>(
    path: string,
    status: number | null,
    error: unknown,
    cached: CacheEntry | undefined
  ): Outcome<T> {
    console.warn(`[aihot] 取数失败 status=${status ?? 'n/a'} ${path}`, error ?? '')
    if (this.failures.length < 20) this.failures.push(`${status ?? 'n/a'} ${path}`)
    return {
      ok: false,
      message: describeFailure(status, error),
      // 有旧数据就附上，界面可以继续显示上一轮内容而不是整页报错
      ...(cached ? { stale: cached.body as T } : {})
    }
  }
}

function feedPath(feed: FeedOptions): string {
  const params = new URLSearchParams({ mode: feed.mode, window: '7d', limit: '40' })
  if (feed.category) params.set('category', feed.category)
  return `/api/v1/items?${params.toString()}`
}

/** 三种报告的接口前缀。它们各自有 /latest 和 /{期号} 两种取法 */
function reportBase(kind: ReportKind): string {
  if (kind === 'daily') return '/api/v1/dailies'
  if (kind === 'weekly') return '/api/v1/weeklies'
  return '/api/v1/monthlies'
}

/** Retry-After 是秒数（也可能是 HTTP-date，这里只按秒处理常见情况） */
function parseRetryAfter(value: string | null): number {
  if (!value) return FALLBACK_RETRY_MS
  const seconds = Number.parseInt(value, 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_RETRY_MS
  // 留一点余量，别贴着边界重试
  return Math.min(seconds * 1000 + 1000, 10 * 60 * 1000)
}
