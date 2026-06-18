# 读者视角 + 找引文 写作工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在写作页写作工具栏目下，新增「读者视角」（5 个人格读者读完整篇回一封信）与「找引文」（为选中论断联网检索带出处的证据）两个并列子功能。

**Architecture:** 后端两个新 FastAPI 端点（`/assist/reader` 单轮、`/assist/cite` 带 web_search 工具循环），均不注入 SOUL。前端：「找引文」作为第 5 个划词动作进现有 `AssistPanel`（与「比喻」同款 options+复制）；「读者视角」独立成 `ReaderPanel` 组件 + 浮层信件阅读区，挂在写作页右栏。

**Tech Stack:** Python / FastAPI / SQLAlchemy / anthropic SDK（后端，pytest + TestClient 测试）；React + Vite + axios（前端，手动验证，仓库无前端测试基建）。

**Spec:** `docs/superpowers/specs/2026-06-18-reader-and-cite-tools-design.md`
**视觉参照:** `design-samples/读者视角-阅读区.html`

---

## File Structure

**后端（`backend/main.py`，单文件，沿用现有结构）**
- 新增 `READER_PERSONAS`（5 人格配置常量：key → {name, lens, system}）。
- 新增 `AssistReaderRequest` model + `POST /assist/reader`。
- 新增 `AssistCiteRequest` model + `POST /assist/cite`（独立 handler，含 web_search 工具循环 + 解析）。
- 复用现有 `_load_soul_content` 不调用即可（reader/cite 都不注入 SOUL）。

**后端测试（`backend/tests/test_assist_tools.py`，新建）**
- 用现有 `mock_anthropic` / `client` fixture（`conftest.py`）测两个端点的契约与降级。

**前端**
- `frontend/src/api.js`：加 `assistReader`、`assistCite`。
- `frontend/src/components/AssistPanel.jsx`：`ACTIONS` 加「找引文」。
- `frontend/src/components/ReaderPanel.jsx`：**新建**，读者入口 + 浮层信件。
- `frontend/src/pages/Write.jsx`：在 `write-right` 挂 `ReaderPanel`。
- `frontend/src/App.css`：`ReaderPanel` 样式（沿用既有 token / 印章 / 信纸质感）。

---

## Task 1: 后端 `POST /assist/reader`（读者视角）

**Files:**
- Modify: `backend/main.py`（在 `# ── 风格 SOUL 文档 ──` 段之前，紧接现有 `@app.post("/assist/expand")` 之后插入）
- Test: `backend/tests/test_assist_tools.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_assist_tools.py`：

```python
import main


def test_reader_returns_letter(client, mock_anthropic):
    mock_anthropic.set_text("读你这篇时，我先听见了灯。……")
    r = client.post("/assist/reader", json={
        "title": "夜里十一点的便利店",
        "content": "我买了一瓶水，其实并不渴。",
        "persona": "poet",
    })
    assert r.status_code == 200
    assert r.json()["letter"].startswith("读你这篇时")


def test_reader_uses_opus_and_persona_system(client, mock_anthropic):
    mock_anthropic.set_text("ok")
    client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "debater",
    })
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-opus-4-8"
    # 辩论家的人格设定进了 system，且没有注入 SOUL 风格指令
    assert "辩论家" in cap["system"]
    assert "写作风格为" not in cap["system"]


def test_reader_rejects_bad_persona(client, mock_anthropic):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "nobody",
    })
    assert r.status_code == 400


def test_reader_rejects_empty_content(client, mock_anthropic):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "  ", "persona": "poet",
    })
    assert r.status_code == 400
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_assist_tools.py -v`
Expected: FAIL（404，端点不存在）

- [ ] **Step 3: 实现端点**

在 `backend/main.py` 中 `@app.post("/assist/expand")` 函数之后、`# ── 风格 SOUL 文档 ──` 之前插入：

```python
# ── 读者视角 ──
# 选一个人格读者，读完整篇 → 回一封第一人称的信。读整篇、不依赖选区、不注入 SOUL。
READER_PERSONAS = {
    "poet": {
        "name": "诗人",
        "system": (
            "你是一位诗人。读一篇文章时，你只在意意象、节奏和语言的质地——"
            "哪一句的画面让你停住，哪里的词太顺、像借来的，哪里的节奏泄了气。"
        ),
    },
    "novelist": {
        "name": "小说家",
        "system": (
            "你是一位小说家。读一篇文章时，你只在意人物、场景与细节——"
            "作者是把它「演」出来了，还是在「讲」；现场是否立住，有没有一张脸、一个动作。"
        ),
    },
    "philosopher": {
        "name": "哲学家",
        "system": (
            "你是一位哲学家。读一篇文章时，你追问它底下「真正在问什么」，"
            "把一个具体的场景上升为一个普遍的问题，温和地往深里带；你深化，不抬杠。"
        ),
    },
    "editor": {
        "name": "编辑",
        "system": (
            "你是一位编辑。读一篇文章时，你只看整体的骨架与气——"
            "开头抓不抓人、中段塌不塌、结尾兑不兑现承诺、有没有一以贯之的线。用人话说，不抖术语。"
        ),
    },
    "debater": {
        "name": "辩论家",
        "system": (
            "你是一位辩论家。读一篇文章时，你专挑它的立论与逻辑漏洞——"
            "那个不成立的「所以」、偷换的前提、回避的反例；你认真反驳，要求论断站得住。"
        ),
    },
}

_READER_TASK = (
    "现在请你读完下面这篇文章，然后像一个真实的人，给作者本人写一封第一人称的信："
    "有体温，不打分，不逐句批改；抓住真正打动你、或硌着你的地方来说，可以点名某个具体句子；"
    "结尾不必强行总结。约 400–800 字。只输出信的正文，不要加标题或前缀。"
)


class AssistReaderRequest(BaseModel):
    title: str = ""
    content: str
    persona: str


@app.post("/assist/reader")
def assist_reader(data: AssistReaderRequest):
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="文章内容不能为空")
    p = READER_PERSONAS.get(data.persona)
    if not p:
        raise HTTPException(status_code=400, detail="未知的读者")
    sys_prompt = f"{p['system']}\n{_READER_TASK}"
    user = f"标题：{(data.title or '无题').strip()}\n\n正文：\n{content}"
    try:
        message = anthropic_client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1400,
            system=sys_prompt,
            messages=[{"role": "user", "content": user}],
        )
        letter = "".join(getattr(b, "text", "") for b in message.content).strip()
        return {"letter": letter}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[reader] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_assist_tools.py -v`
Expected: 4 个 reader 测试 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_assist_tools.py
git commit -m "feat(assist): 读者视角端点 /assist/reader（5 人格读者回信）"
```

---

## Task 2: 后端 `POST /assist/cite`（找引文）

**Files:**
- Modify: `backend/main.py`（紧接 Task 1 的 reader 端点之后插入）
- Test: `backend/tests/test_assist_tools.py`（追加）

**说明：** web_search 是服务端工具（`{"type": "web_search_20260209", "name": "web_search"}`），API 自己跑检索循环；若达到内部迭代上限会返回 `stop_reason: "pause_turn"`，需把 assistant 内容回填再请求一次（上限设 3 次）。为避免和引用块解析纠缠，prompt 要求模型把每条证据按 `原文 ||| 出处 ||| URL` 单独成行输出，按 `|||` 解析。现有 `mock_anthropic` 返回的 `_Resp` 无 `stop_reason` 属性，`getattr(..., None)` 取到 None，循环一轮即退出——测试无需改 mock。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_assist_tools.py` 追加：

```python
def test_cite_parses_quote_source_url(client, mock_anthropic):
    mock_anthropic.set_text(
        "知人者智，自知者明。 ||| 老子《道德经》 ||| https://example.com/a\n"
        "我思故我在。 ||| 笛卡尔 ||| https://example.com/b"
    )
    r = client.post("/assist/cite", json={"text": "认识自己很重要", "context": ""})
    assert r.status_code == 200
    opts = r.json()["options"]
    assert len(opts) == 2
    assert opts[0] == {
        "quote": "知人者智，自知者明。",
        "source": "老子《道德经》",
        "url": "https://example.com/a",
    }


def test_cite_uses_sonnet_and_web_search_no_soul(client, mock_anthropic):
    mock_anthropic.set_text("x ||| y ||| z")
    client.post("/assist/cite", json={"text": "论断", "context": ""})
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-sonnet-4-6"
    tool_types = [t.get("type") for t in cap["tools"]]
    assert "web_search_20260209" in tool_types
    assert "写作风格为" not in (cap.get("system") or "")


def test_cite_empty_results_returns_empty_options(client, mock_anthropic):
    mock_anthropic.set_text("没有查到可靠的出处。")
    r = client.post("/assist/cite", json={"text": "论断", "context": ""})
    assert r.status_code == 200
    assert r.json()["options"] == []


def test_cite_rejects_empty_text(client, mock_anthropic):
    r = client.post("/assist/cite", json={"text": "  ", "context": ""})
    assert r.status_code == 400
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_assist_tools.py -k cite -v`
Expected: FAIL（404）

- [ ] **Step 3: 实现端点**

在 Task 1 的 reader 端点之后插入：

```python
# ── 找引文 ──
# 为选中论断联网检索 2–3 条带出处的证据。用 web_search 服务端工具，不注入 SOUL。
CITE_SYSTEM = (
    "你是一名严谨的资料员。为用户给出的论断，用联网检索找 2–3 条真实、可查证的证据"
    "（名人名句、科学依据或历史事实皆可）。每条必须有真实可查的出处；"
    "宁缺毋滥，绝不编造名言、数据或年份；查不到确切出处就不要给。\n"
    "只输出证据，每条单独一行，严格用以下格式（用 ||| 分隔三段，不要加编号或解释）：\n"
    "证据原文 ||| 出处（作者/著作/机构）||| 来源链接\n"
    "如果没有任何可确证的证据，只输出一行：无"
)

_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search"}


class AssistCiteRequest(BaseModel):
    text: str
    context: str = ""


def _parse_cite_lines(raw: str) -> list:
    """解析「原文 ||| 出处 ||| URL」每行一条 → [{quote, source, url}]，最多 3 条。"""
    out = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s or "|||" not in s:
            continue
        parts = [p.strip() for p in s.split("|||")]
        quote = parts[0]
        source = parts[1] if len(parts) > 1 else ""
        url = parts[2] if len(parts) > 2 else ""
        if quote:
            out.append({"quote": quote, "source": source, "url": url})
    return out[:3]


@app.post("/assist/cite")
def assist_cite(data: AssistCiteRequest):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="选中文字不能为空")
    user = f"论断：{text}" + _ctx_line(data.context)
    messages = [{"role": "user", "content": user}]
    try:
        # web_search 是服务端工具，API 自跑检索循环；pause_turn 时回填续跑（上限 3 轮）
        for _ in range(3):
            message = anthropic_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=CITE_SYSTEM,
                tools=[_WEB_SEARCH_TOOL],
                messages=messages,
            )
            if getattr(message, "stop_reason", None) != "pause_turn":
                break
            messages.append({"role": "assistant", "content": message.content})
        raw = "".join(getattr(b, "text", "") for b in message.content).strip()
        return {"options": _parse_cite_lines(raw)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[cite] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_assist_tools.py -v`
Expected: 全部（reader 4 + cite 4）PASS

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_assist_tools.py
git commit -m "feat(assist): 找引文端点 /assist/cite（web_search 检索带出处证据）"
```

---

## Task 3: 前端 api.js 接口

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 加两个接口**

在 `frontend/src/api.js` 现有 `export const assistExpand = ...` 一行之后加：

```javascript
export const assistReader = (data) => api.post('/assist/reader', data)
export const assistCite = (data) => api.post('/assist/cite', data)
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api.js
git commit -m "feat(api): 读者视角 / 找引文前端接口"
```

---

## Task 4: AssistPanel 增加「找引文」划词动作

**Files:**
- Modify: `frontend/src/components/AssistPanel.jsx`

「找引文」与「比喻」同形状（options + 复制不替换），改动极小。

- [ ] **Step 1: 引入 assistCite**

把 `frontend/src/components/AssistPanel.jsx` 第 2 行：

```javascript
import { assistReduce, assistSynonyms, assistMetaphor, assistExpand } from '../api'
```

改为：

```javascript
import { assistReduce, assistSynonyms, assistMetaphor, assistExpand, assistCite } from '../api'
```

- [ ] **Step 2: 在 ACTIONS 末尾加「找引文」**

在 `AssistPanel.jsx` 的 `ACTIONS` 数组里，`expand` 那一项之后追加：

```javascript
  { key: 'cite', label: '📚 找引文', kind: 'options', call: assistCite, running: '正在查证据…',
    cap: '引文建议（点选复制原文与出处）', copy: true,
    help: '为你选中的论断联网检索 2–3 条带出处的证据（名人名句 / 科学依据 / 历史事实）。\n只给查得到出处的，点一条即复制「原文 + 出处」，自行粘回去织入。\n联网检索会慢几秒，请稍候。' },
```

- [ ] **Step 3: 让 options 渲染显示出处**

「找引文」每条是 `{quote, source, url}`，而比喻是纯字符串。`run()` 里已用 `res.data.options`，需在 options 渲染处兼容对象。找到 `AssistPanel.jsx` 中 `options.map((opt, i) => (` 那段（约 107 行），把按钮内部替换为：

```javascript
                {options.map((opt, i) => {
                  const isObj = opt && typeof opt === 'object'
                  const copyVal = isObj ? `${opt.quote}${opt.source ? ' —— ' + opt.source : ''}` : opt
                  return (
                    <button
                      key={i}
                      className="ap-option"
                      onClick={() => (action?.copy ? copyText(i, copyVal) : applyText(opt))}
                    >
                      <span className="ap-option-txt">
                        {isObj ? (
                          <>
                            <span className="ap-cite-quote">{opt.quote}</span>
                            {opt.source && <span className="ap-cite-src">{opt.source}</span>}
                            {opt.url && <span className="ap-cite-url">{opt.url}</span>}
                          </>
                        ) : opt}
                      </span>
                      {action?.copy && <span className="ap-copied">{copiedIdx === i ? '已复制 ✓' : '复制'}</span>}
                    </button>
                  )
                })}
```

（即把原来直接渲染 `opt` 字符串的逻辑，扩展为「对象→分行显示原文/出处/URL，字符串→原样」。）

- [ ] **Step 4: 加引文卡样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* 找引文：一条证据卡的三段式排版 */
.ap-cite-quote { display: block; color: var(--text-primary); }
.ap-cite-src { display: block; margin-top: 4px; font-size: 12px; color: var(--accent); }
.ap-cite-url { display: block; margin-top: 2px; font-size: 11px; color: var(--text-hint); word-break: break-all; }
```

- [ ] **Step 5: 手动验证 + 提交**

启动前后端（`./run-app.ps1` 或分别起），在写作页选中一句论断 → 点「📚 找引文」→ 确认出现带出处的候选、点一条提示「已复制 ✓」。

```bash
git add frontend/src/components/AssistPanel.jsx frontend/src/App.css
git commit -m "feat(editor): 写作工具新增「找引文」划词动作"
```

---

## Task 5: ReaderPanel 组件 + 浮层信件 + 挂载

**Files:**
- Create: `frontend/src/components/ReaderPanel.jsx`
- Modify: `frontend/src/pages/Write.jsx`
- Modify: `frontend/src/App.css`

视觉/文案参照 `design-samples/读者视角-阅读区.html`（班底配置、字徽、信纸、印章动画、逐段浮现）。真实集成：右栏只放紧凑入口，点击后信以浮层呈现。

- [ ] **Step 1: 新建 ReaderPanel 组件**

新建 `frontend/src/components/ReaderPanel.jsx`：

```javascript
import { useState } from 'react'
import { assistReader } from '../api'

// 5 个固定人格读者。字徽 + 名 + 一行「在意什么」。
const READERS = [
  { key: 'poet', glyph: '诗', name: '诗人', care: '意象 · 节奏 · 语言质地' },
  { key: 'novelist', glyph: '叙', name: '小说家', care: '人物 · 场景 · 是演还是讲' },
  { key: 'philosopher', glyph: '哲', name: '哲学家', care: '这篇底下真正在问什么' },
  { key: 'editor', glyph: '编', name: '编辑', care: '骨架 · 开头中段结尾' },
  { key: 'debater', glyph: '辩', name: '辩论家', care: '立论 · 逻辑的漏洞' },
]

/**
 * 读者视角：从右栏紧凑入口选一位读者 → 读整篇 → 浮层呈现一封信。
 * props: getDoc() => { title, content }   读取当前编辑器内容（整篇）
 *        collapsed, onToggle
 * 信只读、不替换原文。
 */
export default function ReaderPanel({ getDoc, collapsed, onToggle }) {
  const [reader, setReader] = useState(null)   // 当前选中的读者
  const [loading, setLoading] = useState(false)
  const [letter, setLetter] = useState('')
  const [error, setError] = useState('')

  const ask = async (r) => {
    const { title, content } = getDoc()
    if (!content.trim()) { setError('先写点东西，再请人来读。'); setReader(r); setLetter(''); return }
    setReader(r); setLoading(true); setLetter(''); setError('')
    try {
      const res = await assistReader({ title, content, persona: r.key })
      setLetter(res.data.letter || '')
    } catch {
      setError('AI 调用失败，请稍后再试')
    } finally {
      setLoading(false)
    }
  }
  const close = () => { setReader(null); setLetter(''); setError(''); setLoading(false) }

  if (collapsed) {
    return (
      <aside className="reader-panel collapsed">
        <button className="rp-expand" onClick={onToggle} title="展开读者视角">📖</button>
      </aside>
    )
  }

  return (
    <>
      <aside className="reader-panel">
        <div className="rp-head">
          <span className="rp-title">📖 读者视角</span>
          <button className="rp-collapse" onClick={onToggle} title="收起">▸</button>
        </div>
        <div className="rp-tip">今天，请谁读完你这篇？换一个人，在意的东西就变。</div>
        <div className="rp-readers">
          {READERS.map(r => (
            <button key={r.key} className="rp-reader" onClick={() => ask(r)}>
              <span className="rp-seal">{r.glyph}</span>
              <span className="rp-meta">
                <span className="rp-name">{r.name}</span>
                <span className="rp-care">{r.care}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {reader && (
        <div className="modal-overlay" onClick={close}>
          <div className="letter-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="lm-head">
              <span className="lm-seal">{reader.glyph}</span>
              <span className="lm-who">{reader.name}</span>
              <button className="lm-x" onClick={close}>✕</button>
            </div>
            {loading ? (
              <div className="lm-typing">{reader.name} 正在读…</div>
            ) : error ? (
              <div className="lm-err">{error}</div>
            ) : (
              <div className="lm-body">{letter}</div>
            )}
            <div className="lm-acts">
              {!loading && !error && <button className="ap-btn" onClick={() => ask(reader)}>让他再读一遍</button>}
              <button className="ap-ghost" onClick={close}>合上信</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: 在 Write.jsx 挂载 ReaderPanel**

在 `frontend/src/pages/Write.jsx` 顶部 import 区（`import DraftPanel ...` 之后）加：

```javascript
import ReaderPanel from '../components/ReaderPanel'
```

在 `Write` 组件里，和其它面板折叠状态并列处（`const [draftPanelCollapsed, setDraftPanelCollapsed] = useState(false)` 之后）加：

```javascript
  const [readerPanelCollapsed, setReaderPanelCollapsed] = useState(false)
```

在 `return` 的 `<div className="write-right">` 内，`<DraftPanel ... />` 之后插入：

```javascript
        <ReaderPanel
          getDoc={() => ({ title, content: plainText })}
          collapsed={readerPanelCollapsed}
          onToggle={() => setReaderPanelCollapsed((c) => !c)}
        />
```

（`title` 和 `plainText` 在组件作用域内已存在：`title` 是 state，`plainText` 是 `useMemo`。）

- [ ] **Step 3: 加 ReaderPanel 与信件浮层样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* ── 读者视角面板（右栏紧凑入口）── */
.reader-panel {
  width: 300px; flex-shrink: 0;
  background: var(--card-grad); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 14px 16px;
}
.reader-panel.collapsed { width: 44px; padding: 10px 0; display: flex; justify-content: center; }
.rp-expand { border: none; background: none; cursor: pointer; font-size: 18px; line-height: 1; color: var(--accent); }
.rp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.rp-title { font-family: var(--font-serif); font-size: 14px; color: var(--accent); font-weight: 600; }
.rp-collapse { border: none; background: none; color: var(--text-hint); font-size: 14px; cursor: pointer; }
.rp-tip { font-size: 12px; line-height: 1.6; color: var(--text-hint); margin-bottom: 12px; }
.rp-readers { display: flex; flex-direction: column; gap: 6px; }
.rp-reader {
  display: flex; gap: 12px; align-items: center; text-align: left; cursor: pointer;
  background: none; border: 1px solid transparent; border-radius: var(--radius-md);
  padding: 9px 10px; transition: all .2s; font-family: inherit; color: inherit;
}
.rp-reader:hover { background: var(--panel2); border-color: var(--border-soft); }
.rp-seal {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
  font-family: var(--font-serif); font-size: 16px; color: var(--accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 22%, var(--panel)), var(--panel2));
  border: 1px solid var(--accent-light);
}
.rp-meta { display: flex; flex-direction: column; }
.rp-name { font-family: var(--font-serif); font-size: 14px; color: var(--text-primary); font-weight: 500; }
.rp-care { font-size: 11.5px; color: var(--text-hint); margin-top: 2px; }

/* ── 信件浮层（复用 .modal-overlay 的居中遮罩）── */
.letter-modal {
  width: min(640px, 92vw); max-height: 84vh; overflow-y: auto;
  background: var(--card-grad); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-card), var(--shadow-glow);
  padding: 28px clamp(20px, 4vw, 40px) 24px; position: relative;
}
.lm-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.lm-seal {
  width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center;
  font-family: var(--font-serif); font-size: 22px; color: var(--accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 26%, var(--panel)), var(--panel2));
  border: 1.5px solid var(--accent-light); animation: stamp .5s cubic-bezier(.2,1.3,.4,1) both;
}
@keyframes stamp { 0% { transform: scale(1.6) rotate(-12deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: scale(1) rotate(0); } }
.lm-who { font-family: var(--font-serif); font-size: 17px; font-weight: 600; color: var(--text-primary); }
.lm-x { margin-left: auto; border: none; background: none; color: var(--text-hint); font-size: 15px; cursor: pointer; }
.lm-typing { font-size: 14px; color: var(--text-hint); padding: 24px 0; }
.lm-err { font-size: 14px; color: #e07a6a; padding: 16px 0; }
.lm-body {
  font-family: var(--font-serif); font-size: 15.5px; line-height: 2; color: var(--text-primary);
  white-space: pre-wrap; animation: rise .6s ease both;
}
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.lm-acts { display: flex; gap: 10px; margin-top: 20px; }
```

- [ ] **Step 4: 手动验证**

启动前后端。写作页写一段文字 → 右栏「📖 读者视角」选「辩论家」→ 出现「辩论家 正在读…」→ 弹出一封信（印章落下、信文浮现）。空文档时点读者应提示「先写点东西」。验证「让他再读一遍」「合上信」「✕」「点遮罩关闭」都正常；信不改动编辑器原文。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ReaderPanel.jsx frontend/src/pages/Write.jsx frontend/src/App.css
git commit -m "feat(editor): 读者视角面板 + 浮层信件阅读区"
```

---

## Task 6: 端到端验证与收尾

**Files:** 无（验证）

- [ ] **Step 1: 跑后端测试全绿**

Run: `cd backend && python -m pytest -v`
Expected: 含新增 8 个 assist 测试在内全部 PASS

- [ ] **Step 2: 前端构建无错**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 import/语法错误

- [ ] **Step 3: 真机走查（需真实 ANTHROPIC_API_KEY）**

- 找引文：选一句真实论断 → 出 2–3 条带可点链接的证据；编造测试（生僻论断）应优雅返回空态文案。
- 读者视角：五位读者各读一遍同一篇，回信第一人称、风格各异、不替换原文。
- 面板分组观感：右栏「写作工具 / 草稿箱 / 读者视角」三块竖排，折叠各自独立。

- [ ] **Step 4: 更新 spec 状态**

把 `docs/superpowers/specs/2026-06-18-reader-and-cite-tools-design.md` 头部 `**状态**: 待实现` 改为 `**状态**: 已实现`。

```bash
git add docs/superpowers/specs/2026-06-18-reader-and-cite-tools-design.md
git commit -m "docs: 读者视角 + 找引文 实现完成，标记 spec 已实现"
```

---

## Self-Review 备注

- **Spec 覆盖**：reader 端点（§4）→ Task 1/5；cite 端点（§5）→ Task 2/4；api.js（§6）→ Task 3；不注入 SOUL（§5 决策）→ Task 1/2 测试断言 `写作风格为 not in system`；方案 B 分家（§3）→ 找引文进 AssistPanel、读者视角独立 ReaderPanel。
- **类型一致**：cite 返回 `{options:[{quote,source,url}]}`，前端 Task 4 按对象三字段渲染；reader 返回 `{letter}`，前端 Task 5 读 `res.data.letter`。
- **web_search 依赖核实**：工具名 `web_search_20260209`、`pause_turn` 续跑、模型 `claude-sonnet-4-6`/`claude-opus-4-8` 均按 claude-api 参考（Python SDK，`anthropic_client.messages.create`，与现有 assist 一致）。
- **测试桩兼容**：现有 `mock_anthropic` 的 `_Resp` 无 `stop_reason`，cite 的 `getattr(message,"stop_reason",None)` 取 None，循环一轮退出，无需改 conftest。
