import { useState, useEffect, useRef } from 'react'
import { createEssay, moodReply, deleteDraft } from '../api'
import MoodCard from '../components/MoodCard'
import AssistPanel from '../components/AssistPanel'
import DraftPanel from '../components/DraftPanel'
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
  const [sel, setSel] = useState(null)            // 当前选区 {start,end,text}
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [undoStack, setUndoStack] = useState([])  // 替换前整篇正文快照栈
  const [draftId, setDraftId] = useState(null)            // 当前正在编辑的草稿 id
  const [draftPanelCollapsed, setDraftPanelCollapsed] = useState(false)

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

  // 取选区前后各一句作为上下文（给同义/比喻/扩展用）
  const ctxOf = (full, start, end) => {
    const SEP = /[。！？!?\n]/
    const before = full.slice(0, start).split(SEP)
    const after = full.slice(end).split(SEP)
    const prev = (before[before.length - 1] || '').trim()
    const next = (after[0] || '').trim()
    return [prev, next].filter(Boolean).join(' … ')
  }

  // 正文选区变化 → 同步给右侧面板（≥4 字才算有效选中）
  const onContentSelect = (e) => {
    const el = e.target
    const { selectionStart: s, selectionEnd: t, value } = el
    const text = value.slice(s, t)
    if (text.trim().length >= 4) {
      setSel({ start: s, end: t, text, context: ctxOf(value, s, t) })
    } else {
      setSel(null)
    }
  }

  // 用 AI 结果替换指定区间；替换前把整篇压入撤回栈
  const applyAssist = (range, newText) => {
    if (!range) return
    setUndoStack(s => [...s, content])
    setContent(content.slice(0, range.start) + newText + content.slice(range.end))
    setSel(null)
    // 替换后把选区设到「新文字」范围：既高亮提示改了哪段，又让视图滚到此处。
    // （此前只调 focus() 不设选区，光标默认落到文末，导致正文滚到最底部——就是那个 bug）
    const newStart = range.start
    const newEnd = range.start + newText.length
    setTimeout(() => {
      const el = contentRef.current
      if (!el) return
      el.focus()
      try { el.setSelectionRange(newStart, newEnd) } catch { /* 忽略 */ }
    }, 0)
  }

  // 撤回最近一次替换：还原整篇到替换前快照
  const undoLast = () => {
    setUndoStack(s => {
      if (!s.length) return s
      setContent(s[s.length - 1])
      return s.slice(0, -1)
    })
  }

  // 点开草稿箱里的某份 → 载入编辑器继续写
  const openDraft = (d) => {
    setTitle(d.title || '')
    setContent(d.content || '')
    setDate(d.date || today)
    setDraftId(d.id)
    setMood(null)
    setSel(null)
    setUndoStack([])
    setAutoState('saved')
    setTimeout(() => contentRef.current?.focus(), 0)
  }

  // 清空当前编辑器（带确认）；不影响草稿箱里已存的草稿
  const clearEditor = () => {
    if (!title && !content) return
    if (!window.confirm('清空当前内容？此操作不影响已存入草稿箱的草稿。')) return
    setTitle('')
    setContent('')
    setDate(today)
    setDraftId(null)
    setSel(null)
    setUndoStack([])
    setMood(null)
    setAutoState('idle')
    localStorage.removeItem(DRAFT_KEY)
  }

  const handleSave = async () => {
    if (savingRef.current || mood) return   // 防重入 + 已保存(卡片已出)不再创建
    if (!title.trim() || !content.trim()) { setError('标题和内容不能为空'); return }
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const res = await createEssay({ title, content, date })
      localStorage.removeItem(DRAFT_KEY)
      if (draftId) { try { await deleteDraft(draftId) } catch { /* ignore */ } setDraftId(null) }
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
    <div className="write-layout">
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
        onSelect={onContentSelect}
      />
      <div className="write-footer">
        <span className="word-count">{content.replace(/\s/g, '').length} 字</span>
        {error && <span className="error">{error}</span>}
        {mood ? (
          <span className="saved-flag">已保存 ✓</span>
        ) : (
          <>
            <button className="clear-btn" onClick={clearEditor} disabled={!title && !content}>清空</button>
            <button className="save-btn" onClick={handleSave} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
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

      <div className="write-right">
        <AssistPanel
          sel={sel}
          collapsed={panelCollapsed}
          onToggle={() => setPanelCollapsed(c => !c)}
          onApply={applyAssist}
          onUndo={undoLast}
          canUndo={undoStack.length > 0}
        />
        <DraftPanel
          current={{ title, content, date }}
          draftId={draftId}
          onSaved={(d) => setDraftId(d.id)}
          onOpen={openDraft}
          onDraftRemoved={() => setDraftId(null)}
          collapsed={draftPanelCollapsed}
          onToggle={() => setDraftPanelCollapsed(c => !c)}
        />
      </div>
    </div>
  )
}
