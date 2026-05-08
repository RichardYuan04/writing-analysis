import { useEffect, useState } from 'react'
import { getRandomEssay } from '../api'

export default function TodayReview({ onSelect }) {
  const [essay, setEssay] = useState(null)

  useEffect(() => {
    getRandomEssay()
      .then(r => setEssay(r.data))
      .catch(() => {})
  }, [])

  if (!essay) return null

  const sentimentLabel = (score) => {
    if (score > 0.65) return '😊'
    if (score < 0.35) return '😔'
    return '😐'
  }

  return (
    <div className="today-review" onClick={() => onSelect(essay.id)}>
      <div className="today-review-header">
        <span className="today-review-label">今日回顾</span>
        <span className="today-review-meta">{essay.date} · {sentimentLabel(essay.sentiment_score)}</span>
      </div>
      <div className="today-review-title">{essay.title}</div>
      <div className="today-review-preview">{essay.preview}</div>
    </div>
  )
}
