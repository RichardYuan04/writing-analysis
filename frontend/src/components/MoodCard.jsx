import { useState } from 'react'

/**
 * 今日心绪卡。
 * - variant="fresh"（默认）：保存后原地浮出，含 ✕ / 知道了 / 存为卡片
 * - variant="persisted"：详情页常驻，标题「当时的心绪」，无浮出动画
 */
export default function MoodCard({ mood, onDismiss, floating = false, variant = 'fresh' }) {
  const [savedHint, setSavedHint] = useState(false)
  if (!mood) return null

  const persisted = variant === 'persisted'
  const status = mood.ai_reply_status

  const renderReply = () => {
    if (mood.ai_reply) return <span>{mood.ai_reply}</span>
    if (status === 'skipped') return <span className="mc-faint">再多写一点，我就能读出更多。</span>
    if (status === 'error') return <span className="mc-faint">这次没读成，回头再点开看看。</span>
    return <span className="mc-typing">正在读你的文字</span>
  }

  const saveAsCard = () => {
    // TODO: 接 ljg-card 导出图；当前先给即时反馈
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 2200)
  }

  return (
    <div className={`mood-card${floating ? ' floating' : ''}`}>
      {!persisted && onDismiss && (
        <button className="mc-x" onClick={onDismiss} aria-label="收起">✕</button>
      )}
      <div className="mc-cap">{persisted ? '当时的心绪' : '今日心绪'}</div>

      <div className="mc-tone">{mood.tone_emoji} {persisted ? '' : '底色：'}{mood.tone}</div>

      {mood.keywords?.length > 0 && (
        <div className="mc-kw">
          {mood.keywords.map(k => <span key={k}>{k}</span>)}
        </div>
      )}

      <div className="mc-divider" />

      <div className={`mc-reply${mood.ai_reply ? '' : ' pending'}`}>
        <span className="mc-ic">💬</span>{renderReply()}
      </div>

      <div className="mc-privacy">
        ⓘ {persisted ? '持久化 · 最新一张覆盖' : '你的文字不会被用于训练模型'}
      </div>

      <div className="mc-acts">
        {savedHint && <span className="mc-saved">已存为卡片 ✓</span>}
        <button className="mc-soft" onClick={saveAsCard}>存为卡片</button>
        {!persisted && onDismiss && (
          <button className="mc-ghost" onClick={onDismiss}>知道了</button>
        )}
      </div>
    </div>
  )
}
