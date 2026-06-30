# Design: 风格 SOUL 文档多槽（最多 3 个）+ 默认切换

**日期**: 2026-06-30
**状态**: 待评审
**范围**: 把单个 SOUL 文档升级为最多 3 个「风格槽」，每槽是一份独立风格（因选篇不同而不同），用户指定其一为「默认」，默认槽喂给所有写作工具。

---

## 1. 背景与目标

### 现状（已读代码确认）
- `StyleProfile` 是**固定单行 `id=1`**，列：`content / rationale / source_essay_ids / generated_at / user_edited / golden_samples / taboo`。
- `_load_soul_bundle()`（main.py:774）与 `_load_soul_content()`（main.py:790）都读 `id=1`，注入到 缩减/同义/扩展/续写（经 `_assist_system`）。
- 前端仅 `SoulDocPanel.jsx` 消费：`getStyleProfile / generateStyleProfile / saveStyleProfile`。

### 目标
1. 最多 3 个风格槽并存，各自独立养成（不同选篇 → 不同风格）。
2. 用户指定一个为「默认」，一键切换；默认槽自动喂给所有写作工具。
3. 每槽可自定义名字；禁止项三槽共用一份。

### 非目标
- 不做风格「对比/混合」。
- 不改写作工具本身的逻辑（只换它们读到的是「默认槽」）。
- 不动 `Portrait` 的雷达/灵魂词汇/9 维解读/单篇深度解读（那些基于全部随笔的本地统计，与 SOUL 槽无关）。

### 已确认决策
- 命名：用户自定义名字；**留空则显示「风格 N」**（N 为列表中 1-based 序号）。
- 禁止项：**三槽共用一份**（它本就是与作者无关的通用去 AI 腔表）。
- 空槽：**按需新建，最多 3**；不预留占位格。
- 删除：**允许删到 0**（回到空态）。共用禁止项独立保存，删到 0 槽仍保留生效。
- 重新养成：**覆盖该槽**的 content/选篇/黄金样例，**名字不变**（要改名用户自己改）。

---

## 2. 数据模型

### `StyleProfile`（= 风格槽，多行）
保留现有列，**新增 `name`**；`taboo` 列**弃用**（迁移后不再读写，见 §6）。
- `id`（autoincrement 主键；现有 `id=1` 保留为槽 1）
- `name TEXT NULL` —— 用户自定义名字；空表示用默认显示名
- `content / rationale / source_essay_ids / generated_at / user_edited / golden_samples` —— 含义不变，**每槽独立**

### `SoulSettings`（= 全局配置，单行 `id=1`）
- `id`（固定 1）
- `active_profile_id INTEGER NULL` —— 当前默认槽的 id；无槽时为 `NULL`
- `taboo TEXT` —— 三槽共用的禁止项；空串表示走 `DEFAULT_TABOO`

> 选 `SoulSettings` 而非在 `StyleProfile` 加 `is_active`：默认指针与共用禁止项都是全局唯一、与具体风格无关的状态，集中放单行配置最干净，也让「删到 0 槽仍保留禁止项」自然成立。

---

## 3. 迁移 `migrate_soul_slots()`

幂等，启动时随其它迁移一并执行：
1. `ALTER TABLE style_profile ADD COLUMN name TEXT`（若不存在）。
2. `create_all` 建出 `soul_settings` 表。
3. 若 `soul_settings` 无行：插入 `id=1`；
   - 若存在 `StyleProfile id=1` → `active_profile_id = 1`，`taboo = (该行 taboo 去空) 或 ""`；
   - 否则 `active_profile_id = NULL`，`taboo = ""`。
4. 现有 `StyleProfile id=1` 原样保留为槽 1（`name` 为 NULL → 前端显示「风格 1」）。

**用户现有 SOUL 无损保留为默认槽。**

---

## 4. 注入逻辑

`_load_soul_bundle()` 改为：
- 读 `SoulSettings`（单行）。取 `active_profile_id` 指向的 `StyleProfile` 行。
- 返回 `{ content: 该行 content, samples: 该行 golden_samples, taboo: SoulSettings.taboo 去空 或 DEFAULT_TABOO }`。
- 若无 active 行（0 槽或指针空）：`{ content:"", samples:[], taboo: 同上 }`（降级，与现在无 SOUL 时一致，但禁止项仍来自共用配置）。

`_load_soul_content()` 同步改为读 active 槽的 content（保持其现有调用点语义）。

> 写作工具（`_assist_call` 默认路径、`/assist/continue`）无需改动——它们只通过 `_assist_system(_load_soul_bundle())` 间接拿到「默认槽」。

---

## 5. 接口（替换单数 `/style-profile`）

所有响应里每个 profile 形如：
```json
{ "id": 1, "name": "日常随笔",            // 可为 null
  "content": "...", "source_essay_ids": [..],
  "golden_samples": ["..."], "rationale": {..},
  "generated_at": "ISO|null", "user_edited": 0,
  "new_essays_since": 3 }                  // 该槽养成后新增/新建的随笔数
```

- **`GET /style-profiles`** → `{ "active_id": 1|null, "taboo": "<生效值，空则 DEFAULT_TABOO>", "profiles": [<上述>...] }`（按 `id` 升序）。
- **`POST /style-profiles/generate`** `{ "essay_ids": [..] }` → 新建一槽并养成。
  - 已有 3 槽 → `400 最多 3 个风格`。
  - 新建后：若此前 0 槽（active 为 null）→ 自动把新槽设为 active；否则不抢默认。
  - 返回新槽对象。
- **`POST /style-profiles/{id}/generate`** `{ "essay_ids": [..] }` → 重新养成该槽，**覆盖** content/source/golden_samples/rationale/generated_at，`user_edited` 复位 0，**`name` 不变**。`id` 不存在 → 404。
- **`PUT /style-profiles/{id}`** `{ "name"?, "content"?, "golden_samples"? }` → 局部更新该槽。
  - `content` 改动置 `user_edited=1`、刷新 `generated_at`（沿用现有 PUT 语义）。
  - `name`：空串存为 NULL（回到默认显示名）。
  - `golden_samples`：去空白项、每条截 200 字（沿用现有清洗）。
- **`POST /style-profiles/{id}/activate`** → `active_profile_id = id`（id 不存在 → 404）。返回 `{ "active_id": id }`。
- **`DELETE /style-profiles/{id}`** → 删除该槽。
  - 若删的是 active：`active_profile_id` 改指剩余槽中最小 id；无剩余则 NULL。
  - 返回 `{ "active_id": <新值> }`。
- **`PUT /soul-settings`** `{ "taboo": "..." }` → 写共用禁止项（空串允许，表示回落 DEFAULT_TABOO）。返回 `{ "taboo": "<生效值>" }`。

---

## 6. 前端

### `api.js`（替换三个旧函数）
```js
export const listStyleProfiles = () => api.get('/style-profiles')
export const generateStyleProfile = (essayIds) => api.post('/style-profiles/generate', { essay_ids: essayIds })
export const regenerateStyleProfile = (id, essayIds) => api.post(`/style-profiles/${id}/generate`, { essay_ids: essayIds })
export const updateStyleProfile = (id, data) => api.put(`/style-profiles/${id}`, data)
export const activateStyleProfile = (id) => api.post(`/style-profiles/${id}/activate`)
export const deleteStyleProfile = (id) => api.delete(`/style-profiles/${id}`)
export const saveSoulSettings = (data) => api.put('/soul-settings', data)
```

### `SoulDocPanel.jsx`（重做）
- 顶部一排**风格卡（≤3）**：每张显示 显示名（`name || 「风格 N」`）、`基于 X 篇 · 养成日期`、默认槽带「默认 ✓」徽标、非默认槽有「设为默认」按钮。点卡片选中为「当前编辑槽」。
- 未满 3 张时一个 **「+ 新建风格」**（进选篇 → `generate`）。
- **当前编辑槽**展开：可改名输入框、content textarea（保存=`PUT`）、黄金样例编辑器（沿用现有）、`重新选篇养成`（=`/{id}/generate` 覆盖）、`删除该风格`。
- **禁止项编辑器只出现一次**（全局共用，`saveSoulSettings({taboo})`），单独一块，与槽无关。
- 0 槽空态：与现状一致的「选篇养成第一个风格」引导；此时禁止项编辑器仍可见可改。
- 「重养提示」（new_essays_since≥5）按**每槽**判断。

> `SoulDocPanel` 在 `Portrait` 页内，重做仅限本组件，不影响雷达/灵魂词汇等同页其它块。

---

## 7. 测试影响

- `conftest.py` 的 `db` fixture 清表需加清 `SoulSettings`（且每次重建 `id=1` 单行或交由迁移/端点兜底）。
- `test_soul_upgrade.py` 多条用例依赖单行 `id=1` 与单数端点（`GET/PUT /style-profile`、`/style-profile/generate`），需重写为多槽端点；断言改为「active 槽」「共用 taboo」。
- 新增用例：建满 3 报 400、删除 active 后指针回退、删到 0 后 `_load_soul_bundle` 降级但 taboo 仍来自共用、重新养成覆盖且保名、`name` 空回落默认显示名、激活切换后 `_load_soul_bundle` 取新槽。
- `_golden_samples` / `_assist_system` / `DEFAULT_TABOO` 等既有逻辑不变。

---

## 8. 已确认 / 待定
- 已确认：§1「已确认决策」全部 + §2 数据模型 + 删到 0 + 重养覆盖保名。
- 待你最终点头：整份设计。确认后进 writing-plans 拆实现（后端 TDD + 前端）。
