import { useCallback, useEffect, useRef, useState } from 'react'
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
  load: (force: boolean) => Promise<Loaded<T>>,
  deps: readonly unknown[]
): { loaded: Loaded<T> | null; reload: () => void; reloadFresh: () => void } {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [tick, setTick] = useState(0)
  /*
   * 这一轮要不要跳过主进程的缓存。
   *
   * 放 ref 而不是 state：它是**一次性**的 —— 取一次就复位，不能变成常驻开关，
   * 否则一次"重新读取"会让后面每次换榜单/切档位都跟着绕开缓存。
   * 默认允许缓存：第一次进一个视图没必要绕开它。
   */
  const force = useRef(false)

  const reload = useCallback(() => {
    force.current = false
    setTick((n) => n + 1)
  }, [])

  /**
   * 明确要求"重新读一遍"时走这条。
   *
   * 主进程的 changelog / leaderboard 缓存是 30 分钟，不把 force 传下去的话，
   * 它会把缓存副本直接还回来 —— 按钮点了等于什么都没做（转一圈加载态、数据一模一样）。
   */
  const reloadFresh = useCallback(() => {
    force.current = true
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    let alive = true
    setLoaded(null)
    // 取一次就复位：这是"这一轮要不要绕开缓存"，不是常驻开关
    const skipCache = force.current
    force.current = false
    void load(skipCache)
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

  return { loaded, reload, reloadFresh }
}
