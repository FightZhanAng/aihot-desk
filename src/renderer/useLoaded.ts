import { useCallback, useEffect, useState } from 'react'
import type { Loaded } from '@shared/types'

/*
 * 按需加载 —— 事件页、报告、Codex、更新日志这几个视图用它。
 *
 * 为什么不把结果提到 App 里存着：这些内容都是"点进去看一眼"的，
 * 组件卸载后就该丢掉。主进程那边按 URL 缓存着，再进来一次是毫秒级的往返，
 * 不值得在渲染层再养一份可能过期的副本。
 *
 * 竞态处理：publicId / 期号这种参数变了以后，旧请求可能后回来。
 * alive 标志保证只有"当前这一轮"的结果会被写进 state。
 */
export function useLoaded<T>(
  load: () => Promise<Loaded<T>>,
  deps: readonly unknown[]
): { loaded: Loaded<T> | null; reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoaded(null)
    void load()
      .then((result) => {
        if (alive) setLoaded(result)
      })
      .catch(() => {
        if (alive) setLoaded({ data: null, error: '加载失败，稍后再试' })
      })
    return () => {
      alive = false
    }
    // load 每次渲染都是新函数，不能进依赖；调用方用它真正关心的参数（deps）来声明何时重取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { loaded, reload }
}
