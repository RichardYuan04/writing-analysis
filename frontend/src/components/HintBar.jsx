export default function HintBar({ text }) {
  return (
    <div className="hint-bar">
      <span className="hint-bar-icon">✦</span>
      <span>{text}</span>
    </div>
  )
}
