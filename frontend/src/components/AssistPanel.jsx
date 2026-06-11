import { useState, useEffect } from 'react'
import { assistReduce, assistSynonyms, assistMetaphor, assistExpand } from '../api'

/**
 * 写作工具面板（常驻右侧、可折叠）。
 * props:
 *  - sel: { start, end, text, context } | null   左侧编辑器当前选区
 *  - collapsed, onToggle                         折叠状态
 *  - onApply(range, newText)                     采用：用文字替换 range 区间
 *  - onUndo()                                    撤回最近一次替换
 *  - canUndo                                     撤回栈是否非空
 *
 * 当前不传 style_profile，后端走降级分支（只贴合原文/上下文，不强加风格）。
 * 两类结果：single（缩减/扩展，返回一段文字）、options（同义/比喻，返回多个候选）。
 * 状态机优先级：loading > error > done(result/options) > applied > sel > idle
 */
const ACTIONS = [
  { key: 'reduce',   label: '✂️ 缩减',   kind: 'single',  call: assistReduce,   running: '正在缩减…',   cap: '缩减结果' },
  { key: 'synonym',  label: '↔ 同义替换', kind: 'options', call: assistSynonyms, running: '正在找同义…', cap: '同义替换（点选采用）' },
  { key: 'metaphor', label: '✦ 比喻',     kind: 'options', call: assistMetaphor, running: '正在打比方…', cap: '比喻建议（点选复制，自行粘回去改）', copy: true },
  { key: 'expand',   label: '✚ 扩展',     kind: 'single',  call: assistExpand,   running: '正在扩展…',   cap: '扩展结果' },
]

export default function AssistPanel({ sel, collapsed, onToggle, onApply, onUndo, canUndo }) {
  const [activeSel, setActiveSel] = useState(null)  // 动作发起时冻结的区间
  const [action, setAction] = useState(null)        // 当前/上次执行的 ACTION
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)        // single 文字
  const [options, setOptions] = useState(null)      // options 列表
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState(-1)   // 比喻：刚复制的候选下标

  const reset = () => { setResult(null); setOptions(null); setError(''); setApplied(false); setCopiedIdx(-1) }

  // 出现新选区 → 回到「可操作」态
  useEffect(() => { if (sel) { reset(); setActiveSel(null); setAction(null) } }, [sel])

  const run = async (act, target) => {
    if (!target) return
    setActiveSel(target); setAction(act)
    setLoading(true); setResult(null); setOptions(null); setError(''); setApplied(false)
    try {
      const res = await act.call({ text: target.text, context: target.context || '' })
      if (act.kind === 'options') setOptions(res.data.options || [])
      else setResult(res.data.result || '')
    } catch {
      setError('AI 调用失败，请稍后再试')
    } finally {
      setLoading(false)
    }
  }

  const applyText = (txt) => {
    if (!activeSel || txt == null) return
    onApply(activeSel, txt)
    reset(); setApplied(true)
  }
  const copyText = async (idx, txt) => {
    try { await navigator.clipboard.writeText(txt) } catch { /* 降级：忽略，仍提示 */ }
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(c => (c === idx ? -1 : c)), 1600)
  }
  const discard = () => { reset(); setActiveSel(null); setAction(null) }
  const undo = () => { onUndo(); setApplied(false) }

  if (collapsed) {
    return (
      <aside className="assist-panel collapsed">
        <button className="ap-expand" onClick={onToggle} title="展开写作工具">✍️</button>
      </aside>
    )
  }

  const hasOptions = options != null
  const done = result != null || hasOptions

  return (
    <aside className="assist-panel">
      <div className="ap-head">
        <span className="ap-title">✍️ 写作工具</span>
        <div className="ap-head-r">
          {canUndo && <button className="ap-undo" onClick={undo}>↩ 撤回</button>}
          <button className="ap-collapse" onClick={onToggle} title="收起面板">▸</button>
        </div>
      </div>

      <div className="ap-body">
        {loading ? (
          <div className="ap-typing">{action?.running || '处理中…'}</div>
        ) : error ? (
          <>
            <div className="ap-err">{error}</div>
            <div className="ap-row">
              <button className="ap-btn" onClick={() => run(action, activeSel)}>重试</button>
              <button className="ap-ghost" onClick={discard}>放弃</button>
            </div>
          </>
        ) : done ? (
          <>
            <div className="ap-cap">{action?.cap}</div>
            <div className="ap-orig">原文：{activeSel?.text}</div>
            {hasOptions ? (
              <div className="ap-options">
                {options.length === 0 && <div className="ap-hint">没有生成候选，换一段试试。</div>}
                {options.map((opt, i) => (
                  <button
                    key={i}
                    className="ap-option"
                    onClick={() => (action?.copy ? copyText(i, opt) : applyText(opt))}
                  >
                    <span className="ap-option-txt">{opt}</span>
                    {action?.copy && <span className="ap-copied">{copiedIdx === i ? '已复制 ✓' : '复制'}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="ap-result">{result}</div>
            )}
            <div className="ap-row">
              {!hasOptions && <button className="ap-apply" onClick={() => applyText(result)}>采用替换</button>}
              <button className="ap-btn" onClick={() => run(action, activeSel)}>重新生成</button>
              <button className="ap-ghost" onClick={discard}>放弃</button>
            </div>
          </>
        ) : applied ? (
          <div>
            <div className="ap-cap">已替换 ✓</div>
            <p className="ap-hint">原文已替换。{canUndo && '误操作可点上方「撤回」还原。'}</p>
          </div>
        ) : sel ? (
          <>
            <div className="ap-cap">选中 {sel.text.length} 字</div>
            <div className="ap-orig">{sel.text.slice(0, 40)}{sel.text.length > 40 ? '…' : ''}</div>
            <div className="ap-actions">
              {ACTIONS.map(a => (
                <button key={a.key} className="ap-action" onClick={() => run(a, sel)}>{a.label}</button>
              ))}
            </div>
          </>
        ) : (
          <p className="ap-idle">在左侧框选一段文字（≥4 字），这里会给出可用的写作工具。</p>
        )}
      </div>
    </aside>
  )
}
