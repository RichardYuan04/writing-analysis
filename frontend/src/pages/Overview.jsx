import { useEffect, useState } from 'react'
import { getOverview, listEssays } from '../api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import WordCloud from '../components/WordCloud'
import HeatMap from '../components/HeatMap'
import TodayReview from '../components/TodayReview'
import WelcomeCard from '../components/WelcomeCard'
import HintBar from '../components/HintBar'

export default function Overview({ onSelect, onWrite }) {
  const [stats, setStats] = useState(null)
  const [essays, setEssays] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const fetchData = (start, end) => {
    setLoading(true)
    Promise.all([getOverview(start, end), listEssays()])
      .then(([s, e]) => { setStats(s.data); setEssays(e.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchData('', '') }, [])

  const handleFilter = () => fetchData(startDate, endDate)
  const handleReset = () => { setStartDate(''); setEndDate(''); fetchData('', '') }

  const sentimentLabel = (score) => {
    if (score > 0.65) return '😊 积极'
    if (score < 0.35) return '😔 消极'
    return '😐 平静'
  }

  const sentimentBarClass = (score) => {
    if (score > 0.65) return 'positive'
    if (score < 0.35) return 'negative'
    return 'neutral'
  }

  if (loading) return <div className="loading">加载中…</div>

  if (!essays || essays.length === 0) {
    return <WelcomeCard onWrite={onWrite} />
  }

  const showTodayReview = essays.length >= 3

  return (
    <div className="overview">
      {showTodayReview && <TodayReview onSelect={onSelect} />}

      <div className="date-filter">
        <span className="filter-label">日期范围</span>
        <input type="date" className="date-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{ color: 'var(--text-hint)', fontSize: 13 }}>—</span>
        <input type="date" className="date-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <button className="filter-btn" onClick={handleFilter}>筛选</button>
        {(startDate || endDate) && <button className="reset-btn" onClick={handleReset}>重置</button>}
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
            <HeatMap data={stats.heatmap} />
          </section>

          {stats.sentiment_trend?.length > 1 && (
            <section className="section">
              <h2>情感曲线</h2>
              {essays.length < 3 && <HintBar text="写得越多，曲线越清晰——每一篇都让画像更准确" />}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={stats.sentiment_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDE8E0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-hint)' }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: 'var(--text-hint)' }} />
                  <Tooltip formatter={(v) => [v.toFixed(2), '情感分']} labelFormatter={(l) => `日期: ${l}`} />
                  <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          <section className="section">
            <h2>高频词云</h2>
            {essays.length < 3 && <HintBar text="写得越多，词云越丰富——每一篇都让画像更清晰" />}
            <WordCloud words={stats.top_words} />
          </section>
        </>
      )}

      <section className="section">
        <h2>所有随笔</h2>
        <div className="essay-list">
          {essays.map(e => (
            <div key={e.id} className="essay-item" onClick={() => onSelect(e.id)}>
              <div className={`essay-sentiment-bar ${sentimentBarClass(e.sentiment_score)}`} />
              <div className="essay-item-body">
                <div className="essay-meta">
                  <span>{e.date}</span>
                  <span>{e.word_count} 字</span>
                  <span>{sentimentLabel(e.sentiment_score)}</span>
                </div>
                <div className="essay-title">{e.title}</div>
                <div className="essay-preview">{e.content}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
