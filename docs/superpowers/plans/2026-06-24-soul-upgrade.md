# SOUL 升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 SOUL 风格档案加：频率钉程度、可编辑的通用散文「禁止项」、自动抽取的「黄金样例」few-shot；并把禁止项+样例随 SOUL 注入缩减/同义/扩展。

**Architecture:** `StyleProfile`（单行 id=1）新增 `golden_samples`(JSON) 和 `taboo`(可编辑禁止项) 两列。生成时用本地真频率指令 + 抽 2–3 段黄金样例；禁止项为写死默认值 `DEFAULT_TABOO`、用户可编辑、与样本无关（不由模型反推）。注入端 `_assist_system` 拼上禁止项与样例。

**Tech Stack:** Python/FastAPI/SQLAlchemy/SQLite（后端，pytest）；React+Vite（前端，手动验证）。

**Spec:** `docs/superpowers/specs/2026-06-24-soul-upgrade-design.md`

---

## File Structure
- `backend/main.py`：migrate 两列；`StyleProfile` 两列；`DEFAULT_TABOO`；`_golden_samples`；`_load_soul_bundle`；改 `_build_soul_prompt`/`generate_style_profile`/`get_style_profile`/`StyleProfileUpdateRequest`/`update_style_profile`/`_assist_system`/`_assist_call`。
- `backend/tests/test_soul_upgrade.py`：新建。
- `frontend/src/api.js`、`frontend/src/components/SoulDocPanel.jsx`、`frontend/src/App.css`。

---

## Task 1: 后端 — 列/迁移 + DEFAULT_TABOO + bundle + get/put 支持 taboo

**Files:** Modify `backend/main.py`；Create `backend/tests/test_soul_upgrade.py`

- [ ] **Step 1: 失败测试**

新建 `backend/tests/test_soul_upgrade.py`：

```python
import main


def _seed_profile(content="克制短句。", taboo=None, golden=None):
    s = main.Session()
    s.query(main.StyleProfile).delete()
    row = main.StyleProfile(id=1, content=content, rationale="{}", source_essay_ids="[]",
                            taboo=taboo, golden_samples=golden)
    s.add(row); s.commit(); s.close()


def test_get_taboo_falls_back_to_default(client, db):
    _seed_profile(taboo=None)
    g = client.get("/style-profile").json()
    assert g["taboo"] == main.DEFAULT_TABOO
    assert "值得注意的是" in g["taboo"]


def test_put_taboo_persists_and_keeps_content(client, db):
    _seed_profile(content="原正文")
    r = client.put("/style-profile", json={"taboo": "禁止用 ZZZ 套话"})
    assert r.status_code == 200
    g = client.get("/style-profile").json()
    assert g["taboo"] == "禁止用 ZZZ 套话"
    assert g["content"] == "原正文"   # 只传 taboo 不动 content


def test_put_content_only_keeps_taboo(client, db):
    _seed_profile()
    client.put("/style-profile", json={"taboo": "我的禁令"})
    client.put("/style-profile", json={"content": "新正文"})
    g = client.get("/style-profile").json()
    assert g["content"] == "新正文"
    assert g["taboo"] == "我的禁令"   # 只传 content 不动 taboo


def test_get_returns_golden_samples(client, db):
    import json
    _seed_profile(golden=json.dumps(["片段一", "片段二"], ensure_ascii=False))
    g = client.get("/style-profile").json()
    assert g["golden_samples"] == ["片段一", "片段二"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -v`
Expected: FAIL（`StyleProfile` 无 taboo/golden_samples、`DEFAULT_TABOO` 未定义、GET 无这些字段）

- [ ] **Step 3: 迁移 + 模型列**

`migrate_db()` 内，drafts 的 `letters` ALTER 那个 try/except 块之后，追加：

```python
        # style_profile 表补列（SOUL 升级：黄金样例 + 可编辑禁止项）
        for col in ("golden_samples", "taboo"):
            try:
                conn.execute(text(f"ALTER TABLE style_profile ADD COLUMN {col} TEXT"))
                conn.commit()
            except Exception:
                pass
```

`StyleProfile` 模型，`user_edited` 列之后加：

```python
    golden_samples = Column(Text)   # JSON 数组：养成时抽的 2–3 段黄金样例原文
    taboo = Column(Text)            # 可编辑禁止项；空则回落 DEFAULT_TABOO
```

- [ ] **Step 4: DEFAULT_TABOO + _load_soul_bundle**

在 `_load_soul_content` 定义之前（模块级，`json`/`Session`/`StyleProfile` 已可用）加：

```python
DEFAULT_TABOO = (
    "请规避以下「AI 腔」写法：\n"
    "- 套话与软化词：值得注意的是 / 综上所述·总而言之 / 某种程度上·可能地 / 此外 / 「不是 X，而是 Y」「不仅…而是…」。\n"
    "- 拔高与升华：「标志着…关键时刻」「象征着…」「反映了更广泛的趋势」；别用动名词堆抽象深刻。\n"
    "- 空泛/促销词：至关重要、格局（抽象用）、展现、充满活力、令人叹为观止、迷人的。\n"
    "- 句法节律：别三项排比成瘾（改两项或四项）；别连续等长句；破折号别当节奏拐杖。\n"
    "- 对读者：别解释自己的比喻；别过度软化（「可能会产生影响」→「影响了」）；别绕开「是/有」。\n"
    "- 结构：别每段都用整齐总结收尾；别强行在结尾升华或喊口号。"
)


def _load_soul_bundle() -> dict:
    """读 SOUL 正文 + 禁止项 + 黄金样例。禁止项为空回落 DEFAULT_TABOO。"""
    session = Session()
    try:
        row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
        if not row:
            return {"content": "", "taboo": DEFAULT_TABOO, "samples": []}
        try:
            samples = json.loads(row.golden_samples) if row.golden_samples else []
        except Exception:
            samples = []
        return {
            "content": (row.content or "").strip(),
            "taboo": (row.taboo or "").strip() or DEFAULT_TABOO,
            "samples": samples if isinstance(samples, list) else [],
        }
    finally:
        session.close()
```

- [ ] **Step 5: get_style_profile 返回新字段**

`get_style_profile` 的 `result` 字典里，`"user_edited": ...,` 之后加：

```python
        "golden_samples": (lambda: (__import__("json").loads(row.golden_samples) if row.golden_samples else []))(),
        "taboo": (row.taboo or "").strip() or DEFAULT_TABOO,
```

（注：`json` 已在文件顶部导入，直接用 `json.loads(row.golden_samples) if row.golden_samples else []` 即可；为避免 lambda，按下面写法替换——在 `result = {` 之前先算好：）

实际请这样写：在 `get_style_profile` 里、构造 `result` 之前加：

```python
    try:
        golden = json.loads(row.golden_samples) if row.golden_samples else []
    except Exception:
        golden = []
```

并在 `result` 字典 `"user_edited": ...,` 之后加：

```python
        "golden_samples": golden if isinstance(golden, list) else [],
        "taboo": (row.taboo or "").strip() or DEFAULT_TABOO,
```

- [ ] **Step 6: PUT 支持部分更新 taboo/content**

`StyleProfileUpdateRequest` 改为：

```python
class StyleProfileUpdateRequest(BaseModel):
    content: str | None = None
    taboo: str | None = None
```

`update_style_profile` 改为（保留原有 row 创建/序列化逻辑，仅改写入与返回）：

```python
@app.put("/style-profile")
def update_style_profile(req: StyleProfileUpdateRequest):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        row = StyleProfile(id=1, source_essay_ids="[]", rationale="{}")
        session.add(row)
    if req.content is not None:
        row.content = (req.content or "").strip()
        row.user_edited = 1
        row.generated_at = datetime.now()
    if req.taboo is not None:
        row.taboo = req.taboo
    session.commit()
    try:
        golden = json.loads(row.golden_samples) if row.golden_samples else []
    except Exception:
        golden = []
    result = {
        "content": row.content or "",
        "taboo": (row.taboo or "").strip() or DEFAULT_TABOO,
        "golden_samples": golden if isinstance(golden, list) else [],
        "user_edited": int(row.user_edited or 0),
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
    }
    session.close()
    return result
```

- [ ] **Step 7: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -v`
Expected: 4 passed

- [ ] **Step 8: 提交**

```bash
git add backend/main.py backend/tests/test_soul_upgrade.py
git commit -m "feat(soul): StyleProfile 加 taboo/golden_samples 列，get/put 支持可编辑禁止项"
```

---

## Task 2: 后端 — 养成时频率指令 + 抽黄金样例

**Files:** Modify `backend/main.py`；Test: `backend/tests/test_soul_upgrade.py`（追加）

- [ ] **Step 1: 追加失败测试**

```python
def test_generate_stores_golden_samples_not_taboo(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n克制、短句、少抒情。\n【节奏】短\n【意象】具体\n【情绪】克制\n【用词】口语\n【手法】留白")
    r = client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    assert r.status_code == 200
    assert len(r.json()["golden_samples"]) >= 1            # 抽到了样例
    g = client.get("/style-profile").json()
    assert len(g["golden_samples"]) >= 1
    assert g["taboo"] == main.DEFAULT_TABOO                 # 养成不写 taboo
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -k generate -v`
Expected: FAIL（`golden_samples` 不在响应里）

- [ ] **Step 3: _golden_samples 抽取 + 频率指令 + 生成写入**

在 `_sample_excerpts` 定义之后加：

```python
def _golden_samples(essays, n: int = 3, cap: int = 200) -> list:
    """抽 n 段代表性原文（每篇取第一段，保留断句），每段 ≤cap 字。"""
    out = []
    for e in essays:
        if len(out) >= n:
            break
        content = (e.content or "").strip()
        if not content:
            continue
        para = next((p.strip() for p in re.split(r"\n\s*\n|\n", content) if p.strip()), "")
        if not para:
            continue
        out.append(para[:cap] + "…" if len(para) > cap else para)
    return out
```

`_build_soul_prompt`：在 `"第二步（输出）：…"` 那行之后、`"请严格按以下格式…"` 之前，插入一句频率约束：

```python
        "凡涉及频率/程度（句长、标点、用词偏好），一律依据上面给出的统计数字来表述"
        "（如『平均句长 X 字，多用短句』『标点偏简』），不要凭印象自行估计或夸大某个特征。\n\n"
```

`generate_style_profile`：在 `row.user_edited = 0` 之后、`session.commit()` 之前，加：

```python
    row.golden_samples = json.dumps(_golden_samples(essays), ensure_ascii=False)
```

并在该函数 `result` 字典里 `"user_edited": 0,` 之后加：

```python
        "golden_samples": _parse_or_empty(row.golden_samples),
```

其中 `_parse_or_empty` 为就近小助手（放在 `_golden_samples` 之后）：

```python
def _parse_or_empty(raw) -> list:
    try:
        v = json.loads(raw) if raw else []
        return v if isinstance(v, list) else []
    except Exception:
        return []
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_soul_upgrade.py
git commit -m "feat(soul): 养成用真频率钉程度 + 自动抽 2-3 段黄金样例"
```

---

## Task 3: 后端 — 注入端拼接禁止项 + 黄金样例

**Files:** Modify `backend/main.py`；Test: `backend/tests/test_soul_upgrade.py`（追加）

- [ ] **Step 1: 追加失败测试**

```python
import json as _json


def test_assist_reduce_injects_taboo_and_samples(client, db, mock_anthropic):
    s = main.Session(); s.query(main.StyleProfile).delete()
    s.add(main.StyleProfile(id=1, content="克制短句", rationale="{}", source_essay_ids="[]",
                            taboo="禁止用 ZZZ", golden_samples=_json.dumps(["样例片段ABC"], ensure_ascii=False)))
    s.commit(); s.close()
    mock_anthropic.set_text("缩短后的文字")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    sysp = mock_anthropic.captured["system"]
    assert "克制短句" in sysp        # SOUL 正文
    assert "ZZZ" in sysp             # 用户禁止项
    assert "样例片段ABC" in sysp     # 黄金样例


def test_assist_reduce_no_profile_still_has_default_taboo(client, db, mock_anthropic):
    s = main.Session(); s.query(main.StyleProfile).delete(); s.commit(); s.close()
    mock_anthropic.set_text("x")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    assert "值得注意的是" in mock_anthropic.captured["system"]   # 降级也带 DEFAULT_TABOO
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -k "inject or default_taboo" -v`
Expected: FAIL（system 里没有 taboo/样例）

- [ ] **Step 3: 改 _assist_system 接 bundle，_assist_call 改用 bundle**

`_assist_system` 整体替换为（签名由 str 改为 dict）：

```python
def _assist_system(bundle: dict) -> str:
    content = (bundle.get("content") or "").strip()
    taboo = (bundle.get("taboo") or DEFAULT_TABOO).strip()
    samples = bundle.get("samples") or []
    if content:
        style_line = (f"该作者的写作风格为：{content}。"
                      "所有建议必须与该风格保持一致，不要改变作者的声音和语气。")
    else:
        style_line = "保持与原文及上下文一致的语气和风格，不要改变作者的声音。"
    parts = [f"你是写作助手。{style_line}", taboo]
    if samples:
        parts.append("参考该作者的原文片段，学其语感、不要照抄内容：\n" + "\n---\n".join(samples))
    parts.append("直接输出建议内容，不要解释、不要加前缀。")
    return "\n".join(parts)
```

`_assist_call` 里把：

```python
    sys_prompt = system if system is not None else _assist_system(_load_soul_content())
```

改为：

```python
    sys_prompt = system if system is not None else _assist_system(_load_soul_bundle())
```

（`_load_soul_content` 保留不删，已无调用方，无害。）

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_soul_upgrade.py -v` 然后全量 `venv/Scripts/python.exe -m pytest`
Expected: 新测试与全量均 PASS（比喻/找引文显式传 system，不受影响；读者视角不走 _assist_system）

- [ ] **Step 5: 提交**

```bash
git add backend/main.py backend/tests/test_soul_upgrade.py
git commit -m "feat(soul): 缩减/同义/扩展注入端拼接禁止项 + 黄金样例 few-shot"
```

---

## Task 4: 前端 api.js — saveStyleProfile 接受对象

**Files:** Modify `frontend/src/api.js`

- [ ] **Step 1: 改签名**

把：

```javascript
export const saveStyleProfile = (content) => api.put('/style-profile', { content })
```

改为：

```javascript
export const saveStyleProfile = (data) => api.put('/style-profile', data)
```

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`（注意：此时 SoulDocPanel 仍调 `saveStyleProfile(draft)` 传字符串，会变成 `PUT {0:'克',1:'制'...}`——下一任务即修；本步只确认无语法错误）
Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api.js
git commit -m "feat(api): saveStyleProfile 改为接受 {content?, taboo?} 对象"
```

---

## Task 5: 前端 SoulDocPanel — 禁止项可编辑 + 黄金样例展示

**Files:** Modify `frontend/src/components/SoulDocPanel.jsx`、`frontend/src/App.css`

- [ ] **Step 1: 状态与初始化**

`SoulDocPanel` 里 `const [draft, setDraft] = useState('')` 之后加：

```javascript
  const [tabooDraft, setTabooDraft] = useState('')
```

`useEffect` 里 `if (r.data.exists) { ... }` 块内、`setSelectedIds(...)` 之后加（并把 taboo 始终载入，即便 exists 为 false 也给默认值）：

```javascript
      setTabooDraft(r.data.taboo || '')
```

并把 `generate` 成功后的 `setDraft(r.data.content || '')` 之后加：

```javascript
      setTabooDraft(r.data.taboo || tabooDraft)
```

- [ ] **Step 2: 改 save 用对象；加 saveTaboo**

把 `save` 函数里的 `await saveStyleProfile(draft)` 改为 `await saveStyleProfile({ content: draft })`。

在 `save` 函数之后加一个保存禁止项的函数：

```javascript
  const saveTaboo = async () => {
    setBusy('saving')
    try {
      const r = await saveStyleProfile({ taboo: tabooDraft })
      setProfile(p => ({ ...p, ...r.data }))
      setSavedTip(true); setTimeout(() => setSavedTip(false), 1600)
    } catch { /* ignore */ }
    setBusy('')
  }
```

- [ ] **Step 3: 渲染禁止项编辑 + 黄金样例**

在「已有态」分支里，`保存 / 重新选篇养成` 那个 `<div style={{ display: 'flex', gap: 10, ... }}>` 之后（即该分支最外层 div 闭合 `</div>` 之前）插入：

```javascript
          <div className="soul-sub">
            <div className="soul-sub-h">禁止项（去 AI 腔，对所有写作工具生效，可改）</div>
            <textarea className="soul-textarea" value={tabooDraft} onChange={e => setTabooDraft(e.target.value)} rows={7} />
            <button className="soul-btn-primary" disabled={busy === 'saving' || tabooDraft === (profile.taboo || '')} onClick={saveTaboo}>
              {busy === 'saving' ? '保存中…' : '保存禁止项'}
            </button>
          </div>

          {profile.golden_samples && profile.golden_samples.length > 0 && (
            <div className="soul-sub">
              <div className="soul-sub-h">黄金样例（养成时抽的原文，注入工具当语感参照）</div>
              <div className="soul-samples">
                {profile.golden_samples.map((s, i) => <blockquote key={i} className="soul-sample">{s}</blockquote>)}
              </div>
            </div>
          )}
```

- [ ] **Step 4: 样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* SOUL 面板：禁止项 / 黄金样例 子区 */
.soul-sub { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-soft); display: flex; flex-direction: column; gap: 8px; }
.soul-sub-h { font-size: 12px; color: var(--text-hint); }
.soul-samples { display: flex; flex-direction: column; gap: 8px; }
.soul-sample { margin: 0; padding: 8px 12px; border-left: 2px solid var(--accent-light); background: var(--panel2); border-radius: 0 8px 8px 0; font-family: var(--font-serif); font-size: 13px; line-height: 1.8; color: var(--text-secondary); white-space: pre-wrap; }
```

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/SoulDocPanel.jsx frontend/src/App.css
git commit -m "feat(soul): 画像页可编辑禁止项 + 展示黄金样例"
```

---

## Task 6: 端到端验证 + 标记 spec 已实现

**Files:** 无（验证）

- [ ] **Step 1: 后端全套**

Run: `cd backend && venv/Scripts/python.exe -m pytest`
Expected: 全绿（含新增 soul 测试）

- [ ] **Step 2: 前端构建** — `cd frontend && npm run build` 成功。

- [ ] **Step 3: 真机走查（需重启后端加载迁移/新代码）**
- 画像页养成 SOUL → 看到黄金样例区出现 2–3 段原文；禁止项区显示默认黑名单。
- 改禁止项 → 保存 → 刷新仍在。
- 写作页选一段 → 缩减/扩展 → 结果更贴风格、不冒套话（可对比改禁止项前后）。

- [ ] **Step 4: 标记 spec**

把 `docs/superpowers/specs/2026-06-24-soul-upgrade-design.md` 头部 `**状态**: 待实现` 改为 `**状态**: 已实现`，提交：

```bash
git add docs/superpowers/specs/2026-06-24-soul-upgrade-design.md
git commit -m "docs: SOUL 升级实现完成，标记 spec 已实现"
```

---

## Self-Review 备注
- **Spec 覆盖**：列/迁移(§2)→T1；DEFAULT_TABOO(§3)→T1；频率指令+黄金样例(§4.1)→T2；get/put taboo(§4.2)→T1；注入(§4.3)→T3；前端(§5)→T4/T5。
- **不做作者专属反推**：禁止项是写死的 `DEFAULT_TABOO`，养成流程（T2）只写 `golden_samples`、明确不写 `taboo`——与 spec 非目标一致。
- **类型一致**：`_assist_system` 由 str 改 dict，唯一调用方 `_assist_call` 同步改为传 `_load_soul_bundle()`；`saveStyleProfile` 由字符串改对象，调用方 SoulDocPanel 在 T5 同步改 `{content}`/`{taboo}`。
- **注意**：T4 提交后到 T5 完成前，SoulDocPanel 的保存会暂时坏（传了字符串）——T4/T5 应连续执行，别在中间放行测试。
