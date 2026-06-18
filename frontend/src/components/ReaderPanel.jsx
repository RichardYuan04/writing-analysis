import { useState } from 'react'
import { createPortal } from 'react-dom'
import { assistReader } from '../api'
import Icon from './Icon'

// 5 个固定人格读者。字徽 + 名 + 一行「在意什么」。
const READERS = [
  { key: 'poet', glyph: '诗', name: '诗人', care: '意象 · 节奏 · 语言质地' },
  { key: 'novelist', glyph: '叙', name: '小说家', care: '人物 · 场景 · 是演还是讲' },
  { key: 'philosopher', glyph: '哲', name: '哲学家', care: '这篇底下真正在问什么' },
  { key: 'editor', glyph: '编', name: '编辑', care: '骨架 · 开头中段结尾' },
  { key: 'debater', glyph: '辩', name: '辩论家', care: '立论 · 逻辑的漏洞' },
]

/**
 * 读者视角：从右栏紧凑入口选一位读者 → 读整篇 → 浮层呈现一封信。
 * props: getDoc() => { title, content }   读取当前编辑器内容（整篇）
 *        collapsed, onToggle
 * 信只读、不替换原文。
 */
export default function ReaderPanel({ getDoc, collapsed, onToggle }) {
  const [reader, setReader] = useState(null)   // 当前选中的读者
  const [loading, setLoading] = useState(false)
  const [letter, setLetter] = useState('')
  const [error, setError] = useState('')

  const ask = async (r) => {
    const { title, content } = getDoc()
    if (!content.trim()) { setError('先写点东西，再请人来读。'); setReader(r); setLetter(''); return }
    setReader(r); setLoading(true); setLetter(''); setError('')
    try {
      const res = await assistReader({ title, content, persona: r.key })
      setLetter(res.data.letter || '')
    } catch {
      setError('AI 调用失败，请稍后再试')
    } finally {
      setLoading(false)
    }
  }
  const close = () => { setReader(null); setLetter(''); setError(''); setLoading(false) }

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
            <button key={r.key} className="rp-reader" onClick={() => ask(r)}>
              <span className="rp-seal">{r.glyph}</span>
              <span className="rp-meta">
                <span className="rp-name">{r.name}</span>
                <span className="rp-care">{r.care}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {reader && createPortal(
        <div className="modal-overlay" onClick={close}>
          <div className="letter-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="lm-head">
              <span className="lm-seal">{reader.glyph}</span>
              <span className="lm-who">{reader.name}</span>
              <button className="lm-x" onClick={close}>✕</button>
            </div>
            {loading ? (
              <div className="lm-typing">{reader.name} 正在读…</div>
            ) : error ? (
              <div className="lm-err">{error}</div>
            ) : (
              <div className="lm-body">{letter}</div>
            )}
            <div className="lm-acts">
              {!loading && !error && <button className="ap-btn" onClick={() => ask(reader)}>让他再读一遍</button>}
              <button className="ap-ghost" onClick={close}>合上信</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
