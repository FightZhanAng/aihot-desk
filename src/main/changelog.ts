import { net } from 'electron'
import { parseChangelog } from '../shared/changelog'
import type { ChangelogDay, Loaded } from '../shared/types'

/*
 * AIHOT 更新日志。
 *
 * 它和别的数据源不一样：**没有 JSON 接口**，只有一个服务端渲染的页面。
 * 所以这里的请求头、缓存策略、失败话术都得单独写一套 —— 不能套用
 * AihotClient 的"60 秒最小间隔 + ETag"，那套是给数据接口定的规矩。
 *
 * 礼貌上的自觉：更新日志一天最多更新几条，缓存 30 分钟足够，
 * 没必要每次打开页面都去敲一下。
 */

const CHANGELOG_URL = 'https://aihot.news/changelog'
const USER_AGENT = 'aihot-api/2.0.0'
const TIMEOUT_MS = 15_000
const CACHE_MS = 30 * 60_000
/** 被限流后的冷却 */
const RETRY_MS = 5 * 60_000

export class ChangelogFeed {
  private days: ChangelogDay[] | null = null
  private at = 0
  private etag: string | null = null
  private retryAt = 0
  private inflight: Promise<Loaded<ChangelogDay[]>> | null = null

  async load(force = false): Promise<Loaded<ChangelogDay[]>> {
    // 并发合流：界面连点几下也只打一次
    if (this.inflight) return this.inflight
    if (!force && this.days && Date.now() - this.at < CACHE_MS) {
      return { data: this.days, error: null }
    }
    if (Date.now() < this.retryAt) {
      return this.withStale('AIHOT 正在限流，稍后会自动重试')
    }

    this.inflight = this.fetchOnce().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchOnce(): Promise<Loaded<ChangelogDay[]>> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html'
    }
    if (this.etag) headers['If-None-Match'] = this.etag

    let response: Response
    try {
      response = await net.fetch(CHANGELOG_URL, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      return this.withStale('连不上 AIHOT，稍后再试')
    }

    // 页面没变 —— 刷新时间戳，跳过解析
    if (response.status === 304 && this.days) {
      this.at = Date.now()
      return { data: this.days, error: null }
    }

    if (response.status === 429 || response.status === 503) {
      this.retryAt = Date.now() + RETRY_MS
      return this.withStale('AIHOT 提示请求过于频繁，稍后会自动重试')
    }

    if (!response.ok) return this.withStale(`请求失败（HTTP ${response.status}）`)

    let html: string
    try {
      html = await response.text()
    } catch {
      return this.withStale('更新日志读取失败，稍后再试')
    }

    /*
     * 解析包一层兜底：解析器对"认不出的结构"的承诺是返回空数组，
     * 但真遇到能把正则链掀翻的输入（比如越界实体）它会抛异常 ——
     * 抛出去会绕过下面那条"降级成读不出来"的设计，直接让整次加载变成失败。
     * 对用户来说，认不出来和抛异常是同一件事：读不出来。
     */
    let days: ChangelogDay[]
    try {
      days = parseChangelog(html)
    } catch {
      return this.withStale('更新日志的页面结构变了，暂时读不出来')
    }
    if (days.length === 0) {
      // 一条都没解析出来，说明页面结构变了。
      // 这时候宁可说"读不出来"，也不要展示一个空列表让人以为最近没有更新。
      return this.withStale('更新日志的页面结构变了，暂时读不出来')
    }

    this.days = days
    this.at = Date.now()
    this.etag = response.headers.get('etag')
    return { data: days, error: null }
  }

  /** 失败但有旧数据时，把旧的给出去 + 一句提示 —— 总比整页空白强 */
  private withStale(message: string): Loaded<ChangelogDay[]> {
    return this.days ? { data: this.days, error: message } : { data: null, error: message }
  }
}
