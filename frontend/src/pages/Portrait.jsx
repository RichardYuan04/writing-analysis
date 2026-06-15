import { useEffect, useState } from 'react'
import { getPortrait, essayDeepAnalysis } from '../api'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import EssayPicker from '../components/EssayPicker'
import SoulDocPanel from '../components/SoulDocPanel'
import {
  AuthorCard, WordCloudPanel, DimensionsPanel,
  StructureTimeline, KeyPointsPanel, SentimentBar,
} from '../components/DeepAnalysisResult'

export default function Portrait() {
  const [portrait, setPortrait] = useState(null)
  const [loading, setLoading] = useState(true)
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

      <SoulDocPanel />

      {/* 灵魂词汇（按词性分类） */}
      {portrait.soul_words_by_pos && (
        <div className="section">
          <h2>灵魂词汇</h2>
          <p className="section-desc">跨越多篇文章反复出现的词，构成你写作的 DNA</p>
          <SoulWordsByPos data={portrait.soul_words_by_pos} />
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

      {/* 单篇深度解读 */}
      <div className="section">
        <h2>单篇深度解读</h2>
        <p className="section-desc">选择一篇随笔，由 Gemini AI 生成六维度文学分析</p>

        <EssayPicker onAnalyze={handleEssayDeepAnalysis} />

        {deepError && (
          <div style={{
            marginTop: 16, padding: '12px 16px', background: 'color-mix(in srgb, #e07a6a 12%, transparent)',
            border: '1px solid color-mix(in srgb, #e07a6a 40%, transparent)', borderRadius: 8,
            fontSize: 13, color: '#e07a6a',
          }}>
            {deepError}
          </div>
        )}

        {deepResult && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--text-hint)', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
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

const POS_GROUPS = [
  { key: 'nouns', label: '名词' },
  { key: 'verbs', label: '动词' },
  { key: 'adjs',  label: '形容词' },
]

function SoulWordsByPos({ data }) {
  const hasAny = POS_GROUPS.some(g => data[g.key]?.length > 0)
  if (!hasAny) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {POS_GROUPS.map(({ key, label }) => {
        const words = data[key] || []
        if (words.length === 0) return null
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em',
            }}>{label}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {words.map(w => (
                <span key={w} className="soul-word">{w}</span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
