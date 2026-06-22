import { useState } from 'react'
import { READERS } from './ReaderPanel'
import ReaderLetterModal from './ReaderLetterModal'
import { SealChar } from './Icon'
import { saveEssayLetter, deleteEssayLetter } from '../api'

const GLYPH = Object.fromEntries(READERS.map(r => [r.key, r.glyph]))

/**
 * 详情页「读者来信」区：看已存来信、请读者再读这篇并留存、删除任意一封。
 * props: essayId, title, content（已保存随笔的标题与正文）, initialLetters
 */
export default function ReaderLetterbox({ essayId, title, content, initialLetters }) {
  const [letters, setLetters] = useState(initialLetters || [])
  const [reader, setReader] = useState(null)
  const atLimit = letters.length >= 5

  const handleSave = async (rd, text) => {
    try {
      const r = await saveEssayLetter(essayId, { persona: rd.key, persona_name: rd.name, content: text })
      setLetters(r.data)
    } catch { /* 忽略；上限会被后端拦下 */ }
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
          <article key={lt.id} className="rb-letter">
            <div className="rb-letter-head">
              <SealChar char={GLYPH[lt.persona] || (lt.persona_name || '读')[0]} className="seal-ic--sm" />
              <span className="rb-letter-who">{lt.persona_name}</span>
              <span className="rb-letter-date">{(lt.created_at || '').slice(0, 10)}</span>
              <button className="rb-del" onClick={() => remove(lt.id)}>删除</button>
            </div>
            <div className="rb-letter-body">{lt.content}</div>
          </article>
        ))}
      </div>

      <ReaderLetterModal
        reader={reader}
        getDoc={() => ({ title, content })}
        onClose={() => setReader(null)}
        onSave={handleSave}
        saveDisabled={atLimit}
        saveHint="读者信箱已满（5/5）"
      />
    </section>
  )
}
