# 读者信箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「读者视角」生成的信能留存、随稿子（草稿/随笔）流转，在随笔详情页查看 / 新增 / 删除，每篇上限 5 封。

**Architecture:** 信以 JSON 数组存在 `drafts.letters` / `essays.letters` 列上（沿用 mood_card 的 JSON-on-record 惯例）。写作页把信存进 `letters` 状态、随自动保存/草稿/发布一路持久化；详情页用 essay 维度的追加/删除端点单独增删。前端抽出共用的 `ReaderLetterModal`（生成+展示一封信）。

**Tech Stack:** Python/FastAPI/SQLAlchemy（后端，pytest+TestClient）；React+Vite+axios（前端，手动验证）。

**Spec:** `docs/superpowers/specs/2026-06-22-reader-letterbox-design.md`

---

## File Structure

**后端（`backend/main.py`）**
- `migrate_db()`：给 essays/drafts 加 `letters` 列。
- `Essay` / `Draft`：加 `letters = Column(Text)`。
- 助手 `_parse_letters` / `_dump_letters` / `_gen_letter_id`。
- `EssayCreate` / `DraftRequest` 加 `letters`；`create_essay` / `create_draft` / `update_draft` 写入；`get_essay` / `_draft_dict` 返回。
- 新端点 `POST /essays/{id}/letters`、`DELETE /essays/{id}/letters/{lid}`。

**后端测试（`backend/tests/test_letters.py`，新建）**

**前端**
- `frontend/src/api.js`：`saveEssayLetter` / `deleteEssayLetter`。
- `frontend/src/components/ReaderLetterModal.jsx`：**新建**，共用信浮层（生成+展示+留存按钮）。
- `frontend/src/components/ReaderPanel.jsx`：导出 `READERS`，改用 `ReaderLetterModal`，加留存与上限态。
- `frontend/src/components/ReaderLetterbox.jsx`：**新建**，详情页读者来信区。
- `frontend/src/pages/Write.jsx`：`letters` 状态 + 三处持久化。
- `frontend/src/pages/EssayDetail.jsx`：挂载 `ReaderLetterbox`。
- `frontend/src/App.css`：读者来信区样式。

---

## Task 1: 后端 — essay letters 列 / 助手 / create & get

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_letters.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_letters.py`：

```python
import main


def _seed_essay():
    s = main.Session()
    e = main.Essay(title="T", content="c", date="2026-06-22", word_count=1, sentiment_score=0.5)
    s.add(e); s.flush(); eid = e.id; s.commit(); s.close()
    return eid


def test_create_essay_with_letters_then_get(client, db):
    letters = [{"id": "lt_1", "persona": "poet", "persona_name": "诗人",
                "content": "来信", "created_at": "2026-06-22T10:00:00"}]
    r = client.post("/essays", json={"title": "T", "content": "今天很好。",
                                     "date": "2026-06-22", "letters": letters})
    assert r.status_code == 200
    eid = r.json()["id"]
    g = client.get(f"/essays/{eid}")
    assert g.status_code == 200
    assert len(g.json()["letters"]) == 1
    assert g.json()["letters"][0]["persona_name"] == "诗人"


def test_create_essay_rejects_over_5_letters(client, db):
    letters = [{"id": f"lt_{i}", "persona": "poet", "persona_name": "诗人",
                "content": "x", "created_at": "t"} for i in range(6)]
    r = client.post("/essays", json={"title": "T", "content": "c",
                                     "date": "2026-06-22", "letters": letters})
    assert r.status_code == 400


def test_get_essay_without_letters_returns_empty_list(client, db):
    eid = _seed_essay()
    g = client.get(f"/essays/{eid}")
    assert g.json()["letters"] == []
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: FAIL（`letters` 字段不存在 / KeyError）

- [ ] **Step 3: 加列、助手、模型字段**

在 `backend/main.py` 的 `migrate_db()` 里，essays 列清单末尾加一项，并在 drafts 段加一句：

```python
            ("content_rich",       "TEXT"),
            ("letters",            "TEXT"),
```

drafts 段（`ALTER TABLE drafts ADD COLUMN content_rich TEXT` 之后）追加：

```python
        try:
            conn.execute(text("ALTER TABLE drafts ADD COLUMN letters TEXT"))
            conn.commit()
        except Exception:
            pass  # 列已存在
```

`Essay` 模型（`content_rich` 列之后）加：

```python
    letters = Column(Text)          # JSON 数组：读者来信，每封 {id,persona,persona_name,content,created_at}
```

`Draft` 模型（`content_rich` 列之后）加：

```python
    letters = Column(Text)          # JSON 数组：随稿子流转的读者来信
```

在 `migrate_db()` 定义之前（或任意模块级位置，json 已导入）加助手：

```python
MAX_LETTERS = 5


def _parse_letters(raw) -> list:
    try:
        v = json.loads(raw) if raw else []
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _dump_letters(items) -> str:
    return json.dumps((items or [])[:MAX_LETTERS], ensure_ascii=False)


def _gen_letter_id() -> str:
    import uuid
    return "lt_" + uuid.uuid4().hex[:10]
```

- [ ] **Step 4: create_essay 接收 letters + 上限校验；get_essay 返回**

`EssayCreate` 加字段：

```python
class EssayCreate(BaseModel):
    title: str
    content: str
    date: str
    content_rich: str | None = None
    letters: list | None = None
```

`create_essay` 函数体最前面（`analysis = analyze_text(...)` 之前）加校验，并在构造 `Essay(...)` 时写入 `letters`：

```python
def create_essay(data: EssayCreate):
    if data.letters and len(data.letters) > MAX_LETTERS:
        raise HTTPException(status_code=400, detail="读者信箱最多 5 封")
    analysis = analyze_text(data.content)
```

`Essay(...)` 构造里 `mood_card=...` 那行之后加：

```python
        mood_card=json.dumps(mood, ensure_ascii=False),
        letters=_dump_letters(data.letters or []),
```

`get_essay` 的 `result` 字典里 `"mood_card": ...` 之后加：

```python
        "letters": _parse_letters(essay.letters),
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: 3 个测试 PASS

- [ ] **Step 6: 提交**

```bash
git add backend/main.py backend/tests/test_letters.py
git commit -m "feat(letters): essays.letters 列 + create/get 支持读者来信"
```

---

## Task 2: 后端 — essay 单封追加 / 删除端点

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_letters.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_letters.py` 末尾追加：

```python
def test_append_letter_returns_array_with_new(client, db):
    eid = _seed_essay()
    r = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "来信"})
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) == 1
    assert arr[0]["persona"] == "poet"
    assert arr[0]["id"] and arr[0]["created_at"]


def test_append_sixth_letter_rejected(client, db):
    eid = _seed_essay()
    for i in range(5):
        client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": str(i)})
    r = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "x"})
    assert r.status_code == 400


def test_delete_letter_idempotent(client, db):
    eid = _seed_essay()
    a = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "来信"}).json()
    lid = a[0]["id"]
    r = client.delete(f"/essays/{eid}/letters/{lid}")
    assert r.status_code == 200 and r.json() == []
    r2 = client.delete(f"/essays/{eid}/letters/{lid}")
    assert r2.status_code == 200 and r2.json() == []
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -k "append or delete" -v`
Expected: FAIL（404，端点不存在）

- [ ] **Step 3: 实现端点**

在 `get_essay` 函数之后插入：

```python
class LetterIn(BaseModel):
    persona: str
    persona_name: str = ""
    content: str


@app.post("/essays/{essay_id}/letters")
def add_essay_letter(essay_id: int, data: LetterIn):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    letters = _parse_letters(essay.letters)
    if len(letters) >= MAX_LETTERS:
        session.close()
        raise HTTPException(status_code=400, detail="读者信箱已满，最多 5 封")
    letters.append({
        "id": _gen_letter_id(),
        "persona": data.persona,
        "persona_name": data.persona_name,
        "content": data.content,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    })
    essay.letters = _dump_letters(letters)
    session.commit()
    session.close()
    return letters


@app.delete("/essays/{essay_id}/letters/{letter_id}")
def delete_essay_letter(essay_id: int, letter_id: str):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    letters = [lt for lt in _parse_letters(essay.letters) if lt.get("id") != letter_id]
    essay.letters = _dump_letters(letters)
    session.commit()
    session.close()
    return letters
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_letters.py
git commit -m "feat(letters): essay 单封追加/删除端点 + 5 封上限"
```

---

## Task 3: 后端 — draft 接收并返回 letters

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_letters.py`（追加）

- [ ] **Step 1: 追加失败测试**

```python
def test_draft_with_letters_roundtrip(client, db):
    letters = [{"id": "lt_1", "persona": "editor", "persona_name": "编辑",
                "content": "来信", "created_at": "t"}]
    c = client.post("/drafts", json={"title": "T", "content": "内容",
                                     "date": "2026-06-22", "letters": letters})
    assert c.status_code == 200
    assert len(c.json()["letters"]) == 1
    lst = client.get("/drafts").json()
    assert any(len(d.get("letters", [])) == 1 for d in lst)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -k draft -v`
Expected: FAIL（`letters` 不在返回里）

- [ ] **Step 3: 实现**

`DraftRequest` 加字段：

```python
class DraftRequest(BaseModel):
    title: str = ""
    content: str
    date: str = ""
    content_rich: str | None = None
    letters: list | None = None
```

`_draft_dict` 的返回字典里 `"content_rich": d.content_rich,` 之后加：

```python
        "letters": _parse_letters(d.letters),
```

`create_draft` 的 `Draft(...)` 构造里加 `letters=_dump_letters(data.letters or [])`：

```python
    d = Draft(title=data.title or "", content=data.content, content_rich=data.content_rich,
              date=data.date or "", letters=_dump_letters(data.letters or []),
              created_at=now, updated_at=now)
```

`update_draft` 里 `d.content_rich = data.content_rich` 之后加：

```python
    d.letters = _dump_letters(data.letters or [])
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_letters.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_letters.py
git commit -m "feat(letters): 草稿创建/更新随稿子存取读者来信"
```

---

## Task 4: 前端 api.js

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 加两个接口**

`assistCite` 那行之后加：

```javascript
export const saveEssayLetter = (id, data) => api.post(`/essays/${id}/letters`, data)
export const deleteEssayLetter = (id, letterId) => api.delete(`/essays/${id}/letters/${letterId}`)
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api.js
git commit -m "feat(api): 读者来信存取接口"
```

---

## Task 5: 前端 — 抽出 ReaderLetterModal，改造 ReaderPanel

**Files:**
- Create: `frontend/src/components/ReaderLetterModal.jsx`
- Modify: `frontend/src/components/ReaderPanel.jsx`

- [ ] **Step 1: 新建共用信浮层**

新建 `frontend/src/components/ReaderLetterModal.jsx`：

```javascript
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { assistReader } from '../api'

/**
 * 共用读者信浮层：给定 reader（人格对象 {key,glyph,name}）与 getDoc()，
 * 拉取并展示一封信。onSave(reader, content) 存在时显示「留存这封信」；
 * saveDisabled/saveHint 控制上限态。
 */
export default function ReaderLetterModal({ reader, getDoc, onClose, onSave, saveDisabled, saveHint }) {
  const [loading, setLoading] = useState(false)
  const [letter, setLetter] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!reader) return
    let alive = true
    const { title, content } = getDoc()
    if (!content.trim()) { setError('先写点东西，再请人来读。'); setLetter(''); setLoading(false); return }
    setLoading(true); setLetter(''); setError(''); setSaved(false)
    assistReader({ title, content, persona: reader.key })
      .then(r => { if (alive) { setLetter(r.data.letter || ''); setLoading(false) } })
      .catch(() => { if (alive) { setError('AI 调用失败，请稍后再试'); setLoading(false) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, nonce])

  if (!reader) return null
  const doSave = () => { onSave(reader, letter); setSaved(true) }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="letter-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="lm-head">
          <span className="lm-seal">{reader.glyph}</span>
          <span className="lm-who">{reader.name}</span>
          <button className="lm-x" onClick={onClose}>✕</button>
        </div>
        {loading ? <div className="lm-typing">{reader.name} 正在读…</div>
          : error ? <div className="lm-err">{error}</div>
          : <div className="lm-body">{letter}</div>}
        <div className="lm-acts">
          {!loading && !error && (
            <button className="ap-btn" onClick={() => setNonce(n => n + 1)}>让他再读一遍</button>
          )}
          {!loading && !error && onSave && (
            saved ? <span className="lm-saved">已留存 ✓</span>
              : saveDisabled ? <span className="lm-hint">{saveHint}</span>
                : <button className="ap-btn" onClick={doSave}>留存这封信</button>
          )}
          <button className="ap-ghost" onClick={onClose}>合上信</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 2: 改造 ReaderPanel —— 导出 READERS、用 Modal、加留存与上限**

把 `frontend/src/components/ReaderPanel.jsx` **整体替换**为：

```javascript
import { useState } from 'react'
import Icon from './Icon'
import ReaderLetterModal from './ReaderLetterModal'

// 5 个固定人格读者（导出供详情页复用）。
export const READERS = [
  { key: 'poet', glyph: '诗', name: '诗人', care: '意象 · 节奏 · 语言质地' },
  { key: 'novelist', glyph: '叙', name: '小说家', care: '人物 · 场景 · 是演还是讲' },
  { key: 'philosopher', glyph: '哲', name: '哲学家', care: '这篇底下真正在问什么' },
  { key: 'editor', glyph: '编', name: '编辑', care: '骨架 · 开头中段结尾' },
  { key: 'debater', glyph: '辩', name: '辩论家', care: '立论 · 逻辑的漏洞' },
]

/**
 * 写作页读者视角入口。
 * props: getDoc() => {title, content}; collapsed, onToggle;
 *        onSaveLetter(reader, content) 把信留存到当前稿子; savedCount 已存封数。
 */
export default function ReaderPanel({ getDoc, collapsed, onToggle, onSaveLetter, savedCount = 0 }) {
  const [reader, setReader] = useState(null)
  const atLimit = savedCount >= 5

  if (collapsed) {
    return (
      <aside className="reader-panel collapsed">
        <button className="rp-expand" onClick={onToggle} title="展开读者视角"><Icon name="reader" className="seal-ic--plain" /></button>
      </aside>
    )
  }

  return (
    <>
      <aside className="reader-panel">
        <div className="rp-head">
          <span className="rp-title"><Icon name="reader" className="seal-ic--sm" /> 读者视角</span>
          <button className="rp-collapse" onClick={onToggle} title="收起">▸</button>
        </div>
        <div className="rp-tip">今天，请谁读完你这篇？换一个人，在意的东西就变。</div>
        <div className="rp-readers">
          {READERS.map(r => (
            <button key={r.key} className="rp-reader" onClick={() => setReader(r)}>
              <span className="rp-seal">{r.glyph}</span>
              <span className="rp-meta">
                <span className="rp-name">{r.name}</span>
                <span className="rp-care">{r.care}</span>
              </span>
            </button>
          ))}
        </div>
        {onSaveLetter && <div className="rp-count">已留存 {savedCount}/5 封{atLimit ? ' · 已满' : ''}</div>}
      </aside>

      <ReaderLetterModal
        reader={reader}
        getDoc={getDoc}
        onClose={() => setReader(null)}
        onSave={onSaveLetter ? (rd, content) => onSaveLetter(rd, content) : undefined}
        saveDisabled={atLimit}
        saveHint="读者信箱已满（5/5），去文章详情页删几封"
      />
    </>
  )
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/ReaderLetterModal.jsx frontend/src/components/ReaderPanel.jsx
git commit -m "feat(reader): 抽出 ReaderLetterModal，写作页读者视角支持留存"
```

---

## Task 6: 前端 — Write.jsx 的 letters 状态与持久化

**Files:**
- Modify: `frontend/src/pages/Write.jsx`

写作页要：① 维护 `letters` 状态；② 自动保存(localStorage)、存草稿箱、发布三处带上 letters；③ 打开草稿/清空时同步。

- [ ] **Step 1: 初始化里读取 letters**

`Write.jsx` 顶部 `const [init] = useState(() => {...})` 内：
- `prefill` 分支返回对象加 `letters: []`。
- localStorage 分支：解析对象后返回里加 `letters: d.letters || []`。
- 兜底 return 加 `letters: []`。

具体把这三处 return 改成带 `letters` 字段。例如 localStorage 分支：

```javascript
        return { blocks, title: d.title || '', date: d.date || today, at: d.at || '', restored: !!(d.title || d.content || (d.blocks && d.blocks.length)), letters: d.letters || [] }
```

prefill 分支与末尾 return 同样补 `letters: prefill ? [] : []`（prefill 无信）和 `letters: []`。

- [ ] **Step 2: 加 letters 状态与留存函数**

`const [docBlocks, setDocBlocks] = useState(...)` 附近加：

```javascript
  const [letters, setLetters] = useState(init.letters || [])
```

`applyAssist` 等函数附近加：

```javascript
  // 把一封读者来信留存到当前稿子（上限 5；持久化由自动保存/存草稿/发布兜底）
  const saveLetterLocal = (reader, content) => {
    setLetters((ls) => {
      if (ls.length >= 5 || !content) return ls
      const id = 'lt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      return [...ls, { id, persona: reader.key, persona_name: reader.name, content, created_at: new Date().toISOString() }]
    })
  }
```

- [ ] **Step 3: 三处持久化带上 letters**

**(a) 自动保存**：把 `localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, blocks: docBlocks, date, at }))` 改为：

```javascript
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, blocks: docBlocks, date, at, letters }))
```

并把该 `useEffect` 依赖数组末尾加入 `letters`。

**(b) 发布**：`createEssay({ title, content: plainText, date, content_rich: JSON.stringify(docBlocks) })` 改为：

```javascript
      const res = await createEssay({
        title, content: plainText, date, content_rich: JSON.stringify(docBlocks), letters,
      })
```

**(c) 存草稿箱**：`DraftPanel` 的 `current` prop 加 `letters`：

```javascript
          current={{ title, content: plainText, date, content_rich: JSON.stringify(docBlocks), letters }}
```

- [ ] **Step 4: 打开草稿 / 清空时同步 letters**

`openDraft(d)` 里 `setDocBlocks(blocks)` 之后加：

```javascript
    setLetters(d.letters || [])
```

`doClear()` 里 `setDocBlocks(empty)` 之后加：

```javascript
    setLetters([])
```

- [ ] **Step 5: 把留存接口传给 ReaderPanel**

`<ReaderPanel ... />` 改为：

```javascript
        <ReaderPanel
          getDoc={() => ({ title, content: plainText })}
          collapsed={readerPanelCollapsed}
          onToggle={() => setReaderPanelCollapsed((c) => !c)}
          onSaveLetter={saveLetterLocal}
          savedCount={letters.length}
        />
```

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/Write.jsx
git commit -m "feat(write): 读者来信随稿子（自动保存/草稿/发布）一路持久化"
```

---

## Task 7: 前端 — 详情页读者来信区

**Files:**
- Create: `frontend/src/components/ReaderLetterbox.jsx`
- Modify: `frontend/src/pages/EssayDetail.jsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: 新建 ReaderLetterbox**

新建 `frontend/src/components/ReaderLetterbox.jsx`：

```javascript
import { useState } from 'react'
import { READERS } from './ReaderPanel'
import ReaderLetterModal from './ReaderLetterModal'
import { SealChar } from './Icon'
import { saveEssayLetter, deleteEssayLetter } from '../api'

const GLYPH = Object.fromEntries(READERS.map(r => [r.key, r.glyph]))

/**
 * 详情页「读者来信」区：看已存来信、请读者再读这篇并留存、删除任意一封。
 * props: essayId, title, content（已保存随笔的标题与正文）, initialLetters
 */
export default function ReaderLetterbox({ essayId, title, content, initialLetters }) {
  const [letters, setLetters] = useState(initialLetters || [])
  const [reader, setReader] = useState(null)
  const atLimit = letters.length >= 5

  const handleSave = async (rd, text) => {
    try {
      const r = await saveEssayLetter(essayId, { persona: rd.key, persona_name: rd.name, content: text })
      setLetters(r.data)
    } catch { /* 忽略；上限会被后端拦下 */ }
  }
  const remove = async (lid) => {
    try { const r = await deleteEssayLetter(essayId, lid); setLetters(r.data) } catch { /* ignore */ }
  }

  return (
    <section className="section reader-box">
      <h2>读者来信</h2>
      <p className="section-desc">请一位读者读这篇，留下的信会一直在这儿。最多 5 封。</p>

      <div className="rb-readers">
        {READERS.map(r => (
          <button key={r.key} className="rp-reader" disabled={atLimit} onClick={() => setReader(r)}>
            <span className="rp-seal">{r.glyph}</span>
            <span className="rp-meta">
              <span className="rp-name">{r.name}</span>
              <span className="rp-care">{r.care}</span>
            </span>
          </button>
        ))}
      </div>
      {atLimit && <div className="rb-limit">读者信箱已满（5/5），删掉几封再请新读者。</div>}

      <div className="rb-list">
        {letters.length === 0 && <div className="rb-empty">还没有读者来信。</div>}
        {letters.map(lt => (
          <article key={lt.id} className="rb-letter">
            <div className="rb-letter-head">
              <SealChar char={GLYPH[lt.persona] || (lt.persona_name || '读')[0]} className="seal-ic--sm" />
              <span className="rb-letter-who">{lt.persona_name}</span>
              <span className="rb-letter-date">{(lt.created_at || '').slice(0, 10)}</span>
              <button className="rb-del" onClick={() => remove(lt.id)}>删除</button>
            </div>
            <div className="rb-letter-body">{lt.content}</div>
          </article>
        ))}
      </div>

      <ReaderLetterModal
        reader={reader}
        getDoc={() => ({ title, content })}
        onClose={() => setReader(null)}
        onSave={handleSave}
        saveDisabled={atLimit}
        saveHint="读者信箱已满（5/5）"
      />
    </section>
  )
}
```

- [ ] **Step 2: EssayDetail 挂载**

`frontend/src/pages/EssayDetail.jsx` 顶部加 import：

```javascript
import ReaderLetterbox from '../components/ReaderLetterbox'
```

在渲染里 `{essay.mood_card && (<MoodCard ... />)}` 之后、`<div className="detail-analysis">` 之前插入：

```javascript
          <ReaderLetterbox
            essayId={essay.id}
            title={essay.title}
            content={essay.content}
            initialLetters={essay.letters || []}
          />
```

- [ ] **Step 3: 样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* ── 详情页：读者来信区 ── */
.reader-box .rb-readers { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.reader-box .rp-reader { width: auto; flex: 0 0 auto; }
.reader-box .rp-reader:disabled { opacity: .45; cursor: not-allowed; }
.reader-box .rp-care { display: none; }
.rb-limit { font-size: 12px; color: var(--text-hint); margin: 4px 0 10px; }
.rb-empty { font-size: 13px; color: var(--text-hint); padding: 8px 0; }
.rb-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.rb-letter { background: var(--panel2); border: 1px solid var(--border-soft); border-radius: var(--radius-md); padding: 12px 14px; }
.rb-letter-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.rb-letter-who { font-family: var(--font-serif); font-size: 13px; font-weight: 600; color: var(--text-primary); }
.rb-letter-date { font-size: 11px; color: var(--text-hint); }
.rb-del { margin-left: auto; border: none; background: none; color: var(--text-hint); font-size: 12px; cursor: pointer; }
.rb-del:hover { color: #e07a6a; }
.rb-letter-body { font-family: var(--font-serif); font-size: 14px; line-height: 1.9; color: var(--text-primary); white-space: pre-wrap; }
```

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ReaderLetterbox.jsx frontend/src/pages/EssayDetail.jsx frontend/src/App.css
git commit -m "feat(detail): 详情页读者来信区（看/再读留存/删除）"
```

---

## Task 8: 端到端验证与收尾

**Files:** 无（验证）

- [ ] **Step 1: 后端全套测试**

Run: `cd backend && venv/Scripts/python.exe -m pytest`
Expected: 含新增 letters 测试在内全部 PASS

- [ ] **Step 2: 前端构建**

Run: `cd frontend && npm run build`
Expected: 成功

- [ ] **Step 3: 真机走查（需重启后端进程加载新路由/迁移）**

- 写作页：写一段 → 读者视角选一位 → 浮层「留存这封信」→ 面板显示「已留存 1/5」→ 存入草稿箱 → 刷新页面，重开该草稿，信还在。
- 留满 5 封 → 第 6 次留存按钮变灰提示「读者信箱已满」。
- 草稿点「保存」发布 → 去该随笔详情页 → 「读者来信」区能看到那几封。
- 详情页：请读者再读 → 留存（追加）；删除任意一封（含草稿带来的）；满 5 封时班底入口置灰。

- [ ] **Step 4: 更新 spec 状态 + 提交**

把 `docs/superpowers/specs/2026-06-22-reader-letterbox-design.md` 头部 `**状态**: 待实现` 改为 `**状态**: 已实现`。

```bash
git add docs/superpowers/specs/2026-06-22-reader-letterbox-design.md
git commit -m "docs: 读者信箱实现完成，标记 spec 已实现"
```

---

## Self-Review 备注

- **Spec 覆盖**：数据列(§3)→T1/T3；create/get(§4.2-4.3)→T1；追加/删除端点(§4.4)→T2；草稿存取→T3；api.js(§5.4)→T4；ReaderLetterModal 抽取(§5.3)+写作页留存(§5.1)→T5/T6；详情页来信区(§5.2)→T7；5 封上限前后端→T1(create)/T2(append)/T5/T6(写作页置灰)/T7(详情页置灰)。
- **类型一致**：信对象字段 `{id,persona,persona_name,content,created_at}` 前后端一致；后端 `POST/DELETE` 都返回**整个 letters 数组**，前端 `setLetters(r.data)` 直接用。
- **持久化兜底**：写作页留存只改本地 `letters` 状态，落库靠自动保存/草稿/发布三条路径携带，无需写作页单独发请求——与 spec §2「不做草稿单封端点」一致。
- **迁移/重启**：新增列与路由要求后端进程重启才生效（开发用旧进程不会自动加载）。
