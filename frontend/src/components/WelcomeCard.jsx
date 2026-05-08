export default function WelcomeCard({ onWrite }) {
  return (
    <div className="welcome-card">
      <div className="welcome-icon">✦</div>
      <h2 className="welcome-title">你好，这里是文字时光机</h2>
      <p className="welcome-desc">
        写下第一篇随笔，开始记录属于你的文字轨迹。<br />
        每一篇文字，都会成为认识自己的一面镜子。
      </p>
      <button className="welcome-btn" onClick={onWrite}>写下第一篇</button>
    </div>
  )
}
