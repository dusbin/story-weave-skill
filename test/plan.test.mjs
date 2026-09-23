/**
 * test/plan.test.mjs — 演绎方案与人工确认状态机。
 *
 * 这是本技能最不能出错的一环：它是"人工确认"的载体。
 * 所以这里重点测三件事：闸门真的拦得住、确认真的落得下、留痕真的准。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeText } from '../lib/analyze.mjs';
import {
  buildPlan, applyConfirmation, rejectPlan, isWeavable, weavabilityIssues,
  buildConfirmationQuestions, buildChanges, buildConstraints, summarizePlan,
} from '../lib/plan.mjs';
import { validatePlan } from '../lib/schema.mjs';
import { SCALE } from '../lib/modes.mjs';

const SRC = `三年前的冬天，林晚还是江城中心医院的一名实习医生。

那天夜里下着暴雨。急诊科送来一个车祸伤员，失血过多。林晚说：“必须马上手术。”主任摇了摇头。

后来她才知道，那个伤员是她的哥哥。哥哥十五岁就离开了家，母亲一直不肯提起他。

手术持续了六个小时。天亮时，哥哥活了，可林晚的手一直在抖。她想起了小时候的事。`;

const an = analyzeText({ raw: SRC });
const plan = () => buildPlan({ analysis: an, options: { scale: 'short' } });

/* ------------------------------------------------------------------ 构建 */

test('方案通过结构校验，且 beat 数与篇幅一致', () => {
  const p = plan();
  assert.deepEqual(validatePlan(p), []);
  assert.equal(p.beats.length, p.scale.sections);
  assert.equal(p.scale.key, 'short');
});

test('篇幅按"用户指定 > 分析建议"的顺序取值', () => {
  assert.equal(buildPlan({ analysis: an, options: { scale: 'long' } }).scale.key, 'long');
  assert.equal(buildPlan({ analysis: an, options: {} }).scale.key, an.recommendation.scaleSuggest.key);
});

test('非法模式会被拒绝', () => {
  assert.throws(() => buildPlan({ analysis: an, mode: 'nope' }), /未知演绎模式/);
});

test('beat 节数随篇幅自适应（短篇合并、长篇细化）', () => {
  const flash = buildPlan({ analysis: an, options: { scale: 'flash' } });
  const long = buildPlan({ analysis: an, options: { scale: 'long' } });
  assert.equal(flash.beats.length, SCALE.flash.sections);
  assert.equal(long.beats.length, SCALE.long.sections);
  // 首尾节拍必须保留：开头要落地，结尾要收束
  assert.ok(flash.beats[0].title.length > 0);
  assert.ok(flash.beats[flash.beats.length - 1].guidance.length > 0);
});

test('硬约束包含原文写死的事实与模式不变量', () => {
  const p = plan();
  const refs = p.constraints.mustNotViolate.map((k) => k.ruleRef);
  assert.ok(refs.includes('FACT-001'), '应有原文事实约束');
  assert.ok(refs.includes('MODE-001'), '应有模式不变量');
  assert.ok(p.constraints.mustNotViolate.some((k) => k.severity === 'blocker'));
});

test('现实向作品的标尺约束指向现实常识', () => {
  const p = plan();
  assert.equal(p.constraints.standard.tier, 'realistic');
  assert.ok(p.constraints.mustNotViolate.some((k) => k.ruleRef === 'REAL-001'));
});

test('架空向作品的标尺约束包含"人物仍按真人判"', () => {
  const specAn = analyzeText({ raw: '在这个世界上，灵力只能从月华中汲取。一旦日间强行运功，经脉便会逆行。他修炼了十年，仍无法突破筑基。' });
  const p = buildPlan({ analysis: specAn });
  assert.equal(p.constraints.standard.tier, 'speculative');
  const stmts = p.constraints.mustNotViolate.map((k) => k.statement).join(' ');
  assert.ok(stmts.includes('会饿') || stmts.includes('真人'), '架空标尺也要约束人物生理');
});

test('修改点有稳定 id 且不重复（人工确认要靠它回填）', () => {
  const p = plan();
  const ids = p.changes.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^ch\d+$/.test(id)));
});

test('修改点去重：同一处留白不被重复列出', () => {
  // 模式提案与留白点识别可能各提一次（"补写：X" vs "留白：X"）
  const p = plan();
  const keys = p.changes.map((c) => `${c.kind}|${String(c.target).replace(/^[^：]*：/, '')}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('buildChanges 支持用户额外提出的修改点', () => {
  const cs = buildChanges({ analysis: an, modeKey: 'expand', options: { extraChanges: [{ kind: '改动', target: '把结尾改到白天' }] } });
  assert.ok(cs.some((c) => c.target === '把结尾改到白天' && c.origin === 'user'));
});

/* ------------------------------------------------------------------ 闸门 */

test('★ 方案初始为待确认，且禁止演绎', () => {
  const p = plan();
  assert.equal(p.status.state, 'pending_confirmation');
  assert.equal(isWeavable(p), false);
  const issues = weavabilityIssues(p);
  assert.ok(issues.some((i) => i.includes('尚未经人工确认')));
  assert.ok(issues.some((i) => i.includes('修改点未处置')));
});

test('确认卡片包含模式/篇幅/结局/修改点勾选', () => {
  const qs = buildConfirmationQuestions(plan(), an);
  const ids = qs.map((q) => q.id);
  for (const want of ['mode', 'scale', 'ending', 'changes_accept']) assert.ok(ids.includes(want), `缺少卡片 ${want}`);
  assert.equal(qs.find((q) => q.id === 'changes_accept').multi_select, true);
  assert.equal(qs.find((q) => q.id === 'mode').multi_select, false);
});

test('推荐模式在卡片里置顶', () => {
  const p = plan();
  const qs = buildConfirmationQuestions(p, an);
  const modeQ = qs.find((q) => q.id === 'mode');
  assert.equal(modeQ.options[0].value, an.recommendation.mode);
});

test('标尺不确定时才出现标尺卡片', () => {
  const vague = analyzeText({ raw: '他把杯子放在桌上，然后走了。' });
  const qs = buildConfirmationQuestions(buildPlan({ analysis: vague }), vague);
  assert.ok(qs.some((q) => q.id === 'tier'), '标尺不确定时应当问用户');
});

/* ------------------------------------------------------------------ 确认 */

test('★ 确认后状态推进、闸门打开、留痕完整', () => {
  const p = plan();
  const c = applyConfirmation(p, {
    acceptedChangeIds: [p.changes[0].id, p.changes[1].id],
    changeNotes: { [p.changes[1].id]: '只写一半' },
    ending: 'maintain',
    confirmedBy: 'tester',
  }, an);

  assert.equal(c.status.state, 'confirmed_with_edits');
  assert.equal(isWeavable(c), true);
  assert.deepEqual(weavabilityIssues(c), []);
  assert.ok(c.status.confirmedAt);
  assert.equal(c.status.confirmedBy, 'tester');
  assert.equal(c.status.revision, 2);
  assert.equal(c.status.history.length, 1);
  assert.deepEqual(c.status.history[0].acceptedChangeIds.sort(), [p.changes[0].id, p.changes[1].id].sort());
  assert.deepEqual(validatePlan(c), []);
});

test('★ 未勾选的修改点按"不改"处理，且不留 pending', () => {
  const p = plan();
  const c = applyConfirmation(p, { acceptedChangeIds: [p.changes[0].id] }, an);
  assert.ok(c.changes.every((x) => x.decision !== 'pending'));
  assert.equal(c.changes[0].decision, 'accept');
  // 卡片上没勾、也没批注的 → 明确记为"未勾选，按不改处理"
  assert.ok(c.changes.some((x) => x.decision === 'reject'));
  assert.ok(c.changes.every((x) => x.decidedAt), '每条处置都要有时间戳');
});

test('用户批注写入 userNote 并标记为 modify', () => {
  const p = plan();
  const c = applyConfirmation(p, { acceptedChangeIds: [p.changes[2].id], changeNotes: { [p.changes[2].id]: '这里只写一半' } }, an);
  const ch = c.changes.find((x) => x.id === p.changes[2].id);
  assert.equal(ch.decision, 'modify');
  assert.equal(ch.userNote, '这里只写一半');
});

test('硬约束类修改点默认保留（它本来就不是"要改的东西"）', () => {
  const p = plan();
  const factChange = p.changes.find((c) => c.origin === 'fact');
  assert.ok(factChange, '样本应含事实类修改点');
  const c = applyConfirmation(p, {}, an);
  const after = c.changes.find((x) => x.id === factChange.id);
  assert.equal(after.decision, 'accept');
  assert.equal(after.decisionLabel, '保持不变');
});

test('★ 回归：留痕必须记录改动前的值', () => {
  // 曾经的 bug：先执行改动再生成描述，于是「篇幅：中篇 → 短篇」被记成「短篇 → 短篇」，
  // 留痕写成了一句废话——而"确认记录可追溯"正是这一步存在的理由。
  const p = plan();
  assert.equal(p.scale.key, 'short');
  const c = applyConfirmation(p, { scale: 'flash', title: '新标题' }, an);
  assert.ok(c.status.appliedEdits.some((e) => e.includes('中篇') && e.includes('短篇')), `实际记录：${JSON.stringify(c.status.appliedEdits)}`);
  const titleEdit = c.status.appliedEdits.find((e) => e.includes('标题'));
  assert.ok(titleEdit.includes(p.title) && titleEdit.includes('新标题'), `标题留痕应为「旧 → 新」，实际：${titleEdit}`);
});

test('★ 回归：未传某个答案时不得崩溃（惰性求值）', () => {
  // 曾经的 bug：desc 是字符串模板，函数实参提前求值，
  // answers.scale 为 undefined 时直接抛 TypeError，把"没传这个参数"变成"崩溃"。
  const p = plan();
  assert.doesNotThrow(() => applyConfirmation(p, { acceptedChangeIds: [p.changes[0].id] }, an));
  assert.doesNotThrow(() => applyConfirmation(p, {}, an));
  assert.doesNotThrow(() => applyConfirmation(p, { ending: 'open' }, an));
});

test('调整篇幅后 beat 数同步重算', () => {
  const p = plan();
  const c = applyConfirmation(p, { scale: 'long' }, an);
  assert.equal(c.scale.key, 'long');
  assert.equal(c.beats.length, c.scale.sections);
  assert.equal(c.scale.sections, SCALE.long.sections);
});

test('调整模式后骨架随之更换', () => {
  const p = plan();
  const c = applyConfirmation(p, { mode: 'prequel' }, an);
  assert.equal(c.mode, 'prequel');
  assert.equal(c.modeChosenBy, 'user');
  assert.ok(c.beats.some((b) => b.title.includes('接上原文开头')), '前传骨架必须含"接上原文开头"');
  assert.deepEqual(validatePlan(c), []);
});

test('打回方案：状态回到待确认、修改点重置、原因留痕', () => {
  const p = plan();
  const confirmed = applyConfirmation(p, { acceptedChangeIds: [p.changes[0].id] }, an);
  const back = rejectPlan(confirmed, '主线不成立');
  assert.equal(back.status.state, 'pending_confirmation');
  assert.equal(isWeavable(back), false);
  assert.ok(back.changes.every((c) => c.decision === 'pending'));
  assert.equal(back.status.rejectedReason, '主线不成立');
  assert.ok(back.status.history.some((h) => h.action === 'reject'));
});

test('原方案不被确认操作修改（纯函数）', () => {
  const p = plan();
  const snapshot = JSON.stringify(p);
  applyConfirmation(p, { scale: 'long', acceptedChangeIds: [p.changes[0].id] }, an);
  rejectPlan(p, 'x');
  assert.equal(JSON.stringify(p), snapshot, 'buildPlan 的产物不应被就地修改');
});

/* ------------------------------------------------------------------ 其它 */

test('多线推演缺分叉变量时被闸门拦下', () => {
  const p = buildPlan({ analysis: an, mode: 'whatif' });
  const c = applyConfirmation(p, { acceptedChangeIds: p.changes.map((x) => x.id) }, an);
  assert.ok(weavabilityIssues(c).some((i) => i.includes('分叉变量')));
  const ok = applyConfirmation(p, { acceptedChangeIds: p.changes.map((x) => x.id), branchVariable: '那晚他没说出真相' }, an);
  assert.deepEqual(weavabilityIssues(ok), []);
});

test('改编缺替换轴时被闸门拦下', () => {
  const p = buildPlan({ analysis: an, mode: 'adapt' });
  const c = applyConfirmation(p, { acceptedChangeIds: p.changes.map((x) => x.id) }, an);
  assert.ok(weavabilityIssues(c).some((i) => i.includes('替换轴')));
});

test('summarizePlan 反映真实状态', () => {
  const p = plan();
  const s = summarizePlan(p);
  assert.ok(s.includes('待人工确认'));
  assert.ok(s.includes(p.modeLabel));
  assert.ok(s.includes(String(p.changes.length)));
});

test('buildConstraints 的约束条目都带 id 与出处标记', () => {
  const k = buildConstraints({ analysis: an, modeKey: 'expand', def: null });
  assert.ok(k.mustNotViolate.length > 0);
  for (const c of k.mustNotViolate) {
    assert.ok(c.id && c.statement && c.source && c.ruleRef && c.severity);
  }
});
