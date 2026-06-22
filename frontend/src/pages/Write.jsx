import { useState, useEffect, useRef, useMemo } from 'react'
import { createEssay, moodReply, deleteDraft } from '../api'
import MoodCard from '../components/MoodCard'
import AssistPanel from '../components/AssistPanel'
import DraftPanel from '../components/DraftPanel'
import ReaderPanel from '../components/ReaderPanel'
import RichEditor from '../components/RichEditor'
import { blocksToPlainText, plainTextToBlocks, parseRich } from '../components/richSchema'
import QUOTES from '../data/quotes'

const DRAFT_KEY = 'wt_write_draft'

function daily() {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return { emoji: '☀️', hello: '早。' }
  if (h >= 11 && h < 18) return { emoji: '🍵', hello: '午后了。' }
  return { emoji: '🌙', hello: '夜深了。' }
}

function pickQuote(prev) {
  if (QUOTES.length <= 1) return QUOTES[0]
  let q
  do { q = QUOTES[Math.floor(Math.random() * QUOTES.length)] } while (q === prev)
  return q
}

export default function Write({ onSaved, prefill, onBack }) {
  const today = new Date().toISOString().split('T')[0]

  // 初始内容只算一次：prefill 优先，其次本地草稿（兼容旧的纯文本草稿）
  const [init] = useState(() => {
    if (prefill) return { blocks: plainTextToBlocks(prefill), title: '', date: today, at: '', restored: false, letters: [] }
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        const blocks = (d.blocks && d.blocks.length) ? d.blocks : (d.content ? plainTextToBlocks(d.content) : undefined)
        return { blocks, title: d.title || '', date: d.date || today, at: d.at || '', restored: !!(d.title || d.content || (d.blocks && d.blocks.length)), letters: d.letters || [] }
      }
    } catch { /* ignore */ }
    return { blocks: undefined, title: '', date: today, at: '', restored: false, letters: [] }
  })

  const [title, setTitle] = useState(init.title)
  const [date, setDate] = useState(init.date)
  const [docBlocks, setDocBlocks] = useState(init.blocks || [{ type: 'paragraph', content: [] }])
  const [letters, setLetters] = useState(init.letters || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [autoState, setAutoState] = useState(init.restored ? 'saved' : 'idle')
  const [autoAt, setAutoAt] = useState(init.at)
  const [dailyShown, setDailyShown] = useState(true)
  const [mood, setMood] = useState(null)

  const richRef = useRef(null)
  const moodRef = useRef(null)
  const savingRef = useRef(false)
  const hydratedRef = useRef(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [greeting] = useState(daily)
  const [quote, setQuote] = useState(() => pickQuote(null))
  const [qPhase, setQPhase] = useState('in')   // 金句切换动效：in（聚焦）/ out（淡出）
  const [spinKey, setSpinKey] = useState(0)     // 让「换一句」图标每次点击都完整转一圈
  const [sel, setSel] = useState(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [undoStack, setUndoStack] = useState([])
  const [draftId, setDraftId] = useState(null)
  const [draftPanelCollapsed, setDraftPanelCollapsed] = useState(false)
  const [readerPanelCollapsed, setReaderPanelCollapsed] = useState(false)

  const plainText = useMemo(() => blocksToPlainText(docBlocks), [docBlocks])

  // 无感自动保存（节流写 localStorage）
  useEffect(() => {
    if (mood) return
    if (!title.trim() && !plainText.trim()) {
      if (!hydratedRef.current) { hydratedRef.current = true; return }
      setAutoState('idle'); setAutoAt('')
      localStorage.removeItem(DRAFT_KEY)
      return
    }
    hydratedRef.current = true
    setAutoState('saving')
    const t = setTimeout(() => {
      const at = new Date().toTimeString().slice(0, 5)
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, blocks: docBlocks, date, at, letters }))
      setAutoState('saved'); setAutoAt(at)
    }, 800)
    return () => clearTimeout(t)
  }, [title, docBlocks, date, mood, plainText, letters])

  // 换一句：旧句模糊上浮淡出 → 中途换字 → 新句去模糊下沉聚焦
  const nextQuote = () => {
    setSpinKey((k) => k + 1)
    setQPhase('out')
    setTimeout(() => {
      setQuote((q) => pickQuote(q))
      setQPhase('in')
    }, 300)
  }

  // AI 划词改写：用编辑器选区范围替换；替换前压入快照栈
  const applyAssist = (range, newText) => {
    if (!range || !richRef.current) return
    setUndoStack((s) => [...s, richRef.current.snapshot()])
    richRef.current.replaceRange(range.from, range.to, newText)
    setSel(null)
  }
  const undoLast = () => {
    setUndoStack((s) => {
      if (!s.length) return s
      richRef.current?.restore(s[s.length - 1])
      return s.slice(0, -1)
    })
  }

  // 把一封读者来信留存到当前稿子（上限 5；持久化由自动保存/存草稿/发布兜底）
  const saveLetterLocal = (reader, content) => {
    setLetters((ls) => {
      if (ls.length >= 5 || !content) return ls
      const id = 'lt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      return [...ls, { id, persona: reader.key, persona_name: reader.name, content, created_at: new Date().toISOString() }]
    })
  }

  // 点开草稿箱里的某份 → 载入编辑器
  const openDraft = (d) => {
    const blocks = parseRich(d.content_rich, d.content)
    setTitle(d.title || '')
    setDate(d.date || today)
    setDraftId(d.id)
    setMood(null)
    setSel(null)
    setUndoStack([])
    richRef.current?.setBlocks(blocks)
    setDocBlocks(blocks)
    setLetters(d.letters || [])
    setAutoState('saved')
    setTimeout(() => richRef.current?.focus(), 0)
  }

  // 清空：站内确认框
  const requestClear = () => {
    if (!title.trim() && !plainText.trim()) return
    setConfirmClear(true)
  }
  const doClear = () => {
    setConfirmClear(false)
    setTitle('')
    setDate(today)
    setDraftId(null)
    setSel(null)
    setUndoStack([])
    setMood(null)
    const empty = [{ type: 'paragraph', content: [] }]
    richRef.current?.setBlocks(empty)
    setDocBlocks(empty)
    setLetters([])
    setAutoState('idle'); setAutoAt('')
    localStorage.removeItem(DRAFT_KEY)
  }

  useEffect(() => {
    if (!confirmClear) return
    const onKey = (e) => { if (e.key === 'Escape') setConfirmClear(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmClear])

  const handleSave = async () => {
    if (savingRef.current || mood) return
    if (!title.trim() || !plainText.trim()) { setError('标题和内容不能为空'); return }
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const res = await createEssay({
        title, content: plainText, date, content_rich: JSON.stringify(docBlocks), letters,
      })
      localStorage.removeItem(DRAFT_KEY)
      if (draftId) { try { await deleteDraft(draftId) } catch { /* ignore */ } setDraftId(null) }
      if (!res.data.mood_card || !res.data.mood_card.tone) { onSaved(); return }
      setMood({ id: res.data.id, ...res.data.mood_card })
      setTimeout(() => moodRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
      moodReply(res.data.id)
        .then((r) => setMood((m) => (m && m.id === res.data.id ? { ...m, ...r.data } : m)))
        .catch(() => setMood((m) => (m ? { ...m, ai_reply_status: 'error' } : m)))
    } catch {
      setError('保存失败，请检查后端是否启动')
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const wordCount = plainText.replace(/\s/g, '').length

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
            <blockquote className={`daily-quote q-${qPhase}`}>{quote.t}</blockquote>
            <div className="daily-row">
              <span className={`daily-cite q-${qPhase}`}>— {quote.a}{quote.s ? `《${quote.s}》` : ''}</span>
              <button className="daily-next" onClick={nextQuote}>
                <span key={spinKey} className="dn-ico">↻</span> 换一句
              </button>
            </div>
          </div>
        )}

        <div className="write-header">
          <input
            className="title-input"
            placeholder="标题…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <RichEditor
          ref={richRef}
          initialContent={init.blocks}
          onChange={setDocBlocks}
          onSelectionChange={setSel}
        />

        <div className="write-footer">
          <span className="word-count">{wordCount} 字</span>
          {error && <span className="error">{error}</span>}
          {mood ? (
            <span className="saved-flag">已保存 ✓</span>
          ) : (
            <>
              <button className="clear-btn" onClick={requestClear} disabled={!title.trim() && !plainText.trim()}>清空</button>
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          )}
        </div>

        {mood && (
          <div ref={moodRef}>
            <MoodCard mood={mood} onDismiss={() => { setMood(null); onSaved() }} floating />
          </div>
        )}
      </div>

      <div className="write-right">
        <AssistPanel
          sel={sel}
          collapsed={panelCollapsed}
          onToggle={() => setPanelCollapsed((c) => !c)}
          onApply={applyAssist}
          onUndo={undoLast}
          canUndo={undoStack.length > 0}
        />
        <DraftPanel
          current={{ title, content: plainText, date, content_rich: JSON.stringify(docBlocks), letters }}
          draftId={draftId}
          onSaved={(d) => setDraftId(d.id)}
          onOpen={openDraft}
          onDraftRemoved={() => setDraftId(null)}
          collapsed={draftPanelCollapsed}
          onToggle={() => setDraftPanelCollapsed((c) => !c)}
        />
        <ReaderPanel
          getDoc={() => ({ title, content: plainText })}
          collapsed={readerPanelCollapsed}
          onToggle={() => setReaderPanelCollapsed((c) => !c)}
          onSaveLetter={saveLetterLocal}
          savedCount={letters.length}
        />
      </div>

      {confirmClear && (
        <div className="modal-overlay" onClick={() => setConfirmClear(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">清空当前内容？</div>
            <p className="modal-msg">编辑区里的标题和正文会被清掉，回到「尚未开始」。<br />此操作不影响已存入草稿箱的草稿。</p>
            <div className="modal-acts">
              <button className="modal-ghost" onClick={() => setConfirmClear(false)}>取消</button>
              <button className="modal-primary" onClick={doClear} autoFocus>清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
