import { useState } from 'react'
import { createPortal } from 'react-dom'
import { READERS } from './ReaderPanel'
import ReaderLetterModal from './ReaderLetterModal'
import { SealChar } from './Icon'
import { saveEssayLetter, deleteEssayLetter } from '../api'

const GLYPH = Object.fromEntries(READERS.map(r => [r.key, r.glyph]))
const glyphOf = (lt) => GLYPH[lt.persona] || (lt.persona_name || '读')[0]

/**
 * 详情页「读者来信」区：以卡片列出已存来信（来信者 + 头几句预览），
 * 点卡片以浮层看全文；可请读者再读这篇并留存、删除任意一封。
 * props: essayId, title, content（已保存随笔的标题与正文）, initialLetters
 */
export default function ReaderLetterbox({ essayId, title, content, initialLetters }) {
  const [letters, setLetters] = useState(initialLetters || [])
  const [reader, setReader] = useState(null)   // 正在生成新信的读者
  const [viewing, setViewing] = useState(null) // 正在浮层查看的已存信
  const atLimit = letters.length >= 5

  // 不吞错：失败让浮层的 doSave 捕获并提示，避免「假已留存」
  const handleSave = async (rd, text) => {
    const r = await saveEssayLetter(essayId, { persona: rd.key, persona_name: rd.name, content: text })
    setLetters(r.data)
  }
  const remove = async (lid) => {
    try { const r = await deleteEssayLetter(essayId, lid); setLetters(r.data) } catch { /* ignore */ }
  }

  return (
    <section className="section reader-box">
      <h2>读者来信</h2>
      <p className="section-desc">请一位读者读这篇，留下的信会一直在这儿。最多 5 封。</p>

      <div className="rb-readers">
        {READERS.map(r => (
          <button key={r.key} className="rp-reader" disabled={atLimit} onClick={() => setReader(r)}>
            <span className="rp-seal">{r.glyph}</span>
            <span className="rp-meta">
              <span className="rp-name">{r.name}</span>
              <span className="rp-care">{r.care}</span>
            </span>
          </button>
        ))}
      </div>
      {atLimit && <div className="rb-limit">读者信箱已满（5/5），删掉几封再请新读者。</div>}

      <div className="rb-list">
        {letters.length === 0 && <div className="rb-empty">还没有读者来信。</div>}
        {letters.map(lt => (
          <article key={lt.id} className="rb-card" onClick={() => setViewing(lt)}>
            <div className="rb-letter-head">
              <SealChar char={glyphOf(lt)} className="seal-ic--sm" />
              <span className="rb-letter-who">{lt.persona_name}</span>
              <span className="rb-letter-date">{(lt.created_at || '').slice(0, 10)}</span>
              <button className="rb-del" onClick={(e) => { e.stopPropagation(); remove(lt.id) }}>删除</button>
            </div>
            <div className="rb-card-preview">{lt.content}</div>
            <span className="rb-card-more">展开全文 →</span>
          </article>
        ))}
      </div>

      {/* 生成新信的浮层 */}
      <ReaderLetterModal
        reader={reader}
        getDoc={() => ({ title, content })}
        onClose={() => setReader(null)}
        onSave={handleSave}
        saveDisabled={atLimit}
        saveHint="读者信箱已满（5/5）"
      />

      {/* 查看已存信全文的浮层（只读） */}
      {viewing && createPortal(
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div className="letter-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="lm-head">
              <span className="lm-seal">{glyphOf(viewing)}</span>
              <span className="lm-who">{viewing.persona_name}</span>
              <span className="rb-letter-date">{(viewing.created_at || '').slice(0, 10)}</span>
              <button className="lm-x" onClick={() => setViewing(null)}>✕</button>
            </div>
            <div className="lm-body">{viewing.content}</div>
            <div className="lm-acts">
              <button className="ap-ghost" onClick={() => setViewing(null)}>合上信</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  )
}
