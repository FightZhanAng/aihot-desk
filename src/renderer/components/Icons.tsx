import type { ReactElement } from 'react'

/* 小图标：全部 inline SVG，不引图标库 —— 一共就这几个，而且 stroke 宽度要自己统一 */

interface IconProps {
  className?: string
}

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function RefreshIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.6 2.2v2.6h-2.6" />
    </svg>
  )
}

/*
 * 这里原来有一个齿轮图标（设置）。它被撤掉了，原因值得记一笔：
 *
 * 主题拨盘加进页脚之后，齿轮和拨盘里的太阳只隔 8px。而齿轮是
 * "一个圆 + 八道短芒"，太阳也是 —— 13px 下两者几乎一模一样，
 * 并排出现时像是图标画重了。换成"推子"（调音台那一路）也不行：
 * 三根横杆挤在 16 的框里，14px 下糊成一坨。
 *
 * 所以页脚的设置按钮最后做成了**纯文字**（见 Sidebar.tsx 的 .foot__set）——
 * 既保住了原来就有的「设置」两个字，又彻底没有"两个圆芒图标并排"的问题，
 * 还省下 22px 给拨盘。
 */

export function ExternalIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6.5 3H3.5v9.5H13V9.5" />
      <path d="M9.5 2.5H13.5v4" />
      <path d="M13.5 2.5 7.5 8.5" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function WarnIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M8 2.5 14.5 13.5h-13z" />
      <path d="M8 6.5v3.2M8 11.8v.4" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.4 1.8h5.4A1.5 1.5 0 0 1 14 6.3v5.2A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  )
}

/** 收藏。filled 是"已收藏" —— 同一个图标两个状态，不要换形状 */
export function BookmarkIcon({ className, filled }: IconProps & { filled?: boolean }): ReactElement {
  return (
    <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M4 2.5h8v11l-4-2.7-4 2.7z" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.4 10.4 14 14" />
    </svg>
  )
}

export function BackIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M9.8 3.4 5.2 8l4.6 4.6" />
    </svg>
  )
}

/** AI 日报 —— 一页纸的形状 */
export function ReportIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
      <path d="M9.2 1.8V5h3.3" />
      <path d="M6 8.4h4.8M6 10.8h3.4" />
    </svg>
  )
}

/** 精选 —— 一道闪电，意思是"编辑替你挑出来的那几道" */
export function BoltIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M9.2 1.6 3.8 8.8h3.6l-.9 5.6 5.7-7.4H8.5z" />
    </svg>
  )
}

/** 热点 —— 火苗。两层轮廓，烧得旺但不至于糊成一团 */
export function FlameIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M8 14.2a4 4 0 0 1-4-4c0-3.1 3.1-4.3 3.5-8.5 1.6 1.7 4.5 3.5 4.5 8.5a4 4 0 0 1-4 4z" />
      <path d="M8 14.2a1.9 1.9 0 0 1-1.9-1.9c0-1.5 1.5-2 1.7-4 .9.9 2.1 1.7 2.1 4A1.9 1.9 0 0 1 8 14.2z" />
    </svg>
  )
}

/**
 * Codex 重置监控 —— 一个倒着走的钟。
 * 缺口圆 + 回拨箭头是"重置"的通用写法，里面那根指针让它还是个"钟"。
 */
export function ResetIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" />
      <path d="M2.5 3v3.1h3.1" />
      <path d="M8 5.4V8l1.9 1.3" />
    </svg>
  )
}

/**
 * 模型榜 —— 三根高低不同的柱子压在一条基线上。
 * 和别处一样是线的、单色的；"谁高谁低"本身就是这个图标要说的全部。
 */
export function RankIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3.2 13V8.4M8 13V3.2M12.8 13V6" />
      <path d="M2.2 14.2h11.6" />
    </svg>
  )
}

/** 更新日志 —— 一条竖轴挂两个节点，读成"时间线" */
export function TimelineIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 2.6v10.8" />
      <circle cx="4" cy="5.4" r="1.5" />
      <path d="M7.4 5.4h5.2" />
      <circle cx="4" cy="10.6" r="1.5" />
      <path d="M7.4 10.6h5.2" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2.8 4.4h10.4" />
      <path d="M6.4 4.4V2.8h3.2v1.6" />
      <path d="M4.6 4.4 5.4 13h5.2l.8-8.6" />
    </svg>
  )
}

/*
 * 主题三档的三个记号：月亮 / 显示器 / 太阳。
 *
 * 它们只在主题切换里成组出现，所以三者的视觉重量必须一样 ——
 * 单独看哪个更重一点都无所谓，并排放在一个 2px 间隙的轨道里就看得出来。
 * 月亮是唯一一个"实心感"来自轮廓闭合的形状，所以它比另两个窄一点。
 */

/** 深色 —— 一弯月牙。外弧用大半径、内弧用小半径，缺口朝右上 */
export function MoonIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z" />
    </svg>
  )
}

/** 跟随系统 —— 一台显示器：屏 + 支架 + 底座 */
export function MonitorIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="1.9" y="3.1" width="12.2" height="8.5" rx="1.4" />
      <path d="M8 11.6v2.2M5.5 13.8h5" />
    </svg>
  )
}

/** 浅色 —— 一圈八道光芒加一个圆 */
export function SunIcon({ className }: IconProps): ReactElement {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="2.9" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M12.6 3.4l-1.06 1.06M4.46 11.54l-1.06 1.06" />
    </svg>
  )
}
