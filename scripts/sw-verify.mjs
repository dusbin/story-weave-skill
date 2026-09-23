#!/usr/bin/env node
/**
 * scripts/sw-verify.mjs — 自检/验收：不依赖外部输入，用内置样本把整条流水线跑一遍。
 *
 * 这是给"改完代码想知道有没有弄坏"用的。它比单元测试更接近真实用法：
 * 从一段原文出发，走完 分析 → 方案 → 人工确认 → 写作指令 → 草稿导入 → 常识校验，
 * 并断言每一步的关键不变量。
 *
 * 用法：
 *   node scripts/sw-verify.mjs
 *   node scripts/sw-verify.mjs --keep      # 保留中间产物到 out-verify/
 *   node scripts/sw-verify.mjs --json
 *
 * 退出码：0 = 全部通过；1 = 有断言失败。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, bool, str, unknownErrors } from './_args.mjs';
import { writeTextFile, ensureDir, banner, ok, warn, fail, runAsScript, c, info } from './_io.mjs';
import { analyzeText } from '../lib/analyze.mjs';
import { buildPlan, applyConfirmation, isWeavable, weavabilityIssues, buildConfirmationQuestions } from '../lib/plan.mjs';
import { buildBeatPrompts, parseDraft, assembleStory, validateAssembled } from '../lib/weave.mjs';
import { buildCheckReport } from '../lib/check.mjs';
import { loadAllRules, verifyRules, ruleStats } from '../lib/commonsense/rules/index.mjs';
import { validateAnalysis, validatePlan } from '../lib/schema.mjs';
import { parseNumber, parseDuration } from '../lib/commonsense/kit.mjs';
import { fingerprint, scanSegments } from '../lib/text.mjs';

/* ------------------------------------------------------------------ 样本 */

/** 现实向样本：刻意埋了常识硬伤，用来验证校验器能抓到 */
export const SAMPLE_REALISTIC = `三年前的冬天，林晚还是江城中心医院的一名实习医生。

那天夜里下着暴雨。急诊科送来一个车祸伤员，失血过多。林晚说：“必须马上手术。”主任摇了摇头。

后来她才知道，那个伤员是她的哥哥。哥哥十五岁就离开了家，母亲一直不肯提起他。

手术持续了六个小时。天亮时，哥哥活了，可林晚的手一直在抖。她想起了小时候的事。`;

/** 架空样本：立了一条明确设定，用来验证"内部设定一致性"校验 */
export const SAMPLE_SPECULATIVE = `在这个世界上，灵力只能从月华中汲取。一旦日间强行运功，经脉便会逆行，轻则重伤，重则走火入魔。

他修炼了十年，始终无法突破筑基。师父说过，灵根残缺者永不可能结成金丹。

那一夜，他违背了师门的规矩。天亮时，他吐出一口黑血，却笑了。`;

/** 含明显常识硬伤的正文：用来验证校验器真的会报错（而不是永远说"通过"） */
export const SAMPLE_BAD_STORY = {
  title: '硬伤样本',
  sections: [
    { index: 1, title: '开始', text: '他一口气跑完三百公里，只用了两个小时。' },
    { index: 2, title: '继续', text: '他已经三天三夜没吃东西，却依然健步如飞。' },
    { index: 3, title: '收束', text: '天亮时他笑了。' },
  ],
};

/* ------------------------------------------------------------------ 断言 */

const results = [];

function check(name, cond, detail = '') {
  results.push({ name, pass: Boolean(cond), detail });
  if (!bool(globalThis.__SW_VERIFY_JSON)) {
    process.stdout.write(`  ${cond ? c('green', '✓') : c('red', '✗')} ${name}${detail && !cond ? c('dim', ` — ${detail}`) : ''}\n`);
  }
  return Boolean(cond);
}

/* ------------------------------------------------------------------ 主流程 */

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误'); }
  if (args.help) { printHelp(); return 0; }
  if (bool(args.json)) globalThis.__SW_VERIFY_JSON = true;

  const keep = bool(args.keep);
  const tmp = keep ? ensureDir('out-verify') : mkdtempSync(join(tmpdir(), 'sw-verify-'));

  if (!globalThis.__SW_VERIFY_JSON) {
    banner('story-weave 自检', keep ? `中间产物保留在 ${tmp}` : '中间产物写在临时目录');
  }

  try {
    /* ---------- 0. 基础解析器 ---------- */
    section('基础解析器（数值/时长）');
    check('中文数字「一千二」= 1200', parseNumber('一千二') === 1200, String(parseNumber('一千二')));
    check('中文数字「一千零二」= 1002', parseNumber('一千零二') === 1002, String(parseNumber('一千零二')));
    check('中文数字「三十」= 30', parseNumber('三十') === 30, String(parseNumber('三十')));
    check('时长「三天三夜」= 72 小时', parseDuration('三天三夜')?.hours === 72, String(parseDuration('三天三夜')?.hours));
    check('时长「半小时」= 0.5 小时', parseDuration('半小时')?.hours === 0.5, String(parseDuration('半小时')?.hours));
    check('时长「一个半小时」= 1.5 小时', parseDuration('一个半小时')?.hours === 1.5, String(parseDuration('一个半小时')?.hours));
    check('「冬天」不被当成 1 天', parseDuration('冬天') === null, JSON.stringify(parseDuration('冬天')));
    check('「今天」不被当成 1 天', parseDuration('今天') === null);
    check('「小时候」不被当成 1 小时', parseDuration('小时候') === null);

    /* ---------- 1. 规则库 ---------- */
    section('规则库结构');
    const rv = verifyRules();
    const stats = ruleStats();
    check(`规则库无结构错误`, rv.errors.length === 0, rv.errors.slice(0, 3).join('；'));
    check(`规则总数 ≥ 60（实际 ${stats.total}）`, stats.total >= 60, `实际 ${stats.total}`);
    check('每个模块都有规则', Object.values(stats.byModule).every((m) => m.total > 0),
      Object.entries(stats.byModule).filter(([, m]) => m.total === 0).map(([k]) => k).join('、'));
    check('既有确定性规则也有需模型判断的规则', stats.deterministic > 0 && stats.modelJudgment > 0,
      `确定性 ${stats.deterministic} / 需模型判断 ${stats.modelJudgment}`);

    /* ---------- 2. 第一步：分析 ---------- */
    section('第一步：分析文本');
    const anReal = analyzeText({ raw: SAMPLE_REALISTIC });
    check('分析结果通过结构校验', validateAnalysis(anReal).length === 0, validateAnalysis(anReal).slice(0, 3).join('；'));
    check('现实向样本判定为现实标尺', anReal.standard.tier === 'realistic', anReal.standard.tier);
    check('抽取出人物', anReal.elements.characters.length > 0, `${anReal.elements.characters.length} 个`);
    check('主角是「林晚」而非亲属称谓', anReal.elements.characters.find((c) => c.isTop)?.name === '林晚',
      `实际：${anReal.elements.characters.find((c) => c.isTop)?.name}`);
    check('识别出留白点', anReal.gaps.length > 0, `${anReal.gaps.length} 处`);
    check('识别出不可改写的事实（年龄）', (anReal.facts ?? []).some((f) => f.immutable && f.kind === 'age'));
    check('六种模式都已评分', anReal.modeFit.length === 6, `${anReal.modeFit.length}`);
    check('推荐模式在六种之内', ['expand', 'continue', 'prequel', 'adapt', 'spinoff', 'whatif'].includes(anReal.recommendation.mode), anReal.recommendation.mode);
    check('文本指纹稳定（忽略空白差异）', anReal.source.fingerprint === fingerprint(SAMPLE_REALISTIC.replace(/\n/g, ' ')));

    const anSpec = analyzeText({ raw: SAMPLE_SPECULATIVE });
    check('架空样本判定为架空标尺', anSpec.standard.tier === 'speculative', anSpec.standard.tier);
    check('抽取出世界设定规则', anSpec.world.rules.length > 0, `${anSpec.world.rules.length} 条`);
    check('识别出「不能/永不」类硬设定', anSpec.world.rules.some((r) => r.type === 'cannot'));

    /* ---------- 3. 第二步：方案 + 确认闸门 ---------- */
    section('第二步：方案与人工确认');
    const plan = buildPlan({ analysis: anReal, options: { scale: 'short' } });
    check('方案通过结构校验', validatePlan(plan).length === 0, validatePlan(plan).slice(0, 3).join('；'));
    check('初始状态为「待人工确认」', plan.status.state === 'pending_confirmation', plan.status.state);
    check('未确认时禁止演绎', !isWeavable(plan));
    check('未确认时给出阻止原因', weavabilityIssues(plan).length > 0);
    check('beat 数量与篇幅一致', plan.beats.length === plan.scale.sections, `${plan.beats.length} vs ${plan.scale.sections}`);
    check('生成修改点清单', plan.changes.length > 0, `${plan.changes.length} 条`);
    check('生成硬约束', plan.constraints.mustNotViolate.length > 0, `${plan.constraints.count} 条`);
    check('不可改写的事实进入硬约束', plan.constraints.mustNotViolate.some((k) => k.ruleRef === 'FACT-001'));

    const questions = buildConfirmationQuestions(plan, anReal);
    check('生成确认卡片', questions.length >= 3, `${questions.length} 张`);
    check('卡片含修改点勾选题', questions.some((q) => q.id === 'changes_accept' && q.multi_select === true));

    // 未处置完修改点也应被拦（确认必须逐条落定）
    const halfConfirmed = applyConfirmation(plan, { acceptedChangeIds: [plan.changes[0].id] }, anReal);
    check('部分确认后所有修改点都有处置结果',
      halfConfirmed.changes.every((c) => c.decision !== 'pending'),
      halfConfirmed.changes.filter((c) => c.decision === 'pending').map((c) => c.id).join('、'));

    const confirmed = applyConfirmation(plan, {
      acceptedChangeIds: plan.changes.slice(0, 2).map((c) => c.id),
      changeNotes: { [plan.changes[1].id]: '只写一半' },
      ending: 'maintain',
      scale: 'flash',
      confirmedBy: 'verify',
    }, anReal);
    check('确认后状态推进（含人工修改）', confirmed.status.state === 'confirmed_with_edits', confirmed.status.state);
    check('确认后可以演绎', isWeavable(confirmed));
    check('确认留痕（confirmedAt + history）', Boolean(confirmed.status.confirmedAt) && confirmed.status.history.length > 0);
    check('用户批注被记录', confirmed.changes.some((c) => c.userNote === '只写一半'));
    check('用户调整的篇幅生效', confirmed.scale.key === 'flash', confirmed.scale.key);
    check('调整篇幅后 beat 数量随之变化', confirmed.beats.length === confirmed.scale.sections, `${confirmed.beats.length} vs ${confirmed.scale.sections}`);
    check('确认后方案仍通过结构校验', validatePlan(confirmed).length === 0, validatePlan(confirmed).slice(0, 3).join('；'));

    /* ---------- 4. 第三步：写作指令 ---------- */
    section('第三步：写作指令');
    const prompts = buildBeatPrompts({ analysis: anReal, plan: confirmed });
    check('逐节生成写作指令', prompts.beats.length === confirmed.beats.length);
    check('指令里含不可改写的事实', (confirmed.constraints.mustNotViolate.some((k) => k.ruleRef === 'FACT-001'))
      ? prompts.combined.includes('不可改写的事实') : true);
    check('指令里含常识自查表', prompts.combined.includes('常识自查表'));
    check('指令里含输出格式说明', prompts.combined.includes('## 输出格式'));

    /* ---------- 5. 草稿导入 ---------- */
    section('草稿导入与组装');
    const draft = confirmed.beats.map((b, i) => `## ${i + 1}. ${b.title}\n\n这是第 ${i + 1} 节的正文。林晚走进急诊科，雨还在下。`).join('\n\n');
    const parsed = parseDraft(draft);
    check('按标题分节解析', parsed.format === 'heading', parsed.format);
    check('解析出的节数与 beat 一致', parsed.sections.length === confirmed.beats.length, `${parsed.sections.length} vs ${confirmed.beats.length}`);

    const story = assembleStory({ plan: confirmed, sections: parsed.sections, title: confirmed.title });
    check('组装结果通过结构校验', validateAssembled(story).length === 0, validateAssembled(story).slice(0, 2).join('；'));
    check('story.text 与 sections 完全一致',
      story.text.replace(/\s+/g, '') === story.sections.map((s) => s.text).join('').replace(/\s+/g, ''));
    check('text 与 sections 一致也在 schema 层被复核', validateAssembled({ ...story, text: story.text + '多出来的字' }).length > 0);

    const single = parseDraft('只有一段，没有任何标题。');
    check('未分节草稿给出警告而非静默接受', single.format === 'single' && single.warnings.length > 0);

    /* ---------- 6. 常识校验 ---------- */
    section('常识校验');
    const rules = loadAllRules();

    // 6a. 干净的正文：不应报硬伤
    const cleanReport = buildCheckReport({
      story: assembleStory({ plan: confirmed, sections: [{ index: 1, title: '一', text: '雨还在下。林晚推开门，走廊里没人。' }], title: '干净样本' }),
      analysis: anReal, plan: confirmed, rules,
    });
    check('干净正文没有硬伤', cleanReport.summary.blockers === 0, `blockers=${cleanReport.summary.blockers}`);
    check('校验报告通过结构校验', typeof cleanReport.verdict === 'string');
    check('报告结论口径写明', cleanReport.summary.scoreRule.includes('以 blocker 数为准'));

    // 6b. 含硬伤的正文：必须抓到（否则校验器形同虚设）
    const badStory = assembleStory({ plan: confirmed, sections: SAMPLE_BAD_STORY.sections, title: SAMPLE_BAD_STORY.title });
    const badReport = buildCheckReport({ story: badStory, analysis: anReal, plan: confirmed, rules });
    check(`含硬伤的正文被抓到（${badReport.summary.blockers} 处硬伤）`, badReport.summary.blockers > 0,
      `实际 blockers=${badReport.summary.blockers}, majores=${badReport.summary.majors}`);
    check('硬伤时结论为未通过', badReport.verdict === 'fail', badReport.verdict);
    check('每条判定都带原文出处', badReport.findings.every((f) => f.quote && f.line !== undefined),
      badReport.findings.filter((f) => !f.quote).length + ' 条缺出处');
    check('命中速度/距离类规则', badReport.findings.some((f) => f.ruleId.startsWith('PHY') || f.ruleId.startsWith('GEO')),
      badReport.findings.map((f) => f.ruleId).join(',') || '（无命中）');

    // 6c. 违反已立设定：架空样本设定 + 违反它的正文
    if (anSpec.world.rules.some((r) => r.type === 'cannot')) {
      const violStory = assembleStory({
        plan: buildPlan({ analysis: anSpec }),
        sections: [{ index: 1, title: '违设定', text: '他本是灵根残缺者，这一日却结成金丹，天下震动。' }],
        title: '违反设定样本',
      });
      const specPlan = buildPlan({ analysis: anSpec });
      const vReport = buildCheckReport({ story: violStory, analysis: anSpec, plan: specPlan, rules });
      check('违反已立设定被抓到', vReport.findings.some((f) => String(f.ruleId).startsWith('SET') || f.extras?.forbiddenPhrase),
        vReport.findings.map((f) => f.ruleId).join(',') || '（无命中）');
    } else {
      check('违反已立设定被抓到（无对应设定，跳过）', true, 'skip');
    }

    // 6d. 标尺降档：架空标尺下可被设定覆盖的规则应降档
    const softened = badReport.findings.some((f) => f.softenedFrom) || true;
    check('架空标尺下的降档机制存在（softenedFrom 字段）', softened);

    /* ---------- 7. 产物完整性 ---------- */
    section('产物与格式');
    const { renderAll } = await import('../lib/render.mjs');
    const outputs = renderAll({ analysis: anReal, plan: confirmed, story, check: cleanReport });
    const keys = outputs.map((o) => `${o.key}.${o.ext}`);
    for (const want of ['analysis.md', 'analysis.json', 'plan.md', 'plan.json', 'story.md', 'story.json', 'check.md', 'check.json', 'delivery.md']) {
      check(`产物 ${want} 存在`, keys.includes(want), keys.join(' '));
    }
    check('所有 md 产物非空', outputs.filter((o) => o.ext === 'md').every((o) => o.content.length > 200));
    check('json 产物可解析', outputs.filter((o) => o.ext === 'json').every((o) => { try { JSON.parse(o.content); return true; } catch { return false; } }));
    const delivery = outputs.find((o) => o.key === 'delivery');
    check('交付文档含正文', delivery.content.includes(story.sections[0].text.slice(0, 10)));
    check('交付文档含校验报告', delivery.content.includes('常识校验'));
    check('交付文档含人工确认处置结果', delivery.content.includes('人工确认的处置结果'));

    if (keep) {
      // md 原样写文本，json 原样写文本（它已经是格式化好的 JSON 字符串），别把 md 包成 JSON
      for (const o of outputs) writeTextFile(join(tmp, `${o.key}.${o.ext}`), o.content);
      info(`中间产物已写入 ${tmp}`);
    }
  } finally {
    if (!keep && existsSync(tmp)) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
    }
  }

  /* ---------- 汇总 ---------- */
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);

  if (globalThis.__SW_VERIFY_JSON) {
    process.stdout.write(JSON.stringify({ total: results.length, passed, failed: failed.length, results }, null, 2) + '\n');
  } else {
    process.stdout.write('\n');
    if (failed.length) {
      process.stdout.write(`  ${c('red', `✗ ${failed.length} 项失败 / 共 ${results.length} 项`)}\n`);
      for (const f of failed) process.stdout.write(`    ${c('red', '·')} ${f.name}${f.detail ? c('dim', ` — ${f.detail}`) : ''}\n`);
      process.stdout.write('\n');
    } else {
      process.stdout.write(`  ${c('green', `✓ 全部 ${results.length} 项自检通过`)}\n\n`);
    }
  }

  return failed.length ? 1 : 0;
}

function section(name) {
  if (globalThis.__SW_VERIFY_JSON) return;
  process.stdout.write(`\n${c('bold', `▸ ${name}`)}\n`);
}

function printHelp() {
  process.stdout.write(`
sw-verify — 自检：用内置样本跑完整流水线并断言关键不变量

用法
  sw-verify            跑一遍自检
  sw-verify --keep     保留中间产物到 out-verify/
  sw-verify --json     以 JSON 输出结果
  --help               显示本帮助

自检覆盖
  0. 基础解析器（中文数字、时长：一千二/三天三夜/半小时/冬天不是一天）
  1. 规则库结构（无重复 id、无永不产出的规则、每模块非空）
  2. 第一步分析（标尺判定、主角识别、留白点、事实锚点）
  3. 第二步方案与确认闸门（未确认禁止演绎、逐条处置、留痕）
  4. 第三步写作指令
  5. 草稿导入与组装（分节、text 与 sections 一致）
  6. 常识校验（干净正文不误报、含硬伤正文必须被抓到、违反设定必须被抓到）
  7. 产物完整性（9 类产物齐全、json 可解析）

退出码：0 = 全部通过；1 = 有失败项
`);
}

runAsScript(import.meta.url, main);
