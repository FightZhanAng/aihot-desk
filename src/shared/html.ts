/*
 * HTML 片段 → 纯文本。
 *
 * changelog 和 leaderboard 两个解析器要的是同一种东西：AIHOT 服务端渲染好的
 * 页面里，那些字。所以实体表和去标签的规则放在这里共用一份 ——
 * 将来要补实体、要改空白规则，只改这一个地方。
 *
 * 顺带说一句这两页为什么非得"解析 HTML"而不是"调接口"：
 * 开放 JSON API 只覆盖资讯数据（items / hot-topics / reports / …），
 * 更新日志和模型榜都没有对应的端点。
 */

/** 页面里真正会用到的实体。剩下的原样留着比猜错了好 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  times: '×',
  laquo: '«',
  raquo: '»'
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X'
      const value = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10)
      /*
       * 上限必须挡住：String.fromCodePoint 对 > 0x10FFFF 的码点会直接抛 RangeError。
       * 这是个"解析外部页面"的函数，一个越界实体不该有能力把整条解析链掀翻 ——
       * 认不出来的实体原样保留，和下面未登记命名实体的处理保持一致。
       */
      if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return whole
      return String.fromCodePoint(value)
    }
    return ENTITIES[code] ?? whole
  })
}

/**
 * 去掉标签留文字。
 *
 * 注意 `<!-- -->` 也在这条规则里 —— 那是 React 输出相邻文本节点时的分隔符
 * （`覆盖 <!-- -->96<!-- -->%` 渲染出来就是"覆盖 96%"），
 * 它整体形如 `<…>`，会被同一个正则吃掉。
 * 不去掉的话，后面所有按数字取值的正则都得为它多留余量。
 */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * 把 html 按某个标记切成若干段 —— 每段的起点是标记的匹位置。
 * 返回的是「起点数组」而不是切片本身，因为调用方往往需要"从这一段到下一段"，
 * 而下一段的终点只有在拿到全部起点之后才知道。
 */
export function splitBy(html: string, marker: RegExp): { head: RegExpExecArray; start: number }[] {
  const marks: { head: RegExpExecArray; start: number }[] = []
  const re = new RegExp(marker.source, marker.flags.includes('g') ? marker.flags : `${marker.flags}g`)
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    marks.push({ head: match, start: match.index })
    // 零宽匹配保护：正常不会发生，但别让正则卡死
    if (match.index === re.lastIndex) re.lastIndex += 1
  }
  return marks
}
