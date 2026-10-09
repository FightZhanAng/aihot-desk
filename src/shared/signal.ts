/*
 * 信号量化 —— 界面上那条"信号带"就是靠这里。
 *
 * 一条资讯有多少人在说、被说了多少遍，是 AIHOT 数据里最有价值的一维，
 * 也是这个应用唯一想强调的视觉元素。原始数字（12 个信源、66 条信号）
 * 不适合扫读，这里把它压成 8 格刻度。
 *
 * 刻度是**绝对**的（满格值写死），不是相对当批数据算的 ——
 * 相对的刻度会随数据批次浮动，"6 格"今天和明天的含义不一样，没法比较，也记不住。
 */

import type { HotTopic } from './types'

/** 信号带的槽位数。8 格是刻意选的：手机信号格的心智，一眼能数清 */
export const SIGNAL_SEGMENTS = 8

/** 热榜用的满格值：实测热点信源数在 1~13 之间，12 往上就到顶了 */
export const HOT_SOURCE_FULL = 12

/** 精选流用的满格值：score 是 0~100 的编辑评分，直接按满分算 */
export const FEED_SCORE_FULL = 100

/**
 * 把强度压成点亮格数。
 * 有值至少点亮 1 格 —— "只在 1 个信源出现"本身就是有效信息，不该画成空的。
 */
export function signalLevel(value: number | null | undefined, full: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0
  const ratio = Math.min(1, value / full)
  return Math.max(1, Math.min(SIGNAL_SEGMENTS, Math.round(ratio * SIGNAL_SEGMENTS)))
}

/**
 * 热榜条目的信号格数。用信源数而不是信号数：
 * 信号数会被单个账号的反复发帖放大，信源数才是"多少人独立在说"。
 */
export function topicSignal(topic: Pick<HotTopic, 'sourceCount'>): number {
  return signalLevel(topic.sourceCount, HOT_SOURCE_FULL)
}

/** 精选条目的信号格数（按编辑评分）。score 缺失时返回 0，画成空槽 */
export function itemSignal(score: number | null | undefined): number {
  return signalLevel(score, FEED_SCORE_FULL)
}

/**
 * 找出"这一轮新进前 N 名"的条目 —— 系统通知用它决定要不要响。
 *
 * 首次拿到数据（prev 为空）永远不算"新进"：那是初始快照，不是新闻。
 */
export function findNewTopEntries(
  prev: HotTopic[] | null,
  next: HotTopic[],
  depth = 3
): HotTopic[] {
  if (!prev || prev.length === 0) return []
  const known = new Set(prev.map((t) => t.id))
  return next.filter((t) => t.rank <= depth && !known.has(t.id))
}
