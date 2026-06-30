import { useState, useEffect } from 'react'
import {
  listStyleProfiles, generateStyleProfile, regenerateStyleProfile,
  updateStyleProfile, activateStyleProfile, deleteStyleProfile, saveSoulSettings,
} from '../api'
import EssayMultiPicker from './EssayMultiPicker'

const RATIONALE_LABELS = {
  rhythm: '句子节奏', imagery: '意象感官', emotion: '情绪表达',
  diction: '用词', signature: '标志性手法',
}

const displayName = (p, i) => p.name || `风格 ${i + 1}`

export default function SoulDocPanel() {
  const [profiles, setProfiles] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [taboo, setTaboo] = useState('')
  const [tabooDraft, setTabooDraft] = useState('')
  const [loading, setLoading] = useState(true)

  const [selectedId, setSelectedId] = useState(null)      // 当前编辑槽
  const [nameDraft, setNameDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [samplesDraft, setSamplesDraft] = useState([])

  const [picking, setPicking] = useState(false)           // 选篇态
  const [pickTargetId, setPickTargetId] = useState(null)  // null=新建，否则=重养该槽
  const [selectedEssayIds, setSelectedEssayIds] = useState([])

  const [busy, setBusy] = useState('')                    // '' | 'generating' | 'saving'
  const [showRationale, setShowRationale] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  const selected = profiles.find(p => p.id === selectedId) || null

  const syncDrafts = (p) => {
    setNameDraft(p.name || '')
    setContentDraft(p.content || '')
    setSamplesDraft(p.golden_samples || [])
    setShowRationale(false)
  }

  // 拉取列表；keepSel 指定加载后选中哪个槽（默认沿用当前选中，否则选默认槽）
  const reload = async (keepSel) => {
    const { data } = await listStyleProfiles()
    setProfiles(data.profiles)
    setActiveId(data.active_id)
    setTaboo(data.taboo)
    const want = keepSel != null ? keepSel : (selectedId != null ? selectedId : data.active_id)
    const sel = data.profiles.find(p => p.id === want)
    if (sel) { setSelectedId(sel.id); syncDrafts(sel) }
    else { setSelectedId(null) }
    return data
  }

  useEffect(() => {
    listStyleProfiles().then(({ data }) => {
      setProfiles(data.profiles)
      setActiveId(data.active_id)
      setTaboo(data.taboo); setTabooDraft(data.taboo)
      const sel = data.profiles.find(p => p.id === data.active_id)
      if (sel) { setSelectedId(sel.id); syncDrafts(sel) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const selectSlot = (p) => { setPicking(false); setSelectedId(p.id); syncDrafts(p) }

  const activate = async (id) => { await activateStyleProfile(id); await reload() }

  const startNew = () => { setPicking(true); setPickTargetId(null); setSelectedEssayIds([]) }
  const startRegen = (p) => { setPicking(true); setPickTargetId(p.id); setSelectedEssayIds(p.source_essay_ids || []) }

  const runGenerate = async () => {
    if (!selectedEssayIds.length) return
    setBusy('generating')
    try {
      const { data } = pickTargetId
        ? await regenerateStyleProfile(pickTargetId, selectedEssayIds)
        : await generateStyleProfile(selectedEssayIds)
      setPicking(false)
      await reload(data.id)
    } catch { /* 保留原状，不破坏 */ }
    setBusy('')
  }

  const flashSaved = () => { setSavedTip(true); setTimeout(() => setSavedTip(false), 1600) }

  const saveName = async () => {
    setBusy('saving')
    try { await updateStyleProfile(selectedId, { name: nameDraft }); await reload(selectedId); flashSaved() }
    catch { /* ignore */ }
    setBusy('')
  }
  const saveContent = async () => {
    setBusy('saving')
    try { await updateStyleProfile(selectedId, { content: contentDraft }); await reload(selectedId); flashSaved() }
    catch { /* ignore */ }
    setBusy('')
  }
  const saveSamples = async () => {
    setBusy('saving')
    try {
      const { data } = await updateStyleProfile(selectedId, { golden_samples: samplesDraft })
      setSamplesDraft(data.golden_samples || [])
      await reload(selectedId); flashSaved()
    } catch { /* ignore */ }
    setBusy('')
  }
  const removeSlot = async (id) => {
    await deleteStyleProfile(id)
    const data = await reload(null)
    if (!data.profiles.some(p => p.id === id)) { /* 已删，选中由 reload 兜底 */ }
  }

  const updateSample = (i, v) => setSamplesDraft(arr => arr.map((s, idx) => (idx === i ? v.slice(0, 200) : s)))
  const removeSample = (i) => setSamplesDraft(arr => arr.filter((_, idx) => idx !== i))
  const addSample = () => setSamplesDraft(arr => [...arr, ''])

  const saveTaboo = async () => {
    setBusy('saving')
    try { const { data } = await saveSoulSettings({ taboo: tabooDraft }); setTaboo(data.taboo); setTabooDraft(data.taboo); flashSaved() }
    catch { /* ignore */ }
    setBusy('')
  }

  if (loading) return null

  const selIdx = profiles.findIndex(p => p.id === selectedId)
  const contentDirty = selected && contentDraft !== (selected.content || '')
  const nameDirty = selected && nameDraft !== (selected.name || '')
  const samplesDirty = selected && JSON.stringify(samplesDraft) !== JSON.stringify(selected.golden_samples || [])

  return (
    <div className="section soul-panel">
      <h2>✦ 风格 SOUL 文档</h2>
      <p className="section-desc">
        AI 对你写作风格的概括，用来指导写作工具。最多养成 3 种风格（选不同的文章），指定一个为「默认」，写作工具会用默认风格。
      </p>

      {/* 风格卡 */}
      <div className="soul-slots">
        {profiles.map((p, i) => (
          <div
            key={p.id}
            className={`soul-slot${selectedId === p.id ? ' is-sel' : ''}${activeId === p.id ? ' is-active' : ''}`}
            onClick={() => selectSlot(p)}
          >
            <div className="soul-slot-top">
              <span className="soul-slot-name">{displayName(p, i)}</span>
              {activeId === p.id
                ? <span className="soul-slot-badge">默认 ✓</span>
                : <button className="soul-slot-setdef" onClick={(e) => { e.stopPropagation(); activate(p.id) }}>设为默认</button>}
            </div>
            <div className="soul-slot-meta">
              基于 {p.source_essay_ids?.length || 0} 篇{p.generated_at ? ` · ${p.generated_at.slice(0, 10)}` : ''}
            </div>
            <div className="soul-slot-preview">{(p.content || '').slice(0, 38) || '（空）'}</div>
          </div>
        ))}
        {profiles.length < 3 && !picking && (
          <button className="soul-slot soul-slot-add" onClick={startNew}>＋ 新建风格</button>
        )}
      </div>

      {profiles.length === 0 && !picking && (
        <div className="soul-hint">还没有风格——点「＋ 新建风格」，选几篇文章养成第一个。</div>
      )}

      {/* 选篇态（新建 / 重养） */}
      {picking && (
        <div className="soul-pick">
          <div className="soul-sub-h">
            {pickTargetId ? '重新选篇养成（覆盖该风格，名字不变）' : '选择文章，养成一个新风格'}
          </div>
          <EssayMultiPicker selectedIds={selectedEssayIds} onChange={setSelectedEssayIds} />
          {selectedEssayIds.length > 0 && selectedEssayIds.length < 3 && (
            <div className="soul-hint">建议多选几篇（≥3），养出的风格更准。</div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="soul-btn-primary" disabled={selectedEssayIds.length === 0 || busy === 'generating'} onClick={runGenerate}>
              {busy === 'generating' ? '正在养成…（几秒）' : '✦ 养成'}
            </button>
            <button className="soul-btn-ghost" onClick={() => setPicking(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 当前编辑槽 */}
      {selected && !picking && (
        <div className="soul-edit">
          {/* 名字 */}
          <div className="soul-sub">
            <div className="soul-sub-h">风格名（留空显示「风格 {selIdx + 1}」）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="soul-name-input"
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                placeholder={`风格 ${selIdx + 1}`}
              />
              <button className="soul-btn-primary" disabled={busy === 'saving' || !nameDirty} onClick={saveName}>保存名字</button>
            </div>
          </div>

          {/* 正文 */}
          <textarea className="soul-textarea" value={contentDraft} onChange={e => setContentDraft(e.target.value)}
            rows={5} placeholder="（SOUL 文档内容）" />
          <div className="soul-meta">
            基于 {selected.source_essay_ids?.length || 0} 篇
            {selected.generated_at && ` · 上次养成 ${selected.generated_at.slice(0, 10)}`}
            {selected.user_edited ? ' · 已手改' : ''}
          </div>

          {/* 分维度依据 */}
          {selected.rationale && Object.keys(selected.rationale).length > 0 && (
            <div>
              <button className="soul-link" onClick={() => setShowRationale(v => !v)}>
                {showRationale ? '收起依据 ▴' : '查看分维度依据 ▾'}
              </button>
              {showRationale && (
                <div className="soul-rationale">
                  {Object.entries(RATIONALE_LABELS).map(([k, label]) =>
                    selected.rationale[k] ? (
                      <div key={k} className="soul-rationale-row">
                        <span className="soul-rationale-k">{label}</span>
                        <span className="soul-rationale-v">{selected.rationale[k]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="soul-btn-primary" disabled={!contentDirty || busy === 'saving'} onClick={saveContent}>
              {busy === 'saving' ? '保存中…' : '保存'}
            </button>
            <button className="soul-btn-ghost" onClick={() => startRegen(selected)}>重新选篇养成</button>
            <button className="soul-btn-ghost soul-btn-danger" onClick={() => removeSlot(selected.id)}>删除该风格</button>
            {savedTip && <span className="soul-saved">已保存 ✓</span>}
          </div>

          {/* 黄金样例（本槽） */}
          <div className="soul-sub">
            <div className="soul-sub-h">黄金样例（本风格的语感参照，可改：换成你自选片段，每条 ≤200 字）</div>
            <div className="soul-samples">
              {samplesDraft.map((s, i) => (
                <div key={i} className="soul-sample-edit">
                  <textarea className="soul-textarea" value={s} maxLength={200} rows={3}
                    placeholder="粘贴一段你满意的原文片段…" onChange={e => updateSample(i, e.target.value)} />
                  <div className="soul-sample-foot">
                    <span className="soul-sample-count">{s.length}/200</span>
                    <button className="soul-link" onClick={() => removeSample(i)}>删除</button>
                  </div>
                </div>
              ))}
              {samplesDraft.length === 0 && (
                <div className="soul-hint">还没有样例。点「＋ 添加一条」粘贴你满意的片段。</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="soul-btn-ghost" onClick={addSample}>＋ 添加一条</button>
              <button className="soul-btn-primary" disabled={busy === 'saving' || !samplesDirty} onClick={saveSamples}>
                {busy === 'saving' ? '保存中…' : '保存样例'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局共用禁止项 */}
      <div className="soul-sub">
        <div className="soul-sub-h">禁止项（去 AI 腔，三种风格共用，对所有写作工具生效，可改）</div>
        <textarea className="soul-textarea" value={tabooDraft} onChange={e => setTabooDraft(e.target.value)} rows={7} />
        <button className="soul-btn-primary" disabled={busy === 'saving' || tabooDraft === taboo} onClick={saveTaboo}>
          {busy === 'saving' ? '保存中…' : '保存禁止项'}
        </button>
      </div>
    </div>
  )
}
