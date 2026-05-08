# 文字时光机迭代二实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建视觉设计语言、实现冷启动三阶段空状态、重做总览/写作/画像三个核心页面，并新增今日回顾卡片。

**Architecture:** 纯前端样式与组件层改造，配合一个新的后端接口（随机随笔）。所有改动集中在 `frontend/src/` 目录，后端只新增一个 GET 接口。

**Tech Stack:** React + Vite，CSS 变量系统，FastAPI（后端一个接口），现有 recharts / d3-cloud / react-calendar-heatmap 库不变。

---

## 文件改动清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `frontend/src/App.css` | 完全重写为新设计语言 |
| 修改 | `frontend/src/index.css` | 基础 reset + CSS 变量定义 |
| 修改 | `frontend/src/App.jsx` | 导航栏样式适配 |
| 新建 | `frontend/src/components/TodayReview.jsx` | 今日回顾卡片 |
| 新建 | `frontend/src/components/WelcomeCard.jsx` | 0篇欢迎引导卡 |
| 新建 | `frontend/src/components/HintBar.jsx` | 内容不足提示条 |
| 修改 | `frontend/src/pages/Overview.jsx` | 冷启动状态 + 今日回顾 + 新设计 |
| 修改 | `frontend/src/pages/Write.jsx` | 全宽编辑器 + 精致输入框 |
| 修改 | `frontend/src/pages/Portrait.jsx` | 暖棕配色 + 纸张感背景 |
| 修改 | `frontend/src/pages/EssayDetail.jsx` | 跟随新设计语言 |
| 修改 | `frontend/src/api.js` | 新增 getRandomEssay |
| 修改 | `backend/main.py` | 新增 GET /essays/random 接口 |

---

## Task 1：CSS 变量系统 & 基础样式重建

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: 重写 index.css，定义 CSS 变量**

```css
/* frontend/src/index.css */
:root {
  --bg: #F7F4EF;
  --bg-card: #FFFFFF;
  --text-primary: #2C2C2C;
  --text-secondary: #8A7F74;
  --text-hint: #B5A898;
  --accent: #8B6F47;
  --accent-light: #C9B99A;
  --border: #E8E0D5;
  --sentiment-positive: #8B6F47;
  --sentiment-negative: #7A8FA6;
  --sentiment-neutral: #C9B99A;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-serif: 'Noto Serif SC', Georgia, serif;
  --font-sans: 'PingFang SC', -apple-system, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

#root { min-height: 100vh; }
```

- [ ] **Step 2: 重写 App.css 导航与全局布局**

```css
/* frontend/src/App.css — 完整替换 */

/* ── 导航 ── */
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 40px;
  height: 56px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.nav-logo {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.5px;
}
.nav-links { display: flex; gap: 4px; }
.nav-links button {
  padding: 6px 16px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  transition: all 0.15s;
}
.nav-links button:hover { color: var(--accent); background: #F0EBE3; }
.nav-links button.active { color: var(--accent); font-weight: 600; }

/* ── 页面容器 ── */
.main { max-width: 800px; margin: 0 auto; padding: 36px 20px; }

/* ── 通用卡片 ── */
.section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 16px;
}
.section h2 {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  letter-spacing: 0.3px;
}
.section-desc { font-size: 12px; color: var(--text-hint); margin-bottom: 16px; margin-top: -10px; }

/* ── 统计卡片 ── */
.stat-cards { display: flex; gap: 12px; margin-bottom: 16px; }
.card {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  text-align: center;
}
.card-num {
  font-family: var(--font-serif);
  font-size: 26px;
  font-weight: 700;
  color: var(--accent);
  line-height: 1.2;
}
.card-label { font-size: 12px; color: var(--text-hint); margin-top: 4px; }

/* ── 随笔列表 ── */
.essay-list { display: flex; flex-direction: column; gap: 8px; }
.essay-item {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  background: var(--bg-card);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.essay-item:hover { border-color: var(--accent-light); box-shadow: 0 2px 8px rgba(139,111,71,0.08); }
.essay-sentiment-bar { width: 4px; flex-shrink: 0; }
.essay-sentiment-bar.positive { background: var(--sentiment-positive); }
.essay-sentiment-bar.negative { background: var(--sentiment-negative); }
.essay-sentiment-bar.neutral { background: var(--sentiment-neutral); }
.essay-item-body { padding: 14px 16px; flex: 1; }
.essay-meta { display: flex; gap: 10px; font-size: 11px; color: var(--text-hint); margin-bottom: 5px; }
.essay-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
.essay-preview { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

/* ── 提示条 ── */
.hint-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #FBF8F4;
  border: 1px dashed var(--accent-light);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 12px;
}
.hint-bar-icon { font-size: 14px; }

/* ── 日期筛选 ── */
.date-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.filter-label { font-size: 13px; color: var(--text-secondary); }
.date-input {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);
  outline: none;
}
.date-input:focus { border-color: var(--accent-light); }
.filter-btn {
  padding: 7px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}
.reset-btn {
  padding: 7px 16px;
  background: none;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}

/* ── 写作页 ── */
.write-page { display: flex; flex-direction: column; gap: 12px; min-height: calc(100vh - 120px); }
.write-header { display: flex; gap: 10px; }
.title-input {
  flex: 1;
  padding: 11px 14px;
  font-size: 17px;
  font-family: var(--font-serif);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg-card);
  color: var(--text-primary);
}
.title-input:focus { border-color: var(--accent-light); }
.content-input {
  flex: 1;
  width: 100%;
  padding: 20px;
  font-size: 15px;
  line-height: 1.9;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  resize: vertical;
  outline: none;
  font-family: var(--font-sans);
  background: var(--bg-card);
  color: var(--text-primary);
  min-height: 480px;
}
.content-input:focus { border-color: var(--accent-light); }
.write-footer { display: flex; align-items: center; }
.word-count { font-size: 12px; color: var(--text-hint); flex: 1; }
.error { font-size: 12px; color: #C0392B; }
.save-btn {
  padding: 9px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── 详情页 ── */
.detail {}
.detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.back-btn {
  background: none;
  border: 1px solid var(--border);
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}
.edit-btn {
  background: none;
  border: 1px solid var(--accent-light);
  color: var(--accent);
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}
.delete-btn {
  background: none;
  border: 1px solid #E8C4C4;
  color: #C0392B;
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
}
.detail-title {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--text-primary);
}
.detail-meta { display: flex; gap: 14px; font-size: 12px; color: var(--text-hint); margin-bottom: 24px; }
.detail-content {
  font-size: 15px;
  line-height: 2;
  color: var(--text-primary);
  white-space: pre-wrap;
  background: var(--bg-card);
  padding: 28px 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
}

/* ── 画像页 ── */
.portrait-page {}
.portrait-title {
  font-family: var(--font-serif);
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--text-primary);
}
.portrait-sub { font-size: 12px; color: var(--text-hint); margin-bottom: 24px; }
.soul-words { display: flex; flex-wrap: wrap; gap: 8px; }
.soul-word {
  padding: 5px 14px;
  background: #FBF8F4;
  border: 1px solid var(--accent-light);
  border-radius: 20px;
  font-size: 14px;
  color: var(--accent);
  font-weight: 500;
}
.portrait-dims { display: flex; flex-direction: column; }
.dim-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.dim-row:last-child { border-bottom: none; }
.dim-icon { font-size: 15px; width: 22px; flex-shrink: 0; }
.dim-label { font-size: 12px; color: var(--text-hint); width: 70px; flex-shrink: 0; padding-top: 1px; }
.dim-value { font-size: 13px; color: var(--text-primary); flex: 1; line-height: 1.6; }
.deep-section { text-align: center; }
.deep-btn {
  margin-top: 8px;
  padding: 11px 28px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.15s;
}
.deep-btn:hover { opacity: 0.85; }
.deep-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.analysis-result {
  text-align: left;
  margin-top: 16px;
  background: #FBF8F4;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
}
.analysis-heading { font-family: var(--font-serif); font-size: 14px; font-weight: 700; color: var(--accent); margin: 12px 0 6px; }
.analysis-body { font-size: 13px; color: var(--text-primary); line-height: 1.9; margin: 3px 0; }

/* ── 高频词 ── */
.top-words { display: flex; flex-direction: column; }
.top-word-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.top-word-item:last-child { border-bottom: none; }
.rank { width: 24px; font-size: 11px; color: var(--text-hint); }
.word { flex: 1; font-size: 14px; font-weight: 500; }
.count { font-size: 12px; color: var(--text-hint); }

/* ── heatmap 配色 ── */
.heatmap-wrapper { overflow-x: auto; }
.react-calendar-heatmap .color-empty { fill: #EDE8E0; }
.react-calendar-heatmap .color-scale-1 { fill: #D4BFA0; }
.react-calendar-heatmap .color-scale-2 { fill: #B99870; }
.react-calendar-heatmap .color-scale-3 { fill: #8B6F47; }
.react-calendar-heatmap .color-scale-4 { fill: #5C4830; }

/* ── 状态 ── */
.loading { text-align: center; padding: 80px; color: var(--text-hint); font-size: 15px; }
.empty { text-align: center; padding: 80px; color: var(--text-hint); font-size: 15px; }
```

- [ ] **Step 3: 验证样式加载无报错**

在浏览器打开 http://localhost:5173，确认页面背景变为米白色（#F7F4EF），导航栏字体变为衬线体。无控制台 CSS 报错。

---

## Task 2：后端新增随机随笔接口

**Files:**
- Modify: `backend/main.py`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 在 main.py 末尾新增接口**

```python
import random as _random

@app.get("/essays/random")
def random_essay():
    session = Session()
    essays = session.query(Essay).all()
    session.close()
    if not essays:
        raise HTTPException(status_code=404, detail="no essays")
    e = _random.choice(essays)
    return {
        "id": e.id,
        "title": e.title,
        "date": e.date,
        "sentiment_score": e.sentiment_score,
        "preview": e.content[:120] + "…" if len(e.content) > 120 else e.content,
    }
```

**注意**：此接口必须放在 `/essays/{essay_id}` 之前，否则 FastAPI 会把 "random" 当作 essay_id 解析。检查 main.py 中路由顺序：`/essays/random` 需在 `/essays/{essay_id}` 上方。

- [ ] **Step 2: 重启后端并测试接口**

```bash
pkill -f uvicorn
cd ~/Desktop/writing-analysis/backend && source venv/bin/activate
python3 -m uvicorn main:app --port 8000 > /tmp/backend.log 2>&1 &
sleep 2 && curl -s http://localhost:8000/essays/random
```

预期：返回一篇随机随笔的 JSON，包含 id、title、date、sentiment_score、preview 字段。

- [ ] **Step 3: 在 api.js 新增调用**

```js
export const getRandomEssay = () => api.get('/essays/random')
```

---

## Task 3：今日回顾卡片组件

**Files:**
- Create: `frontend/src/components/TodayReview.jsx`

- [ ] **Step 1: 创建组件文件**

```jsx
// frontend/src/components/TodayReview.jsx
import { useEffect, useState } from 'react'
import { getRandomEssay } from '../api'

export default function TodayReview({ onSelect }) {
  const [essay, setEssay] = useState(null)

  useEffect(() => {
    getRandomEssay()
      .then(r => setEssay(r.data))
      .catch(() => {})
  }, [])

  if (!essay) return null

  const sentimentLabel = (score) => {
    if (score > 0.65) return '😊'
    if (score < 0.35) return '😔'
    return '😐'
  }

  return (
    <div className="today-review" onClick={() => onSelect(essay.id)}>
      <div className="today-review-header">
        <span className="today-review-label">今日回顾</span>
        <span className="today-review-meta">{essay.date} · {sentimentLabel(essay.sentiment_score)}</span>
      </div>
      <div className="today-review-title">{essay.title}</div>
      <div className="today-review-preview">{essay.preview}</div>
    </div>
  )
}
```

- [ ] **Step 2: 在 App.css 末尾追加今日回顾样式**

```css
.today-review {
  background: #FBF8F4;
  border: 1px solid var(--accent-light);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.today-review:hover { box-shadow: 0 2px 12px rgba(139,111,71,0.1); }
.today-review-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.today-review-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 1px;
  text-transform: uppercase;
}
.today-review-meta { font-size: 11px; color: var(--text-hint); }
.today-review-title {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.today-review-preview { font-size: 13px; color: var(--text-secondary); line-height: 1.7; }
```

---

## Task 4：欢迎卡 & 提示条组件

**Files:**
- Create: `frontend/src/components/WelcomeCard.jsx`
- Create: `frontend/src/components/HintBar.jsx`

- [ ] **Step 1: 创建欢迎引导卡**

```jsx
// frontend/src/components/WelcomeCard.jsx
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
```

- [ ] **Step 2: 创建提示条组件**

```jsx
// frontend/src/components/HintBar.jsx
export default function HintBar({ text }) {
  return (
    <div className="hint-bar">
      <span className="hint-bar-icon">✦</span>
      <span>{text}</span>
    </div>
  )
}
```

- [ ] **Step 3: 在 App.css 末尾追加欢迎卡样式**

```css
.welcome-card {
  text-align: center;
  padding: 60px 40px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.welcome-icon { font-size: 28px; color: var(--accent-light); margin-bottom: 16px; }
.welcome-title {
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.welcome-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.8; margin-bottom: 28px; }
.welcome-btn {
  padding: 10px 28px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
```

---

## Task 5：总览页重写

**Files:**
- Modify: `frontend/src/pages/Overview.jsx`

- [ ] **Step 1: 完整替换 Overview.jsx**

```jsx
import { useEffect, useState } from 'react'
import { getOverview, listEssays } from '../api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import WordCloud from '../components/WordCloud'
import HeatMap from '../components/HeatMap'
import TodayReview from '../components/TodayReview'
import WelcomeCard from '../components/WelcomeCard'
import HintBar from '../components/HintBar'

export default function Overview({ onSelect, onWrite }) {
  const [stats, setStats] = useState(null)
  const [essays, setEssays] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const fetchData = (start, end) => {
    setLoading(true)
    Promise.all([getOverview(start, end), listEssays()])
      .then(([s, e]) => { setStats(s.data); setEssays(e.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchData('', '') }, [])

  const handleFilter = () => fetchData(startDate, endDate)
  const handleReset = () => { setStartDate(''); setEndDate(''); fetchData('', '') }

  const sentimentLabel = (score) => {
    if (score > 0.65) return '😊 积极'
    if (score < 0.35) return '😔 消极'
    return '😐 平静'
  }

  const sentimentBarClass = (score) => {
    if (score > 0.65) return 'positive'
    if (score < 0.35) return 'negative'
    return 'neutral'
  }

  if (loading) return <div className="loading">加载中…</div>

  // 0篇状态
  if (!essays || essays.length === 0) {
    return <WelcomeCard onWrite={onWrite} />
  }

  const showTodayReview = essays.length >= 3

  return (
    <div className="overview">
      {/* 今日回顾（3篇以上） */}
      {showTodayReview && <TodayReview onSelect={onSelect} />}

      {/* 日期筛选 */}
      <div className="date-filter">
        <span className="filter-label">日期范围</span>
        <input type="date" className="date-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{ color: 'var(--text-hint)', fontSize: 13 }}>—</span>
        <input type="date" className="date-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <button className="filter-btn" onClick={handleFilter}>筛选</button>
        {(startDate || endDate) && <button className="reset-btn" onClick={handleReset}>重置</button>}
      </div>

      {!stats || stats.total_essays === 0 ? (
        <div className="empty">该时间段内没有随笔</div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="stat-cards">
            <div className="card">
              <div className="card-num">{stats.total_essays}</div>
              <div className="card-label">篇随笔</div>
            </div>
            <div className="card">
              <div className="card-num">{stats.total_words.toLocaleString()}</div>
              <div className="card-label">总字数</div>
            </div>
            <div className="card">
              <div className="card-num">{sentimentLabel(stats.avg_sentiment)}</div>
              <div className="card-label">整体情绪</div>
            </div>
          </div>

          {/* 写作日历 */}
          <section className="section">
            <h2>写作日历</h2>
            <HeatMap data={stats.heatmap} />
          </section>

          {/* 情感曲线 */}
          {stats.sentiment_trend?.length > 1 && (
            <section className="section">
              <h2>情感曲线</h2>
              {essays.length < 3 && <HintBar text="写得越多，曲线越清晰——每一篇都让画像更准确" />}
              <div style={{ marginTop: essays.length < 3 ? 12 : 0 }}>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={stats.sentiment_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EDE8E0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-hint)' }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: 'var(--text-hint)' }} />
                    <Tooltip formatter={(v) => [v.toFixed(2), '情感分']} labelFormatter={(l) => `日期: ${l}`} />
                    <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* 词云 */}
          <section className="section">
            <h2>高频词云</h2>
            {essays.length < 3 && <HintBar text="写得越多，词云越丰富——每一篇都让画像更清晰" />}
            <WordCloud words={stats.top_words} />
          </section>
        </>
      )}

      {/* 随笔列表 */}
      <section className="section">
        <h2>所有随笔</h2>
        <div className="essay-list">
          {essays.map(e => (
            <div key={e.id} className="essay-item" onClick={() => onSelect(e.id)}>
              <div className={`essay-sentiment-bar ${sentimentBarClass(e.sentiment_score)}`} />
              <div className="essay-item-body">
                <div className="essay-meta">
                  <span>{e.date}</span>
                  <span>{e.word_count} 字</span>
                  <span>{sentimentLabel(e.sentiment_score)}</span>
                </div>
                <div className="essay-title">{e.title}</div>
                <div className="essay-preview">{e.content}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: 更新 App.jsx，向 Overview 传入 onWrite prop**

在 App.jsx 中，将：
```jsx
{page === 'overview' && <Overview onSelect={(id) => navigate('detail', id)} />}
```
改为：
```jsx
{page === 'overview' && <Overview onSelect={(id) => navigate('detail', id)} onWrite={() => navigate('write')} />}
```

- [ ] **Step 3: 浏览器验证**

打开 http://localhost:5173 确认：
- 随笔列表每项左侧有彩色情感色条
- 情感曲线/词云下方有提示条（若文章少于3篇）
- 有3篇以上时顶部出现今日回顾卡片

---

## Task 6：写作页精修

**Files:**
- Modify: `frontend/src/pages/Write.jsx`

- [ ] **Step 1: 完整替换 Write.jsx**

```jsx
import { useState } from 'react'
import { createEssay } from '../api'

export default function Write({ onSaved }) {
  const today = new Date().toISOString().split('T')[0]
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) { setError('标题和内容不能为空'); return }
    setSaving(true); setError('')
    try {
      await createEssay({ title, content, date })
      onSaved()
    } catch {
      setError('保存失败，请检查后端是否启动')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="write-page">
      <div className="write-header">
        <input
          className="title-input"
          placeholder="标题…"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <input
          type="date"
          className="date-input"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>
      <textarea
        className="content-input"
        placeholder="开始写作…"
        value={content}
        onChange={e => setContent(e.target.value)}
      />
      <div className="write-footer">
        <span className="word-count">{content.replace(/\s/g, '').length} 字</span>
        {error && <span className="error">{error}</span>}
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 浏览器验证**

点击"写作"导航，确认：编辑区占满全宽、字数在右下角、输入框聚焦时边框变暖棕色。

---

## Task 7：写作画像页配色更新

**Files:**
- Modify: `frontend/src/pages/Portrait.jsx`

- [ ] **Step 1: 更新雷达图配色**

将 Portrait.jsx 中 `<Radar>` 的颜色从紫色改为暖棕：

```jsx
<Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
```

- [ ] **Step 2: 更新深度解读按钮文案样式**

深度解读区域已通过 App.css 跟随新设计语言，无需额外修改。浏览器确认画像页整体色调与总览页一致（暖棕取代紫色）。

---

## 自检

- [x] **Spec 覆盖**：视觉系统 ✓ / 冷启动三阶段 ✓ / 今日回顾 ✓ / 三个核心页面 ✓ / 详情页跟随 ✓（通过 CSS 变量全局生效）
- [x] **无 placeholder**：所有步骤包含完整代码
- [x] **类型一致**：`onWrite` prop 在 Task 5 定义，Task 5 Step 2 中传入，无断层
- [x] **路由顺序**：Task 2 已提示 `/essays/random` 必须在 `/essays/{essay_id}` 之前
