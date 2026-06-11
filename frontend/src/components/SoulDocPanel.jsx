import { useState, useEffect } from 'react'
import { getStyleProfile, generateStyleProfile, saveStyleProfile } from '../api'
import EssayMultiPicker from './EssayMultiPicker'

const RATIONALE_LABELS = {
  rhythm: '句子节奏', imagery: '意象感官', emotion: '情绪表达',
  diction: '用词', signature: '标志性手法',
}

export default function SoulDocPanel() {
  const [profile, setProfile] = useState(null)     // {exists, content, rationale, ...}
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)     // 是否在选篇态
  const [selectedIds, setSelectedIds] = useState([])
  const [draft, setDraft] = useState('')            // 可编辑文本
  const [busy, setBusy] = useState('')              // '' | 'generating' | 'saving'
  const [showRationale, setShowRationale] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  useEffect(() => {
    getStyleProfile().then(r => {
      setProfile(r.data)
      if (r.data.exists) { setDraft(r.data.content || ''); setSelectedIds(r.data.source_essay_ids || []) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const generate = async () => {
    if (selectedIds.length === 0) return
    setBusy('generating')
    try {
      const r = await generateStyleProfile(selectedIds)
      setProfile({ exists: true, ...r.data, new_essays_since: 0 })
      setDraft(r.data.content || '')
      setPicking(false)
    } catch { /* 保留旧文档，不破坏 */ }
    setBusy('')
  }

  const save = async () => {
    setBusy('saving')
    try {
      const r = await saveStyleProfile(draft)
      setProfile(p => ({ ...p, exists: true, ...r.data }))
      setSavedTip(true); setTimeout(() => setSavedTip(false), 1600)
    } catch { /* ignore */ }
    setBusy('')
  }

  if (loading) return null

  const has = profile?.exists
  const dirty = has && draft !== (profile.content || '')

  return (
    <div className="section soul-panel">
      <h2>✦ 风格 SOUL 文档</h2>
      <p className="section-desc">
        这是 AI 对你写作风格的概括，会用来指导写作工具，让它写得更像你。由你框定哪几篇文章来养成。
      </p>

      {/* 重养提示 */}
      {has && !picking && profile.new_essays_since >= 5 && (
        <div className="soul-nudge" onClick={() => setPicking(true)}>
          你又写了 {profile.new_essays_since} 篇，要不要纳入重养？
        </div>
      )}

      {/* 选篇态 */}
      {picking || !has ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <EssayMultiPicker selectedIds={selectedIds} onChange={setSelectedIds} />
          {selectedIds.length > 0 && selectedIds.length < 3 && (
            <div className="soul-hint">建议多选几篇（≥3），养出的风格更准。</div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="soul-btn-primary" disabled={selectedIds.length === 0 || busy === 'generating'} onClick={generate}>
              {busy === 'generating' ? '正在养成…（几秒）' : '✦ 养成 SOUL 文档'}
            </button>
            {has && <button className="soul-btn-ghost" onClick={() => setPicking(false)}>取消</button>}
          </div>
        </div>
      ) : (
        /* 已有态 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea className="soul-textarea" value={draft} onChange={e => setDraft(e.target.value)}
            rows={5} placeholder="（SOUL 文档内容）" />
          <div className="soul-meta">
            基于 {profile.source_essay_ids?.length || 0} 篇
            {profile.generated_at && ` · 上次养成 ${profile.generated_at.slice(0, 10)}`}
            {profile.user_edited ? ' · 已手改' : ''}
          </div>

          {/* 分维度依据（折叠） */}
          {profile.rationale && Object.keys(profile.rationale).length > 0 && (
            <div>
              <button className="soul-link" onClick={() => setShowRationale(v => !v)}>
                {showRationale ? '收起依据 ▴' : '查看分维度依据 ▾'}
              </button>
              {showRationale && (
                <div className="soul-rationale">
                  {Object.entries(RATIONALE_LABELS).map(([k, label]) =>
                    profile.rationale[k] ? (
                      <div key={k} className="soul-rationale-row">
                        <span className="soul-rationale-k">{label}</span>
                        <span className="soul-rationale-v">{profile.rationale[k]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="soul-btn-primary" disabled={!dirty || busy === 'saving'} onClick={save}>
              {busy === 'saving' ? '保存中…' : '保存'}
            </button>
            <button className="soul-btn-ghost" onClick={() => setPicking(true)}>重新选篇养成</button>
            {savedTip && <span className="soul-saved">已保存 ✓</span>}
          </div>
        </div>
      )}
    </div>
  )
}
