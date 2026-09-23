/**
 * lib/check.mjs — 第三步的常识校验报告组装。纯函数。
 *
 * 把三路结果合成一份可核对、可追溯的结论：
 *
 *   1. 确定性规则引擎（lib/commonsense/engine.mjs + rules/*）→ findings
 *   2. 内部设定一致性与事实不变性（lib/commonsense/internal.mjs）→ findings + checklist
 *   3. 需模型判断的清单项（checklist）→ 由模型/AI 逐条回答后回填
 *
 * ## 结论口径（写死在代码里，不受模型影响）
 *
 *   - 有 blocker  → fail（**不论分数多高**）
 *   - 有 major 或存在未回答的清单项 → pass_with_warnings
 *   - 其余 → pass
 *
 * 分数只是给人看的概览。把"分数高"当成"没问题"是最危险的用法，
 * 所以 verdict 一律以 blocker 数为准，且在报告里显式说明这条规则。
 */

import { buildRuleContext, runRules, scoreFindings, decideVerdict, sortFindings } from './commonsense/engine.mjs';
import { runInternalChecks } from './commonsense/internal.mjs';
import { CHECK_VERDICTS, SCHEMA_VERSION, SEVERITY_KEYS } from './schema.mjs';
import { uniqBy, shortHash } from './util.mjs';

/* ------------------------------------------------------------------ 汇总 */

/**
 * 构建校验报告。
 * @param {object} p
 * @param {object} p.story
 * @param {object} p.analysis
 * @param {object} p.plan
 * @param {Array}  [p.rules]  规则全集；缺省由调用方传入（避免 lib 层做 IO）
 * @param {object} [p.modelAnswers]  已回填的模型判断 { [checklistId]: {verdict,note,answer} }
 */
export function buildCheckReport({ story, analysis, plan, rules = [], modelAnswers = null } = {}) {
  if (!story) throw new Error('buildCheckReport 需要 story');
  const ctx = buildRuleContext({ story, analysis, plan });

  const engine = runRules({ rules, ctx });
  const internal = runInternalChecks({ story, analysis, plan, ctx });

  // 合并 findings：同一规则在同一段上的重复命中只留一条
  const findings = uniqBy(
    [...engine.findings, ...internal.findings],
    (f) => `${f.ruleId}|${f.segmentId}|${f.message}`,
  );

  // 合并 checklist：同 id 去重
  let checklist = uniqBy([...engine.checklist, ...internal.checklist], (c) => c.id);
  if (modelAnswers) checklist = applyModelAnswers(checklist, modelAnswers);

  // 模型判定为"不通过"的清单项，转成正式 finding（沿用其证据，保证每条都有出处）
  const fromChecklist = materializeFailedChecklist(checklist, ctx);
  const allFindings = sortFindings([...findings, ...fromChecklist]);

  const scored = scoreFindings(allFindings);
  const decided = decideVerdict(allFindings, checklist);

  const byCategory = {};
  for (const f of allFindings) {
    byCategory[f.category] = byCategory[f.category] ?? { blocker: 0, major: 0, minor: 0, total: 0 };
    byCategory[f.category][f.severity] += 1;
    byCategory[f.category].total += 1;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'check',
    generator: 'story-weave',
    generatedAt: new Date().toISOString(),

    standard: {
      tier: analysis?.standard?.tier ?? ctx.tier,
      label: analysis?.standard?.label ?? '',
      reason: analysis?.standard?.reason ?? '',
    },

    refs: {
      story: { title: story.title ?? '', mode: story.mode ?? '', chars: story.chars ?? 0, sections: story.sections?.length ?? 0, fingerprint: shortHash(story.text ?? '') },
      plan: { title: plan?.title ?? '', mode: plan?.mode ?? '', revision: plan?.status?.revision ?? null, state: plan?.status?.state ?? null },
      analysis: { fingerprint: analysis?.source?.fingerprint ?? null, genre: analysis?.genre?.label ?? null },
    },

    findings: allFindings,
    checklist,

    coverage: {
      note: '本报告覆盖两件事：① 可计算的常识硬伤（时长/距离/速度/生理极限/时代错位/数字矛盾）；② 作品自己立下的设定与原文写死的事实是否被违反。它**不评价文笔与审美**。',
      deterministic: {
        rulesTotal: engine.stats.rulesTotal,
        rulesSelected: engine.stats.rulesSelected,
        rulesRun: engine.stats.rulesRun,
        rulesSkipped: engine.stats.rulesSkipped,
        internal: internal.stats,
      },
      modelJudgment: {
        items: checklist.length,
        answered: checklist.filter((c) => c.verdict).length,
        failed: checklist.filter((c) => c.verdict === 'fail').length,
        passed: checklist.filter((c) => c.verdict === 'pass').length,
        na: checklist.filter((c) => c.verdict === 'na').length,
        unanswered: checklist.filter((c) => !c.verdict).length,
      },
    },

    summary: {
      blockers: decided.blockers,
      majors: decided.majors,
      minors: allFindings.filter((f) => f.severity === 'minor').length,
      total: allFindings.length,
      byCategory,
      score: scored.score,
      grade: scored.grade,
      penalty: scored.penalty,
      unansweredChecklist: decided.unanswered,
      scoreRule: '得分 = 100 − Σ(硬伤×10 + 明显可疑×4 + 值得留意×1)，下限 0。**分数仅为概览，结论以 blocker 数为准**。',
    },

    verdict: decided.verdict,
    verdictLabel: CHECK_VERDICTS[decided.verdict],
    verdictReason: explainVerdict(decided),
  };
}

function explainVerdict(d) {
  if (d.verdict === 'fail') return `存在 ${d.blockers} 处硬伤（blocker）。硬伤必须修改后才能交付——即使常识得分很高也不例外。`;
  if (d.verdict === 'pass_with_warnings') {
    const parts = [];
    if (d.majors) parts.push(`${d.majors} 处明显可疑`);
    if (d.unanswered) parts.push(`${d.unanswered} 条待判断项尚未回答`);
    return `没有硬伤，但存在${parts.join('、')}，需人工核对后再定稿。`;
  }
  return '未发现硬伤，也没有待核对项。';
}

/* ------------------------------------------------------------------ 清单回填 */

/** 把模型/人工的判断结果合并进 checklist */
export function applyModelAnswers(checklist, answers) {
  const map = normalizeAnswers(answers);
  return checklist.map((item) => {
    const a = map[item.id];
    if (!a) return item;
    const verdict = ['pass', 'fail', 'na'].includes(a.verdict) ? a.verdict : null;
    return {
      ...item,
      answer: a.answer ?? item.answer ?? null,
      verdict,
      note: a.note ?? item.note ?? '',
      // 模型可以指明"它指的到底是哪一处"。清单项自带的 evidence 是**候选**片段
      // （由关键词触发取得），未必就是问题所在；若模型给了 quote 就以它为准，
      // 否则结论会挂在一条无关的原文上，作者看了会以为报告张冠李戴。
      citedQuote: a.quote ?? null,
      citedLine: Number.isFinite(Number(a.line)) ? Number(a.line) : null,
      answeredAt: a.answeredAt ?? new Date().toISOString(),
      answeredBy: a.answeredBy ?? 'model',
    };
  });
}

/** 兼容多种输入形状：数组 / {answers:{}} / {checklist:[]} */
function normalizeAnswers(answers) {
  if (!answers) return {};
  const out = {};
  const one = (x) => {
    if (x && x.id) out[x.id] = x;
  };
  if (Array.isArray(answers)) answers.forEach(one);
  else if (Array.isArray(answers.answers)) answers.answers.forEach(one);
  else if (Array.isArray(answers.checklist)) answers.checklist.forEach(one);
  else if (typeof answers === 'object') Object.entries(answers).forEach(([k, v]) => { out[k] = { id: k, ...(v ?? {}) }; });
  return out;
}

/**
 * 判定为 fail 的清单项 → 正式 finding（保证有原文出处）。
 *
 * 出处优先用模型自己指明的 `citedQuote`（它知道问题在哪一处）；
 * 模型没指明时才退回清单项自带的候选证据。
 */
export function materializeFailedChecklist(checklist, ctx = null) {
  const out = [];
  for (const item of checklist) {
    if (item.verdict !== 'fail') continue;

    let ev = null;
    if (item.citedQuote) {
      ev = { segmentId: null, line: item.citedLine ?? null, quote: String(item.citedQuote).slice(0, 80) };
      // 能按原文定位就补上 segmentId / 行号
      if (ctx?.segments) {
        const hit = ctx.segments.find((s) => s.text.includes(String(item.citedQuote).slice(0, 12)));
        if (hit) { ev.segmentId = hit.id; ev.line = ev.line ?? hit.line; }
      }
    } else {
      ev = (item.evidence ?? []).find((e) => e.quote && e.quote !== '（正文中未找到与该修改点相关的片段）');
    }
    if (!ev) continue; // 没有可核对出处的判定不进 findings
    out.push({
      ruleId: item.ruleId ?? 'MODEL-001',
      category: item.category ?? '模型判断',
      title: (item.question ?? '').slice(0, 40),
      severity: SEVERITY_KEYS.includes(item.severity) ? item.severity : 'major',
      softenedFrom: null,
      segmentId: ev.segmentId ?? null,
      line: ev.line ?? null,
      section: null,
      quote: ev.quote,
      message: item.note || item.question,
      suggestion: item.hint ?? '',
      why: item.why ?? '',
      extras: { fromChecklist: item.id, modelVerdict: 'fail', citedByModel: Boolean(item.citedQuote) },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 报告文本 */

/** 把报告渲染成 markdown 片段（供 render.mjs 组装完整文档） */
export function checkReportMarkdown(report, { maxFindings = 200 } = {}) {
  const L = [];
  const s = report.summary;

  L.push(`- **结论**：${report.verdictLabel}（${report.verdict}）`);
  L.push(`- **常识标尺**：${report.standard.label}`);
  L.push(`- **常识得分**：${s.score} / 100（等第 ${s.grade}）——${s.scoreRule}`);
  L.push(`- **统计**：硬伤 ${s.blockers} · 明显可疑 ${s.majors} · 值得留意 ${s.minors} · 合计 ${s.total}`);
  L.push(`- **待判断项**：共 ${report.coverage.modelJudgment.items} 条，已答 ${report.coverage.modelJudgment.answered} 条，未答 ${report.coverage.modelJudgment.unanswered} 条`);
  L.push('');
  L.push(`> ${report.verdictReason}`);

  if (report.findings.length) {
    L.push('');
    L.push('### 发现的常识问题');
    L.push('');
    const groups = [['blocker', '硬伤（必须改）'], ['major', '明显可疑（需核对）'], ['minor', '值得留意']];
    for (const [sev, label] of groups) {
      const list = report.findings.filter((f) => f.severity === sev);
      if (!list.length) continue;
      L.push(`#### ${label}（${list.length} 条）`);
      L.push('');
      L.push('| # | 类别 | 位置 | 原文 | 问题 | 建议 |');
      L.push('|---|------|------|------|------|------|');
      list.slice(0, maxFindings).forEach((f, i) => {
        L.push(`| ${i + 1} | ${esc(f.category)} | 第 ${f.line ?? '?'} 行${f.section ? ` / 第 ${f.section} 节` : ''} | ${esc(f.quote)} | ${esc(f.message)} | ${esc(f.suggestion)} |`);
      });
      L.push('');
    }
  }

  const unanswered = report.checklist.filter((c) => !c.verdict);
  if (unanswered.length) {
    L.push('### 待判断项（需模型/人工逐条回答）');
    L.push('');
    L.push(`共 ${unanswered.length} 条。这些是**引擎判不了、必须靠理解语义才能判**的问题，`);
    L.push('已附上原文证据；请在 `sw-check --answers` 中回填 verdict（pass / fail / na）。');
    L.push('');
    unanswered.slice(0, 40).forEach((c, i) => {
      L.push(`**${i + 1}. [${c.category}] ${c.question}**`);
      L.push('');
      L.push(`- 为什么重要：${c.why}`);
      L.push(`- 建议做法：${c.hint}`);
      if (c.evidence?.length) {
        L.push('- 证据：');
        for (const e of c.evidence) L.push(`  - 第 ${e.line ?? '?'} 行：${clipMd(e.quote)}`);
      }
      L.push('');
    });
  }

  const passed = report.checklist.filter((c) => c.verdict === 'pass');
  if (passed.length) {
    L.push('### 已判定通过的检查项');
    L.push('');
    for (const c of passed) L.push(`- ✅ [${c.category}] ${c.question}${c.note ? `（${clipMd(c.note)}）` : ''}`);
    L.push('');
  }

  return L.join('\n');
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function clipMd(s, n = 60) {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n) + '…';
}

export { CHECK_VERDICTS, sortFindings, scoreFindings, decideVerdict };
