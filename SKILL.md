---
name: story-weave
description: 故事演绎技能。三步流水线：① 分析输入的文本内容（体裁/常识标尺/人物/时间线/世界设定/留白点），给出合理的故事演绎思路与方向 → ② **人工确认演绎方向和修改点**（结构化勾选卡片 + 逐条落盘留痕，未确认不允许进入写作）→ ③ 进行故事演绎并做常识校验。支持六种模式：扩写 / 续写 / 前传 / 改编 / 番外 / 多线推演(what-if)。核心保障是"生成的故事必须符合常识"——分现实/架空双标尺：现实向严守现实世界常识，架空向以作品内部设定一致性为主、现实常识作背景约束；演绎前把"不可改写的事实 + 作品已立的设定 + 演绎不变量"写成硬约束注入每一节的写作指令，演绎后由 102 条规则逐条校验（可计算的硬伤由引擎算，需理解语义的问题由引擎收窄成带原文证据的问题交给模型判断）。产物统一输出 markdown / html / pdf / json 四种格式。当用户说"把这个故事演绎一下""根据这段文字写个故事""扩写/续写/写前传/改编/写番外/如果当时……会怎样""把这个梗概写成完整故事""续写这段""帮我发展这个故事"时使用；也适用于把一段新闻、日记、设定片段、对话记录演绎成叙事作品，以及给已有故事做常识校验（"这个故事有没有常识错误""帮我检查设定有没有前后矛盾"）。
whenToUse: 用户提供了一段文本（故事片段、梗概、新闻、日记、设定、对话记录），希望在此基础上**演绎出合理的故事**，而不是从零原创。适用于六种演绎意图，也适用于只做常识校验（可只跑第三步的校验环节）。不适用于：没有输入文本的纯原创写作、纯文本润色、以及要求"随便编一个"而不关心与原文本一致性的场景——本技能的首要约束就是不得改写原文已写死的事实。
---

# story-weave — 故事演绎技能

把「一段文本」变成「一个讲得通、且不违反常识的故事」。

```
输入文本
   │
   ├─ 第一步  sw analyze ──→ analysis.json / analysis.md
   │        看清原文：体裁、常识标尺、人物、时间线、地点、世界设定、事实锚点、留白点
   │        给出**演绎思路与方向**：六种模式的适配度打分 + 推荐 + 待确认信息
   │
   ├─ 第二步  sw plan ─────→ plan.json / plan.md / confirm-questions.json
   │        ★ 人工确认：用 ask_user_question 把 confirm-questions.json 的 questions 交给用户勾选
   │        ★ 用户勾选结果经 sw confirm --answers 写回 plan.json（带 decidedAt 留痕）
   │        ★ **未确认的方案一律拒绝进入第三步**，这是硬闸门
   │
   └─ 第三步  sw weave ────→ prompts.md（逐节写作指令 + 常识自查表 + 硬约束）
            （写草稿）       ↓
             sw weave --draft 草稿.md ──→ story.json / story.md
             sw check ─────→ check.json / check.md（常识校验报告）
             sw render ────→ markdown / html / pdf / json
```

**核心分工：取证与计算交给引擎，语义判断与创作交给模型。**

- 引擎做确定性的活：解析时长/距离/速度/年龄/年份，算生理极限，比对原文已立设定，定位到行号。
- 模型做需要理解的活：写正文，以及回答"这个动机合不合理"这类引擎判不了的问题。
- 两者都不越界：引擎不评价文笔，模型不臆造"常识错误"。

---

## 路径约定

本技能目录为 `<仓库根>`（含 `SKILL.md`、`lib/`、`scripts/`）。下文用 `$SW` 代表它的绝对路径：

```bash
SW=/Users/<you>/.../story-weave-skill      # ← 换成实际路径
node "$SW/scripts/sw.mjs" selfcheck        # 自检：跑完整流水线并断言 76 项不变量
```

零 npm 依赖，只要本机 Node ≥ 18。PDF 需要本机 Chrome（没有则自动跳过，不影响其它产物）。

---

## 第一步：分析输入文本，给出演绎思路和方向

```bash
# 直接给文字
node "$SW/scripts/sw.mjs" analyze --text "原文……" --out out

# 给文件（可多个，也可给目录）
node "$SW/scripts/sw.mjs" analyze --in draft.md --out out

# 手动指定（自动识别不准时用）
node "$SW/scripts/sw.mjs" analyze --in a.md --genre urban --tier realistic --year 2010 --out out
```

产出 `out/analysis.json` + `out/analysis.md`，其中：

| 字段 | 含义 |
|---|---|
| `source.fingerprint` | **文本指纹**：确认下游校验的对象与本次输入是同一份 |
| `textType` | 文本类型（叙事片段/梗概大纲/事实报道/对话记录/设定片段）+ 叙事完整度 |
| `genre` | 体裁（17 类）+ **常识标尺 tier**：`realistic` / `speculative` |
| `standard` | **常识标尺说明**：决定后面所有校验的口径 |
| `world.era` | 年代（识别不到时明确写"未指明"，并说明会跳过时代错位检查） |
| `narrative` | 人称、时态感、基调、对话占比 |
| `elements.characters` | 人物候选（带 kinds/role/confidence/evidence，**主角标 `isTop`**） |
| `elements.timeline` | 时间线（绝对/相对时间 + 明示时长） |
| `world.rules` | 世界设定（禁止/限制/必要条件/代价/机制），**架空向的内部一致性基准** |
| `facts` | 事实锚点（`immutable: true` 的**不得改写**） |
| `gaps` | **留白点**：可演绎的接口 |
| `modeFit` | 六种模式的适配度（分数 + 理由 + 风险提示） |
| `recommendation` | 推荐模式、方向、篇幅建议、需人工确认的参数 |
| `missing` | **信息不足、需要问用户的事项** |

### 常识标尺（决定一切判定口径）

| tier | 含义 | 适用 |
|---|---|---|
| `realistic` | 现实世界常识为准，明确违反即硬伤 | 都市/校园/家庭/犯罪/医疗/历史/军旅/乡土/职场 |
| `speculative` | **设定本身不算错**，但① 作品自己立的规则/代价/限制不可违反；② 人物仍按真人判（会饿会累会死）；③ 时间/数量/空间不得自相矛盾 | 仙侠/奇幻/科幻/武侠/超能力/灵异/末世/童话，以及**穿越重生**（现实外壳+架空内核） |

识别策略：**必须有正面信号才判架空**；没有任何幻想信号时按 `realistic` 兜底（更严的一侧），并在报告里说明"若这是架空设定，请用 `--tier speculative` 覆盖"。两类信号都很强时判为架空并标记 `conflict`，防止把"重生带来的先知"当成常识错误来报。

### 六种演绎模式

| 模式 | 做什么 | 硬要求 |
|---|---|---|
| `expand` 扩写 | 把梗概/片段展开为完整叙事 | 原文的结尾状态必须不变，只填中间空白 |
| `continue` 续写 | 从原文结尾之后接着写 | 原文结尾是起点，不得回退或重写 |
| `prequel` 前传 | 补出导致原文情节的成因 | **终点必须能推出原文起点**；保留至少一处神秘感 |
| `adapt` 改编 | 保留内核、替换外壳 | 必须列明"保留项/替换项"；换时代则器物称谓制度整体对齐 |
| `spinoff` 番外 | 支线人物/平行日常的独立小故事 | 不改变主线事实；番外必须自足；平行时空须标明 |
| `whatif` 多线推演 | 一个变量取不同值，推演出多条分支 | **分支之间只许差异一个变量**；分叉点之前与原文完全一致 |

**先跑第一步，再决定模式**：`modeFit` 的分数与理由都写进了报告，可直接引用给用户看；最终由用户在第二步确认。

### 第一步之后一定要做的事

1. **看 `recommendation`**，把推荐模式与方向讲给用户。
2. **看 `missing`**：这些是引擎判断不了、需要问用户的信息（标尺、年代、主角是谁、架空设定边界等）。**不要替用户猜**，在第二步的卡片里问。
3. 若 `genre.conflict` 为真或 `confidence` 偏低，**务必让用户确认标尺**——标尺错了后面全错。

---

## 第二步：人工确认演绎和修改点  ★ 本技能的关键环节

**这一步不能跳过。** 方向性决策一旦写错，第三步写得越流畅返工成本越高，所以方案必须经人工确认才解锁写作。

### 2.1 生成方案与待确认卡片

```bash
node "$SW/scripts/sw.mjs" plan --out out
node "$SW/scripts/sw.mjs" plan --mode prequel --scale long --ending maintain --out out
node "$SW/scripts/sw.mjs" plan --adapt-axis "换视角：改成哥哥的视角" --out out
node "$SW/scripts/sw.mjs" plan --branch-variable "那晚他没有说出真相" --branches 2 --out out
node "$SW/scripts/sw.mjs" plan --spinoff-character 哥哥 --out out
```

产出：
- `out/plan.json` —— 结构化方案，初始状态 `pending_confirmation`
- `out/plan.md` —— 方案报告（含修改点清单与硬约束表）
- `out/confirm-questions.json` —— **待确认问题卡片，就是 `ask_user_question` 的入参格式**

### 2.2 用 `ask_user_question` 请用户勾选

打开 `out/confirm-questions.json`，把其中的 `questions` 数组**直接**交给 `ask_user_question` 工具。
卡片包含：

| 卡片 | 作用 |
|---|---|
| `mode` | 确认演绎模式（推荐项置顶） |
| `scale` | 篇幅：短篇 4 节 / 中篇 8 节 / 长篇节选 16 节 |
| `ending` | 结局倾向：维持原结局（默认，冲突最小）/ 改写 / 开放式 |
| `changes_accept`（多选） | **哪些修改点同意照此执行**（未勾选按"不改"处理） |
| `tier` | 仅当标尺不确定时出现：现实向 or 架空向 |

**交互纪律**：
- 用户的选择**不要自己编**：拿不到答复就不要往下走。
- 用户想逐条批注时，引导他用 `--note`（见下）；`ask_user_question` 的选项只适合表达"同意/不同意"。
- 用户否决方向时，用 `--reject-plan --reason "……"` 打回，调整后重新生成卡片，**不要带着未确认的方案硬写**。

### 2.3 把确认结果写回（留痕）

```bash
# A. 用卡片的勾选结果（把 answers.json 按 confirm-questions.json 的格式填 selected）
node "$SW/scripts/sw.mjs" confirm --answers answers.json --out out

# B. 直接用命令行表达
node "$SW/scripts/sw.mjs" confirm \
  --mode prequel --scale long --ending maintain \
  --accept ch1,ch2 --reject ch3 --note "ch4=这里只写一半" \
  --notes "整体基调再冷一些" --by 用户名字 --out out

# C. 打回重做
node "$SW/scripts/sw.mjs" confirm --reject-plan --reason "主线不成立" --out out

# D. 只看当前状态
node "$SW/scripts/sw.mjs" confirm --list --out out
```

写回后：
- `plan.status.state` → `confirmed`（原样通过）或 `confirmed_with_edits`（有改动）
- 每个修改点都有 `decision` / `decisionLabel` / `decidedAt`；**用户批注进 `userNote`**
- `plan.status.history` 追加一条含 `applied`、勾选 id、批注的完整记录
- 卡片上**未勾选的修改点按"不改"处理并记录**，避免"确认了其实没人看"

### 2.4 方案里有什么

| 字段 | 说明 |
|---|---|
| `direction` | 主线、支线、主题、结局倾向、叙述视角 |
| `scale` | 篇幅、节数、目标字数、基调、受众 |
| `constraints.mustNotViolate[]` | **硬约束**：① 原文写死的事实（`FACT-001`）② 作品已立的设定（`SET-001`）③ 模式不变量（`MODE-001`）④ 标尺说明（`REAL-001`/`SET-002`/`SET-003`） |
| `changes[]` | **修改点清单**：类别/对象/原文现状/拟改为/理由/风险/处置结果 |
| `beats[]` | **写作骨架**：每节的标题、目的、写法（节数随篇幅自适应） |
| `openQuestions[]` | 还没定的事 |

**硬约束是"生成的故事必须符合常识"的第一道防线**：它会在第三步被逐字写进每一节的写作指令，并作为校验基准。

---

## 第三步：进行故事演绎，并做常识校验

### 3.1 生成写作指令

```bash
node "$SW/scripts/sw.mjs" weave --out out
```

产出 `out/prompts.md`（给人/模型读）与 `out/prompts.json`（逐节机器可读），包含：

- **写作总纲**：模式说明、视角、基调、结局、常识标尺
- **动笔前的常识自查表**（10 条）：时间记账 / 生理极限 / 空间行程 / 信息来源 / 因果关系 / 时代一致 / 数字一致 / 专业流程 / 架空设定 / 人物一致
- **逐节指令**：每节的目的、写法、目标字数、前后节衔接
- **不可改写的事实**、**作品已立的设定**、**演绎边界**、**要落实的人工确认修改点**

### 3.2 写草稿

按 `prompts.md` 逐节写，输出 markdown，**每节一个带序号的二级标题**：

```markdown
## 1. 落地：把原文的第一句展开成场景

（本节正文……）

## 2. 林晚的处境与想要的东西

（本节正文……）
```

### 3.3 导入并组装正文

```bash
node "$SW/scripts/sw.mjs" weave --draft 草稿.md --out out
```

- 解析分节（标题 / 分隔线 / 未分节），**节数与 beat 不符会显式警告**
- 组装 `story.json` + `story.md`，并保证 `story.text` 与 `sections` 完全一致（校验对象＝交付对象）
- 字数偏离目标（<60% 或 >160%）会提示

### 3.4 常识校验

```bash
node "$SW/scripts/sw.mjs" check --out out
```

产出 `check.json` / `check.md` / `checklist-template.json`。校验三件事：

| 类别 | 谁判 | 内容 |
|---|---|---|
| ① 可计算的常识硬伤 | **引擎**（79 条确定性规则） | 速度/距离/时长、生理极限（失血/脱水/缺觉/低温/骨折恢复）、时间线算术（时刻、日期、年龄、孕期）、时代错位、社会流程、称谓辈分、数字与事实前后矛盾 |
| ② 内部设定一致性 | **引擎** | 违反作品自己立的规则（「灵根残缺者永不可能结成金丹」→ 正文出现"结成金丹"）、改写原文写死的事实、人工确认的修改点是否落实、beat 是否逐节对应 |
| ③ 需理解语义的问题 | **模型**（23 条清单项） | 动机是否合理、转折是否有铺垫、信息是否来得突兀、已逝人物是否被当成在世…… |

**结论口径（写死在代码里，不受模型影响）**：

```
有 blocker（硬伤）      → fail        即使常识得分很高也是未通过
有 major 或未回答项     → pass_with_warnings
其余                    → pass
```

得分只是概览：`100 − Σ(硬伤×10 + 可疑×4 + 留意×1)`。

### 3.5 回填模型判断（把③判定完）

`check.md` 会列出所有待判断项，每条都**附上引擎取好的原文证据**。填 verdict（`pass` / `fail` / `na`）后回填：

```bash
node "$SW/scripts/sw.mjs" check --answers checklist-template.json --out out
```

- 判定为 `fail` 的清单项会转成正式 finding（沿用其证据，**每条判定都必须能指回原文行号**）
- 没有可核对出处的判定不会进 findings——宁可漏报，也不给出无法核对的指控

### 3.6 出产物

```bash
node "$SW/scripts/sw.mjs" render --out out
```

| 产物 | 内容 |
|---|---|
| `analysis.md/.json` | 分析报告 |
| `plan.md/.json` | 演绎方案（含人工确认记录） |
| `<标题>.story.md/.json` | 故事正文 |
| `check.md/.json` | 常识校验报告（含逐条证据与修正建议） |
| `<标题>.delivery.md/.html/.pdf` | **交付文档**：正文 + 演绎说明 + 校验报告（给人读的那一份） |

无 Chrome 时自动跳过 PDF 并提示，不报错。

---

## 常识保障机制（本技能的核心）

```
演绎前                          演绎中                      演绎后
─────────────────────────────────────────────────────────────────────
题材 → 常识标尺              写作指令里注入：              102 条规则逐条校验
（现实 / 架空）                · 不可改写的事实              ├ 确定性判定（引擎算）
      ↓                        · 作品已立的设定              ├ 内部一致性（设定/事实）
原文 → 事实锚点                · 演绎不变量                  └ 需模型判断（带原文证据）
（immutable 的不得改写）       · 人工确认的修改点                    ↓
原文 → 世界设定                 · 10 条常识自查表            结论：有硬伤即失败
（架空向的判定基准）                                          （与分数无关）
```

**为什么这样设计**：

- **标尺先行**：架空世界里的飞龙不是常识错误，但"设定说不能复活却复活了"是硬伤；反过来，架空世界里的人物仍然会饿会累会死。标尺决定了哪些是错误、哪些是自由。
- **约束向前移**：事后校验只能抓错，抓到的错都要返工。把最容易犯的常识错误在动笔前摆出来，成本最低。
- **判不了就不报**：误报的代价远高于漏报——报告是以"常识错误"的名义写给作者看的。所以解析失败一律返回 `null` 并跳过，绝不猜。
- **结论只看硬伤数**：把"分数高"当成"没问题"是最危险的用法，所以 `verdict` 以 blocker 数为准，并在报告里显式写明这条规则。

---

## 常用命令速查

```bash
SW=/path/to/story-weave-skill

# 只做常识校验（对已有故事）
node "$SW/scripts/sw.mjs" analyze --text "$(cat 故事.md)" --out out
node "$SW/scripts/sw.mjs" plan --out out && node "$SW/scripts/sw.mjs" confirm --accept '' --out out
node "$SW/scripts/sw.mjs" weave --draft 故事.md --out out
node "$SW/scripts/sw.mjs" check --out out

# 了解模式与规则
node "$SW/scripts/sw.mjs" modes --mode prequel --sections 8
node "$SW/scripts/sw.mjs" rules --list --severity blocker
node "$SW/scripts/sw.mjs" rules --terms

# 自检与试跑
node "$SW/scripts/sw.mjs" selfcheck
node "$SW/scripts/sw.mjs" all --text "原文……" --out out-try
```

`sw all` 会**自动确认方案**（仅用于试跑流程），真实创作请走 `plan → 用户勾选 → confirm`。

退出码：`sw check` 在有硬伤时返回 1，可直接用于脚本判断。

---

## 注意事项与已知边界

- **不要跳过第二步**。`sw weave` 会拒绝未确认的方案并明确报出原因，这不是障碍而是保障。
- **原文事实不可改写**。演绎可以补写、可以解释成因，但不能把"哥哥十五岁离开家"改成别的岁数。
- **架空作品要交代代价**。最常见的硬伤不是"用了超能力"，而是"用了却不必付代价"。
- **校验的已知边界**：大多数规则**只在单句内取证**，跨句矛盾（上一句"三天没喝水"、下一句"走了三百里"）不会被自动发现——这是为压低误报率做的刻意取舍；这类问题靠第三步的模型判断清单项兜住。已知的阈值风险（长时奔跑上限、汽车均速上限、骨折恢复门槛等）见 `docs/NOTES.md`。
- **报告不评价文笔**。它只回答两个问题：有没有可计算的常识硬伤；作品自己立的设定与原文写死的事实有没有被违反。审美问题不在本技能的判定范围内。
