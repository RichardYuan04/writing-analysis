import { useState, useEffect, useRef, useCallback } from 'react'
import { getSentimentTimeline } from '../api'

const GRANULARITIES = [
  { key: 'year',  label: '年' },
  { key: 'month', label: '月' },
  { key: 'week',  label: '周' },
  { key: 'day',   label: '日' },
]

const BAR_CONFIG = {
  year:  { barW: 52, gap: 14 },
  month: { barW: 38, gap: 10 },
  week:  { barW: 36, gap: 10 },
  day:   { barW: 30, gap:  8 },
}

const BAR_H = 150

const SEGMENTS = [
  { key: 'positive', color: '#9aab78', label: '积极' },
  { key: 'neutral',  color: '#e89b50', label: '中性' },
  { key: 'negative', color: '#d08a8a', label: '消极' },
]

export default function SentimentTimeline({ startDate, endDate }) {
  const [granularity, setGranularity] = useState('month')
  const [data, setData] = useState([])
  const [tooltip, setTooltip] = useState(null)
  const viewportRef = useRef(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, scroll: 0 })

  useEffect(() => {
    getSentimentTimeline(granularity, startDate, endDate)
      .then(r => setData(r.data))
      .catch(() => setData([]))
  }, [granularity, startDate, endDate])

  // 数据加载后滚动到最右（最新日期）
  useEffect(() => {
    if (viewportRef.current) {
      requestAnimationFrame(() => {
        viewportRef.current.scrollLeft = viewportRef.current.scrollWidth
      })
    }
  }, [data])

  // 拖拽滚动
  const onMouseDown = useCallback((e) => {
    isDragging.current = true
    dragStart.current = { x: e.pageX, scroll: viewportRef.current.scrollLeft }
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return
      viewportRef.current.scrollLeft = dragStart.current.scroll - (e.pageX - dragStart.current.x)
    }
    const onUp = () => { isDragging.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (data.length === 0) return null

  const { barW, gap } = BAR_CONFIG[granularity]
  const innerW = barW * data.length + gap * (data.length - 1) + 8

  return (
    <div>
      {/* 粒度 Tab */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {GRANULARITIES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setGranularity(key)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12,
              cursor: 'pointer', border: '1px solid',
              borderColor: granularity === key ? 'var(--accent)' : 'var(--border)',
              background: granularity === key ? 'var(--accent)' : 'var(--panel)',
              color: granularity === key ? 'var(--on-accent)' : 'var(--accent)',
              fontWeight: granularity === key ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 滚动视窗 */}
      <div
        ref={viewportRef}
        onMouseDown={onMouseDown}
        style={{
          overflowX: 'auto', overflowY: 'visible',
          cursor: 'grab', paddingBottom: 4,
          scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap,
          width: innerW, height: BAR_H + 28,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 24, position: 'relative',
        }}>
          {data.map((d, i) => {
            const isLast = i === data.length - 1
            return (
              <div
                key={d.label}
                style={{ width: barW, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative' }}
              >
                {/* 竖向堆叠柱，积极在顶 */}
                <div style={{ width: '100%', height: BAR_H, display: 'flex', flexDirection: 'column', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                  {SEGMENTS.map(({ key, color }) => {
                    const pct = d[key] ?? 0
                    if (pct <= 0) return null
                    return (
                      <div
                        key={key}
                        style={{ height: `${pct}%`, background: color, width: '100%', cursor: 'default', transition: 'filter 0.12s' }}
                        onMouseEnter={(e) => setTooltip({ ...d, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    )
                  })}
                </div>
                {/* X 轴标签 */}
                <div style={{
                  position: 'absolute', bottom: -20, fontSize: 9,
                  fontFamily: 'var(--font-display)',
                  color: isLast ? 'var(--accent)' : 'var(--text-hint)',
                  fontWeight: isLast ? 600 : 400,
                  whiteSpace: 'nowrap', textAlign: 'center', width: '100%',
                }}>
                  {d.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 图例（居中） */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
        {SEGMENTS.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 82,
          background: 'rgba(20,14,8,0.94)', color: '#f3ece0',
          padding: '8px 12px', borderRadius: 8, fontSize: 12,
          pointerEvents: 'none', zIndex: 9999,
          lineHeight: 1.9, boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
          border: '1px solid rgba(243,199,129,0.15)',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontSize: 10, color: '#b89a72', marginBottom: 2 }}>
            {tooltip.label} · {tooltip.essays} 篇
          </div>
          <span style={{ color: '#a4b87e' }}>积极 {tooltip.positive}%</span><br />
          <span style={{ color: '#f3c781' }}>中性 {tooltip.neutral}%</span><br />
          <span style={{ color: '#d4908a' }}>消极 {tooltip.negative}%</span>
        </div>
      )}
    </div>
  )
}
