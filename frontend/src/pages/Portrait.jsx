import { useEffect, useState } from 'react'
import { getPortrait, deepAnalysis, essayDeepAnalysis } from '../api'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import EssayPicker from '../components/EssayPicker'
import {
  AuthorCard, WordCloudPanel, DimensionsPanel,
  StructureTimeline, KeyPointsPanel, SentimentBar,
} from '../components/DeepAnalysisResult'

export default function Portrait() {
  const [portrait, setPortrait] = useState(null)
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')

  // 单篇深度解读状态
  const [deepResult, setDeepResult] = useState(null)
  const [deepError, setDeepError] = useState('')
  const [analyzedTitle, setAnalyzedTitle] = useState('')

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

  const handleEssayDeepAnalysis = async (essayId, title) => {
    setDeepResult(null)
    setDeepError('')
    setAnalyzedTitle(title)
    try {
      const r = await essayDeepAnalysis(essayId)
      setDeepResult(r.data)
    } catch (e) {
      setDeepError(e.response?.data?.detail || '分析失败，请稍后重试')
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
      <p className="portrait-sub">基于你全部随笔的本地分析，无数据上传</p>

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

      {/* 原有深度解读（保留） */}
      <div className="section deep-section">
        <h2>深度解读 · 像哪位作家</h2>
        <p className="section-desc">由 Claude AI 基于全部随笔生成文学肖像</p>
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

      {/* 新：单篇深度解读 */}
      <div className="section">
        <h2>单篇深度解读</h2>
        <p className="section-desc">选择一篇随笔，由 Gemini AI 生成六维度文学分析</p>

        <EssayPicker onAnalyze={handleEssayDeepAnalysis} />

        {deepError && (
          <div style={{
            marginTop: 16, padding: '12px 16px', background: '#fff5f5',
            border: '1px solid #fecaca', borderRadius: 8,
            fontSize: 13, color: '#dc2626',
          }}>
            {deepError}
          </div>
        )}

        {deepResult && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 13, color: '#aaa', borderBottom: '1px solid #ede6da', paddingBottom: 10 }}>
              《{analyzedTitle}》分析结果
            </div>
            <AuthorCard persona={deepResult.literaryPersona} />
            <WordCloudPanel words={deepResult.wordCloud} />
            <DimensionsPanel dimensions={deepResult.dimensions} />
            <StructureTimeline nodes={deepResult.structure.nodes} />
            <KeyPointsPanel points={deepResult.keyPoints} />
            <SentimentBar sentiment={deepResult.sentiment} />
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
