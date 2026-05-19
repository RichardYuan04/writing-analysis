// 六模块分析结果展示组件

// 1. 像哪位作家
export function AuthorCard({ persona }) {
  return (
    <div style={{
      background: '#2d1f14', borderRadius: 12, padding: 24, color: 'white',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', right: 16, top: -16,
        fontSize: 120, fontFamily: 'Georgia, serif',
        color: 'rgba(255,255,255,0.04)', lineHeight: 1, userSelect: 'none',
      }}>"</div>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#a89070', marginBottom: 10 }}>
        文学回响 · Echo of Style
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 30, fontFamily: 'Georgia, serif', fontWeight: 'bold', color: '#f5ede0' }}>
          {persona.author}
        </span>
        <span style={{
          background: 'rgba(212,169,106,0.2)', color: '#d4a96a',
          fontSize: 11, padding: '2px 8px', borderRadius: 4,
        }}>最相近</span>
      </div>
      <div style={{
        fontSize: 13, color: '#c8b89a', fontStyle: 'italic', lineHeight: 1.8,
        borderLeft: '2px solid #6b4f2a', paddingLeft: 14, marginBottom: 20,
      }}>
        {persona.reasoning}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
        borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16,
      }}>
        {[
          { label: '写作风格', text: persona.similarities.style },
          { label: '地域精神', text: persona.similarities.countryOrigin },
          { label: '叙事逻辑', text: persona.similarities.logic },
          { label: '精神气质', text: persona.similarities.spirit },
        ].map(({ label, text }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#8B6F47', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#d4c4b0', lineHeight: 1.6 }}>{text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 2. 词汇氛围图谱
export function WordCloudPanel({ words }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e0d5' }}>
      <SectionTitle title="词汇氛围图谱" />
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 12 }}>AI 提取的意象词汇，字号反映权重</div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px 10px',
        justifyContent: 'center', alignItems: 'center',
        padding: 16, background: '#faf8f5', borderRadius: 8,
        border: '1px dashed #e0d5c5',
      }}>
        {words.map((item, i) => (
          <span key={i} style={{
            fontSize: `${0.75 + item.weight * 0.14}rem`,
            fontWeight: item.weight > 5 ? 700 : 400,
            opacity: 0.3 + (item.weight / 10) * 0.7,
            color: item.weight > 7 ? '#3d2b1a' : '#6b5040',
            cursor: 'default',
          }}>
            {item.text}
          </span>
        ))}
      </div>
    </div>
  )
}

// 3. 深度语言维度
const DIM_COLORS = {
  lexical: '#c4935a',
  syntactic: '#8a9a6a',
  affective: '#c47a7a',
  narrative: '#7a8a9a',
}

export function DimensionsPanel({ dimensions }) {
  const groups = ['lexical', 'syntactic', 'affective', 'narrative']
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e0d5' }}>
      <SectionTitle title="深度语言维度" />
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 16 }}>四个层面的语言分析，0–100 分</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {groups.map(key => {
          const group = dimensions[key]
          const color = DIM_COLORS[key]
          return (
            <div key={key}>
              <div style={{
                fontSize: 10, color: '#a89070', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginBottom: 10,
                paddingBottom: 6, borderBottom: '1px solid #ede6da',
              }}>
                {group.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.metrics.map((m, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#666' }}>{m.label}</span>
                      <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>{m.value}%</span>
                    </div>
                    <div style={{ height: 4, background: '#f0ebe3', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${m.value}%`, background: color, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 4. 文本结构映射
const NODE_COLORS = {
  introduction: '#8B6F47',
  conclusion: '#5a4a3a',
  argument: '#d4c4b0',
  narrative_point: '#d4c4b0',
}

export function StructureTimeline({ nodes }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e0d5' }}>
      <SectionTitle title="文本结构映射" />
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 16 }}>AI 识别的叙事节点</div>
      <div style={{ position: 'relative', paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{
          position: 'absolute', left: 8, top: 6, bottom: 6,
          width: 1, background: '#ede6da',
        }} />
        {nodes.map((node, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: -24, top: 2,
              width: 14, height: 14, borderRadius: '50%',
              background: NODE_COLORS[node.type] || '#d4c4b0',
              border: '2px solid white',
              boxShadow: '0 0 0 1px #e8e0d5',
            }} />
            <div style={{ fontSize: 13, color: '#5a4a3a', fontWeight: 'bold', marginBottom: 4 }}>
              {node.title}
            </div>
            <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>{node.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 5. 核心意蕴提取
export function KeyPointsPanel({ points }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e8e0d5' }}>
      <SectionTitle title="核心意蕴提取" />
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 16 }}>这篇文章最重要的思想节点</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {points.map((point, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14,
            padding: '12px 14px', background: '#faf8f5',
            borderRadius: 8, border: '1px solid #ede6da',
          }}>
            <span style={{
              fontSize: 20, fontFamily: 'Georgia, serif', color: '#d4c4b0',
              fontStyle: 'italic', flexShrink: 0, lineHeight: 1.2,
            }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 13, color: '#5a4a3a', lineHeight: 1.7 }}>{point}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 6. 情感光谱
export function SentimentBar({ sentiment }) {
  const score = sentiment.score // -1 to 1
  const isPositive = score >= 0
  const barColor = score > 0.3 ? '#8a9a6a' : score < -0.3 ? '#c47a7a' : '#a89070'

  return (
    <div style={{ background: '#2d1f14', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#6b4f2a', textTransform: 'uppercase' }}>
          情感光谱 · Sentiment Spectrum
        </span>
        <span style={{ fontSize: 12, color: '#a89070', fontWeight: 'bold' }}>{sentiment.label}</span>
      </div>
      <div style={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 10 }}>
        <div style={{
          position: 'absolute', left: '50%', top: -3,
          width: 1, height: 10, background: 'rgba(255,255,255,0.15)',
        }} />
        <div style={{
          position: 'absolute', height: '100%',
          left: isPositive ? '50%' : `${50 + score * 50}%`,
          width: `${Math.abs(score) * 50}%`,
          background: barColor, borderRadius: 2,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b4f2a' }}>
        <span>← 沉郁</span>
        <span>中性</span>
        <span>明朗 →</span>
      </div>
    </div>
  )
}

// 通用 section 标题
function SectionTitle({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <div style={{ width: 3, height: 16, background: '#d4a96a', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 15, color: '#5a4a3a', fontWeight: 'bold' }}>{title}</span>
    </div>
  )
}
