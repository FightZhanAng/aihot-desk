import { useState, type ReactElement } from 'react'
import { formatShortDate } from '@shared/format'
import { LEADERBOARD_BOARDS, leaderboardModelUrl } from '@shared/leaderboard'
import type { LeaderboardModel, LeaderboardPending } from '@shared/types'
import { useLoaded } from '../useLoaded'
import { ExternalIcon, RefreshIcon } from './Icons'
import { ErrorBanner, LoadingState } from './States'

/*
 * 模型榜。
 *
 * 数据来自 AIHOT 的 /leaderboard（五个榜各一个地址），整张表在页面里 ——
 * 没有 JSON 接口，解析在 shared/leaderboard.ts，纯字符串处理，可无头单测。
 *
 * 版式是一张表，不是卡片流：这里所有的比较都是**按列**发生的 ——
 * 谁便宜、谁分高、谁刚上线，都要竖着扫。把它摊成三十张卡片，这件事就没法做了。
 *
 * 两件事在页面上必须说清，否则这张表会误导人：
 *   1. **分不是正确率**。它是把各家评测的成绩换算到同一条能力刻度上的读数，
 *      基准是参照组模型的平均水平 = 50 分。站上专门写了一句"评分不是正确率"。
 *   2. **一次只展示 30 个**。榜上人更多，"没在表里"不等于"排在后面"。
 *
 * 价格一律人民币 / 百万 Token —— 这是站上的口径，也是国内用户唯一能直接比的单位。
 */

const LEADERBOARD_PAGE = 'https://aihot.news/leaderboard'

interface LeaderboardViewProps {
  onOpenUrl: (url: string) => void
}

export function LeaderboardView({ onOpenUrl }: LeaderboardViewProps): ReactElement {
  const [board, setBoard] = useState<string>(LEADERBOARD_BOARDS[0].key)
  const { loaded, reload } = useLoaded(() => window.hotspot.getLeaderboard(board), [board])

  const data = loaded?.data ?? null

  return (
    <>
      <div className="viewhead">
        <span className="viewhead__title" data-testid="title">
          模型榜
        </span>
        <span className="viewhead__note">
          {data
            ? `${data.rows.length} 个模型 · ${data.evidence} 项评测 / ${data.orgs} 家机构${
                data.updatedAt ? ` · 数据 ${data.updatedAt}` : ''
              }`
            : 'AIHOT 用第三方评测机构的成绩换算出的模型排名'}
        </span>
      </div>

      {/*
        五个榜是并列的档位，不是标签页里的筛选项 —— 每个都是一份完整的排名，
        换了榜整张表连同口径全都换掉。所以做成和侧栏同一种"档位"的读法。
      */}
      <div className="lbpicks" role="tablist" aria-label="榜单">
        {LEADERBOARD_BOARDS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={board === item.key}
            className={`lbpick${board === item.key ? ' is-on' : ''}`}
            onClick={() => setBoard(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loaded?.error && <ErrorBanner message={loaded.error} onRetry={reload} />}

      {loaded === null ? (
        <LoadingState message="正在调取榜单…" />
      ) : !data ? (
        <div className="state">
          <div className="state__title">暂时读不出来</div>
          <div className="state__desc">
            榜单只能从 AIHOT 的页面上取，可能是网络原因，也可能页面改版了。
            稍后再试一次，或者直接去站上看。
          </div>
        </div>
      ) : (
        <>
          <p className="lbnote" data-testid="lb-note">
            {data.note}
            <span className="lbnote__tail">
              价格是人民币 / 百万 Token。名次来自原榜，一屏最多 30 个 ——
              没在表里不等于排在后面。
            </span>
          </p>

          <div className="lbtable" data-testid="lb-table">
            <div className="lbrow lbrow--head">
              <span className="lbcol lbcol--rank">名次</span>
              <span className="lbcol">模型</span>
              <span className="lbcol lbcol--num">上线</span>
              <span className="lbcol lbcol--num">评测证据</span>
              <span className="lbcol lbcol--num" title="缓存命中时的价格">
                缓存价
              </span>
              <span className="lbcol lbcol--num">输入价</span>
              <span className="lbcol lbcol--num">输出价</span>
              <span className="lbcol lbcol--num" title="换算到同一条能力刻度上的读数，不是正确率">
                评分
              </span>
            </div>

            {data.rows.map((model) => (
              <Row key={model.slug} model={model} onOpenUrl={onOpenUrl} />
            ))}
          </div>

          {data.pending.length > 0 && (
            <section className="lbpend" data-testid="lb-pending">
              <div className="lbpend__head">
                <h3 className="lbpend__title">暂不排名</h3>
                <span className="lbpend__count">{data.pending.length} 个模型</span>
              </div>
              {data.pendingNote && <p className="lbpend__note">{data.pendingNote}</p>}
              <div className="lbpend__list">
                {data.pending.map((item) => (
                  <PendingRow key={item.slug} item={item} onOpenUrl={onOpenUrl} />
                ))}
              </div>
            </section>
          )}

          <div className="lbacts">
            <button type="button" className="btn" onClick={reload}>
              <RefreshIcon />
              重新读取
            </button>
            <button type="button" className="btn" onClick={() => onOpenUrl(LEADERBOARD_PAGE)}>
              <ExternalIcon />
              在 AIHOT 看榜单
            </button>
          </div>
        </>
      )}
    </>
  )
}

/** 一行一个模型。整行可点 —— 详情在站上，这里只给出口 */
function Row({
  model,
  onOpenUrl
}: {
  model: LeaderboardModel
  onOpenUrl: (url: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      className="lbrow lbrow--data"
      data-testid="lb-row"
      data-slug={model.slug}
      title={`${model.name}｜在 AIHOT 看详情`}
      onClick={() => onOpenUrl(leaderboardModelUrl(model.slug))}
    >
      <span className="lbcol lbcol--rank">{String(model.rank).padStart(2, '0')}</span>
      <span className="lbcol lbcol--model">
        <span className="lbname">{model.name}</span>
        {model.vendor && <span className="lbvendor">{model.vendor}</span>}
      </span>
      <span className="lbcol lbcol--num lbcol--dim">
        {model.releasedOn ? formatShortDate(model.releasedOn) : '—'}
      </span>
      <span className="lbcol lbcol--num lbcol--dim">
        {model.evidence > 0 ? `${model.evidence} 项` : '—'}
        {model.coverage !== null && <span className="lbcover">{model.coverage}%</span>}
      </span>
      <span className="lbcol lbcol--num lbcol--dim">{model.priceCache ?? '—'}</span>
      <span className="lbcol lbcol--num">{model.priceInput ?? '—'}</span>
      <span className="lbcol lbcol--num">{model.priceOutput ?? '—'}</span>
      <span className="lbcol lbcol--num lbscore">{model.score.toFixed(1)}</span>
    </button>
  )
}

function PendingRow({
  item,
  onOpenUrl
}: {
  item: LeaderboardPending
  onOpenUrl: (url: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      className="lbpend__item"
      onClick={() => onOpenUrl(leaderboardModelUrl(item.slug))}
    >
      <span className="lbpend__name">{item.name}</span>
      <span className="lbpend__reason">{item.reason}</span>
      <span className="lbpend__score">{item.score.toFixed(1)}</span>
    </button>
  )
}
