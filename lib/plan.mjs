/**
 * lib/plan.mjs — 第二步：演绎方案 + 人工确认状态机。纯函数。
 *
 * ## 为什么这一步要"停下来等人"
 *
 * 演绎的方向性决策（用什么模式、改哪些点、尺度多大）一旦写错，
 * 第三步写得越流畅、返工成本越高。所以本步骤**默认不进入写作**：
 * 产出 plan.json 后状态是 `pending_confirmation`，必须经过
 * `applyConfirmation()` 把它推进到 `confirmed` / `confirmed_with_edits` 才允许演绎。
 *
 * ## 确认的两条通路（都要留痕）
 *
 *   1. `buildConfirmationQuestions()` → 结构化卡片（ask_user_question 的入参）
 *      —— 让用户在界面上勾选，而不是自己组织语言。
 *   2. `applyConfirmation(plan, answers)` → 把勾选结果**写回 plan.json**
 *      —— 每一步决策都带 decision / userNote / decidedAt，可追溯、可 diff。
 *
 * 只走通路 1 而不落盘，确认过程就没有证据；只走通路 2 则用户要自己打字描述。
 * 两者结合才是完整的确认环节。
 */

import { buildBeats, MODE_BY_KEY, MODE_DEFS, SCALE } from './modes.mjs';
import { PLAN_STATES, SCHEMA_VERSION, validatePlan } from './schema.mjs';
import { safeFilename, uniq, uniqBy } from './util.mjs';
import { normScore } from './schema.mjs';

/* ------------------------------------------------------------------ 构建方案 */

/**
 * 构建演绎方案。
 * @param {object} p
 * @param {object} p.analysis  analysis.json
 * @param {string} [p.mode]    用户指定模式；缺省用 recommendation.mode
 * @param {object} [p.options] { scale, ending, tone, audience, adaptAxis, branchVariable, branches, spinoffCharacter, title, extraChanges }
 */
export function buildPlan({ analysis, mode, options = {} } = {}) {
  const an = analysis;
  if (!an) throw new Error('buildPlan 需要 analysis');

  const modeKey = mode || an.recommendation?.mode || 'expand';
  const def = MODE_BY_KEY[modeKey];
  if (!def) throw new Error(`未知演绎模式：${modeKey}`);

  const scaleKey = options.scale && SCALE[options.scale] ? options.scale : (an.recommendation?.scaleSuggest?.key ?? 'short');
  const scale = { ...SCALE[scaleKey], ...pickScaleOverrides(options) };

  const protagonist = an.elements?.characters?.find((c) => c.isTop)?.name
    ?? an.elements?.characters?.[0]?.name ?? '主角';
  const place = an.world?.places?.[0]?.name ?? '';

  const beatCtx = {
    protagonist,
    place,
    firstQuote: an.meta?.firstQuote ?? '',
    lastQuote: an.meta?.lastQuote ?? '',
    spinoffCharacter: options.spinoffCharacter ?? pickSpinoffCandidate(an) ?? '',
    adaptAxis: options.adaptAxis ?? '',
    branchVariable: options.branchVariable ?? '',
    sections: Number(options.sections) || scale.sections,
  };

  const beats = buildBeats(modeKey, beatCtx);
  if (beats.length !== scale.sections) scale.sections = beats.length; // 保持 consistency

  const changes = buildChanges({ analysis: an, modeKey, options });

  const constraints = buildConstraints({ analysis: an, modeKey, def });

  const plan = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'plan',
    generator: 'story-weave',
    generatedAt: new Date().toISOString(),

    analysisRef: {
      fingerprint: an.source?.fingerprint ?? null,
      chars: an.source?.chars ?? 0,
      genre: an.genre?.label ?? null,
      tier: an.standard?.tier ?? null,
    },

    mode: modeKey,
    modeLabel: def.label,
    modeChosenBy: mode ? 'user' : 'recommendation',

    title: options.title || proposeTitle(an, modeKey, protagonist, place),
    titleIsPlaceholder: !options.title,

    logline: buildLogline(an, modeKey, protagonist, place, scaleKey),

    direction: {
      mainline: options.mainline || buildMainline(an, modeKey, protagonist, place),
      subplots: options.subplots ?? buildSubplots(an, modeKey),
      theme: options.theme || (an.conflicts?.[0] ? `围绕「${an.conflicts[0].type}」的冲突展开` : '（待用户确认主题）'),
      ending: options.ending || 'maintain',
      endingLabel: ENDING_LABELS[options.ending] ?? ENDING_LABELS.maintain,
      pov: options.pov || an.narrative?.pov || '限知视角',
    },

    scale: {
      key: scale.key,
      label: scale.label,
      sections: scale.sections,
      targetChars: scale.targetChars,
      tone: options.tone || (an.narrative?.tone?.join('、') || '克制'),
      audience: options.audience || '通用',
      desc: scale.desc,
    },

    constraints,
    changes,
    beats,

    openQuestions: buildOpenQuestions(an, modeKey, options),

    status: {
      state: 'pending_confirmation',
      stateLabel: PLAN_STATES.pending_confirmation,
      revision: 1,
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      confirmedBy: null,
      history: [],
    },
  };

  return plan;
}

const ENDING_LABELS = {
  maintain: '维持原结局（演绎只补过程，不改落点）',
  change: '改写结局（需在修改点里明确新结局）',
  open: '开放式结局（不给出确定答案）',
};

function pickScaleOverrides(options) {
  const out = {};
  if (Number.isFinite(Number(options.sections))) out.sections = Number(options.sections);
  if (Number.isFinite(Number(options.targetChars))) out.targetChars = Number(options.targetChars);
  return out;
}

function pickSpinoffCandidate(an) {
  const chars = an.elements?.characters ?? [];
  const minor = chars.filter((c) => !c.isTop);
  return minor[0]?.name ?? null;
}

/* ------------------------------------------------------------------ 标题/梗概 */

function proposeTitle(an, modeKey, protagonist, place) {
  const base = an.conflicts?.[0] ? '' : '';
  const seeds = {
    expand: `${protagonist}的${place || '这一夜'}`,
    continue: `此后：${protagonist}`,
    prequel: `${protagonist}的来路`,
    adapt: `另一次${protagonist}`,
    spinoff: `${place || protagonist}的寻常一日`,
    whatif: `如果那一刻不同`,
  };
  return (seeds[modeKey] ?? `${protagonist}的故事`) + base;
}

function buildLogline(an, modeKey, protagonist, place, scaleKey) {
  const conflict = an.conflicts?.[0]?.type ?? '未明确的冲突';
  const gap = an.gaps?.[0]?.description ?? '原文的留白';
  const verbs = {
    expand: `把原文的片段展开为完整叙事：补足${gap}，保持原结局不变`,
    continue: `从原文结尾继续推进：写清后续因果，主角为${protagonist}`,
    prequel: `回溯${protagonist}走到今天的成因，终点必须接上原文起点`,
    adapt: `保留原文内核、替换外壳后重述${protagonist}的故事`,
    spinoff: `以配角为中心的独立小故事，不干扰主线事实`,
    whatif: `改变一个变量，推演出与原文不同的分支并对比`,
  };
  return `${verbs[modeKey] ?? '演绎原文'}。核心冲突：${conflict}。篇幅：${SCALE[scaleKey]?.label ?? scaleKey}。`;
}

function buildMainline(an, modeKey, protagonist, place) {
  const t = an.elements?.timeline?.events?.find((e) => e.kind === 'relative' || e.kind === 'absolute');
  const when = t ? `（起于「${t.when}」）` : '';
  return `${protagonist}在${place || '原文场景'}${when}：${MODE_BY_KEY[modeKey]?.short ?? ''}`;
}

function buildSubplots(an, modeKey) {
  const out = [];
  const gaps = an.gaps ?? [];
  const backstory = gaps.find((g) => g.kind === 'backstory');
  if (backstory) out.push({ name: '过往线', desc: backstory.description, source: backstory.id });
  const chars = (an.elements?.characters ?? []).filter((c) => !c.isTop);
  if (chars.length) out.push({ name: '配角线', desc: `${chars.slice(0, 3).map((c) => c.name).join('、')} 的处境与选择`, source: 'characters' });
  if (modeKey === 'whatif') out.push({ name: '对照线', desc: '同一人物在不同分支下的差异', source: 'mode' });
  return out;
}

/* ------------------------------------------------------------------ 修改点 */

/**
 * 生成修改点清单。
 * 每条都要能被人工逐条处置（accept / reject / modify），因此必须有稳定 id。
 */
export function buildChanges({ analysis, modeKey, options = {} }) {
  const def = MODE_BY_KEY[modeKey];
  const proposed = def?.proposeChanges ? def.proposeChanges(analysis) : [];
  const changes = [];
  let n = 0;

  const add = (c, origin) => {
    changes.push({
      id: `ch${++n}`,
      kind: c.kind ?? '改动',
      target: c.target ?? '',
      from: c.from ?? '',
      to: c.to ?? '',
      reason: c.reason ?? '',
      risk: c.risk ?? 'medium',
      origin,
      decision: 'pending',
      decisionLabel: '待定',
      userNote: '',
      decidedAt: null,
    });
  };

  proposed.forEach((c) => add(c, 'mode'));

  // 从留白点补充"可演绎点"（这些是原文自己的接口，优先级高）
  for (const g of (analysis.gaps ?? []).slice(0, 4)) {
    add({
      kind: '新增',
      target: `留白：${g.description}`,
      from: `原文未交代（第 ${g.line ?? '?'} 行）`,
      to: g.whyWeavable ?? '展开为具体情节',
      reason: '这是原文自身的接口，演绎最容易自然衔接',
      risk: 'low',
    }, 'gap');
  }

  // 从不可改写的事实补充"硬约束"条目（不是要改，而是明确不动）
  const immutable = (analysis.facts ?? []).filter((f) => f.immutable);
  for (const f of immutable.slice(0, 5)) {
    add({
      kind: '保留',
      target: `既有事实：${f.label}「${f.value}」`,
      from: `原文第 ${f.line} 行`,
      to: '保持不变（演绎不得改写）',
      reason: '这是原文写死的强事实，改写会让演绎与原文冲突',
      risk: 'low',
    }, 'fact');
  }

  // 用户额外提出的修改点
  for (const c of options.extraChanges ?? []) add(c, 'user');

  // 去重键用 target 去掉前缀类别后的部分：同一处留白可能既被模式提案提到、
  // 又被留白点识别到（"补写：X" vs "留白：X"），按前缀去重会漏掉这对重复。
  return uniqBy(changes, (c) => `${c.kind}|${String(c.target).replace(/^[^：]*：/, '')}`);
}

/* ------------------------------------------------------------------ 约束 */

/**
 * 构建硬约束表：演绎过程中**不得违反**的条目。
 * 这些条目会逐条进入第三步的常识校验（内部设定一致性 + 事实不变性）。
 */
export function buildConstraints({ analysis, modeKey, def }) {
  const mustNotViolate = [];
  let n = 0;

  const push = (statement, source, ruleRef, severity, evidence) => {
    mustNotViolate.push({ id: `k${++n}`, statement, source, ruleRef, severity, evidence: evidence ?? [] });
  };

  // 1) 原文写死的事实
  for (const f of (analysis.facts ?? []).filter((x) => x.immutable)) {
    push(`不得改写：${f.label}「${f.value}」`, '原文事实', 'FACT-001', 'blocker', f.evidence ?? [{ segmentId: f.segmentId, line: f.line, quote: f.quote }]);
  }

  // 2) 作品自己立下的世界规则
  for (const w of analysis.world?.rules ?? []) {
    push(`不得违反已立设定（${w.typeLabel}）：${w.statement}`, '世界设定', 'SET-001', w.type === 'cannot' ? 'blocker' : 'major', w.evidence ?? []);
  }

  // 3) 模式自身的不变量
  for (const inv of def?.invariants ?? []) {
    push(inv, '模式不变量', 'MODE-001', 'major', []);
  }

  // 4) 标尺说明：架空向作品的"现实背景约束"
  const tier = analysis.standard?.tier ?? 'realistic';
  if (tier === 'speculative') {
    push('人物仍按真人判：会饿、会累、会失血、会死——除非设定明确说明其非人。', '标尺', 'SET-002', 'blocker', []);
    push('架空设定本身不算错误，但**作品自己立的规则、代价与限制不可违反**。', '标尺', 'SET-003', 'blocker', []);
  } else {
    push('现实世界常识为准：物理、生理、时间、社会制度上的明确违反即为硬伤。', '标尺', 'REAL-001', 'blocker', []);
  }

  return {
    standard: {
      tier,
      label: analysis.standard?.label ?? '',
      reason: analysis.standard?.reason ?? '',
    },
    mustNotViolate,
    count: mustNotViolate.length,
    freedomNote: tier === 'speculative'
      ? '在设定允许的范围内可以自由发挥（能力、科技、种族皆可），但代价与限制必须兑现。'
      : '整体受现实约束，没有"设定允许"的例外空间。',
  };
}

/* ------------------------------------------------------------------ 待确认问题 */

function buildOpenQuestions(an, modeKey, options) {
  const qs = [];
  if (!options.title) qs.push({ id: 'q-title', question: '作品标题：当前为占位标题，是否沿用或另拟？', affects: ['title'] });
  if (!options.ending) qs.push({ id: 'q-ending', question: '结局倾向（维持/改写/开放式）？', affects: ['direction.ending'] });
  if (modeKey === 'whatif' && !options.branchVariable) qs.push({ id: 'q-branch', question: '分叉点与变量是什么？', affects: ['beats'] });
  if (modeKey === 'adapt' && !options.adaptAxis) qs.push({ id: 'q-axis', question: '替换轴：换视角/换时代/换结局/换体裁？', affects: ['beats'] });
  if (modeKey === 'spinoff' && !pickSpinoffCandidate(an)) qs.push({ id: 'q-spinoff', question: '番外主角是谁？', affects: ['beats'] });
  for (const m of an.missing ?? []) qs.push({ id: m.id, question: m.question, why: m.why, affects: m.affects, options: m.options });
  return qs;
}

/* ------------------------------------------------------------------ 确认卡片 */

/**
 * 生成结构化确认问题（ask_user_question 的入参格式）。
 * 这样"人工确认"是在界面上勾选，而不是让用户自己组织语言。
 */
export function buildConfirmationQuestions(plan, analysis) {
  const questions = [];

  // Q1 模式（推荐项在前）
  const recommended = analysis?.recommendation?.mode ?? plan.mode;
  const modeOptions = MODE_DEFS.map((m) => ({
    label: m.key === plan.mode ? `${m.label}（当前方案${m.key === recommended ? '，推荐' : ''}）` : m.label,
    description: m.short,
    value: m.key,
  }));
  // 推荐项置顶
  modeOptions.sort((a, b) => (a.value === recommended ? -1 : b.value === recommended ? 1 : 0));
  questions.push({
    id: 'mode',
    header: '演绎模式',
    question: '确认演绎模式（决定第三步的写作骨架）：',
    options: modeOptions.slice(0, 5),
    multi_select: false,
  });

  // Q2 篇幅
  questions.push({
    id: 'scale',
    header: '篇幅',
    question: '本次演绎的篇幅：',
    options: [
      { label: `中篇（8 节 / 约 8000 字）（当前方案）`, description: SCALE.short.desc, value: 'short' },
      { label: '短篇（4 节 / 约 3000 字）', description: SCALE.flash.desc, value: 'flash' },
      { label: '长篇节选（16 节 / 约 20000 字）', description: SCALE.long.desc, value: 'long' },
    ],
    multi_select: false,
  });

  // Q3 结局倾向
  questions.push({
    id: 'ending',
    header: '结局倾向',
    question: '结局怎么处理？',
    options: [
      { label: '维持原结局（推荐）', description: '演绎只补过程，不改落点——与原文冲突最小', value: 'maintain' },
      { label: '改写结局', description: '需在同批修改点里明确新结局是什么', value: 'change' },
      { label: '开放式结局', description: '不给出确定答案，留白收尾', value: 'open' },
    ],
    multi_select: false,
  });

  // Q4 修改点批量勾选（multi_select）
  const decidable = plan.changes.filter((c) => c.decision === 'pending');
  if (decidable.length) {
    questions.push({
      id: 'changes_accept',
      header: '修改点',
      question: `以下 ${decidable.length} 个修改点，哪些同意照此执行？（未勾选的默认"不改"，逐条批注请用 sw-confirm --note）`,
      options: decidable.slice(0, 6).map((c) => ({
        label: `[${c.kind}] ${truncate(c.target, 40)}`,
        description: `${truncate(c.from, 24)} → ${truncate(c.to, 40)}｜${c.risk === 'high' ? '⚠️ 高风险' : c.risk === 'medium' ? '中风险' : '低风险'}`,
        value: c.id,
      })),
      multi_select: true,
    });
  }

  // Q5 标尺确认（仅当分析阶段不确定时）
  const tierMissing = (analysis?.missing ?? []).find((m) => m.id === 'm-tier');
  if (tierMissing) {
    questions.push({
      id: 'tier',
      header: '常识标尺',
      question: `未能确定常识标尺（当前按「${analysis.standard?.label}」处理）。请确认：`,
      options: [
        { label: '现实向：严守现实世界常识', description: '物理/生理/时间/制度上的明确违反都算硬伤', value: 'realistic' },
        { label: '架空向：以作品内部设定一致性为主', description: '设定本身不算错，但不得违反自己立的规则与代价', value: 'speculative' },
      ],
      multi_select: false,
    });
  }

  return questions;
}

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

/* ------------------------------------------------------------------ 确认回填 */

/**
 * 把人工确认结果写回方案，并推进状态机。
 *
 * @param {object} plan
 * @param {object} answers
 *    {
 *      mode, scale, ending, adaptAxis, branchVariable, branches, spinoffCharacter, title,
 *      tier,                       // 可能修正分析阶段的标尺
 *      acceptedChangeIds: [],      // 卡片上勾选的修改点
 *      rejectedChangeIds: [],
 *      changeNotes: { ch1: '这里改成……' },
 *      notes: '',                  // 自由批注
 *      confirmedBy: 'user',
 *    }
 * @param {object} [analysis]  传入则按新答案重算 beats / constraints
 */
export function applyConfirmation(plan, answers = {}, analysis = null) {
  const p = clone(plan);
  const applied = [];

  // 【坑 1】desc 必须是"函数"而不是字符串。
  // 函数实参在调用前就会被求值，所以写成 `setIf(cond, \`…${SCALE[answers.scale].label}\`, fn)`
  // 时，即使 cond 为假，描述串也已经算过了——answers.scale 为 undefined 时直接抛
  // TypeError，把"没传这个参数"变成"崩溃"。
  // 【坑 2】desc 必须在 fn() **之前**求值。
  // 之前先跑 fn() 再取描述，于是描述读到的是改完之后的值：
  // 「篇幅：中篇 → 短篇」被记成「篇幅：短篇 → 短篇」——留痕写成了一句废话，
  // 而"确认记录可追溯"正是这一步存在的理由。
  const setIf = (cond, desc, fn) => {
    if (!cond) return;
    const line = typeof desc === 'function' ? desc() : desc;
    fn();
    applied.push(line);
  };

  setIf(answers.mode && answers.mode !== p.mode, () => `模式：${p.mode} → ${answers.mode}`, () => {
    p.mode = answers.mode;
    p.modeLabel = MODE_BY_KEY[answers.mode]?.label ?? answers.mode;
    p.modeChosenBy = 'user';
  });

  setIf(answers.scale && SCALE[answers.scale] && answers.scale !== p.scale.key, () => `篇幅：${p.scale.label} → ${SCALE[answers.scale].label}`, () => {
    p.scale = { ...p.scale, ...SCALE[answers.scale] };
  });

  setIf(answers.ending && answers.ending !== p.direction.ending, () => `结局：${p.direction.endingLabel} → ${ENDING_LABELS[answers.ending]}`, () => {
    p.direction.ending = answers.ending;
    p.direction.endingLabel = ENDING_LABELS[answers.ending];
  });

  setIf(answers.title && answers.title !== p.title, () => `标题：${p.title} → ${answers.title}`, () => {
    p.title = answers.title;
    p.titleIsPlaceholder = false;
  });

  if (answers.adaptAxis) { p.direction.adaptAxis = answers.adaptAxis; applied.push(`替换轴：${answers.adaptAxis}`); }
  if (answers.spinoffCharacter) { p.direction.spinoffCharacter = answers.spinoffCharacter; applied.push(`番外主角：${answers.spinoffCharacter}`); }
  if (answers.branchVariable) { p.direction.branchVariable = answers.branchVariable; applied.push(`分叉变量：${answers.branchVariable}`); }
  if (answers.branches) { p.direction.branches = Number(answers.branches); applied.push(`分支数：${answers.branches}`); }

  // 修改点逐条处置
  const accepted = new Set(answers.acceptedChangeIds ?? []);
  const rejected = new Set(answers.rejectedChangeIds ?? []);
  const notes = answers.changeNotes ?? {};

  for (const c of p.changes) {
    if (accepted.has(c.id)) {
      c.decision = notes[c.id] ? 'modify' : 'accept';
      c.decisionLabel = notes[c.id] ? '按用户说明改' : '照此修改';
      c.decidedAt = new Date().toISOString();
      if (notes[c.id]) c.userNote = notes[c.id];
    } else if (rejected.has(c.id)) {
      c.decision = 'reject';
      c.decisionLabel = '不改（保留原文）';
      c.decidedAt = new Date().toISOString();
      if (notes[c.id]) c.userNote = notes[c.id];
    } else if (notes[c.id]) {
      c.decision = 'modify';
      c.decisionLabel = '按用户说明改';
      c.userNote = notes[c.id];
      c.decidedAt = new Date().toISOString();
    } else if (c.origin === 'fact') {
      // 硬约束默认保留：它本来就不是"要改的东西"
      c.decision = 'accept';
      c.decisionLabel = '保持不变';
      c.decidedAt = new Date().toISOString();
    } else if (c.decision === 'pending') {
      c.decision = 'reject'; // 卡片上未勾选 = 不改
      c.decisionLabel = '未勾选，按不改处理';
      c.decidedAt = new Date().toISOString();
    }
  }

  // 按新答案重算骨架与约束
  const beatCtx = {
    protagonist: analysis?.elements?.characters?.find((c) => c.isTop)?.name ?? '主角',
    place: analysis?.world?.places?.[0]?.name ?? '',
    firstQuote: analysis?.meta?.firstQuote ?? '',
    lastQuote: analysis?.meta?.lastQuote ?? '',
    spinoffCharacter: p.direction.spinoffCharacter ?? '',
    adaptAxis: p.direction.adaptAxis ?? '',
    branchVariable: p.direction.branchVariable ?? '',
    sections: p.scale.sections,
  };
  p.beats = buildBeats(p.mode, beatCtx);
  p.scale.sections = p.beats.length;

  if (analysis) {
    const def = MODE_BY_KEY[p.mode];
    p.constraints = buildConstraints({ analysis, modeKey: p.mode, def });
  }

  // 状态判定：用户是否真的改动了方案
  const edited = applied.length > 0 || Object.keys(notes).length > 0;
  p.status = {
    ...p.status,
    state: edited ? 'confirmed_with_edits' : 'confirmed',
    stateLabel: PLAN_STATES[edited ? 'confirmed_with_edits' : 'confirmed'],
    revision: (p.status?.revision ?? 1) + 1,
    confirmedAt: new Date().toISOString(),
    confirmedBy: answers.confirmedBy ?? 'user',
    userNotes: answers.notes ?? p.status?.userNotes ?? '',
    appliedEdits: applied,
    history: [
      ...(p.status?.history ?? []),
      {
        at: new Date().toISOString(),
        action: 'confirm',
        applied,
        acceptedChangeIds: [...accepted],
        rejectedChangeIds: [...rejected],
        notes: answers.notes ?? '',
        mode: p.mode,
        scale: p.scale.key,
        ending: p.direction.ending,
      },
    ],
  };

  return p;
}

/** 人工驳回：回到待确认，或要求重做方案 */
export function rejectPlan(plan, reason = '') {
  const p = clone(plan);
  p.status = {
    ...p.status,
    state: 'pending_confirmation',
    stateLabel: PLAN_STATES.pending_confirmation,
    revision: (p.status?.revision ?? 1) + 1,
    history: [...(p.status?.history ?? []), { at: new Date().toISOString(), action: 'reject', reason }],
    rejectedReason: reason,
  };
  for (const c of p.changes) if (c.decision !== 'pending') { c.decision = 'pending'; c.decisionLabel = '待定'; }
  return p;
}

/** 方案是否已解锁演绎 */
export function isWeavable(plan) {
  const st = plan?.status?.state;
  return st === 'confirmed' || st === 'confirmed_with_edits';
}

/** 演绎前的严格校验：返回阻止演绎的原因列表 */
export function weavabilityIssues(plan) {
  const issues = [];
  if (!plan) return ['没有方案'];
  if (!isWeavable(plan)) {
    issues.push(`方案状态为「${PLAN_STATES[plan.status?.state] ?? plan.status?.state}」，尚未经人工确认——请先执行 sw-confirm`);
  }
  const shapeErrs = validatePlan(plan);
  issues.push(...shapeErrs.map((e) => `方案结构问题：${e}`));
  if (!plan.beats?.length) issues.push('方案没有 beat（写作骨架），无法演绎');
  const pendingChanges = (plan.changes ?? []).filter((c) => c.decision === 'pending');
  if (pendingChanges.length) issues.push(`仍有 ${pendingChanges.length} 个修改点未处置（${pendingChanges.map((c) => c.id).join('、')}）`);
  if (plan.mode === 'whatif' && !plan.direction?.branchVariable) {
    issues.push('多线推演缺少「分叉变量」，无法确定各分支的差异来源');
  }
  if (plan.mode === 'adapt' && !plan.direction?.adaptAxis) {
    issues.push('改编缺少「替换轴」，无法确定改什么、留什么');
  }
  return issues;
}

/** 输出文件名（中文标题安全化） */
export function planFilename(plan, ext = 'json') {
  return `${safeFilename(plan.title || '未命名', 'story')}.plan.${ext}`;
}

/** 摘要文本，供 CLI 打印与报告引用 */
export function summarizePlan(plan) {
  const lines = [];
  lines.push(`模式：${plan.modeLabel}（${MODES_LABEL[plan.mode] ?? ''}）`);
  lines.push(`标题：${plan.title}${plan.titleIsPlaceholder ? '（占位，待用户确认）' : ''}`);
  lines.push(`篇幅：${plan.scale.label} / ${plan.scale.sections} 节 / 目标 ${plan.scale.targetChars} 字`);
  lines.push(`结局：${plan.direction.endingLabel}`);
  lines.push(`修改点：${plan.changes.length} 条（已处置 ${plan.changes.filter((c) => c.decision !== 'pending').length} 条）`);
  lines.push(`硬约束：${plan.constraints.count} 条`);
  lines.push(`状态：${plan.status.stateLabel}`);
  return lines.join('\n');
}

const MODES_LABEL = Object.fromEntries(MODE_DEFS.map((m) => [m.key, m.short]));

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export { MODE_DEFS, SCALE, PLAN_STATES, uniq, normScore };
