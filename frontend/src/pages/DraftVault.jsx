import { useState, useEffect, useCallback } from 'react'
import { vaultStatus, vaultAnalyze, vaultAnalyzeStatus, listFragments, listThemes, updateFragmentFeedback } from '../api'

// 每个类别只保留语义色相 + emoji，背景/边框由色相经 color-mix 派生，明暗主题通用
const CAT_CONFIG = {
  '散文苗子':    { color: '#9aab78', emoji: '🌿' },
  '小说点子':    { color: '#8aa0bc', emoji: '✎' },
  '金句警句':    { color: '#d6a468', emoji: '✦' },
  '未完成的思考': { color: '#bd8aa2', emoji: '?' },
  '观察笔记':   { color: '#9aa6a6', emoji: '◎' },
}

const tint = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`

const ALL_CATS = Object.keys(CAT_CONFIG)

export default function DraftVault({ onWrite }) {
  const [status, setStatus] = useState({ pending_essays: 0, total_fragments: 0, by_category: {}, hidden_count: 0 })
  const [fragments, setFragments] = useState([])
  const [themes, setThemes] = useState([])
  const [view, setView] = useState('cat')          // 'cat' | 'theme'
  const [activecat, setActiveCat] = useState(null) // null = 全部
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(null)    // {done, total} 分析进度
  const [failedInfo, setFailedInfo] = useState([])  // [{essay_id, error}] 失败明细
  const [showHidden, setShowHidden] = useState(false)   // 是否在「已隐藏」视图
  const [hiddenFragments, setHiddenFragments] = useState([])
  const [hiddenCat, setHiddenCat] = useState(null)      // 已隐藏视图的类别筛选

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

  const pollUntilDone = async () => {
    // 轮询后台任务，直到 running 变 false；实时更新进度
    for (;;) {
      await new Promise(res => setTimeout(res, 1500))
      let s
      try { s = (await vaultAnalyzeStatus()).data } catch { break }
      setProgress({ done: s.done, total: s.total })
      if (!s.running) { setFailedInfo(s.failed || []); break }
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setFailedInfo([])
    setProgress(null)
    try {
      const r = await vaultAnalyze()
      if (r.data.started || r.data.running) {
        setProgress({ done: r.data.done || 0, total: r.data.total || 0 })
        await pollUntilDone()
      }
      await loadAll()
    } finally {
      setAnalyzing(false)
      setProgress(null)
    }
  }

  const handleHide = async (id) => {
    await updateFragmentFeedback(id, { hidden: true })
    setFragments(prev => prev.filter(f => f.id !== id))
    setStatus(prev => ({
      ...prev,
      total_fragments: prev.total_fragments - 1,
      hidden_count: (prev.hidden_count || 0) + 1,
    }))
  }

  const openHidden = async () => {
    setShowHidden(true)
    setHiddenCat(null)
    try {
      const res = await listFragments(null, true)
      setHiddenFragments(res.data)
    } catch (e) {
      console.error('load hidden error', e)
    }
  }

  const handleRestore = async (id) => {
    await updateFragmentFeedback(id, { hidden: false })
    const next = hiddenFragments.filter(f => f.id !== id)
    setHiddenFragments(next)
    if (next.length === 0) setShowHidden(false)  // 全部清空则退回常规视图
    else if (hiddenCat && !next.some(f => f.categories.includes(hiddenCat))) {
      setHiddenCat(null)                          // 当前类别已空则回到「全部」
    }
    await loadAll()                               // 恢复的片段重新出现在仓库
  }

  const handleContinue = (fragment) => {
    onWrite(fragment.content)
  }

  const visibleFragments = activecat
    ? fragments.filter(f => f.categories.includes(activecat))
    : fragments

  const visibleHidden = hiddenCat
    ? hiddenFragments.filter(f => f.categories.includes(hiddenCat))
    : hiddenFragments

  return (
    <div className="overview">

      {/* ── 页头 ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 'bold', color: 'var(--text-primary)' }}>半成品仓库</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {status.pending_essays > 0 && (
            <span style={{
              background: 'var(--panel2)', border: '1px solid var(--border)',
              color: 'var(--accent)', borderRadius: 6, padding: '5px 12px', fontSize: 12,
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
              background: analyzing ? 'var(--border)' : 'var(--accent)',
              color: analyzing ? 'var(--text-hint)' : 'var(--on-accent)',
              border: 'none', fontSize: 12, fontWeight: 600, cursor: analyzing ? 'not-allowed' : 'pointer',
            }}
          >
            {analyzing ? '分析中…' : '↺ 分析新随笔'}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 20 }}>
        自动从你的随笔里提炼值得发展的片段 · 写得越多，仓库越丰富
      </p>

      {/* ── 分析中横幅 ── */}
      {analyzing && (
        <div style={{
          background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12, color: 'var(--accent)', marginBottom: 16,
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
            animation: 'spin 0.8s linear infinite', flexShrink: 0,
          }} />
          {progress && progress.total > 0
            ? `正在分析 ${progress.done}/${progress.total} 篇……（在后台进行，可离开本页）`
            : '正在准备分析……'}
        </div>
      )}

      {/* ── 失败明细（分析结束后，有失败才显示）── */}
      {!analyzing && failedInfo.length > 0 && (
        <div style={{
          background: tint('#bd8aa2', 12), border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <span style={{ color: '#bd8aa2', fontWeight: 600 }}>{failedInfo.length} 篇分析失败</span>
            ，已保留在「待分析」，可再点「分析新随笔」重试。
            <div style={{ marginTop: 4, color: 'var(--text-hint)', lineHeight: 1.6 }}>
              {failedInfo.slice(0, 3).map(f => `#${f.essay_id}：${(f.error || '').slice(0, 40)}`).join('；')}
            </div>
          </div>
          <button onClick={() => setFailedInfo([])} style={{
            flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-hint)',
            cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
      )}

      {/* ── 统计行 ── */}
      {status.total_fragments > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 'auto' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 'bold', color: 'var(--accent)' }}>{status.total_fragments}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>个片段</span>
          </div>
          {ALL_CATS.filter(c => status.by_category[c]).map(cat => (
            <div key={cat} className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 'auto', cursor: 'pointer' }}
              onClick={() => { setActiveCat(cat); setView('cat') }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: CAT_CONFIG[cat].color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 'bold', color: 'var(--text-primary)' }}>{status.by_category[cat]}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cat}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 空状态（无可见片段且无隐藏片段）── */}
      {status.total_fragments === 0 && (status.hidden_count || 0) === 0 && !analyzing && (
        <div className="empty" style={{ marginTop: 60 }}>
          {status.pending_essays > 0
            ? '点击「分析新随笔」开始提炼片段'
            : '暂无片段——写更多随笔后再来看看'}
        </div>
      )}

      {/* ── 有内容（可见或已隐藏）时展示视图 ── */}
      {(status.total_fragments > 0 || (status.hidden_count || 0) > 0) && (
        <>
          {/* 视图切换 + 已隐藏入口 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{
              display: 'flex', gap: 2, background: 'var(--panel2)',
              borderRadius: 8, padding: 3, width: 'fit-content', border: '1px solid var(--border)',
            }}>
              {[['cat', '按类别'], ['theme', '按主题']].map(([v, label]) => (
                <div key={v} onClick={() => { setView(v); setShowHidden(false) }} style={{
                  padding: '5px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  color: !showHidden && view === v ? 'var(--on-accent)' : 'var(--text-secondary)',
                  background: !showHidden && view === v ? 'var(--accent)' : 'transparent',
                  fontWeight: !showHidden && view === v ? 600 : 400,
                  transition: 'all 0.15s',
                }}>
                  {label}
                </div>
              ))}
            </div>

            {(status.hidden_count || 0) > 0 && (
              <div
                onClick={() => (showHidden ? setShowHidden(false) : openHidden())}
                style={{
                  marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 12, cursor: 'pointer', padding: '5px 12px', borderRadius: 7,
                  color: showHidden ? 'var(--accent)' : 'var(--text-hint)',
                  border: `1px ${showHidden ? 'solid' : 'dashed'} ${showHidden ? 'var(--accent-light)' : 'var(--border)'}`,
                  background: showHidden ? tint('var(--accent)', 12) : 'transparent',
                  userSelect: 'none', transition: 'all 0.15s',
                }}
              >
                🗄 已隐藏
                <span style={{ background: 'var(--border)', color: 'var(--text-secondary)', borderRadius: 999, fontSize: 10, padding: '0 6px', fontWeight: 600 }}>
                  {status.hidden_count}
                </span>
              </div>
            )}
          </div>

          {/* ── 已隐藏视图 ── */}
          {showHidden && (
            hiddenFragments.length === 0 ? (
              <div className="empty">还没有隐藏任何片段</div>
            ) : (
              <>
                {/* 类别筛选 pills（与主页面一致） */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                  <CategoryPill
                    label={`全部 ${hiddenFragments.length}`}
                    active={!hiddenCat}
                    onClick={() => setHiddenCat(null)}
                    color="var(--accent)"
                  />
                  {ALL_CATS.filter(c => hiddenFragments.some(f => f.categories.includes(c))).map(cat => (
                    <CategoryPill
                      key={cat}
                      label={`${CAT_CONFIG[cat].emoji} ${cat} ${hiddenFragments.filter(f => f.categories.includes(cat)).length}`}
                      active={hiddenCat === cat}
                      onClick={() => setHiddenCat(cat)}
                      color={CAT_CONFIG[cat].color}
                    />
                  ))}
                </div>

                {/* 已隐藏片段列表 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {visibleHidden.map(f => (
                    <FragmentCard
                      key={f.id}
                      fragment={f}
                      hidden
                      onRestore={handleRestore}
                    />
                  ))}
                </div>
              </>
            )
          )}

          {/* ── 当前没有可见片段（全被隐藏）── */}
          {!showHidden && status.total_fragments === 0 && (
            <div className="empty">当前没有可见片段——都在「已隐藏」里，可点开恢复</div>
          )}

          {/* ── 类别视图 ── */}
          {!showHidden && status.total_fragments > 0 && view === 'cat' && (
            <>
              {/* 类别筛选 pills */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                <CategoryPill
                  label={`全部 ${fragments.length}`}
                  active={!activecat}
                  onClick={() => setActiveCat(null)}
                  color="var(--accent)"
                />
                {ALL_CATS.filter(c => fragments.some(f => f.categories.includes(c))).map(cat => (
                  <CategoryPill
                    key={cat}
                    label={`${CAT_CONFIG[cat].emoji} ${cat} ${fragments.filter(f => f.categories.includes(cat)).length}`}
                    active={activecat === cat}
                    onClick={() => setActiveCat(cat)}
                    color={CAT_CONFIG[cat].color}
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
          {!showHidden && status.total_fragments > 0 && view === 'theme' && (
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

function CategoryPill({ label, active, onClick, color }) {
  return (
    <div onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
      border: `1px solid ${active ? color : tint(color, 45)}`,
      background: active ? color : tint(color, 12),
      color: active ? 'var(--on-accent)' : color,
      userSelect: 'none', transition: 'all 0.15s',
    }}>
      {label}
    </div>
  )
}

function FragmentCard({ fragment, onHide, onContinue, onRestore, hidden = false }) {
  const primaryCat = fragment.categories[0]
  const cfg = primaryCat ? CAT_CONFIG[primaryCat] : { color: 'var(--text-hint)' }
  const score = fragment.quality_score || 0
  const scoreHigh = score >= 0.8

  return (
    <div style={{
      background: hidden ? 'var(--panel2)' : 'var(--card-grad)',
      border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', overflow: 'hidden',
      opacity: hidden ? 0.85 : 1,
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 14px 30px -22px rgba(0,0,0,0.7)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
    >
      {/* 左侧色条 */}
      <div style={{ width: 4, background: hidden ? 'var(--text-hint)' : cfg.color, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '14px 16px' }}>
        {/* 顶部：标题 + 质量分 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600, color: hidden ? 'var(--text-hint)' : 'var(--text-primary)', lineHeight: 1.4 }}>
            {fragment.ai_title || fragment.categories[0] || '片段'}
          </div>
          <div style={{
            flexShrink: 0, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: scoreHigh ? 'color-mix(in srgb, #9aab78 18%, transparent)' : 'var(--panel2)',
            color: scoreHigh ? '#9aab78' : 'var(--accent)',
          }}>
            质量 {score.toFixed(2)}
          </div>
        </div>

        {/* 正文（最多 4 行） */}
        <div style={{
          fontSize: 12.5, color: hidden ? 'var(--text-hint)' : 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 10,
          display: '-webkit-box', WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {fragment.content}
        </div>

        {/* AI 建议 */}
        {fragment.ai_hint && (
          <div style={{
            background: 'var(--panel2)', borderLeft: '2px solid var(--accent-light)',
            padding: '6px 10px', borderRadius: '0 4px 4px 0',
            fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.6,
          }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 4 }}>✦ AI建议：</span>
            {fragment.ai_hint}
          </div>
        )}

        {/* 分类标签 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {fragment.categories.map(cat => {
            const c = CAT_CONFIG[cat] || { color: 'var(--text-hint)' }
            return (
              <span key={cat} style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10,
                border: `1px solid ${tint(c.color, 45)}`,
                background: tint(c.color, 12), color: c.color,
              }}>
                {cat}
              </span>
            )
          })}
        </div>

        {/* 底部：来源 + 操作 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
            来自 {fragment.essay_date || '—'}{hidden ? ' · 已隐藏' : ''}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {hidden ? (
              <button
                onClick={() => onRestore(fragment.id)}
                style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11,
                  border: '1px solid #9aab78', background: 'color-mix(in srgb, #9aab78 14%, transparent)',
                  color: '#9aab78', cursor: 'pointer',
                }}
              >
                ↩ 恢复
              </button>
            ) : (
              <>
                <button
                  onClick={() => onHide(fragment.id)}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    border: '1px solid var(--border)', background: 'var(--panel)',
                    color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  隐藏
                </button>
                <button
                  onClick={() => onContinue(fragment)}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    border: '1px solid var(--accent)', background: 'var(--accent)',
                    color: 'var(--on-accent)', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  续写
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeClusterCard({ cluster, onContinue }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ background: 'var(--card-grad)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{cluster.theme_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
            跨越多篇随笔的共同主题
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, color: 'var(--accent)', background: 'var(--panel2)',
            padding: '2px 8px', borderRadius: 4,
          }}>
            {cluster.fragment_count} 个片段
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cluster.fragments.map(f => (
            <div
              key={f.id}
              style={{
                padding: '10px 12px', background: 'var(--panel2)', borderRadius: 7,
                border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)',
                lineHeight: 1.7, cursor: 'pointer', transition: 'background 0.15s',
                display: '-webkit-box', WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, var(--panel2))'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--panel2)'}
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
