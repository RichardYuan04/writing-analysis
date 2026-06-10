import { useState, useEffect, useRef } from 'react'
import { createEssay, moodReply } from '../api'
import MoodCard from '../components/MoodCard'
import QUOTES from '../data/quotes'

const DRAFT_KEY = 'wt_write_draft'

// 按时段给问候
function daily() {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return { emoji: '☀️', hello: '早。' }
  if (h >= 11 && h < 18) return { emoji: '🍵', hello: '午后了。' }
  return { emoji: '🌙', hello: '夜深了。' }
}

// 随机取一句金句（尽量不和上一句重复）
function pickQuote(prev) {
  if (QUOTES.length <= 1) return QUOTES[0]
  let q
  do { q = QUOTES[Math.floor(Math.random() * QUOTES.length)] } while (q === prev)
  return q
}

export default function Write({ onSaved, prefill, onBack }) {
  const today = new Date().toISOString().split('T')[0]
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [autoState, setAutoState] = useState('idle')   // idle | saving | saved
  const [autoAt, setAutoAt] = useState('')
  const [dailyShown, setDailyShown] = useState(true)
  const [mood, setMood] = useState(null)               // 保存后浮出的心绪卡

  const contentRef = useRef(null)
  const moodRef = useRef(null)
  const savingRef = useRef(false)   // 同步防重入，挡住快速连点导致的重复创建
  const [greeting] = useState(daily)
  const [quote, setQuote] = useState(() => pickQuote(null))

  // 初始化：prefill（来自仓库）优先；否则尝试恢复本地草稿
  useEffect(() => {
    if (prefill) {
      setContent(prefill)
      return
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d.title) setTitle(d.title)
        if (d.content) setContent(d.content)
        if (d.date) setDate(d.date)
        if (d.title || d.content) { setAutoState('saved'); setAutoAt(d.at || '') }
      }
    } catch { /* ignore */ }
  }, [prefill])

  // 无感自动保存（节流写 localStorage），不打断输入
  useEffect(() => {
    if (mood) return                       // 已保存、展示心绪卡时不再写草稿
    if (!title && !content) return
    setAutoState('saving')
    const t = setTimeout(() => {
      const at = new Date().toTimeString().slice(0, 5)
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, date, at }))
      setAutoState('saved'); setAutoAt(at)
    }, 800)
    return () => clearTimeout(t)
  }, [title, content, date, mood])

  const nextQuote = () => setQuote(q => pickQuote(q))

  const handleSave = async () => {
    if (savingRef.current || mood) return   // 防重入 + 已保存(卡片已出)不再创建
    if (!title.trim() || !content.trim()) { setError('标题和内容不能为空'); return }
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const res = await createEssay({ title, content, date })
      localStorage.removeItem(DRAFT_KEY)
      // 后端旧版/未返回心绪卡时，退回原行为（保存后离开），不渲染空卡
      if (!res.data.mood_card || !res.data.mood_card.tone) { onSaved(); return }
      setMood({ id: res.data.id, ...res.data.mood_card })
      // 滚动到卡片，让"保存成功"可见
      setTimeout(() => moodRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
      // 异步补那句 AI 回应
      moodReply(res.data.id)
        .then(r => setMood(m => (m && m.id === res.data.id ? { ...m, ...r.data } : m)))
        .catch(() => setMood(m => (m ? { ...m, ai_reply_status: 'error' } : m)))
    } catch {
      setError('保存失败，请检查后端是否启动')
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  return (
    <div className="write-page">
      <div className="write-top">
        {onBack && <button className="back-btn" onClick={onBack}>← 返回仓库</button>}
        <span className={`auto-state ${autoState}`}>
          <span className="auto-dot" />
          {autoState === 'saving' ? '保存中…'
            : autoState === 'saved' ? `已自动保存${autoAt ? ' · ' + autoAt : ''}`
            : '尚未开始'}
        </span>
      </div>

      {dailyShown && !mood && (
        <div className="daily-q">
          <button className="daily-x" onClick={() => setDailyShown(false)}>✕</button>
          <div className="daily-hello">{greeting.emoji} {greeting.hello}</div>
          <blockquote className="daily-quote">{quote.t}</blockquote>
          <div className="daily-row">
            <span className="daily-cite">
              — {quote.a}{quote.s ? `《${quote.s}》` : ''}
            </span>
            <button className="daily-next" onClick={nextQuote}>换一句</button>
          </div>
        </div>
      )}

      <div className="write-header">
        <input
          className="title-input"
          placeholder="标题…"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <input
          type="date"
          className="date-input"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>
      <textarea
        ref={contentRef}
        className="content-input"
        placeholder="开始写作…"
        value={content}
        onChange={e => setContent(e.target.value)}
      />
      <div className="write-footer">
        <span className="word-count">{content.replace(/\s/g, '').length} 字</span>
        {error && <span className="error">{error}</span>}
        {mood ? (
          <span className="saved-flag">已保存 ✓</span>
        ) : (
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>

      {mood && (
        <div ref={moodRef}>
          <MoodCard
            mood={mood}
            onDismiss={() => { setMood(null); onSaved() }}
            floating
          />
        </div>
      )}
    </div>
  )
}
