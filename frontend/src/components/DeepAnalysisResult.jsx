// 六模块分析结果展示组件

// 1. 像哪位作家（深色「文学回响」特征卡，明暗主题下都保持暖暗质感）
export function AuthorCard({ persona }) {
  return (
    <div style={{
      background: 'linear-gradient(160deg, #2a1d12, #1c130b)', borderRadius: 16, padding: 24,
      color: 'var(--text-primary)', position: 'relative', overflow: 'hidden',
      border: '1px solid var(--border)',
    }}>
      <div style={{
        position: 'absolute', right: 16, top: -16,
        fontSize: 120, fontFamily: 'var(--font-display)',
        color: 'rgba(243,199,129,0.06)', lineHeight: 1, userSelect: 'none',
      }}>"</div>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#b89a72', marginBottom: 10, fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
        文学回响 · Echo of Style
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 30, fontFamily: 'var(--font-serif)', fontWeight: 'bold', color: '#f3ece0' }}>
          {persona.author}
        </span>
        <span style={{
          background: 'rgba(243,199,129,0.18)', color: '#f3c781',
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
        borderTop: '1px solid rgba(243,199,129,0.12)', paddingTop: 16,
      }}>
        {[
          { label: '写作风格', text: persona.similarities.style },
          { label: '地域精神', text: persona.similarities.countryOrigin },
          { label: '叙事逻辑', text: persona.similarities.logic },
          { label: '精神气质', text: persona.similarities.spirit },
        ].map(({ label, text }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#e89b50', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
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
    <div style={{ background: 'var(--card-grad)', borderRadius: 16, padding: 24, border: '1px solid var(--border)' }}>
      <SectionTitle title="词汇氛围图谱" />
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12 }}>AI 提取的意象词汇，字号反映权重</div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px 10px',
        justifyContent: 'center', alignItems: 'center',
        padding: 16, background: 'var(--panel2)', borderRadius: 8,
        border: '1px dashed var(--border)',
      }}>
        {words.map((item, i) => (
          <span key={i} style={{
            fontFamily: 'var(--font-serif)',
            fontSize: `${0.75 + item.weight * 0.14}rem`,
            fontWeight: item.weight > 5 ? 700 : 400,
            opacity: 0.45 + (item.weight / 10) * 0.55,
            color: item.weight > 7 ? 'var(--accent)' : 'var(--text-secondary)',
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
  lexical: '#d6a468',
  syntactic: '#9aab78',
  affective: '#d08a8a',
  narrative: '#8aa0bc',
}

export function DimensionsPanel({ dimensions }) {
  const groups = ['lexical', 'syntactic', 'affective', 'narrative']
  return (
    <div style={{ background: 'var(--card-grad)', borderRadius: 16, padding: 24, border: '1px solid var(--border)' }}>
      <SectionTitle title="深度语言维度" />
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>四个层面的语言分析，0–100 分</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {groups.map(key => {
          const group = dimensions[key]
          const color = DIM_COLORS[key]
          return (
            <div key={key}>
              <div style={{
                fontSize: 10, color: 'var(--accent)', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginBottom: 10,
                paddingBottom: 6, borderBottom: '1px solid var(--border)',
                fontFamily: 'var(--font-display)',
              }}>
                {group.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.metrics.map((m, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-hint)', fontFamily: 'var(--font-display)' }}>{m.value}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border-soft)', borderRadius: 2, overflow: 'hidden' }}>
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
  introduction: '#e89b50',
  conclusion: '#c6b39a',
  argument: '#9c8568',
  narrative_point: '#9c8568',
}

export function StructureTimeline({ nodes }) {
  return (
    <div style={{ background: 'var(--card-grad)', borderRadius: 16, padding: 24, border: '1px solid var(--border)' }}>
      <SectionTitle title="文本结构映射" />
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>AI 识别的叙事节点</div>
      <div style={{ position: 'relative', paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{
          position: 'absolute', left: 8, top: 6, bottom: 6,
          width: 1, background: 'var(--border)',
        }} />
        {nodes.map((node, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: -24, top: 2,
              width: 14, height: 14, borderRadius: '50%',
              background: NODE_COLORS[node.type] || '#9c8568',
              border: '2px solid var(--bg)',
              boxShadow: '0 0 0 1px var(--border)',
            }} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--text-primary)', fontWeight: 'bold', marginBottom: 4 }}>
              {node.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{node.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 5. 核心意蕴提取
export function KeyPointsPanel({ points }) {
  return (
    <div style={{ background: 'var(--card-grad)', borderRadius: 16, padding: 24, border: '1px solid var(--border)' }}>
      <SectionTitle title="核心意蕴提取" />
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>这篇文章最重要的思想节点</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {points.map((point, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14,
            padding: '12px 14px', background: 'var(--panel2)',
            borderRadius: 8, border: '1px solid var(--border)',
          }}>
            <span style={{
              fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--accent-light)',
              fontStyle: 'italic', flexShrink: 0, lineHeight: 1.2,
            }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}>{point}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 6. 情感光谱（深色特征卡）
export function SentimentBar({ sentiment }) {
  const score = sentiment.score // -1 to 1
  const isPositive = score >= 0
  const barColor = score > 0.3 ? '#9aab78' : score < -0.3 ? '#d08a8a' : '#e89b50'

  return (
    <div style={{ background: 'linear-gradient(160deg, #2a1d12, #1c130b)', borderRadius: 16, padding: '20px 24px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.2em', color: '#b89a72', textTransform: 'uppercase', fontFamily: 'var(--font-display)' }}>
          情感光谱 · Sentiment Spectrum
        </span>
        <span style={{ fontSize: 12, color: '#f3c781', fontWeight: 'bold' }}>{sentiment.label}</span>
      </div>
      <div style={{ position: 'relative', height: 4, background: 'rgba(243,199,129,0.10)', borderRadius: 2, marginBottom: 10 }}>
        <div style={{
          position: 'absolute', left: '50%', top: -3,
          width: 1, height: 10, background: 'rgba(243,199,129,0.22)',
        }} />
        <div style={{
          position: 'absolute', height: '100%',
          left: isPositive ? '50%' : `${50 + score * 50}%`,
          width: `${Math.abs(score) * 50}%`,
          background: barColor, borderRadius: 2,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8c7560' }}>
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
      <div style={{ width: 3, height: 16, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--text-primary)', fontWeight: 'bold' }}>{title}</span>
    </div>
  )
}
