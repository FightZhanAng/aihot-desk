import { splitBy, textOf } from './html'
import type { LeaderboardBoard, LeaderboardModel, LeaderboardPending } from './types'

/*
 * AIHOT 模型榜的解析。
 *
 * 为什么又是"解析 HTML"：开放 JSON API 里没有这个端点 ——
 * /api/v1/models、/leaderboard、/rankings 等六个候选路径全是 404。
 * 但 /leaderboard 是完整服务端渲染的，整张表都在 HTML 里，五个榜各一个地址。
 *
 * 策略和 changelog.ts 一样：**针对这一种结构做精确匹配**，不做通用 HTML 解析。
 * 结构一变，解出来就是空的，界面据此降级成"去站上看" —— 不拿脏数据糊弄用户。
 *
 * 页面结构（按出现顺序）：
 *   <nav aria-label="榜单">          五个榜的 pill
 *   <p class="text-[13.5px] …">      口径说明（评分是怎么算的）
 *   <p class="num text-[12px] …">    35 项评测 · 7 家机构 · 10/09 14:06 更新
 *   <h2 id="lb-board-title">         综合榜 + 展示数
 *   <table><tbody><tr data-slug=…    主体，一行一个模型
 *   <h2 id="lb-pending-title">       暂不排名（榜单满员时整块不出现）
 */

/**
 * 五个榜。key 是内部标识，path 是站上的路径 —— 主进程抓页面要用它。
 * 顺序照站上那排 pill 的排法。
 */
export const LEADERBOARD_BOARDS = [
  { key: 'all', label: '综合', path: '/leaderboard' },
  { key: 'coding', label: '编程', path: '/leaderboard/category/coding' },
  { key: 'reasoning', label: '科研', path: '/leaderboard/category/reasoning' },
  { key: 'professional', label: '专业办公', path: '/leaderboard/category/professional' },
  { key: 'knowledge', label: '知识问答', path: '/leaderboard/category/knowledge' }
] as const

export type LeaderboardKey = (typeof LEADERBOARD_BOARDS)[number]['key']

/** 认不出来的 key 一律退回综合榜 —— 宁可给错榜也不给空白 */
export function leaderboardPath(key: string): string {
  return LEADERBOARD_BOARDS.find((board) => board.key === key)?.path ?? LEADERBOARD_BOARDS[0].path
}

/** 模型详情页。站上有，但太深，应用里只给一个出口 */
export function leaderboardModelUrl(slug: string): string {
  return `https://aihot.news/leaderboard/${slug}`
}

/* ------------------------------------------------------------ 解析 */

/** 榜名 + 展示数：`<h2 id="lb-board-title" …>综合榜<span class="mono …">30 个模型</span></h2>` */
const BOARD_TITLE_RE = /<h2 id="lb-board-title"[^>]*>([\s\S]*?)<\/h2>/

/** 口径说明 */
const BOARD_NOTE_RE = /<p class="text-\[13\.5px\] text-ink-2">([\s\S]*?)<\/p>/

/** 评测面：几项评测 / 几家机构 / 更新时间 */
const BOARD_META_RE = /<p class="num text-\[12px\] text-ink-4">([\s\S]*?)<\/p>/

/** 待排名区的题头；它同时是"这一区在不在"的判据 */
const PENDING_AT_RE = /<h2 id="lb-pending-title"/

const PENDING_NOTE_RE = /<p class="mt-1 text-\[12\.5px\][^"]*">([\s\S]*?)<\/p>/

/** 一行一个模型 */
const ROW_RE = /<tr data-slug="([^"]+)"/

/** 模型名：行里唯一那个 15px 的 <strong> */
const NAME_RE = /<strong class="text-\[15px\][^"]*">([\s\S]*?)<\/strong>/

/**
 * 厂商：只在宽屏下显示的那行小字。
 * 窄屏另有一行把厂商和上线日期混在一起（"Anthropic · 9月22日上线"），不能要它。
 */
const VENDOR_RE = /<small class="hidden[^"]*lg:block">([\s\S]*?)<\/small>/

/** 上线日期 */
const RELEASE_RE = /<time dateTime="(\d{4}-\d{2}-\d{2})"/

/**
 * 评分只认 aria-label —— 它是给读屏软件写的（"Claude Opus 5.5 AIHOT 评分 73.9"），
 * 比那两个只管排版的 <strong> 稳得多。
 */
const SCORE_RE = /aria-label="[^"]*?评分\s*([\d.]+)"\s*>/

function int(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 有可能真的没有的数 —— 用 null 表示"页面没印"，和"是 0"分开 */
function maybeInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseLeaderboard(html: string, board: string): LeaderboardBoard | null {
  if (typeof html !== 'string' || html.length === 0) return null

  const titleRaw = BOARD_TITLE_RE.exec(html)?.[1]
  if (!titleRaw) return null

  const rows = parseRows(html)
  // 主体一行都没解出来 —— 多半是页面改版了。宁可返回 null 让界面提示去看原站，
  // 也不要给一个只有半截数据的榜
  if (rows.length === 0) return null

  const meta = textOf(BOARD_META_RE.exec(html)?.[1] ?? '')
  const titleText = textOf(titleRaw)

  return {
    board,
    title: titleText.replace(/\s*\d+\s*个模型\s*$/, '').trim() || '榜单',
    note: textOf(BOARD_NOTE_RE.exec(html)?.[1] ?? ''),
    evidence: int(/(\d+)\s*项评测/.exec(meta)?.[1]),
    orgs: int(/(\d+)\s*家机构/.exec(meta)?.[1]),
    updatedAt: /(\d{2}\/\d{2}\s+\d{2}:\d{2})/.exec(meta)?.[1]?.replace(/\s+/g, ' ') ?? null,
    rows,
    ...parsePending(html)
  }
}

function parseRows(html: string): LeaderboardModel[] {
  const from = html.indexOf('<tbody')
  const scope = from < 0 ? html : html.slice(from)
  const marks = splitBy(scope, ROW_RE)
  const rows: LeaderboardModel[] = []

  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.start
    const end = i + 1 < marks.length ? marks[i + 1]!.start : scope.length
    const row = parseRow(marks[i]!.head[1] ?? '', scope.slice(start, end))
    if (row) rows.push(row)
  }

  return rows
}

function parseRow(slug: string, chunk: string): LeaderboardModel | null {
  if (!slug) return null

  const name = textOf(NAME_RE.exec(chunk)?.[1] ?? '')
  if (!name) return null

  /*
   * 整行压成纯文本再取数：名次、项数、覆盖率、三个价格都在里面，
   * 而它们各自被 `<!-- -->` 和一层套一层的 <span> 切得七零八落，
   * 逐个写正则不如先拍平。
   *
   * 拍平**之前**得先把 </td> 换成空格：单元格之间原本只有标签、没有空白，
   * 直接去标签会让相邻两格粘成一个数 —— 上线日期 "2026-09-22" 和评测项数
   * "33 项评测" 会粘成 "2026-09-2233 项评测"，那条正则就读出了 2233。
   * 修之前这一行真的解成了 2233（core-test 里有这条断言兜着）。
   */
  const flat = textOf(chunk.replace(/<\/t[dh]>/g, ' '))

  // 价格是"人民币 / 百万 Token"，站上带 ¥ 和两位小数。
  // 顺序就是表头那一排：缓存、输入、输出
  const money = [...flat.matchAll(/¥\s*([\d.,]+)/g)].map((match) => `¥${match[1]}`)

  return {
    rank: int(/^(\d{1,3})/.exec(flat)?.[1]),
    slug,
    name,
    vendor: textOf(VENDOR_RE.exec(chunk)?.[1] ?? ''),
    releasedOn: RELEASE_RE.exec(chunk)?.[1] ?? null,
    evidence: int(/(\d+)\s*项评测/.exec(flat)?.[1]),
    coverage: maybeInt(/覆盖\s*(\d+)\s*%/.exec(flat)?.[1]),
    priceCache: money[0] ?? null,
    priceInput: money[1] ?? null,
    priceOutput: money[2] ?? null,
    score: Number.parseFloat(SCORE_RE.exec(chunk)?.[1] ?? '')
  }
}

/**
 * 「暂不排名」那一段。
 *
 * 它和主表是两种形状（这里是 <ul><li><a>，没有 <tr>），所以单独切。
 * 整块不在时返回空 —— 榜单满员的时候站上会把这一区拿掉，那不是错误。
 */
function parsePending(html: string): {
  pending: LeaderboardPending[]
  pendingNote: string
} {
  const at = PENDING_AT_RE.exec(html)?.index
  if (at === undefined) return { pending: [], pendingNote: '' }

  // 这一区到自己那个 </section> 为止。往后切会把再后面的卡片一起吃进来
  const rest = html.slice(at)
  const end = rest.indexOf('</section>')
  const block = end < 0 ? rest : rest.slice(0, end)

  const marks = splitBy(block, /<li>/)
  const pending: LeaderboardPending[] = []

  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.start
    const stop = i + 1 < marks.length ? marks[i + 1]!.start : block.length
    const item = parsePendingItem(block.slice(start, stop))
    if (item) pending.push(item)
  }

  return { pending, pendingNote: textOf(PENDING_NOTE_RE.exec(block)?.[1] ?? '') }
}

function parsePendingItem(chunk: string): LeaderboardPending | null {
  const slug = /href="\/leaderboard\/([^"]+)"/.exec(chunk)?.[1]
  if (!slug) return null

  const name = textOf(
    /<span class="block truncate text-\[14\.5px\][^"]*">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? ''
  )
  if (!name) return null

  return {
    slug,
    name,
    reason: textOf(
      /<small class="block truncate text-\[12px\][^"]*">([\s\S]*?)<\/small>/.exec(chunk)?.[1] ?? ''
    ),
    score: Number.parseFloat(
      /<span class="mono text-\[18px\][^"]*">([\d.]+)<\/span>/.exec(chunk)?.[1] ?? ''
    )
  }
}
