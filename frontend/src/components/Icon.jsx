// 自有图标系统：篆刻印章母题。手写 inline SVG，走 currentColor，随主题自动变色。
// 与读者班底的 诗/叙/哲 字徽同源。同一套几何，三种用法（见 App.css 的 .seal-ic*）：
//   <Icon name="pen" className="seal-ic--sm" />            头部：小印面
//   <Icon name="reduce" className="seal-ic--sm seal-ic--plain" />  按钮内：去框只留印纹
//   <Icon name="pen" className="seal-ic--plain" />          折叠态：去框印纹
const GLYPHS = {
  // 缩减：两侧箭头向中线收拢
  reduce: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <path d="M4.5 12 H9 M6.8 9.7 L9 12 L6.8 14.3" />
      <path d="M19.5 12 H15 M17.2 9.7 L15 12 L17.2 14.3" />
    </>
  ),
  // 同义：上下两道反向箭头（⇄）
  synonym: (
    <>
      <path d="M5 9.3 H17 M14.2 6.6 L17 9.3 L14.2 12" />
      <path d="M19 14.7 H7 M9.8 12 L7 14.7 L9.8 17.4" />
    </>
  ),
  // 比喻：四角星火花
  metaphor: <path d="M12 3 L13.4 10.6 L21 12 L13.4 13.4 L12 21 L10.6 13.4 L3 12 L10.6 10.6 Z" />,
  // 扩展：中线向两侧张开
  expand: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <path d="M9 12 H4.5 M6.8 9.7 L4.5 12 L6.8 14.3" />
      <path d="M15 12 H19.5 M17.2 9.7 L19.5 12 L17.2 14.3" />
    </>
  ),
  // 找引文：带双引号的对话气泡
  cite: (
    <>
      <path d="M5 15.5 V8 a2 2 0 0 1 2 -2 H17 a2 2 0 0 1 2 2 v4.5 a2 2 0 0 1 -2 2 H9 l-4 3 Z" />
      <path d="M9.4 10 q-1.3 0 -1.3 1.4 t1.3 1.4 M14 10 q-1.3 0 -1.3 1.4 t1.3 1.4" />
    </>
  ),
  // 写作工具：钢笔尖
  pen: (
    <>
      <path d="M12 3 L16.5 13.5 L12 19.5 L7.5 13.5 Z" />
      <line x1="12" y1="8.5" x2="12" y2="15" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  // 草稿箱：收件托盘 + 下存箭头
  drafts: (
    <>
      <path d="M5 13 V17.5 a1.5 1.5 0 0 0 1.5 1.5 H17.5 a1.5 1.5 0 0 0 1.5 -1.5 V13" />
      <path d="M5 13 H9 a3 3 0 0 0 6 0 H19" />
      <path d="M12 4 V9.5 M9.5 7 L12 9.5 L14.5 7" />
    </>
  ),
  // 读者视角：摊开的书
  reader: (
    <>
      <path d="M12 6.5 C10 5 6.5 5 4.5 5.8 V17.5 C6.5 16.7 10 16.7 12 18 C14 16.7 17.5 16.7 19.5 17.5 V5.8 C17.5 5 14 5 12 6.5 Z" />
      <line x1="12" y1="6.5" x2="12" y2="18" />
    </>
  ),
}

export default function Icon({ name, className = '' }) {
  const glyph = GLYPHS[name]
  if (!glyph) return null
  return (
    <span className={`seal-ic ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
           strokeLinecap="round" strokeLinejoin="round">
        {glyph}
      </svg>
    </span>
  )
}
