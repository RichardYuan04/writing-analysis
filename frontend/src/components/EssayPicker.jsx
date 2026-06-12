import { useState, useEffect, useMemo } from 'react'
import { listEssays, searchEssays } from '../api'

const PAGE_SIZE = 5

const DATE_RANGES = [
  { label: '全部时间', value: 'all' },
  { label: '最近一个月', value: '1m' },
  { label: '最近三个月', value: '3m' },
  { label: '最近半年', value: '6m' },
  { label: '今年', value: 'year' },
]

function getDateBounds(range) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (range === 'all') return { start: null, end: null }
  if (range === '1m') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return { start: fmt(d), end: null } }
  if (range === '3m') { const d = new Date(now); d.setMonth(d.getMonth() - 3); return { start: fmt(d), end: null } }
  if (range === '6m') { const d = new Date(now); d.setMonth(d.getMonth() - 6); return { start: fmt(d), end: null } }
  if (range === 'year') return { start: `${now.getFullYear()}-01-01`, end: null }
  return { start: null, end: null }
}

function highlightKeyword(text, keyword) {
  if (!keyword.trim()) return text
  const idx = text.indexOf(keyword)
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 2, padding: '0 1px', color: 'var(--honey)' }}>
        {text.slice(idx, idx + keyword.length)}
      </mark>
      {text.slice(idx + keyword.length)}
    </>
  )
}

export default function EssayPicker({ onAnalyze }) {
  const [allEssays, setAllEssays] = useState([])
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null) // null = 未搜索，[] = 搜索结果
  const [dateRange, setDateRange] = useState('all')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    listEssays().then(r => setAllEssays(r.data))
  }, [])

  // 关键词搜索（防抖 400ms）
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); setPage(0); return }
    const { start, end } = getDateBounds(dateRange)
    const timer = setTimeout(() => {
      searchEssays(query.trim(), start, end).then(r => {
        setSearchResults(r.data)
        setPage(0)
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [query, dateRange])

  // 无关键词时前端过滤时间范围
  const baseList = searchResults !== null ? searchResults : allEssays
  const filtered = useMemo(() => {
    if (searchResults !== null) return baseList // 已由后端过滤
    const { start } = getDateBounds(dateRange)
    if (!start) return baseList
    return baseList.filter(e => e.date >= start)
  }, [baseList, dateRange, searchResults])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const latestEssay = allEssays[0] // 已按 date desc 排序
  const selectedEssay = filtered.find(e => e.id === selectedId) || allEssays.find(e => e.id === selectedId)

  async function handleAnalyze() {
    if (!selectedId) return
    setAnalyzing(true)
    await onAnalyze(selectedId, selectedEssay?.title)
    setAnalyzing(false)
  }

  const selBg = 'color-mix(in srgb, var(--accent) 14%, var(--panel))'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 快捷入口 */}
      {latestEssay && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setSelectedId(latestEssay.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 13px', background: selectedId === latestEssay.id ? selBg : 'var(--panel)',
              border: `1px solid ${selectedId === latestEssay.id ? 'var(--accent)' : 'var(--accent-light)'}`,
              borderRadius: 8, fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            ⚡ 最近一篇
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>
            《{latestEssay.title}》· {latestEssay.date}
          </span>
        </div>
      )}

      {/* 分隔线 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-hint)', whiteSpace: 'nowrap' }}>或从列表选择</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      {/* 搜索 + 时间筛选 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索标题或正文关键词..."
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--panel)', fontSize: 12, color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <select
          value={dateRange}
          onChange={e => { setDateRange(e.target.value); setPage(0) }}
          style={{
            padding: '8px 10px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--panel)', fontSize: 11,
            color: 'var(--accent)', cursor: 'pointer',
          }}
        >
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* 搜索状态提示 */}
      {query.trim() && (
        <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>
          找到 <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{filtered.length}</span> 篇包含「
          <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{query}</span>」的随笔
        </div>
      )}

      {/* 文章列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {paged.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-hint)' }}>
            没有找到匹配的随笔
          </div>
        )}
        {paged.map(e => (
          <div
            key={e.id}
            onClick={() => setSelectedId(e.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px',
              border: `1px solid ${selectedId === e.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 8, cursor: 'pointer',
              background: selectedId === e.id ? selBg : 'var(--panel)',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--text-hint)', whiteSpace: 'nowrap', width: 76, flexShrink: 0 }}>
              {e.date}
            </span>
            <span style={{
              fontFamily: 'var(--font-serif)', fontSize: 13, flex: 1,
              color: selectedId === e.id ? 'var(--accent)' : 'var(--text-primary)',
              fontWeight: selectedId === e.id ? 'bold' : 'normal',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {query.trim() ? highlightKeyword(e.title, query.trim()) : e.title}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', whiteSpace: 'nowrap' }}>
              {e.word_count}字
            </span>
          </div>
        ))}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--panel)',
                color: page === 0 ? 'var(--text-hint)' : 'var(--accent)', cursor: page === 0 ? 'default' : 'pointer',
                fontSize: 12,
              }}
            >&lt;</button>
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: totalPages }).map((_, i) => (
                <div key={i} onClick={() => setPage(i)} style={{
                  width: 6, height: 6, borderRadius: '50%', cursor: 'pointer',
                  background: i === page ? 'var(--accent)' : 'var(--border)',
                }} />
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={{
                width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--panel)',
                color: page === totalPages - 1 ? 'var(--text-hint)' : 'var(--accent)',
                cursor: page === totalPages - 1 ? 'default' : 'pointer', fontSize: 12,
              }}
            >&gt;</button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
            第 {page + 1} / {totalPages} 页 · 共 {filtered.length} 篇
          </span>
        </div>
      )}

      {/* 分析按钮 */}
      <button
        onClick={handleAnalyze}
        disabled={!selectedId || analyzing}
        style={{
          padding: '12px', borderRadius: 8, border: 'none', cursor: selectedId && !analyzing ? 'pointer' : 'default',
          background: selectedId && !analyzing ? 'var(--accent)' : 'var(--border)',
          color: selectedId && !analyzing ? 'var(--on-accent)' : 'var(--text-hint)',
          fontSize: 14, fontWeight: 600, textAlign: 'center',
        }}
      >
        {analyzing
          ? '分析中，请稍候...'
          : selectedEssay
            ? `✨ 分析《${selectedEssay.title}》`
            : '请先选择一篇随笔'}
      </button>
    </div>
  )
}
