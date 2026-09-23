/**
 * lib/commonsense/internal.mjs — 内部设定一致性与事实不变性校验。纯函数。
 *
 * ## 这是架空标尺（speculative）的核心
 *
 * 面对架空作品，"违反现实常识"可能根本不算错（会飞、能瞬移）。
 * 真正的硬伤是另一类：**违反作品自己立下的规则**，以及**改写原文已写死的事实**。
 *
 * 本模块只做三件能算准的事，其余一律降级为"需模型判断的清单项"：
 *
 *   1. 事实不变性：原文写死的事实（年龄等）在演绎里被改掉 → 确定性报错
 *   2. 设定违反：原文立了「X 不能 Y」，演绎里出现了肯定的 Y → 确定性报错
 *   3. 方案落实：人工确认的修改点与 beat 骨架是否真被执行 → 取证据后交模型判断
 *
 * 不做的事：**不去判断"这段剧情好不好"**。那不是常识问题，是审美问题，
 * 硬塞进"常识错误"报告里会稀释真正硬伤的可信度。
 */

import { clip, hasNegatedMention, isNegated, parseAge } from './kit.mjs';
import { findMatches, quote, segmentsWithAny } from '../text.mjs';
import { normScore } from '../schema.mjs';

/* ------------------------------------------------------------------ 事实不变性 */

/**
 * 检查原文的不可改写事实是否被演绎改掉。
 *
 * ## 为什么不能简单地"出现不同年龄就报错"
 *
 * 原文「哥哥十五岁就离开了家」说的是**离开那一刻**的年龄；
 * 演绎里出现「男性，三十岁上下」说的是**多年后**的年龄。两者完全一致，
 * 但朴素的比较（15 ≠ 30）会把它判成"改写事实"——这属于最伤可信度的一类误报：
 * 报告是以"常识错误"的名义写给作者看的，一旦出现这种误报，所有判定都会被怀疑。
 *
 * 因此判据收窄为**"同一个事件被重述，但值被改了"**：
 *   原文：哥哥十五岁就离开了家
 *   演绎：哥哥十八岁那年离家出走   → 命中（同一件事「离开」，年龄被改）
 *   演绎：男性，三十岁上下          → 不命中（不同事件、不同时间点）
 *
 * 分档：
 *   - 同一事件重述且值不同 → 确定性 finding（高精度）
 *   - 只出现了别的年龄、上下文对不上 → 清单项，交模型/人判断（低精度，不硬判）
 */
export function checkFactInvariance({ story, analysis, ctx }) {
  const findings = [];
  const checklist = [];
  const facts = (analysis?.facts ?? []).filter((f) => f.immutable);

  checkAgeFacts(facts, ctx, findings, checklist);

  // 死亡/重伤类：只取证据，交模型判断（避免同一人判定错误造成误报）
  for (const f of facts.filter((x) => x.kind === 'death' || x.kind === 'injury')) {
    const evidence = ctx.segments
      .filter((s) => s.text.includes(f.value) && !isNegated(s.text, f.value))
      .slice(0, 3)
      .map((s) => ({ segmentId: s.id, line: s.line, quote: clip(s.text, 80) }));
    if (!evidence.length) continue;
    checklist.push({
      id: `q-fact-${f.id}`,
      ruleId: 'FACT-003',
      category: '事实不变性',
      severity: 'blocker',
      question: `原文写死了「${f.label}：${f.value}」（第 ${f.line} 行）。演绎正文里这些提及是否与原文一致（没有把已死的人写活、把重伤写成无恙）？`,
      why: '已发生的死亡/重伤是原文最强的既定事实，改写它会直接与原文冲突。',
      hint: '确认正文中确有该事实的承接，或明确写出"康复/复活"的来由（架空设定需给出代价）。',
      evidence,
      answer: null, verdict: null, note: '',
    });
  }

  return { findings, checklist };
}

/** 年龄类事实的不变性检查（判据见上方注释） */
function checkAgeFacts(facts, ctx, findings, checklist) {
  const origAges = facts
    .filter((f) => f.kind === 'age')
    .map((f) => {
      const age = parseAge(f.value ?? '') ?? parseAge(f.quote ?? '');
      return { ...f, age, hint: contextHint(f, age) };
    })
    .filter((f) => Number.isFinite(f.age));

  if (!origAges.length) return;

  // 正文里出现的所有年龄
  const storyAges = [];
  for (const seg of ctx.segments) {
    const a = parseAge(seg.text);
    if (Number.isFinite(a)) storyAges.push({ age: a, seg });
  }
  if (!storyAges.length) return;

  for (const o of origAges) {
    // ① 原文的年龄被原样复述 → 事实已被承接，其它年龄属别的人物/时间点，不追究
    const restated = storyAges.some((s) => s.age === o.age);

    // ② "同一件事被重述但值不同"：与原文该句共享实词片段
    const sameEvent = storyAges.filter((s) => s.age !== o.age && overlappingBigram(s.seg.text, o.hint));

    if (sameEvent.length) {
      for (const c of sameEvent.slice(0, 2)) {
        findings.push({
          ruleId: 'FACT-002',
          category: '事实不变性',
          title: '原文写死的年龄被改写',
          segmentId: c.seg.id,
          line: c.seg.line,
          quote: clip(c.seg.text, 80),
          severity: 'blocker',
          message: `原文写死「${clip(o.quote, 40)}」（第 ${o.line} 行）为 ${o.age} 岁；此处重述同一件事，却写成 ${c.age} 岁。`,
          suggestion: `改回 ${o.age} 岁；原文写死的事实不得改写，只能补写成因或后果。`,
        });
      }
      continue;
    }

    if (restated) continue;

    // ③ 原文的年龄没被承接、且出现了别的年龄 → 不敢硬判，交模型
    const other = storyAges[0];
    checklist.push({
      id: `q-fact-age-${o.id}`,
      ruleId: 'FACT-004',
      category: '事实不变性',
      severity: 'major',
      question: `原文写死的「${clip(o.quote, 36)}」（第 ${o.line} 行）为 ${o.age} 岁，但正文中没有出现 ${o.age} 岁，而出现了 ${other.age} 岁。演绎是否改写了这个事实？`
        + `（若正文里的 ${other.age} 岁指另一个人物、或指同一人多年之后，请判 pass。）`,
      why: '原文已写死的事实只能补充成因或后果，不得改写。年龄是硬事实，被改动会与原文直接冲突。',
      hint: `在正文中保留一次原文表述（如"${o.age} 岁那年"），或明确说明这是另一个人物/另一个时间点的年龄。`,
      evidence: [{ segmentId: other.seg.id, line: other.seg.line, quote: clip(other.seg.text, 80) }],
      answer: null, verdict: null, note: '',
    });
  }
}

/**
 * 取年龄所在句的"事件线索"：年龄值之后、去掉虚词与标点的实词片段。
 * 「哥哥十五岁就离开了家」→「离开了家」，用于判断演绎是否在讲同一件事。
 */
function contextHint(fact, age) {
  const text = String(fact.value ? `${fact.value}` : '') + ' ' + String(fact.quote ?? '');
  const m = /(?:[0-9]+|[零〇一二三四五六七八九十百]{1,4})\s*(?:岁|周岁)/.exec(text);
  if (!m) return '';
  const after = text.slice(m.index + m[0].length);
  return after.replace(/^[就才便也的了是，、]+/, '').replace(/[，。；：、？！!?,.:;]/g, '').slice(0, 8);
}

/** 两个片段是否共享实词性的 2-gram（用于判断"在讲同一件事"） */
function overlappingBigram(a, b) {
  const hint = String(b ?? '');
  if (hint.length < 2) return false;
  const text = String(a ?? '');
  for (let i = 0; i + 2 <= hint.length; i++) {
    const gram = hint.slice(i, i + 2);
    if (/^(就了|的|一|个|年|岁)/.test(gram)) continue; // 跳过虚词组合
    if (text.includes(gram)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ 设定违反 */

/**
 * 从世界规则里推导"被禁止的行为短语"。
 *
 * 例：「灵根残缺者永不可能结成金丹」→ 禁止短语「结成金丹」
 *     「活人无法穿过结界」        → 禁止短语「穿过结界」
 *
 * 做法：取模态词之后的部分，剥掉否定词，得到"不该发生的事"。
 * 剥不干净就返回 null —— 宁可漏判，不可拿一句含糊的短语去指控作者。
 */
export function deriveForbiddenPhrase(rule) {
  const stmt = String(rule?.statement ?? '');
  const modal = String(rule?.modality ?? '');
  if (!stmt || !modal) return null;
  const idx = stmt.indexOf(modal);
  if (idx < 0) return null;

  let tail = stmt.slice(idx + modal.length);
  // 去掉句末标点与引号
  tail = tail.replace(/[\u201c\u201d\u300c\u300d，。；：、？！!?,.:;\s]/g, '');
  // 剥掉开头的否定/可能词
  tail = tail.replace(/^(可能|能够|可以|会|能|再|够|得)/, '');
  // 尾部的否定词（"…不成"）也去掉
  tail = tail.replace(/(不成|不了|不到|不得|不成)$/, '');
  if (tail.length < 2 || tail.length > 12) return null;
  // 纯否定短语（如"动"）意义太弱
  if (/^[不没无未别莫]/.test(tail)) return null;
  return tail;
}

/**
 * 检查演绎是否违反了原文已立的"禁止/不可能"类设定。
 *
 * 只在**故事里出现了肯定形式的被禁行为**时报错（否定形式如"他没能结成金丹"不算违反）。
 */
export function checkSettingViolations({ story, analysis, ctx }) {
  const findings = [];
  const checklist = [];
  const rules = (analysis?.world?.rules ?? []).filter((r) => r.type === 'cannot');

  for (const rule of rules) {
    const phrase = deriveForbiddenPhrase(rule);
    if (!phrase) {
      // 推不出明确的禁止短语 → 降级为清单项，把设定与可能的正文证据一起交给模型
      const subject = rule.subject || '';
      const hits = subject ? segmentsWithAny(ctx.segments, [subject]) : [];
      checklist.push({
        id: `q-set-${rule.id}`,
        ruleId: 'SET-004',
        category: '内部设定一致性',
        severity: 'blocker',
        question: `原文立下设定「${clip(rule.statement, 60)}」（第 ${rule.line} 行）。演绎正文是否违反了它？`,
        why: '架空向作品的常识以内部设定一致性为准：违反自己立的规则是最明显的错误。',
        hint: '若确需违反，必须在正文中写出"规则为何失效"的代价或条件。',
        evidence: hits.slice(0, 4).map((s) => ({ segmentId: s.id, line: s.line, quote: clip(s.text, 80) })),
        answer: null, verdict: null, note: '',
      });
      continue;
    }

    const hits = findMatches(ctx.segments, phrase, { limit: 20 });
    // 排除被否定的出现（"他没能结成金丹" 不构成违反）
    const violations = hits.filter((h) => {
      const seg = ctx.byId.get(h.segmentId);
      return seg && !isNegated(seg.text, phrase);
    });

    if (violations.length) {
      const first = violations[0];
      const seg = ctx.byId.get(first.segmentId);
      findings.push({
        ruleId: 'SET-001',
        category: '内部设定一致性',
        title: '违反作品已立设定',
        segmentId: first.segmentId,
        line: first.line,
        quote: clip(seg?.text ?? first.snippet, 80),
        severity: 'blocker',
        message: `原文立下设定「${clip(rule.statement, 50)}」（第 ${rule.line} 行），但演绎正文出现了被禁止的「${phrase}」。`,
        suggestion: `要么删改这处（${clip(seg?.text ?? '', 30)}），要么在正文中明确写出该设定为何在此处失效（条件、代价、例外），并保持前后一致。`,
        extras: { ruleId: rule.id, ruleLine: rule.line, ruleStatement: clip(rule.statement, 80), forbiddenPhrase: phrase },
        why: '架空向作品的常识标尺以"作品自己立的规则"为准，违反已立规则与改写事实同属硬伤。',
      });
    }
  }

  // 限制/代价类：无法确定性判定，取证据交模型
  for (const rule of (analysis?.world?.rules ?? []).filter((r) => r.type === 'limit' || r.type === 'cost')) {
    const subject = rule.subject || '';
    const hits = subject ? segmentsWithAny(ctx.segments, [subject]) : [];
    checklist.push({
      id: `q-set-${rule.id}`,
      ruleId: 'SET-005',
      category: '内部设定一致性',
      severity: 'major',
      question: `原文的设定「${clip(rule.statement, 60)}」（${rule.typeLabel}，第 ${rule.line} 行）在演绎中是否被遵守？特别是：代价是否兑现、限制是否被无声突破？`,
      why: `「${rule.typeLabel}」类设定规定了世界的边界与代价。架空作品最常见的硬伤不是"用了超能力"，而是"用了却不必付代价"。`,
      hint: '逐处检查：每次触发该规则时，正文有没有写出对应的限制或代价。',
      evidence: hits.slice(0, 4).map((s) => ({ segmentId: s.id, line: s.line, quote: clip(s.text, 80) })),
      answer: null, verdict: null, note: '',
    });
  }

  return { findings, checklist };
}

/* ------------------------------------------------------------------ 方案落实 */

/**
 * 检查演绎是否按方案执行：
 *   - beat 骨架是否逐节落实（结构性问题，确定性）
 *   - 人工确认的修改点是否落实（语义问题，取证据后交模型）
 */
export function checkPlanAdherence({ story, plan, ctx }) {
  const findings = [];
  const checklist = [];

  // 1) 节数 vs beat 数
  const beats = plan?.beats ?? [];
  const sections = story?.sections ?? [];
  if (beats.length && sections.length !== beats.length) {
    findings.push({
      ruleId: 'PLAN-003',
      category: '方案落实',
      title: '正文节数与方案 beat 数不一致',
      segmentId: sections[0]?.id ?? ctx.segments[0]?.id,
      line: ctx.segments[0]?.line ?? 1,
      quote: clip(sections[0]?.text ?? ctx.text, 60),
      severity: 'minor',
      message: `方案设定了 ${beats.length} 节（beat），实际正文为 ${sections.length} 节。`,
      suggestion: '若刻意合并/拆分，请同步更新方案的 beat 表；否则补齐或删减，使二者一致，便于逐节核对。',
    });
  }

  // 2) 逐 beat 核对（结构上要求 section 与 beat 一一对应）
  if (beats.length && sections.length === beats.length) {
    beats.forEach((b, i) => {
      const sec = sections[i];
      if (!sec) return;
      // 只检查"最后一节必须收在原文落点"这条能算的
      if (i === beats.length - 1 && plan?.invariants?.length) {
        // 留给清单项处理
      }
    });
  }

  // 3) 修改点落实：取正文中与修改点目标相关的片段作为证据
  const accepted = (plan?.changes ?? []).filter((c) => c.decision === 'accept' || c.decision === 'modify');
  for (const c of accepted.slice(0, 8)) {
    const keys = keyTokens(c);
    const hits = keys.length ? segmentsWithAny(ctx.segments, keys).slice(0, 3) : [];
    checklist.push({
      id: `q-ch-${c.id}`,
      ruleId: 'PLAN-001',
      category: '方案落实',
      severity: 'major',
      question: `人工已确认的修改点「[${c.kind}] ${c.target}」是否已在正文中落实？（原定：${clip(c.to, 60)}${c.userNote ? `；用户批注：${clip(c.userNote, 40)}` : ''}）`,
      why: '人工确认的修改点是方案的合同条款。确认了却没落实，等于确认环节失效。',
      hint: '若正文中确实找不到，请补写；若已不再适用，请回到方案把该条改为"不改"并说明原因。',
      evidence: hits.length
        ? hits.map((s) => ({ segmentId: s.id, line: s.line, quote: clip(s.text, 80) }))
        : [{ segmentId: null, line: null, quote: '（正文中未找到与该修改点相关的片段）' }],
      answer: null, verdict: null, note: '',
    });
  }

  // 4) 结局倾向
  if (plan?.direction?.ending === 'maintain' && plan?.analysisRef?.fingerprint) {
    const lastQuote = ctx.analysis?.meta?.lastQuote;
    if (lastQuote) {
      const tailText = sections.slice(-1).map((s) => s.text).join('');
      const overlap = sharedChars(tailText, lastQuote);
      if (overlap === 0) {
        checklist.push({
          id: 'q-ending-maintain',
          ruleId: 'PLAN-002',
          category: '方案落实',
          severity: 'major',
          question: `方案要求"维持原结局"，原文落点为「${lastQuote}」。正文最后一节是否确实收在这个落点上？`,
          why: '选择"维持原结局"却写成别的结局，是演绎与原文最直接的冲突。',
          hint: '让最后一节回到原文的那个画面或状态上。',
          evidence: [{ segmentId: sections[sections.length - 1]?.id ?? null, line: null, quote: clip(tailText, 80) }],
          answer: null, verdict: null, note: '',
        });
      }
    }
  }

  return { findings, checklist };
}

/** 从修改点里抽关键词，用于在正文中定位相关片段 */
function keyTokens(change) {
  const src = `${change.target ?? ''} ${change.to ?? ''}`;
  const words = src
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^(原文|正文|补写|留白|新增|保留|承接|改动|人物|情节|细节|展开|具体|部分|内容)$/.test(w));
  // 取最长的两个词，避免用泛词命中一切
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2);
}

function sharedChars(a, b) {
  const setB = new Set(String(b ?? '').replace(/[\s，。！？、；：""'']/g, ''));
  let n = 0;
  for (const ch of String(a ?? '')) if (setB.has(ch)) n += 1;
  return n;
}

/* ------------------------------------------------------------------ 汇总入口 */

/**
 * 跑全部内部一致性检查。
 * @returns {{findings:Array, checklist:Array, stats:object}}
 */
export function runInternalChecks({ story, analysis, plan, ctx }) {
  const parts = [
    checkFactInvariance({ story, analysis, ctx }),
    checkSettingViolations({ story, analysis, ctx }),
    checkPlanAdherence({ story, plan, ctx }),
  ];

  const findings = parts.flatMap((p) => p.findings);
  const checklist = parts.flatMap((p) => p.checklist);

  return {
    findings,
    checklist,
    stats: {
      factsChecked: (analysis?.facts ?? []).filter((f) => f.immutable).length,
      rulesChecked: (analysis?.world?.rules ?? []).length,
      changesChecked: (plan?.changes ?? []).filter((c) => c.decision === 'accept' || c.decision === 'modify').length,
      bySeverity: findings.reduce((m, f) => { m[f.severity] = (m[f.severity] || 0) + 1; return m; }, { blocker: 0, major: 0, minor: 0 }),
    },
  };
}

export { normScore, quote, hasNegatedMention };
