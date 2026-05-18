import { useState, useEffect, useCallback } from 'react'
import { vaultStatus, vaultAnalyze, listFragments, listThemes, updateFragmentFeedback } from '../api'

const CAT_CONFIG = {
  '散文苗子':    { color: '#8a9a6a', bg: '#f5f9f0', border: '#c8d8b0', text: '#6a8a4a', emoji: '🌿' },
  '小说点子':    { color: '#7a8ea8', bg: '#f0f5fa', border: '#b0c4d8', text: '#4a6a88', emoji: '✎' },
  '金句警句':    { color: '#c4935a', bg: '#fdf8f0', border: '#e0c8a0', text: '#8B6F47', emoji: '✦' },
  '未完成的思考': { color: '#a87890', bg: '#faf0f8', border: '#d0b8c8', text: '#7a5878', emoji: '?' },
  '观察笔记':   { color: '#8a9090', bg: '#f5f8f8', border: '#c0d0d0', text: '#5a7070', emoji: '◎' },
}

const ALL_CATS = Object.keys(CAT_CONFIG)

export default function DraftVault({ onWrite }) {
  const [status, setStatus] = useState({ pending_essays: 0, total_fragments: 0, by_category: {} })
  const [fragments, setFragments] = useState([])
  const [themes, setThemes] = useState([])
  const [view, setView] = useState('cat')          // 'cat' | 'theme'
  const [activecat, setActiveCat] = useState(null) // null = 全部
  const [analyzing, setAnalyzing] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [statusRes, fragRes, themeRes] = await Promise.all([
        vaultStatus(), listFragments(), listThemes()
      ])
      setStatus(statusRes.data)
      setFragments(fragRes.data)
      setThemes(themeRes.data)
    } catch (e) {
      console.error('vault load error', e)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      await vaultAnalyze()
      await loadAll()
    } finally {
      setAnalyzing(false)
    }
  }

  const handleHide = async (id) => {
    await updateFragmentFeedback(id, { hidden: true })
    setFragments(prev => prev.filter(f => f.id !== id))
    setStatus(prev => ({ ...prev, total_fragments: prev.total_fragments - 1 }))
  }

  const handleContinue = (fragment) => {
    onWrite(fragment.content)
  }

  const visibleFragments = activecat
    ? fragments.filter(f => f.categories.includes(activecat))
    : fragments

  return (
    <div className="overview">

      {/* ── 页头 ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 'bold', color: '#3d2b1a' }}>半成品仓库</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {status.pending_essays > 0 && (
            <span style={{
              background: '#f5ede0', border: '1px solid #e0d5c5',
              color: '#8B6F47', borderRadius: 6, padding: '5px 12px', fontSize: 12,
            }}>
              {status.pending_essays} 篇随笔待分析
            </span>
          )}
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 7,
              background: analyzing ? '#c4b09a' : '#8B6F47', color: 'white',
              border: 'none', fontSize: 12, cursor: analyzing ? 'not-allowed' : 'pointer',
            }}
          >
            {analyzing ? '分析中…' : '↺ 分析新随笔'}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#b09a80', marginBottom: 20 }}>
        自动从你的随笔里提炼值得发展的片段 · 写得越多，仓库越丰富
      </p>

      {/* ── 分析中横幅 ── */}
      {analyzing && (
        <div style={{
          background: '#f5ede0', border: '1px solid #e0d5c5', borderRadius: 8,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12, color: '#8B6F47', marginBottom: 16,
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid #e0d5c5', borderTopColor: '#8B6F47',
            animation: 'spin 0.8s linear infinite', flexShrink: 0,
          }} />
          正在分析 {status.pending_essays} 篇新随笔，预计十余秒内完成……
        </div>
      )}

      {/* ── 统计行 ── */}
      {status.total_fragments > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 'auto' }}>
            <span style={{ fontSize: 16, fontWeight: 'bold', color: '#3d2b1a' }}>{status.total_fragments}</span>
            <span style={{ fontSize: 12, color: '#8a7a6a' }}>个片段</span>
          </div>
          {ALL_CATS.filter(c => status.by_category[c]).map(cat => (
            <div key={cat} className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 'auto', cursor: 'pointer' }}
              onClick={() => { setActiveCat(cat); setView('cat') }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: CAT_CONFIG[cat].color, flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 'bold', color: '#3d2b1a' }}>{status.by_category[cat]}</span>
              <span style={{ fontSize: 12, color: '#8a7a6a' }}>{cat}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 空状态 ── */}
      {status.total_fragments === 0 && !analyzing && (
        <div className="empty" style={{ marginTop: 60 }}>
          {status.pending_essays > 0
            ? '点击「分析新随笔」开始提炼片段'
            : '暂无片段——写更多随笔后再来看看'}
        </div>
      )}

      {/* ── 有内容时展示视图 ── */}
      {status.total_fragments > 0 && (
        <>
          {/* 视图切换 */}
          <div style={{
            display: 'flex', gap: 2, background: '#ede6da',
            borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 20,
          }}>
            {[['cat', '按类别'], ['theme', '按主题']].map(([v, label]) => (
              <div key={v} onClick={() => setView(v)} style={{
                padding: '5px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                color: view === v ? '#3d2b1a' : '#8a7a6a',
                background: view === v ? 'white' : 'transparent',
                fontWeight: view === v ? 500 : 400,
                boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.12s',
              }}>
                {label}
              </div>
            ))}
          </div>

          {/* ── 类别视图 ── */}
          {view === 'cat' && (
            <>
              {/* 类别筛选 pills */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                <CategoryPill
                  label={`全部 ${fragments.length}`}
                  active={!activecat}
                  onClick={() => setActiveCat(null)}
                  color="#8B6F47"
                />
                {ALL_CATS.filter(c => fragments.some(f => f.categories.includes(c))).map(cat => (
                  <CategoryPill
                    key={cat}
                    label={`${CAT_CONFIG[cat].emoji} ${cat} ${fragments.filter(f => f.categories.includes(cat)).length}`}
                    active={activecat === cat}
                    onClick={() => setActiveCat(cat)}
                    color={CAT_CONFIG[cat].text}
                    bg={CAT_CONFIG[cat].bg}
                    border={CAT_CONFIG[cat].border}
                  />
                ))}
              </div>

              {/* 片段列表 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {visibleFragments.map(f => (
                  <FragmentCard
                    key={f.id}
                    fragment={f}
                    onHide={handleHide}
                    onContinue={handleContinue}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── 主题视图 ── */}
          {view === 'theme' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {themes.length === 0 ? (
                <div className="empty">主题聚类需要至少 5 个片段才会生成</div>
              ) : themes.map(cluster => (
                <ThemeClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  onContinue={handleContinue}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 子组件 ──

function CategoryPill({ label, active, onClick, color, bg, border }) {
  return (
    <div onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
      border: `1px solid ${active ? color : (border || '#e0d5c5')}`,
      background: active ? color : (bg || '#faf8f5'),
      color: active ? 'white' : color,
      userSelect: 'none', transition: 'all 0.12s',
    }}>
      {label}
    </div>
  )
}

function FragmentCard({ fragment, onHide, onContinue }) {
  const primaryCat = fragment.categories[0]
  const cfg = primaryCat ? CAT_CONFIG[primaryCat] : { color: '#c4b09a' }
  const score = fragment.quality_score || 0
  const scoreHigh = score >= 0.8

  return (
    <div style={{
      background: 'white', border: '1px solid #ede6da', borderRadius: 10,
      display: 'flex', overflow: 'hidden',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* 左侧色条 */}
      <div style={{ width: 4, background: cfg.color, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '14px 16px' }}>
        {/* 顶部：标题 + 质量分 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#3d2b1a', lineHeight: 1.4 }}>
            {fragment.ai_title || fragment.categories[0] || '片段'}
          </div>
          <div style={{
            flexShrink: 0, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: scoreHigh ? '#edf2e8' : '#f5ede0',
            color: scoreHigh ? '#6a8a4a' : '#8B6F47',
          }}>
            质量 {score.toFixed(2)}
          </div>
        </div>

        {/* 正文（最多 4 行） */}
        <div style={{
          fontSize: 12, color: '#6a5a4a', lineHeight: 1.8, marginBottom: 10,
          display: '-webkit-box', WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {fragment.content}
        </div>

        {/* AI 建议 */}
        {fragment.ai_hint && (
          <div style={{
            background: '#faf8f5', borderLeft: '2px solid #d4a96a',
            padding: '6px 10px', borderRadius: '0 4px 4px 0',
            fontSize: 11, color: '#8a7a6a', marginBottom: 10, lineHeight: 1.6,
          }}>
            <span style={{ color: '#c4935a', fontWeight: 600, marginRight: 4 }}>✦ AI建议：</span>
            {fragment.ai_hint}
          </div>
        )}

        {/* 分类标签 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {fragment.categories.map(cat => {
            const c = CAT_CONFIG[cat] || {}
            return (
              <span key={cat} style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                border: `1px solid ${c.border || '#e0d5c5'}`,
                background: c.bg || '#faf8f5', color: c.text || '#8a7a6a',
              }}>
                {cat}
              </span>
            )
          })}
        </div>

        {/* 底部：来源 + 操作 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: '#bbb' }}>
            来自 {fragment.essay_date || '—'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onHide(fragment.id)}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11,
                border: '1px solid #e0d5c5', background: '#faf8f5',
                color: '#8B6F47', cursor: 'pointer',
              }}
            >
              隐藏
            </button>
            <button
              onClick={() => onContinue(fragment)}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11,
                border: '1px solid #8B6F47', background: '#8B6F47',
                color: 'white', cursor: 'pointer',
              }}
            >
              续写
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeClusterCard({ cluster, onContinue }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ background: 'white', border: '1px solid #ede6da', borderRadius: 10, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
          borderBottom: open ? '1px solid #f0ebe2' : 'none',
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#3d2b1a' }}>{cluster.theme_name}</div>
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
            跨越多篇随笔的共同主题
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, color: '#8B6F47', background: '#f5ede0',
            padding: '2px 8px', borderRadius: 4,
          }}>
            {cluster.fragment_count} 个片段
          </span>
          <span style={{ fontSize: 12, color: '#ccc' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cluster.fragments.map(f => (
            <div
              key={f.id}
              style={{
                padding: '10px 12px', background: '#faf8f5', borderRadius: 7,
                border: '1px solid #f0ebe2', fontSize: 12, color: '#6a5a4a',
                lineHeight: 1.7, cursor: 'pointer', transition: 'background 0.12s',
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5ede0'}
              onMouseLeave={e => e.currentTarget.style.background = '#faf8f5'}
              onClick={() => onContinue(f)}
              title="点击续写"
            >
              {f.content}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
