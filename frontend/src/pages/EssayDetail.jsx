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
          </div>
        </>
      )}
    </div>
  )
}
