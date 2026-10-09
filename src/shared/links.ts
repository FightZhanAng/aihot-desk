/*
 * 从 AIHOT 的链接里认出它指向什么。
 *
 * 有些内容没有独立的 id 字段 —— 报告正文里的条目、热榜条目背后的事件页，
 * 唯一稳定的标识就藏在链接路径里。而且链接域名有两种历史形态
 * （新的 aihot.news 和旧的 aihot.virxact.com，后者会 301 到前者），
 * 所以只能按路径段匹配，不能按域名判断。
 */

/** 资讯条目：https://aihot.news/items/{id} */
export function itemIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /\/items\/([A-Za-z0-9]+)/.exec(url)
  return match?.[1] ?? null
}

/** 事件：https://aihot.news/story/{uuid} */
export function storyIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /\/story\/([A-Za-z0-9][A-Za-z0-9-]{0,127})/.exec(url)
  return match?.[1] ?? null
}
