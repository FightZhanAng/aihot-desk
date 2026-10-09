import type { ReactElement } from 'react'
import type { Settings, ViewKind } from '@shared/types'
import {
  BoltIcon,
  BookmarkIcon,
  FlameIcon,
  RankIcon,
  ReportIcon,
  ResetIcon,
  TimelineIcon
} from './Icons'
import { ThemeSwitch } from './ThemeSwitch'

/*
 * 侧栏：品牌铭牌 + 视图档位 + 底部的连接状态。
 * 它长得像设备面板上的档位开关，不是"导航菜单" —— 这就是刻意的。
 *
 * 每一档都配一个图标，但**图标只是加速扫读，不承担信息** ——
 * 所以它们一律是线的、单色的、跟着文字的颜色走，选中时也不会变红
 * （红色留给"这里有信号"的地方）。
 *
 * 档位后面的数字也不是装饰：热点/精选是条数，AI 日报是最新一期日期，
 * Codex 重置监控是观测到的重置次数，收藏是攒下的条数 ——
 * 每个都在回答"那一栏里有多少东西"。
 */

interface SidebarProps {
  view: ViewKind
  hotCount: number
  feedCount: number
  /** 最新一期日报的 MM-DD，没有日报时为 null */
  reportDate: string | null
  /** Codex 重置事件数；还没加载过时为 null（这时不显示数字） */
  codexCount: number | null
  savedCount: number
  /** 连接状态：ok=正常，warn=有问题，off=还没有数据 */
  statusKind: 'ok' | 'warn' | 'off'
  statusText: string
  /** null = 设置还没送到，主题拨盘三档都不亮 */
  theme: Settings['theme'] | null
  /** 有值得看一眼的新版本 —— 设置按钮上点一颗信号红 */
  updateAlert: boolean
  onView: (view: ViewKind) => void
  onPickTheme: (theme: Settings['theme']) => void
  onOpenSettings: () => void
}

const NAV: { key: ViewKind; label: string; Icon: (props: { className?: string }) => ReactElement }[] = [
  { key: 'hot', label: '热点', Icon: FlameIcon },
  { key: 'feed', label: '精选', Icon: BoltIcon },
  { key: 'report', label: 'AI 日报', Icon: ReportIcon },
  { key: 'leaderboard', label: '模型榜', Icon: RankIcon },
  { key: 'codex', label: 'Codex 重置监控', Icon: ResetIcon },
  { key: 'saved', label: '收藏', Icon: BookmarkIcon }
]

export function Sidebar({
  view,
  hotCount,
  feedCount,
  reportDate,
  codexCount,
  savedCount,
  statusKind,
  statusText,
  theme,
  updateAlert,
  onView,
  onPickTheme,
  onOpenSettings
}: SidebarProps): ReactElement {
  const badgeOf = (key: ViewKind): string => {
    if (key === 'hot') return hotCount > 0 ? String(hotCount) : ''
    if (key === 'feed') return feedCount > 0 ? String(feedCount) : ''
    if (key === 'report') return reportDate ?? ''
    if (key === 'codex') return codexCount === null ? '' : String(codexCount)
    if (key === 'saved') return savedCount > 0 ? String(savedCount) : ''
    /*
     * 模型榜不带徽标：它的条数要抓完页面才知道，而侧栏在没进过那一栏时
     * 不该为了一个数字去开一次网络请求。进过一次也就没必要再显示了 ——
     * 榜上永远是几十个，那个数字不回答任何问题。
     */
    return ''
  }

  return (
    <aside className="sidebar">
      {/*
        铭牌上写的是**这个应用**的名字，不是数据源 —— 数据来自 AIHOT，
        但站在用户面前的是「AI 热点」。出处写在页脚的「数据来源」里。
      */}
      <div className="brand">
        <div className="brand__mark">
          AI<em>热点</em>
        </div>
        <div className="brand__sub">信号台</div>
      </div>

      <nav className="nav" aria-label="视图">
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav__item${view === item.key ? ' is-active' : ''}`}
            aria-current={view === item.key ? 'page' : undefined}
            onClick={() => onView(item.key)}
          >
            <item.Icon className="nav__icon" />
            <span className="nav__label">{item.label}</span>
            <span className="nav__count">{badgeOf(item.key)}</span>
          </button>
        ))}

        {/* 更新日志是"关于这个服务"的东西，和上面那些资讯不是一类，用一条线隔开 */}
        <button
          type="button"
          className={`nav__item nav__item--soft${view === 'changelog' ? ' is-active' : ''}`}
          aria-current={view === 'changelog' ? 'page' : undefined}
          onClick={() => onView('changelog')}
        >
          <TimelineIcon className="nav__icon" />
          <span className="nav__label">更新日志</span>
          <span className="nav__count" />
        </button>
      </nav>

      <div className="sidebar__foot">
        <div className="status" title={statusText}>
          <span className={`status__dot is-${statusKind}`} />
          <span className="status__text">{statusText}</span>
        </div>

        {/*
          主题拨盘和设置同一行。设置是纯文字，不带图标 —— 理由有两条，
          都写在 styles.css 的 .foot__set 旁边：宽度只够它占 40px，
          而且图标版的齿轮和拨盘里的太阳在 13px 下长得一模一样。
        */}
        <div className="foot__tools">
          <ThemeSwitch theme={theme} onPick={onPickTheme} />
          <button type="button" className="foot__set" title="设置" onClick={onOpenSettings}>
            设置
            {updateAlert && <span className="alert-dot" title="有新版本可用" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
