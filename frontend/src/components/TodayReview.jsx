import { useEffect, useState } from 'react'
import { getRandomEssay } from '../api'
import { Face } from './Icon'

export default function TodayReview({ onSelect }) {
  const [essay, setEssay] = useState(null)

  useEffect(() => {
    getRandomEssay()
      .then(r => setEssay(r.data))
      .catch(() => {})
  }, [])

  if (!essay) return null

  const moodOf = (score) => (score > 0.65 ? 'positive' : score < 0.35 ? 'negative' : 'neutral')

  return (
    <div className="today-review" onClick={() => onSelect(essay.id)}>
      <div className="today-review-header">
        <span className="today-review-label">今日回顾</span>
        <span className="today-review-meta">{essay.date} · <Face mood={moodOf(essay.sentiment_score)} className="mood-face--sm" /></span>
      </div>
      <div className="today-review-title">{essay.title}</div>
      <div className="today-review-preview">{essay.preview}</div>
    </div>
  )
}
