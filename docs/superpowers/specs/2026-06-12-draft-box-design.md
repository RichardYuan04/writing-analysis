# Design: 草稿箱 + 清空按钮

**日期**: 2026-06-12
**状态**: 待实现
**范围**: 写作页新增「草稿箱」（多份持久草稿）+「清空」按钮。

---

## 1. 背景与目标

### 现状

写作页（`frontend/src/pages/Write.jsx`）目前：
- **自动保存**：把当前正在写的内容（单份）节流写入 localStorage（`DRAFT_KEY = 'wt_write_draft'`），进页面时自动恢复。只有一份，无感、自动。
- **「保存」按钮**：调 `createEssay`，存成**正式文章**（进总览、出心绪卡、参与情感/画像分析），并清掉那份 localStorage 草稿。
- **半成品仓库**：从已保存的正式文章里提取片段聚类，与草稿无关。

缺口：用户无法**主动保留多份未完成稿**、回来继续写。

### 目标

1. **草稿箱**：用户可**显式**把当前内容「存入草稿箱」，保留多份草稿；随时点开任一份加载回编辑器继续写；可删除。草稿写完后点「保存」发布成正式文章，并自动移出草稿箱。
2. **清空按钮**：一键清空当前编辑器内容（带确认），重置为空白新稿。

---

## 2. 功能范围

### 包含
- 新数据表 `drafts` + 4 个后端接口（POST/GET/PUT/DELETE）。
- 写作页右侧新增 `DraftPanel`（在现有「写作工具」AssistPanel 下方竖向堆叠，独立可折叠）。
- 写作页编辑器底部新增「清空」按钮。
- 写作页编辑态新增 `draftId` 跟踪：存入=新建或更新同一份；发布后若在编辑某草稿则删除之。

### 不包含
- 草稿的自动云同步 / 多设备（当前单用户单机）。
- 草稿版本历史。
- 把现有 localStorage 自动保存改造成多份（它继续当"当前编辑器安全网"，与草稿箱并存）。

---

## 3. 数据模型

新增表（SQLAlchemy，与 `Essay`/`StyleProfile` 同库；参照 `main.py` 现有模型写法）：

```python
class Draft(Base):
    __tablename__ = "drafts"
    id = Column(Integer, primary_key=True)
    title = Column(String(200))
    content = Column(Text)
    date = Column(String(10))                       # YYYY-MM-DD（用户设定的写作日期）
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now)
```

`Base.metadata.create_all(engine)` 已存在，会自动建表。

---

## 4. 后端接口

请求/响应均为 JSON。草稿数据量小（单用户），列表直接返回完整内容，省一次取详情。

### 4.1 `POST /drafts`
请求 `{title, content, date}`。新建一行，`created_at=updated_at=now`。返回完整草稿（含 id）。
- 校验：`content` 去空白后非空，否则 400「草稿内容不能为空」。`title` 可空（列表展示时回退「无题」）。

### 4.2 `GET /drafts`
返回全部草稿，按 `updated_at` 倒序。每条含 `id/title/content/date/created_at/updated_at`。

### 4.3 `PUT /drafts/{id}`
请求 `{title, content, date}`。更新该草稿，`updated_at=now`。404 若不存在。返回更新后的完整草稿。

### 4.4 `DELETE /drafts/{id}`
删除该草稿。404 若不存在。返回 `{ok: true}`。（不存在时也可幂等返回 ok，但本设计取 404 与现有 `delete_essay` 风格一致。）

---

## 5. 前端

### 5.1 API 函数（`frontend/src/api.js`）
```javascript
export const listDrafts = () => api.get('/drafts')
export const createDraft = (data) => api.post('/drafts', data)
export const updateDraft = (id, data) => api.put(`/drafts/${id}`, data)
export const deleteDraft = (id) => api.delete(`/drafts/${id}`)
```

### 5.2 新组件 `DraftPanel.jsx`
右侧第二个面板，结构对齐现有 `AssistPanel`（可折叠、同视觉语言 `.assist-panel` 类似的 `.draft-panel`）。

props：
- `current: {title, content, date}` — 当前编辑器内容（用于「存入草稿箱」）。
- `draftId: number|null` — 当前正在编辑的草稿 id。
- `onSaved(draft)` — 存入成功回调（父组件据此设 `draftId`）。
- `onOpen(draft)` — 点开某草稿，父组件据此把内容载入编辑器并设 `draftId`。
- `collapsed, onToggle` — 折叠状态。

行为：
- 顶部「＋ 存入草稿箱」按钮：`current.content` 为空则禁用；点击 → 有 `draftId` 调 `updateDraft`，否则 `createDraft` → 成功后 `onSaved(draft)`，并刷新列表、给「已存入 ✓」反馈。
- 列表：拉 `listDrafts()`，每条显示标题（空回退「无题」）/日期/摘要（content 前 ~40 字）/上次修改；点条目 → `onOpen(draft)`；每条有 🗑 删除（`deleteDraft` 后刷新；若删的是当前 `draftId`，通知父组件清空 `draftId`）。
- 存入/删除后都刷新列表。

### 5.3 写作页改动（`Write.jsx`）
- 新增状态 `const [draftId, setDraftId] = useState(null)`。
- **载入草稿**（`onOpen`）：`setTitle/setContent/setDate` 用草稿值，`setDraftId(draft.id)`，并把 mood 等重置回编辑态。
- **存入草稿箱**：由 `DraftPanel` 完成调用；父组件在 `onSaved(draft)` 里 `setDraftId(draft.id)`。
- **保存（发布）**：`handleSave` 成功 `createEssay` 后，若 `draftId` 非空 → 调 `deleteDraft(draftId)` 把它移出草稿箱，再 `setDraftId(null)`。
- **清空按钮**：放编辑器底部（`保存` 旁）。点击 → `window.confirm('清空当前内容？此操作不影响已存入草稿箱的草稿。')` → 确认则 `setTitle('')`、`setContent('')`、`setDate(today)`、`setDraftId(null)`、`setSel(null)`、清 `undoStack`，并 `localStorage.removeItem(DRAFT_KEY)`。
- **右侧布局**：`AssistPanel` 与 `DraftPanel` 竖向堆叠在右列（`write-layout` 右侧容器改为 flex column）。各自独立折叠。

### 5.4 样式（`App.css`）
`.draft-panel` 复用 `.assist-panel` 的卡片视觉；列表项、删除按钮、存入按钮沿用现有色板（`--accent` 等）。右列容器 `display:flex; flex-direction:column; gap`。

---

## 6. 边界行为（已与用户确认）

| 动作 | 行为 |
|---|---|
| 存入草稿箱 | 显式持久化；有 `draftId` 则**更新同一份**，无则**新建**并记下 `draftId` |
| 保存（发布成文章） | 不变（`createEssay`）；若当前在编辑某草稿，发布成功后**从草稿箱删除该草稿** |
| 清空 | 带确认；**只重置当前编辑器**（含 localStorage 自动保存），不碰草稿箱里已存的草稿 |
| 自动保存 | 不变；localStorage 单份，当前编辑器安全网，与草稿箱并存 |

---

## 7. 决策记录（已与用户确认）

1. 草稿与正式文章 = **中转站模型（A）**：草稿写完发布成文章并移出草稿箱。
2. 存草稿 = **显式按钮**「存入草稿箱」，不自动。
3. 存储 = **后端 DB**（持久可靠）。
4. 入口 = **写作页右侧第二个面板**（不进顶层导航、不做二级 tab）。
5. 重存同一份草稿 = 更新而非新建（靠 `draftId`）。

---

## 8. 测试要点
- **后端（TDD）**：POST 建草稿（含空内容 400）；GET 列表按 updated_at 倒序；PUT 更新且 404 不存在；DELETE 删除且 404 不存在。
- **前端（构建 + 手动）**：存入草稿箱（新建/更新同一份）；列表点开载入编辑器；删除；发布后草稿从箱中消失；清空按钮带确认且不影响草稿箱；两个右侧面板独立折叠。
