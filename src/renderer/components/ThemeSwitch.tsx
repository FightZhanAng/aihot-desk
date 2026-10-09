import type { ReactElement } from 'react'
import type { Settings } from '@shared/types'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'

/*
 * 主题三档拨盘：深色 / 跟随系统 / 浅色。
 *
 * 顺序照参考图 —— 月亮在左、显示器居中、太阳在右。这个顺序不是随意的：
 * 它把"跟着环境走"放在正中间，两边是用户自己拍的板。
 *
 * 三档**没有文字**，所以每档都必须挂 title + aria-label：
 * 月亮和太阳自明，显示器说不清是"跟随系统"还是"投屏"。
 * 只在 title 里写是不够的 —— 读屏软件念不出 title。
 *
 * 一个容易踩的点：这里不能用 `settings.theme ?? 'system'` 来兜底。
 * 设置还没送到的那几十毫秒里，兜底会**指错一档**（实际是深色，界面上太阳亮着）。
 * 所以 theme 为 null 时三档都不亮 —— 宁可都不亮，也不要指错。
 */

const SEGMENTS: { value: Settings['theme']; label: string; Icon: (p: { className?: string }) => ReactElement }[] = [
  { value: 'dark', label: '深色', Icon: MoonIcon },
  { value: 'system', label: '跟随系统', Icon: MonitorIcon },
  { value: 'light', label: '浅色', Icon: SunIcon }
]

interface ThemeSwitchProps {
  /** null = 设置还没送到，这时三档都不亮 */
  theme: Settings['theme'] | null
  onPick: (theme: Settings['theme']) => void
}

export function ThemeSwitch({ theme, onPick }: ThemeSwitchProps): ReactElement {
  return (
    <div className="themeswitch" role="radiogroup" aria-label="主题" data-testid="theme-switch">
      {SEGMENTS.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={theme === item.value}
          aria-label={item.label}
          title={item.label}
          data-testid={`theme-${item.value}`}
          className={`themeswitch__seg${theme === item.value ? ' is-on' : ''}`}
          // 点当前这一档不做事：否则每次点击都会写一次设置文件
          onClick={() => {
            if (item.value !== theme) onPick(item.value)
          }}
        >
          <item.Icon />
        </button>
      ))}
    </div>
  )
}
