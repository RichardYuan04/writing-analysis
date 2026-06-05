import { useEffect, useState } from 'react'
import { getEssay, deleteEssay, updateEssay } from '../api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import WordCloud from '../components/WordCloud'

export default function EssayDetail({ id, onBack }) {
  const [essay, setEssay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editDate, setEditDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getEssay(id).then(r => {
      setEssay(r.data)
      setEditTitle(r.data.title)
      setEditContent(r.data.content)
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
      const res = await updateEssay(id, { title: editTitle, content: editContent, date: editDate })
      setEssay(res.data)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditTitle(essay.title)
    setEditContent(essay.content)
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

  const posData = Object.entries(essay.pos_distribution || {}).map(([k, v]) => ({ name: k, count: v }))

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
          <textarea
            className="content-input"
            style={{ minHeight: 480, width: '100%', resize: 'vertical' }}
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
          />
          <div className="write-footer">
            <span className="word-count">{editContent.replace(/\s/g, '').length} 字</span>
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
          <div className="detail-content">{essay.content}</div>

          <div className="detail-analysis">
            <section className="section">
              <h2>词云</h2>
              <WordCloud words={essay.top_words} />
            </section>

            {posData.length > 0 && (
              <section className="section">
                <h2>词性分布</h2>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={posData}>
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6c63ff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            )}

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

            {essay.emotion_detail && <EmotionBreakdown detail={essay.emotion_detail} />}
          </div>
        </>
      )}
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
            <span style={{ width: 42, fontSize: 12, color: '#888', textAlign: 'right', flexShrink: 0 }}>{label}</span>
            <div style={{ flex: 1, background: '#f0ebe3', borderRadius: 4, height: 10, overflow: 'hidden' }}>
              <div style={{ width: `${val}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ width: 36, fontSize: 12, color: '#888', flexShrink: 0 }}>{val}%</span>
          </div>
        ))}
      </div>
    </section>
  )
}
