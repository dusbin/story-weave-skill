/**
 * lib/weave.mjs — 第三步：演绎成文（骨架 prompt + 草稿导入 + 正文组装）。纯函数。
 *
 * ## 本技能不自己"生成文本"
 *
 * 创作由调用它的模型（或人）完成，本模块负责三件机器该做的事：
 *
 *   1. **给出一节的写作指令**：把方案、硬约束、原著事实、常识自查表压缩成一份可执行的 prompt，
 *      让写作始终在"不得违反"的边界内进行；
 *   2. **导入草稿并校验**：把 markdown 草稿切成与 beat 对齐的节，节数不符直接报错而不是默默接受；
 *   3. **组装 story.json**：保证 story.text 与 sections 完全一致（校验对象必须与交付对象同一份）。
 *
 * ## 为什么写作 prompt 里要塞"常识自查表"
 *
 * 事后校验能抓错，但抓到的错都要返工。把最容易犯的常识错误在动笔前就摆出来，
 * 是成本最低的一道防线——尤其对"三天不吃还能打""失血过多还能跑"这类反复出现的毛病。
 */

import { countChars, scanSegments } from './text.mjs';
import { safeFilename } from './util.mjs';
import { SCHEMA_VERSION, validateStory } from './schema.mjs';
import { MODE_BY_KEY } from './modes.mjs';

/* ------------------------------------------------------------------ 写作指令 */

/**
 * 生成逐节写作指令。
 * @returns {{beats:Array, combined:string}}
 */
export function buildBeatPrompts({ analysis, plan }) {
  const def = MODE_BY_KEY[plan.mode];
  const constraints = plan.constraints?.mustNotViolate ?? [];
  const immutableFacts = constraints.filter((c) => c.ruleRef === 'FACT-001');
  const worldRules = constraints.filter((c) => c.ruleRef === 'SET-001');
  const invariants = constraints.filter((c) => c.ruleRef === 'MODE-001' || c.ruleRef === 'SET-002' || c.ruleRef === 'SET-003' || c.ruleRef === 'REAL-001');
  const protagonist = analysis.elements?.characters?.find((c) => c.isTop)?.name ?? '主角';

  const acceptedChanges = (plan.changes ?? []).filter((c) => c.decision === 'accept' || c.decision === 'modify');

  const shared = {
    title: plan.title,
    mode: plan.mode,
    modeLabel: plan.modeLabel,
    logline: plan.logline,
    standard: plan.constraints?.standard?.label ?? '',
    tone: plan.scale?.tone,
    targetChars: plan.scale?.targetChars,
    protagonist,
    ending: plan.direction?.endingLabel,
    pov: plan.direction?.pov,
    immutableFacts,
    worldRules,
    invariants,
    acceptedChanges,
    guide: def?.guide ?? '',
  };

  const beats = plan.beats.map((beat, i) => {
    const prev = plan.beats[i - 1] ?? null;
    const next = plan.beats[i + 1] ?? null;
    return {
      index: beat.index,
      title: beat.title,
      purpose: beat.purpose,
      guidance: beat.guidance,
      prevTitle: prev?.title ?? null,
      nextTitle: next?.title ?? null,
      targetChars: Math.round((plan.scale.targetChars ?? 8000) / plan.beats.length),
      isFirst: i === 0,
      isLast: i === plan.beats.length - 1,
      prompt: renderBeatPrompt(shared, beat, i, plan),
    };
  });

  return { beats, combined: renderFullPrompt(shared, plan, beats) };
}

function renderBeatPrompt(s, beat, i, plan) {
  const L = [];
  // 【坑】isLast / isFirst 必须在这里按 i 与总节数算出来，不能用调用方传进来的 beat 上的字段：
  // 建 beats 时用的是 plan.beats 的原始元素（没有这些字段），于是「收束要求」这段
  // 永远不会被渲染——最后一节的指令里最重要的那句话静默消失了。
  const isLast = i === plan.beats.length - 1;
  const isFirst = i === 0;
  L.push(`### 第 ${beat.index} 节：${beat.title}`);
  L.push('');
  L.push(`- 本节目的：${beat.purpose}`);
  L.push(`- 本节写法：${beat.guidance}`);
  L.push(`- 目标字数：约 ${Math.round((plan.scale.targetChars ?? 8000) / plan.beats.length)} 字（±30%）`);
  if (beat.title) L.push(`- 上一节：${plan.beats[i - 1]?.title ?? '（本节为开篇）'}`);
  L.push(`- 下一节：${plan.beats[i + 1]?.title ?? '（本节收尾）'}`);
  L.push('');
  L.push(`**全文设定**：${s.logline}`);
  L.push(`**视角**：${s.pov}｜**基调**：${s.tone}｜**结局**：${s.ending}｜**常识标尺**：${s.standard}`);
  if (s.immutableFacts.length) {
    L.push('');
    L.push('**不可改写的事实（原文写死的）**：');
    for (const f of s.immutableFacts) L.push(`- ${f.statement}`);
  }
  if (s.worldRules.length) {
    L.push('');
    L.push('**作品已立的设定（不得违反）**：');
    for (const w of s.worldRules) L.push(`- ${w.statement}`);
  }
  if (s.invariants.length) {
    L.push('');
    L.push('**演绎边界**：');
    for (const inv of s.invariants) L.push(`- ${inv.statement}`);
  }
  if (s.acceptedChanges.length) {
    L.push('');
    L.push('**人工确认要落实的修改点**：');
    for (const c of s.acceptedChanges) L.push(`- [${c.kind}] ${c.target}：${c.to}${c.userNote ? `（用户批注：${c.userNote}）` : ''}`);
  }
  if (isLast) {
    L.push('');
    L.push(`**收束要求**：最后一节必须落在原文的落点上${s.ending.includes('维持') ? '（本方案选择维持原结局）' : ''}。不要用总结性议论收尾，收在一个具体画面或动作上。`);
  }
  if (isFirst) {
    L.push('');
    L.push('**开篇要求**：从原文的起点写起，第一段就要让读者"站在现场"，不要先交代背景。');
  }
  return L.join('\n');
}

function renderFullPrompt(s, plan, beats) {
  const L = [];
  L.push(`# 演绎写作指令：${plan.title}`);
  L.push('');
  L.push(`模式：${s.modeLabel}｜总目标字数：约 ${plan.scale.targetChars} 字｜分 ${plan.beats.length} 节`);
  L.push('');
  L.push('## 写作总纲');
  L.push('');
  L.push(s.guide);
  L.push('');
  L.push(`- 视角：${s.pov}`);
  L.push(`- 基调：${s.tone}`);
  L.push(`- 结局：${s.ending}`);
  L.push(`- 常识标尺：${s.standard}`);
  L.push('');
  L.push('## 动笔前的常识自查表（每节写完都过一遍）');
  L.push('');
  for (const line of COMMONSENSE_SELFCHECK) L.push(`- [ ] ${line}`);
  L.push('');
  L.push('## 逐节指令');
  L.push('');
  for (const b of beats) { L.push(b.prompt); L.push(''); L.push('---'); L.push(''); }
  L.push('## 输出格式');
  L.push('');
  L.push('请按下面的格式输出草稿（每节一个二级标题，标题里带序号），然后可直接用 `sw-weave --draft` 导入：');
  L.push('');
  L.push('```markdown');
  L.push(`## 1. ${plan.beats[0]?.title ?? '节标题'}`);
  L.push('（本节正文……）');
  L.push('');
  L.push(`## 2. ${plan.beats[1]?.title ?? '节标题'}`);
  L.push('（本节正文……）');
  L.push('```');
  return L.join('\n');
}

/**
 * 写作时的常识自查表。
 * 这些是叙事文本中最常犯、也最容易被读者抓住的常识错误，按"最常犯"排序。
 */
export const COMMONSENSE_SELFCHECK = [
  '**时间记账**：每一段的时间跨度都对得上吗？"三天没吃"和"还能奔跑"不能同时成立；路上的时间要和距离匹配。',
  '**生理极限**：受伤/失血/脱水/缺觉/低温之后，人物还能做的事情是否超出人体可能？伤筋动骨的恢复不能只用一两天。',
  '**空间与行程**：人物移动的距离与耗时要合理。"两小时后从北京到了上海"这类句子必须交代交通工具。',
  '**信息来源**：人物说的话，他是怎么知道的？不能凭空知道别人的秘密或未发生的事。',
  '**因果关系**：关键转折有没有铺垫？不要用"恰好""正好""突然出现"来解决问题。',
  '**时代一致**：如果是特定年代，器物、称谓、货币、制度都要对得上（别让唐朝人用手机）。',
  '**数字一致**：人数、年龄、次数、天气、季节前后一致吗？前面三个人，后面不能变四个。',
  '**专业流程**：涉及医疗、司法、金融、军事时，流程顺序与权限要对（不能"当场就做完 DNA 比对"，不能让普通人调取户籍档案）。',
  '**架空设定**：如果是架空世界，自己立的规则、代价与限制必须兑现——用了能力就要付代价。',
  '**人物一致**：人物行为符合其性格与处境吗？性格反转必须有驱动事件。',
];

/* ------------------------------------------------------------------ 草稿导入 */

/**
 * 解析 markdown 草稿为 sections。
 *
 * 支持三种分节写法（按优先级）：
 *   1. 标题：`## 1. 标题` / `## 第1节 标题` / `## 标题`
 *   2. 分隔线：`---` / `***` / `___`
 *   3. 都没有 → 视为单节，并给出 warning（不静默接受）
 *
 * @returns {{sections:Array, warnings:Array, format:string}}
 */
export function parseDraft(markdown) {
  const raw = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const warnings = [];
  if (raw.trim() === '') return { sections: [], warnings: ['草稿为空'], format: 'empty' };

  const lines = raw.split('\n');
  const headingRe = /^(#{1,4})\s*(?:第\s*)?(\d+)?\s*[\.、节]?\s*(.*)$/;
  const allHeadings = [];
  lines.forEach((line, i) => {
    const m = headingRe.exec(line.trim());
    if (m && (m[2] || m[3])) allHeadings.push({ i, level: m[1].length, num: m[2] ? Number(m[2]) : null, title: (m[3] || '').trim() });
  });

  // 混用层级时（如文档标题用 #、分节用 ##），以出现的**最深**层级作为分节标记：
  // 否则 `# 演绎写作指令` 这个文档标题会被当成"第 1 节"，
  // 真正的第一节 `## 1. 开头` 变成第 2 节，还连带报一个"序号不一致"的假警告。
  const levels = [...new Set(allHeadings.map((h) => h.level))].sort((a, b) => b - a);
  const sectionLevel = levels.length > 1 ? levels[0] : (levels[0] ?? 2);
  const headingIdxs = allHeadings.filter((h) => h.level === sectionLevel);

  let sections = [];

  // 层级过滤之后，哪怕只剩一个标题也应视为分节（原文很短、只有一节的情况很常见）。
  // 这里曾经要求 >= 2，导致「单个 ## 小节 + 前面一个 # 文档标题」被整体当成"未分节"。
  if (headingIdxs.length >= 1) {
    // 丢弃第一个标题之前的前言（通常是"# 演绎写作指令"之类的残留）
    const preamble = lines.slice(0, headingIdxs[0].i).join('\n').trim();
    if (preamble) warnings.push(`已忽略草稿开头 ${preamble.length} 字的说明性内容（第 1 个标题之前）`);
    headingIdxs.forEach((h, k) => {
      const start = h.i + 1;
      const end = k + 1 < headingIdxs.length ? headingIdxs[k + 1].i : lines.length;
      sections.push({ index: k + 1, title: h.title || `第 ${k + 1} 节`, text: lines.slice(start, end).join('\n').trim(), declaredNum: h.num });
    });
    // 标题里的序号若与实际顺序不一致，提示（常见于手写草稿）
    const mismatched = sections.filter((s) => s.declaredNum !== null && s.declaredNum !== s.index);
    if (mismatched.length) {
      warnings.push(`章标题里的序号与实际顺序不一致（${mismatched.slice(0, 3).map((s) => `标题写 ${s.declaredNum}、实际第 ${s.index} 节`).join('；')}），已按出现顺序重排`);
    }
    return { sections: sections.filter((s) => s.text !== ''), warnings, format: 'heading' };
  }

  const sepRe = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  const sepIdxs = [];
  lines.forEach((line, i) => { if (sepRe.test(line)) sepIdxs.push(i); });

  if (sepIdxs.length >= 1) {
    const chunks = [];
    let cursor = 0;
    for (const idx of sepIdxs) { chunks.push(lines.slice(cursor, idx).join('\n').trim()); cursor = idx + 1; }
    chunks.push(lines.slice(cursor).join('\n').trim());
    sections = chunks.filter((c) => c !== '').map((text, i) => ({ index: i + 1, title: `第 ${i + 1} 节`, text, declaredNum: null }));
    if (sections.length < 2) warnings.push('分隔线分节只得到 1 节，请检查草稿格式');
    return { sections, warnings, format: 'separator' };
  }

  warnings.push('草稿中没有找到章节标题或分隔线，已整体作为单节导入——正文与方案的 beat 无法逐节对应，建议按「## 1. 标题」格式分节');
  return {
    sections: [{ index: 1, title: '全文', text: raw.trim(), declaredNum: null }],
    warnings,
    format: 'single',
  };
}

/* ------------------------------------------------------------------ 组装 */

/**
 * 组装 story.json。
 * 强制保证 story.text === sections 拼接结果（validateStory 会复核这条）。
 */
export function assembleStory({ plan, sections, title, mode, notes = '' }) {
  const clean = (sections ?? []).map((s, i) => ({
    id: s.id ?? `s${i + 1}`,
    index: Number(s.index) || i + 1,
    title: s.title ?? `第 ${i + 1} 节`,
    beatId: s.beatId ?? plan?.beats?.[i]?.index ?? null,
    text: String(s.text ?? '').trim(),
    chars: countChars(s.text ?? ''),
  })).filter((s) => s.text !== '');

  const text = clean.map((s) => s.text).join('\n\n');

  const story = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'story',
    generator: 'story-weave',
    generatedAt: new Date().toISOString(),
    title: title ?? plan?.title ?? '未命名',
    mode: mode ?? plan?.mode ?? 'expand',
    modeLabel: MODE_BY_KEY[mode ?? plan?.mode]?.label ?? '',
    sections: clean,
    text,
    chars: countChars(text),
    segments: scanSegments(text),
    planRef: plan ? {
      title: plan.title,
      mode: plan.mode,
      revision: plan.status?.revision ?? null,
      state: plan.status?.state ?? null,
      beats: plan.beats.length,
      confirmedAt: plan.status?.confirmedAt ?? null,
    } : null,
    constraintsRef: plan?.constraints ?? null,
    meta: {
      notes,
      sectionCount: clean.length,
      beatCount: plan?.beats?.length ?? null,
      // 节数与 beat 数不一致要在报告里显眼，不能藏起来
      alignment: plan?.beats?.length && clean.length !== plan.beats.length
        ? `正文 ${clean.length} 节 ≠ 方案 ${plan.beats.length} beat`
        : '一致',
    },
  };

  return story;
}

/** 组装后自检：返回错误列表（空数组=可交付） */
export function validateAssembled(story) {
  return validateStory(story);
}

/** 交付文件名 */
export function storyFilename(story, ext = 'json') {
  return `${safeFilename(story.title || '未命名', 'story')}.${ext}`;
}

/** 全文预览（供 CLI 打印） */
export function previewStory(story, maxChars = 600) {
  const t = story.text ?? '';
  const head = t.slice(0, Math.floor(maxChars / 2));
  const tail = t.slice(-Math.floor(maxChars / 2));
  return t.length <= maxChars ? t : `${head}\n……(共 ${countChars(t)} 字)……\n${tail}`;
}

export { validateStory };
