import type {
  CodexCalendarCell,
  CodexCalendarDay,
  CodexResetEvent,
  CodexResetPost,
  CodexSnapshot,
  CodexState,
  CodexStats
} from './types'
import { daysBetween, daysInMonth, makeDate, shanghaiDay, shiftDate, weekdayIndex } from './format'

/*
 * Codex 额度重置 —— 原始响应是"给机器看的事件流"（presentation / schedule /
 * estimate / activities 一大套），界面只需要其中几项。这里做一次扁平化，
 * 并把它缺的那样东西补出来：**一个统一的时间**。
 *
 * 原始数据里没有"发生时间"这个字段。不同的事件各带各的：
 *   schedule.from    说好什么时候生效
 *   estimate.from    模型推算的生效窗口
 *   confirmedAt      被确认的时刻
 *   occurredOn       只知道是哪一天
 * 日历要按天摆、间隔要按时刻算、统计要按窗口筛，都得先落到一个时刻上。
 * eventInstant() 就是那张优先级表，其余全部由它派生。
 *
 * 这条线的时间都是北京时间带偏移的（+08:00），和资讯的 UTC 不同 ——
 * 交给 Intl 处理，不要手写偏移。
 *
 * 下面几处口径（四态判定、90 天窗口、间隔用时刻而非整天）不是猜的：
 * 是拿 AIHOT 监控页上印着的数字逐条反推、核对过的
 * （23 次 / 10 次 / 2.2 天 / 10月7日 四项全中）。
 */

export interface RawCodexPost {
  id?: string
  publishedAt?: string
  stage?: string
  /** 中文正文 */
  text?: string
  /** 中文全文（含引用的上下文） */
  fullText?: string
  /** 英文原文全文 */
  fullOriginalText?: string
  /** 原始推文地址 */
  url?: string
}

export interface RawCodexEvent {
  id?: string
  type?: string
  label?: string
  displayLabel?: string
  status?: string
  title?: string
  scope?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  confirmedAt?: string | null
  occurredOn?: string | null
  presentation?: {
    reportedAt?: string | null
    timeInferred?: boolean
    audienceZh?: string | null
    productsZh?: string | null
  } | null
  schedule?: { from?: string | null; label?: string | null } | null
  estimate?: { from?: string | null; label?: string | null } | null
  posts?: RawCodexPost[]
}

export interface RawCodexPayload {
  today?: string
  checkedAt?: string
  events?: RawCodexEvent[]
}

/**
 * 事件的落点时刻。优先级：
 *   schedule.from   约定生效时间
 *   estimate.from   模型推算的窗口起点
 *   confirmedAt     确认时刻
 *   reportedAt      被报道的时刻
 *   occurredOn      只知道日期
 *   updatedAt / createdAt  最后的兜底（有两张卡只有这两个字段）
 */
export function eventInstant(raw: RawCodexEvent): string | null {
  const chain = [
    raw.schedule?.from,
    raw.estimate?.from,
    raw.confirmedAt,
    raw.presentation?.reportedAt,
    raw.occurredOn,
    raw.updatedAt,
    raw.createdAt
  ]
  for (const value of chain) {
    if (value) return value
  }
  return null
}

/**
 * "说了什么时候生效" —— 判定应已生效 / 等待生效只看它。
 *
 * 不能拿 eventInstant 的结果代替：有的预告没有 schedule 也没有 estimate，
 * 只有一条"有人看到了"的报道时刻，那件事其实并没有承诺生效时间。
 */
export function eventPlannedAt(raw: RawCodexEvent): string | null {
  return raw.schedule?.from ?? raw.estimate?.from ?? null
}

function toPost(raw: RawCodexPost): CodexResetPost | null {
  const id = raw.id
  if (!id) return null
  return {
    id,
    publishedAt: raw.publishedAt ?? null,
    stage: raw.stage ?? null,
    text: raw.text ?? null,
    fullText: raw.fullText ?? raw.text ?? null,
    originalText: raw.fullOriginalText ?? null,
    url: raw.url ?? null
  }
}

export function toCodexEvent(raw: RawCodexEvent): CodexResetEvent | null {
  const id = raw.id
  if (!id) return null
  const at = eventInstant(raw)
  return {
    id,
    type: raw.type ?? '',
    label: raw.label ?? '',
    displayLabel: raw.displayLabel ?? raw.label ?? '',
    status: raw.status ?? '',
    title: raw.title ?? '',
    scope: raw.scope ?? null,
    audience: raw.presentation?.audienceZh ?? null,
    products: raw.presentation?.productsZh ?? null,
    createdAt: raw.createdAt ?? null,
    confirmedAt: raw.confirmedAt ?? null,
    scheduleLabel: raw.schedule?.label ?? raw.estimate?.label ?? null,
    at,
    day: shanghaiDay(at),
    plannedAt: eventPlannedAt(raw),
    timeInferred: raw.presentation?.timeInferred === true,
    posts: (raw.posts ?? []).map(toPost).filter((post): post is CodexResetPost => post !== null)
  }
}

/**
 * 整包响应 → 界面要的形状。
 *
 * today / checkedAt 原样带出来：统计窗口和"过没过点"都以**服务端的当天**为准，
 * 用户机器的时区或时钟偏一点，算出来就和站上对不上。
 */
export function toCodexSnapshot(raw: RawCodexPayload): CodexSnapshot {
  const events = (raw.events ?? [])
    .map(toCodexEvent)
    .filter((event): event is CodexResetEvent => event !== null)
  return {
    today: raw.today ?? '',
    checkedAt: raw.checkedAt ?? null,
    events: sortCodexEvents(events)
  }
}

/** 已经落地的那三档 */
export const EFFECTIVE_STATES: CodexState[] = ['confirmed', 'likely', 'due']

const STATE_TEXT: Record<CodexState, string> = {
  confirmed: '已生效',
  likely: '已生效 · 时间未明确',
  due: '应已生效',
  waiting: '等待生效'
}

export function codexStateText(state: CodexState): string {
  return STATE_TEXT[state] ?? '等待生效'
}

/**
 * 一件事实到什么程度。
 *
 * 前三档算"已落地"，统计口径用它。第四条 waiting（说过要发、还没到点）
 * 单独一档，绝不能被算进"重置了多少次"里 —— 那是把预告当既成事实。
 */
export function codexState(event: CodexResetEvent, nowMs: number): CodexState {
  if (event.status === 'confirmed') return event.timeInferred ? 'likely' : 'confirmed'
  const planned = event.plannedAt ? Date.parse(event.plannedAt) : Number.NaN
  if (Number.isFinite(planned) && planned <= nowMs) return 'due'
  return 'waiting'
}

/** 排序：最近发生的在前 */
export function sortCodexEvents(events: CodexResetEvent[]): CodexResetEvent[] {
  return [...events].sort((a, b) => {
    const left = Date.parse(a.at ?? a.createdAt ?? '') || 0
    const right = Date.parse(b.at ?? b.createdAt ?? '') || 0
    return right - left
  })
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? null
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * 监控页顶部那四个数字。
 *
 * today / nowMs 都由调用方注入（来自服务端），不在这里取当前时间 ——
 * 这样它是个纯函数，能拿固定的输入断言出固定的输出。
 */
export function codexStats(
  events: CodexResetEvent[],
  today: string,
  nowMs: number
): CodexStats {
  const effective = events.filter((event) => EFFECTIVE_STATES.includes(codexState(event, nowMs)))
  const from = shiftDate(today, -89)
  const inWindow = (event: CodexResetEvent): boolean =>
    event.day !== null && event.day >= from && event.day <= today

  const reset90 = effective.filter((e) => e.type === 'direct_reset' && inWindow(e)).length
  const credit90 = effective.filter((e) => e.type === 'reset_credit' && inWindow(e)).length

  /*
   * 间隔用**精确时刻**算，不是把日期归一后算整天。
   * 这一条差得很明显：按整天算中位数是 2.0 天，按时刻算是 2.2 天 ——
   * 站上印的是 2.2。
   */
  const resets = effective
    .filter((event) => event.type === 'direct_reset' && event.at)
    .sort((a, b) => (Date.parse(a.at ?? '') || 0) - (Date.parse(b.at ?? '') || 0))
  const gaps: number[] = []
  for (let i = 1; i < resets.length; i += 1) {
    const prev = Date.parse(resets[i - 1]?.at ?? '')
    const next = Date.parse(resets[i]?.at ?? '')
    if (Number.isFinite(prev) && Number.isFinite(next)) gaps.push((next - prev) / 86_400_000)
  }
  const gap = median(gaps)

  const resetDays = resets.map((event) => event.day).filter((day): day is string => day !== null)
  const month = today.slice(0, 7)
  const thisMonth = codexMonthTally(events, month, nowMs)

  return {
    reset90,
    credit90,
    medianGap: gap === null ? null : Math.round(gap * 10) / 10,
    // 不按 90 天窗口筛 —— "上次"就是最近一次，哪怕它在一百天前
    lastResetDay: resetDays.length > 0 ? resetDays[resetDays.length - 1] ?? null : null,
    month,
    monthReset: thisMonth.resets,
    monthCredit: thisMonth.credits
  }
}

/** 越靠前越"实"，月历格子取当天最实的那一档来着色 */
const STATE_RANK: Record<CodexState, number> = {
  confirmed: 3,
  likely: 2,
  due: 1,
  waiting: 0
}

/**
 * 某个月的日历格子（整周对齐，周一起头）。
 *
 * **每一天都占一格**，包括没有记录的日子 —— 日历得先像张日历，
 * 再谈标出哪几天有事。没记录的日子 marked=false，界面按日期纸处理
 * （不上色、不做成按钮），有记录的那几天挂徽标、按四态着色。
 *
 * 摆进去的是**所有**有日期的事件，包括还没到点的预告 —— 日历的作用之一
 * 就是让你看见"接下来还有一次"。这跟顶部统计不同（那个只数已落地的）。
 *
 * 周一起头而不是周日起头：跟着 AIHOT 的日历（以及日报的发行点阵）走，
 * 全站两处日历才是同一种读法。
 */
export function codexCalendar(
  events: CodexResetEvent[],
  month: string,
  nowMs: number
): CodexCalendarCell[] {
  const byDay = new Map<string, CodexCalendarDay>()
  for (const event of events) {
    const day = event.day
    if (!day || !day.startsWith(`${month}-`)) continue
    const state = codexState(event, nowMs)
    const cell = byDay.get(day) ?? {
      day,
      date: Number(day.slice(8)),
      resets: 0,
      credits: 0,
      state,
      marked: true
    }
    if (event.type === 'direct_reset') cell.resets += 1
    else if (event.type === 'reset_credit') cell.credits += 1
    if (STATE_RANK[state] > STATE_RANK[cell.state]) cell.state = state
    byDay.set(day, cell)
  }

  // weekdayIndex 是 0=周日；+6 %7 把它挪成 0=周一
  const lead = (weekdayIndex(makeDate(month, 1)) + 6) % 7
  const total = daysInMonth(month)
  const cells: CodexCalendarCell[] = []
  for (let i = 0; i < lead; i += 1) cells.push({ day: null })
  for (let d = 1; d <= total; d += 1) {
    const day = makeDate(month, d)
    cells.push({
      day: byDay.get(day) ?? { day, date: d, resets: 0, credits: 0, state: 'waiting', marked: false }
    })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null })
  return cells
}

/** 某个月里"已生效"的两种事件各多少次 —— 日历上那行读数用它 */
export function codexMonthTally(
  events: CodexResetEvent[],
  month: string,
  nowMs: number
): { resets: number; credits: number } {
  let resets = 0
  let credits = 0
  for (const event of events) {
    if (!event.day || !event.day.startsWith(`${month}-`)) continue
    if (!EFFECTIVE_STATES.includes(codexState(event, nowMs))) continue
    if (event.type === 'direct_reset') resets += 1
    else if (event.type === 'reset_credit') credits += 1
  }
  return { resets, credits }
}

/** 这个月有几天是有记录的 —— 给"这个月出了几件事"这类文案用 */
export function codexMonthDaysInUse(events: CodexResetEvent[], month: string): number {
  const days = new Set<string>()
  for (const event of events) {
    if (event.day && event.day.startsWith(`${month}-`)) days.add(event.day)
  }
  return days.size
}

/** 日志合订本里的一天 */
export interface CodexDayGroup {
  day: string
  events: CodexResetEvent[]
}

/**
 * 按天分组，最近的在前。
 *
 * 为什么需要它：日历按天看，明细按事看；两边的"天"必须是同一个，
 * 否则点了日历上某一天，跳过去看到的是另一批东西。
 */
export function groupCodexByDay(events: CodexResetEvent[]): CodexDayGroup[] {
  const map = new Map<string, CodexResetEvent[]>()
  for (const event of events) {
    if (!event.day) continue
    const bucket = map.get(event.day)
    if (bucket) bucket.push(event)
    else map.set(event.day, [event])
  }
  return [...map.entries()]
    .map(([day, list]) => ({ day, events: sortCodexEvents(list) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
}

/** 一天离今天多少天 —— 日历上给"今天"打环用 */
export function daysFromToday(day: string, today: string): number {
  return daysBetween(today, day)
}
