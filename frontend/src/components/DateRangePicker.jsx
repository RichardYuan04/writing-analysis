import { useEffect, useRef, useState } from 'react'

// 本地日期工具（避免时区偏移：统一用本地年月日拼 YYYY-MM-DD）
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const sameDay = (a, b) => a && b && fmt(a) === fmt(b)

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

// 生成某月日历的 6×7 网格（周一为首）
function monthGrid(view) {
  const first = firstOfMonth(view)
  const lead = (first.getDay() + 6) % 7 // 周一=0
  const start = new Date(first)
  start.setDate(1 - lead)
  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

// ── 单个日历面板（开始 / 结束各一个）──
function MonthPanel({ title, view, setView, onPickDay, start, end }) {
  const [mode, setMode] = useState('days') // days | months | years
  const [yearBase, setYearBase] = useState(view.getFullYear() - (view.getFullYear() % 12))

  // 切到年视图时，把年份页定位到当前视图所在的 12 年段
  const openYears = () => {
    setYearBase(view.getFullYear() - (view.getFullYear() % 12))
    setMode('years')
  }

  const todayStr = fmt(new Date())
  const grid = monthGrid(view)

  return (
    <div className="drp-panel">
      <div className="drp-panel-title">{title}</div>

      <div className="drp-head">
        <button
          className="drp-nav"
          onClick={() => {
            if (mode === 'days') setView(addMonths(view, -1))
            else if (mode === 'months') setView(new Date(view.getFullYear() - 1, view.getMonth(), 1))
            else setYearBase((b) => b - 12)
          }}
          aria-label="上一步"
        >‹</button>

        <span className="drp-head-center">
          <button className="drp-ym" onClick={openYears}>{view.getFullYear()} 年</button>
          <button className="drp-ym" onClick={() => setMode('months')}>{view.getMonth() + 1} 月</button>
        </span>

        <button
          className="drp-nav"
          onClick={() => {
            if (mode === 'days') setView(addMonths(view, 1))
            else if (mode === 'months') setView(new Date(view.getFullYear() + 1, view.getMonth(), 1))
            else setYearBase((b) => b + 12)
          }}
          aria-label="下一步"
        >›</button>
      </div>

      {mode === 'days' && (
        <>
          <div className="drp-weekrow">
            {WEEK.map((w) => <span key={w} className="drp-wk">{w}</span>)}
          </div>
          <div className="drp-grid">
            {grid.map((d) => {
              const inMonth = d.getMonth() === view.getMonth()
              const ds = fmt(d)
              const isStart = sameDay(d, start)
              const isEnd = sameDay(d, end)
              const inRange = start && end && d > start && d < end
              const cls = [
                'drp-day',
                inMonth ? '' : 'out',
                isStart ? 'start' : '',
                isEnd ? 'end' : '',
                (isStart || isEnd) ? 'edge' : '',
                inRange ? 'inrange' : '',
                ds === todayStr ? 'today' : '',
              ].filter(Boolean).join(' ')
              return <button key={ds} className={cls} onClick={() => onPickDay(d)}>{d.getDate()}</button>
            })}
          </div>
        </>
      )}

      {mode === 'months' && (
        <div className="drp-mgrid">
          {Array.from({ length: 12 }, (_, i) => (
            <button
              key={i}
              className={`drp-mcell ${i === view.getMonth() ? 'cur' : ''}`}
              onClick={() => { setView(new Date(view.getFullYear(), i, 1)); setMode('days') }}
            >{i + 1} 月</button>
          ))}
        </div>
      )}

      {mode === 'years' && (
        <div className="drp-mgrid">
          {Array.from({ length: 12 }, (_, i) => {
            const y = yearBase + i
            return (
              <button
                key={y}
                className={`drp-mcell ${y === view.getFullYear() ? 'cur' : ''}`}
                onClick={() => { setView(new Date(y, view.getMonth(), 1)); setMode('months') }}
              >{y}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 日期范围选择器：点按钮弹出「双日历」浮窗，左选开始、右选结束。
 * 年、月可直接点击跳转。
 * props:
 *  - startDate, endDate: 'YYYY-MM-DD' | ''
 *  - onApply(start, end): 应用所选范围（任一端可为空）
 */
export default function DateRangePicker({ startDate, endDate, onApply }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState({ start: startDate || '', end: endDate || '' })
  const [leftView, setLeftView] = useState(() => firstOfMonth(parse(startDate) || new Date()))
  const [rightView, setRightView] = useState(() =>
    firstOfMonth(parse(endDate) || addMonths(parse(startDate) || new Date(), 1))
  )
  const wrapRef = useRef(null)

  useEffect(() => { setSel({ start: startDate || '', end: endDate || '' }) }, [startDate, endDate])

  // 打开时把两个面板定位到已选范围
  useEffect(() => {
    if (!open) return
    setLeftView(firstOfMonth(parse(sel.start) || new Date()))
    setRightView(firstOfMonth(parse(sel.end) || addMonths(parse(sel.start) || new Date(), 1)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const apply = () => {
    let { start, end } = sel
    if (start && end && start > end) [start, end] = [end, start] // 起止颠倒则交换
    onApply(start, end)
    setOpen(false)
  }
  const clear = () => { setSel({ start: '', end: '' }); onApply('', ''); setOpen(false) }

  const triggerText = startDate
    ? (endDate ? `${startDate} → ${endDate}` : `${startDate} 起`)
    : (endDate ? `截至 ${endDate}` : '选择日期范围')

  const s = parse(sel.start)
  const e = parse(sel.end)

  return (
    <span className="drp" ref={wrapRef}>
      <button
        className={`drp-trigger ${(startDate || endDate) ? 'has-value' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="drp-cal-ico">📅</span>
        <span className="drp-trigger-text">{triggerText}</span>
        <span className="drp-caret">▾</span>
      </button>

      {open && (
        <div className="drp-pop">
          <div className="drp-panels">
            <MonthPanel
              title="开始日期"
              view={leftView}
              setView={setLeftView}
              start={s}
              end={e}
              onPickDay={(d) => setSel((p) => ({ ...p, start: fmt(d) }))}
            />
            <div className="drp-divider" />
            <MonthPanel
              title="结束日期"
              view={rightView}
              setView={setRightView}
              start={s}
              end={e}
              onPickDay={(d) => setSel((p) => ({ ...p, end: fmt(d) }))}
            />
          </div>

          <div className="drp-foot">
            <span className="drp-range-text">
              {sel.start || '——'}<span className="drp-arrow"> → </span>{sel.end || '——'}
            </span>
            <span className="drp-foot-btns">
              <button className="drp-clear" onClick={clear}>清除</button>
              <button className="drp-apply" disabled={!sel.start && !sel.end} onClick={apply}>应用</button>
            </span>
          </div>
        </div>
      )}
    </span>
  )
}
