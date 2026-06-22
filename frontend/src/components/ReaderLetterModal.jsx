import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { assistReader } from '../api'

/**
 * 共用读者信浮层：给定 reader（人格对象 {key,glyph,name}）与 getDoc()，
 * 拉取并展示一封信。onSave(reader, content) 存在时显示「留存这封信」；
 * saveDisabled/saveHint 控制上限态。
 */
export default function ReaderLetterModal({ reader, getDoc, onClose, onSave, saveDisabled, saveHint }) {
  const [loading, setLoading] = useState(false)
  const [letter, setLetter] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!reader) return
    let alive = true
    const { title, content } = getDoc()
    if (!content.trim()) { setError('先写点东西，再请人来读。'); setLetter(''); setLoading(false); return }
    setLoading(true); setLetter(''); setError(''); setSaved(false)
    assistReader({ title, content, persona: reader.key })
      .then(r => { if (alive) { setLetter(r.data.letter || ''); setLoading(false) } })
      .catch(() => { if (alive) { setError('AI 调用失败，请稍后再试'); setLoading(false) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, nonce])

  if (!reader) return null
  const doSave = () => { onSave(reader, letter); setSaved(true) }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="letter-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="lm-head">
          <span className="lm-seal">{reader.glyph}</span>
          <span className="lm-who">{reader.name}</span>
          <button className="lm-x" onClick={onClose}>✕</button>
        </div>
        {loading ? <div className="lm-typing">{reader.name} 正在读…</div>
          : error ? <div className="lm-err">{error}</div>
          : <div className="lm-body">{letter}</div>}
        <div className="lm-acts">
          {!loading && !error && (
            <button className="ap-btn" onClick={() => setNonce(n => n + 1)}>让他再读一遍</button>
          )}
          {!loading && !error && onSave && (
            saved ? <span className="lm-saved">已留存 ✓</span>
              : saveDisabled ? <span className="lm-hint">{saveHint}</span>
                : <button className="ap-btn" onClick={doSave}>留存这封信</button>
          )}
          <button className="ap-ghost" onClick={onClose}>合上信</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
