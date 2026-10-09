/*
 * 数据形状 —— 全部来自 AIHOT 公开 API（https://aihot.news）。
 *
 * 这里刻意只声明我们用到的那部分字段：API 会持续加字段，
 * 客户端少声明一点，将来它加东西时这里不用跟着动。
 * 反过来，凡是"官方说必须容忍未来新值"的字段（category），类型一律放宽成 string。
 */

/* ------------------------------------------------------------ 数据源实体 */

/** 信源（"X：Tibo (@thsottiaux)" 这种） */
export interface SourceRef {
  name: string
}

/** 各种可跳转的地址。original 是第三方原文，aihot 是站内阅读页 */
export interface LinkSet {
  aihot?: string
  original?: string
  /** 热点事件页（只有热榜条目有） */
  story?: string
}

/** 一条资讯。来自 /api/v1/items */
export interface Item {
  id: string
  title: string
  originalTitle: string | null
  summary: string | null
  source: SourceRef
  links: LinkSet
  publishedAt: string | null
  discoveredAt: string
  /** ai-models / ai-products / industry / paper / tip，未来可能有新值 —— 不枚举 */
  category: string | null
  /** 编辑评分 0~100，可能为 null */
  score: number | null
  selected: boolean
  /** 推荐理由（编辑口吻的一句话），只有部分条目有 */
  reason: string | null
}

/** 一个热点。来自 /api/v1/hot-topics */
export interface HotTopic {
  /** 1 起的名次 —— 这是真的排名，不是"编号装饰" */
  rank: number
  id: string
  title: string
  source: SourceRef
  links: LinkSet
  /** 多少个不同信源在说这件事 */
  sourceCount: number
  /** 观测到的信号条数（转发放大后的量） */
  signalCount: number
  /** 去重后的参与者数 */
  participantCount: number
  sourceNames: string[]
  latestAt: string
}

/* ------------------------------------------------------------ 事件（story） */

/**
 * 事件页里的一条报道。来自 /api/v1/stories/{publicId} 的 reports[]。
 * 它比 Item 少几个字段：事件页只负责讲"这件事是怎么被报道的"。
 */
export interface StoryReport {
  id: string
  title: string
  summary: string | null
  source: SourceRef
  /** 首批报道时间可能缺失 */
  publishedAt: string | null
  links: LinkSet
}

/** 相关事件 —— 只给 id 和标题，点进去是另一个事件页 */
export interface StoryRelated {
  publicId: string
  title: string
  relation: string
}

/**
 * 一个事件：热榜条目背后那条"完整的线"。
 *
 * latest 和 digest 是两个不同层次的东西，界面上不要混：
 *   latest —— 一句最新进展（"刚刚发生了什么"）
 *   digest —— AIHOT 写的综述（"整件事是怎么回事"），按空行分段
 */
export interface Story {
  publicId: string
  title: string
  /** active 等，未来可能有新值 —— 不枚举 */
  status: string
  sourceCount: number
  reportCount: number
  firstReportAt: string | null
  latestAt: string | null
  latest: string | null
  digest: string | null
  digestUpdatedAt: string | null
  links: LinkSet
  /** 报道时间线，最新的在前 */
  reports: StoryReport[]
  related: StoryRelated[]
}

/* ------------------------------------------------------------ 报告（日报 / 周报 / 月报） */

export type ReportKind = 'daily' | 'weekly' | 'monthly'

/** 归档列表里的一期。三种报告的 key 形态不同：日期 / ISO 周 / 月份 */
export interface ReportEntry {
  /** 2026-10-09（日报） / 2026-W40（周报） / 2026-09（月报） */
  key: string
  periodStart: string | null
  periodEnd: string | null
  generatedAt: string | null
  headline: string
  links: LinkSet
}

/** 报告正文里的一条（和日报的 DailyBrief 同形，但三种报告共用） */
export interface ReportArticle {
  title: string
  summary: string | null
  source: SourceRef
  links: LinkSet
  publishedAt?: string | null
}

/** 报告的分栏。日报没有 section 级的 summary，周报月报有 */
export interface ReportSection {
  label: string
  summary: string | null
  items: ReportArticle[]
}

/** 一期报告的完整内容。三种报告共用一个形状，界面才能共用一套版式 */
export interface ReportDetail extends ReportEntry {
  kind: ReportKind
  /** 周报月报有，日报没有 */
  overview: string | null
  /** 日报有头条，周报月报没有 */
  lead: { title: string; leadParagraph: string } | null
  sections: ReportSection[]
  /** 日报的快讯；周报月报为空数组 */
  flashes: ReportArticle[]
}

/**
 * 报头下的那行数字。
 *
 * 「件大事」和「约 N 分钟读完」两条是从 AIHOT 的日报页面反推出来、逐日核对过的：
 *   件大事 = 分栏里的条目总数（**不含快讯**，实测 12/12/7 三日全中）
 *   读完    = round(总字数 / 500)，字数取 头条标题+导语 + 各分栏条目的标题+摘要 + 快讯标题
 * 「家信源」是我们自己的口径（去重后的信源名），和站上的「个来源」不是一个算法 ——
 * 站上按**机构**归并（Anthropic 的几个博客算一家），那张映射表在服务端，猜不出来。
 * 所以这里不冒充那个数字，用我们自己的、能算准的口径，标签也写得不一样。
 */
export interface DailyStats {
  /** 分栏条目总数 */
  bigItems: number
  /** 去重后的信源数 */
  sources: number
  /** 快讯条数 */
  flashes: number
  /** 预计阅读分钟数 */
  minutes: number
}

/**
 * 周报月报报头下的那行数字。
 *
 * 和 DailyStats 分开是有意的：日报有快讯、周报月报没有；周报月报有期界、
 * 日报的"期界"就是它自己那一天。硬合成一个类型会有一半字段是空的。
 *
 * 口径：前两条和日报一致（分栏条目总数、去重后的信源名）。
 * 第三项我们给的是**这一期覆盖的自然天数** —— 站上周报那一行印的是「N 期日报」，
 * 那需要日报归档和周报期的对应关系，开放接口里没有；日报每天一期，
 * 正常情况下两者是同一个数，所以宁可标签朴素也不编数字。
 */
export interface PeriodicalStats {
  /** 分栏条目总数 */
  bigItems: number
  /** 去重后的信源数 */
  sources: number
  /** 这一期覆盖的自然天数；期界缺失时为 0 */
  days: number
  /** 预计阅读分钟数 */
  minutes: number
}

/** 周报月报右栏「本期看点」的一条 —— 也就是某个分栏打头的那一条 */
export interface PeriodicalHighlight {
  /** 它属于哪个分栏 */
  section: string
  item: ReportArticle
}

/** 往期栏里的一期 */
export interface ReportArchiveGroup {
  /** "2026-10" */
  month: string
  entries: ReportEntry[]
}

/* ------------------------------------------------------------ Codex 额度重置 */

export interface CodexResetPost {
  id: string
  publishedAt: string | null
  /** "确认发卡" 之类的阶段名，可能没有 */
  stage: string | null
  /** 中文正文 */
  text: string | null
  /** 中文全文（含引用的上下文），没有时退回 text */
  fullText: string | null
  /**
   * 英文原文全文。Tibo 的推文都是先英后中，AIHOT 两边都给 ——
   * 中文是转述，拿不准的时候得能对回原文。
   */
  originalText: string | null
  /** 原始推文地址 */
  url: string | null
}

/**
 * 一次额度重置 / 一张重置卡。
 *
 * 这里的 status 是重点：`announced` 是"说了要发"，`confirmed` 是"确实发了"。
 * 界面上必须区分 —— 把预告当既成事实展示是在误导用户。
 */
export interface CodexResetEvent {
  id: string
  /** direct_reset（全员重置） / reset_credit（发重置卡） */
  type: string
  /** 中文短名："全员重置" / "发重置卡" */
  label: string
  displayLabel: string
  status: string
  title: string
  scope: string | null
  /** 面向谁（"所有付费账户"） */
  audience: string | null
  /** 涉及哪些产品（"Codex、ChatGPT Work"） */
  products: string | null
  createdAt: string | null
  confirmedAt: string | null
  /** "北京时间预计 10月8日 15:00 前" */
  scheduleLabel: string | null
  /**
   * 这件事在日历上落在哪一刻（ISO）。
   *
   * 原始响应里没有一个统一的"发生时间"字段 —— 有的给 schedule.from（预计生效时刻），
   * 有的只有 confirmedAt（被确认的时刻），有的只有 occurredOn（只知道是哪天）。
   * 优先级见 shared/codex.ts 的 eventInstant()。
   */
  at: string | null
  /** at 对应的北京日期 "2026-10-03"；没有 at 时为 null */
  day: string | null
  /**
   * 只取 schedule.from / estimate.from —— "说了什么时候生效"的那个时刻。
   *
   * 和 at 分开是有必要的：判定"预计时间过没过"（应已生效 vs 等待生效）只能看它。
   * 用 at 的话，一件只说"有人看到发了"而没有任何计划的预告会被误判成已生效。
   * 这个口径是从 AIHOT 监控页反推的，用它才能算出页面上那个 23 次。
   */
  plannedAt: string | null
  /** 时间是否只是推算的（AIHOT 的 presentation.timeInferred） */
  timeInferred: boolean
  posts: CodexResetPost[]
}

/**
 * 一件事"实"到什么程度。四档，界面上用颜色和符号区分。
 *
 *   confirmed 官方确认，时间明确      —— 最实
 *   likely    官方确认，但时间只是推算
 *   due       说过要发，且预计时间已过（应已生效，但没看到确认帖）
 *   waiting   说过要发，还没到点
 *
 * 前三档合起来算"已生效"，统计口径用它 —— 这一条是从 AIHOT 的监控页反推出来的：
 * 页面上「近 90 天额度重置 23 次」只有在 confirmed+likely+due 这个集合下才成立。
 */
export type CodexState = 'confirmed' | 'likely' | 'due' | 'waiting'

/** 监控页顶部那四个数字 */
export interface CodexStats {
  /** 近 90 天额度重置次数 */
  reset90: number
  /** 近 90 天发重置卡次数 */
  credit90: number
  /** 相邻两次额度重置的间隔中位数（天，一位小数）；样本不足为 null */
  medianGap: number | null
  /** 上次额度重置的日期 "2026-10-07"，没有为 null */
  lastResetDay: string | null
  /** 当月：次数与月份标签 */
  month: string
  monthReset: number
  monthCredit: number
}

/** 日历上的一天 */
export interface CodexCalendarDay {
  /** "2026-10-03" */
  day: string
  /** 3 */
  date: number
  /** 当天额度重置次数 */
  resets: number
  /** 当天发重置卡次数 */
  credits: number
  /** 当天"最实"的那一档，决定格子用哪个颜色；没记录的日子给 'waiting'（最虚），不参与着色 */
  state: CodexState
  /**
   * 这天有没有记录。
   *
   * 日历上**每一天都要显示日期数字**（跟纸日历一样），只有有记录的那几天
   * 才挂徽标、才上色、才点得动。所以"这天是不是空的"必须是个字段 ——
   * 不能拿 day === null 来表达，那个 null 已经被跨月的空格占了；
   * 早先就是这么混的，结果整张日历只剩下有记录的几个数字。
   */
  marked: boolean
}

/** 月历网格里的一格；前后补白为 null */
export interface CodexCalendarCell {
  day: CodexCalendarDay | null
}

/**
 * 监控页要用的整包数据。
 *
 * 为什么把 today / checkedAt 一起带回来，而不是在渲染层取当前时间：
 * AIHOT 的统计窗口（"近 90 天"）和"应已生效 vs 等待生效"的判定都以**服务端的当天**
 * 为准。用户机器的时区、时钟只要有点偏差，算出来的数字就和站上对不上。
 * 这两个字段是服务端给的，用它就没有这种偏差。
 */
export interface CodexSnapshot {
  /** 服务端的当天 "2026-10-09"（Asia/Shanghai），90 天窗口以它为右端 */
  today: string
  /** 服务端这次采集的时刻，用来判"预计时间过没过" */
  checkedAt: string | null
  events: CodexResetEvent[]
}

/* ------------------------------------------------------------ 更新日志 */

/**
 * AIHOT 的一条功能更新记录。
 *
 * 它没有 JSON 接口（开放 API 只覆盖资讯数据），只能从 /changelog 页面取 ——
 * 解析在 shared/changelog.ts，纯字符串处理，可无头单测。
 */
export interface ChangelogEntry {
  /** "16:32" */
  time: string
  /** "更新" / "优化" / 将来可能有的其它 */
  kind: string
  title: string
  /** 正文段落 */
  body: string[]
  /** 列表项（"价格按真实用法算：…"），可能为空 */
  bullets: string[]
  /**
   * 这一条是"特稿"而不是普通的变更记录。
   *
   * 更新日志里偶尔有整天的重头戏（比如 2026-09-28 的 "AIHOT 2.0"）：
   * 它不是几条列表项，而是一篇带标题、导语和小节的长文。
   * 这种日子我们只取它的标题、导语和小节目录，正文留在原页面 ——
   * 界面据此换一种版式，并且在末尾把"看全文"的出口给出来。
   */
  feature?: boolean
}

export interface ChangelogDay {
  /** 2026-10-06 */
  date: string
  /** "周二" */
  weekday: string
  entries: ChangelogEntry[]
}

/* ------------------------------------------------------------ 模型榜 */

/**
 * 榜单里的一个模型。
 *
 * 价格是**人民币 / 百万 Token**，站上就是这么标的。这里原样留着字符串、
 * 不做数字化 —— 界面上要显示成 ¥26.81，转成数字再格式化反而要处理精度和尾零。
 *
 * 和更新日志一样，这批数据没有 JSON 接口，是从 /leaderboard 页面上解的
 * （见 shared/leaderboard.ts，纯字符串处理，可无头单测）。
 */
export interface LeaderboardModel {
  /** 名次，1 起 */
  rank: number
  /** 站内 slug（"claude-opus-5-5"），详情页地址靠它 */
  slug: string
  name: string
  /** 厂商（"Anthropic"）；页面没印时为空串 */
  vendor: string
  /** 上线日期 "2026-09-22"；没印时为 null */
  releasedOn: string | null
  /** 参与了几项评测 */
  evidence: number
  /** 评测覆盖面，百分比；没印时为 null（和"覆盖 0%"不是一回事） */
  coverage: number | null
  priceCache: string | null
  priceInput: string | null
  priceOutput: string | null
  /** AIHOT 评分（0~100） */
  score: number
}

/**
 * 「暂不排名」里的一个模型。
 * 它已经有分，只是评测面还不够宽 —— 一个坏成绩就可能把名次带偏。
 */
export interface LeaderboardPending {
  slug: string
  name: string
  /** 为什么暂不排名（"编程评测还不到 3 类 · 15 项评测"） */
  reason: string
  score: number
}

/**
 * 一个榜。
 *
 * 五个榜共用一套版式：综合 / 编程 / 科研 / 专业办公 / 知识问答。
 * 它们只在评分权重的口径上不同（见 note），数据形状完全一样。
 */
export interface LeaderboardBoard {
  /** 内部标识：all / coding / reasoning / professional / knowledge */
  board: string
  /** 站上的榜名（"综合榜"） */
  title: string
  /** 口径说明（"只用第三方评测机构给所有模型统一跑的成绩…"） */
  note: string
  /** 这个榜采了几项评测 */
  evidence: number
  /** 几家评测机构 */
  orgs: number
  /** 更新时间，站上的文案（"10/09 14:06"） */
  updatedAt: string | null
  /** 榜单主体，按名次升序 */
  rows: LeaderboardModel[]
  /** 暂不排名的那些 */
  pending: LeaderboardPending[]
  /** 待排区的说明；待排区不在时为空串 */
  pendingNote: string
}

/* ------------------------------------------------------------ 收藏 */

/**
 * 能收藏的东西 —— 只有两种。
 *
 * 凡是"一条资讯"都是 item：精选条目、热榜条目、报告正文里的条目、事件里的单篇报道。
 * 它们本来就是同一条内容（共用 item id），分开成几种的话，从两个入口各收藏一次
 * 就会出现两条重复。报告条目没有 id 字段，得从站内链接里抠。
 *
 * story 是另一回事：收藏的是"这条线"（事件），不是其中某一篇报道。
 */
export type SavedKind = 'item' | 'story'

/**
 * 一条收藏。
 *
 * 存的是**内容快照**而不是 id 引用：AIHOT 的精选集合会滚动，
 * 一条内容几天后就不在列表里了 —— 只存 id 的话，收藏夹会慢慢变成一堆死链。
 */
export interface SavedEntry {
  /** `${kind}:${id}` —— 同一条内容只能收藏一次 */
  key: string
  kind: SavedKind
  id: string
  title: string
  summary: string | null
  sourceName: string | null
  /** AIHOT 站内阅读页 */
  aihotUrl: string | null
  /** 第三方原文 */
  originalUrl: string | null
  category: string | null
  /** 内容自身的时间（发布 / 最新进展），不是收藏时间 */
  at: string | null
  /** 收藏时间（毫秒时间戳） */
  savedAt: number
}

/* ------------------------------------------------------------ 通用装载结果 */

/**
 * 按需加载的返回值。刻意不抛异常 ——
 * 失败要和"加载成功但没有内容"分开，界面才能给出不同的话术。
 */
export interface Loaded<T> {
  data: T | null
  error: string | null
}

/** 日报里的一条（比 Item 少几个字段） */
export interface DailyBrief {
  title: string
  summary: string | null
  source: SourceRef
  links: LinkSet
  publishedAt?: string | null
}

export interface DailySection {
  label: string
  items: DailyBrief[]
}

export interface DailyReport {
  date: string
  generatedAt: string
  windowStart: string
  windowEnd: string
  links: LinkSet
  /** 头条 */
  lead: { title: string; leadParagraph: string } | null
  sections: DailySection[]
  /** 快讯（只有标题和出处） */
  flashes: DailyBrief[]
}

/* ------------------------------------------------------------ 应用内部 */

/**
 * 侧栏的七个视图。
 *
 * report 同时承担日报 / 周报 / 月报 —— 三者的版式是同一套，
 * 拆成三个侧栏项只会让"看某一段时间发生了什么"这件事多出两次点击。
 * 事件页（story）不在这里：它是从列表里点进去的一层，不是并列的视图。
 */
export type ViewKind =
  | 'hot'
  | 'feed'
  | 'report'
  | 'leaderboard'
  | 'codex'
  | 'saved'
  | 'changelog'

/** 精选流的来源：编辑精选 / 全部公开动态 */
export type FeedMode = 'selected' | 'all'

/** 精选流的分类筛选。null = 全部 */
export type CategoryFilter = string | null

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  /** 主题：跟随系统 / 强制浅色 / 强制深色 */
  theme: 'system' | 'light' | 'dark'
  /** 自动刷新间隔（分钟）。0 = 不自动刷新 */
  refreshMinutes: number
  /** 新事件进入热榜前 3 时发系统通知 */
  notifyOnHot: boolean
  /** 启动时与每天一次自动检查新版本 */
  autoCheckUpdate: boolean
  /** 主窗口的位置与尺寸。主进程写，渲染层只读 */
  windowBounds: WindowBounds | null
}

/**
 * 主进程推给渲染层的聚合快照。
 *
 * 三个视图的数据各自独立拿到 —— 某个接口挂了不该让另外两个一起空着，
 * 所以每份数据自带 error 字段，而不是整个快照共用一个。
 */
export interface Snapshot {
  /** 这一轮数据是什么时候取的（ISO） */
  fetchedAt: string
  hot: { items: HotTopic[]; error: string | null }
  feed: { items: Item[]; error: string | null; category: CategoryFilter; mode: FeedMode }
  daily: { report: DailyReport | null; error: string | null }
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
}

/** 托盘/设置里的"现在能不能连上"状态 */
export interface SourceStatus {
  ok: boolean
  /** 最近一次成功取数的时间（ISO），从未成功过则为 null */
  lastOkAt: string | null
  message: string | null
}

/* ------------------------------------------------------------ 版本更新 */

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** 当前运行的版本号 */
  current: string
  /** 远端发现的新版本号；未知时为空串 */
  latest: string
  /** 下载进度 0..100，仅 status === 'downloading' 时有意义 */
  percent: number
  /** 失败原因或「不支持」的原因；状态正常时为空串 */
  message: string
  /** 最近一次检查完成的时刻（毫秒时间戳）；从未查过为 0 */
  checkedAt: number
  /** 新版本的更新说明，可能为空 */
  notes: string
  /** 能否直接在本应用内下载 —— false 时只能去发布页手动下 */
  canDownload: boolean
}
