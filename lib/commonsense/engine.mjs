/**
 * lib/commonsense/engine.mjs — 常识校验引擎。纯函数（不读文件、不写文件）。
 *
 * ## 分工（本技能的核心设计）
 *
 *   引擎负责「取证与收窄」，模型负责「判定」。
 *
 * 理由：像"她饿了三天还能跑马拉松"这种是**可算的**（时长 vs 生理极限表），
 * 交给引擎算，确定、可复现、可测试；
 * 而"他为什么突然原谅了她"这种是**需理解语义的**，引擎不该硬判——
 * 引擎把它收窄成一条带原文证据的问题，交给模型回答并留痕。
 *
 * 所以引擎输出两样东西：
 *   findings[]   —— 确定性判定出的问题（每条都带原文出处，可核对）
 *   checklist[]  —— 无法确定性判定、需模型判断的检查项（含证据包）
 *
 * ## 规则契约
 *
 *   Rule = {
 *     id:        'PHY-001'                 唯一，前缀表示类别
 *     title:     '人体持续奔跑速度上限'
 *     category:  '物理与自然'
 *     severity:  'blocker' | 'major' | 'minor'
 *     standard:  'real' | 'internal' | 'both'
 *     tiers:     ['realistic'] 或 ['realistic','speculative']
 *     trigger:   { keywords?:[], patterns?:[](RegExp|string), mode?:'any'|'all' }
 *                —— 预筛：命中才跑 check。空 trigger 表示每次都要跑。
 *     why:       '为什么这算常识'      （报告里给作者看）
 *     fix:       '怎么改'              （报告里给作者看）
 *     overridable: true|false          —— 架空设定能否合法覆盖这条
 *                    true  ：设定允许就可以（会飞、瞬移、复活、超前科技）。
 *                            幻想标尺下自动降一档，并提示"改文或补设定"。
 *                    false ：即使架空也成立（人物仍是人类生理、时间算术、逻辑不矛盾）。
 *     check?(ctx, hits) -> Finding[]   —— 有 check：确定性判定
 *     ask?:      '问模型的问题'        —— 无 check：转为 checklist 项
 *   }
 *
 * 按标尺分档的纪律：
 *   现实标尺（realistic）跑全部规则；
 *   幻想标尺（speculative）跑全部规则，但 overridable 的降一档。
 *   这样"架空世界里的飞龙"不会被误报，而"架空世界里的人类饿三天还狂奔"照样被抓住。
 *
 *   Finding = { ruleId, severity, category, title, segmentId, line, quote,
 *               message, suggestion, why, extras? }
 *   **quote 与 line 必填**：没有原文出处的判定不可核对，engine 会丢弃这种命中。
 */

import { scanSegments, indexSegments, findMatches, segmentsWithAny, segmentsWithAll } from '../text.mjs';
import { clip } from './kit.mjs';
import { SEVERITIES, SEVERITY_KEYS, CHECK_VERDICTS, TIER_KEYS } from '../schema.mjs';

/* ------------------------------------------------------------------ 上下文 */

/**
 * 组装规则运行上下文。
 * @param {object} p
 * @param {object} p.story    story.json
 * @param {object} p.analysis analysis.json（决定标尺与已立设定）
 * @param {object} p.plan     plan.json（含人工确认后的约束）
 */
export function buildRuleContext({ story, analysis, plan } = {}) {
  const text = String(story?.text ?? '');
  // 用 text.mjs 的 scanSegments —— 单一事实来源。
  // 曾经这里有一份内联的简易切分，与 text.mjs 的实现（引号感知、行号计算）不一致，
  // 导致"分析时的行号"和"校验时的行号"可能对不上，报告里的定位就不可靠了。
  const segments = Array.isArray(story?.segments) && story.segments.length
    ? story.segments
    : scanSegments(text);

  const tier = analysis?.standard?.tier ?? analysis?.genre?.tier ?? 'realistic';

  return {
    story,
    analysis,
    plan,
    text,
    segments,
    byId: indexSegments(segments),
    tier,
    world: analysis?.world ?? { rules: [] },
    /** 供规则做章节定位：segmentId → 所属 section 序号 */
    sectionOf: buildSectionIndex(story, segments),
  };
}

function buildSectionIndex(story, segments) {
  const map = new Map();
  const sections = Array.isArray(story?.sections) ? story.sections : [];
  let offset = 0;
  for (const sec of sections) {
    const len = String(sec?.text ?? '').length;
    for (const seg of segments) {
      if (seg.start >= offset && seg.start < offset + len + 1) map.set(seg.id, Number(sec?.index) || 0);
    }
    offset += len;
  }
  return map;
}

/* ------------------------------------------------------------------ 规则筛选 */

/** 按标尺筛规则：现实标尺跑 real+both；幻想标尺跑 internal+both 与"现实背景约束"类 */
export function selectRules(rules, { tier = 'realistic' } = {}) {
  const t = TIER_KEYS.includes(tier) ? tier : 'realistic';
  return (rules || []).filter((r) => {
    if (!r || !r.id || typeof r.id !== 'string') return false;
    const tiers = Array.isArray(r.tiers) && r.tiers.length ? r.tiers : ['realistic', 'speculative'];
    return tiers.includes(t);
  });
}

/** 预筛：trigger 命中才进入 check，避免全量规则在大文本上做重活 */
export function prescreen(rule, ctx) {
  const trg = rule?.trigger;
  if (!trg) return { hit: true, hits: [] };

  const keywords = Array.isArray(trg.keywords) ? trg.keywords : [];
  const patterns = Array.isArray(trg.patterns) ? trg.patterns : [];
  const mode = trg.mode === 'all' ? 'all' : 'any';

  if (keywords.length === 0 && patterns.length === 0) return { hit: true, hits: [] };

  const bySeg = new Map();
  const add = (seg) => {
    if (!bySeg.has(seg.id)) bySeg.set(seg.id, seg);
  };

  if (keywords.length) {
    const matched = mode === 'all'
      ? segmentsWithAll(ctx.segments, keywords)
      : segmentsWithAny(ctx.segments, keywords);
    for (const s of matched) add(s);
  }
  if (patterns.length) {
    for (const p of patterns) {
      for (const h of findMatches(ctx.segments, p, { limit: 300 })) {
        const seg = ctx.byId.get(h.segmentId);
        if (seg) add(seg);
      }
    }
  }

  const hits = [...bySeg.values()];
  return { hit: hits.length > 0, hits };
}

/* ------------------------------------------------------------------ Finding */

/** 幻想标尺下对"可被设定合法覆盖"的规则降级一档 */
const SOFTEN = { blocker: 'major', major: 'minor', minor: 'minor' };

/** 规整一条 finding：缺出处的直接丢弃（宁可漏报，不可给出无法核对的指控） */
export function normalizeFinding(raw, rule, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  const seg = raw.segmentId ? ctx.byId.get(raw.segmentId) : null;
  const quoteText = clip(raw.quote ?? seg?.text ?? '', 80);
  if (!quoteText) return null;

  let severity = SEVERITY_KEYS.includes(raw.severity) ? raw.severity : (rule.severity ?? 'major');
  let softenedFrom = null;

  // 幻想/架空设定里，"违反现实常识"可能是设定本身允许的（会飞、能瞬移、死而复生）。
  // 这类规则标 overridable: true —— 不能直接判硬伤，降一档并提示"要么改文，要么补设定"。
  // 相反，人体生理、时间算术这类即使架空也仍成立（人物还是人），标 overridable: false，照原档判。
  if (ctx.tier === 'speculative' && rule.overridable && severity !== 'minor') {
    softenedFrom = severity;
    severity = SOFTEN[severity];
  }

  return {
    ruleId: rule.id,
    category: rule.category ?? '未分类',
    title: rule.title ?? rule.id,
    severity,
    softenedFrom,
    segmentId: raw.segmentId ?? seg?.id ?? null,
    line: Number.isFinite(Number(raw.line)) ? Number(raw.line) : (seg?.line ?? null),
    section: seg ? ctx.sectionOf.get(seg.id) ?? null : null,
    quote: quoteText,
    message: String(raw.message ?? rule.title ?? ''),
    suggestion: String(raw.suggestion ?? rule.fix ?? ''),
    why: String(raw.why ?? rule.why ?? ''),
    extras: raw.extras ?? null,
  };
}

/* ------------------------------------------------------------------ 运行 */

/**
 * 跑全部规则。
 * @returns {{findings:Array, checklist:Array, stats:object}}
 */
export function runRules({ rules, ctx, universe = null, limitPerRule = 40 }) {
  const selected = selectRules(rules, { tier: ctx.tier });
  const allRules = universe ?? selected;
  const findings = [];
  const checklist = [];
  let rulesRun = 0;
  let rulesSkipped = 0;

  for (const rule of selected) {
    const { hit, hits } = prescreen(rule, ctx);

    if (!hit) {
      rulesSkipped++;
      continue;
    }
    rulesRun++;

    if (typeof rule.check === 'function') {
      let out = [];
      try {
        out = rule.check(ctx, hits) ?? [];
      } catch (err) {
        // 规则自身出错不能带崩整份校验报告——记为一条 minor 供排查
        findings.push(normalizeFinding({
          segmentId: hits[0]?.id,
          quote: hits[0]?.text,
          message: `规则 ${rule.id} 执行异常：${err?.message ?? err}`,
          suggestion: '这是引擎问题，请反馈；本条不代表作品有问题。',
        }, { ...rule, severity: 'minor', category: '引擎' }, ctx));
        continue;
      }
      const list = Array.isArray(out) ? out : [out];
      for (const raw of list.slice(0, limitPerRule)) {
        const f = normalizeFinding(raw, rule, ctx);
        if (f) findings.push(f);
      }
      continue;
    }

    // 无 check：转为需模型判断的清单项
    if (rule.ask) {
      checklist.push(makeChecklistItem(rule, ctx, hits));
    }
  }

  return {
    findings,
    checklist,
    stats: {
      rulesTotal: allRules.length,
      rulesSelected: selected.length,
      rulesRun,
      rulesSkipped,
      byCategory: countByCategory(findings),
      bySeverity: countBySeverity(findings),
    },
  };
}

export function makeChecklistItem(rule, ctx, hits = []) {
  const evidence = (hits.length ? hits : ctx.segments).slice(0, 4).map((s) => ({
    segmentId: s.id,
    line: s.line,
    quote: clip(s.text, 80),
  }));
  return {
    id: `q-${rule.id}`,
    ruleId: rule.id,
    category: rule.category ?? '未分类',
    severity: rule.severity ?? 'major',
    question: rule.ask,
    why: rule.why ?? '',
    hint: rule.fix ?? '',
    evidence,
    answer: null,
    verdict: null,
    note: '',
  };
}

function countByCategory(findings) {
  const m = {};
  for (const f of findings) m[f.category] = (m[f.category] || 0) + 1;
  return m;
}

function countBySeverity(findings) {
  const m = { blocker: 0, major: 0, minor: 0 };
  for (const f of findings) if (f.severity in m) m[f.severity] += 1;
  return m;
}

/* ------------------------------------------------------------------ 打分与结论 */

/**
 * 常识得分：满分 100，按严重度扣分。
 * 分数只是给人看的概览，**结论以 blocker 数为准**（分数高但有 blocker 依然是未通过）。
 */
export function scoreFindings(findings) {
  let penalty = 0;
  for (const f of findings) penalty += SEVERITIES[f.severity]?.weight ?? 1;
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 95 ? 'A' : score >= 85 ? 'B' : score >= 70 ? 'C' : score >= 50 ? 'D' : 'F';
  return { score, grade, penalty };
}

/**
 * 结论判定：
 *   - 有 blocker → fail（不论分数）
 *   - 有 major，或存在未回答的清单项 → pass_with_warnings
 *   - 否则 pass
 */
export function decideVerdict(findings, checklist = []) {
  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  const majors = findings.filter((f) => f.severity === 'major').length;
  const unanswered = checklist.filter((c) => !c.verdict).length;
  if (blockers > 0) return { verdict: 'fail', blockers, majors, unanswered };
  if (majors > 0 || unanswered > 0) return { verdict: 'pass_with_warnings', blockers, majors, unanswered };
  return { verdict: 'pass', blockers, majors, unanswered };
}

/** 按严重度 + 行号排序，报告里先看硬伤 */
export function sortFindings(findings) {
  const order = { blocker: 0, major: 1, minor: 2 };
  return [...(findings || [])].sort((a, b) => {
    const d = (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    if (d !== 0) return d;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

export { CHECK_VERDICTS };
