import { useState } from 'react'
import Icon from './Icon'
import ReaderLetterModal from './ReaderLetterModal'

// 5 个固定人格读者（导出供详情页复用）。
export const READERS = [
  { key: 'poet', glyph: '诗', name: '诗人', care: '意象 · 节奏 · 语言质地' },
  { key: 'novelist', glyph: '叙', name: '小说家', care: '人物 · 场景 · 是演还是讲' },
  { key: 'philosopher', glyph: '哲', name: '哲学家', care: '这篇底下真正在问什么' },
  { key: 'editor', glyph: '编', name: '编辑', care: '骨架 · 开头中段结尾' },
  { key: 'debater', glyph: '辩', name: '辩论家', care: '立论 · 逻辑的漏洞' },
]

/**
 * 写作页读者视角入口。
 * props: getDoc() => {title, content}; collapsed, onToggle;
 *        onSaveLetter(reader, content) 把信留存到当前稿子; savedCount 已存封数。
 */
export default function ReaderPanel({ getDoc, collapsed, onToggle, onSaveLetter, savedCount = 0 }) {
  const [reader, setReader] = useState(null)
  const atLimit = savedCount >= 5

  if (collapsed) {
    return (
      <aside className="reader-panel collapsed">
        <button className="rp-expand" onClick={onToggle} title="展开读者视角"><Icon name="reader" className="seal-ic--plain" /></button>
      </aside>
    )
  }

  return (
    <>
      <aside className="reader-panel">
        <div className="rp-head">
          <span className="rp-title"><Icon name="reader" className="seal-ic--sm" /> 读者视角</span>
          <button className="rp-collapse" onClick={onToggle} title="收起">▸</button>
        </div>
        <div className="rp-tip">今天，请谁读完你这篇？换一个人，在意的东西就变。</div>
        <div className="rp-readers">
          {READERS.map(r => (
            <button key={r.key} className="rp-reader" onClick={() => setReader(r)}>
              <span className="rp-seal">{r.glyph}</span>
              <span className="rp-meta">
                <span className="rp-name">{r.name}</span>
                <span className="rp-care">{r.care}</span>
              </span>
            </button>
          ))}
        </div>
        {onSaveLetter && (
          <div className="rp-count">
            <span className="rp-count-label">读者信箱</span>
            <span className="rp-dots">
              {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < savedCount ? 'on' : ''} />)}
            </span>
            <span className="rp-count-n">{atLimit ? '已满' : `${savedCount}/5`}</span>
          </div>
        )}
      </aside>

      <ReaderLetterModal
        reader={reader}
        getDoc={getDoc}
        onClose={() => setReader(null)}
        onSave={onSaveLetter ? (rd, content) => onSaveLetter(rd, content) : undefined}
        saveDisabled={atLimit}
        saveHint="读者信箱已满（5/5），去文章详情页删几封"
      />
    </>
  )
}
