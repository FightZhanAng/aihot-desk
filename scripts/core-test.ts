/*
 * 纯逻辑测试 —— 不依赖 Electron，直接 node 跑。
 *
 * 覆盖的是最容易写错、又最难在界面上看出来的东西：
 * 信号量化的边界、相对时间的跨天判断、分类兜底。
 * 不引测试框架：几十条断言不值得装一整套 vitest。
 */

import {
  changelogEntryCount,
  changelogKind,
  changelogKindTally,
  changelogMonthTally,
  filterChangelog,
  parseChangelog
} from '../src/shared/changelog'
import {
  codexCalendar,
  codexMonthDaysInUse,
  codexMonthTally,
  codexState,
  codexStateText,
  codexStats,
  daysFromToday,
  groupCodexByDay,
  sortCodexEvents,
  toCodexEvent,
  toCodexSnapshot
} from '../src/shared/codex'
import {
  categoryLabel,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  formatClock,
  formatCount,
  formatDateLabel,
  formatDateRange,
  formatMonthDay,
  formatMonthLabel,
  formatRelative,
  formatShortDate,
  formatWeekLabel,
  makeDate,
  monthNameCN,
  monthOf,
  reportKeyLabel,
  reportKindLabel,
  shanghaiDay,
  shiftMonth,
  weekdayIndex,
  weekdayOf
} from '../src/shared/format'
import { itemIdFromUrl, storyIdFromUrl } from '../src/shared/links'
import { decodeEntities } from '../src/shared/html'
import { LEADERBOARD_BOARDS, leaderboardPath, parseLeaderboard } from '../src/shared/leaderboard'
import {
  dailyStats,
  groupReportsByMonth,
  issueNumber,
  periodicalHighlights,
  periodicalLead,
  periodicalStats,
  toReportDetail,
  toReportEntry,
  yearIssueCount
} from '../src/shared/report'
import {
  makeSaved,
  savedFromArticle,
  savedFromItem,
  savedFromStory,
  savedFromTopic,
  savedKey,
  savedKeySet,
  savedKindLabel,
  sortSaved
} from '../src/shared/saved'
import { SIGNAL_SEGMENTS, findNewTopEntries, itemSignal, signalLevel, topicSignal } from '../src/shared/signal'
import type { HotTopic, Item, Story, UpdateState } from '../src/shared/types'
import {
  compareVersion,
  isNewerVersion,
  normalizeVersion,
  updateBusy,
  updateNeedsAttention,
  updateStatusText
} from '../src/shared/update'

let passed = 0
let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`✗ ${name}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`)
  }
}

/* ---------------------------------------------------------- 信号量化 */

check('signalLevel: 0 → 空槽', signalLevel(0, 12), 0)
check('signalLevel: null → 空槽', signalLevel(null, 12), 0)
check('signalLevel: 负数 → 空槽', signalLevel(-3, 12), 0)
check('signalLevel: NaN → 空槽', signalLevel(Number.NaN, 12), 0)
check('signalLevel: 有值至少 1 格', signalLevel(0.4, 12), 1)
check('signalLevel: 满值 = 满格', signalLevel(12, 12), SIGNAL_SEGMENTS)
check('signalLevel: 超满值封顶', signalLevel(999, 12), SIGNAL_SEGMENTS)
check('signalLevel: 一半', signalLevel(6, 12), 4)
check('signalLevel: 100 分制 94 分', signalLevel(94, 100), 8)
check('signalLevel: 100 分制 66 分', signalLevel(66, 100), 5)

check('topicSignal: 13 家信源', topicSignal({ sourceCount: 13 }), 8)
check('topicSignal: 1 家信源', topicSignal({ sourceCount: 1 }), 1)

check('itemSignal: 无评分 → 空槽', itemSignal(null), 0)
check('itemSignal: 94 分', itemSignal(94), 8)

/* ------------------------------------------------------ 新热点判定 */

function topic(id: string, rank: number): HotTopic {
  return {
    rank,
    id,
    title: `t-${id}`,
    source: { name: 's' },
    links: {},
    sourceCount: 1,
    signalCount: 1,
    participantCount: 1,
    sourceNames: [],
    latestAt: '2026-10-09T00:00:00.000Z'
  }
}

check('首次拿到数据不算"新热点"', findNewTopEntries(null, [topic('a', 1)], 3), [])
check('空的历史也不触发', findNewTopEntries([], [topic('a', 1)], 3), [])
check(
  '新条目进前三才算',
  findNewTopEntries([topic('a', 1)], [topic('a', 1), topic('b', 2), topic('c', 7)], 3).map((t) => t.id),
  ['b']
)
check(
  '掉出前三的老条目不算新的',
  findNewTopEntries([topic('c', 7)], [topic('a', 1), topic('c', 7)], 3).map((t) => t.id),
  ['a']
)
check('没有新条目时为空', findNewTopEntries([topic('a', 1), topic('b', 2)], [topic('a', 1), topic('b', 2)], 3), [])

/* ---------------------------------------------------------- 时间格式 */

const now = new Date('2026-10-09T04:00:00.000Z') // 北京时间 12:00

check('刚刚', formatRelative('2026-10-09T03:59:40.000Z', now), '刚刚')
check('分钟前', formatRelative('2026-10-09T03:42:00.000Z', now), '18 分钟前')
check('小时前', formatRelative('2026-10-09T01:00:00.000Z', now), '3 小时前')
check('昨天带时刻', formatRelative('2026-10-08T06:20:00.000Z', now), '昨天 14:20')
check('更早只给日期', formatRelative('2026-10-06T06:20:00.000Z', now), '10-06')
check('解析不了给空串', formatRelative('not-a-date', now), '')
check('null 给空串', formatRelative(null, now), '')

check('时钟按北京时间', formatClock('2026-10-09T04:04:00.000Z'), '12:04')
check('短日期', formatMonthDay('2026-10-09T04:04:00.000Z'), '10-09')
check('坏值走占位', formatMonthDay(null), '--')

check('小数字原样', formatCount(999), '999')
check('千位缩写', formatCount(1234), '1.2k')
check('整千不留小数点', formatCount(2000), '2k')

/* ---------------------------------------------------------- 分类兜底 */

check('已知分类', categoryLabel('ai-models'), '模型')
check('未知分类不丢弃', categoryLabel('something-new'), '其它')
check('空分类', categoryLabel(null), '其它')

/* ---------------------------------------------------------- 版本比较 */

check('去 v 前缀', normalizeVersion('v0.2.0'), '0.2.0')
check('去空白', normalizeVersion('  1.2.3  '), '1.2.3')
check('空值给空串', normalizeVersion(null), '')

check('新版本更大', compareVersion('0.2.0', '0.1.0'), 1)
check('旧版本更小', compareVersion('0.1.0', '0.2.0'), -1)
check('同版本相等', compareVersion('1.0.0', '1.0.0'), 0)
// 字符串比较在这一组上会翻车（"0.6.10" < "0.6.9"），必须是数值比较
check('两位段按数值比', compareVersion('0.6.10', '0.6.9'), 1)
check('缺位补 0', compareVersion('1.2', '1.2.0'), 0)
check('带 v 前缀照样比', compareVersion('v0.3.0', '0.2.9'), 1)

check('预发布小于同版正式版', compareVersion('0.7.0-beta.1', '0.7.0'), -1)
check('正式版大于同版预发布', compareVersion('0.7.0', '0.7.0-beta.1'), 1)
check('预发布段数少更小', compareVersion('1.0.0-alpha', '1.0.0-alpha.1'), -1)
check('预发布数字段按数值比', compareVersion('1.0.0-alpha.2', '1.0.0-alpha.10'), -1)
check('预发布字母段按字典序', compareVersion('1.0.0-alpha', '1.0.0-beta'), -1)
check('数字段小于字母段', compareVersion('1.0.0-1', '1.0.0-alpha'), -1)

check('有新版本', isNewerVersion('0.2.0', '0.1.0'), true)
check('同版本不算新', isNewerVersion('0.1.0', '0.1.0'), false)
check('旧版本不算新', isNewerVersion('0.1.0', '0.2.0'), false)

/* ---------------------------------------------------------- 更新状态文案 */

function updateState(patch: Partial<UpdateState>): UpdateState {
  return {
    status: 'idle',
    current: '0.2.0',
    latest: '',
    percent: 0,
    message: '',
    checkedAt: 0,
    notes: '',
    canDownload: false,
    ...patch
  }
}

check('未检查文案', updateStatusText(updateState({ status: 'idle' })), '尚未检查更新')
check('最新文案', updateStatusText(updateState({ status: 'latest' })), '已是最新版本')
check(
  '发现新版文案',
  updateStatusText(updateState({ status: 'available', latest: '0.3.0' })),
  '发现新版本 0.3.0'
)
check(
  '下载进度取整',
  updateStatusText(updateState({ status: 'downloading', latest: '0.3.0', percent: 44.6 })),
  '正在下载 45%'
)
check(
  '进度越界夹紧',
  updateStatusText(updateState({ status: 'downloading', percent: 140 })),
  '正在下载 100%'
)
check(
  '已就绪文案',
  updateStatusText(updateState({ status: 'downloaded', latest: '0.3.0' })),
  '新版本 0.3.0 已就绪'
)
check(
  '错误优先用 message',
  updateStatusText(updateState({ status: 'error', message: '网络不可达，稍后再试' })),
  '网络不可达，稍后再试'
)
check(
  '不支持时给出原因',
  updateStatusText(updateState({ status: 'unsupported', message: '免安装版：请到发布页下载新版本' })),
  '免安装版：请到发布页下载新版本'
)

check('available 需要关注', updateNeedsAttention('available'), true)
check('downloaded 需要关注', updateNeedsAttention('downloaded'), true)
check('latest 不需要关注', updateNeedsAttention('latest'), false)
check('checking 算忙', updateBusy('checking'), true)
check('downloading 算忙', updateBusy('downloading'), true)
check('idle 不算忙', updateBusy('idle'), false)

/* ---------------------------------------------------------- 报告期号格式 */

check('日报期号', formatDateLabel('2026-10-09'), '10 月 9 日')
check('月报期号', formatMonthLabel('2026-09'), '2026 年 9 月')
check('周报期号', formatWeekLabel('2026-W40'), '第 40 周')
check('周报期号去前导零', formatWeekLabel('2026-W09'), '第 9 周')
check('期号认不出来就原样返回', formatWeekLabel('nonsense'), 'nonsense')
check('日期区间', formatDateRange('2026-09-28', '2026-10-04'), '09.28 – 10.04')
check('日期区间缺一半', formatDateRange('2026-09-28', null), '09.28')
check('日期区间全缺', formatDateRange(null, null), '')

check(
  '三种报告的中文名',
  [reportKindLabel('daily'), reportKindLabel('weekly'), reportKindLabel('monthly')],
  ['日报', '周报', '月报']
)
check('未知报告类型不崩', reportKindLabel('yearly'), '报告')
check(
  '期号标题按类型走',
  [
    reportKeyLabel('daily', '2026-10-09'),
    reportKeyLabel('weekly', '2026-W40'),
    reportKeyLabel('monthly', '2026-09')
  ],
  ['10 月 9 日', '第 40 周', '2026 年 9 月']
)

/* ---------------------------------------------------------- 链接识别 */

check('抠出条目 id', itemIdFromUrl('https://aihot.news/items/abc123'), 'abc123')
check('旧域名的条目链接照样认', itemIdFromUrl('https://aihot.virxact.com/items/xyz789'), 'xyz789')
check('条目链接里没有 id 时给 null', itemIdFromUrl('https://aihot.news/'), null)
check('空值给 null', itemIdFromUrl(null), null)

check(
  '抠出事件 id',
  storyIdFromUrl('https://aihot.news/story/94903954-cf87-48d8-89a6-eff5deefeaa0'),
  '94903954-cf87-48d8-89a6-eff5deefeaa0'
)
check(
  '旧域名的事件链接照样认',
  storyIdFromUrl('https://aihot.virxact.com/story/5b6feca7-bb87-4686-9981-2b2c3e19f731'),
  '5b6feca7-bb87-4686-9981-2b2c3e19f731'
)
check('条目链接不是事件链接', storyIdFromUrl('https://aihot.news/items/abc'), null)

/* ---------------------------------------------------------- 报告规范化 */

/*
 * 三种报告在 API 里是三套形状（日报有 lead/flashes、周报月报有 headline/overview），
 * 这组断言要保证它们被翻成同一个 ReportDetail —— 界面共用一套版式靠的就是这个。
 */

const daily = toReportDetail('daily', {
  date: '2026-10-09',
  generatedAt: '2026-10-09T00:00:15.496Z',
  links: { aihot: 'https://aihot.news/daily/2026-10-09' },
  lead: { title: '头条标题', leadParagraph: '头条正文。' },
  sections: [
    { label: '模型发布', items: [{ title: 'A', summary: 's', source: { name: 'X' }, links: {} }] }
  ],
  flashes: [{ title: '快讯一', source: { name: 'Y' }, links: {} }]
})
check('日报期号取自 date', daily?.key, '2026-10-09')
check('日报标题回退到头条', daily?.headline, '头条标题')
check('日报有头条', daily?.lead?.title, '头条标题')
check('日报没有综述字段', daily?.overview, null)
check('日报分栏', daily?.sections.map((s) => s.label), ['模型发布'])
check('分栏没有小结时补 null', daily?.sections[0]?.summary, null)
check('日报快讯', daily?.flashes.map((f) => f.title), ['快讯一'])

const weekly = toReportDetail('weekly', {
  week: '2026-W40',
  periodStart: '2026-09-28',
  periodEnd: '2026-10-04',
  headline: '周报标题',
  overview: '本周综述。',
  sections: [
    {
      label: '行业动态',
      summary: '分栏小结。',
      items: [{ title: 'B', source: { name: 'Z' }, links: {} }]
    }
  ]
})
check('周报期号取自 week', weekly?.key, '2026-W40')
check('周报有周期区间', [weekly?.periodStart, weekly?.periodEnd], ['2026-09-28', '2026-10-04'])
check('周报有综述', weekly?.overview, '本周综述。')
check('周报没有头条', weekly?.lead, null)
check('分栏小结被保留', weekly?.sections[0]?.summary, '分栏小结。')

const monthly = toReportDetail('monthly', { month: '2026-09', headline: '月报标题', sections: [] })
check('月报期号取自 month', monthly?.key, '2026-09')
check('没有分栏时给空数组', monthly?.sections, [])

check('缺期号视为非法', toReportDetail('daily', { headline: '没有 date' }), null)
check(
  '空分栏被丢掉',
  toReportDetail('daily', { date: '2026-10-09', sections: [{ label: '空栏', items: [] }] })?.sections,
  []
)
check('条目的来源缺名字时兜底', toReportDetail('daily', {
  date: '2026-10-09',
  sections: [{ label: 'x', items: [{ title: 'no-source' }] }]
})?.sections[0]?.items[0]?.source.name, '未知来源')

check('归档条目取日报日期和 leadTitle', toReportEntry('daily', { date: '2026-10-08', leadTitle: '归档头条' }), {
  key: '2026-10-08',
  periodStart: null,
  periodEnd: null,
  generatedAt: null,
  headline: '归档头条',
  links: {}
})
check('归档条目缺期号返回 null', toReportEntry('weekly', { headline: 'nope' }), null)

/* ---------------------------------------------------------- Codex 事件 */

const codexRaw = toCodexEvent({
  id: 'e1',
  type: 'reset_credit',
  label: '发重置卡',
  displayLabel: '重置卡发放',
  status: 'confirmed',
  title: '重置卡已发放',
  scope: '所有付费订阅',
  createdAt: '2026-10-08T03:19:17.000+08:00',
  confirmedAt: '2026-10-08T11:44:55.000+08:00',
  presentation: { audienceZh: '所有付费账户', productsZh: 'Codex、ChatGPT Work' },
  schedule: { label: '北京时间预计 10月8日 15:00 前' },
  posts: [{ id: 'p1', publishedAt: '2026-10-08T11:44:55.000+08:00', stage: '确认发卡', text: '中文', url: 'https://x.com/a/1' }]
})
check('audience 从 presentation 里提到顶层', codexRaw?.audience, '所有付费账户')
check('products 同样提到顶层', codexRaw?.products, 'Codex、ChatGPT Work')
check('schedule 只取那句人话', codexRaw?.scheduleLabel, '北京时间预计 10月8日 15:00 前')
check('推文带上原推地址', codexRaw?.posts[0]?.url, 'https://x.com/a/1')
check('fullText 缺失时退到 text', codexRaw?.posts[0]?.fullText, '中文')

check('缺 id 视为非法', toCodexEvent({ title: '没有 id' }), null)
check('缺 presentation 时给 null', toCodexEvent({ id: 'e9' })?.audience, null)
check('缺 url 给 null', toCodexEvent({ id: 'e9' })?.posts, [])

/*
 * 四态。这一组是整条 Codex 线的地基 —— 界面上每一个记号（格子颜色、
 * 卡片行首、统计口径）都从这里出来。
 */
const announced = toCodexEvent({
  id: 'a',
  status: 'announced',
  schedule: { from: '2026-10-08T15:00:00.000+08:00' }
})
const confirmed = toCodexEvent({ id: 'b', status: 'confirmed' })
const inferred = toCodexEvent({
  id: 'c',
  status: 'confirmed',
  presentation: { timeInferred: true }
})

const NOW = Date.parse('2026-10-09T09:00:00.000+08:00')
check('已宣布且时间到点 → 应已生效', announced ? codexState(announced, NOW) : null, 'due')
check('已宣布但还没到点 → 等待生效', announced ? codexState(announced, Date.parse('2026-10-08T14:00:00.000+08:00')) : null, 'waiting')
check('官方确认 → 已生效', confirmed ? codexState(confirmed, NOW) : null, 'confirmed')
check('确认了但时间是推算的 → 时间未明确', inferred ? codexState(inferred, NOW) : null, 'likely')
check('四态各有中文说法', ['confirmed', 'likely', 'due', 'waiting'].map((s) => codexStateText(s as never)), [
  '已生效',
  '已生效 · 时间未明确',
  '应已生效',
  '等待生效'
])

/*
 * 没有 schedule 也没有 estimate 时，plannedAt 必须是 null —— 只有一条
 * "有人看到了"的报道，那件事并没有承诺生效时间，不能当成到点就生效。
 */
const noPlan = toCodexEvent({ id: 'd', status: 'announced', presentation: { reportedAt: '2026-10-01T00:00:00.000+08:00' } })
check('只说被报道过，不算承诺了时间', noPlan?.plannedAt, null)
check('没承诺时间的预告永远是等待生效', noPlan ? codexState(noPlan, NOW) : null, 'waiting')
check('但落点时刻仍然有（报道时刻兜底）', noPlan?.day, '2026-10-01')

/* ---------------------------------------------------------- 落点日期 */

const instants = toCodexEvent({
  id: 'e2',
  status: 'confirmed',
  // 北京时间 23:30 —— UTC 还是前一天，直接 slice(0,10) 会差一天
  confirmedAt: '2026-10-07T23:30:00.000+08:00'
})
check('落点取北京日期，不按时区切字符串', instants?.day, '2026-10-07')
check('shanghaiDay 对 UTC 时刻同样换算', shanghaiDay('2026-10-07T16:00:00.000Z'), '2026-10-08')
check('落点时刻原样保留', instants?.at, '2026-10-07T23:30:00.000+08:00')

/* ---------------------------------------------------------- 顶部四项统计 */

/** 造一次额度重置 */
function resetOn(day: string, at = `${day}T12:00:00.000+08:00`) {
  return toCodexEvent({ id: `r-${at}`, type: 'direct_reset', status: 'confirmed', confirmedAt: at })!
}

const history = [
  resetOn('2026-10-07'),
  // 6 点那次：不是整点，用来验证间隔按时刻算而不是按整天算
  resetOn('2026-10-04', '2026-10-04T06:00:00.000+08:00'),
  resetOn('2026-10-01'),
  resetOn('2026-09-28'),
  toCodexEvent({ id: 'c1', type: 'reset_credit', status: 'confirmed', confirmedAt: '2026-10-08T11:00:00.000+08:00' })!,
  // 还没到点的那次不计入"重置了多少次"
  toCodexEvent({ id: 'w1', type: 'direct_reset', status: 'announced', schedule: { from: '2026-11-01T15:00:00.000+08:00' } })!
]

const stats = codexStats(history, '2026-10-09', NOW)
check('近 90 天额度重置：没到点的不算', stats.reset90, 4)
check('近 90 天发重置卡', stats.credit90, 1)
check('本月额度重置', stats.monthReset, 3)
check('本月发重置卡', stats.monthCredit, 1)
/*
 * 间隔中位数：三条间隔 3 天 / 2.75 天 / 3.25 天，中位 3。
 * 若按整天算，2.75 会变 3、3.25 会变 3，中位还是 3 —— 差别在这儿看不出来，
 * 所以下面单独造一组来钉住"按时刻算"。
 */
check('间隔中位数', stats.medianGap, 3)

const skew = [
  resetOn('2026-10-01', '2026-10-01T00:30:00.000+08:00'),
  resetOn('2026-10-02', '2026-10-02T20:30:00.000+08:00')
]
// 精确间隔 = 1.83 天 → 1.8；按整天算会是 1.0
check('间隔按精确时刻算，不按整天', codexStats(skew, '2026-10-09', NOW).medianGap, 1.8)

const outside = [...history, resetOn('2026-07-11')]
check('90 天窗口外的重置不计入次数', codexStats(outside, '2026-10-09', NOW).reset90, 4)
check(
  '但"上次重置"不受窗口限制 —— 它就是最近一次',
  codexStats([resetOn('2026-07-11')], '2026-10-09', NOW).lastResetDay,
  '2026-07-11'
)
check('一次都没有时给 null', codexStats([], '2026-10-09', NOW).medianGap, null)
check('一次都没有时上次重置也是 null', codexStats([], '2026-10-09', NOW).lastResetDay, null)

/* ---------------------------------------------------------- 月历 */

const cal = codexCalendar(history, '2026-10', NOW)
check('月历整周对齐（10月1日是周四 → 前面 3 个空格）', cal.findIndex((c) => c.day?.day === '2026-10-01'), 3)
check('月历总格数是 7 的倍数', cal.length % 7, 0)
check('10 月里 4 天格子有记录', cal.filter((c) => c.day?.marked).length, 4)
/*
 * 没记录的日子也占格 —— 日历得先像张日历。早先这里返回的是 null，
 * 界面就只剩有记录的几个数字，"今天是几号"都看不出来。
 */
check('没有记录的日子也占格', cal.filter((c) => c.day !== null).length, 31)
check('没记录的日子不带标记', cal.find((c) => c.day?.day === '2026-10-05')?.day?.marked, false)
check('没记录的日子计数为 0', cal.find((c) => c.day?.day === '2026-10-05')?.day?.resets, 0)
check('10 月 7 日格子着色取最实的一档', cal.find((c) => c.day?.day === '2026-10-07')?.day?.state, 'confirmed')
check('格子按类型分开计数', cal.find((c) => c.day?.day === '2026-10-08')?.day, {
  day: '2026-10-08',
  date: 8,
  resets: 0,
  credits: 1,
  state: 'confirmed',
  marked: true
})
check('跨月的日期不进这个月', cal.some((c) => c.day?.day === '2026-09-28'), false)

check('月历里预告也占一格（能看见"接下来还有"）', codexCalendar(history, '2026-11', NOW).some((c) => c.day?.day === '2026-11-01'), true)
check('周一起头：10月1日周四落在第 4 列', weekdayIndex(makeDate('2026-10', 1)), 4)

/* ---------------------------------------------------------- 某个月的读数 */

check('某月的重置次数只数已生效的', codexMonthTally(history, '2026-10', NOW), { resets: 3, credits: 1 })
check('没记录的那个月是 0', codexMonthTally(history, '2026-08', NOW), { resets: 0, credits: 0 })
// history 里本来就有 9-28 那次，再加 9-15 一共两次
check('翻到 9 月时读数跟着走', codexMonthTally([...history, resetOn('2026-09-15')], '2026-09', NOW), {
  resets: 2,
  credits: 0
})
check('还没到点的那次不算进月读数', codexMonthTally(history, '2026-11', NOW), { resets: 0, credits: 0 })
check('有记录的天数含预告', codexMonthDaysInUse(history, '2026-11'), 1)

/* ---------------------------------------------------------- 日志分组 */

const grouped = groupCodexByDay(history)
check('按天分组，最近的在前', grouped[0]?.day, '2026-11-01')
check('同一天的事件归到一组', grouped.find((g) => g.day === '2026-10-08')?.events.length, 1)
check('没有日期的事件被丢掉', groupCodexByDay([toCodexEvent({ id: 'x' })!]).length, 0)

const snapshot = toCodexSnapshot({
  today: '2026-10-09',
  checkedAt: '2026-10-09T09:00:00.000+08:00',
  events: [
    { id: 'old', type: 'direct_reset', status: 'confirmed', confirmedAt: '2026-01-01T00:00:00.000+08:00' },
    { id: 'new', type: 'direct_reset', status: 'confirmed', confirmedAt: '2026-10-01T00:00:00.000+08:00' }
  ]
})
check('快照带出服务端的今天', snapshot.today, '2026-10-09')
check('快照里事件按时间倒序', snapshot.events.map((e) => e.id), ['new', 'old'])
check('快照丢掉没有 id 的事件', toCodexSnapshot({ events: [{ title: 'bad' }, { id: 'ok' }] }).events.length, 1)
check('daysFromToday 明天的记录是 +1', daysFromToday('2026-10-10', '2026-10-09'), 1)

/* ---------------------------------------------------------- 日报统计行 */

/*
 * 「件大事」和「约 N 分钟读完」是拿 AIHOT 日报页上印着的数字逐日反推出来的
 * （10-06 / 10-07 / 10-08 三天全中），所以这里也按那三天的形状造数据。
 */
const paper = toReportDetail('daily', {
  date: '2026-10-09',
  lead: { title: '头条标题', leadParagraph: '导语两句话。' },
  sections: [
    {
      label: '模型',
      items: [
        { title: 'a', summary: 'x'.repeat(200), source: { name: 'OpenAI' } },
        { title: 'b', source: { name: 'Anthropic' } }
      ]
    },
    { label: '产品', items: [{ title: 'c', summary: 'y'.repeat(300), source: { name: 'OpenAI' } }] }
  ],
  flashes: [{ title: 'f1', source: { name: '量子位' } }, { title: 'f2', source: { name: '量子位' } }]
})!

const pstats = dailyStats(paper)
check('件大事 = 分栏条目总数（不含快讯）', pstats.bigItems, 3)
check('家信源 = 去重后的信源名', pstats.sources, 3)
check('快讯条数', pstats.flashes, 2)
check('阅读分钟 = 总字数 / 500，四舍五入', pstats.minutes, Math.round((2 + 200 + 3 + 300 + 6) / 500))
check('再短的一期也不写 0 分钟', dailyStats({ lead: null, sections: [], flashes: [] }).minutes, 1)
check('空的一期各项都是 0', dailyStats({ lead: null, sections: [], flashes: [] }).bigItems, 0)

/* ---------------------------------------------------------- 周报 / 月报统计行 */

/*
 * 形状照 2026-W40 来：headline + overview + 分栏（每栏有综述）+ 期界。
 * 真实的 W40 是 4 个分栏 20 条 12 家信源、09-28~10-04，这里缩到两条分栏，
 * 断的是口径本身，不是那个具体的数。
 */
const weekPaper = toReportDetail('weekly', {
  week: '2026-W40',
  headline: '本周头条',
  overview: '综述一段。',
  periodStart: '2026-09-28',
  periodEnd: '2026-10-04',
  sections: [
    {
      label: '模型',
      summary: '模型这一栏。',
      items: [
        { title: 'a', summary: 'x'.repeat(200), source: { name: 'OpenAI' } },
        { title: 'b', source: { name: 'Anthropic' } }
      ]
    },
    { label: '产品', items: [{ title: 'c', summary: 'y'.repeat(300), source: { name: 'OpenAI' } }] }
  ]
})!

const wstats = periodicalStats(weekPaper)
check('周报：件大事 = 分栏条目总数', wstats.bigItems, 3)
check('周报：家信源去重', wstats.sources, 2)
check('周报：天数含首尾两天（09-28~10-04 是 7 天）', wstats.days, 7)
check(
  '周报：阅读分钟按同一个常量算（含分栏名与综述）',
  wstats.minutes,
  Math.round((4 + 5 + 2 + 6 + 1 + 200 + 1 + 2 + 1 + 300) / 500)
)
check(
  '周报：期界缺失时天数为 0，不编一个数',
  periodicalStats({ ...weekPaper, periodStart: null, periodEnd: null }).days,
  0
)
check('月报：满月算 30 天', periodicalStats({
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  headline: '',
  overview: null,
  sections: []
}).days, 30)

/* ---------------------------------------------------------- 期号 */

/*
 * 期号的口径是从站上页面里那份序列化数据核出来的：
 * 周报 2026-W19 → 1 … W40 → 22，月报 2026-05 → 1 … 2026-09 → 5 ——
 * 按年、从最早一期起算。不是 ISO 周次，也不是"最新的算第 1 期"。
 */
const weeklies = ['2026-W40', '2026-W39', '2026-W38', '2026-W01', '2025-W52'].map(
  (week) => toReportEntry('weekly', { week })!
)

check('最早那一期是第 1 期', issueNumber('2026-W01', weeklies), 1)
check('中间某期按位置数', issueNumber('2026-W38', weeklies), 2)
check('最新那一期是第 N 期（不是第 1 期）', issueNumber('2026-W40', weeklies), 4)
check('跨年后重新从 1 数起', issueNumber('2025-W52', weeklies), 1)
check('列表里没有的期号给 0', issueNumber('2026-W41', weeklies), 0)
check('全年期数只数这一年', yearIssueCount('2026', weeklies), 4)
check('月报期号按月份数', issueNumber('2026-08', [
  toReportEntry('monthly', { month: '2026-09' })!,
  toReportEntry('monthly', { month: '2026-08' })!
]), 1)
// 字符串排序会把 "2026-W40" 排到 "2026-W5" 前面，于是 W5 被数成第 2 期；数值排序才是第 1 期
check('没补零的周次也排得对', issueNumber('2026-W5', [
  toReportEntry('weekly', { week: '2026-W40' })!,
  toReportEntry('weekly', { week: '2026-W5' })!
]), 1)

/* ---------------------------------------------------------- 本期看点 */

check(
  '看点取各分栏打头的那一条',
  periodicalHighlights(weekPaper).map((h) => [h.section, h.item.title]),
  [['模型', 'a'], ['产品', 'c']]
)
check('空分栏不占位', periodicalHighlights({
  sections: [{ label: '空的', summary: null, items: [] }]
}).length, 0)

/* ---------------------------------------------------------- 头条 */

/*
 * 周报月报没有日报那种 lead 字段，它们的 headline 就是头条标题，
 * 而"摘要 + 出处"要从第一栏第一条上取。
 */
check('头条用 headline 当标题', periodicalLead(weekPaper)?.title, '本周头条')
check('头条的摘要与出处来自第一栏第一条', periodicalLead(weekPaper)?.item?.title, 'a')
check('两样都没有就不给头条', periodicalLead({ headline: '', sections: [] }), null)
check(
  '只有条目没标题时退回条目标题',
  periodicalLead({
    headline: '',
    sections: [
      {
        label: 'x',
        summary: null,
        items: [{ title: '只有条目', summary: null, source: { name: 's' }, links: {} }]
      }
    ]
  })?.title,
  '只有条目'
)
check(
  '头条条目为空时仍给标题、摘要留空',
  [periodicalLead({ headline: '有标题', sections: [] })?.title, periodicalLead({ headline: '有标题', sections: [] })?.item],
  ['有标题', null]
)

/* ---------------------------------------------------------- 往期归档 */

const archive = groupReportsByMonth(
  [
    toReportEntry('daily', { date: '2026-10-09', leadTitle: '9 号' })!,
    toReportEntry('daily', { date: '2026-10-02', leadTitle: '2 号' })!,
    toReportEntry('daily', { date: '2026-09-30', leadTitle: '上月底' })!
  ]
)
check('往期按自然月分组，最近的月在前', archive.map((g) => g.month), ['2026-10', '2026-09'])
check('组内最近的一期在前', archive[0]?.entries.map((e) => e.key), ['2026-10-09', '2026-10-02'])
check('没有日期的条目被丢掉', groupReportsByMonth([
  { key: '', periodStart: null, periodEnd: null, generatedAt: null, headline: '', links: {} }
]).length, 0)

/* ---------------------------------------------------------- 日期小工具 */

/*
 * 纯日期字符串不能丢给 new Date —— 它按 UTC 零点解析，换个时区就显示成前一天。
 * 这几个函数全是给日历和刊头用的，错一天会很显眼。
 */
check('月份加减不跨错年', shiftMonth('2026-01', -1), '2025-12')
check('月份加减连加也不飘', shiftMonth(shiftMonth('2026-10', 1), -1), '2026-10')
check('每月天数：2 月平年', daysInMonth('2026-02'), 28)
check('每月天数：2 月闰年', daysInMonth('2028-02'), 29)
check('每月天数：12 月', daysInMonth('2026-12'), 31)
check('补零到两位', makeDate('2026-10', 3), '2026-10-03')
check('dayOfMonth 去掉前导零', dayOfMonth('2026-10-03'), '3')
check('中文月份名', monthNameCN('2026-10'), '十月')
check('短日期', formatShortDate('2026-10-03'), '10/03')
check('短日期对空值给空串', formatShortDate(null), '')
check('星期几的中文', weekdayOf('2026-10-09'), '星期五')
check('两天的间隔', daysBetween('2026-09-28', '2026-10-02'), 4)
check('同一天间隔为 0', daysBetween('2026-10-09', '2026-10-09'), 0)
check('日报期号读成人话日期', reportKeyLabel('daily', '2026-10-09'), '10 月 9 日')
check('日期链优先级：schedule 最优先', toCodexEvent({
  id: 'chain',
  createdAt: '2026-01-01T00:00:00.000+08:00',
  confirmedAt: '2026-01-05T00:00:00.000+08:00',
  schedule: { from: '2026-01-09T00:00:00.000+08:00' }
})?.at, '2026-01-09T00:00:00.000+08:00')

const ordered = sortCodexEvents([
  toCodexEvent({ id: 'old', createdAt: '2026-01-01T00:00:00Z' })!,
  toCodexEvent({ id: 'new', createdAt: '2026-10-01T00:00:00Z' })!
])
check('事件按时间倒序', ordered.map((e) => e.id), ['new', 'old'])

/* ---------------------------------------------------------- 收藏 */

check('收藏键由类型和 id 拼成', savedKey('item', 'abc'), 'item:abc')
check('不同类别的同一个 id 不冲突', savedKey('story', 'abc') === savedKey('item', 'abc'), false)

const item: Item = {
  id: 'i1',
  title: '标题',
  originalTitle: null,
  summary: '摘要',
  source: { name: '来源' },
  links: { aihot: 'https://aihot.news/items/i1', original: 'https://x.com/a' },
  publishedAt: '2026-10-09T00:00:00Z',
  discoveredAt: '2026-10-09T01:00:00Z',
  category: 'ai-models',
  score: 90,
  selected: true,
  reason: null
}
const savedItem = savedFromItem(item, 1000)
check('资讯收藏用 item id', [savedItem.kind, savedItem.id, savedItem.key], ['item', 'i1', 'item:i1'])
check(
  '资讯收藏存的是内容快照',
  [savedItem.title, savedItem.summary, savedItem.sourceName, savedItem.category],
  ['标题', '摘要', '来源', 'ai-models']
)
check('收藏时间用传入的 now', savedItem.savedAt, 1000)
check('内容时间优先发布时刻', savedItem.at, '2026-10-09T00:00:00Z')

const savedTopic = savedFromTopic(topic('t1', 1), 2000)
check('热榜条目也归到 item（和精选共用 id，不会存成两条）', [savedTopic.kind, savedTopic.key], ['item', 'item:t1'])

const story: Story = {
  publicId: 's1',
  title: '事件标题',
  status: 'active',
  sourceCount: 5,
  reportCount: 9,
  firstReportAt: null,
  latestAt: '2026-10-08T00:00:00Z',
  latest: '最新进展',
  digest: null,
  digestUpdatedAt: null,
  links: { aihot: 'https://aihot.news/story/s1' },
  reports: [],
  related: []
}
const savedStory = savedFromStory(story, 3000)
check('事件收藏用 publicId 当 id', [savedStory.kind, savedStory.id], ['story', 's1'])
check('事件收藏把最新进展当摘要', savedStory.summary, '最新进展')
check('事件收藏用信源数说明规模', savedStory.sourceName, '5 家信源')

// 报告条目和事件里的单篇报道都没有 id 字段，只能从站内链接里抠
const fromLink = savedFromArticle({
  title: '条目',
  summary: null,
  source: { name: 'S' },
  links: { aihot: 'https://aihot.news/items/report1' },
  publishedAt: null
})
check('报告条目从链接抠出 id 并归到 item', [fromLink.kind, fromLink.id], ['item', 'report1'])
check(
  '抠不到 id 时退回标题（至少还能去重）',
  savedFromArticle({ title: '没有链接的条目', summary: null, source: { name: 'S' }, links: {} }).id,
  '没有链接的条目'
)

const keySet = savedKeySet([savedItem, savedStory])
check(
  'key 集合用来查"这一条收没收藏过"',
  [keySet.has('item:i1'), keySet.has('story:s1'), keySet.has('item:nope')],
  [true, true, false]
)
check(
  '收藏时间倒序',
  sortSaved([savedItem, savedStory, savedFromItem(item, 500)]).map((e) => e.savedAt),
  [3000, 1000, 500]
)
check('排序不改动原数组', savedItem.savedAt, 1000)
check('类型标签', [savedKindLabel('item'), savedKindLabel('story')], ['资讯', '事件'])
check('未知类型兜底成资讯', savedKindLabel('whatever'), '资讯')
check('makeSaved 把没给的字段补 null', makeSaved({ kind: 'item', id: 'x', title: 't' }).summary, null)

/* ---------------------------------------------------------- HTML 实体解码 */

/*
 * 两个解析器（更新日志 / 模型榜）共用的底座。
 *
 * 这里有一个曾能把整条解析链掀翻的输入：越界的数字实体 ——
 * String.fromCodePoint 对 > 0x10FFFF 的码点直接抛 RangeError。
 * 解析外部页面的函数不该有这种能把调用方吵醒的输入：认不出来就原样保留。
 */
check('常规实体照常解码', decodeEntities('&amp; &#65; &hellip;'), '& A …')
check('十六进制实体', decodeEntities('&#x4E2D;'), '中')
check('认不出的命名实体原样保留', decodeEntities('&unknownthing;'), '&unknownthing;')
check('越界的十进制实体原样保留，不抛异常', decodeEntities('&#999999999;'), '&#999999999;')
check('越界的十六进制实体原样保留', decodeEntities('&#x110000;'), '&#x110000;')
check('零实体原样保留', decodeEntities('&#0;'), '&#0;')
check('最大合法码点照常解码', decodeEntities('&#x10FFFF;'), String.fromCodePoint(0x10ffff))

/* ---------------------------------------------------------- 更新日志解析 */

/*
 * 这段 HTML 是从真实的 /changelog 页面上摘下来的结构，缩到最小可辨识形态。
 * 它没有 JSON 接口，只能解析页面（见 shared/changelog.ts），所以这组断言
 * 是"页面改版时我们能不能立刻发现"的唯一防线。
 */
const changelogHtml = `
<main><div><section id="d-2026-10-06" class="card"><h2 class="flex items-baseline"><time dateTime="2026-10-06" class="text-[18px]">2026 年 10 月 6 日</time><span class="text-[12px]">周二</span></h2><ol>
<li class="grid gap-x-8"><div class="flex"><span class="mono block text-[12.5px]">16:32</span><span class="inline-flex"><span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>更新</span></div><article><h3 class="text-[15px]">模型榜新增斩杀线</h3><p class="mt-2">每个价位谁最强一眼看清。</p><ul class="mt-2 space-y-1"><li class="flex gap-2"><span class="mt-[11px] size-1"></span><span><b class="font-semibold">价格按真实用法算</b>：命中缓存的价格也算。</span></li><li class="flex"><span class="size-1"></span><span>第二点。</span></li></ul></article></li>
<li class="grid"><div><span class="mono block">14:22</span><span><span class="size-1.5 rounded-full bg-ok" aria-hidden="true"></span>优化</span></div><article><h3>事件页可以倒着读</h3><p>进展也能从最早一条读起 &amp; 保留了选择。</p></article></li>
<li class="grid gap-x-8"><div><span class="mono block text-[12.5px]">11:05</span><span><span class="size-1.5 rounded-full bg-ink-4" aria-hidden="true"></span>下线</span></div><article><h3>旧版订阅入口下线</h3><p>不再支持。</p></article></li>
</ol></section><section id="d-2026-10-04" class="card"><h2><time dateTime="2026-10-04">2026 年 10 月 4 日</time><span>周日</span></h2><ol>
<li class="grid"><div><span class="mono block">20:24</span><span><span class="size-1.5 rounded-full bg-ok" aria-hidden="true"></span>优化</span></div><article><h3>排名算法升级</h3><p>打分算法整套重写。</p></article></li>
</ol></section></div></main>
`

const days = parseChangelog(changelogHtml)
check('解析出两个日期分组', days.map((d) => d.date), ['2026-10-06', '2026-10-04'])
check('星期也取到了', days[0]?.weekday, '周二')
check('第一天三条', days[0]?.entries.length, 3)
check('条目时间', days[0]?.entries.map((e) => e.time), ['16:32', '14:22', '11:05'])
check('条目类型', days[0]?.entries.map((e) => e.kind), ['更新', '优化', '下线'])
/*
 * 色名里**带数字**：站上「下线」的圆点是 `bg-ink-4`。
 * 早先这里的正则是 `bg-[a-z-]+`，抓不到它 —— 而抓不到时会兜底成「更新」，
 * 结果整页 81 条里那一条下线被算进了更新（"更新 37 · 下线 0" vs 站上 36 · 1）。
 * 数字只差一，在页面上几乎看不出来。
 */
check('色名带数字的类型也认得出（bg-ink-4）', days[0]?.entries[2]?.kind, '下线')
check('条目标题', days[0]?.entries[0]?.title, '模型榜新增斩杀线')
check('正文段落', days[0]?.entries[0]?.body, ['每个价位谁最强一眼看清。'])
check(
  '列表项去掉内联标签只留文字',
  days[0]?.entries[0]?.bullets,
  ['价格按真实用法算：命中缓存的价格也算。', '第二点。']
)
check('HTML 实体被解开', days[0]?.entries[1]?.body, ['进展也能从最早一条读起 & 保留了选择。'])
check('没有列表时给空数组', days[0]?.entries[1]?.bullets, [])
check('第二天的条目', days[1]?.entries.map((e) => e.title), ['排名算法升级'])
check('总条数', changelogEntryCount(days), 4)

// 页面结构变了的话必须"认不出来"，而不是解析出一堆半截垃圾
check('空输入', parseChangelog(''), [])
check('换版式后解析不出东西', parseChangelog('<html><body><p>换个版式了</p></body></html>'), [])
check('section 里没有条目', parseChangelog('<section id="d-2026-10-06"><h2>x</h2></section>'), [])
check('非字符串输入不崩', parseChangelog(null as unknown as string), [])

/*
 * 特稿形状：偶尔有一整天就是一篇文章（真实页面上 2026-09-28 的 "AIHOT 2.0"）。
 * 它没有 `<li class="grid">`，只按列表项切的话这一天会被整段丢掉 ——
 * 而它往往正是整份日志里最重的一天。
 *
 * 判据是 `<h2 aria-label="…">`：普通分组的 `<h2>` 装的是日期，没有这个属性。
 * 特稿的标题是画出来的 SVG 字标，元素里没有可读文字，只有 aria-label 留着原文。
 */
const featureHtml = `
<section id="d-2026-09-28" aria-labelledby="f-2026-09-28-1312" class="card @container overflow-hidden"><header class="bg-accent-softer px-5"><div class="flex"><div class="flex items-center gap-2.5 text-[12px] font-semibold tracking-[0.3em] text-accent "><span class="h-[2px] w-6 rounded-full bg-accent" aria-hidden="true"></span>重大更新</div><time dateTime="2026-09-28T13:12+08:00" class="text-[12.5px] text-ink-3">2026 年 9 月 28 日<!-- --> <!-- -->周一<!-- --> · <span class="mono">13:12</span></time></div><h2 id="f-2026-09-28-1312" data-mark="true" aria-label="AIHOT 2.0" class="relative inline-flex"><svg viewBox="0 0 10 10" aria-hidden="true"><g fill="currentColor"><path d="M0 0L1 1"></path></g></svg></h2><p class="mt-5 text-[17px] font-bold">从底层重写：更快的系统</p><p class="mt-3">借助新模型，我们把 AIHOT 从头重写了一遍。</p></header><section class="mx-5 border-t"><h3 class="flex items-baseline gap-3"><span class="num text-[13px] font-bold text-accent">01</span><span class="text-[19px] font-bold">底层：整套系统重新搭了一遍</span></h3><p class="mt-2">一条内容要经过五站。</p></section><section class="mx-5 border-t"><h3 class="flex items-baseline gap-3"><span class="num text-[13px] font-bold text-accent">02</span><span class="text-[19px] font-bold">更快：中位数从 64 毫秒降到 14 毫秒</span></h3><ul><li class="flex gap-2"><span class="size-1"></span><span>首页的骨架屏先出来。</span></li></ul></section></section>
<section id="d-2026-09-27" class="card"><h2><time dateTime="2026-09-27">2026 年 9 月 27 日</time><span>周日</span></h2><ol><li class="grid"><div><span class="mono block">09:00</span><span><span class="size-1.5 rounded-full bg-accent"></span>更新</span></div><article><h3>常规条目还在</h3><p>特稿之后的普通分组不受影响。</p></article></li></ol></section>
`

const featureDays = parseChangelog(featureHtml)
const feature = featureDays[0]?.entries[0]
check('特稿所在的那天被解出来', featureDays.map((d) => d.date), ['2026-09-28', '2026-09-27'])
check('特稿的星期要从 <time> 里面捞', featureDays[0]?.weekday, '周一')
check('特稿时刻', feature?.time, '13:12')
check('特稿分类标签', feature?.kind, '重大更新')
check('特稿标题取 aria-label', feature?.title, 'AIHOT 2.0')
check('特稿导语只取 header 里的三段以内', feature?.body, [
  '从底层重写：更快的系统',
  '借助新模型，我们把 AIHOT 从头重写了一遍。'
])
check('正文段落不会混进导语', feature?.body?.includes('一条内容要经过五站。'), false)
check('小节目录：编号与标题分开，不粘成 "01底层"', feature?.bullets, [
  '01 底层：整套系统重新搭了一遍',
  '02 更快：中位数从 64 毫秒降到 14 毫秒'
])
check('小节里的列表不算目录', feature?.bullets?.includes('首页的骨架屏先出来。'), false)
check('特稿被打上标记', feature?.feature, true)
check('普通条目不带特稿标记', days[0]?.entries[0]?.feature, undefined)
check('特稿也算一条记录', changelogEntryCount(featureDays), 2)

// 认不出来时宁可丢掉，也不要编一条出来
check(
  '有 h2 但没有 aria-label 的段落不当特稿',
  parseChangelog('<section id="d-2026-09-28"><h2><span>2.0</span></h2><p>换成别的写法了</p></section>'),
  []
)

/* ---------------------------------------------------------- 更新日志的类型与索引 */

/*
 * 站上那张「按类型看」的侧卡：**全部 = 四档之和**
 * （实测 81 = 更新 36 + 优化 37 + 公告 7 + 下线 1）。
 *
 * 特稿那天的标签是「重大更新」，而它算进「更新」—— 这一条是从那个等式
 * 反推出来的，不是猜的：把特稿单列成第五档，四个数就加不出「全部」了。
 */
const anyEntry = { time: '16:32', kind: '更新', title: 'x', body: [], bullets: [] }
check('特稿的"重大更新"归到"更新"', changelogKind({ ...anyEntry, kind: '重大更新' }), '更新')
check('"新增"也归"更新"', changelogKind({ ...anyEntry, kind: '新增功能' }), '更新')
check('没写类型时按"更新"算', changelogKind({ ...anyEntry, kind: '   ' }), '更新')
check('认不出来的类型原样留着', changelogKind({ ...anyEntry, kind: '下线' }), '下线')

const tallies = changelogKindTally(featureDays)
check(
  '四档全列、顺序固定（某档为 0 也不隐藏）',
  tallies.map((t) => t.key),
  ['更新', '优化', '公告', '下线']
)
check('特稿算进"更新"那一档', tallies.map((t) => t.count), [2, 0, 0, 0])
check(
  '四档之和等于总条数',
  tallies.reduce((sum, t) => sum + t.count, 0),
  changelogEntryCount(featureDays)
)

const monthTally = changelogMonthTally([...days, ...featureDays])
check('按月倒序', monthTally.map((m) => m.key), ['2026-10', '2026-09'])
check('每个月的条数', monthTally.map((m) => m.count), [4, 2])

const onlyTune = filterChangelog(days, '优化', null)
check('按类型筛，筛空的日期整天拿掉', onlyTune.map((d) => d.date), ['2026-10-06', '2026-10-04'])
check('筛完那天只剩命中的条目', onlyTune[0]?.entries.map((e) => e.kind), ['优化'])
check('类型和月份叠加', filterChangelog(days, '优化', '2026-10-04').map((d) => d.date), ['2026-10-04'])
check('筛不到就是空', filterChangelog(days, '公告', null), [])
check('"下线"筛得出来', filterChangelog(days, '下线', null).map((d) => d.date), ['2026-10-06'])
check('不筛时原样返回', filterChangelog(days, null, null).length, 2)

/* ---------------------------------------------------------- 模型榜解析 */

/*
 * 又是"解析页面"：模型榜也没有 JSON 接口 —— /api/v1/models、/leaderboard、
 * /rankings 等六个候选路径全是 404。
 *
 * 这段 HTML 从真实的 /leaderboard 上摘下来，缩到最小可辨识形态，
 * 字段一个不少（名次 / 名称 / 厂商 / 上线日期 / 评测证据 / 三个价格 / 评分），
 * 另外带一个待排名的，和几个专门用来试边界的东西：
 *   - `<!-- -->` 到处都是（React 输出相邻文本节点的分隔符），不去掉就取不到数
 *   - 厂商印两遍，窄屏那行混了上线日期，只能要宽屏那行
 *   - 评分只写在 aria-label 里，两个 <strong> 本身不可靠
 */
const leaderboardHtml = `
<main><div><p class="text-[13.5px] text-ink-2">只用第三方评测机构给所有模型统一跑的成绩，换算到同一条能力刻度上：编程 40%、科研 20%。</p><p class="num text-[12px] text-ink-4">35<!-- --> 项评测<span class="mx-2">·</span>7<!-- --> 家机构<span class="mx-2">·</span>10/09 14:06<!-- --> 更新</p><section class="card"><div><h2 id="lb-board-title" class="text-[16px] font-bold text-ink">综合榜<span class="mono ml-2 text-[11px]">30 个模型</span></h2></div><table><caption>当前展示 30 个模型</caption><tbody><tr data-slug="claude-opus-5-5" class="group cursor-pointer border-b"><td class="py-2.5"><span class="mono text-[13px] text-ink-4">01</span></td><td class="px-2"><span class="flex items-center gap-3"><span class="inline-flex"><img src="/model-providers/anthropic.svg" alt="" /></span><span class="min-w-0"><span class="flex flex-wrap"><a href="/leaderboard/claude-opus-5-5" data-discover="true"><strong class="text-[15px] font-[650] leading-[21px] text-ink">Claude Opus 5.5</strong></a></span><small class="hidden text-[12px] leading-[18px] text-ink-4 lg:block">Anthropic</small><small class="block truncate text-[12px] text-ink-4 lg:hidden">Anthropic<!-- --> · <span class="num">9月22日</span>上线</small></span></span></td><td class="mono hidden px-3 text-[12px] text-ink-3 lg:table-cell"><time dateTime="2026-09-22">2026-09-22</time></td><td class="hidden px-3 lg:table-cell"><span class="num block text-[13px] text-ink-2">33<!-- --> 项评测</span><span class="block text-[11px] text-ink-4">覆盖 <!-- -->96<!-- -->%</span></td><td class="mono hidden px-3 text-[14.5px] font-medium text-ink lg:table-cell">¥1.34</td><td class="mono hidden px-3 text-[14.5px] font-medium text-ink lg:table-cell">¥26.81</td><td class="mono hidden px-3 text-[14.5px] font-medium text-ink lg:table-cell">¥134.05</td><td class="py-2.5 text-right"><span class="block"><strong class="mono block text-[24px] text-accent" aria-label="Claude Opus 5.5 AIHOT 评分 73.9">73.9</strong></span></td></tr></tbody></table></section><section class="card"><div><h2 id="lb-pending-title" class="text-[16px] font-bold text-ink">暂不排名<span class="mono ml-2 text-[11px]">1 个模型</span></h2><p class="mt-1 text-[12.5px] leading-relaxed text-ink-3">这些模型已有评分，但评测还不够宽。</p></div><ul class="divide-y border-t"><li><a class="group flex items-center gap-3" href="/leaderboard/ember-1" data-discover="true"><span class="inline-flex"><img src="/model-providers/fireworks.svg" alt="" /></span><span class="min-w-0 flex-1"><span class="block truncate text-[14.5px] font-[650] text-ink">ember-1</span><small class="block truncate text-[12px] text-ink-4">目前只有一家评测机构的成绩<!-- --> · <!-- -->8<!-- --> 项评测</small></span><span class="mono text-[18px] font-semibold text-ink-2">61.2</span></a></li></ul></section></div></main>
`

const board = parseLeaderboard(leaderboardHtml, 'all')
const top = board?.rows[0]
check('榜名去掉后面的计数', board?.title, '综合榜')
check(
  '口径说明照抄站上那句话',
  board?.note,
  '只用第三方评测机构给所有模型统一跑的成绩，换算到同一条能力刻度上：编程 40%、科研 20%。'
)
check('评测面：几项评测 / 几家机构', [board?.evidence, board?.orgs], [35, 7])
check('更新时间', board?.updatedAt, '10/09 14:06')
check('解出一行', board?.rows.length, 1)
check('名次', top?.rank, 1)
check('slug', top?.slug, 'claude-opus-5-5')
check('模型名', top?.name, 'Claude Opus 5.5')
check('厂商只取宽屏那一行（窄屏那行混了上线日期）', top?.vendor, 'Anthropic')
check('上线日期从 <time> 上取', top?.releasedOn, '2026-09-22')
check('评测项数', top?.evidence, 33)
check('覆盖率', top?.coverage, 96)
check(
  '三个价格按 缓存 / 输入 / 输出 归位',
  [top?.priceCache, top?.priceInput, top?.priceOutput],
  ['¥1.34', '¥26.81', '¥134.05']
)
check('评分只认 aria-label', top?.score, 73.9)
check('待排名的模型', board?.pending.map((p) => p.name), ['ember-1'])
check('待排名的理由', board?.pending[0]?.reason, '目前只有一家评测机构的成绩 · 8 项评测')
check('待排名的分数', board?.pending[0]?.score, 61.2)
check('待排区的说明', board?.pendingNote, '这些模型已有评分，但评测还不够宽。')

// 榜单满员时站上会把整个待排区拿掉 —— 那不是错误，不该连带影响主表
const noPending = leaderboardHtml.replace(
  /<section class="card"><div><h2 id="lb-pending-title"[\s\S]*?<\/section>/,
  ''
)
check('没有待排区时给空数组', parseLeaderboard(noPending, 'all')?.pending, [])
check('没有待排区不影响主表', parseLeaderboard(noPending, 'all')?.rows.length, 1)

// 页面没印的字段要给 null，不能给 0 —— "没印"和"真的是 0"在界面上是两回事
const sparseHtml = `
<h2 id="lb-board-title">编程榜<span class="mono">1 个模型</span></h2>
<table><tbody><tr data-slug="x-one"><td><span class="mono">01</span></td><td><span><a href="/leaderboard/x-one"><strong class="text-[15px] font-[650] text-ink">X One</strong></a></span><small class="hidden text-[12px] lg:block">Acme</small></td><td class="mono hidden"><time dateTime="2026-01-02">2026-01-02</time></td><td class="hidden"><span class="num">9 项评测</span></td><td class="mono hidden">¥3.00</td><td class="mono hidden">¥4.00</td><td class="mono hidden">¥5.00</td><td><strong class="mono" aria-label="X One AIHOT 评分 41.2">41.2</strong></td></tr></tbody></table>
`
const sparse = parseLeaderboard(sparseHtml, 'coding')
check('页面没印覆盖率时给 null（不是 0）', sparse?.rows[0]?.coverage, null)
check('没印覆盖率不影响其它字段', sparse?.rows[0]?.evidence, 9)
check('第二个榜照样解得出', sparse?.title, '编程榜')
check('没有待排区也不报错', sparse?.pending, [])

// 结构变了要"认不出来"，不能给一张半截的表
check('空输入', parseLeaderboard('', 'all'), null)
check('换版式后返回 null', parseLeaderboard('<html><body><p>换版式了</p></body></html>', 'all'), null)
check(
  '有标题但一行都没有 → null',
  parseLeaderboard('<h2 id="lb-board-title">综合榜</h2><table><tbody></tbody></table>', 'all'),
  null
)
check('非字符串输入不崩', parseLeaderboard(null as unknown as string, 'all'), null)

check(
  '五个榜的路径',
  LEADERBOARD_BOARDS.map((b) => b.path),
  [
    '/leaderboard',
    '/leaderboard/category/coding',
    '/leaderboard/category/reasoning',
    '/leaderboard/category/professional',
    '/leaderboard/category/knowledge'
  ]
)
check('认不出的榜名退回综合榜', leaderboardPath('nope'), '/leaderboard')

/*
 * 评分是唯一一个"有可能没印"的小数字段：parseFloat('') 会给 NaN，
 * 而 NaN 会一路穿到界面上、显示成"NaN" —— 必须收成 null，由界面画占位符。
 */
const noScore = parseLeaderboard(sparseHtml.replace(/ aria-label="[^"]*"/, ''), 'coding')?.rows[0]
check('评分解析不到时是 null，不是 NaN', noScore?.score, null)
check('评分缺失不影响这一行本身', noScore?.name, 'X One')

/* ---------------------------------------------------------- 结果 */

console.log(`\n${passed} 项通过${failed > 0 ? `，${failed} 项失败` : ''}`)
if (failed > 0) process.exit(1)
