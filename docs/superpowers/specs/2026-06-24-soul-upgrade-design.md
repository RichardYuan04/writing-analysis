# Design: SOUL 风格档案升级（频率 / 禁止项 / 黄金样例 few-shot）

**日期**: 2026-06-24
**状态**: 已实现
**范围**: 给现有 SOUL 风格档案补三样东西——① 用本地真频率钉「程度」，② 一份可编辑的通用散文「禁止项」黑名单，③ 自动抽取的「黄金样例」原文 few-shot；并把禁止项 + 黄金样例一并注入缩减/同义/扩展。

---

## 1. 背景与目标

### 现状
SOUL（`StyleProfile` 单行 id=1）从用户勾选的随笔里，喂「量化锚点（本地算）+ 原文摘录」给 `claude-sonnet-4-6`，提炼成一段 100–200 字密集风格指令（含五维依据），存库、可编辑。`_assist_system()` 把它拼成 system 注入**缩减/同义/扩展**（比喻/找引文/读者视角不注入）。

### 缺口
1. 输出没强制写**频率/程度**——模型倾向"放大"特征（偶尔用破折号→每句都用）。
2. 没有任何**负面约束**——这三个工具仍可能冒 AI 套话。
3. 注入时只有**描述串**，没有**原文 few-shot**，锁风格/抗漂移弱。

### 目标
1. SOUL 正文用**给定的真频率数字**写明程度，禁止模型自估。
2. 新增一份**通用散文「禁止项」黑名单**（写死默认值、用户可在画像页编辑），注入三个工具。
3. 养成时**自动抽 2–3 段黄金样例**原文，存库，注入三个工具当 few-shot 参考。

### 明确的非目标
- **不做「作者专属禁令」**：不从随笔里"没出现的东西"反推禁令——那是白名单归纳谬误（现在没写 X 不代表不该写、以后不写）。禁止项只含"像 AI"的通用毛病，与具体作者无关。
- 不动比喻 / 找引文 / 读者视角的注入策略。
- 不做对话式（user/assistant 多轮）few-shot——本期黄金样例以"系统提示里的参考原文"形式注入；对话式 few-shot 列为后续可选。
- 重养 SOUL 不重写禁止项（禁止项与样本无关、独立持久）。

---

## 2. 数据模型

`StyleProfile`（id=1）新增两列：
- `golden_samples` `TEXT`：JSON 数组，2–3 段原文片段（养成时生成）。
- `taboo` `TEXT`：禁止项文本（用户可编辑；为空时回落到 `DEFAULT_TABOO`）。

迁移：沿用 `migrate_db()` 幂等 `ALTER TABLE style_profile ADD COLUMN ...`（注意 style_profile 表此前不在 migrate 列表里，需新增对该表的 ALTER）。

---

## 3. 通用禁止项默认值（`DEFAULT_TABOO` 常量）

散文/随笔适用，剔除了 markdown 加粗/标题、SEO/促销：

```
请规避以下「AI 腔」写法：
- 套话与软化词：值得注意的是 / 综上所述·总而言之 / 某种程度上·可能地 / 此外 / 「不是 X，而是 Y」「不仅…而是…」。
- 拔高与升华：「标志着…关键时刻」「象征着…」「反映了更广泛的趋势」；别用动名词堆抽象深刻（「象征着…反映了…」）。
- 空泛/促销词：至关重要、格局（抽象用）、展现、充满活力、令人叹为观止、迷人的。
- 句法节律：别三项排比成瘾（改两项或四项）；别连续等长句；破折号别当节奏拐杖。
- 对读者：别解释自己的比喻；别过度软化（「可能会产生影响」→「影响了」）；别绕开「是/有」。
- 结构：别每段都用整齐总结收尾；别强行在结尾升华或喊口号。
```

来源：op7418/Humanizer-zh 的 SKILL.md（已提炼为散文适用子集）。

---

## 4. 后端

### 4.1 生成（`generate_style_profile` / `_build_soul_prompt`）
- prompt 里把现有量化锚点改成**明确的"频率/程度"指令**：要求 SOUL 正文里用**给定的数字**（平均句长、TTR、标点习惯、灵魂词汇）写明程度，**不要自行估计频率**。
- 另算并附 1–2 个频率锚点（可选增强）：破折号/感叹号每百字次数，喂进 prompt 供"程度"使用。
- **黄金样例**：复用 `_sample_excerpts` 的取段逻辑，跨选中文章挑 **2–3 段**有代表性的原文（每段 ≤200 字，保留原始断句），写入 `golden_samples`。
- 养成**不写** `taboo`。

### 4.2 读取 / 编辑
- `GET /style-profile`：响应增 `golden_samples`（数组）、`taboo`（为空回落 `DEFAULT_TABOO`）。
- `PUT /style-profile`：请求体扩展为 `{content?: str, taboo?: str}`——可单独更新正文或禁止项（任一缺省则不动）。保存 `content` 时仍置 `user_edited=1`。

### 4.3 注入（`_assist_system` / `_load_soul_content`）
- 新增 `_load_soul_bundle()` → `{content, taboo, samples}`（一次读出三样）。
- `_assist_system()` 拼装：
  - 有 SOUL：`该作者的写作风格为：<content>。所有建议必须与该风格保持一致，不要改变作者的声音和语气。` ＋ `<taboo>` ＋（若有样例）`参考该作者的原文片段，学其语感、不要照抄内容：<samples 拼接>`。
  - 无 SOUL（降级）：保持原"贴合原文/上下文"那句，但**仍拼上 `DEFAULT_TABOO`**（去 AI 腔对谁都该有）。
- 注入面不变（缩减/同义/扩展走 `_assist_call` 默认路径；比喻/找引文仍传自己的 system，不受影响）。

---

## 5. 前端（`SoulDocPanel`，画像页）
- 保留：SOUL 正文展示 + 编辑 + 保存（现状）。
- 新增：**禁止项**区——一个多行可编辑文本框，初值取 `taboo`（为空显示默认黑名单），保存调 `PUT /style-profile {taboo}`。
- 新增：**黄金样例**区——只读列出养成时抽的 2–3 段（让用户看到"拿什么垫风格"）。
- `api.js`：`saveStyleProfile` 扩展为可传 `{content?, taboo?}`（或新增 `saveSoulTaboo`）。

---

## 6. 文件改动
- `backend/main.py`：`migrate_db` 加 style_profile 两列；`StyleProfile` 加 `golden_samples`/`taboo`；`DEFAULT_TABOO` 常量；`_build_soul_prompt` 改频率指令；`generate_style_profile` 抽并存黄金样例；`get_style_profile` 返回新字段；`StyleProfileUpdateRequest` 加 `taboo`、`update_style_profile` 支持；`_load_soul_bundle` + `_assist_system` 拼禁止项与样例。
- `backend/tests/`：新建 `test_soul_upgrade.py`。
- `frontend/src/api.js`、`frontend/src/components/SoulDocPanel.jsx`、`frontend/src/App.css`。

---

## 7. 测试（后端 pytest）
- `GET /style-profile` 在 `taboo` 为空时回落 `DEFAULT_TABOO`；非空时回用户值。
- `PUT /style-profile {taboo}` 保存后 `GET` 取回；只传 taboo 不动 content，只传 content 不动 taboo。
- 养成（mock anthropic）后 `golden_samples` 非空、`GET` 能取回；养成**不改** taboo。
- 注入：构造一份带 taboo+samples 的 StyleProfile，调 `/assist/reduce`（mock anthropic），断言传给模型的 `system` 同时包含 SOUL 正文片段、禁止项关键词、样例片段。
- 前端手动验证。

---

## 8. 已确认决策
- 频率：用本地真数字钉程度（非模型自估）。
- 禁止项：仅通用散文黑名单，**写死默认 + 用户可编辑、开放到画像页**；**不做作者专属反推**（归纳谬误）。
- 黄金样例：养成自动抽 2–3 段，存库，注入当参考 few-shot。
- 注入面：禁止项 + 黄金样例随 SOUL 一并注入缩减/同义/扩展；读者视角不碰。
