import { useEffect, useState } from 'react'
import { getPortrait, deepAnalysis } from '../api'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'

export default function Portrait() {
  const [portrait, setPortrait] = useState(null)
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getPortrait()
      .then(r => { setPortrait(r.data); setLoading(false) })
      .catch(e => {
        setError(e.response?.data?.detail || '加载失败')
        setLoading(false)
      })
  }, [])

  const handleDeepAnalysis = async () => {
    setAnalyzing(true)
    setAnalysis('')
    try {
      const r = await deepAnalysis()
      setAnalysis(r.data.analysis)
    } catch (e) {
      setAnalysis('调用失败，请检查 API Key 是否正确')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <div className="loading">画像生成中...</div>
  if (error) return <div className="empty">{error}</div>
  if (!portrait) return null

  const radarData = [
    { dim: '词汇丰富度', value: Math.round(portrait.ttr * 100) },
    { dim: '情感强度', value: Math.round(portrait.avg_sentiment * 100) },
    { dim: '情感稳定性', value: Math.round((1 - Math.min(portrait.sentiment_std * 5, 1)) * 100) },
    { dim: '篇幅密度', value: Math.min(Math.round(portrait.avg_words_per_essay / 20), 100) },
    { dim: '句式长度', value: Math.min(Math.round(portrait.avg_sentence_length * 2), 100) },
  ]

  return (
    <div className="portrait-page">
      <h1 className="portrait-title">你的写作画像</h1>
      <p className="portrait-sub">基于你全部 {portrait.soul_words ? '随笔' : ''} 的本地分析，无数据上传</p>

      {/* 雷达图 */}
      <div className="section">
        <h2>写作维度雷达</h2>
        <ResponsiveContainer width="100%" height={260}>
          <RadarChart data={radarData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dim" tick={{ fontSize: 13 }} />
            <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* 灵魂词汇 */}
      {portrait.soul_words?.length > 0 && (
        <div className="section">
          <h2>灵魂词汇</h2>
          <p className="section-desc">跨越多篇文章反复出现的词，构成你写作的 DNA</p>
          <div className="soul-words">
            {portrait.soul_words.map(w => (
              <span key={w} className="soul-word">{w}</span>
            ))}
          </div>
        </div>
      )}

      {/* 维度详情 */}
      <div className="section">
        <h2>风格解读</h2>
        <div className="portrait-dims">
          <DimRow icon="🎭" label="情感基调" value={portrait.tone} />
          <DimRow icon="✍️" label="句式偏好" value={portrait.sentence_style} />
          <DimRow icon="📚" label="词汇丰富度" value={portrait.vocab_richness} />
          <DimRow icon="🧭" label="叙事视角" value={portrait.self_orientation} />
          <DimRow icon="⏳" label="时间取向" value={portrait.time_orient} />
          <DimRow icon="💬" label="标点习惯" value={portrait.punct_style} />
          <DimRow icon="📄" label="段落风格" value={portrait.para_style} />
          <DimRow icon="📝" label="篇幅偏好" value={portrait.volume_style} />
          <DimRow icon="🔤" label="词性倾向" value={portrait.pos_style} />
        </div>
      </div>

      {/* 深度解读按钮 */}
      <div className="section deep-section">
        <h2>深度解读 · 像哪位作家</h2>
        <p className="section-desc">由 Claude AI 生成文学肖像，并找出与你风格最相近的作家</p>
        {!analysis && (
          <button className="deep-btn" onClick={handleDeepAnalysis} disabled={analyzing}>
            {analyzing ? '正在分析，稍等片刻...' : '✨ 开始深度解读'}
          </button>
        )}
        {analysis && (
          <div className="analysis-result">
            {analysis.split('\n').map((line, i) => (
              <p key={i} className={line.startsWith('**') ? 'analysis-heading' : 'analysis-body'}>
                {line.replace(/\*\*/g, '')}
              </p>
            ))}
            <button className="reset-btn" style={{ marginTop: 16 }} onClick={handleDeepAnalysis}>
              重新生成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DimRow({ icon, label, value }) {
  return (
    <div className="dim-row">
      <span className="dim-icon">{icon}</span>
      <span className="dim-label">{label}</span>
      <span className="dim-value">{value}</span>
    </div>
  )
}
