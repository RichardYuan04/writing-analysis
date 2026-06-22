import { useState, useEffect } from 'react'
import { listDrafts, createDraft, updateDraft, deleteDraft } from '../api'
import Icon from './Icon'

/**
 * 草稿箱面板（写作页右侧，AssistPanel 下方，可折叠）。
 * props:
 *  - current: {title, content, date}   当前编辑器内容
 *  - draftId: number|null              当前正在编辑的草稿 id
 *  - onSaved(draft)                    存入成功（父组件据此设 draftId）
 *  - onOpen(draft)                     点开某草稿（父组件载入编辑器）
 *  - onDraftRemoved()                  删除的正是当前草稿时通知父组件清 draftId
 *  - collapsed, onToggle               折叠状态
 */
export default function DraftPanel({ current, draftId, onSaved, onOpen, onDraftRemoved, collapsed, onToggle }) {
  const [drafts, setDrafts] = useState([])
  const [busy, setBusy] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  const refresh = () => listDrafts().then(r => setDrafts(r.data)).catch(() => {})
  useEffect(() => { refresh() }, [])

  const canSave = (current?.content || '').trim().length > 0

  const save = async () => {
    if (!canSave || busy) return
    setBusy(true)
    try {
      const payload = { title: current.title || '', content: current.content, date: current.date || '', content_rich: current.content_rich, letters: current.letters }
      const r = draftId ? await updateDraft(draftId, payload) : await createDraft(payload)
      onSaved?.(r.data)
      setSavedTip(true); setTimeout(() => setSavedTip(false), 1600)
      refresh()
    } catch { /* ignore */ }
    setBusy(false)
  }

  const remove = async (id, e) => {
    e.stopPropagation()
    try {
      await deleteDraft(id)
      if (id === draftId) onDraftRemoved?.()
      refresh()
    } catch { /* ignore */ }
  }

  if (collapsed) {
    return (
      <aside className="draft-panel collapsed">
        <button className="dp-expand" onClick={onToggle} title="展开草稿箱"><Icon name="drafts" className="seal-ic--plain" /></button>
      </aside>
    )
  }

  return (
    <aside className="draft-panel">
      <div className="dp-head">
        <span className="dp-title"><Icon name="drafts" className="seal-ic--sm" /> 草稿箱</span>
        <button className="dp-collapse" onClick={onToggle} title="收起草稿箱">▸</button>
      </div>
      <div className="dp-body">
        <div className="dp-save-row">
          <button className="dp-save" disabled={!canSave || busy} onClick={save}>
            {busy ? '存入中…' : (draftId ? '＋ 更新到草稿箱' : '＋ 存入草稿箱')}
          </button>
          {savedTip && <span className="dp-saved">已存入 ✓</span>}
        </div>
        <div className="dp-list">
          {drafts.length === 0 && <p className="dp-empty">还没有草稿。写点东西，点上面「存入草稿箱」。</p>}
          {drafts.map(d => (
            <div key={d.id} className={`dp-item ${d.id === draftId ? 'active' : ''}`} onClick={() => onOpen?.(d)}>
              <div className="dp-item-main">
                <div className="dp-item-title">{(d.title || '').trim() || '无题'}</div>
                <div className="dp-item-snip">{(d.content || '').slice(0, 40)}</div>
                <div className="dp-item-meta">{d.date || ''}{d.updated_at ? ` · ${d.updated_at.slice(0, 10)}` : ''}</div>
              </div>
              <button className="dp-del" onClick={(e) => remove(d.id, e)} title="删除草稿">🗑</button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
