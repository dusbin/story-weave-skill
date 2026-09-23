# 数据结构契约

四类产物，四份契约，定义在 `lib/schema.mjs`，各自有 `validateXxx()` 校验函数。
**下游模块只认这些字段**；新增字段要同步更新 `SCHEMA.md` 与此处的 shape 定义。

所有产物都带 `schemaVersion` / `kind` / `generator` / `generatedAt`。

---

## 1. `analysis.json` — 第一步

```jsonc
{
  "schemaVersion": "1.0.0",
  "kind": "analysis",
  "source": {
    "kind": "text|file",
    "files": ["examples/sample-input-realistic.md"],
    "chars": 266, "paragraphs": 6, "sentences": 16, "avgSentenceChars": 16,
    "fingerprint": "ce942c5f"          // 原文归一化后的短哈希（忽略空白/标点差异）
  },
  "textType": {                         // 文本类型
    "primary": "narrative_fragment", "label": "叙事片段",
    "confidence": 0.5, "scores": {…},
    "completeness": 0.51                // 叙事完整度：句子数/对话密度/人物展开
  },
  "genre": {
    "primary": "medical", "label": "医疗职场",
    "tier": "realistic|speculative",    // ★ 常识标尺（决定后面一切判定口径）
    "confidence": 0.76,
    "identifiedBy": "auto|hint|tier_override|fallback",
    "conflict": false,                  // 现实/幻想信号并存（穿越重生等）
    "note": "…", "signals": [{ "segmentId","line","quote","matched":[] }],
    "alternates": [{ "key","label","tier","score","matched":[] }],
    "tierScores": { "speculative": 0, "realistic": 8.6 }
  },
  "standard": {                         // 标尺说明（写进报告）
    "tier": "realistic", "label": "现实世界常识标尺",
    "reason": "…", "eraNote": "…"
  },
  "narrative": {
    "person": "third", "personLabel": "第三人称",
    "tense": "past", "tenseLabel": "以过去时感叙述",
    "pov": "限知/全知（需确认）", "tone": ["克制"],
    "dialogueRatio": 0.2, "pronounCounts": { "first": 0, "third": 12 }
  },
  "elements": {
    "characters": [{
      "id": "c1", "name": "林晚",
      "kinds": ["named"],               // named/titled/nickname/kinship/role
      "role": "protagonist?", "isTop": true,   // ★ isTop = 抽取器判定的主角
      "confidence": 0.57, "speechCount": 1, "mentions": 2,
      "reasons": ["姓名 + 对话归属动词"], "evidence": [{ "segmentId","line","quote" }]
    }],
    "timeline": {
      "events": [{
        "id": "t1", "kind": "absolute|relative|duration",
        "subkind": "season|month|daypart|weekday|festival|year|relative|duration",
        "when": "三年前", "offsetDays": -1095, "hours": 6,   // hours 仅 duration
        "order": 2, "segmentId": "s1", "line": 1, "quote": "…"
      }],
      "durations": [ … ], "span": { "minHours": 6, "maxHours": 72 }, "count": 12
    },
    "places": [{ "id": "p1", "name": "中心医院", "kind": "医院", "mentions": 1, "confidence": 0.2, "evidence": [] }],
    "relationships": [{ "type": "母子/母女", "relatedCharacter": "林晚", "confidence": 0.4, "evidence": [] }]
  },
  "world": {
    "tier": "realistic",
    "era": { "label": "当代", "key": "modern", "range": [1949,2035], "year": null,
             "confidence": 0.9, "identifiedBy": "year|keyword|none", "markers": [] },
    "rules": [{                          // ★ 架空向内部一致性的判定基准
      "id": "w1", "statement": "灵力只能从月华中汲取。",
      "type": "cannot|limit|must|cost|mechanic", "typeLabel": "限制",
      "subject": "灵力", "modality": "只能", "segmentId": "s1", "line": 1,
      "confidence": 0.5, "evidence": []
    }],
    "ruleCount": 1,
    "places": [{ "id","name","kind","mentions" }]
  },
  "facts": [{                            // 事实锚点
    "id": "f1", "kind": "death|injury|marriage|age|job|location|weather",
    "label": "年龄", "value": "十五岁",
    "immutable": true,                   // ★ true = 演绎不得改写，会进硬约束
    "segmentId": "s2", "line": 7, "quote": "…", "parsed": { "age": 15 }
  }],
  "conflicts": [{ "type": "人vs人", "strength": 2, "evidence": [] }],
  "gaps": [{                             // 留白点：可演绎的接口
    "id": "g1", "kind": "motive|process|time_jump|ending|character|backstory|detail",
    "kindLabel": "未交代的动机", "description": "…", "whyWeavable": "…",
    "segmentId": "s3", "line": 5, "evidence": []
  }],
  "modeFit": [{                          // 六种模式的适配度（分数降序）
    "mode": "expand", "label": "扩写", "short": "…",
    "score": 0.9, "reasons": ["…"], "cautions": ["…"]
  }],
  "recommendation": {
    "mode": "expand", "modeLabel": "扩写", "score": 0.9,
    "direction": "…", "why": [ … ], "cautions": [ … ],
    "alternates": [{ "mode","label","score" }],
    "needConfirm": ["篇幅（短篇/中篇/长篇节选）", "结局倾向（…）"],   // 第二步必确认项
    "scaleSuggest": { "key": "short", "label": "中篇", "sections": 8, "targetChars": 8000, "reason": "…" }
  },
  "missing": [{                          // ★ 信息不足、需要问用户的事项
    "id": "m-tier", "question": "这篇文本是现实向还是架空？", "why": "…",
    "affects": ["standard"], "options": [{ "value","label" }], "current": "realistic"
  }],
  "meta": { "firstQuote": "…", "lastQuote": "…", "segmentCount": 16, "options": {…} }
}
```

---

## 2. `plan.json` — 第二步

```jsonc
{
  "kind": "plan",
  "analysisRef": { "fingerprint": "ce942c5f", "chars": 266, "genre": "医疗职场", "tier": "realistic" },
  "mode": "expand", "modeLabel": "扩写", "modeChosenBy": "recommendation|user",
  "title": "…", "titleIsPlaceholder": true,
  "logline": "…",
  "direction": {
    "mainline": "…", "subplots": [{ "name","desc","source" }],
    "theme": "…", "ending": "maintain|change|open", "endingLabel": "…",
    "pov": "限知视角",
    "adaptAxis": "…", "spinoffCharacter": "…", "branchVariable": "…", "branches": 2   // 按模式可选
  },
  "scale": { "key": "short", "label": "中篇", "sections": 8, "targetChars": 8000,
             "tone": "克制", "audience": "通用", "desc": "…" },
  "constraints": {                       // ★ 硬约束：会逐条进写作指令与校验基准
    "standard": { "tier": "realistic", "label": "…", "reason": "…" },
    "mustNotViolate": [{
      "id": "k1",
      "statement": "不得改写：年龄「十五岁」",
      "source": "原文事实|世界设定|模式不变量|标尺",
      "ruleRef": "FACT-001|SET-001|SET-002|SET-003|MODE-001|REAL-001",
      "severity": "blocker|major|minor",
      "evidence": []
    }],
    "count": 7, "freedomNote": "…"
  },
  "changes": [{                          // ★ 修改点清单（人工逐条处置）
    "id": "ch1",                         // 稳定 id，确认时靠它回填
    "kind": "承接|改动|新增|删除|保留",
    "target": "人物：林晚、哥哥", "from": "…", "to": "…",
    "reason": "…", "risk": "low|medium|high",
    "origin": "mode|gap|fact|user",
    "decision": "pending|accept|reject|modify",
    "decisionLabel": "待定", "userNote": "", "decidedAt": null
  }],
  "beats": [{                            // ★ 写作骨架（节数 = scale.sections）
    "index": 1, "title": "…", "purpose": "…", "guidance": "…"
  }],
  "openQuestions": [{ "id","question","why","affects","options" }],
  "status": {                            // ★ 确认状态机
    "state": "pending_confirmation|confirmed|confirmed_with_edits",
    "stateLabel": "待人工确认",
    "revision": 1,
    "createdAt": "…", "confirmedAt": null, "confirmedBy": null,
    "userNotes": "",
    "appliedEdits": ["篇幅：中篇 → 短篇"],          // 本次确认对方案的实际改动
    "history": [{ "at","action":"confirm|reject","applied":[],
                  "acceptedChangeIds":[], "rejectedChangeIds":[], "notes":"", "reason":"" }]
  }
}
```

**关键不变量**（`validatePlan` 会强制）

- 每条 `changes[].id` 唯一且非空——确认回填靠它；
- `beats[].index` 唯一且 ≥1；`beats.length === scale.sections`；
- `state` 为 `confirmed*` 时必须带 `confirmedAt`（确认必须留痕）。

---

## 3. `story.json` — 第三步

```jsonc
{
  "kind": "story",
  "title": "切片",
  "mode": "expand", "modeLabel": "扩写",
  "sections": [{
    "id": "s1", "index": 1, "title": "落地：把原文的第一句展开成场景",
    "beatId": 1,                         // 对应 plan.beats[].index
    "text": "…", "chars": 612
  }],
  "text": "…",                           // ★ 必须 === sections[].text 拼接（validateStory 强制）
  "chars": 1924,
  "segments": [{ "id","index","text","start","end","line","isParaStart" }],
  "planRef": { "title","mode","revision","state","beats","confirmedAt" },
  "constraintsRef": { … },               // 方案里的硬约束快照
  "meta": {
    "notes": "", "sectionCount": 4, "beatCount": 4,
    "alignment": "一致"                   // 或 "正文 3 节 ≠ 方案 8 beat"
  }
}
```

**关键不变量**：`text` 必须与 `sections` 拼接结果一致。
否则"校验的正文"与"交付的正文"就是两份东西，校验结论失去意义。
`validateStory` 会显式复核这一条，`sw weave` 在不一致时直接失败。

---

## 4. `check.json` — 第三步验收

```jsonc
{
  "kind": "check",
  "standard": { "tier": "realistic", "label": "…", "reason": "…" },
  "refs": {
    "story": { "title","mode","chars","sections","fingerprint" },
    "plan": { "title","mode","revision","state" },
    "analysis": { "fingerprint","genre" }
  },
  "findings": [{                          // ★ 每条都必须带原文出处
    "ruleId": "PHY-002", "category": "物理与自然", "title": "…",
    "severity": "blocker|major|minor",
    "softenedFrom": null,                 // 架空标尺下降档前的级别
    "segmentId": "s1", "line": 3, "section": 1,
    "quote": "他一口气跑完三百公里，只用了两个小时。",   // 必填
    "message": "此处奔跑 300 公里 / 2 小时，平均 150 km/h，超出人体上限（约 21 km/h）。",
    "suggestion": "…", "why": "…", "extras": null
  }],
  "checklist": [{                         // ★ 需模型/人判断的项（引擎只收窄 + 取证）
    "id": "q-CRAFT-009", "ruleId": "CRAFT-009", "category": "叙事逻辑",
    "severity": "major", "question": "…", "why": "…", "hint": "…",
    "evidence": [{ "segmentId","line","quote" }],   // 候选证据
    "answer": null, "verdict": "pass|fail|na|null", "note": "",
    "citedQuote": "…", "citedLine": 30,   // 模型指明它实际指的是哪一处（可选）
    "answeredAt": null, "answeredBy": null
  }],
  "coverage": {
    "note": "本报告覆盖…**不评价文笔与审美**。",
    "deterministic": { "rulesTotal": 102, "rulesSelected": 102, "rulesRun": 8, "rulesSkipped": 94,
                       "internal": { "factsChecked","rulesChecked","changesChecked","bySeverity" } },
    "modelJudgment": { "items": 13, "answered": 13, "failed": 1, "passed": 12, "na": 0, "unanswered": 0 }
  },
  "summary": {
    "blockers": 0, "majors": 1, "minors": 0, "total": 1, "byCategory": {…},
    "score": 96, "grade": "A", "penalty": 4, "unansweredChecklist": 0,
    "scoreRule": "得分 = 100 − Σ(硬伤×10 + 可疑×4 + 留意×1)，下限 0。**分数仅为概览，结论以 blocker 数为准**。"
  },
  "verdict": "pass|pass_with_warnings|fail",
  "verdictLabel": "通过（有待核对项）",
  "verdictReason": "…"
}
```

### 结论判定（写死在 `decideVerdict`）

| 条件 | verdict |
|---|---|
| `blockers > 0` | `fail` |
| `majors > 0` 或存在未回答的清单项 | `pass_with_warnings` |
| 其余 | `pass` |

### 清单回填

`checklist-template.json` 是待判断项的空白模板：

```jsonc
{
  "note": "把每条 verdict 填成 pass / fail / na 后回填……",
  "answers": [{
    "id": "q-CRAFT-009", "ruleId": "CRAFT-009", "category": "叙事逻辑",
    "question": "…", "why": "…",
    "evidence": [{ "segmentId","line","quote" }],   // 候选证据，仅供参考
    "verdict": "", "note": "",
    "quote": "", "line": ""            // 判 fail 时请填你实际指的那一处原文
  }]
}
```

判定为 `fail` 的项会**转成正式 finding**，并优先采用 `quote` / `line`；
模型没指明时退回候选证据。**没有可核对出处的判定不会进 findings。**

---

## 附：规则对象契约

定义在 `lib/commonsense/engine.mjs`。新增规则必须满足（`sw rules` 会自检）：

```jsonc
{
  "id": "PHY-001",                       // 唯一；前缀须与模块一致
  "title": "人体持续奔跑速度上限",
  "category": "物理与自然",
  "severity": "blocker|major|minor",
  "standard": "real|internal|both",
  "tiers": ["realistic", "speculative"], // 适用标尺
  "overridable": false,                  // ★ 架空设定能否合法覆盖（true 则幻想标尺下降一档）
  "trigger": { "keywords": [], "patterns": [], "mode": "any|all" },   // 预筛
  "why": "为什么这算常识",                 // 报告里给作者看
  "fix": "怎么改",
  "check": "(ctx, hits) => Finding[]",   // 确定性判定
  "ask": "给模型的具体问题"                // 或：转为清单项（二者只能取其一）
}
```

`ctx` 提供：`{ story, analysis, plan, text, segments, byId, tier, world, sectionOf }`。
`hits` 是 trigger 命中的 segment 数组（`{ id, line, text, start, end }`）。

**结构自检会抓**：id 重复 / 前缀不符 / 缺 title·why·fix / severity 非法 /
未声明 `overridable` / `tiers` 为空 / 同时有 `check` 与 `ask` / **既无 `check` 也无 `ask`**
（这类规则永远不会产出任何结果）。
