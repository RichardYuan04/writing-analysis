# Design: 读者信箱（读者来信的保存与延续）

**日期**: 2026-06-22
**状态**: 待实现
**范围**: 让「读者视角」生成的信能被保存、跟随稿子生命周期（编辑缓冲 → 草稿箱草稿 → 正式随笔）流转，在随笔详情页查看 / 新增 / 删除，每篇上限 5 封（读者信箱）。

---

## 1. 背景与目标

### 现状
- 「读者视角」（`ReaderPanel`）在写作页，读编辑器当前内容，调 `POST /assist/reader` 生成一封第一人称的信。
- 信**生成即丢**，不持久化，且写作页内容此时还没有 essay id。
- 随笔详情页（`EssayDetail`）能看正文 / 心绪卡 / 各类分析，但看不到任何读者来信。

### 目标
1. 写作时即可用读者视角，并把生成的信**留存到当前稿子**。
2. 信是「这篇稿子」的一部分，随稿子流转：自动保存（localStorage）→ 存入草稿箱 → 发布成随笔，信一路同行。
3. 详情页（点开那篇文章的地方）能**查看**已存来信、**新增**（请读者再读这篇并留存）、**删除**任意一封（包括从草稿带过来的）。
4. 每篇上限 **5 封**；满了再留存要提醒用户「读者信箱已满」。

---

## 2. 功能范围

### 包含
- `drafts`、`essays` 各加一列 `letters`（JSON 数组）。
- 写作页 `ReaderPanel` 信末新增「留存这封信」；写作页持有 `letters` 状态并随稿子持久化。
- 详情页新增「读者来信」区：列表 + 新增（读者班底 → 读这篇 → 留存）+ 删除。
- 后端：草稿/随笔创建更新接收 `letters`；`GET /essays/{id}` 返回 `letters`；新增 essay 维度的追加/删除单封端点；全链路 5 封上限校验。

### 不包含
- 草稿维度的单封追加/删除 REST 端点（草稿阶段信随 `letters` 数组在草稿保存时整体写入，无需单独端点）。
- 信的编辑（只增 / 删 / 看，不改写已存信文）。
- 信的跨随笔迁移 / 全局信箱视图。
- 读者视角生成逻辑改动（仍用现有 `POST /assist/reader`）。

---

## 3. 数据模型

每封信对象（JSON）：

```json
{ "id": "lt_xxx", "persona": "poet", "persona_name": "诗人",
  "content": "来信正文…", "created_at": "2026-06-22T17:00:00" }
```

- `id`：稳定标识，前端生成（`lt_` + 时间戳36进制 + 随机），后端追加时若缺省则补。用于删除定位。
- `persona`：读者 key（poet/novelist/philosopher/editor/debater）。
- `persona_name`：读者中文名，存下来以免展示时再映射。

存储：`drafts.letters`、`essays.letters` 均为 `TEXT`，存 JSON 数组字符串；空视为 `[]`。

**上限**：单篇 `letters` 长度 ≤ 5，前后端都校验。

### 迁移
沿用现有 `migrate_db()`（幂等 `ALTER TABLE … ADD COLUMN`）：
- `ALTER TABLE essays ADD COLUMN letters TEXT`
- `ALTER TABLE drafts ADD COLUMN letters TEXT`

---

## 4. 后端

### 4.1 模型与序列化
- `Essay`、`Draft` 各加 `letters = Column(Text)`。
- `_parse_letters(raw) -> list`：`json.loads` 容错，非法/空返回 `[]`。
- `_dump_letters(list) -> str`：`json.dumps(ensure_ascii=False)`；截断保护：超过 5 封时取前 5（防御）。

### 4.2 创建 / 更新接收 letters
- `EssayCreate` 增 `letters: list | None = None`；`create_essay` 写入 `_dump_letters(data.letters or [])`。
- `DraftCreate` / `DraftUpdate` 增 `letters: list | None = None`；`create_draft` / `update_draft` 同样写入。
- 校验：传入 `letters` 长度 > 5 → `HTTPException(400, "读者信箱最多 5 封")`。

### 4.3 读取
- `GET /essays/{id}` 响应增 `"letters": _parse_letters(essay.letters)`。
- `GET /drafts` 每项增 `"letters": _parse_letters(d.letters)`（供写作页载入草稿时恢复）。

### 4.4 详情页用的单封增删
```
POST   /essays/{id}/letters        body: {persona, persona_name, content}
DELETE /essays/{id}/letters/{lid}
```
- `POST`：读出 essay.letters → 若已 ≥5 → `HTTPException(400, "读者信箱已满，最多 5 封")`；否则生成 `id`、`created_at`，追加，写回，返回**整个 letters 数组**。
- `DELETE`：按 `lid` 过滤掉，写回，返回整个 letters 数组。找不到也返回当前数组（幂等）。
- 生成本身仍由前端调 `POST /assist/reader` 完成；这两个端点只管存取。

### 4.5 错误处理
- 解析失败、未知 essay → 404；超限 → 400；其余沿用现有约定。

---

## 5. 前端

### 5.1 写作页（`Write.jsx` + `ReaderPanel.jsx`）
- `Write` 新增 `letters` 状态。
  - 初始化：`prefill` / 打开的草稿 / localStorage 缓冲里若带 `letters` 则载入。
  - **持久化三处**：① 无感自动保存写 localStorage（`wt_write_draft` 增 `letters`）；② 存入草稿箱（`DraftPanel` 的 `current` 增 `letters`，随 `createDraft`/`updateDraft` 写入）；③ 发布（`createEssay` 入参增 `letters`）。
  - 打开草稿（`openDraft`）时载入该草稿的 `letters`；清空 / 发布后清空 `letters`。
- `ReaderPanel`：
  - 新增 prop `letters`（当前已存数）、`onSaveLetter(persona, personaName, content)`、`atLimit`（=letters≥5）。
  - 信浮层底部加「**留存这封信**」按钮：点了调 `onSaveLetter`，按钮变「已留存 ✓」。
  - `atLimit` 时按钮置灰，显示「读者信箱已满（5/5），可去文章详情页删几封」。
  - 留存只追加到 `Write` 的 `letters` 状态（持久化由上面三处兜底），**不**单独发请求。

### 5.2 详情页（`EssayDetail.jsx`）
新增组件 `ReaderLetterbox.jsx`，放在正文/心绪卡之后、分析区之前：
- **已存来信列表**：每封 = 读者印章字徽（`SealChar` 复用读者 key 对应汉字）+ 信文（serif，可折叠/截断）+ 日期 + 删除按钮。空态文案「还没有读者来信」。
- **请读者再读**：5 位读者班底入口（复用 `ReaderPanel` 的 `READERS` 常量，需从该文件 `export`）。点一位 → 调 `assistReader({title, content, persona})`（用已保存随笔的标题+正文）→ 浮层出信 → 「留存」→ `POST /essays/{id}/letters` → 刷新列表。
- 满 5 封时「请读者再读」入口置灰 + 提示「读者信箱已满（5/5）」。
- 删除 → `DELETE /essays/{id}/letters/{lid}` → 刷新。
- 浮层信件 UI / 印章 / 动画复用写作页那套信浮层样式（`.modal-overlay` / `.letter-modal` / `.lm-*`，见 App.css）。

### 5.3 复用与边界
- `READERS` 班底常量从 `ReaderPanel.jsx` 导出，`ReaderLetterbox` 复用，避免两份。
- 信浮层的取信逻辑（调用 `assistReader` + loading/error + 印章信纸渲染）在两处相似；实现时抽一个轻量 `ReaderLetterModal` 共用（写作页与详情页都用），降低重复。

### 5.4 api.js
新增：`saveEssayLetter(id, data)` → `POST /essays/{id}/letters`；`deleteEssayLetter(id, lid)` → `DELETE`。`createEssay`/`createDraft`/`updateDraft` 入参自然带上 `letters`（无需改签名，调用方传字段）。

---

## 6. 文件改动

### 后端
- `backend/main.py`：`migrate_db` 加两列；`Essay`/`Draft` 加 `letters` 列；`_parse_letters`/`_dump_letters`；`EssayCreate`/`DraftCreate`/`DraftUpdate` 加 `letters`；`create_essay`/`create_draft`/`update_draft` 写入；`GET /essays/{id}`、`GET /drafts` 返回 letters；新增 `POST /essays/{id}/letters`、`DELETE /essays/{id}/letters/{lid}`。

### 前端
- `frontend/src/api.js`：`saveEssayLetter`、`deleteEssayLetter`。
- `frontend/src/components/ReaderPanel.jsx`：导出 `READERS`；信浮层加「留存这封信」+ 上限态；抽出可复用的 `ReaderLetterModal`（或新建该文件）。
- `frontend/src/components/ReaderLetterbox.jsx`：**新建**，详情页读者来信区。
- `frontend/src/components/DraftPanel.jsx`：`current` 带上 `letters`（由 `Write` 传入）。
- `frontend/src/pages/Write.jsx`：`letters` 状态 + 三处持久化 + 传给 `ReaderPanel`/`DraftPanel`。
- `frontend/src/pages/EssayDetail.jsx`：挂载 `ReaderLetterbox`。
- `frontend/src/App.css`：读者来信区 / 列表项 / 上限提示样式。

---

## 7. 测试（后端 pytest，沿用现有 fixture）
- `POST /essays/{id}/letters` 追加成功，返回数组含新封（带 id/created_at）。
- 追加到第 6 封 → 400「读者信箱已满」。
- `DELETE /essays/{id}/letters/{lid}` 删除成功，幂等（删不存在的 lid 不报错）。
- `create_essay` 带 letters → `GET /essays/{id}` 能取回。
- `create_essay` 带 > 5 封 letters → 400。
- 草稿创建/更新带 letters → `GET /drafts` 能取回。
- 前端以手动验证为主（仓库无前端测试基建）。

---

## 8. 已确认决策
- 信箱"主"在详情页，但写作页读者视角**保留**为重要入口，且能留存。
- 绑定顺序：写作页留存的信随稿子走；稿子保存到草稿箱或发布成随笔时，信一并落库（"先存文章再存信"在实现上即"信随文章一起存"）。
- 详情页可**新增**（再请读者读）也可**删除**任意一封（含草稿带来的）。
- 上限 **5 封**；满了留存入口置灰并提示「读者信箱已满」。
