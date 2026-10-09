/*
 * 格式化 —— 时间为主。
 *
 * 全应用统一按北京时间（Asia/Shanghai）显示。API 给的是 UTC，
 * 用 Intl 直接换算，不做手写时区偏移（手写的会踩夏令时/历史时区规则的坑，
 * 而且用户机器时区不一定是 +8）。
 */

const SHANGHAI = 'Asia/Shanghai'

/** 把 ISO 字符串变成 Date；解析不了返回 null，让调用方决定怎么兜底 */
export function parseTime(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t) : null
}

const hmFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** en-CA 的短日期是 YYYY-MM-DD，取后两位正好是 "10-09" 这种紧凑写法 */
const mdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI,
  month: '2-digit',
  day: '2-digit'
})

const ymdFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: 'long',
  day: 'numeric'
})

const weekdayFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  weekday: 'long'
})

/** "14:32" */
export function formatClock(iso: string | null | undefined): string {
  const d = parseTime(iso)
  return d ? hmFmt.format(d) : '--:--'
}

/** "10-09" —— 侧栏的日期徽标用，位置窄，不要写"10月09日" */
export function formatMonthDay(iso: string | null | undefined): string {
  const d = parseTime(iso)
  return d ? mdFmt.format(d) : '--'
}

/** 同一天的判断（按北京时间） */
function shanghaiDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

/**
 * 一个时刻落在北京时间的哪一天 —— "2026-10-03"。
 *
 * 不要用 `iso.slice(0, 10)`：Codex 那条线的时刻都带 +08:00，切一刀碰巧是对的，
 * 但资讯那条线是 UTC 的 `...Z`，同样切一刀就可能差一天。一律过一遍时区。
 */
export function shanghaiDay(iso: string | null | undefined): string | null {
  const d = parseTime(iso)
  return d ? shanghaiDayKey(d) : null
}

/**
 * 资讯列表里的时间：越近的越精确。
 *   刚刚 / 18 分钟前 / 3 小时前 / 14:32（今天） / 昨天 14:32 / 10-08
 */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parseTime(iso)
  if (!d) return ''
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`

  const dayKey = shanghaiDayKey(d)
  const todayKey = shanghaiDayKey(now)
  if (dayKey === todayKey) return `${Math.floor(diffMin / 60)} 小时前`

  const yesterdayKey = shanghaiDayKey(new Date(now.getTime() - 86_400_000))
  if (dayKey === yesterdayKey) return `昨天 ${hmFmt.format(d)}`

  // 今年内不带年份，跨年补上
  const yearFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SHANGHAI, year: 'numeric' })
  const year = yearFmt.format(d)
  return year === yearFmt.format(now) ? mdFmt.format(d) : `${year}-${mdFmt.format(d)}`
}

/** 顶栏的日期牌："2026 年 10 月 9 日 · 星期五" */
export function formatToday(now: Date = new Date()): string {
  return `${ymdFmt.format(now)} · ${weekdayFmt.format(now)}`
}

/** 大数字缩写：1234 -> 1.2k，只在超过 999 时启用 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) < 1000) return String(Math.round(n))
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

/* ------------------------------------------------------------ 纯日期字符串 */

/*
 * 报告期号（2026-10-09 / 2026-W40 / 2026-09）和更新日志的日期都是"日历上的那一天"，
 * 不是某个时刻。它们不走 Date 解析 —— `new Date('2026-10-09')` 按 UTC 零点算，
 * 换个时区就可能显示成前一天，而这种字符串本来就没有"时区"可言。
 */

/** "2026-10-09" → "10 月 9 日"；认不出来就原样返回 */
export function formatDateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return `${Number(match[2])} 月 ${Number(match[3])} 日`
}

/** "2026-09" → "2026 年 9 月" */
export function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return month
  return `${match[1]} 年 ${Number(match[2])} 月`
}

/** "2026-W40" → "第 40 周"（年份由归档列表的上下文提供，一行里不重复写） */
export function formatWeekLabel(week: string): string {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week)
  if (!match) return week
  return `第 ${Number(match[2])} 周`
}

/** "09.28 – 10.04" */
export function formatDateRange(start: string | null, end: string | null): string {
  const short = (value: string | null): string | null => {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value ?? '')
    return match ? `${match[1]}.${match[2]}` : null
  }
  const from = short(start)
  const to = short(end)
  if (from && to) return `${from} – ${to}`
  return from ?? to ?? ''
}

/** "2026-10-03" → "10/03" —— 事件卡上的紧凑时间戳 */
export function formatShortDate(date: string | null | undefined): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date ?? '')
  return match ? `${match[1]}/${match[2]}` : ''
}

/** "2026-10-09" → "9" —— 往期栏最左边那一天号 */
export function dayOfMonth(date: string): string {
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(date)
  return match ? String(Number(match[1])) : ''
}

/** 2026-10 的键 */
export function monthOf(date: string): string {
  const match = /^(\d{4}-\d{2})-\d{2}$/.exec(date)
  return match ? match[1] : ''
}

/** "2026-10" 加减月份。用纯数字算，不碰 Date（日期字符串没有时区） */
export function shiftMonth(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return month
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta
  const year = Math.floor(total / 12)
  const mon = (total % 12 + 12) % 12
  return `${String(year).padStart(4, '0')}-${String(mon + 1).padStart(2, '0')}`
}

const MONTH_CN = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月'
]

/** "2026-10" → "十月" —— 日报期号块上那个大字 */
export function monthNameCN(month: string): string {
  const match = /^\d{4}-(\d{2})$/.exec(month)
  return match ? (MONTH_CN[Number(match[1]) - 1] ?? '') : ''
}

/** "2026-10-09" → "星期五" */
export function weekdayOf(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return ''
  // 用 UTC 构造再按 UTC 读，避免本地时区把日期挪走一天
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'long' }).format(d)
}

/** "2026-10-09" 是星期几（0=周日）。日历排格子用 */
export function weekdayIndex(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return 0
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
}

/** 某个月有多少天 */
export function daysInMonth(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return 30
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
}

/** "2026-10" + 3 → "2026-10-03" */
export function makeDate(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`
}

/** 两个日历日之间差几天（纯日期，不涉时区） */
export function daysBetween(from: string, to: string): number {
  const parse = (v: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN
  }
  const a = parse(from)
  const b = parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** 日期加减天数，返回 "YYYY-MM-DD" */
export function shiftDate(date: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + delta * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/* ------------------------------------------------------------ 报告 */

export const REPORT_KINDS = ['daily', 'weekly', 'monthly'] as const

const REPORT_LABEL: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报'
}

export function reportKindLabel(kind: string): string {
  return REPORT_LABEL[kind] ?? '报告'
}

/** 一期报告的标题：日报写日期，周报写周次，月报写月份 */
export function reportKeyLabel(kind: string, key: string): string {
  if (kind === 'daily') return formatDateLabel(key)
  if (kind === 'weekly') return formatWeekLabel(key)
  if (kind === 'monthly') return formatMonthLabel(key)
  return key
}

/* ------------------------------------------------------------ 分类元数据 */

/**
 * 分类的中文名与固定次序。
 *
 * 次序是刻意的：模型 → 产品 → 行业 → 论文 → 观点，从"硬事实"到"软解读"。
 * 未知分类（API 将来加的）不丢弃，落到"其它"，并按字典序排在已知分类之后。
 */
export const CATEGORY_ORDER = ['ai-models', 'ai-products', 'industry', 'paper', 'tip'] as const

const CATEGORY_LABEL: Record<string, string> = {
  'ai-models': '模型',
  'ai-products': '产品',
  industry: '行业',
  paper: '论文',
  tip: '观点'
}

export function categoryLabel(key: string | null | undefined): string {
  if (!key) return '其它'
  return CATEGORY_LABEL[key] ?? '其它'
}

/** 用于筛选条的完整选项表：全部 + 已知分类 */
export const CATEGORY_FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: '全部' },
  ...CATEGORY_ORDER.map((k) => ({ key: k as string, label: CATEGORY_LABEL[k] as string }))
]
