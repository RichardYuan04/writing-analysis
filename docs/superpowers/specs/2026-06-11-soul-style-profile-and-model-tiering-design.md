# Design: 风格 SOUL 文档 + 写作工具模型分级（B 层）

**日期**: 2026-06-11
**状态**: 待实现
**范围**: 写作工具面板的「地基层（B 层）」——模型分级 + Style Profile（风格 SOUL 文档）链路。
**不含（留待下一阶段，A 层）**: 缩减/同义/比喻/扩展四个功能各自的 prompt 工艺细调。

---

## 1. 背景与目标

### 现状

写作页右侧已有「写作工具」常驻面板（`AssistPanel.jsx`），选中文字后可调用四个 AI 辅助功能：缩减、同义替换、比喻、扩展。后端实现在 `backend/main.py:491-588`。

存在三个地基层问题：

1. **四个功能全用 Haiku**（`main.py:530` 写死 `claude-haiku-4-5-20251001`）。但比喻、扩展是最吃模型理解力的两个任务，Haiku 在此是短板。规格文档原本也建议这两个用更强的 Claude。
2. **Style Profile 完全没接上**。`AssistPanel.jsx:13` 注释明示「当前不传 style_profile，后端走降级分支」；后端 `_assist_system()` 虽有降级分支，但前端永远传空，且**不存在任何生成 style profile 的逻辑**。规格文档里「保证输出与作者风格一致」这一核心卖点目前兑现度为 0。
3. **Prompt 为单句指令式**，缺技巧（属 A 层，本 spec 不处理）。

### 目标

把 B 层地基铺好，让单功能后续打磨有意义：

1. **模型分级**：按功能难度分流到 Haiku / Sonnet / Opus。
2. **风格 SOUL 文档**：用户在画像页**自己框定哪几篇文章**作为输入，AI 基于「量化锚点 + 原文摘录」蒸馏出一段可注入的风格指令，**用户可手改**，保存后被四个写作工具在**服务端**注入，使输出更像作者本人。

---

## 2. 功能范围

### 包含

- 四个 assist 接口 + SOUL 生成接口的**模型分级**。
- 新数据表 `style_profile`（单用户，单行）。
- 三个新后端接口：`GET /style-profile`、`POST /style-profile/generate`、`PUT /style-profile`。
- `compute_portrait` 支持**在选中文章子集**上计算。
- **服务端注入**：四个 assist 接口直接从库里读 SOUL 文档注入，前端不再负责传递。
- 画像页新增「风格 SOUL 文档」面板（置顶），含多选文章、养成、可编辑、保存、显示来源与时间、轻量重养提示。

### 不包含

- A 层：四个功能各自的 prompt 细调（下一阶段）。
- 多用户 / `user_id`（当前 SQLite 单库单用户，全局一份 SOUL 文档即可）。
- SOUL 文档的版本历史 / 撤销。

---

## 3. 模型分级

改造 `_assist_call`，让 `model` 成为按功能传入的参数（不再写死）。

| 功能 | 接口 | 模型 |
|---|---|---|
| 缩减 | `/assist/reduce` | `claude-haiku-4-5-20251001` |
| 同义替换 | `/assist/synonyms` | `claude-sonnet-4-6` |
| 比喻 | `/assist/metaphor` | `claude-opus-4-8` |
| 扩展 | `/assist/expand` | `claude-sonnet-4-6` |
| SOUL 文档生成 | `/style-profile/generate` | `claude-sonnet-4-6` |

**理由**：缩减是机械压缩，Haiku 够用且快；同义/扩展需贴合语境与风格，Sonnet 是质量/延迟甜点；比喻最难（要理解原文意象再造新意象），用最强的 Opus，且比喻是探索性操作，用户愿意多等。当前为个人测试、调用量低，质量优先于成本。

**实现**：`_assist_call(data, user, max_tokens, parse_options, model)` 增加 `model` 形参，各 `@app.post` 调用处显式传入。

---

## 4. 数据模型

新增单行表（SQLAlchemy，与现有 `Essay`/`Fragment` 同库）：

```python
class StyleProfile(Base):
    __tablename__ = "style_profile"
    id = Column(Integer, primary_key=True)          # 固定单行，id=1
    content = Column(Text)                          # 最终注入用的 SOUL 串（用户可改后的版本）
    rationale = Column(Text)                         # JSON：分维度依据（可选展示，见 §6）
    source_essay_ids = Column(Text)                 # JSON 数组：本次养成用了哪几篇
    generated_at = Column(DateTime)                 # 上次养成/保存时间
    user_edited = Column(Integer, default=0)        # 0/1：当前 content 是否被用户手改过
```

`migrate_db()` 风格：`Base.metadata.create_all(engine)` 已能建表；无需手写迁移（新表非旧表加列）。

---

## 5. 后端接口

### 5.1 `GET /style-profile`

读当前 SOUL 文档。无记录时返回 `{ "exists": false }`；有则返回 `content / rationale / source_essay_ids / generated_at / user_edited`，并附 `new_essays_since`（自 `generated_at` 后新增的文章数，供前端做「重养提示」）。

### 5.2 `POST /style-profile/generate`

请求体：`{ "essay_ids": [int, ...] }`（用户框定的文章）。流程：

1. 校验：`essay_ids` 非空；建议至少 2-3 篇（少于会提示但不强制拒绝）。
2. 取这些文章，调用 `compute_portrait(selected_essays)` 得到**量化锚点**。
3. 从同一批文章取**未改写的原文摘录**，保留断句与换行，**总量目标 ≥ 500 字**（按 §7 采样规则）。
4. 用 §8 的 prompt 调 Sonnet，返回 `{ soul: str, rationale: {...} }`（结构化 JSON）。
5. **落库**（upsert id=1）：`content=soul`、`rationale`、`source_essay_ids=essay_ids`、`generated_at=now`、`user_edited=0`。
6. 返回 `{ content, rationale, source_essay_ids, generated_at }`。

### 5.3 `PUT /style-profile`

请求体：`{ "content": str }`。保存用户手改后的文本：`content=...`、`user_edited=1`、`generated_at=now`（`source_essay_ids` 保持不变）。返回更新后的记录。

### 5.4 注入改为服务端读库（关键简化）

`AssistRequest.style_profile` 字段**废弃**（前端不再传）。在 `_assist_call` 内部：开调用前 `SELECT content FROM style_profile WHERE id=1`，把读到的 `content` 传给 `_assist_system()`。读不到 → `content=""`，自动走现有降级分支（`main.py:504-505`）。

---

## 6. 分维度依据（rationale，可关）

生成接口让模型在产出 SOUL 串的同时，返回一份**分维度依据**（五维各一句话：句子节奏 / 意象感官 / 情绪表达 / 用词 / 标志性手法），存入 `rationale`。前端在面板里**折叠展示**，帮助用户判断要不要手改 SOUL 串。

> 此项为低成本增强（同一次调用一并返回，仅多一个 JSON 字段 + 一个折叠区）。若不需要，删除 `rationale` 字段与折叠区即可，不影响主链路。

---

## 7. 摘录采样规则

- 仅从用户框定的 `essay_ids` 中取。
- 每篇取开头若干字（建议每篇 ≤ 400 字），**保留原始换行与标点**（节奏不可压平）。
- 累计达到 ~500–800 字即停（避免 token 浪费）；若所有选中文章总量不足 500 字，则全取。
- 摘录之间用 `\n\n【标题】\n` 分隔，便于模型分辨篇目。

---

## 8. SOUL 生成 Prompt（含联网调研依据）

调研结论（见文末 Sources）支撑的设计要点：
- **风格是节奏而非仅词汇**，且「压成纯结构会抹掉声音」→ 必须喂未改写原文摘录，量化特征仅作锚点。
- 学术上的 **Step-Back Profiling / Gist**：把写作历史蒸馏成简洁档案（体裁、修辞标记、节奏、情感）——正是我们要的 ~100–200 字风格指令。
- **Forensic linguist** 角色框定提升分析质量。
- **多维 rubric**（语义/语法/句法/词汇四层）防遗漏。
- **两段式**：先逐维分析，再蒸馏压缩。

```
system:
你是一名法医语言学家 + 中文写作风格分析师，擅长从文本中识别作者独有的声音，
并把它压缩成可直接用于指导写作的风格指令。只描述特征，不评价好坏，
不使用「该作者/这位作者」等人称，直接描述风格本身。

user:
以下是某作者的写作风格量化数据与若干篇原文摘录。

## 量化锚点（客观统计，供参考，勿照搬数字）
- 情感基调：{tone}
- 句式偏好：{sentence_style}（平均句长 {avg_sentence_length} 字）
- 词汇丰富度：{vocab_richness}（TTR={ttr}）
- 标点习惯：{punct_style}
- 段落风格：{para_style}
- 篇幅偏好：{volume_style}
- 灵魂词汇：{soul_words}

## 原文摘录（保留了原始断句与节奏，请重点感受其节奏与意象）
{excerpts}

请分两步：
第一步（在心里分析，不要输出）：从五个维度刻画该作者的风格——
  1) 句子节奏与长短  2) 意象/感官/比喻倾向  3) 情绪表达方式（克制/外放/叙事）
  4) 用词（口语/书面/文学性）  5) 标志性手法（标点、留白、重复、转折等）
第二步（输出）：把以上压缩成一段 100–200 字的密集风格指令，
  要可直接注入用于指挥 AI 模仿该风格写作。

以严格 JSON 输出：
{
  "soul": "……100–200字的风格指令……",
  "rationale": {
    "rhythm": "句子节奏一句话",
    "imagery": "意象感官一句话",
    "emotion": "情绪表达一句话",
    "diction": "用词一句话",
    "signature": "标志性手法一句话"
  }
}
```

**注入端**（四个 assist 接口共用，已存在于 `_assist_system`）：
```
你是写作助手。该作者的写作风格为：{soul}。
所有建议必须与该风格保持一致，不要改变作者的声音和语气。
直接输出建议内容，不要解释、不要加前缀。
```

**SOUL 串长度**：目标 100–200 字（比原规格的 ≤60 字放宽）。理由：它要被注入去**指挥创作**，太短不可操作。该值是可调参数。

---

## 9. 前端：画像页「风格 SOUL 文档」面板

位置：`Portrait.jsx`，置于页面顶部（雷达图之上）。

状态与交互：
- **空态**（`GET /style-profile` 返回 `exists:false`）：说明文案 +「选择文章，养成你的 SOUL 文档」入口。
- **选篇**：复用 `EssayPicker` 的模式，**从单选扩展为多选**（多选 essay_ids）。
- **养成**：点「养成 SOUL 文档」→ `POST /generate` → loading（Sonnet 调用，几秒）→ 结果落入**可编辑 `<textarea>`**。
- **编辑/保存**：用户可改 textarea → 「保存」→ `PUT /style-profile`。
- **已有态**：展示当前 `content`（可编辑）、`rationale`（折叠）、「基于 N 篇 · 上次养成 {generated_at}」、若 `new_essays_since >= 5` 则显示轻提示「你又写了 {n} 篇，要不要纳入重养？」（提示不强制，点击进入重新选篇）。
- 文案要明确告诉用户：**这是 AI 对你写作风格的概括，会用来指导写作工具，让它写得更像你**。

说明文案沿用现有「本地分析」的克制语气；面板视觉沿用现有 `.section` 风格。

`api.js` 新增：`getStyleProfile()`、`generateStyleProfile(essayIds)`、`saveStyleProfile(content)`。

---

## 10. 降级与边界

- 无 SOUL 文档 / `content` 为空 → 四个 assist 自动走降级分支（保持当前行为，不报错）。
- 选篇过少（<2-3 篇）→ 后端可生成但前端提示「建议多选几篇，风格更准」。
- 生成调用失败 → 沿用 assist 的 502 文案「AI 调用失败，请稍后再试」，不破坏已有 SOUL 文档。
- `EssayPicker` 改多选时，确保单篇深度解读（现有功能，单选）不被破坏——多选能力应是可配置的，或新建一个多选变体组件，避免回归。

---

## 11. 决策记录（已与用户确认）

1. 模型分级方案 = 质量优先（缩减 Haiku / 同义 Sonnet / 比喻 Opus / 扩展 Sonnet）。
2. Style Profile 生成方式 = 量化特征 + 原文摘录混合（非纯 LLM 读全文，也非纯量化拼接）。
3. SOUL 文档 = 用户可手改（生成草稿 → 可编辑 → 保存注入）。
4. 输入由用户**框定文章**；量化锚点与摘录都取自这批选中文章。
5. 更新走**手动**（重养按钮），不再静默自动覆盖；新增 ≥5 篇时仅轻提示。
6. 注入改为**服务端读库**，前端不再传 `style_profile`。
7. SOUL 串长度放宽到 100–200 字。
8. 分维度依据（rationale）= 加入（低成本、可关）。

---

## 12. 测试要点

- **后端**：`compute_portrait` 在子集上正确运行；generate upsert 单行；PUT 置 `user_edited=1`；assist 接口在有/无 SOUL 文档两种情况下分别走注入/降级；模型名按功能正确分流。
- **生成质量**（手测）：用真实文章框定 3-5 篇，检查 SOUL 串是否 100–200 字、是否描述节奏/意象/情绪/用词/手法、是否无「该作者」人称、是否无数字照搬。
- **前端**：空态→选篇→养成→编辑→保存→已有态全流程；重养提示在新增≥5 篇时出现；单篇深度解读（单选）无回归。
- **端到端**：保存 SOUL 文档后，比喻/扩展输出在风格上相比降级分支有可感差异。

---

## Sources（联网调研）

- [Step-Back Profiling / Personalized Creative Writing LLMs](https://www.emergentmind.com/topics/personalized-creative-writing-llms)
- [What's in a prompt? LMs encode literary style (arXiv 2505.17071)](https://arxiv.org/html/2505.17071v1)
- [XAM: forensic-linguist style prompt (arXiv 2512.06924)](https://arxiv.org/pdf/2512.06924)
- [How to Create an AI Style Guide (Forte Labs)](https://fortelabs.com/blog/how-to-create-an-ai-style-guide-write-with-chatgpt-in-your-own-voice/)
- [Replicate an Author's Writing Style Using Prompt Engineering (DEV)](https://dev.to/thatechmaestro/replicate-an-authors-writing-style-using-prompt-engineering-insights-from-an-experiment-with-2hfk)
