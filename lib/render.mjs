/**
 * lib/render.mjs — 产物渲染（纯函数，只返回字符串，不写文件）。
 *
 * 四类产物各有 md/json 两种形式，另有一份合并的"交付文档"用于 html/pdf：
 *   1. analysis  分析报告（看清原文、给出演绎思路）
 *   2. plan      演绎方案（含人工确认记录）
 *   3. story     故事正文
 *   4. check     常识校验报告
 *   5. delivery  交付文档 = 正文 + 演绎说明 + 校验报告（这一份是给人读的）
 *
 * 分工：本模块只生成文本；写文件、调 Chrome 出 PDF 在 scripts 层做。
 */

import { checkReportMarkdown } from './check.mjs';
import { MODE_BY_KEY, SCALE } from './modes.mjs';
import { countChars } from './text.mjs';
import { TERMS } from './terms.mjs';

/* ------------------------------------------------------------------ 公共 */

function h(n, s) {
  return `${'#'.repeat(n)} ${s}`;
}

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function bullet(label, value) {
  return `- **${label}**：${value ?? '—'}`;
}

function table(headers, rows) {
  const L = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) L.push(`| ${r.map(esc).join(' | ')} |`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ 分析报告 */

export function renderAnalysisMd(an, opts = {}) {
  const L = [];
  L.push(h(1, `文本分析报告：${opts.label ?? '输入文本'}`));
  L.push('');
  L.push(`> 分析时间：${an.generatedAt}｜文本指纹：\`${an.source.fingerprint}\`｜共 ${an.source.chars} 字 / ${an.source.paragraphs} 段 / ${an.source.sentences} 句`);
  L.push('');

  L.push(h(2, '一、这是一份什么样的文本'));
  L.push('');
  L.push(table(['维度', '判断', '置信度', '说明'], [
    ['文本类型', an.textType.label, an.textType.confidence, an.textType.note],
    ['体裁', an.genre.label, an.genre.confidence, `识别方式：${identifyByLabel(an.genre.identifiedBy)}`],
    ['叙事完整度', an.textType.completeness, '—', '句子数、对话密度、人物展开程度综合'],
    ['人称', an.narrative.personLabel, '—', `${an.narrative.tenseLabel}；对话占比 ${an.narrative.dialogueRatio}`],
    ['基调', an.narrative.tone.join('、'), '—', '按标点与情绪词粗判'],
    ['年代', an.world.era.label, an.world.era.confidence, `识别方式：${eraByLabel(an.world.era.identifiedBy)}`],
  ]));
  L.push('');
  if (an.genre.signals?.length) {
    L.push('**体裁识别的证据**：');
    L.push('');
    for (const s of an.genre.signals) L.push(`- 第 ${s.line} 行：${s.quote}${s.matched?.length ? `（命中：${s.matched.join('、')}）` : ''}`);
    L.push('');
  }
  if (an.genre.alternates?.length) {
    L.push(`**其它可能体裁**：${an.genre.alternates.map((a) => `${a.label}(${a.score})`).join('、')}`);
    L.push('');
  }
  if (an.genre.conflict) {
    L.push(`> ⚠️ ${an.genre.note}`);
    L.push('');
  }

  L.push(h(2, '二、常识校验标尺（决定后面一切判定的口径）'));
  L.push('');
  L.push(bullet('标尺', an.standard.label));
  L.push(bullet('依据', an.standard.reason));
  L.push(bullet('年代', an.standard.eraNote));
  L.push('');

  L.push(h(2, '三、原文里有什么'));
  L.push('');
  const chars = an.elements.characters ?? [];
  L.push(h(3, '人物'));
  if (chars.length) {
    L.push('');
    L.push(table(['#', '人物', '角色判断', '出现', '台词', '置信度', '依据'], chars.map((c, i) => [
      i + 1, c.name, roleLabel(c.role), c.mentions, c.speechCount, c.confidence, (c.reasons ?? []).join('；'),
    ])));
  } else L.push('\n未能抽取出人物（可能全篇只用代词）。');
  L.push('');

  const tl = an.elements.timeline?.events ?? [];
  L.push(h(3, '时间线'));
  if (tl.length) {
    L.push('');
    L.push(table(['#', '类型', '标记', '所在行', '原文'], tl.slice(0, 30).map((e, i) => [
      i + 1, e.kind === 'duration' ? '时长' : e.kind === 'relative' ? '相对时间' : `绝对时间(${e.subkind})`,
      e.kind === 'duration' ? `${e.when}（${e.hours} 小时）` : e.when, e.line, e.quote,
    ])));
  } else L.push('\n原文没有明确的时间标记。');
  L.push('');

  const places = an.world.places ?? [];
  L.push(h(3, '地点'));
  L.push(places.length ? places.map((p) => `- ${p.name}（${p.kind}，出现 ${p.mentions} 次）`).join('\n') : '未识别出明确地名。');
  L.push('');

  L.push(h(3, '世界设定（作品自己立的规则）'));
  if (an.world.rules?.length) {
    L.push('');
    for (const w of an.world.rules) {
      L.push(`- **[${w.typeLabel}]** 第 ${w.line} 行：${w.statement}${w.subject ? `（主语：${w.subject}）` : ''}`);
    }
  } else L.push('\n未识别到世界设定条目。若是架空作品，请补充"力量边界"，否则无法校验内部一致性。');
  L.push('');

  const facts = (an.facts ?? []);
  L.push(h(3, '事实锚点（演绎不得改写）'));
  if (facts.length) {
    L.push('');
    L.push(table(['类型', '值', '可改写?', '所在行', '原文'], facts.map((f) => [
      f.label, f.value, f.immutable ? '**不可改写**' : '可演进', f.line, f.quote,
    ])));
  } else L.push('\n未识别到写死的事实锚点。');
  L.push('');

  if (an.conflicts?.length) {
    L.push(h(3, '冲突'));
    L.push('');
    for (const c of an.conflicts) L.push(`- ${c.type}（强度 ${c.strength}）：第 ${c.evidence?.[0]?.line ?? '?'} 行 ${c.evidence?.[0]?.quote ?? ''}`);
    L.push('');
  }

  L.push(h(2, '四、可演绎的接口（留白点）'));
  L.push('');
  if (an.gaps?.length) {
    L.push('这些是原文没写、但可以合理补上的地方，是演绎最自然的落点：');
    L.push('');
    L.push(table(['#', '类型', '位置', '留白内容', '为什么可演绎'], an.gaps.map((g, i) => [
      i + 1, g.kindLabel, g.line ? `第 ${g.line} 行` : '—', g.description, g.whyWeavable,
    ])));
  } else L.push('未识别到明显的留白点。');
  L.push('');

  L.push(h(2, '五、演绎思路与方向'));
  L.push('');
  L.push('六种演绎模式的适配度（分数为启发式评估，**仅供参考**，最终由人工在第二步确认）：');
  L.push('');
  L.push(table(['模式', '分数', '支持理由', '风险提示'], an.modeFit.map((m) => [
    m.label, m.score, (m.reasons ?? []).slice(0, 2).join('；') || '—', (m.cautions ?? [])[0] ?? '—',
  ])));
  L.push('');
  L.push(h(3, `推荐：${an.recommendation.modeLabel}`));
  L.push('');
  L.push(`**方向**：${an.recommendation.direction}`);
  L.push('');
  if (an.recommendation.why?.length) {
    L.push('**推荐理由**：');
    for (const r of an.recommendation.why) L.push(`- ${r}`);
    L.push('');
  }
  if (an.recommendation.cautions?.length) {
    L.push('**需要注意**：');
    for (const c of an.recommendation.cautions) L.push(`- ⚠️ ${c}`);
    L.push('');
  }
  if (an.recommendation.alternates?.length) {
    L.push(`**备选模式**：${an.recommendation.alternates.map((a) => `${a.label}(${a.score})`).join('、')}`);
    L.push('');
  }
  L.push(bullet('篇幅建议', `${an.recommendation.scaleSuggest.label}——${an.recommendation.scaleSuggest.reason}`));
  L.push(bullet('第二步需确认', an.recommendation.needConfirm.join('、')));
  L.push('');

  if (an.missing?.length) {
    L.push(h(2, '六、还需要你确认的信息'));
    L.push('');
    L.push('以下信息不足以自动判断，**不会替用户猜**，需要在第二步确认：');
    L.push('');
    for (const m of an.missing) {
      L.push(`- **${m.question}**`);
      L.push(`  - 为什么问：${m.why}`);
      if (m.options?.length) L.push(`  - 可选：${m.options.map((o) => o.label).join(' / ')}`);
      L.push(`  - 当前处理：${m.current ?? '未确定'}`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(`*下一步：执行 \`sw-plan\` 生成演绎方案，再用 \`sw-confirm\` 完成人工确认（确认前不会进入演绎）。*`);
  return L.join('\n');
}

function identifyByLabel(k) {
  return { hint: '用户指定', auto: '自动识别', tier_override: '用户指定标尺', fallback: '证据不足，按较严一侧兜底' }[k] ?? k ?? '—';
}

function eraByLabel(k) {
  return { year: '文本中写明了年份', keyword: '朝代/年代关键词', none: '未指明' }[k] ?? k ?? '—';
}

function roleLabel(r) {
  return {
    'protagonist?': '主角（推测）', 'supporting?': '配角（推测）', 'family?': '亲属（推测）', unknown: '待确认',
    protagonist: '主角', supporting: '配角', family: '亲属',
  }[r] ?? (r ?? '—');
}

/* ------------------------------------------------------------------ 方案 */

export function renderPlanMd(plan, an) {
  const L = [];
  L.push(h(1, `演绎方案：${plan.title}`));
  L.push('');
  L.push(`> 生成时间：${plan.generatedAt}｜状态：**${plan.status.stateLabel}**｜修订 ${plan.status.revision}`);
  L.push('');

  L.push(h(2, '一、方案概要'));
  L.push('');
  L.push(bullet('演绎模式', `${plan.modeLabel}（${plan.modeChosenBy === 'user' ? '人工指定' : '系统推荐'}）——${MODE_BY_KEY[plan.mode]?.short ?? ''}`));
  L.push(bullet('一句话梗概', plan.logline));
  L.push(bullet('篇幅', `${plan.scale.label}：${plan.scale.sections} 节 / 目标 ${plan.scale.targetChars} 字`));
  L.push(bullet('基调', plan.scale.tone));
  L.push(bullet('视角', plan.direction.pov));
  L.push(bullet('结局', plan.direction.endingLabel));
  L.push(bullet('常识标尺', plan.constraints.standard.label));
  L.push('');
  L.push(`**主线**：${plan.direction.mainline}`);
  L.push('');
  L.push(`**主题**：${plan.direction.theme}`);
  L.push('');
  if (plan.direction.subplots?.length) {
    L.push('**支线**：');
    for (const s of plan.direction.subplots) L.push(`- ${s.name}：${s.desc}`);
    L.push('');
  }

  L.push(h(2, '二、硬约束（演绎不得违反）'));
  L.push('');
  L.push(`${plan.constraints.freedomNote}`);
  L.push('');
  L.push(table(['#', '来源', '严重度', '约束内容'], plan.constraints.mustNotViolate.map((k, i) => [
    i + 1, k.source, k.severity, k.statement,
  ])));
  L.push('');

  L.push(h(2, '三、修改点清单（需逐条确认）'));
  L.push('');
  const decided = plan.changes.filter((c) => c.decision !== 'pending').length;
  L.push(`共 ${plan.changes.length} 条，已处置 ${decided} 条。每条都必须有明确处置结果，否则不允许进入演绎。`);
  L.push('');
  L.push(table(['#', '类别', '对象', '原文/现状', '拟改为', '理由', '风险', '处置'], plan.changes.map((c) => [
    c.id, `${c.kind}${c.origin === 'fact' ? '(硬约束)' : ''}`, c.target, c.from, c.to, c.reason, riskLabel(c.risk),
    c.decision === 'pending' ? '⏳ 待定' : `✅ ${c.decisionLabel}${c.userNote ? `（${c.userNote}）` : ''}`,
  ])));
  L.push('');

  L.push(h(2, '四、写作骨架（beat）'));
  L.push('');
  L.push(table(['节', '标题', '目的', '写法'], plan.beats.map((b) => [
    b.index, b.title, b.purpose, b.guidance,
  ])));
  L.push('');

  if (plan.openQuestions?.length) {
    L.push(h(2, '五、待确认事项'));
    L.push('');
    for (const q of plan.openQuestions) L.push(`- ${q.question}${q.why ? `（${q.why}）` : ''}`);
    L.push('');
  }

  if (plan.status.history?.length) {
    L.push(h(2, '六、人工确认记录'));
    L.push('');
    for (const rec of plan.status.history) {
      L.push(`- **${rec.at}** 动作：${rec.action}${rec.applied?.length ? `；采纳的调整：${rec.applied.join('；')}` : ''}`);
      if (rec.acceptedChangeIds?.length) L.push(`  - 同意执行的修改点：${rec.acceptedChangeIds.join('、')}`);
      if (rec.notes) L.push(`  - 批注：${rec.notes}`);
      if (rec.reason) L.push(`  - 驳回原因：${rec.reason}`);
    }
    L.push('');
    if (plan.status.appliedEdits?.length) {
      L.push(`**本次确认对方案的实际改动**：${plan.status.appliedEdits.join('；')}`);
      L.push('');
    }
  } else {
    L.push(h(2, '六、人工确认记录'));
    L.push('');
    L.push('**尚无确认记录。** 演绎不会开始，直到通过 `sw-confirm` 完成确认。');
    L.push('');
  }

  return L.join('\n');
}

function riskLabel(r) {
  return { high: '⚠️ 高', medium: '中', low: '低' }[r] ?? r ?? '—';
}

/* ------------------------------------------------------------------ 正文 */

export function renderStoryMd(story, { analysis, plan } = {}) {
  const L = [];
  L.push(h(1, story.title));
  L.push('');
  const meta = [];
  meta.push(`演绎模式：${story.modeLabel || MODE_BY_KEY[story.mode]?.label || story.mode}`);
  meta.push(`共 ${story.sections.length} 节 / ${story.chars} 字`);
  if (plan) meta.push(`依据方案修订 ${plan.status?.revision ?? '—'}（${plan.status?.stateLabel ?? ''}）`);
  if (analysis) meta.push(`常识标尺：${analysis.standard?.label ?? ''}`);
  L.push(`> ${meta.join('｜')}`);
  L.push('');
  if (plan?.logline) {
    L.push(`> ${plan.logline}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  for (const s of story.sections) {
    L.push(h(2, `${s.index}. ${s.title}`));
    L.push('');
    L.push(s.text);
    L.push('');
  }
  return L.join('\n');
}

/* ------------------------------------------------------------------ 校验报告 */

export function renderCheckMd(report, { analysis, plan, story } = {}) {
  const L = [];
  L.push(h(1, `常识校验报告：${story?.title ?? report.refs.story.title}`));
  L.push('');
  L.push(`> 校验时间：${report.generatedAt}｜对象：${report.refs.story.sections} 节 / ${report.refs.story.chars} 字`);
  L.push('');
  L.push(checkReportMarkdown(report));
  L.push('');
  L.push('---');
  L.push('');
  L.push(h(2, '附：校验范围说明'));
  L.push('');
  L.push(report.coverage.note);
  L.push('');
  L.push(bullet('规则集', `${report.coverage.deterministic.rulesTotal} 条规则，按标尺选中 ${report.coverage.deterministic.rulesSelected} 条，实际执行 ${report.coverage.deterministic.rulesRun} 条，预筛跳过 ${report.coverage.deterministic.rulesSkipped} 条`));
  if (report.coverage.deterministic.internal) {
    const it = report.coverage.deterministic.internal;
    L.push(bullet('内部一致性', `检查事实锚点 ${it.factsChecked} 条、世界设定 ${it.rulesChecked} 条、人工确认的修改点 ${it.changesChecked} 条`));
  }
  L.push(bullet('待判断项', `共 ${report.coverage.modelJudgment.items} 条（已答 ${report.coverage.modelJudgment.answered}、未答 ${report.coverage.modelJudgment.unanswered}）`));
  L.push('');
  L.push('**本报告不评价文笔与审美**，只回答两个问题：① 有没有可计算的常识硬伤；② 作品自己立的设定与原文写死的事实有没有被违反。');
  L.push('');
  L.push(`术语说明：${TERMS.shortDefs}`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ 交付文档 */

/**
 * 合并交付文档：正文在前，其后是演绎说明与校验报告。
 * 这是给 html/pdf 用的那一份。
 */
export function buildDeliveryMarkdown({ analysis, plan, story, check, opts = {} }) {
  const L = [];
  L.push(h(1, `《${story.title}》演绎交付文档`));
  L.push('');
  L.push(`> 由 story-weave 技能生成｜${new Date().toISOString()}`);
  L.push('');

  L.push(h(2, '故事正文'));
  L.push('');
  for (const s of story.sections) {
    L.push(h(3, `${s.index}. ${s.title}`));
    L.push('');
    L.push(s.text);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(h(2, '演绎说明'));
  L.push('');
  L.push(bullet('原文指纹', `\`${analysis?.source?.fingerprint ?? '—'}\`（${analysis?.source?.chars ?? '?'} 字）`));
  L.push(bullet('演绎模式', `${story.modeLabel}（${story.mode}）`));
  L.push(bullet('常识标尺', analysis?.standard?.label ?? '—'));
  L.push(bullet('方案状态', plan ? `${plan.status?.stateLabel ?? '—'}（修订 ${plan.status?.revision ?? '—'}）` : '—'));
  L.push(bullet('篇幅', `${story.sections.length} 节 / ${story.chars} 字`));
  L.push(bullet('落地关系', `正文 ${story.sections.length} 节 vs 方案 ${plan?.beats?.length ?? '?'} beat —— ${story.meta?.alignment ?? '—'}`));
  if (plan?.logline) L.push(bullet('梗概', plan.logline));
  L.push('');

  if (plan?.changes?.length) {
    L.push(h(3, '人工确认的处置结果'));
    L.push('');
    L.push(table(['#', '修改点', '处置', '用户批注'], plan.changes.map((c) => [
      c.id, c.target, c.decisionLabel ?? c.decision, c.userNote || '—',
    ])));
    L.push('');
  }

  if (plan?.constraints?.mustNotViolate?.length) {
    L.push(h(3, '演绎遵守的硬约束'));
    L.push('');
    for (const k of plan.constraints.mustNotViolate) L.push(`- [${k.source}/${k.severity}] ${k.statement}`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(h(2, '常识校验'));
  L.push('');
  L.push(checkReportMarkdown(check));

  return L.join('\n');
}

/* ------------------------------------------------------------------ 索引 */

/** 交付清单（scripts 层据此写文件），返回 [{key, ext, content}] */
export function renderAll({ analysis, plan, story, check }) {
  const out = [];
  if (analysis) {
    out.push({ key: 'analysis', ext: 'md', content: renderAnalysisMd(analysis) });
    out.push({ key: 'analysis', ext: 'json', content: JSON.stringify(analysis, null, 2) });
  }
  if (plan) {
    out.push({ key: 'plan', ext: 'md', content: renderPlanMd(plan, analysis) });
    out.push({ key: 'plan', ext: 'json', content: JSON.stringify(plan, null, 2) });
  }
  if (story) {
    out.push({ key: 'story', ext: 'md', content: renderStoryMd(story, { analysis, plan }) });
    out.push({ key: 'story', ext: 'json', content: JSON.stringify(story, null, 2) });
  }
  if (check) {
    out.push({ key: 'check', ext: 'md', content: renderCheckMd(check, { analysis, plan, story }) });
    out.push({ key: 'check', ext: 'json', content: JSON.stringify(check, null, 2) });
  }
  if (analysis && plan && story && check) {
    const delivery = buildDeliveryMarkdown({ analysis, plan, story, check });
    out.push({ key: 'delivery', ext: 'md', content: delivery });
  }
  return out;
}

export { countChars, SCALE };
