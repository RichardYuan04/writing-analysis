# 半成品仓库 续写智能化(#1) + 合并续写(#2) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans，逐任务实现。步骤用 `- [ ]` 复选框追踪。

**Goal:** 把半成品仓库从「只读陈列」变成「创作起点」：续写时带上 `ai_hint` 提示并能一键让 AI 按作者风格接着写；支持多选片段 / 整主题合并成一篇草稿。

**Architecture:** 统一写作页入参 `prefill` 从纯字符串升为 `{ text, hints[] }`（向后兼容字符串）。新增后端 `POST /assist/continue` 复用 `_assist_call` 的 SOUL 注入。前端：`Write.jsx` 加提示横幅 + 「让 AI 接着写」；`DraftVault.jsx` 加多选态 + 合并续写 + 整主题开一篇。`App.jsx` 无需改动（已透传 prefill）。

**Tech Stack:** FastAPI 单文件后端 + pytest；React/Vite 前端（无单测框架，前端任务用 `npm run build` + 手动走查验证）。

**已确认决策（spec §6，全部采用推荐项）：** 一键触发 / 新端点 `/assist/continue` / hint 用横幅 / 合并按点选顺序+空行 / 软上限 8 段 / 结果直接插入末尾可编辑 / 选择交互用「多选」开关。

---

### Task 1: 后端 `POST /assist/continue` 端点

**Files:**
- Modify: `backend/main.py`（在 `assist_expand` 之后、`# ── 读者视角 ──` 之前插入）
- Test: `backend/tests/test_assist_tools.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_assist_tools.py` 末尾追加：

```python
# ── /assist/continue：续写（注入 SOUL，把 hint 带进 user）──

def test_continue_returns_result_and_uses_sonnet(client, mock_anthropic):
    mock_anthropic.set_text("夜更深了，便利店的灯还亮着，像替谁守着一盏。")
    r = client.post("/assist/continue", json={
        "text": "我买了一瓶水，其实并不渴。", "hints": ["把'灯'这个意象再推一层"],
    })
    assert r.status_code == 200
    assert r.json()["result"].startswith("夜更深了")
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-sonnet-4-6"


def test_continue_injects_soul_taboo_and_hint(client, mock_anthropic, db):
    mock_anthropic.set_text("续写内容")
    client.post("/assist/continue", json={
        "text": "原文一句。", "hints": ["朝孤独的反面写"],
    })
    cap = mock_anthropic.captured
    # 无 SOUL 时 system 回落 DEFAULT_TABOO（含「AI 腔」），证明走了 SOUL 注入路径
    assert "AI 腔" in cap["system"]
    # hint 与原文进了发给模型的 user 消息
    user_msg = cap["messages"][0]["content"]
    assert "朝孤独的反面写" in user_msg
    assert "原文一句" in user_msg


def test_continue_rejects_empty_text(client, mock_anthropic):
    r = client.post("/assist/continue", json={"text": "  ", "hints": []})
    assert r.status_code == 400
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_assist_tools.py -k continue -v`
Expected: FAIL（404 / 端点不存在）

- [ ] **Step 3: 写实现**

在 `backend/main.py` 中 `assist_expand` 函数之后插入：

```python
class ContinueRequest(BaseModel):
    text: str
    hints: list[str] = []
    context: str = ""


@app.post("/assist/continue")
def assist_continue(data: ContinueRequest):
    hints = [h.strip() for h in (data.hints or []) if h and h.strip()]
    hint_line = ("\n可参考的发展方向（不必照搬、不必逐条覆盖）：" + "；".join(hints)) if hints else ""
    user = (
        "你是下面这段文字的作者本人，请接着已有的文字继续往下写。\n"
        "要求：承接原文的语气、思路与情感，自然往下展开 2-4 句；"
        "不要重复或改写已有内容，不要解释、不要加前缀，直接输出续写的部分。"
        f"{hint_line}\n\n已有文字：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=_cap(data.text, 1.2, 400, 1024),
                        parse_options=False, model="claude-sonnet-4-6")
```

> 注：`_assist_call` 只读 `data.text`，`ContinueRequest` 有 `.text` 即兼容；`system=None` → 自动注入 SOUL/禁止项/黄金样例。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_assist_tools.py -k continue -v`
Expected: 3 passed

- [ ] **Step 5: 跑全量后端测试**

Run: `cd backend && venv/Scripts/python.exe -m pytest -q`
Expected: 全绿（原 65 + 3）

- [ ] **Step 6: 提交**

```bash
git add backend/main.py backend/tests/test_assist_tools.py
git commit -m "feat(vault): /assist/continue 续写端点（复用 SOUL 注入）"
```

---

### Task 2: 前端 api.js 加 `assistContinue`

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 加方法**

在 `frontend/src/api.js` 的 `assistCite` 那一行后面加：

```javascript
export const assistContinue = (data) => api.post('/assist/continue', data)
```

- [ ] **Step 2: 提交**（与 Task 3 一起提交亦可，这里先单独 add）

```bash
git add frontend/src/api.js
```

---

### Task 3: Write.jsx 提示横幅 + 「让 AI 接着写」

**Files:**
- Modify: `frontend/src/pages/Write.jsx`

- [ ] **Step 1: 引入 api + 归一化 prefill**

`Write.jsx` 顶部 import 改为带上 `assistContinue`：

```javascript
import { createEssay, moodReply, deleteDraft, assistContinue } from '../api'
```

把 `init` 计算里 `if (prefill) return {...}` 一段替换为（兼容字符串与对象）：

```javascript
  const pf = prefill ? (typeof prefill === 'string' ? { text: prefill, hints: [] } : prefill) : null
  const [init] = useState(() => {
    if (pf) return { blocks: plainTextToBlocks(pf.text || ''), title: '', date: today, at: '', restored: false, letters: [], hints: pf.hints || [] }
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        const blocks = (d.blocks && d.blocks.length) ? d.blocks : (d.content ? plainTextToBlocks(d.content) : undefined)
        return { blocks, title: d.title || '', date: d.date || today, at: d.at || '', restored: !!(d.title || d.content || (d.blocks && d.blocks.length)), letters: d.letters || [], hints: [] }
      }
    } catch { /* ignore */ }
    return { blocks: undefined, title: '', date: today, at: '', restored: false, letters: [], hints: [] }
  })
```

> 注意：原 `if (prefill) return { blocks: plainTextToBlocks(prefill), ... }` 整体被上面替换；`useState(() => {...})` 内部保持原逻辑，仅每个返回对象补 `hints` 字段。

- [ ] **Step 2: 加状态**

在 `const [readerPanelCollapsed, ...]` 附近加：

```javascript
  const [hints] = useState(init.hints || [])
  const [hintsDismissed, setHintsDismissed] = useState(false)
  const [continuing, setContinuing] = useState(false)
```

- [ ] **Step 3: 加「让 AI 接着写」处理函数**

在 `applyAssist` / `undoLast` 附近加：

```javascript
  // 一键让 AI 按作者风格接着写：取全文 + hints，结果作为新段落插到末尾，可撤销
  const handleAiContinue = async () => {
    if (continuing || !richRef.current) return
    setContinuing(true); setError('')
    try {
      const cur = richRef.current.getDoc()
      const text = blocksToPlainText(cur)
      const res = await assistContinue({ text, hints })
      const addition = (res.data.result || '').trim()
      if (addition) {
        setUndoStack((s) => [...s, richRef.current.snapshot()])
        richRef.current.setBlocks([...richRef.current.getDoc(), ...plainTextToBlocks(addition)])
      }
    } catch {
      setError('AI 接写失败，请稍后再试')
    } finally {
      setContinuing(false)
    }
  }
```

- [ ] **Step 4: 渲染提示横幅**

在 `<RichEditor ... />`（约 235 行）之前插入：

```jsx
        {hints.length > 0 && !hintsDismissed && (
          <div className="vault-hint-banner">
            <button className="vhb-x" onClick={() => setHintsDismissed(true)} aria-label="关闭提示">✕</button>
            <div className="vhb-text">
              <span className="vhb-tag">✦ 来自半成品的提示</span>
              {hints.join('；')}
            </div>
            <button className="vhb-btn" onClick={handleAiContinue} disabled={continuing}>
              {continuing ? '正在接写…' : '✦ 让 AI 接着写'}
            </button>
          </div>
        )}
```

- [ ] **Step 5: 加样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* 半成品续写提示横幅 */
.vault-hint-banner {
  display: flex; align-items: center; gap: 12px;
  background: var(--panel2); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: 8px;
  padding: 10px 14px; margin: 8px 0 14px; font-size: 12px; color: var(--text-secondary);
}
.vault-hint-banner .vhb-text { flex: 1; line-height: 1.6; }
.vault-hint-banner .vhb-tag { color: var(--accent); font-weight: 600; margin-right: 8px; }
.vault-hint-banner .vhb-btn {
  flex-shrink: 0; padding: 6px 14px; border-radius: 7px; border: 1px solid var(--accent);
  background: var(--accent); color: var(--on-accent); font-size: 12px; font-weight: 600; cursor: pointer;
}
.vault-hint-banner .vhb-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.vault-hint-banner .vhb-x {
  flex-shrink: 0; order: 3; background: none; border: none; color: var(--text-hint);
  cursor: pointer; font-size: 13px; padding: 2px 4px;
}
```

- [ ] **Step 6: 构建校验**

Run: `cd frontend && npm run build`
Expected: 构建成功（仅原有 chunk-size 警告）

- [ ] **Step 7: 提交**（含 Task 2 的 api.js）

```bash
git add frontend/src/api.js frontend/src/pages/Write.jsx frontend/src/App.css
git commit -m "feat(vault): 写作页 ai_hint 提示横幅 + 一键让 AI 接着写"
```

---

### Task 4: DraftVault.jsx 单条带 hint + 多选合并 + 整主题开一篇

**Files:**
- Modify: `frontend/src/pages/DraftVault.jsx`

- [ ] **Step 1: 单条续写带上 ai_hint**

把 `handleContinue` 改为传对象：

```javascript
  const handleContinue = (fragment) => {
    onWrite({ text: fragment.content, hints: fragment.ai_hint ? [fragment.ai_hint] : [] })
  }
```

- [ ] **Step 2: 加多选状态与合并逻辑**

在组件顶部 state 区（`hiddenCat` 之后）加：

```javascript
  const MERGE_CAP = 8
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])   // 保留点选顺序

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= MERGE_CAP) return prev      // 到上限不再加
      return [...prev, id]
    })
  }
  const exitSelect = () => { setSelectMode(false); setSelectedIds([]) }

  const mergeContinue = (frags) => {
    const picked = frags.slice(0, MERGE_CAP)
    onWrite({
      text: picked.map(f => f.content).join('\n\n'),
      hints: picked.map(f => f.ai_hint).filter(Boolean),
    })
  }
  const handleMergeSelected = () => {
    // 按点选顺序还原 fragment 对象
    const byId = new Map(fragments.map(f => [f.id, f]))
    const picked = selectedIds.map(id => byId.get(id)).filter(Boolean)
    if (picked.length) mergeContinue(picked)
  }
```

- [ ] **Step 3: 类别视图加「多选」开关**

在类别视图 `view === 'cat'` 的「类别筛选 pills」`<div ...>` 之前（约 308 行 `{/* 类别筛选 pills */}` 上方）插入开关行：

```jsx
              {/* 多选开关 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <button
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  style={{
                    padding: '5px 14px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${selectMode ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectMode ? tint('var(--accent)', 14) : 'transparent',
                    color: selectMode ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600,
                  }}
                >
                  {selectMode ? '✓ 多选中' : '☑ 多选合并'}
                </button>
                {selectMode && (
                  <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
                    勾选多个片段，一起开一篇（最多 {MERGE_CAP} 段）
                  </span>
                )}
              </div>
```

- [ ] **Step 4: FragmentCard 支持选择态**

把类别视图里的 `<FragmentCard ... onContinue={handleContinue} />`（约 328-335 行）改为：

```jsx
                {visibleFragments.map(f => (
                  <FragmentCard
                    key={f.id}
                    fragment={f}
                    onHide={handleHide}
                    onContinue={handleContinue}
                    selectMode={selectMode}
                    selected={selectedIds.includes(f.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
```

在 `FragmentCard` 函数签名与渲染中加入选择态（签名加参数，卡片在 selectMode 下整卡可点切换、隐藏底部按钮、显示勾选标记）。把 `function FragmentCard({ fragment, onHide, onContinue, onRestore, hidden = false })` 改为：

```javascript
function FragmentCard({ fragment, onHide, onContinue, onRestore, hidden = false, selectMode = false, selected = false, onToggleSelect }) {
```

在最外层 `<div style={{ background: ... }}` 上加选择态高亮与点击：把该 div 的 `onMouseEnter/onMouseLeave` 保留，新增 `onClick` 与高亮边框：

```jsx
    <div style={{
      background: hidden ? 'var(--panel2)' : 'var(--card-grad)',
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12,
      display: 'flex', overflow: 'hidden',
      opacity: hidden ? 0.85 : 1,
      boxShadow: selected ? '0 0 0 1px var(--accent)' : 'none',
      cursor: selectMode ? 'pointer' : 'default',
      transition: 'box-shadow 0.2s, transform 0.2s',
    }}
      onClick={selectMode ? () => onToggleSelect(fragment.id) : undefined}
      onMouseEnter={e => { if (!selectMode) { e.currentTarget.style.boxShadow = '0 14px 30px -22px rgba(0,0,0,0.7)'; e.currentTarget.style.transform = 'translateY(-2px)' } }}
      onMouseLeave={e => { if (!selectMode) { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' } }}
    >
```

把底部操作区（约 449-490 行 `{/* 底部：来源 + 操作 */}` 里的 `<div style={{ display: 'flex', gap: 6 }}>...</div>`）在 selectMode 下替换为勾选指示：把那段 `<div style={{ display: 'flex', gap: 6 }}>` 整块用条件包起来——

```jsx
          {selectMode ? (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: selected ? 'var(--accent)' : 'var(--text-hint)',
            }}>
              {selected ? '✓ 已选' : '点选'}
            </span>
          ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            {hidden ? (
              <button
                onClick={() => onRestore(fragment.id)}
                style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11,
                  border: '1px solid #9aab78', background: 'color-mix(in srgb, #9aab78 14%, transparent)',
                  color: '#9aab78', cursor: 'pointer',
                }}
              >
                ↩ 恢复
              </button>
            ) : (
              <>
                <button
                  onClick={() => onHide(fragment.id)}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    border: '1px solid var(--border)', background: 'var(--panel)',
                    color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  隐藏
                </button>
                <button
                  onClick={() => onContinue(fragment)}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    border: '1px solid var(--accent)', background: 'var(--accent)',
                    color: 'var(--on-accent)', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  续写
                </button>
              </>
            )}
          </div>
          )}
```

- [ ] **Step 5: 底部浮动操作条**

在组件最外层 `return (<div className="overview">` 的**末尾**、最后一个 `</div>` 之前插入：

```jsx
      {/* 合并续写浮条 */}
      {selectMode && selectedIds.length > 0 && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 14, zIndex: 50,
          background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 999,
          padding: '10px 20px', boxShadow: '0 14px 36px -18px rgba(0,0,0,0.6)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
            已选 {selectedIds.length} 段{selectedIds.length >= MERGE_CAP ? '（已达上限）' : ''}
          </span>
          <button onClick={() => setSelectedIds([])} style={{
            padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
          }}>清空</button>
          <button onClick={handleMergeSelected} style={{
            padding: '6px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)',
          }}>合并续写 →</button>
        </div>
      )}
```

- [ ] **Step 6: ThemeClusterCard 加「用整组开一篇」**

把主题视图 `<ThemeClusterCard ... onContinue={handleContinue} />`（约 346-350 行）加一个 prop：

```jsx
                <ThemeClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  onContinue={handleContinue}
                  onMergeWhole={() => mergeContinue(cluster.fragments)}
                />
```

`ThemeClusterCard` 签名改为 `function ThemeClusterCard({ cluster, onContinue, onMergeWhole })`；在头部右侧 `{cluster.fragment_count} 个片段` 那个 span 之后、`▲/▼` 之前加按钮（用 `e.stopPropagation()` 防止触发折叠）：

```jsx
          <button
            onClick={(e) => { e.stopPropagation(); onMergeWhole() }}
            style={{
              fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)',
            }}
          >
            用整组开一篇
          </button>
```

- [ ] **Step 7: 构建校验**

Run: `cd frontend && npm run build`
Expected: 构建成功（仅原有 chunk-size 警告）

- [ ] **Step 8: 提交**

```bash
git add frontend/src/pages/DraftVault.jsx
git commit -m "feat(vault): 单条续写带 hint + 多选合并续写 + 整主题开一篇"
```

---

### Task 5: 手动走查

- [ ] 后端重启（无 --reload）：杀 8000 端口进程，后台启动 uvicorn，轮询就绪。
- [ ] 单条续写：仓库点某片段「续写」→ 写作页见提示横幅 → 点「让 AI 接着写」→ 末尾追加一段，可继续编辑、可撤销。
- [ ] 多选合并：类别视图开「多选合并」→ 勾 3 段 → 浮条「合并续写」→ 写作页正文为 3 段空行分隔 + 横幅含各 hint。
- [ ] 整主题：主题视图点「用整组开一篇」→ 该主题片段合并进写作页。
- [ ] 上限：连勾超过 8 段，第 9 段勾不上，浮条显示「已达上限」。

---

## Self-Review 备注
- 覆盖 spec §2（统一 prefill）/§3（#1 横幅+接写+新端点）/§4（#2 多选+整主题+上限）/§5（清单，App.jsx 确认无需改）/§7（测试）。
- 类型一致：后端 `result` 键与前端 `res.data.result` 对齐；`onWrite` 全部传 `{text, hints}` 对象，`Write.jsx` 归一化兼容旧字符串路径。
- 无占位符；每步含完整代码。
