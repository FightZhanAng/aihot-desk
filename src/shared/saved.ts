import { itemIdFromUrl } from './links'
import type { HotTopic, Item, ReportArticle, SavedEntry, SavedKind, Story } from './types'

/*
 * 收藏 —— 纯逻辑。
 *
 * 收藏只能存在本地：AIHOT 的公开接口是匿名只读的（网站上的"收藏"要登录账号），
 * 没有任何写接口。所以这里既不"同步"也不"上报"，就是一叠存在自己磁盘上的记录。
 *
 * 两个刻意的决定：
 *   1. 存内容快照，不存 id 引用 —— 精选集合会滚动，几天后按 id 回查大概率 404。
 *   2. key 由 kind + id 组成，同一条内容不会因为从两个入口点进来就存成两条
 *      （热榜条目和精选条目共用 item id，所以两处的 key 是同一个）。
 */

/** 生成收藏键。同一条内容在任何入口收藏，落到同一个 key */
export function savedKey(kind: SavedKind, id: string): string {
  return `${kind}:${id}`
}

export interface SavedInput {
  kind: SavedKind
  id: string
  title: string
  summary?: string | null
  sourceName?: string | null
  aihotUrl?: string | null
  originalUrl?: string | null
  category?: string | null
  /** 内容自身的时间（发布 / 最新进展），不是收藏时间 */
  at?: string | null
}

export function makeSaved(input: SavedInput, now: number = Date.now()): SavedEntry {
  return {
    key: savedKey(input.kind, input.id),
    kind: input.kind,
    id: input.id,
    title: input.title,
    summary: input.summary ?? null,
    sourceName: input.sourceName ?? null,
    aihotUrl: input.aihotUrl ?? null,
    originalUrl: input.originalUrl ?? null,
    category: input.category ?? null,
    at: input.at ?? null,
    savedAt: now
  }
}

/* ------------------------------------------------------------ 各入口的适配 */

/** 精选条目 */
export function savedFromItem(item: Item, now?: number): SavedEntry {
  return makeSaved(
    {
      kind: 'item',
      id: item.id,
      title: item.title,
      summary: item.summary,
      sourceName: item.source.name,
      aihotUrl: item.links.aihot ?? null,
      originalUrl: item.links.original ?? null,
      category: item.category,
      at: item.publishedAt ?? item.discoveredAt
    },
    now
  )
}

/** 热榜条目 —— 和精选共用 item id，所以两处收藏的是同一条 */
export function savedFromTopic(topic: HotTopic, now?: number): SavedEntry {
  return makeSaved(
    {
      kind: 'item',
      id: topic.id,
      title: topic.title,
      summary: null,
      sourceName: topic.source.name,
      aihotUrl: topic.links.aihot ?? null,
      originalUrl: topic.links.original ?? null,
      category: null,
      at: topic.latestAt
    },
    now
  )
}

/** 事件页 —— 收藏的是"这条线"，和收藏其中某篇报道不是一回事 */
export function savedFromStory(story: Story, now?: number): SavedEntry {
  return makeSaved(
    {
      kind: 'story',
      id: story.publicId,
      title: story.title,
      summary: story.latest,
      // 事件没有单一"来源"，用信源数说明它的规模
      sourceName: story.sourceCount > 0 ? `${story.sourceCount} 家信源` : null,
      aihotUrl: story.links.aihot ?? null,
      originalUrl: null,
      category: null,
      at: story.latestAt
    },
    now
  )
}

/**
 * 报告正文里的条目 / 事件里的单篇报道。两者形状一致，共用这一个入口。
 *
 * 它没有 id 字段，只能从站内链接里抠；抠不到就退回标题 ——
 * 标题相同视为同一条，比完全没法去重好。抠到的 id 和精选条目是同一个，
 * 所以同一条内容从两个地方收藏只会留下一条。
 */
export function savedFromArticle(article: ReportArticle, now?: number): SavedEntry {
  const aihotUrl = article.links.aihot ?? null
  const id = itemIdFromUrl(aihotUrl) ?? article.title
  return makeSaved(
    {
      kind: 'item',
      id,
      title: article.title,
      summary: article.summary,
      sourceName: article.source.name,
      aihotUrl,
      originalUrl: article.links.original ?? null,
      category: null,
      at: article.publishedAt ?? null
    },
    now
  )
}

/* ------------------------------------------------------------ 查与排 */

/** 收藏时间倒序 —— 最近存的在最上面 */
export function sortSaved(entries: SavedEntry[]): SavedEntry[] {
  return [...entries].sort((a, b) => b.savedAt - a.savedAt)
}

/** 给界面做"这一条收没收藏过"的 O(1) 查询 */
export function savedKeySet(entries: SavedEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.key))
}

/** 收藏夹里的分类口径：按内容类型分组，不是按 AIHOT 的资讯分类 */
export const SAVED_KINDS: { key: SavedKind; label: string }[] = [
  { key: 'item', label: '资讯' },
  { key: 'story', label: '事件' }
]

/** 一条收藏属于哪一类；认不出来的一律算资讯（它至少是条内容） */
export function savedKindLabel(kind: string): string {
  return SAVED_KINDS.find((entry) => entry.key === kind)?.label ?? '资讯'
}
