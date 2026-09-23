#!/usr/bin/env node
/**
 * examples/run-demo.mjs — 用两个示例把整条流水线跑一遍。
 *
 *   示例 A：现实向（医疗）—— 验证"现实常识标尺"与"事实不变性"
 *   示例 B：架空向（仙侠）—— 验证"内部设定一致性"（作品自己立的规则不可违反）
 *
 * 直接调用 lib（纯函数），不经过命令行，便于看清每一步的中间产物。
 * 产物写到 out-demo/。
 *
 * 用法：node examples/run-demo.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../lib/analyze.mjs';
import {
  buildPlan, applyConfirmation, buildConfirmationQuestions,
  isWeavable, weavabilityIssues,
} from '../lib/plan.mjs';
import { buildBeatPrompts, parseDraft, assembleStory } from '../lib/weave.mjs';
import { buildCheckReport } from '../lib/check.mjs';
import { renderAll } from '../lib/render.mjs';
import { loadAllRules, ruleStats } from '../lib/commonsense/rules/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'out-demo');

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m',
};
const c = (k, s) => `${C[k]}${s}${C.reset}`;

function h1(s) { console.log(`\n${c('cyan', '═'.repeat(72))}\n${c('bold', '  ' + s)}\n${c('cyan', '═'.repeat(72))}`); }
function h2(s) { console.log(`\n${c('bold', '▸ ' + s)}`); }
function line(...a) { console.log('  ' + a.join(' ')); }
function ok(s) { console.log(`  ${c('green', '✓')} ${s}`); }

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const wrote = (p) => writeFileSync(p, typeof p === 'string' ? '' : '', 'utf8');

const RULES = loadAllRules();

h1('story-weave 演示');
const stats = ruleStats();
line(`规则库：${stats.total} 条（确定性 ${stats.deterministic} / 需模型判断 ${stats.modelJudgment}），${stats.modules} 个模块`);

/* ================================================================== 示例 A */

h1('示例 A：现实向（医疗）—— 扩写');

const srcA = readFileSync(join(HERE, 'sample-input-realistic.md'), 'utf8');
h2('第一步：分析输入文本');
const anA = analyzeText({ raw: srcA, opts: { sourceKind: 'file', files: ['sample-input-realistic.md'] } });
line(`原文 ${anA.source.chars} 字 / ${anA.source.sentences} 句，指纹 ${c('dim', anA.source.fingerprint)}`);
line(`体裁：${c('bold', anA.genre.label)}（${anA.genre.confidence}）→ 常识标尺：${c('bold', anA.standard.label)}`);
line(`年代：${anA.world.era.label}｜人物 ${anA.elements.characters.length} 个｜留白点 ${anA.gaps.length} 处｜事实锚点 ${anA.facts.length} 条`);
ok(`主角判定：${anA.elements.characters.find((x) => x.isTop)?.name}`);
line('');
line(c('bold', '  六种模式适配度'));
for (const m of anA.modeFit) line(`    ${String(m.score).padEnd(5)} ${m.label}  ${c('dim', (m.reasons[0] ?? '').slice(0, 44))}`);
line(`    → 推荐：${c('green', anA.recommendation.modeLabel)}`);

h2('第二步：生成方案 + 人工确认');
const planA = buildPlan({ analysis: anA, options: { scale: 'flash' } });
line(`方案：${planA.modeLabel}｜${planA.scale.label}（${planA.beats.length} 节）｜状态 ${c('yellow', planA.status.stateLabel)}`);
line(`硬约束 ${planA.constraints.count} 条，其中不可改写的事实 ${planA.constraints.mustNotViolate.filter((k) => k.ruleRef === 'FACT-001').length} 条`);
line(`修改点 ${planA.changes.length} 条`);
const qs = buildConfirmationQuestions(planA, anA);
line(`待确认卡片 ${qs.length} 张：${qs.map((q) => q.id).join('、')}`);

const gate = weavabilityIssues(planA);
ok(`闸门生效：未确认时拒绝演绎（${gate.length} 条原因）—— ${c('dim', gate[0])}`);

// 模拟用户在卡片上的勾选
const confirmedA = applyConfirmation(planA, {
  acceptedChangeIds: planA.changes.map((x) => x.id),
  scale: 'flash',
  ending: 'maintain',
  confirmedBy: '演示',
  notes: '基调再冷一些',
}, anA);
ok(`确认后状态：${confirmedA.status.stateLabel}，可演绎 = ${isWeavable(confirmedA)}`);
line(`  留痕：${confirmedA.status.history.length} 条记录；已处置修改点 ${confirmedA.changes.filter((x) => x.decision !== 'pending').length}/${confirmedA.changes.length}`);

h2('第三步：写作指令 → 草稿 → 组装 → 校验');
const promptsA = buildBeatPrompts({ analysis: anA, plan: confirmedA });
line(`写作指令 ${promptsA.beats.length} 节，含常识自查表 ${promptsA.combined.includes('常识自查表') ? '✓' : '✗'}`);

const draftA = readFileSync(join(HERE, 'sample-draft-realistic.md'), 'utf8');
const parsedA = parseDraft(draftA);
const storyA = assembleStory({ plan: confirmedA, sections: parsedA.sections, title: confirmedA.title });
ok(`正文组装：${storyA.sections.length} 节 / ${storyA.chars} 字（对齐：${storyA.meta.alignment}）`);

const checkA = buildCheckReport({ story: storyA, analysis: anA, plan: confirmedA, rules: RULES });
line(`校验结论：${checkA.verdict === 'fail' ? c('red', checkA.verdictLabel) : c('green', checkA.verdictLabel)}｜得分 ${checkA.summary.score}/100（${checkA.summary.grade}）`);
line(`硬伤 ${checkA.summary.blockers} · 明显可疑 ${checkA.summary.majors} · 待判断项 ${checkA.coverage.modelJudgment.items}（已答 ${checkA.coverage.modelJudgment.answered}）`);
for (const f of checkA.findings.slice(0, 4)) {
  line(`  ${c('yellow', '[' + f.severity + ']')} ${f.category}｜第 ${f.line} 行：${c('dim', f.quote.slice(0, 40))}`);
}

/* ================================================================== 示例 B */

h1('示例 B：架空向（仙侠）—— 验证内部设定一致性');

const srcB = readFileSync(join(HERE, 'sample-input-fantasy.md'), 'utf8');
h2('第一步：分析输入文本');
const anB = analyzeText({ raw: srcB });
line(`体裁：${c('bold', anB.genre.label)} → 常识标尺：${c('bold', anB.standard.label)}`);
line(`${c('dim', anB.standard.reason.slice(0, 96))}…`);
line('');
line(c('bold', '  抽到的世界设定（内部一致性的判定基准）'));
for (const w of anB.world.rules) line(`    [${w.typeLabel}] ${w.statement.slice(0, 50)}`);

const planB = buildPlan({ analysis: anB });
const confirmedB = applyConfirmation(planB, {
  acceptedChangeIds: planB.changes.map((x) => x.id),
  confirmedBy: '演示',
}, anB);

h2('第三步：对比两组正文');
const cases = [
  ['遵守设定（否定式表述）', '他终究没能结成金丹。师父的话应了。'],
  ['违反设定', '他本是灵根残缺者，这一日却结成金丹，天下震动。'],
];

for (const [name, text] of cases) {
  const story = assembleStory({ plan: confirmedB, sections: [{ index: 1, title: '一', text }], title: name });
  const r = buildCheckReport({ story, analysis: anB, plan: confirmedB, rules: RULES });
  const verdictTag = r.verdict === 'fail' ? c('red', '未通过') : c('green', '通过');
  line('');
  line(`${c('bold', name)}：${verdictTag}（硬伤 ${r.summary.blockers}）`);
  line(`  正文：${c('dim', text)}`);
  for (const f of r.findings.filter((x) => /^(SET|FACT)/.test(String(x.ruleId)))) {
    line(`  ${c('red', '→')} ${f.ruleId}：${f.message.slice(0, 70)}`);
  }
}

/* ================================================================== 产物 */

h1('写出产物');
const outputs = renderAll({ analysis: anA, plan: confirmedA, story: storyA, check: checkA });
for (const o of outputs) {
  const p = join(OUT, `${o.key}.${o.ext}`);
  writeFileSync(p, o.content, 'utf8');
  ok(`out-demo/${o.key}.${o.ext}  ${c('dim', `${o.content.length} 字节`)}`);
}

h1('演示结束');
line('下一步可以自己试：');
line(`  ${c('dim', 'node scripts/sw.mjs modes --mode prequel --sections 8   # 看某个模式的完整骨架')}`);
line(`  ${c('dim', 'node scripts/sw.mjs rules --list --severity blocker      # 看所有硬伤级规则')}`);
line(`  ${c('dim', 'node scripts/sw.mjs selfcheck                          # 76 项端到端断言')}`);
console.log('');
