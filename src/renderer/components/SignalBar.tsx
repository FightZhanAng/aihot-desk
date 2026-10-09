import { SIGNAL_SEGMENTS } from '@shared/signal'

/*
 * 信号带 —— 全应用唯一的"签名元素"。
 *
 * 8 格固定刻度，点亮几格说明这条资讯有多强的传播（热榜）或多高的编辑评分（精选）。
 * 未点亮的槽始终画出来：槽本身就是刻度，让 8 格的总量成为可比较的基准。
 *
 * 颜色分三档而不是一档：红色只留给最强的那一档（≥6 格），
 * 否则满屏红色，"最强"就不再是信息了。
 */

interface SignalBarProps {
  level: number
  /** 无障碍标签，说明这个刻度在量什么 */
  label: string
}

export function SignalBar({ level, label }: SignalBarProps): React.ReactElement {
  const tier = level >= 7 ? 'strong' : level >= 4 ? 'mid' : 'weak'
  return (
    <span className={`signal signal--${tier}`} title={label} aria-label={label} role="img">
      {Array.from({ length: SIGNAL_SEGMENTS }, (_, i) => (
        <i key={i} className={i < level ? 'signal__seg is-on' : 'signal__seg'} />
      ))}
    </span>
  )
}
