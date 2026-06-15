import { FAMILIES, themeName } from '../themes'

export default function Settings({ family, mode, onFamily, onMode }) {
  return (
    <div className="settings-page">
      <h1 className="portrait-title">设置</h1>
      <p className="portrait-sub">Settings · 偏好与外观</p>

      {/* ── 外观 ── */}
      <section className="section">
        <h2>外观 · 主题</h2>
        <p className="section-desc">选一个色系，再切白昼 / 夜晚。改动即时生效，并会被记住。</p>

        {/* 色系色卡 */}
        <div className="set-label">色系</div>
        <div className="family-grid">
          {FAMILIES.map((f) => {
            const sw = f.swatch[mode] || f.swatch.dark
            const active = f.key === family
            return (
              <button
                key={f.key}
                className={`family-card ${active ? 'active' : ''}`}
                onClick={() => onFamily(f.key)}
              >
                <span className="family-swatch">
                  <i style={{ background: sw[0] }} />
                  <i style={{ background: sw[1] }} />
                  <i style={{ background: sw[2] }} />
                </span>
                <span className="family-name">{f.name}</span>
                <span className="family-sub">{mode === 'light' ? f.day : f.night}</span>
                {active && <span className="family-check">✓</span>}
              </button>
            )
          })}
        </div>

        {/* 明暗 */}
        <div className="set-label" style={{ marginTop: 20 }}>明暗</div>
        <div className="mode-switch">
          <button className={mode === 'light' ? 'on' : ''} onClick={() => onMode('light')}>☀ 白昼</button>
          <button className={mode === 'dark' ? 'on' : ''} onClick={() => onMode('dark')}>☾ 夜晚</button>
        </div>

        <div className="set-current">
          当前：<b>{FAMILIES.find((f) => f.key === family)?.name}</b>
          <span className="set-current-sep">·</span>
          <span className="set-current-name">{themeName(family, mode)}</span>
        </div>
      </section>

      {/* ── 即将推出 ── */}
      <section className="section set-soon">
        <h2>即将推出</h2>
        <ul className="soon-list">
          <li><span className="soon-tag">AI 模型</span>为每个档位（轻量 / 创作 / 分析）配置服务商与模型、填入各自 API Key。</li>
          <li><span className="soon-tag">数据导出</span>把全部随笔导出备份（随富文本编辑一并落地）。</li>
          <li><span className="soon-tag">写作偏好</span>每日一问默认显隐、编辑器字号 / 行距、自动保存间隔。</li>
        </ul>
      </section>
    </div>
  )
}
