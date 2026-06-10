import { useState, useEffect } from 'react'
import { assistReduce } from '../api'

/**
 * 写作工具面板（常驻右侧、可折叠）。v1 仅「缩减」一个动作。
 * props:
 *  - sel: { start, end, text } | null   左侧编辑器当前选区
 *  - collapsed, onToggle                折叠状态
 *  - onApply(range, newText)            采用：用结果替换 range 区间
 *  - onUndo()                           撤回最近一次替换
 *  - canUndo                            撤回栈是否非空
 *
 * 当前不传 style_profile，后端走降级分支（只贴合原文/上下文，不强加风格）。
 * 状态机优先级：loading > error > result > applied > sel(可操作) > idle
 */
export default function AssistPanel({ sel, collapsed, onToggle, onApply, onUndo, canUndo }) {
  const [activeSel, setActiveSel] = useState(null)  // 正在处理的区间（动作发起时冻结）
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)

  // 出现新选区 → 回到「可操作」态
  useEffect(() => {
    if (sel) { setResult(null); setError(''); setApplied(false); setActiveSel(null) }
  }, [sel])

  const runReduce = async (target) => {
    if (!target) return
    setActiveSel(target); setLoading(true); setError(''); setResult(null); setApplied(false)
    try {
      const res = await assistReduce({ text: target.text })
      setResult(res.data.result)
    } catch {
      setError('AI 调用失败，请稍后再试')
    } finally {
      setLoading(false)
    }
  }

  const apply = () => {
    if (!activeSel || result == null) return
    onApply(activeSel, result)
    setResult(null); setApplied(true)
  }

  const discard = () => { setResult(null); setError(''); setActiveSel(null) }
  const undo = () => { onUndo(); setApplied(false) }

  if (collapsed) {
    return (
      <aside className="assist-panel collapsed">
        <button className="ap-expand" onClick={onToggle} title="展开写作工具">✍️</button>
      </aside>
    )
  }

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
          <div className="ap-typing">正在缩减…</div>
        ) : error ? (
          <>
            <div className="ap-err">{error}</div>
            <div className="ap-row">
              <button className="ap-btn" onClick={() => runReduce(activeSel)}>重试</button>
              <button className="ap-ghost" onClick={discard}>放弃</button>
            </div>
          </>
        ) : result != null ? (
          <>
            <div className="ap-cap">缩减结果</div>
            <div className="ap-orig">原文：{activeSel?.text}</div>
            <div className="ap-result">{result}</div>
            <div className="ap-row">
              <button className="ap-apply" onClick={apply}>采用替换</button>
              <button className="ap-btn" onClick={() => runReduce(activeSel)}>重新生成</button>
              <button className="ap-ghost" onClick={discard}>放弃</button>
            </div>
          </>
        ) : applied ? (
          <div>
            <div className="ap-cap">已替换 ✓</div>
            <p className="ap-hint">
              原文已替换为缩减版。{canUndo && '误操作可点上方「撤回」还原。'}
            </p>
          </div>
        ) : sel ? (
          <>
            <div className="ap-cap">选中 {sel.text.length} 字</div>
            <div className="ap-orig">
              {sel.text.slice(0, 40)}{sel.text.length > 40 ? '…' : ''}
            </div>
            <div className="ap-actions">
              <button className="ap-action" onClick={() => runReduce(sel)}>✂️ 缩减</button>
              {/* 后续在此扩展：同义替换 / 比喻 / 扩展 */}
            </div>
          </>
        ) : (
          <p className="ap-idle">在左侧框选一段文字（≥4 字），这里会给出可用的写作工具。</p>
        )}
      </div>
    </aside>
  )
}
