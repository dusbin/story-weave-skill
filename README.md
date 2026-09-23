# story-weave — 故事演绎技能

**把一段文本变成"讲得通、且不违反常识"的故事。**

三步流水线：**分析文本 → 人工确认 → 演绎成文**。核心保障是常识校验：分现实/架空双标尺，
演绎前把硬约束注入写作指令，演绎后由 102 条规则逐条核对。

```bash
node scripts/sw.mjs analyze --in 原文.md --out out     # 第一步：分析 + 演绎思路
node scripts/sw.mjs plan --out out                     # 第二步：方案 + 待确认卡片
node scripts/sw.mjs confirm --accept ch1,ch2 --out out # 第二步：人工确认（★ 必须）
node scripts/sw.mjs weave --out out                    # 第三步：写作指令
node scripts/sw.mjs weave --draft 草稿.md --out out    # 第三步：组装正文
node scripts/sw.mjs check --out out                    # 第三步：常识校验
node scripts/sw.mjs render --out out                   # 四种格式产物
```

零 npm 依赖，只要本机 Node ≥ 18。PDF 需要本机 Chrome（没有则自动跳过）。

---

## 为什么需要它

让模型"接着写一段"很容易，难的是**写出来的东西不出常识错误、且不改写原文事实**：

- 让饿了三天的角色跑马拉松；
- 让唐朝人掏出手机；
- 让原文明明写死"哥哥十五岁离开家"，演绎里变成十八岁；
- 让架空设定立了"不能用日间灵力"，演绎里照样用还不付代价；
- 让关键转折靠"恰好有人路过"解决。

这些问题事后能挑，但挑出来就要返工。所以本技能把防线前移，并且**把判断口径写明**。

## 常识保障机制

```
演绎前                          演绎中                      演绎后
─────────────────────────────────────────────────────────────────────
题材 → 常识标尺              写作指令里注入：              102 条规则逐条校验
（现实 / 架空）                · 不可改写的事实              ├ 确定性判定（79 条，引擎算）
      ↓                        · 作品已立的设定              ├ 内部一致性（设定/事实/方案落实）
原文 → 事实锚点                · 演绎不变量                  └ 需模型判断（23 条，带原文证据）
（immutable 的不得改写）       · 人工确认的修改点                    ↓
原文 → 世界设定                 · 10 条常识自查表            结论：有硬伤即失败
（架空向的判定基准）                                          （与分数无关）
```

### 两把标尺

| 标尺 | 口径 | 适用 |
|---|---|---|
| **现实向** | 现实世界的物理、生理、时间、社会制度为准，明确违反即硬伤 | 都市/校园/家庭/犯罪/医疗/历史/军旅/乡土/职场 |
| **架空向** | 设定本身不算错，但① 作品自己立的规则/代价/限制不可违反；② 人物仍按真人判；③ 时间/数量/空间不得自相矛盾 | 仙侠/奇幻/科幻/武侠/超能力/灵异/末世，以及**穿越重生**（现实外壳+架空内核） |

架空标尺下，"可被设定合法覆盖"的规则（会飞、瞬移）自动**降一档**并提示"要么改文，要么把设定写明"；
而人体生理、时间算术这类即使架空也仍成立的规则照原档判——**架空世界里的角色还是人，会饿会累会死**。

### 结论口径

```
有 blocker（硬伤）   → 未通过    即使常识得分很高也不例外
有 major 或未回答项  → 通过（有待核对项）
其余                 → 通过
```

得分（`100 − Σ(硬伤×10 + 可疑×4 + 留意×1)`）只是概览。把"分数高"当成"没问题"是最危险的用法。

## 六种演绎模式

| 模式 | 做什么 | 硬要求 |
|---|---|---|
| 扩写 | 把梗概/片段展开为完整叙事 | 原文结尾状态不变，只填中间空白 |
| 续写 | 从原文结尾之后接着写 | 原文结尾是起点，不得回退或重写 |
| 前传 | 补出导致原文情节的成因 | 终点必须能推出原文起点 |
| 改编 | 保留内核、替换外壳 | 必须列明"保留/替换"；换时代则器物称谓整体对齐 |
| 番外 | 支线人物/平行日常的独立小故事 | 不改变主线事实；番外必须自足 |
| 多线推演 | 一个变量取不同值，推演出多条分支 | 分支之间只许差异一个变量 |

## 人工确认（本技能的关键环节）

第二步**不能跳过**：方案初始为 `pending_confirmation`，`sw weave` 会拒绝未确认的方案并报出原因。

```bash
node scripts/sw.mjs plan --out out              # 产出 confirm-questions.json（ask_user_question 的入参）
node scripts/sw.mjs confirm --answers answers.json --out out   # 把勾选结果写回
node scripts/sw.mjs confirm --mode prequel --scale long \
     --accept ch1,ch2 --reject ch3 --note "ch4=只写一半" --out out
node scripts/sw.mjs confirm --list --out out     # 只看当前状态
```

- 卡片上**未勾选**的修改点按"不改"处理并记录，避免"确认了其实没人看"；
- 每条处置带 `decidedAt`，用户批注进 `userNote`，改动进 `status.history`（含改动前后的值）；
- 方向不对可 `--reject-plan --reason "…"` 打回重做。

## 产物

| 产物 | 内容 |
|---|---|
| `analysis.md/.json` | 分析报告：体裁、标尺、人物、时间线、世界设定、事实锚点、留白点、模式推荐 |
| `plan.md/.json` | 演绎方案：方向、尺度、硬约束、修改点、beat 骨架、确认记录 |
| `<标题>.story.md/.json` | 故事正文 |
| `check.md/.json` | 常识校验报告（逐条带原文出处与修正建议） |
| `<标题>.delivery.md/.html/.pdf` | **交付文档**：正文 + 演绎说明 + 校验报告 |

`sw render` 一次产出 markdown / html / pdf / json 四种格式（HTML 离线可用，无外部资源）。

## 命令一览

```bash
SW=/path/to/story-weave-skill
node "$SW/scripts/sw.mjs" analyze|plan|confirm|weave|check|render|modes|rules|selfcheck
node "$SW/scripts/sw.mjs" all --text "原文…" --out out-try   # 一键试跑（会自动确认，仅供试跑）
node "$SW/scripts/sw.mjs" modes --mode prequel --sections 8   # 看某个模式的完整骨架
node "$SW/scripts/sw.mjs" rules --list --severity blocker     # 看规则
node "$SW/scripts/sw.mjs" rules --terms                       # 术语表
node "$SW/scripts/sw.mjs" selfcheck                           # 自检 76 项
```

`sw check` 有硬伤时退出码为 1，可直接用于脚本判断。

## 开发

```bash
node --test test/*.test.mjs    # 461 个单元测试
node scripts/sw.mjs selfcheck  # 端到端 76 项断言
node scripts/sw.mjs rules      # 规则库结构自检
node examples/run-demo.mjs     # 跑一遍两个示例（现实向 + 架空向）
```

- 文档：[`SKILL.md`](SKILL.md)（技能说明与使用流程）、[`docs/DESIGN.md`](docs/DESIGN.md)（设计取舍）、
  [`docs/NOTES.md`](docs/NOTES.md)（已知边界与误报风险，**接手前建议先读**）、[`docs/SCHEMA.md`](docs/SCHEMA.md)（数据结构）
- 架构：`lib/**` 全为纯函数（无 IO，可测试）；所有读写集中在 `scripts/_io.mjs`；
  `scripts/sw-*.mjs` 既能单独运行，也能被 `scripts/sw.mjs` 复用。

## 已知边界（摘要）

- **多数规则只在单句内取证**，跨句矛盾（上一句"三天没喝水"、下一句"走了三百里"）不会被自动发现
  ——这是为压低误报率做的刻意取舍，这类问题靠模型判断清单项兜住。
- 部分阈值偏保守（长时奔跑上限、汽车均速上限、骨折恢复门槛等），可能对极端人物误报。
- 只校验常识与设定一致性，**不评价文笔与审美**。

详见 [`docs/NOTES.md`](docs/NOTES.md)。

## License

MIT
