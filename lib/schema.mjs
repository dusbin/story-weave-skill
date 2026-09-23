/**
 * lib/schema.mjs — 数据结构契约与校验。纯函数。
 *
 * 三类产物，三份契约：
 *   analysis.json  第一步：看清原文（含常识标尺判定与留白点）
 *   plan.json      第二步：演绎方案 + 修改点 + 人工确认状态机
 *   story.json     第三步：演绎正文
 *   check.json     常识校验报告
 *
 * 校验原则：**只挡会真的把下游带错的错误**，不做无意义的字段洁癖。
 * 因为产物要经人工勾选与模型写作来回传递，宽容读入 + 严格校验关键字段。
 */

import { checkShape, isObj, isStr, trim } from './util.mjs';

export const SCHEMA_VERSION = '1.0.0';

/* ------------------------------------------------------------------ 枚举 */

/** 六种演绎模式 */
export const MODES = {
  expand: { key: 'expand', label: '扩写', short: '把梗概/片段展开成完整叙事' },
  continue: { key: 'continue', label: '续写', short: '从原文结尾之后接着写' },
  prequel: { key: 'prequel', label: '前传', short: '补出导致原文情节的成因' },
  adapt: { key: 'adapt', label: '改编', short: '保留内核、替换外壳（视角/时代/结局/体裁）' },
  spinoff: { key: 'spinoff', label: '番外', short: '支线人物或平行日常的独立小故事' },
  whatif: { key: 'whatif', label: '多线推演', short: '一个变量取不同值，推演出多条分支' },
};

export const MODE_KEYS = Object.keys(MODES);

/** 常识标尺：现实向严守现实世界常识；幻想向以"内部设定一致性"为主 */
export const TIERS = {
  realistic: { key: 'realistic', label: '现实世界常识标尺', desc: '以现实世界的物理/生理/时间/社会制度为准。违反即为常识性错误。' },
  speculative: { key: 'speculative', label: '内部设定一致性标尺', desc: '架空设定本身不算错误，但必须遵守作品已立的规则、代价与限制；现实常识作为背景约束（如人物仍是人类生理）。' },
};

export const TIER_KEYS = Object.keys(TIERS);

/** finding 严重度 */
export const SEVERITIES = {
  blocker: { key: 'blocker', label: '硬伤', weight: 10, desc: '明确违反常识或已立设定，必须改。' },
  major: { key: 'major', label: '明显可疑', weight: 4, desc: '大概率有问题，需作者确认或补交代。' },
  minor: { key: 'minor', label: '值得留意', weight: 1, desc: '可能无碍，但建议核对。' },
};

export const SEVERITY_KEYS = Object.keys(SEVERITIES);

/** plan 的确认状态机 */
export const PLAN_STATES = {
  pending_confirmation: '待人工确认',
  confirmed: '已确认，可演绎',
  confirmed_with_edits: '已确认（含人工修改），可演绎',
  rejected: '已驳回，需重做方案',
};

export const PLAN_STATE_KEYS = Object.keys(PLAN_STATES);

/** 修改点的处置结果 */
export const CHANGE_DECISIONS = {
  pending: '待定',
  accept: '照此修改',
  reject: '不改（保留原文）',
  modify: '按用户说明改',
};

/** 留白点类型：可被演绎"填"进去的接口 */
export const GAP_KINDS = {
  motive: '未交代的动机',
  process: '被省略的过程',
  time_jump: '跳跃的时间',
  ending: '未收束的结局',
  character: '未登场/未展开的人物',
  backstory: '未展开的过往',
  detail: '缺失的细节',
};

/** 校验结论 */
export const CHECK_VERDICTS = {
  pass: '通过',
  pass_with_warnings: '通过（有待核对项）',
  fail: '未通过，需返工',
};

/** 演绎方向里"用户可调的尺度" */
export const SCALE_DEFAULTS = {
  flash: { key: 'flash', label: '短篇', sections: 4, targetChars: 3000 },
  short: { key: 'short', label: '中篇', sections: 8, targetChars: 8000 },
  long: { key: 'long', label: '长篇节选', sections: 16, targetChars: 20000 },
};

/* ------------------------------------------------------- shape 定义 */

const evidenceShape = {
  required: true,
  type: 'array',
  itemShape: {
    quote: { required: true, type: 'string' },
    line: { required: true, type: 'number' },
    segmentId: { type: 'string' },
  },
};

export const ANALYSIS_SHAPE = {
  kind: { required: true, type: 'string', enum: ['analysis'] },
  schemaVersion: { required: true, type: 'string' },
  source: {
    required: true,
    type: 'object',
    itemShape: undefined,
  },
  textType: { required: true, type: 'object' },
  genre: { required: true, type: 'object' },
  standard: { required: true, type: 'object' },
  narrative: { required: true, type: 'object' },
  elements: { required: true, type: 'object' },
  world: { required: true, type: 'object' },
  gaps: { required: true, type: 'array' },
  modeFit: { required: true, type: 'array' },
  recommendation: { required: true, type: 'object' },
};

export const PLAN_SHAPE = {
  kind: { required: true, type: 'string', enum: ['plan'] },
  schemaVersion: { required: true, type: 'string' },
  mode: { required: true, type: 'string', enum: MODE_KEYS },
  title: { required: true, type: 'string' },
  direction: { required: true, type: 'object' },
  scale: { required: true, type: 'object' },
  constraints: { required: true, type: 'object' },
  changes: { required: true, type: 'array' },
  beats: { required: true, type: 'array' },
  status: { required: true, type: 'object' },
};

export const STORY_SHAPE = {
  kind: { required: true, type: 'string', enum: ['story'] },
  schemaVersion: { required: true, type: 'string' },
  title: { required: true, type: 'string' },
  mode: { required: true, type: 'string', enum: MODE_KEYS },
  sections: { required: true, type: 'array' },
  text: { required: true, type: 'string' },
};

/* ------------------------------------------------------- 校验函数 */

export function validateAnalysis(a) {
  const errs = checkShape(a, ANALYSIS_SHAPE);
  if (isObj(a)) {
    if (isObj(a.standard) && !TIER_KEYS.includes(a.standard.tier)) {
      errs.push(`analysis.standard.tier 取值应为 ${TIER_KEYS.join('/')}`);
    }
    if (isObj(a.genre) && !TIER_KEYS.includes(a.genre.tier)) {
      errs.push(`analysis.genre.tier 取值应为 ${TIER_KEYS.join('/')}`);
    }
    if (Array.isArray(a.modeFit)) {
      a.modeFit.forEach((m, i) => {
        if (!MODE_KEYS.includes(m?.mode)) errs.push(`analysis.modeFit[${i}].mode 不是合法模式：${m?.mode}`);
        if (!Number.isFinite(Number(m?.score))) errs.push(`analysis.modeFit[${i}].score 应为数字`);
      });
    }
    if (isObj(a.recommendation) && a.recommendation.mode && !MODE_KEYS.includes(a.recommendation.mode)) {
      errs.push(`analysis.recommendation.mode 不是合法模式：${a.recommendation.mode}`);
    }
    if (isObj(a.source) && !isStr(a.source.fingerprint)) {
      errs.push('analysis.source.fingerprint 缺失——下游无法确认方案与原文是否对应');
    }
  }
  return errs;
}

export function validatePlan(p) {
  const errs = checkShape(p, PLAN_SHAPE);
  if (!isObj(p)) return errs;

  if (isObj(p.status) && !PLAN_STATE_KEYS.includes(p.status.state)) {
    errs.push(`plan.status.state 取值应为 ${PLAN_STATE_KEYS.join('/')}，实际为 ${p.status?.state}`);
  }
  // 每个修改点必须有 id 与决策状态，否则人工勾选无法落回文件
  if (Array.isArray(p.changes)) {
    const ids = new Set();
    p.changes.forEach((c, i) => {
      if (!isStr(c?.id) || trim(c.id) === '') errs.push(`plan.changes[${i}].id 缺失——人工确认无法回填`);
      else if (ids.has(c.id)) errs.push(`plan.changes[${i}].id 重复：${c.id}`);
      else ids.add(c.id);
      if (c?.decision && !(c.decision in CHANGE_DECISIONS)) {
        errs.push(`plan.changes[${i}].decision 取值应为 ${Object.keys(CHANGE_DECISIONS).join('/')}`);
      }
    });
  }
  // beats 必须有序号且不重复，否则写作会乱序
  if (Array.isArray(p.beats)) {
    const idx = new Set();
    p.beats.forEach((b, i) => {
      const n = Number(b?.index);
      if (!Number.isInteger(n) || n < 1) errs.push(`plan.beats[${i}].index 应为 ≥1 的整数`);
      else if (idx.has(n)) errs.push(`plan.beats[${i}].index 重复：${n}`);
      else idx.add(n);
    });
    if (isObj(p.scale) && Number.isFinite(Number(p.scale.sections)) && p.beats.length !== Number(p.scale.sections)) {
      errs.push(`plan.scale.sections=${p.scale.sections} 与 beats 数量 ${p.beats.length} 不一致`);
    }
  }
  // 未确认的方案不应带"已确认"状态
  if (isObj(p.status) && ['confirmed', 'confirmed_with_edits'].includes(p.status.state) && !p.status.confirmedAt) {
    errs.push('plan.status.state 已确认但缺少 confirmedAt —— 确认必须留痕');
  }
  return errs;
}

export function validateStory(s) {
  const errs = checkShape(s, STORY_SHAPE);
  if (!isObj(s)) return errs;

  if (Array.isArray(s.sections)) {
    if (s.sections.length === 0) errs.push('story.sections 为空——没有正文');
    const idx = new Set();
    s.sections.forEach((sec, i) => {
      const n = Number(sec?.index);
      if (!Number.isInteger(n) || n < 1) errs.push(`story.sections[${i}].index 应为 ≥1 的整数`);
      else if (idx.has(n)) errs.push(`story.sections[${i}].index 重复：${n}`);
      else idx.add(n);
      if (!isStr(sec?.text) || trim(sec.text) === '') errs.push(`story.sections[${i}].text 为空——空章节会让校验与字数统计失真`);
    });
  }
  // text 必须与 sections 对应，否则校验的正文和交付的正文就不是一份东西
  if (isStr(s.text) && Array.isArray(s.sections) && s.sections.length) {
    const joined = s.sections.map((x) => String(x?.text ?? '')).join('');
    const norm = (x) => x.replace(/\s+/g, '');
    if (norm(s.text) !== norm(joined)) {
      errs.push('story.text 与 sections 拼接结果不一致——校验对象与交付对象必须同一份');
    }
  }
  return errs;
}

export function validateCheck(c) {
  const errs = [];
  if (!isObj(c)) return ['check 报告应为对象'];
  if (c.kind !== 'check') errs.push('check.kind 应为 "check"');
  if (!isStr(c.schemaVersion)) errs.push('check.schemaVersion 缺失');
  if (!isObj(c.summary)) errs.push('check.summary 缺失');
  if (!isObj(c.standard) || !TIER_KEYS.includes(c.standard.tier)) {
    errs.push(`check.standard.tier 取值应为 ${TIER_KEYS.join('/')}`);
  }
  if (!Array.isArray(c.findings)) errs.push('check.findings 应为数组');
  else {
    c.findings.forEach((f, i) => {
      if (!SEVERITY_KEYS.includes(f?.severity)) errs.push(`check.findings[${i}].severity 非法：${f?.severity}`);
      // 没有出处的 finding 无法核对，一律视为无效
      if (!isStr(f?.quote) || trim(f.quote) === '') errs.push(`check.findings[${i}].quote 为空——没有原文出处的判定不可核对`);
    });
  }
  if (!CHECK_VERDICTS[c.verdict]) errs.push(`check.verdict 取值应为 ${Object.keys(CHECK_VERDICTS).join('/')}`);
  return errs;
}

/* ------------------------------------------------------- 构造辅助 */

export function makeEnvelope(kind, payload = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    generator: 'story-weave',
    ...payload,
  };
}

/** 数值维度归一化：把任意分数压到 0–1，保留 2 位 */
export function normScore(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}
