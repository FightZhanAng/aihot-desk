import { net } from 'electron'
import { leaderboardPath, parseLeaderboard } from '../shared/leaderboard'
import type { LeaderboardBoard, Loaded } from '../shared/types'

/*
 * AIHOT 模型榜。
 *
 * 和更新日志同一种情况：**没有 JSON 接口**
 * （/api/v1/models、/leaderboard、/rankings 等六个候选路径全是 404），
 * 只有一个服务端渲染的页面。所以请求头、缓存策略、失败话术都得单独写一套 ——
 * 不能套用 AihotClient 那套给数据接口定的规矩。
 *
 * 五个榜各是一个地址，各自缓存：切过去看一眼再切回来，不该再打一次网络。
 * 缓存给 30 分钟 —— 榜一天也就动几次，没必要反复敲人家。
 */

const ORIGIN = 'https://aihot.news'
const USER_AGENT = 'aihot-api/2.0.0'
const TIMEOUT_MS = 15_000
const CACHE_MS = 30 * 60_000
/** 被限流后的冷却 */
const RETRY_MS = 5 * 60_000

interface CacheEntry {
  data: LeaderboardBoard
  at: number
  etag: string | null
}

export class LeaderboardFeed {
  private cache = new Map<string, CacheEntry>()
  private retryAt = 0
  private inflight = new Map<string, Promise<Loaded<LeaderboardBoard>>>()

  async load(board: string, force = false): Promise<Loaded<LeaderboardBoard>> {
    // 并发合流：界面连点几下也只打一次
    const running = this.inflight.get(board)
    if (running) return running

    const hit = this.cache.get(board)
    if (!force && hit && Date.now() - hit.at < CACHE_MS) {
      return { data: hit.data, error: null }
    }
    if (Date.now() < this.retryAt) {
      return this.withStale(board, 'AIHOT 正在限流，稍后会自动重试')
    }

    const task = this.fetchOnce(board).finally(() => {
      this.inflight.delete(board)
    })
    this.inflight.set(board, task)
    return task
  }

  private async fetchOnce(board: string): Promise<Loaded<LeaderboardBoard>> {
    const hit = this.cache.get(board)
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html'
    }
    if (hit?.etag) headers['If-None-Match'] = hit.etag

    let response: Response
    try {
      response = await net.fetch(`${ORIGIN}${leaderboardPath(board)}`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      return this.withStale(board, '连不上 AIHOT，稍后再试')
    }

    // 页面没变 —— 刷新时间戳，跳过解析
    if (response.status === 304 && hit) {
      hit.at = Date.now()
      return { data: hit.data, error: null }
    }

    if (response.status === 429 || response.status === 503) {
      this.retryAt = Date.now() + RETRY_MS
      return this.withStale(board, 'AIHOT 提示请求过于频繁，稍后会自动重试')
    }

    if (!response.ok) return this.withStale(board, `请求失败（HTTP ${response.status}）`)

    let html: string
    try {
      html = await response.text()
    } catch {
      return this.withStale(board, '模型榜读取失败，稍后再试')
    }

    /* 同 changelog.ts：解析抛异常不该绕过"降级成读不出来"这条路径 */
    let parsed: LeaderboardBoard | null
    try {
      parsed = parseLeaderboard(html, board)
    } catch {
      return this.withStale(board, '模型榜的页面结构变了，暂时读不出来')
    }
    if (!parsed) {
      // 一行都没解出来，说明页面结构变了。
      // 这时候宁可说"读不出来"，也不要给一张空榜让人以为这个榜上没人。
      return this.withStale(board, '模型榜的页面结构变了，暂时读不出来')
    }

    this.cache.set(board, { data: parsed, at: Date.now(), etag: response.headers.get('etag') })
    return { data: parsed, error: null }
  }

  /** 失败但有旧数据时，把旧的给出去 + 一句提示 —— 总比整页空白强 */
  private withStale(board: string, message: string): Loaded<LeaderboardBoard> {
    const hit = this.cache.get(board)
    return hit ? { data: hit.data, error: message } : { data: null, error: message }
  }
}
