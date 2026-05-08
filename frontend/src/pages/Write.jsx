import { useState } from 'react'
import { createEssay } from '../api'

export default function Write({ onSaved }) {
  const today = new Date().toISOString().split('T')[0]
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) { setError('标题和内容不能为空'); return }
    setSaving(true); setError('')
    try {
      await createEssay({ title, content, date })
      onSaved()
    } catch {
      setError('保存失败，请检查后端是否启动')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="write-page">
      <div className="write-header">
        <input
          className="title-input"
          placeholder="标题…"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <input
          type="date"
          className="date-input"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>
      <textarea
        className="content-input"
        placeholder="开始写作…"
        value={content}
        onChange={e => setContent(e.target.value)}
      />
      <div className="write-footer">
        <span className="word-count">{content.replace(/\s/g, '').length} 字</span>
        {error && <span className="error">{error}</span>}
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
