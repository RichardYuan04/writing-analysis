# Design: 单篇深度解读 · Gemini 驱动

**日期**: 2026-05-09  
**状态**: 待实现  
**范围**: 子项目 B — Gemini 驱动的单篇随笔深度分析功能

---

## 1. 背景与目标

### 现状

画像页（Portrait）目前有一个「深度解读 · 像哪位作家」功能：点击按钮后，把所有随笔的摘录拼在一起送给 Claude Haiku，返回一段自由文本，前端按换行切段渲染。

存在的问题：
- 使用 Anthropic API，用户面临付费门槛
- 返回自由文本，前端无结构，视觉层次差
- 对所有随笔整体分析，无法针对某一篇做深度解读
- 功能单一：只有「像哪位作家」，没有词汇、结构、情感等维度

### 目标

将现有「像哪位作家」功能扩展为「单篇深度解读」：

1. 后端切换到 Google Gemini（免费 tier，1500 req/day）
2. AI 返回结构化 JSON，前端渲染六个独立分析模块
3. 用户可在画像页选择任意一篇随笔进行分析
4. 选篇器支持快捷入口、关键词搜索、时间筛选、分页

---

## 2. 功能范围

### 包含

- **选篇器 UI**：嵌入画像页「单篇深度解读」section
- **六大分析模块**（均由 Gemini 单次调用返回）：
  1. 像哪位作家（作家名 + 匹配理由 + 4维相似性）
  2. 词汇氛围图谱（15–20个意象词，带权重）
  3. 深度语言维度（词汇/句法/情感/叙事 4组，每组 3 条进度条）
  4. 文本结构映射（叙事节点时间轴）
  5. 核心意蕴提取（3–5条核心思想）
  6. 情感光谱（-1 到 +1 连续值 + 标签）
- **全文搜索后端**：SQLite FTS5 虚拟表，供选篇器关键词搜索使用

### 不包含

- 旧文低语卡（子项目 A，单独规划）
- 全文搜索在 Overview 页的入口（可复用本次后端，UI 留待子项目 A）
- 文体润色功能（scribesense-ai 的 tuneStyle，超出本次范围）
- 作家 2 的分析（本次只返回最相近 1 位）

---

## 3. 用户交互流程

```
画像页
  └─ 「单篇深度解读」section
       ├─ ⚡ 最近一篇 [快捷按钮] → 直接选中 date 最大的随笔
       ├─ 关键词搜索框（搜索标题 + 正文）
       ├─ 时间范围筛选（全部/最近1月/3月/半年/今年）
       ├─ 文章列表（每页 5 篇，前端分页）
       │    日期格式：YYYY-MM-DD（完整年份）
       │    关键词在标题中高亮显示
       └─ 「✨ 分析《篇名》」按钮
            │
            ▼（调用 /essays/{id}/deep-analysis）
            
  六模块结果区
       ├─ 像哪位作家（深棕卡片）
       ├─ 词汇氛围图谱（权重词云）
       ├─ 深度语言维度（4组进度条）
       ├─ 文本结构映射（竖向时间轴）
       ├─ 核心意蕴提取（编号卡片）
       └─ 情感光谱（深棕底滑条）
```

---

## 4. 后端设计

### 4.1 新增接口

#### `GET /essays/search`

全文搜索接口，供选篇器的关键词搜索使用。

**参数**：
- `q`（string）：搜索词
- `start_date`（string, 可选）：YYYY-MM-DD
- `end_date`（string, 可选）：YYYY-MM-DD

**返回**：
```json
[
  {
    "id": 3,
    "title": "在夏天的尽头，快乐是什么",
    "date": "2026-08-15",
    "word_count": 1240,
    "snippet": "...那个夏天，快乐对我来说是..."
  }
]
```

实现方式：SQLite FTS5 虚拟表，对 `title` + `content` 建全文索引。snippet 由 `snippet()` 函数生成，截取关键词上下文约 50 字。

FTS5 建表 SQL：
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS essays_fts
USING fts5(title, content, content='essays', content_rowid='id');
```

触发器同步（insert/update/delete 时同步 FTS 表）：
```sql
CREATE TRIGGER essays_ai AFTER INSERT ON essays BEGIN
  INSERT INTO essays_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
-- 同理创建 UPDATE / DELETE 触发器
```

#### `POST /essays/{essay_id}/deep-analysis`

核心分析接口。

**无请求体**，路径参数 `essay_id` 指定要分析的随笔。

**返回**：Gemini 返回的结构化 JSON，直接透传给前端：
```json
{
  "literaryPersona": {
    "author": "王小波",
    "reasoning": "...",
    "similarities": {
      "style": "...",
      "countryOrigin": "...",
      "logic": "...",
      "spirit": "..."
    }
  },
  "wordCloud": [
    { "text": "夏天", "weight": 9 },
    { "text": "快乐", "weight": 8 }
  ],
  "dimensions": {
    "lexical":   { "label": "词汇层", "metrics": [{ "label": "词汇丰富度", "value": 78 }] },
    "syntactic": { "label": "句法层", "metrics": [...] },
    "affective": { "label": "情感层", "metrics": [...] },
    "narrative": { "label": "叙事层", "metrics": [...] }
  },
  "structure": {
    "nodes": [
      { "title": "开篇", "description": "...", "type": "introduction" },
      { "title": "展开", "description": "...", "type": "argument" },
      { "title": "结尾", "description": "...", "type": "conclusion" }
    ]
  },
  "keyPoints": ["...", "...", "..."],
  "sentiment": {
    "score": 0.35,
    "label": "温柔的感伤",
    "intensity": 0.6
  }
}
```

### 4.2 Gemini 调用

**模型**：`gemini-2.0-flash`（免费 tier，1500 req/day，中文支持良好）

**调用方式**：`google-generativeai` Python SDK，`response_mime_type="application/json"` + `response_schema` 强制结构化输出，不依赖 prompt 格式约束。

**输入内容**：单篇随笔全文（不截断）+ 写作风格统计数据（复用 `compute_portrait()` 已有结果）。

**Prompt 结构**（中文，约 500 token）：
```
你是一位中文文学评论家。请对以下随笔进行深度分析，要求：
1. 中文作家优先；所有返回内容使用中文
2. 词汇层/句法层/情感层/叙事层各给出3个维度，每个维度评分0-100
3. 文本结构节点 3-5 个，type 只能是 introduction/argument/narrative_point/conclusion
4. 核心意蕴 3 条，每条一句话，有洞察力，不重复数据
5. wordCloud 提取 15-20 个意象词，weight 1-10

[随笔全文]
...

[写作风格参考数据]
句式：长句型，平均句长 32 字
词汇丰富度：TTR=0.72
情感基调：整体平和，情绪波动较小
```

**环境变量**：`GEMINI_API_KEY`，写入 `backend/.env`。

### 4.3 依赖变更

```
# 新增
google-generativeai

# 保留（现有功能继续使用）
anthropic
```

现有 `/stats/deep-analysis` 接口**保留不删**，避免破坏现有画像页逻辑（后续视情况迁移）。

---

## 5. 前端设计

### 5.1 画像页改动

在 `Portrait.jsx` 现有「深度解读 · 像哪位作家」section 下方新增「单篇深度解读」section，两个 section 并存（新功能稳定后可考虑合并）。

**新增组件**（均在 `Portrait.jsx` 内，或拆分到 `components/`）：

| 组件 | 职责 |
|---|---|
| `EssayPicker` | 选篇器：快捷入口 + 搜索 + 筛选 + 分页列表 |
| `DeepAnalysisResult` | 六模块结果容器 |
| `AuthorCard` | 像哪位作家卡片 |
| `WordCloudPanel` | 词汇氛围图谱 |
| `DimensionsPanel` | 深度语言维度（4组进度条）|
| `StructureTimeline` | 文本结构映射 |
| `KeyPointsPanel` | 核心意蕴提取 |
| `SentimentBar` | 情感光谱 |

### 5.2 EssayPicker 逻辑

```
状态：
  essays[]         // 全量列表，组件挂载时从 GET /essays 获取
  query            // 搜索词
  dateRange        // 时间筛选
  filteredEssays[] // 过滤后列表（前端计算）
  page             // 当前页（从 0 开始）
  selectedId       // 选中的 essay id

关键行为：
  - "最近一篇"：取 essays[0]（已按 date desc 排序）
  - 关键词搜索：query 非空时调用 GET /essays/search?q=xxx，结果替换 filteredEssays
  - 时间筛选：前端对 filteredEssays 按 date 过滤（不发新请求）
  - 分页：每页 PAGE_SIZE=5，slice(page*5, page*5+5)
  - 关键词高亮：对 title 中匹配 query 的子串用 <mark> 包裹
```

### 5.3 视觉规范

沿用文字时光机现有设计 token：

| 用途 | 值 |
|---|---|
| 背景 | `#F7F4EF` |
| 卡片背景 | `white` |
| 深色卡片（作家/情感光谱） | `#2d1f14` |
| 主色调 | `#8B6F47` |
| 强调色 | `#d4a96a` |
| 进度条：词汇层 | `#c4935a` |
| 进度条：句法层 | `#8a9a6a` |
| 进度条：情感层 | `#c47a7a` |
| 进度条：叙事层 | `#7a8a9a` |
| 时间轴节点：开篇 | `#8B6F47` |
| 时间轴节点：正文 | `#d4c4b0` |
| 时间轴节点：结尾 | `#5a4a3a` |

### 5.4 API 工具函数（`frontend/src/api.js`）

新增两个函数：
```js
export const searchEssays = (q, startDate, endDate) =>
  axios.get('/essays/search', { params: { q, start_date: startDate, end_date: endDate } })

export const singleEssayDeepAnalysis = (essayId) =>
  axios.post(`/essays/${essayId}/deep-analysis`)
```

---

## 6. 数据流

```
用户选篇并点击分析
       |
       v
前端 POST /essays/{id}/deep-analysis
       |
       v
后端读取 essays 表中该篇全文
+ 调用 compute_portrait([该篇]) 获取本地统计数据
       |
       v
构造 prompt，调用 Gemini API
（response_mime_type=application/json，强制 JSON schema）
       |
       v
后端将 Gemini JSON 直接返回前端（不做二次解析）
       |
       v
前端解构 JSON，分发给 6 个子组件渲染
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|---|---|
| Gemini API 超时（>15s） | 前端显示「分析超时，请稍后重试」，不崩溃 |
| Gemini 返回非 JSON | 后端捕获 JSONDecodeError，返回 500 + 提示 |
| 随笔字数过少（< 100字） | 后端校验，返回 400 「文章太短，无法深度分析」 |
| 关键词搜索无结果 | 前端显示「没有找到包含该词的随笔」 |
| API key 未配置 | 后端启动时检查，缺失则 /deep-analysis 返回 503 |

---

## 8. 实现顺序

1. **初始化 git 分支** `feature/gemini-deep-analysis`
2. **后端**：
   a. 安装 `google-generativeai`，写入 `requirements.txt`
   b. 配置 `GEMINI_API_KEY` 环境变量
   c. 建 FTS5 虚拟表 + 触发器（迁移现有数据）
   d. 实现 `GET /essays/search`
   e. 实现 `POST /essays/{id}/deep-analysis`（含 prompt + schema）
3. **前端**：
   a. 在 `api.js` 添加两个新函数
   b. 实现 `EssayPicker` 组件
   c. 实现六个分析模块组件
   d. 在 `Portrait.jsx` 接入
4. **测试**：用现有随笔跑一遍全流程，检查 JSON 结构是否完整
5. **合并** `feature/gemini-deep-analysis` → `main`

---

## 9. 开放问题

- Gemini 对长随笔（> 5000字）的返回质量尚未验证，可能需要截断策略
- 进度条的 4 组维度标签由 AI 动态生成（中文），需验证是否稳定
- 现有 `/stats/deep-analysis` 何时废弃，取决于用户是否迁移完成后的体验确认
