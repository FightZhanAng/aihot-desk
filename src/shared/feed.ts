import type { CategoryFilter, FeedMode } from './types'

/*
 * 精选流的取数参数，以及"两次点击叠在一起时"的合并规则。
 *
 * 放在 shared 里是为了能无头单测：这条规则的失败形态是**静默串档** ——
 * 界面高亮着刚点的那个分类，列表里却是另一个分类的内容，既不报错，
 * 之后每一轮自动刷新还会沿用这个错值。页面上看不出来，只能靠断言兜住。
 */

/** 精选流的取数参数：分类 + 模式（两者都是完整的，没有"半个参数"） */
export interface FeedOptions {
  category: CategoryFilter
  mode: FeedMode
}

/**
 * 把一次调用的补丁合并到基准上。
 *
 * 关键在"基准"取谁：必须是**最近一次已经请求出去**的参数，不能是"最近一次已经拿到
 * 结果的快照"。快照要等这一趟请求回来才更新，在它更新之前拿它当基准，同一批里的
 * 第二次点击就会把第一次点出来的参数吃掉：
 *
 *   1. 点「模型」→ 请求 {ai-models, selected} 发出去，快照此刻还是 {null, selected}
 *   2. 没等回来点「全部动态」→ 这次只带 mode:'all'，分类若从快照兜底就成了 null
 *   3. 第一趟回来、补跑第二趟 → 最终取的是 {null, 'all'}，
 *      而界面高亮的是「模型 + 全部动态」—— 筛选条和列表说的不是一回事
 *
 * 显式传 null 的分类（"全部"）和"没传分类"是两件事，所以判据是 undefined 而不是真值。
 */
export function mergeFeedOptions(base: FeedOptions, patch?: Partial<FeedOptions>): FeedOptions {
  return {
    category: patch?.category !== undefined ? patch.category : base.category,
    mode: patch?.mode ?? base.mode
  }
}
