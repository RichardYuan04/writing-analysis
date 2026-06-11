# 风格 SOUL 文档 + 写作工具模型分级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给写作工具面板铺好地基——四个 AI 功能按难度分流模型，并落地「风格 SOUL 文档」（用户框定文章 → 量化锚点+原文摘录 → Sonnet 蒸馏 → 可手改 → 服务端注入）。

**Architecture:** 后端在现有单体 `backend/main.py` 内新增 `StyleProfile` 单行表、三个接口（GET/POST generate/PUT）、若干纯函数 helper，并改造 `_assist_call` 支持按功能传模型 + 从库里读 SOUL 注入。前端在画像页顶部新增 `SoulDocPanel`，配一个新的多选组件 `EssayMultiPicker`（不动现有单选 `EssayPicker`，避免回归）。

**Tech Stack:** 后端 FastAPI + SQLAlchemy(SQLite) + Anthropic SDK；测试 pytest + FastAPI `TestClient` + monkeypatch mock 掉 Anthropic。前端 React + Vite + axios。

**测试边界（已与用户确认）:** 后端走完整 TDD（pytest + TestClient + mock LLM，每任务先写失败测试）。前端 React 组件走**手动验证**——仓库当前无 JS 测试设施，新引入框架属独立工程，超出本功能范围。

---

## 文件结构

**后端（均在 `backend/` 下）**
- Modify `backend/main.py`：
  - DB URL 改为可由环境变量覆盖（测试隔离）。
  - 新增 `StyleProfile` 模型。
  - 新增纯函数 `_sample_excerpts()`、`_parse_soul_json()`、`_build_soul_prompt()`。
  - 新增接口 `GET /style-profile`、`POST /style-profile/generate`、`PUT /style-profile`。
  - 改造 `_assist_call()`：增 `model` 形参 + 调用前从库读 SOUL `content` 注入。
  - 四个 assist 接口传入各自模型。废弃 `AssistRequest.style_profile`。
- Create `backend/requirements.txt`：补齐运行期依赖（此前缺失）。
- Create `backend/requirements-dev.txt`：pytest + httpx。
- Create `backend/tests/__init__.py`（空）。
- Create `backend/tests/conftest.py`：临时 DB + mock anthropic 的 fixtures。
- Create `backend/tests/test_style_profile.py`：本功能全部后端测试。

**前端（均在 `frontend/src/` 下）**
- Modify `frontend/src/api.js`：新增 3 个 API 函数。
- Create `frontend/src/components/EssayMultiPicker.jsx`：多选文章组件。
- Create `frontend/src/components/SoulDocPanel.jsx`：SOUL 文档面板。
- Modify `frontend/src/pages/Portrait.jsx`：页面顶部挂载 `SoulDocPanel`。
- Modify `frontend/src/App.css`：面板样式（沿用现有变量）。

---

## Task 0: 后端测试环境（依赖 + 临时 DB 隔离 + mock fixtures）

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Modify: `backend/main.py:54`（DB engine 行）
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: 写运行期依赖清单**

Create `backend/requirements.txt`（`transformers`/`torch` 为可选——`main.py:25-36` 已 try/except 优雅降级，测试环境可不装）：

```
fastapi
uvicorn
sqlalchemy
anthropic
google-genai
python-dotenv
jieba
```

- [ ] **Step 2: 写开发依赖清单**

Create `backend/requirements-dev.txt`：

```
-r requirements.txt
pytest
httpx
```

- [ ] **Step 3: DB URL 改为可被环境变量覆盖（测试隔离）**

Modify `backend/main.py` 第 54 行：

```python
# 原：
engine = create_engine("sqlite:///./essays.db")
# 改为：
engine = create_engine(os.getenv("ESSAYS_DB_URL", "sqlite:///./essays.db"))
```

- [ ] **Step 4: 建测试包与 conftest**

Create `backend/tests/__init__.py`（空文件）。

Create `backend/tests/conftest.py`：

```python
import os
import tempfile
import pytest

# 在导入 main 之前，把 DB 指向临时文件，避免污染真实 essays.db
_tmp_db = os.path.join(tempfile.gettempdir(), "soul_test_essays.db")
if os.path.exists(_tmp_db):
    os.remove(_tmp_db)
os.environ["ESSAYS_DB_URL"] = f"sqlite:///{_tmp_db}"
# 给 anthropic client 一个占位 key，保证 import 期不报错（实际调用会被 mock）
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def db():
    """每个测试开始清空相关表，结束再清空，保证隔离。"""
    def _clear():
        s = main.Session()
        s.query(main.Essay).delete()
        try:
            s.query(main.StyleProfile).delete()
        except Exception:
            pass
        s.commit()
        s.close()
    _clear()
    yield main.Session
    _clear()


@pytest.fixture
def seed_essays(db):
    """插入 3 篇带 sentiment_score 的随笔，返回它们的 id。"""
    s = main.Session()
    ids = []
    samples = [
        ("雨", "窗外在下雨。我看着，没有说话。雨点敲在玻璃上，很轻。", 0.45),
        ("旧信", "翻出一封旧信。字迹淡了。那年的事，像隔着一层毛玻璃。", 0.50),
        ("夜路", "一个人走夜路。路灯把影子拉长。风很凉，心里却空落落的。", 0.40),
    ]
    for title, content, score in samples:
        e = main.Essay(title=title, content=content, date="2026-01-01",
                       word_count=len(content), sentiment_score=score)
        s.add(e); s.flush()
        ids.append(e.id)
    s.commit(); s.close()
    return ids


@pytest.fixture
def mock_anthropic(monkeypatch):
    """把 anthropic_client.messages.create 换成可编程的假对象。
    用法：mock_anthropic.set_text("返回内容")；断言用 mock_anthropic.captured["model"]。
    captured 始终是最近一次调用的 kwargs。"""
    class _Resp:
        def __init__(self, text):
            self.content = [type("B", (), {"text": text})()]
    state = {"text": "pong", "captured": {}}

    def capturing_create(*args, **kwargs):
        state["captured"].clear()
        state["captured"].update(kwargs)
        return _Resp(state["text"])

    monkeypatch.setattr(main.anthropic_client.messages, "create", capturing_create)

    class Ctl:
        @property
        def captured(self):
            return state["captured"]
        def set_text(self, t):
            state["text"] = t
    return Ctl()
```

- [ ] **Step 5: 建虚拟环境并装开发依赖**

Run（在 `backend/` 目录；Windows 用 `python -m venv venv` 后 `venv\Scripts\activate`，Mac 用 `source venv/bin/activate`）：

```bash
cd backend
python -m venv venv
# 激活 venv 后：
pip install -r requirements-dev.txt
```

Expected: 安装成功，`pytest --version` 可用。

> 注：本机若无 Python，此步需先装 Python 3.10+。`transformers`/`torch` 不装也能跑测试（import 期会打印一行 "[Emotion] 模型未加载" 警告，属预期）。

- [ ] **Step 6: 冒烟测试 —— 确认能 import main 并起 TestClient**

Create 临时测试内容追加到 `backend/tests/test_style_profile.py`（先建文件）：

```python
def test_app_boots(client):
    # /essays 是已有接口，能 200 即说明 app 正常起来了
    r = client.get("/essays")
    assert r.status_code == 200
```

Run: `cd backend && pytest tests/test_style_profile.py::test_app_boots -v`
Expected: PASS（若此处因缺依赖失败，先补 `requirements-dev.txt` 里的包）。

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/requirements-dev.txt backend/tests backend/main.py
git commit -m "test(write): 后端测试环境 + DB URL 可覆盖，铺 TDD 地基"
```

---

## Task 1: StyleProfile 数据模型

**Files:**
- Modify: `backend/main.py`（在 `Essay` 类后、`Base.metadata.create_all` 前后）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加到 `backend/tests/test_style_profile.py`：

```python
def test_style_profile_model_exists_and_empty(db):
    s = db()
    # 表存在且初始为空
    assert s.query(main.StyleProfile).count() == 0
    s.close()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py::test_style_profile_model_exists_and_empty -v`
Expected: FAIL（`AttributeError: module 'main' has no attribute 'StyleProfile'`）

- [ ] **Step 3: 实现模型**

在 `backend/main.py` 的 `Essay` 类定义之后、`Base.metadata.create_all(engine)` 之前，加入：

```python
class StyleProfile(Base):
    __tablename__ = "style_profile"
    id = Column(Integer, primary_key=True)      # 固定单行，id=1
    content = Column(Text)                       # 注入用的 SOUL 串（用户可改后的最终版）
    rationale = Column(Text)                     # JSON：分维度依据
    source_essay_ids = Column(Text)              # JSON 数组：本次养成用了哪几篇
    generated_at = Column(DateTime, default=datetime.now)
    user_edited = Column(Integer, default=0)     # 0/1
```

（`Base.metadata.create_all(engine)` 已存在于其后，会自动建表，无需改动。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py::test_style_profile_model_exists_and_empty -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): StyleProfile 单行表模型"
```

---

## Task 2: 摘录采样 helper `_sample_excerpts`（纯函数）

**Files:**
- Modify: `backend/main.py`（写作工具区块附近，§ 注释「写作工具面板」之上即可）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_sample_excerpts_preserves_text_and_caps_total():
    class E:
        def __init__(self, title, content):
            self.title = title; self.content = content
    essays = [
        E("甲", "第一句。\n第二句换行保留。"),
        E("乙", "另一篇内容。"),
    ]
    out = main._sample_excerpts(essays, per_essay_cap=400, total_cap=800)
    # 标题分隔 + 原文（含换行）都在
    assert "【甲】" in out and "【乙】" in out
    assert "第二句换行保留。" in out
    assert "\n" in out  # 节奏（换行）被保留


def test_sample_excerpts_truncates_long_essay():
    class E:
        def __init__(self, content): self.title = "x"; self.content = content
    long = "啊" * 1000
    out = main._sample_excerpts([E(long)], per_essay_cap=400, total_cap=800)
    # 单篇被截到 ~400 字（含省略号），不会整篇 1000 字塞进去
    assert out.count("啊") <= 401


def test_sample_excerpts_stops_at_total_cap():
    class E:
        def __init__(self, i): self.title = f"t{i}"; self.content = "字" * 300
    essays = [E(i) for i in range(10)]
    out = main._sample_excerpts(essays, per_essay_cap=400, total_cap=800)
    # 累计到 ~800 就停，不会把 10 篇全放进来
    assert out.count("字") <= 900
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k sample_excerpts -v`
Expected: FAIL（`module 'main' has no attribute '_sample_excerpts'`）

- [ ] **Step 3: 实现**

在 `backend/main.py` 写作工具区块上方加入：

```python
def _sample_excerpts(essays, per_essay_cap: int = 400, total_cap: int = 800) -> str:
    """从文章列表取未改写摘录，保留原始换行与标点（节奏不可压平）。
    每篇至多 per_essay_cap 字，累计到 total_cap 即停。"""
    parts = []
    total = 0
    for e in essays:
        if total >= total_cap:
            break
        content = (e.content or "").strip()
        if not content:
            continue
        snippet = content[:per_essay_cap]
        if len(content) > per_essay_cap:
            snippet += "…"
        title = (getattr(e, "title", "") or "").strip() or "无题"
        parts.append(f"【{title}】\n{snippet}")
        total += len(snippet)
    return "\n\n".join(parts)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k sample_excerpts -v`
Expected: PASS（3 个）

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): 摘录采样 helper，保留节奏、限总量"
```

---

## Task 3: SOUL 的 JSON 解析 helper `_parse_soul_json`（纯函数，容错）

**Files:**
- Modify: `backend/main.py`（紧接 `_sample_excerpts` 之后）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_parse_soul_json_plain():
    raw = '{"soul":"偏好短句，重意象。","rationale":{"rhythm":"短","imagery":"多","emotion":"克制","diction":"书面","signature":"留白"}}'
    out = main._parse_soul_json(raw)
    assert out["soul"].startswith("偏好短句")
    assert out["rationale"]["rhythm"] == "短"


def test_parse_soul_json_with_code_fence():
    raw = '```json\n{"soul":"x","rationale":{}}\n```'
    out = main._parse_soul_json(raw)
    assert out["soul"] == "x"
    assert out["rationale"] == {}


def test_parse_soul_json_with_surrounding_text():
    raw = '好的，分析如下：\n{"soul":"y","rationale":{"rhythm":"短"}}\n以上。'
    out = main._parse_soul_json(raw)
    assert out["soul"] == "y"


def test_parse_soul_json_fallback_on_garbage():
    raw = '这不是 JSON，只是一段风格描述：偏好短句。'
    out = main._parse_soul_json(raw)
    # 兜底：soul 用原文，rationale 为空 dict，不抛异常
    assert out["soul"] == raw.strip()
    assert out["rationale"] == {}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k parse_soul -v`
Expected: FAIL（`module 'main' has no attribute '_parse_soul_json'`）

- [ ] **Step 3: 实现**

紧接 `_sample_excerpts` 之后加入：

```python
def _parse_soul_json(raw: str) -> dict:
    """把模型返回解析成 {soul, rationale}。容错：去 ```fence、抓首个 {..} 块；
    彻底失败则把整段当 soul 兜底，绝不抛异常。"""
    text = (raw or "").strip()
    # 去掉 ```json ... ``` 围栏
    fence = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    # 抓第一个 { 到最后一个 } 的块
    start, end = text.find("{"), text.rfind("}")
    candidate = text[start:end + 1] if (start != -1 and end > start) else text
    try:
        data = json.loads(candidate)
        soul = (data.get("soul") or "").strip()
        rationale = data.get("rationale") or {}
        if not isinstance(rationale, dict):
            rationale = {}
        if soul:
            return {"soul": soul, "rationale": rationale}
    except Exception:
        pass
    return {"soul": (raw or "").strip(), "rationale": {}}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k parse_soul -v`
Expected: PASS（4 个）

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): SOUL JSON 容错解析 helper"
```

---

## Task 4: SOUL 生成接口 `POST /style-profile/generate`

**Files:**
- Modify: `backend/main.py`（写作工具区块之后；新增 prompt builder + 接口）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_generate_requires_essay_ids(client, db):
    r = client.post("/style-profile/generate", json={"essay_ids": []})
    assert r.status_code == 400


def test_generate_creates_single_row_and_uses_sonnet(client, seed_essays, mock_anthropic):
    mock_anthropic.set_text('{"soul":"偏好短句，善用感官意象，情绪克制。","rationale":{"rhythm":"短句为主","imagery":"感官意象","emotion":"克制","diction":"书面","signature":"留白"}}')
    r = client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    assert r.status_code == 200
    body = r.json()
    assert body["content"].startswith("偏好短句")
    assert body["rationale"]["rhythm"] == "短句为主"
    assert sorted(body["source_essay_ids"]) == sorted(seed_essays)
    # 用了 Sonnet
    assert mock_anthropic.captured.get("model") == "claude-sonnet-4-6"
    # 落库单行
    s = main.Session()
    assert s.query(main.StyleProfile).count() == 1
    row = s.query(main.StyleProfile).first()
    assert row.user_edited == 0
    s.close()


def test_generate_is_idempotent_single_row(client, seed_essays, mock_anthropic):
    mock_anthropic.set_text('{"soul":"第一版","rationale":{}}')
    client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    mock_anthropic.set_text('{"soul":"第二版","rationale":{}}')
    client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    s = main.Session()
    assert s.query(main.StyleProfile).count() == 1  # upsert，不新增第二行
    assert s.query(main.StyleProfile).first().content == "第二版"
    s.close()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k generate -v`
Expected: FAIL（404，接口未定义）

- [ ] **Step 3: 实现 prompt builder + 接口**

在 `backend/main.py` 写作工具区块之后加入（`StyleProfileGenerateRequest` 模型 + builder + 接口）：

```python
class StyleProfileGenerateRequest(BaseModel):
    essay_ids: list[int]


def _build_soul_prompt(portrait: dict, excerpts: str) -> str:
    return (
        "以下是某作者的写作风格量化数据与若干篇原文摘录。\n\n"
        "## 量化锚点（客观统计，供参考，勿照搬数字）\n"
        f"- 情感基调：{portrait.get('tone')}\n"
        f"- 句式偏好：{portrait.get('sentence_style')}（平均句长 {portrait.get('avg_sentence_length')} 字）\n"
        f"- 词汇丰富度：{portrait.get('vocab_richness')}（TTR={portrait.get('ttr')}）\n"
        f"- 标点习惯：{portrait.get('punct_style')}\n"
        f"- 段落风格：{portrait.get('para_style')}\n"
        f"- 篇幅偏好：{portrait.get('volume_style')}\n"
        f"- 灵魂词汇：{', '.join(portrait.get('soul_words', []))}\n\n"
        "## 原文摘录（保留了原始断句与节奏，请重点感受其节奏与意象）\n"
        f"{excerpts}\n\n"
        "请分两步：\n"
        "第一步（在心里分析，不要输出）：从五个维度刻画该作者的风格——\n"
        "  1) 句子节奏与长短  2) 意象/感官/比喻倾向  3) 情绪表达方式（克制/外放/叙事）\n"
        "  4) 用词（口语/书面/文学性）  5) 标志性手法（标点、留白、重复、转折等）\n"
        "第二步（输出）：把以上压缩成一段 100–200 字的密集风格指令，可直接注入用于指挥 AI 模仿该风格写作。\n\n"
        "以严格 JSON 输出，不要任何额外文字：\n"
        '{"soul":"……100-200字的风格指令……",'
        '"rationale":{"rhythm":"句子节奏一句话","imagery":"意象感官一句话",'
        '"emotion":"情绪表达一句话","diction":"用词一句话","signature":"标志性手法一句话"}}'
    )


SOUL_SYSTEM = (
    "你是一名法医语言学家 + 中文写作风格分析师，擅长从文本中识别作者独有的声音，"
    "并把它压缩成可直接用于指导写作的风格指令。只描述特征，不评价好坏，"
    "不使用「该作者/这位作者」等人称，直接描述风格本身。"
)


@app.post("/style-profile/generate")
def generate_style_profile(req: StyleProfileGenerateRequest):
    if not req.essay_ids:
        raise HTTPException(status_code=400, detail="请至少选择一篇文章")
    session = Session()
    essays = session.query(Essay).filter(Essay.id.in_(req.essay_ids)).order_by(Essay.date).all()
    if not essays:
        session.close()
        raise HTTPException(status_code=400, detail="选中的文章不存在")
    portrait = compute_portrait(essays)
    excerpts = _sample_excerpts(essays)
    try:
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            system=SOUL_SYSTEM,
            messages=[{"role": "user", "content": _build_soul_prompt(portrait, excerpts)}],
        )
        parsed = _parse_soul_json(message.content[0].text)
    except HTTPException:
        raise
    except Exception as e:
        session.close()
        print(f"[soul] generate error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")

    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        row = StyleProfile(id=1)
        session.add(row)
    row.content = parsed["soul"]
    row.rationale = json.dumps(parsed["rationale"], ensure_ascii=False)
    row.source_essay_ids = json.dumps([e.id for e in essays])
    row.generated_at = datetime.now()
    row.user_edited = 0
    session.commit()
    result = {
        "content": row.content,
        "rationale": parsed["rationale"],
        "source_essay_ids": [e.id for e in essays],
        "generated_at": row.generated_at.isoformat(),
        "user_edited": 0,
    }
    session.close()
    return result
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k generate -v`
Expected: PASS（3 个）

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): SOUL 生成接口（量化锚点+摘录→Sonnet→落库）"
```

---

## Task 5: 读取接口 `GET /style-profile`（含 new_essays_since）

**Files:**
- Modify: `backend/main.py`（generate 接口附近）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_get_style_profile_empty(client, db):
    r = client.get("/style-profile")
    assert r.status_code == 200
    assert r.json() == {"exists": False}


def test_get_style_profile_after_generate(client, seed_essays, mock_anthropic):
    mock_anthropic.set_text('{"soul":"偏好短句。","rationale":{"rhythm":"短"}}')
    client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    r = client.get("/style-profile")
    body = r.json()
    assert body["exists"] is True
    assert body["content"] == "偏好短句。"
    assert body["rationale"]["rhythm"] == "短"
    assert "generated_at" in body
    assert body["new_essays_since"] == 0  # 生成后没有更新的文章
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k "get_style_profile" -v`
Expected: FAIL（`{"exists": False}` 那条会 404，因为接口未定义）

- [ ] **Step 3: 实现**

在 generate 接口之后加入：

```python
@app.get("/style-profile")
def get_style_profile():
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        session.close()
        return {"exists": False}
    # 自上次养成后，更新过/新建过的文章数（按 created_at 粗略估计）
    new_count = 0
    if row.generated_at:
        new_count = session.query(Essay).filter(Essay.created_at > row.generated_at).count()
    try:
        rationale = json.loads(row.rationale) if row.rationale else {}
    except Exception:
        rationale = {}
    try:
        ids = json.loads(row.source_essay_ids) if row.source_essay_ids else []
    except Exception:
        ids = []
    result = {
        "exists": True,
        "content": row.content or "",
        "rationale": rationale,
        "source_essay_ids": ids,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
        "user_edited": int(row.user_edited or 0),
        "new_essays_since": new_count,
    }
    session.close()
    return result
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k "get_style_profile" -v`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): SOUL 读取接口 + 新增文章计数"
```

---

## Task 6: 保存接口 `PUT /style-profile`（手改）

**Files:**
- Modify: `backend/main.py`（generate/get 接口附近）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_put_style_profile_sets_user_edited(client, seed_essays, mock_anthropic):
    mock_anthropic.set_text('{"soul":"原始版","rationale":{}}')
    client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    r = client.put("/style-profile", json={"content": "我手改后的风格串"})
    assert r.status_code == 200
    assert r.json()["content"] == "我手改后的风格串"
    assert r.json()["user_edited"] == 1
    # source_essay_ids 不变
    assert sorted(r.json()["source_essay_ids"]) == sorted(seed_essays)


def test_put_style_profile_without_existing_creates_row(client, db):
    r = client.put("/style-profile", json={"content": "凭空写一版"})
    assert r.status_code == 200
    assert r.json()["content"] == "凭空写一版"
    assert r.json()["user_edited"] == 1
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k "put_style_profile" -v`
Expected: FAIL（404，接口未定义）

- [ ] **Step 3: 实现**

加入：

```python
class StyleProfileUpdateRequest(BaseModel):
    content: str


@app.put("/style-profile")
def update_style_profile(req: StyleProfileUpdateRequest):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        row = StyleProfile(id=1, source_essay_ids="[]", rationale="{}")
        session.add(row)
    row.content = (req.content or "").strip()
    row.user_edited = 1
    row.generated_at = datetime.now()
    session.commit()
    try:
        ids = json.loads(row.source_essay_ids) if row.source_essay_ids else []
    except Exception:
        ids = []
    try:
        rationale = json.loads(row.rationale) if row.rationale else {}
    except Exception:
        rationale = {}
    result = {
        "content": row.content,
        "rationale": rationale,
        "source_essay_ids": ids,
        "generated_at": row.generated_at.isoformat(),
        "user_edited": 1,
    }
    session.close()
    return result
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k "put_style_profile" -v`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): SOUL 保存接口（手改置 user_edited）"
```

---

## Task 7: 模型分级 + 服务端注入 SOUL（改造 `_assist_call` 与四个接口）

**Files:**
- Modify: `backend/main.py:524-588`（`_assist_call` 与四个 assist 接口）
- Test: `backend/tests/test_style_profile.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_assist_reduce_uses_haiku(client, mock_anthropic):
    mock_anthropic.set_text("压缩后的文字")
    r = client.post("/assist/reduce", json={"text": "一段需要压缩的较长的文字内容。"})
    assert r.status_code == 200
    assert mock_anthropic.captured["model"] == "claude-haiku-4-5-20251001"


def test_assist_metaphor_uses_opus(client, mock_anthropic):
    mock_anthropic.set_text("1. 像一根抽走的细线\n2. 像午后停电")
    r = client.post("/assist/metaphor", json={"text": "一种说不清的失落。"})
    assert r.status_code == 200
    assert mock_anthropic.captured["model"] == "claude-opus-4-8"


def test_assist_synonyms_and_expand_use_sonnet(client, mock_anthropic):
    mock_anthropic.set_text("候选")
    client.post("/assist/synonyms", json={"text": "怅然若失的感觉。"})
    assert mock_anthropic.captured["model"] == "claude-sonnet-4-6"
    client.post("/assist/expand", json={"text": "他走了。"})
    assert mock_anthropic.captured["model"] == "claude-sonnet-4-6"


def test_assist_injects_soul_when_present(client, seed_essays, mock_anthropic):
    # 先造一份 SOUL 文档
    mock_anthropic.set_text('{"soul":"偏好短句，情绪克制。","rationale":{}}')
    client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    # 再调 reduce，断言 system 注入了 SOUL 内容
    mock_anthropic.set_text("压缩结果")
    client.post("/assist/reduce", json={"text": "一段较长的需要压缩的文字。"})
    sys_prompt = mock_anthropic.captured["system"]
    assert "偏好短句，情绪克制。" in sys_prompt


def test_assist_degrades_without_soul(client, db, mock_anthropic):
    mock_anthropic.set_text("压缩结果")
    client.post("/assist/reduce", json={"text": "一段较长的需要压缩的文字。"})
    sys_prompt = mock_anthropic.captured["system"]
    # 走降级分支：不含「该作者的写作风格为」，含降级文案
    assert "该作者的写作风格为" not in sys_prompt
    assert "保持与原文及上下文一致" in sys_prompt
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pytest tests/test_style_profile.py -k "assist_" -v`
Expected: FAIL（模型断言失败——当前四个全是 haiku；注入断言失败——当前不读库）

- [ ] **Step 3: 实现改造**

3a. 新增「从库读 SOUL content」helper（放在 `_assist_system` 附近）：

```python
def _load_soul_content() -> str:
    session = Session()
    try:
        row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
        return (row.content or "").strip() if row else ""
    finally:
        session.close()
```

3b. 改造 `_assist_call`（`backend/main.py:524`）签名与内部：

```python
def _assist_call(data: AssistRequest, user: str, max_tokens: int, parse_options: bool, model: str):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="选中文字不能为空")
    try:
        message = anthropic_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=_assist_system(_load_soul_content()),
            messages=[{"role": "user", "content": user}],
        )
        raw = message.content[0].text.strip()
        if parse_options:
            return {"options": _parse_options(raw)}
        return {"result": raw.strip('「」""\'').strip()}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[assist] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")
```

（注意：`_assist_system` 入参从原来的 `data.style_profile` 改为 `_load_soul_content()`；`AssistRequest.style_profile` 字段保留也无妨，但不再被使用。）

3c. 四个接口分别传 `model`（`backend/main.py:551-588`）：

```python
@app.post("/assist/reduce")
def assist_reduce(data: AssistRequest):
    user = (
        "请将以下文字压缩至原来约一半的长度。\n"
        "要求：保留核心意思和情感，删去冗余表达，保持作者的句式风格，直接输出压缩后的文字。\n\n"
        f"原文：{data.text.strip()}"
    )
    return _assist_call(data, user, max_tokens=512, parse_options=False, model="claude-haiku-4-5-20251001")


@app.post("/assist/synonyms")
def assist_synonyms(data: AssistRequest):
    user = (
        "请为以下文字提供 3 个同义或近义的替代表达。\n"
        "要求：保持原意，贴合上下文语境，风格与作者一致，每个选项单独一行，不要额外解释。\n\n"
        f"选中文字：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=300, parse_options=True, model="claude-sonnet-4-6")


@app.post("/assist/metaphor")
def assist_metaphor(data: AssistRequest):
    user = (
        "请为以下文字提供 2-3 个比喻表达，帮助将其意象化或更有画面感。\n"
        "要求：比喻贴合上下文语境，避免陈词滥调，风格与作者一致，每个选项单独一行，不要额外解释。\n\n"
        f"选中文字：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=400, parse_options=True, model="claude-opus-4-8")


@app.post("/assist/expand")
def assist_expand(data: AssistRequest):
    user = (
        "请将以下文字扩展至约 2 倍长度。\n"
        "要求：补充细节、感受或场景描写，自然融入原文语境，保持作者风格，直接输出扩展后的文字。\n\n"
        f"原文：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=700, parse_options=False, model="claude-sonnet-4-6")
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pytest tests/test_style_profile.py -k "assist_" -v`
Expected: PASS（5 个）

- [ ] **Step 5: 跑全量后端测试**

Run: `cd backend && pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_style_profile.py
git commit -m "feat(write): 写作工具模型分级 + 服务端注入 SOUL 文档"
```

---

## Task 8: 前端 API 函数

**Files:**
- Modify: `frontend/src/api.js`（assist 函数之后）

- [ ] **Step 1: 新增三个 API 函数**

在 `frontend/src/api.js` 第 21 行 `getPortrait` 之后加入：

```javascript
export const getStyleProfile = () => api.get('/style-profile')
export const generateStyleProfile = (essayIds) => api.post('/style-profile/generate', { essay_ids: essayIds })
export const saveStyleProfile = (content) => api.put('/style-profile', { content })
```

- [ ] **Step 2: 手动验证（语法/构建）**

Run: `cd frontend && npm run build`
Expected: 构建无报错（说明 import/语法 OK）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(write): 前端 SOUL 文档 API 函数"
```

---

## Task 9: 多选文章组件 `EssayMultiPicker`

**Files:**
- Create: `frontend/src/components/EssayMultiPicker.jsx`

> 不改现有 `EssayPicker`（单选，供单篇深度解读用），新建多选组件，复用其搜索/分页视觉。

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/EssayMultiPicker.jsx`：

```jsx
import { useState, useEffect, useMemo } from 'react'
import { listEssays } from '../api'

const PAGE_SIZE = 6

/**
 * 多选文章组件。
 * props:
 *  - selectedIds: number[]              当前选中的文章 id
 *  - onChange(ids: number[])            选择变化回调
 */
export default function EssayMultiPicker({ selectedIds, onChange }) {
  const [allEssays, setAllEssays] = useState([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => { listEssays().then(r => setAllEssays(r.data)) }, [])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return allEssays
    return allEssays.filter(e => (e.title || '').includes(q) || (e.content || '').includes(q))
  }, [allEssays, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selected = new Set(selectedIds)

  const toggle = (id) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange([...next])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(0) }}
          placeholder="搜索标题或正文…"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #e0d5c5',
                   borderRadius: 8, background: '#faf8f5', fontSize: 12, color: '#5a4a3a', outline: 'none' }}
        />
        <span style={{ fontSize: 12, color: '#8B6F47', marginLeft: 10, whiteSpace: 'nowrap' }}>
          已选 {selectedIds.length} 篇
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {paged.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: '#bbb' }}>没有匹配的随笔</div>
        )}
        {paged.map(e => {
          const on = selected.has(e.id)
          return (
            <div key={e.id} onClick={() => toggle(e.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                       border: `1px solid ${on ? '#8B6F47' : '#ede6da'}`, borderRadius: 8, cursor: 'pointer',
                       background: on ? '#f5ede0' : '#faf8f5', transition: 'all 0.15s' }}>
              <span style={{ width: 16, flexShrink: 0, color: on ? '#8B6F47' : '#ccc' }}>{on ? '☑' : '☐'}</span>
              <span style={{ fontSize: 11, color: '#bbb', width: 76, flexShrink: 0 }}>{e.date}</span>
              <span style={{ fontSize: 13, flex: 1, color: on ? '#8B6F47' : '#5a4a3a',
                             fontWeight: on ? 'bold' : 'normal', overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
              <span style={{ fontSize: 10, color: '#ccc' }}>{e.word_count}字</span>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ width: 28, height: 28, border: '1px solid #ede6da', borderRadius: 6,
                     background: page === 0 ? '#faf8f5' : 'white', color: page === 0 ? '#ccc' : '#8B6F47',
                     cursor: page === 0 ? 'default' : 'pointer' }}>&lt;</button>
          <span style={{ fontSize: 11, color: '#aaa' }}>第 {page + 1} / {totalPages} 页 · 共 {filtered.length} 篇</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
            style={{ width: 28, height: 28, border: '1px solid #ede6da', borderRadius: 6,
                     background: page === totalPages - 1 ? '#faf8f5' : 'white',
                     color: page === totalPages - 1 ? '#ccc' : '#8B6F47',
                     cursor: page === totalPages - 1 ? 'default' : 'pointer' }}>&gt;</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 手动验证（构建）**

Run: `cd frontend && npm run build`
Expected: 构建无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EssayMultiPicker.jsx
git commit -m "feat(write): 多选文章组件 EssayMultiPicker"
```

---

## Task 10: SOUL 文档面板 `SoulDocPanel`

**Files:**
- Create: `frontend/src/components/SoulDocPanel.jsx`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/SoulDocPanel.jsx`：

```jsx
import { useState, useEffect } from 'react'
import { getStyleProfile, generateStyleProfile, saveStyleProfile } from '../api'
import EssayMultiPicker from './EssayMultiPicker'

const RATIONALE_LABELS = {
  rhythm: '句子节奏', imagery: '意象感官', emotion: '情绪表达',
  diction: '用词', signature: '标志性手法',
}

export default function SoulDocPanel() {
  const [profile, setProfile] = useState(null)     // {exists, content, rationale, ...}
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)     // 是否在选篇态
  const [selectedIds, setSelectedIds] = useState([])
  const [draft, setDraft] = useState('')            // 可编辑文本
  const [busy, setBusy] = useState('')              // '' | 'generating' | 'saving'
  const [showRationale, setShowRationale] = useState(false)
  const [savedTip, setSavedTip] = useState(false)

  useEffect(() => {
    getStyleProfile().then(r => {
      setProfile(r.data)
      if (r.data.exists) { setDraft(r.data.content || ''); setSelectedIds(r.data.source_essay_ids || []) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const generate = async () => {
    if (selectedIds.length === 0) return
    setBusy('generating')
    try {
      const r = await generateStyleProfile(selectedIds)
      setProfile({ exists: true, ...r.data, new_essays_since: 0 })
      setDraft(r.data.content || '')
      setPicking(false)
    } catch { /* 保留旧文档，不破坏 */ }
    setBusy('')
  }

  const save = async () => {
    setBusy('saving')
    try {
      const r = await saveStyleProfile(draft)
      setProfile(p => ({ ...p, exists: true, ...r.data }))
      setSavedTip(true); setTimeout(() => setSavedTip(false), 1600)
    } catch { /* ignore */ }
    setBusy('')
  }

  if (loading) return null

  const has = profile?.exists
  const dirty = has && draft !== (profile.content || '')

  return (
    <div className="section soul-panel">
      <h2>✦ 风格 SOUL 文档</h2>
      <p className="section-desc">
        这是 AI 对你写作风格的概括，会用来指导写作工具，让它写得更像你。由你框定哪几篇文章来养成。
      </p>

      {/* 重养提示 */}
      {has && !picking && profile.new_essays_since >= 5 && (
        <div className="soul-nudge" onClick={() => setPicking(true)}>
          你又写了 {profile.new_essays_since} 篇，要不要纳入重养？
        </div>
      )}

      {/* 选篇态 */}
      {picking || !has ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <EssayMultiPicker selectedIds={selectedIds} onChange={setSelectedIds} />
          {selectedIds.length > 0 && selectedIds.length < 3 && (
            <div className="soul-hint">建议多选几篇（≥3），养出的风格更准。</div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="soul-btn-primary" disabled={selectedIds.length === 0 || busy === 'generating'} onClick={generate}>
              {busy === 'generating' ? '正在养成…（几秒）' : '✦ 养成 SOUL 文档'}
            </button>
            {has && <button className="soul-btn-ghost" onClick={() => setPicking(false)}>取消</button>}
          </div>
        </div>
      ) : (
        /* 已有态 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea className="soul-textarea" value={draft} onChange={e => setDraft(e.target.value)}
            rows={5} placeholder="（SOUL 文档内容）" />
          <div className="soul-meta">
            基于 {profile.source_essay_ids?.length || 0} 篇
            {profile.generated_at && ` · 上次养成 ${profile.generated_at.slice(0, 10)}`}
            {profile.user_edited ? ' · 已手改' : ''}
          </div>

          {/* 分维度依据（折叠） */}
          {profile.rationale && Object.keys(profile.rationale).length > 0 && (
            <div>
              <button className="soul-link" onClick={() => setShowRationale(v => !v)}>
                {showRationale ? '收起依据 ▴' : '查看分维度依据 ▾'}
              </button>
              {showRationale && (
                <div className="soul-rationale">
                  {Object.entries(RATIONALE_LABELS).map(([k, label]) =>
                    profile.rationale[k] ? (
                      <div key={k} className="soul-rationale-row">
                        <span className="soul-rationale-k">{label}</span>
                        <span className="soul-rationale-v">{profile.rationale[k]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="soul-btn-primary" disabled={!dirty || busy === 'saving'} onClick={save}>
              {busy === 'saving' ? '保存中…' : '保存'}
            </button>
            <button className="soul-btn-ghost" onClick={() => setPicking(true)}>重新选篇养成</button>
            {savedTip && <span className="soul-saved">已保存 ✓</span>}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 手动验证（构建）**

Run: `cd frontend && npm run build`
Expected: 构建无报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SoulDocPanel.jsx
git commit -m "feat(write): SOUL 文档面板组件"
```

---

## Task 11: 画像页挂载面板 + 样式

**Files:**
- Modify: `frontend/src/pages/Portrait.jsx`（顶部）
- Modify: `frontend/src/App.css`（追加样式）

- [ ] **Step 1: 画像页顶部挂载面板**

Modify `frontend/src/pages/Portrait.jsx`：

import 区加入（第 4 行 `EssayPicker` import 附近）：

```jsx
import SoulDocPanel from '../components/SoulDocPanel'
```

在 `return (` 内、`<h1 className="portrait-title">` 之后、雷达图 `{/* 雷达图 */}` section 之前插入：

```jsx
      <SoulDocPanel />
```

- [ ] **Step 2: 追加样式**

在 `frontend/src/App.css` 末尾追加：

```css
/* 风格 SOUL 文档面板 */
.soul-panel .soul-textarea {
  width: 100%; box-sizing: border-box; padding: 12px 14px;
  border: 1px solid #e0d5c5; border-radius: 8px; background: #faf8f5;
  font-size: 14px; line-height: 1.8; color: #5a4a3a; resize: vertical; outline: none;
  font-family: inherit;
}
.soul-meta { font-size: 12px; color: #aaa; }
.soul-hint, .soul-nudge { font-size: 12px; }
.soul-nudge {
  padding: 8px 12px; background: #fff7ec; border: 1px solid #f0d9b5;
  border-radius: 8px; color: #8B6F47; cursor: pointer;
}
.soul-hint { color: #c08a4a; }
.soul-btn-primary {
  padding: 10px 18px; border: none; border-radius: 8px; cursor: pointer;
  background: #8B6F47; color: #fff; font-size: 14px;
}
.soul-btn-primary:disabled { background: #d4c4b0; cursor: default; }
.soul-btn-ghost {
  padding: 10px 14px; border: 1px solid #e0d5c5; border-radius: 8px;
  background: #fff; color: #8B6F47; font-size: 13px; cursor: pointer;
}
.soul-link { border: none; background: none; color: #8B6F47; font-size: 12px; cursor: pointer; padding: 0; }
.soul-saved { font-size: 12px; color: #6a9a4a; }
.soul-rationale { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.soul-rationale-row { display: flex; gap: 10px; font-size: 13px; }
.soul-rationale-k { width: 64px; flex-shrink: 0; color: #a89070; }
.soul-rationale-v { color: #5a4a3a; }
```

- [ ] **Step 3: 手动验证（构建）**

Run: `cd frontend && npm run build`
Expected: 构建无报错。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Portrait.jsx frontend/src/App.css
git commit -m "feat(write): 画像页挂载 SOUL 文档面板 + 样式"
```

---

## Task 12: 端到端手动验证（真实跑一遍）

**Files:** 无（纯验证）

- [ ] **Step 1: 起后端**

Run（backend 目录，venv 已激活，`.env` 含真实 key）：

```bash
cd backend && uvicorn main:app --reload --port 8000
```

Expected: 启动成功，无 traceback。

- [ ] **Step 2: 起前端 dev**

Run（另一个终端）：

```bash
cd frontend && npm run dev
```

打开 `http://localhost:5173`，进「画像」页。

- [ ] **Step 3: 走 SOUL 文档全流程**

逐项确认：
- 顶部出现「✦ 风格 SOUL 文档」面板，空态显示选篇器。
- 勾选 3–5 篇 → 点「养成 SOUL 文档」→ 几秒后出现可编辑文本（100–200 字、描述节奏/意象/情绪/用词/手法、无「该作者」人称）。
- 改两个字 → 「保存」按钮亮起 → 保存成功提示。
- 「查看分维度依据」能展开五行。
- 刷新页面，SOUL 文档仍在（已落库），显示「基于 N 篇 · 上次养成 日期」。

- [ ] **Step 4: 验证注入生效**

到「写作」页，选一段文字 → 用「扩展」或「比喻」。对比保存 SOUL 文档前后，输出在风格上应有可感差异（更贴合你的声音）。

- [ ] **Step 5: 验证无回归**

回画像页「单篇深度解读」，确认 `EssayPicker`（单选）仍正常工作、能分析单篇。

- [ ] **Step 6: 全量后端测试再跑一次**

Run: `cd backend && pytest tests/ -v`
Expected: 全部 PASS。

---

## 完成标准

- 后端全部 pytest PASS。
- 画像页能养成 / 手改 / 保存 SOUL 文档并持久化。
- 四个写作工具按 Haiku/Sonnet/Opus/Sonnet 分流，且在有 SOUL 文档时服务端注入、无则降级。
- 单篇深度解读（单选）无回归。
