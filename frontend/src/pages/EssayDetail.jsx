import { useEffect, useState, useRef } from 'react'
import { getEssay, deleteEssay, updateEssay } from '../api'
import WordCloud from '../components/WordCloud'
import MoodCard from '../components/MoodCard'
import RichEditor from '../components/RichEditor'
import RichViewer from '../components/RichViewer'
import { blocksToPlainText, parseRich } from '../components/richSchema'
import ReaderLetterbox from '../components/ReaderLetterbox'

export default function EssayDetail({ id, onBack }) {
  const [essay, setEssay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDocBlocks, setEditDocBlocks] = useState(null)
  const [editDate, setEditDate] = useState('')
  const [saving, setSaving] = useState(false)
  const richRef = useRef(null)

  useEffect(() => {
    getEssay(id).then(r => {
      setEssay(r.data)
      setEditTitle(r.data.title)
      setEditDocBlocks(parseRich(r.data.content_rich, r.data.content))
      setEditDate(r.data.date)
      setLoading(false)
    })
  }, [id])

  const handleDelete = async () => {
    if (confirm('确定删除这篇随笔？')) {
      await deleteEssay(id)
      onBack()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const blocks = richRef.current ? richRef.current.getDoc() : editDocBlocks
      const res = await updateEssay(id, {
        title: editTitle,
        content: blocksToPlainText(blocks),
        date: editDate,
        content_rich: JSON.stringify(blocks),
      })
      setEssay(res.data)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditTitle(essay.title)
    setEditDocBlocks(parseRich(essay.content_rich, essay.content))
    setEditDate(essay.date)
    setEditing(false)
  }

  if (loading) return <div className="loading">分析中...</div>
  if (!essay) return null


  const sentimentLabel = (score) => {
    if (score > 0.65) return '😊 积极'
    if (score < 0.35) return '😔 消极'
    return '😐 平静'
  }

  const posData = POS_ORDER
    .filter(k => essay.pos_distribution?.[k])
    .map(k => ({ name: k, count: essay.pos_distribution[k], color: POS_COLORS[k] }))

  return (
    <div className="detail">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
              <button className="back-btn" onClick={handleCancelEdit}>取消</button>
            </>
          ) : (
            <>
              <button className="edit-btn" onClick={() => setEditing(true)}>编辑</button>
              <button className="delete-btn" onClick={handleDelete}>删除</button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="edit-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="write-header">
            <input
              className="title-input"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="标题..."
            />
            <input
              type="date"
              className="date-input"
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
            />
          </div>
          <RichEditor
            ref={richRef}
            initialContent={editDocBlocks || undefined}
            onChange={setEditDocBlocks}
          />
          <div className="write-footer">
            <span className="word-count">{blocksToPlainText(editDocBlocks || []).replace(/\s/g, '').length} 字</span>
          </div>
        </div>
      ) : (
        <>
          <h1 className="detail-title">{essay.title}</h1>
          <div className="detail-meta">
            <span>{essay.date}</span>
            <span>{essay.word_count} 字</span>
            <span>{sentimentLabel(essay.sentiment)}</span>
            <span>情感分: {essay.sentiment?.toFixed(2)}</span>
          </div>
          <div className="detail-content detail-rich">
            <RichViewer key={essay.id} blocks={parseRich(essay.content_rich, essay.content)} />
          </div>

          {essay.mood_card && (
            <MoodCard mood={essay.mood_card} variant="persisted" />
          )}

          <ReaderLetterbox
            essayId={essay.id}
            title={essay.title}
            content={essay.content}
            initialLetters={essay.letters || []}
          />

          <div className="detail-analysis">
            <section className="section">
              <h2>词云</h2>
              <WordCloud words={essay.top_words} />
            </section>

            <div className="detail-cols">
              {/* 左列：词性分布（矮）+ 情绪分布（中），叠起来与右列等高 */}
              <div className="detail-col">
                {posData.length > 0 && (
                  <section className="section">
                    <h2>词性分布</h2>
                    <PosDonut data={posData} />
                  </section>
                )}
                {essay.emotion_detail && <EmotionBreakdown detail={essay.emotion_detail} />}
              </div>

              {/* 右列：高频词 Top 10（满十行） */}
              <div className="detail-col">
                <section className="section">
                  <h2>高频词 Top 10</h2>
                  <div className="top-words">
                    {essay.top_words?.slice(0, 10).map((w, i) => (
                      <div key={w.word} className="top-word-item">
                        <span className="rank">#{i + 1}</span>
                        <span className="word">{w.word}</span>
                        <span className="count">{w.count} 次</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 词性：固定展示顺序 + 各自语义色（取自全站调色板，明暗主题通用）
// 「其他」= 连词/介词/助词/数词/量词等，用中性灰，让有信息量的词性更醒目
const POS_ORDER = ['名词', '动词', '形容词', '副词', '代词', '其他']
const POS_COLORS = {
  名词: '#8aa0bc', 动词: '#9aab78', 形容词: '#d6a468',
  副词: '#bd8aa2', 代词: '#7ba39b', 其他: '#c2bcc8',
}
const POS_CONTENT = ['名词', '动词', '形容词']   // 实词：中心主导词只在这三类里选

// 自定义 SVG 环形图：按占比分段着色，中心点出主导词性，右侧图例列三项百分比
function PosDonut({ data }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const pct = (n) => Math.round((n / total) * 100)
  // 中心点出主导「实词」（名/动/形里占比最高的），不让「其他」抢焦点
  const contentData = data.filter(d => POS_CONTENT.includes(d.name))
  const dominant = (contentData.length ? contentData : data).reduce((a, b) => (b.count > a.count ? b : a))

  const R = 54, STROKE = 20, C = 2 * Math.PI * R
  let acc = 0   // 累计占比，用于排布各段起点

  return (
    <div className="pos-donut-wrap">
      <div className="pos-donut">
        <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--border-soft)" strokeWidth={STROKE} opacity="0.5" />
          <g transform="rotate(-90 70 70)">
            {data.map((d) => {
              const frac = d.count / total
              const seg = (
                <circle
                  key={d.name}
                  cx="70" cy="70" r={R} fill="none"
                  stroke={d.color} strokeWidth={STROKE} strokeLinecap="butt"
                  strokeDasharray={`${frac * C} ${C - frac * C}`}
                  strokeDashoffset={-acc * C}
                />
              )
              acc += frac
              return seg
            })}
          </g>
        </svg>
        <div className="pos-donut-center">
          <div className="pos-dom-name">{dominant.name}</div>
          <div className="pos-dom-pct">{pct(dominant.count)}%</div>
        </div>
      </div>
      <div className="pos-legend">
        {data.map((d) => (
          <div key={d.name} className="pos-legend-row">
            <span className="pos-dot" style={{ background: d.color }} />
            <span className="pos-legend-name">{d.name}</span>
            <span className="pos-legend-pct">{pct(d.count)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const EMOTION_CONFIG = {
  joy:         { label: '喜悦', color: '#f59e0b' },
  gratitude:   { label: '感恩', color: '#10b981' },
  love:        { label: '爱意', color: '#ec4899' },
  neutral:     { label: '平静', color: '#94a3b8' },
  surprise:    { label: '惊奇', color: '#8b5cf6' },
  sadness:     { label: '悲伤', color: '#3b82f6' },
  fear:        { label: '恐惧', color: '#6366f1' },
  anger:       { label: '愤怒', color: '#ef4444' },
  disgust:     { label: '厌恶', color: '#84cc16' },
  frustration: { label: '沮丧', color: '#f97316' },
  contempt:    { label: '轻蔑', color: '#a78bfa' },
}

function EmotionBreakdown({ detail }) {
  const sorted = Object.entries(detail)
    .map(([key, val]) => ({ key, val, ...EMOTION_CONFIG[key] }))
    .sort((a, b) => b.val - a.val)

  return (
    <section className="section">
      <h2>情绪分布</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {sorted.map(({ key, label, val, color }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 42, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{label}</span>
            <div style={{ flex: 1, background: 'var(--border-soft)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
              <div style={{ width: `${val}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ width: 36, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0, fontFamily: 'var(--font-display)' }}>{val}%</span>
          </div>
        ))}
      </div>
    </section>
  )
}
