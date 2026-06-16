import { useEffect, useRef, useState } from 'react'
import { getOverview, listEssays, searchEssays } from '../api'
import WordCloud from '../components/WordCloud'
import HeatMap from '../components/HeatMap'
import TodayReview from '../components/TodayReview'
import WelcomeCard from '../components/WelcomeCard'
import HintBar from '../components/HintBar'
import SentimentTimeline from '../components/SentimentTimeline'
import DateRangePicker from '../components/DateRangePicker'

const PAGE_SIZE = 20

const sentimentLabel = (score) => {
  if (score > 0.65) return '😊 积极'
  if (score < 0.35) return '😔 消极'
  return '😐 平静'
}

const sentimentClass = (score) => {
  if (score > 0.65) return 'positive'
  if (score < 0.35) return 'negative'
  return 'neutral'
}

// 把日期升序/降序的列表按 YYYY-MM 连续分组
const groupByMonth = (items) => {
  const groups = []
  let cur = null
  for (const it of items) {
    const key = (it.date || '').slice(0, 7)
    if (!cur || cur.key !== key) {
      cur = { key, items: [], words: 0 }
      groups.push(cur)
    }
    cur.items.push(it)
    cur.words += it.word_count || 0
  }
  return groups
}

const monthLabel = (key) => {
  const [y, m] = key.split('-')
  return `${y} 年 ${parseInt(m, 10)} 月`
}

// 计算翻页要显示的页码（首页、末页、当前页±1，其余用省略号）
const pageItems = (current, total) => {
  const nums = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of nums) {
    if (n - prev > 1) out.push({ ellipsis: true, key: `e${n}` })
    out.push({ num: n })
    prev = n
  }
  return out
}

// 高亮命中关键词
function Highlight({ text, query }) {
  if (!query || !text) return text || ''
  const low = query.toLowerCase()
  const parts = []
  let rest = text
  let key = 0
  while (true) {
    const idx = rest.toLowerCase().indexOf(low)
    if (idx === -1) { parts.push(rest); break }
    if (idx > 0) parts.push(rest.slice(0, idx))
    parts.push(<mark key={key++}>{rest.slice(idx, idx + query.length)}</mark>)
    rest = rest.slice(idx + query.length)
  }
  return <>{parts}</>
}

export default function Overview({ onSelect, onWrite, startDate, endDate, onRange }) {
  const [stats, setStats] = useState(null)
  const [essays, setEssays] = useState([])
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null) // null=未搜索
  const [searching, setSearching] = useState(false)

  const [page, setPage] = useState(1)
  const [dayPick, setDayPick] = useState(null) // { date, items } 同一天多篇时

  const listRef = useRef(null)

  const fetchData = (start, end) => {
    setLoading(true)
    Promise.all([getOverview(start, end), listEssays(start, end)])
      .then(([s, e]) => { setStats(s.data); setEssays(e.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  // 挂载时按当前（可能是从 App 带回的）筛选拉取
  useEffect(() => { fetchData(startDate, endDate) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 防抖搜索：query 或日期范围变化时请求后端全文搜索
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      searchEssays(query.trim(), startDate, endDate)
        .then((r) => { setSearchResults(r.data); setSearching(false) })
        .catch(() => { setSearchResults([]); setSearching(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [query, startDate, endDate])

  // 日历浮窗点「应用」后：同步日期（提到 App 层）+ 重新拉取
  const handleApplyRange = (start, end) => {
    onRange?.(start, end)
    setPage(1)
    fetchData(start, end)
  }

  const goToPage = (p) => {
    setPage(p)
    if (listRef.current) listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onCalendarPick = (date) => {
    const hits = essays.filter((e) => e.date === date)
    if (hits.length === 0) return
    if (hits.length === 1) { onSelect(hits[0].id); return }
    setDayPick({ date, items: hits })
  }

  if (loading) return <div className="loading">加载中…</div>

  const isFiltered = !!(startDate || endDate)

  // 仅当真正一篇都没有、且没有筛选/搜索时，才展示新手引导卡
  if ((!essays || essays.length === 0) && !isFiltered && !query.trim()) {
    return <WelcomeCard onWrite={onWrite} />
  }

  const showTodayReview = essays.length >= 3
  const isSearch = !!query.trim()
  const displayed = isSearch ? (searchResults || []) : essays
  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageSlice = displayed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const groups = groupByMonth(pageSlice)

  return (
    <div className="overview">
      {showTodayReview && <TodayReview onSelect={onSelect} />}

      <div className="date-filter">
        <span className="filter-label">日期范围</span>
        <DateRangePicker startDate={startDate} endDate={endDate} onApply={handleApplyRange} />
        {(startDate || endDate) && (
          <button className="reset-btn" onClick={() => handleApplyRange('', '')}>重置</button>
        )}
      </div>

      {!stats || stats.total_essays === 0 ? (
        <div className="empty">该时间段内没有随笔</div>
      ) : (
        <>
          <div className="stat-cards">
            <div className="card">
              <div className="card-num">{stats.total_essays}</div>
              <div className="card-label">篇随笔</div>
            </div>
            <div className="card">
              <div className="card-num">{stats.total_words.toLocaleString()}</div>
              <div className="card-label">总字数</div>
            </div>
            <div className="card">
              <div className="card-num">{sentimentLabel(stats.avg_sentiment)}</div>
              <div className="card-label">整体情绪</div>
            </div>
          </div>

          <section className="section">
            <h2>写作日历</h2>
            <HeatMap data={stats.heatmap} onPick={onCalendarPick} />
            {dayPick && (
              <div className="day-pick">
                <div className="day-pick-head">
                  <span>{dayPick.date} · {dayPick.items.length} 篇</span>
                  <button className="day-pick-close" onClick={() => setDayPick(null)}>×</button>
                </div>
                {dayPick.items.map((e) => (
                  <div key={e.id} className="day-pick-item" onClick={() => onSelect(e.id)}>
                    <span className={`essay-dot ${sentimentClass(e.sentiment_score)}`} />
                    <span className="day-pick-title">{e.title}</span>
                    <span className="day-pick-words">{e.word_count} 字</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <h2>情感看板</h2>
            {essays.length < 3 && <HintBar text="写得越多，看板越丰富——每一篇都让情感分布更准确" />}
            <SentimentTimeline startDate={startDate} endDate={endDate} />
          </section>

          <section className="section">
            <h2>高频词云</h2>
            {essays.length < 3 && <HintBar text="写得越多，词云越丰富——每一篇都让画像更清晰" />}
            <WordCloud words={stats.top_words} />
          </section>
        </>
      )}

      <section className="section" ref={listRef}>
        <h2>所有随笔</h2>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="搜索标题或正文内容…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
          />
          {query && <button className="search-clear" onClick={() => { setQuery(''); setPage(1) }}>×</button>}
        </div>

        {isSearch && (
          <div className="search-count">
            {searching ? '搜索中…' : <>找到 <b>{displayed.length}</b> 篇</>}
          </div>
        )}

        {displayed.length === 0 ? (
          <div className="empty">{isSearch && !searching ? '没有匹配的随笔' : '暂无随笔'}</div>
        ) : (
          <>
            <div className="essay-list">
              {groups.map((g) => (
                <div key={g.key} className="month-group">
                  <div className="month-head">
                    {monthLabel(g.key)}
                    <span className="month-count">{g.items.length} 篇 · {g.words.toLocaleString()} 字</span>
                  </div>
                  {g.items.map((e) => (
                    <div key={e.id} className="essay-item" onClick={() => onSelect(e.id)}>
                      <div className={`essay-sentiment-bar ${sentimentClass(e.sentiment_score)}`} />
                      <div className="essay-item-body">
                        <div className="essay-row1">
                          <span className="essay-title">
                            <Highlight text={e.title} query={isSearch ? query.trim() : ''} />
                          </span>
                          <span className="essay-meta">
                            <span className={`essay-dot ${sentimentClass(e.sentiment_score)}`} />
                            <span>{(e.date || '').slice(5)}</span>
                            <span>{e.word_count} 字</span>
                          </span>
                        </div>
                        <div className="essay-preview">
                          <Highlight
                            text={isSearch ? e.snippet : e.content}
                            query={isSearch ? query.trim() : ''}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="pager">
                <button
                  className={`pg-btn ${safePage === 1 ? 'disabled' : ''}`}
                  disabled={safePage === 1}
                  onClick={() => goToPage(safePage - 1)}
                >‹ 上一页</button>
                {pageItems(safePage, totalPages).map((p) =>
                  p.ellipsis
                    ? <span key={p.key} className="pg-ellip">…</span>
                    : <button
                        key={p.num}
                        className={`pg-btn ${p.num === safePage ? 'active' : ''}`}
                        onClick={() => goToPage(p.num)}
                      >{p.num}</button>
                )}
                <button
                  className={`pg-btn ${safePage === totalPages ? 'disabled' : ''}`}
                  disabled={safePage === totalPages}
                  onClick={() => goToPage(safePage + 1)}
                >下一页 ›</button>
                <div className="pg-info">第 {safePage} 页 / 共 {totalPages} 页 · {displayed.length} 篇随笔</div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
