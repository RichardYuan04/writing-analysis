import { useState, useEffect, useMemo } from 'react'
import { listEssays } from '../api'

const PAGE_SIZE = 6

/**
 * 多选文章组件。
 * props:
 *  - selectedIds: number[]              当前选中的文章 id
 *  - onChange(ids: number[])            选择变化回调
 */
export default function EssayMultiPicker({ selectedIds, onChange }) {
  const [allEssays, setAllEssays] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { listEssays().then(r => setAllEssays(r.data)) }, [])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return allEssays
    return allEssays.filter(e => (e.title || '').includes(q) || (e.content || '').includes(q))
  }, [allEssays, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selected = new Set(selectedIds)

  const toggle = (id) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange([...next])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(0) }}
          placeholder="搜索标题或正文…"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #e0d5c5',
                   borderRadius: 8, background: '#faf8f5', fontSize: 12, color: '#5a4a3a', outline: 'none' }}
        />
        <span style={{ fontSize: 12, color: '#8B6F47', marginLeft: 10, whiteSpace: 'nowrap' }}>
          已选 {selectedIds.length} 篇
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {paged.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: '#bbb' }}>没有匹配的随笔</div>
        )}
        {paged.map(e => {
          const on = selected.has(e.id)
          return (
            <div key={e.id} onClick={() => toggle(e.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                       border: `1px solid ${on ? '#8B6F47' : '#ede6da'}`, borderRadius: 8, cursor: 'pointer',
                       background: on ? '#f5ede0' : '#faf8f5', transition: 'all 0.15s' }}>
              <span style={{ width: 16, flexShrink: 0, color: on ? '#8B6F47' : '#ccc' }}>{on ? '☑' : '☐'}</span>
              <span style={{ fontSize: 11, color: '#bbb', width: 76, flexShrink: 0 }}>{e.date}</span>
              <span style={{ fontSize: 13, flex: 1, color: on ? '#8B6F47' : '#5a4a3a',
                             fontWeight: on ? 'bold' : 'normal', overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
              <span style={{ fontSize: 10, color: '#ccc' }}>{e.word_count}字</span>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ width: 28, height: 28, border: '1px solid #ede6da', borderRadius: 6,
                     background: page === 0 ? '#faf8f5' : 'white', color: page === 0 ? '#ccc' : '#8B6F47',
                     cursor: page === 0 ? 'default' : 'pointer' }}>&lt;</button>
          <span style={{ fontSize: 11, color: '#aaa' }}>第 {page + 1} / {totalPages} 页 · 共 {filtered.length} 篇</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
            style={{ width: 28, height: 28, border: '1px solid #ede6da', borderRadius: 6,
                     background: page === totalPages - 1 ? '#faf8f5' : 'white',
                     color: page === totalPages - 1 ? '#ccc' : '#8B6F47',
                     cursor: page === totalPages - 1 ? 'default' : 'pointer' }}>&gt;</button>
        </div>
      )}
    </div>
  )
}
