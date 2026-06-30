# 风格 SOUL 多槽 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 executing-plans。步骤用 `- [ ]` 追踪。

**Goal:** 把单行 SOUL（`StyleProfile id=1`）升级为最多 3 个风格槽 + 一个全局 `SoulSettings`（默认指针 + 共用禁止项），默认槽喂给所有写作工具。

**Architecture:** `StyleProfile` 变多行（加 `name`，弃用 `taboo` 列）；新增 `SoulSettings` 单行表。注入函数 `_load_soul_bundle()` 读 active 槽 + 共用 taboo。替换单数 `/style-profile` 为复数端点集。前端 `SoulDocPanel` 重做为风格卡 + 全局禁止项。

**Tech Stack:** FastAPI 单文件 + pytest（Windows: `cd backend && venv/Scripts/python.exe -m pytest`）；React/Vite（`cd frontend && npm run build`）。

**Spec:** `docs/superpowers/specs/2026-06-30-soul-multi-slot-design.md`（已批准）。

**已确认决策**：自定义命名（空→「风格 N」）· 禁止项三槽共用 · 按需新建≤3 · 允许删到 0 · 重养覆盖保名。

---

### Task 1: 数据模型 + 迁移 + settings helper

**Files:** Modify `backend/main.py`

- [ ] **Step 1: 加 `name` 列与 `SoulSettings` 模型**

`StyleProfile` 加列（main.py:124 `taboo` 行后）：
```python
    name = Column(Text)             # 用户自定义风格名；空→前端显示「风格 N」
```
紧接 `StyleProfile` 类后新增模型：
```python
class SoulSettings(Base):
    __tablename__ = "soul_settings"
    id = Column(Integer, primary_key=True)   # 固定单行 id=1
    active_profile_id = Column(Integer)      # 当前默认槽 id；无槽为 NULL
    taboo = Column(Text)                      # 三槽共用禁止项；空回落 DEFAULT_TABOO
```
（定义在 `Base.metadata.create_all(engine)`（:138）之前，新库自动建表。）

- [ ] **Step 2: 迁移函数**

在 `migrate_vault_db()` 定义之后、其调用 `migrate_vault_db()`（:1722）之后追加：
```python
def migrate_soul_slots():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE style_profile ADD COLUMN name TEXT"))
            conn.commit()
        except Exception:
            pass
    Base.metadata.create_all(engine)   # 确保 soul_settings 表存在（老库）
    session = Session()
    try:
        s = session.query(SoulSettings).filter(SoulSettings.id == 1).first()
        if not s:
            existing = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
            session.add(SoulSettings(
                id=1,
                active_profile_id=existing.id if existing else None,
                taboo=((existing.taboo or "").strip() if existing else ""),
            ))
            session.commit()
    finally:
        session.close()

migrate_soul_slots()
```

- [ ] **Step 3: settings helper（懒建单行，测试清表后兜底）**

在 `_load_soul_bundle` 附近加：
```python
def _get_soul_settings(session):
    s = session.query(SoulSettings).filter(SoulSettings.id == 1).first()
    if not s:
        s = SoulSettings(id=1, active_profile_id=None, taboo="")
        session.add(s); session.commit()
    return s
```

- [ ] **Step 4: 冒烟**

Run: `cd backend && venv/Scripts/python.exe -c "import main; print('ok')"`
Expected: 打印 ok（迁移不报错）。

---

### Task 2: 注入读 active 槽 + 删死代码

**Files:** Modify `backend/main.py`；Test `backend/tests/test_soul_upgrade.py`

- [ ] **Step 1: 写测试（先失败）**

在 `test_soul_upgrade.py` 加（先用到的多槽 seed helper 见 Task 5，这里临时直接造数据）：
```python
def test_bundle_reads_active_slot_and_shared_taboo(client, db):
    s = main.Session()
    s.query(main.SoulSettings).delete()
    p = main.StyleProfile(name="甲", content="甲风格", rationale="{}", source_essay_ids="[]",
                          golden_samples='["样例甲"]')
    s.add(p); s.flush()
    s.add(main.SoulSettings(id=1, active_profile_id=p.id, taboo="共用禁令ZZZ"))
    s.commit(); s.close()
    b = main._load_soul_bundle()
    assert b["content"] == "甲风格" and b["samples"] == ["样例甲"]
    assert b["taboo"] == "共用禁令ZZZ"


def test_bundle_defaults_when_no_active(client, db):
    s = main.Session(); s.query(main.SoulSettings).delete()
    s.add(main.SoulSettings(id=1, active_profile_id=None, taboo="")); s.commit(); s.close()
    b = main._load_soul_bundle()
    assert b["content"] == "" and b["samples"] == []
    assert b["taboo"] == main.DEFAULT_TABOO          # 空共用→回落
```

Run: `... -m pytest tests/test_soul_upgrade.py -k bundle -v` → FAIL（旧 bundle 读 id=1）。

- [ ] **Step 2: 改 `_load_soul_bundle`，删 `_load_soul_content`**

替换 `_load_soul_bundle()` 函数体为：
```python
def _load_soul_bundle() -> dict:
    """读「默认槽」的 content+黄金样例 + 共用禁止项。无默认槽则降级。"""
    session = Session()
    try:
        s = _get_soul_settings(session)
        taboo = (s.taboo or "").strip() or DEFAULT_TABOO
        row = None
        if s.active_profile_id is not None:
            row = session.query(StyleProfile).filter(StyleProfile.id == s.active_profile_id).first()
        if not row:
            return {"content": "", "taboo": taboo, "samples": []}
        return {"content": (row.content or "").strip(), "taboo": taboo,
                "samples": _parse_or_empty(row.golden_samples)}
    finally:
        session.close()
```
删除整个 `_load_soul_content()`（main.py:803 起，死代码，无调用点）。

Run: `... -k bundle -v` → PASS。

---

### Task 3: 序列化 + 养成 helper

**Files:** Modify `backend/main.py`

- [ ] **Step 1: 加序列化与生成 helper**（无独立测试，由 Task 4 端点测试覆盖）

```python
def _profile_dict(row, session) -> dict:
    new_count = 0
    if row.generated_at:
        new_count = session.query(Essay).filter(Essay.created_at > row.generated_at).count()
    try:
        rationale = json.loads(row.rationale) if row.rationale else {}
    except Exception:
        rationale = {}
    return {
        "id": row.id, "name": row.name, "content": row.content or "",
        "rationale": rationale,
        "source_essay_ids": _parse_or_empty(row.source_essay_ids),
        "golden_samples": _parse_or_empty(row.golden_samples),
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
        "user_edited": int(row.user_edited or 0),
        "new_essays_since": new_count,
    }


def _run_soul_generation(essay_ids):
    """跑模型 → (parsed, essays)；失败抛 HTTPException。"""
    if not essay_ids:
        raise HTTPException(status_code=400, detail="请至少选择一篇文章")
    session = Session()
    essays = session.query(Essay).filter(Essay.id.in_(essay_ids)).order_by(Essay.date).all()
    if not essays:
        session.close(); raise HTTPException(status_code=400, detail="选中的文章不存在")
    portrait = compute_portrait(essays); excerpts = _sample_excerpts(essays)
    session.close()
    try:
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-6", max_tokens=800, system=SOUL_SYSTEM,
            messages=[{"role": "user", "content": _build_soul_prompt(portrait, excerpts)}])
        parsed = _parse_soul_output(message.content[0].text)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[soul] generate error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")
    return parsed, essays


def _apply_generation(row, parsed, essays):
    row.content = parsed["soul"]
    row.rationale = json.dumps(parsed["rationale"], ensure_ascii=False)
    row.source_essay_ids = json.dumps([e.id for e in essays])
    row.generated_at = datetime.now()
    row.user_edited = 0
    row.golden_samples = json.dumps(_golden_samples(essays), ensure_ascii=False)
```

---

### Task 4: 端点（替换单数 `/style-profile`）

**Files:** Modify `backend/main.py`；Test `backend/tests/test_soul_multi.py`（新建）

- [ ] **Step 1: 写端点测试（新文件，先失败）**——见 Task 5 的完整 `test_soul_multi.py`，含：list/新建自动激活/满3报400/重养覆盖保名/PUT 名字与内容/激活切换/删除回退/删到0/共用 taboo 端点。先建文件跑 → FAIL（端点不存在）。

- [ ] **Step 2: 删旧端点 + 写新端点**

删除 `generate_style_profile`（POST `/style-profile/generate`，:1163-1199 那段直到 result 返回）、`get_style_profile`（GET `/style-profile`）、`update_style_profile`（PUT `/style-profile`）、旧 `StyleProfileUpdateRequest`。保留 `StyleProfileGenerateRequest`、`_build_soul_prompt`、`SOUL_SYSTEM`。新增：
```python
class StyleProfileUpdateRequest(BaseModel):
    name: str | None = None
    content: str | None = None
    golden_samples: list[str] | None = None


class SoulSettingsUpdateRequest(BaseModel):
    taboo: str | None = None


@app.get("/style-profiles")
def list_style_profiles():
    session = Session()
    s = _get_soul_settings(session)
    rows = session.query(StyleProfile).order_by(StyleProfile.id).all()
    out = {"active_id": s.active_profile_id,
           "taboo": (s.taboo or "").strip() or DEFAULT_TABOO,
           "profiles": [_profile_dict(r, session) for r in rows]}
    session.close(); return out


@app.post("/style-profiles/generate")
def create_style_profile(req: StyleProfileGenerateRequest):
    session = Session(); count = session.query(StyleProfile).count(); session.close()
    if count >= 3:
        raise HTTPException(status_code=400, detail="最多 3 个风格")
    parsed, essays = _run_soul_generation(req.essay_ids)
    session = Session()
    row = StyleProfile(); _apply_generation(row, parsed, essays)
    session.add(row); session.flush()
    s = _get_soul_settings(session)
    if s.active_profile_id is None:        # 从 0 槽建出第一个→自动设默认
        s.active_profile_id = row.id
    session.commit()
    out = _profile_dict(row, session); session.close(); return out


@app.post("/style-profiles/{pid}/generate")
def regenerate_style_profile(pid: int, req: StyleProfileGenerateRequest):
    session = Session(); exists = session.query(StyleProfile).filter(StyleProfile.id == pid).first(); session.close()
    if not exists:
        raise HTTPException(status_code=404, detail="风格不存在")
    parsed, essays = _run_soul_generation(req.essay_ids)
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == pid).first()
    if not row:
        session.close(); raise HTTPException(status_code=404, detail="风格不存在")
    _apply_generation(row, parsed, essays)   # name 不动
    session.commit()
    out = _profile_dict(row, session); session.close(); return out


@app.put("/style-profiles/{pid}")
def update_one_style_profile(pid: int, req: StyleProfileUpdateRequest):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == pid).first()
    if not row:
        session.close(); raise HTTPException(status_code=404, detail="风格不存在")
    if req.name is not None:
        row.name = (req.name or "").strip() or None
    if req.content is not None:
        row.content = (req.content or "").strip(); row.user_edited = 1; row.generated_at = datetime.now()
    if req.golden_samples is not None:
        cleaned = [x.strip()[:200] for x in req.golden_samples if x and x.strip()]
        row.golden_samples = json.dumps(cleaned, ensure_ascii=False)
    session.commit()
    out = _profile_dict(row, session); session.close(); return out


@app.post("/style-profiles/{pid}/activate")
def activate_style_profile(pid: int):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == pid).first()
    if not row:
        session.close(); raise HTTPException(status_code=404, detail="风格不存在")
    s = _get_soul_settings(session); s.active_profile_id = pid; session.commit()
    session.close(); return {"active_id": pid}


@app.delete("/style-profiles/{pid}")
def delete_style_profile(pid: int):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == pid).first()
    if not row:
        session.close(); raise HTTPException(status_code=404, detail="风格不存在")
    session.delete(row); session.flush()
    s = _get_soul_settings(session)
    if s.active_profile_id == pid:                    # 删的是默认→回退到剩余最小 id（无则 NULL）
        nxt = session.query(StyleProfile).order_by(StyleProfile.id).first()
        s.active_profile_id = nxt.id if nxt else None
    session.commit(); active = s.active_profile_id
    session.close(); return {"active_id": active}


@app.put("/soul-settings")
def update_soul_settings(req: SoulSettingsUpdateRequest):
    session = Session(); s = _get_soul_settings(session)
    if req.taboo is not None:
        s.taboo = req.taboo
    session.commit(); taboo = (s.taboo or "").strip() or DEFAULT_TABOO
    session.close(); return {"taboo": taboo}
```

- [ ] **Step 3: 跑端点测试** → PASS。

---

### Task 5: conftest + 测试重写

**Files:** Modify `backend/tests/conftest.py`、`backend/tests/test_soul_upgrade.py`；Create `backend/tests/test_soul_multi.py`

- [ ] **Step 1: conftest `db` 清表加 SoulSettings**

在 `db` fixture 的 `_clear()` 里，`StyleProfile` 删除之后加：
```python
        try:
            s.query(main.SoulSettings).delete()
        except Exception:
            pass
```

- [ ] **Step 2: 重写 `test_soul_upgrade.py` 里依赖单数端点的用例**

`_seed_profile` 改为建一槽 + 设 active + 写共用 taboo：
```python
def _seed_profile(content="克制短句。", taboo=None, golden=None, name=None):
    s = main.Session()
    s.query(main.StyleProfile).delete(); s.query(main.SoulSettings).delete()
    row = main.StyleProfile(name=name, content=content, rationale="{}",
                            source_essay_ids="[]", golden_samples=golden)
    s.add(row); s.flush()
    s.add(main.SoulSettings(id=1, active_profile_id=row.id, taboo=(taboo or "")))
    s.commit(); pid = row.id; s.close(); return pid
```
逐条改：
- `test_get_taboo_falls_back_to_default` → `client.get("/style-profiles").json()["taboo"] == DEFAULT_TABOO`（seed taboo=None→空）。
- `test_get_returns_golden_samples` → seed golden，断言 `GET /style-profiles` 的 `profiles[0]["golden_samples"]`。
- `test_get_golden_samples_bad_json_falls_back` → 同上断言为 `[]`。
- `test_put_golden_samples_cleans_blanks_and_caps_200` → `pid=_seed_profile(); PUT /style-profiles/{pid} {golden_samples:[...]}`，断言返回 `golden_samples`。
- `test_put_golden_samples_keeps_content_and_taboo` → PUT 槽不动 content；taboo 现独立（共用），断言 `GET /style-profiles` taboo 不变。
- `test_load_soul_bundle_defaults`（若存在）→ 用 Task 2 的两个 bundle 测试替代/保留。
- `test_generate_stores_golden_samples_not_taboo` → `POST /style-profiles/generate`，断言 `golden_samples` 非空、`new_essays_since`/`user_edited` 字段在；taboo 不被养成写（仍 DEFAULT_TABOO）。
- `test_assist_reduce_injects_taboo_and_samples` → 用新 `_seed_profile(content=..,taboo="禁止用 ZZZ",golden=..)`（建 active 槽 + 共用 taboo），其余断言不变。
原 `test_put_taboo_persists_and_keeps_content` / `test_put_content_only_keeps_taboo` 拆为：禁止项走 `PUT /soul-settings`，内容走 `PUT /style-profiles/{id}`。

- [ ] **Step 3: 新建 `test_soul_multi.py`**

覆盖多槽语义（用 `mock_anthropic` 让养成可跑）：
```python
import main

SOUL_OUT = "【SOUL】\n克制短句。\n【节奏】短\n【意象】具体\n【情绪】克制\n【用词】口语\n【手法】留白"

def _gen(client, ids):
    return client.post("/style-profiles/generate", json={"essay_ids": ids})

def test_first_generate_auto_activates(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    r = _gen(client, seed_essays).json()
    g = client.get("/style-profiles").json()
    assert g["active_id"] == r["id"] and len(g["profiles"]) == 1

def test_max_three_slots(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    for _ in range(3):
        assert _gen(client, seed_essays).status_code == 200
    assert _gen(client, seed_essays).status_code == 400          # 第 4 个被拒

def test_activate_switches_bundle(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n风格甲。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    a = _gen(client, seed_essays).json()
    mock_anthropic.set_text("【SOUL】\n风格乙。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    b = _gen(client, seed_essays).json()
    client.post(f"/style-profiles/{b['id']}/activate")
    assert "风格乙" in main._load_soul_bundle()["content"]
    client.post(f"/style-profiles/{a['id']}/activate")
    assert "风格甲" in main._load_soul_bundle()["content"]

def test_regenerate_overwrites_keeps_name(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    client.put(f"/style-profiles/{a['id']}", json={"name": "日常随笔"})
    mock_anthropic.set_text("【SOUL】\n新风格。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    r = client.post(f"/style-profiles/{a['id']}/generate", json={"essay_ids": seed_essays}).json()
    assert r["name"] == "日常随笔" and "新风格" in r["content"]

def test_delete_active_reassigns(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json(); b = _gen(client, seed_essays).json()
    client.post(f"/style-profiles/{b['id']}/activate")
    r = client.delete(f"/style-profiles/{b['id']}").json()
    assert r["active_id"] == a["id"]

def test_delete_to_zero_keeps_shared_taboo(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    client.put("/soul-settings", json={"taboo": "共用禁令保留ZZZ"})
    client.delete(f"/style-profiles/{a['id']}")
    g = client.get("/style-profiles").json()
    assert g["active_id"] is None and g["profiles"] == []
    b = main._load_soul_bundle()
    assert b["content"] == "" and b["taboo"].startswith("共用禁令保留")

def test_name_empty_becomes_null(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    r = client.put(f"/style-profiles/{a['id']}", json={"name": "  "}).json()
    assert r["name"] is None
```

- [ ] **Step 4: 全量后端测试**

Run: `cd backend && venv/Scripts/python.exe -m pytest -q`
Expected: 全绿。

- [ ] **Step 5: 提交后端**

```bash
git add backend/main.py backend/tests/
git commit -m "feat(soul): 多风格槽（≤3）+ 默认切换 + 共用禁止项（后端）"
```

---

### Task 6: 前端 api.js

**Files:** Modify `frontend/src/api.js`

- [ ] **Step 1: 替换 SOUL 三函数为多槽集**

删 `getStyleProfile/generateStyleProfile/saveStyleProfile`，换为：
```javascript
export const listStyleProfiles = () => api.get('/style-profiles')
export const generateStyleProfile = (essayIds) => api.post('/style-profiles/generate', { essay_ids: essayIds })
export const regenerateStyleProfile = (id, essayIds) => api.post(`/style-profiles/${id}/generate`, { essay_ids: essayIds })
export const updateStyleProfile = (id, data) => api.put(`/style-profiles/${id}`, data)
export const activateStyleProfile = (id) => api.post(`/style-profiles/${id}/activate`)
export const deleteStyleProfile = (id) => api.delete(`/style-profiles/${id}`)
export const saveSoulSettings = (data) => api.put('/soul-settings', data)
```

---

### Task 7: 前端 SoulDocPanel 重做

**Files:** Modify `frontend/src/components/SoulDocPanel.jsx`、`frontend/src/App.css`

- [ ] **Step 1: 状态与数据**

`SoulDocPanel` 状态改为：`profiles[]`、`activeId`、`taboo`/`tabooDraft`、`selectedSlotId`（当前编辑槽）、`picking`（选篇态，新建或重养）、`pickTargetId`（重养目标，null=新建）、`busy`、各 draft（name/content/samples）。
初始：`listStyleProfiles()` → 填充。

- [ ] **Step 2: 顶部风格卡 + 新建**

渲染 `profiles.map`，每卡：显示名 `p.name || \`风格 ${i+1}\``、`基于 N 篇 · 日期`、`activeId===p.id` 显示「默认 ✓」否则「设为默认」(`activateStyleProfile` → reload)；点卡选中编辑。未满 3 显示「+ 新建风格」→ `picking=true, pickTargetId=null`。

- [ ] **Step 3: 选篇态**

复用 `EssayMultiPicker`；确认按 `pickTargetId`：null→`generateStyleProfile`，否则→`regenerateStyleProfile(pickTargetId,...)`；完成 reload。

- [ ] **Step 4: 当前编辑槽展开**

名字输入（失焦/按钮 `updateStyleProfile(id,{name})`）、content textarea（保存 `updateStyleProfile(id,{content})`）、黄金样例编辑器（沿用现有逐条 textarea，保存 `updateStyleProfile(id,{golden_samples})`）、`重新选篇养成`(=picking+pickTargetId=id)、`删除该风格`(`deleteStyleProfile` → reload；若删的是选中槽则清空选中)。

- [ ] **Step 5: 全局禁止项（共用，单独一块）**

`tabooDraft` textarea + 「保存禁止项」→ `saveSoulSettings({taboo})`。0 槽时此块仍渲染。

- [ ] **Step 6: 样式**

复用现有 `.soul-*`；新增 `.soul-slots`（卡片横排/换行）、`.soul-slot`（含 `.is-active` 高亮 + 「默认」徽标）样式，加入 `App.css`。

- [ ] **Step 7: 构建**

Run: `cd frontend && npm run build` → 成功（仅原 chunk 警告）。

- [ ] **Step 8: 提交前端**

```bash
git add frontend/src/api.js frontend/src/components/SoulDocPanel.jsx frontend/src/App.css
git commit -m "feat(soul): 风格 SOUL 多槽 UI（风格卡+默认切换+全局禁止项）"
```

---

### Task 8: 重启后端 + 走查

- [ ] 杀 8000、后台起 uvicorn、轮询就绪。
- [ ] 走查：新建 2-3 个风格（不同选篇）→ 卡片出现；设默认切换 → 写作页工具用对应风格；改名/留空回落「风格 N」；重养覆盖保名；删到 0 → 空态但禁止项仍在、写作工具降级仍带 DEFAULT_TABOO 或共用禁止项。

---

## Self-Review 备注
- 覆盖 spec §2–§7。删到 0 / 重养保名 / 满3报400 / 删active回退 / 名字空回落 均有端点测试。
- 类型一致：`active_id`、`profiles[].golden_samples`/`name`、`/soul-settings` 的 `taboo` 前后端对齐。
- `db` fixture 清 `SoulSettings`，端点/`_load_soul_bundle` 经 `_get_soul_settings` 懒建兜底。
- 无占位符；核心后端代码完整给出，前端为契约级（实现时按现有 SoulDocPanel 风格补全）。
