/**
 * test/check.test.mjs — 常识校验报告组装。
 *
 * 这个文件里最重要的是三组"反向"断言：
 *   1. 干净正文**不能**报出硬伤（误报比漏报更伤可信度）
 *   2. 明显违反常识的正文**必须**被抓到（否则校验器形同虚设）
 *   3. 违反作品自己立的设定**必须**被抓到（架空标尺的核心）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeText } from '../lib/analyze.mjs';
import { buildPlan, applyConfirmation } from '../lib/plan.mjs';
import { assembleStory } from '../lib/weave.mjs';
import { buildCheckReport, applyModelAnswers, materializeFailedChecklist, scoreFindings, decideVerdict } from '../lib/check.mjs';
import { loadAllRules } from '../lib/commonsense/rules/index.mjs';
import { deriveForbiddenPhrase } from '../lib/commonsense/internal.mjs';
import { validateCheck } from '../lib/schema.mjs';

const RULES = loadAllRules();

const REALISTIC = `三年前的冬天，林晚还是江城中心医院的一名实习医生。

那天夜里下着暴雨。急诊科送来一个车祸伤员，失血过多。林晚说：“必须马上手术。”主任摇了摇头。

后来她才知道，那个伤员是她的哥哥。哥哥十五岁就离开了家，母亲一直不肯提起他。

手术持续了六个小时。天亮时，哥哥活了，可林晚的手一直在抖。`;

const SPECULATIVE = `在这个世界上，灵力只能从月华中汲取。一旦日间强行运功，经脉便会逆行，轻则重伤。

他修炼了十年，始终无法突破筑基。师父说过，灵根残缺者永不可能结成金丹。`;

function makeStory(analysis, sections, title = '测试正文') {
  const plan = applyConfirmation(buildPlan({ analysis }), {
    acceptedChangeIds: buildPlan({ analysis }).changes.map((c) => c.id),
    confirmedBy: 'test',
  }, analysis);
  return { plan, story: assembleStory({ plan, sections, title }) };
}

const anReal = analyzeText({ raw: REALISTIC });
const anSpec = analyzeText({ raw: SPECULATIVE });

/* ------------------------------------------------------------------ 反向断言 */

test('干净正文不得报出硬伤（防误报）', () => {
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '雨还在下。林晚推开门，走廊里没人。她看了一眼墙上的钟，三点二十。' },
    { index: 2, title: '二', text: '她走进值班室，把白大褂挂在门后，坐了下来。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.equal(r.summary.blockers, 0, `干净正文出现了硬伤：${r.findings.filter((f) => f.severity === 'blocker').map((f) => f.message).join('；')}`);
  assert.notEqual(r.verdict, 'fail');
});

test('★ 违反生理极限的正文必须被抓到', () => {
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '他一口气跑完三百公里，只用了两个小时。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.ok(r.summary.blockers > 0, '超人体能应被判定为硬伤');
  assert.equal(r.verdict, 'fail');
});

test('★ 违反作品已立设定必须被抓到（架空标尺核心）', () => {
  const { plan, story } = makeStory(anSpec, [
    { index: 1, title: '一', text: '他本是灵根残缺者，这一日却结成金丹，天下震动。' },
  ]);
  const r = buildCheckReport({ story, analysis: anSpec, plan, rules: RULES });
  const hit = r.findings.find((f) => f.ruleId === 'SET-001' || String(f.ruleId).startsWith('SET'));
  assert.ok(hit, `应报出违反设定，实际 findings：${r.findings.map((f) => f.ruleId).join(',')}`);
  assert.equal(hit.severity, 'blocker');
});

test('禁止短语能正确地从设定句里推导出来', () => {
  const rules = anSpec.world.rules.filter((r) => r.type === 'cannot');
  assert.ok(rules.length > 0, '架空样本应抽到 cannot 类设定');
  const phrases = rules.map(deriveForbiddenPhrase).filter(Boolean);
  assert.ok(phrases.some((p) => p.includes('金丹')), `推导出的禁止短语：${JSON.stringify(phrases)}`);
});

test('原样遵守设定的正文不得被误报', () => {
  const { plan, story } = makeStory(anSpec, [
    { index: 1, title: '一', text: '他终究没能结成金丹。师父的话应了。' },
  ]);
  const r = buildCheckReport({ story, analysis: anSpec, plan, rules: RULES });
  assert.equal(r.summary.blockers, 0, `否定式表述不应判为违反：${r.findings.map((f) => f.message).join('；')}`);
});

/* ------------------------------------------------------------------ 事实不变性 */

test('★ 重述同一件事却改掉年龄 → 硬伤', () => {
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '哥哥十八岁那年离开了家。母亲一直不肯提起他。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  const hit = r.findings.find((f) => f.ruleId === 'FACT-002');
  assert.ok(hit, '改写原文事实应被判定为硬伤');
  assert.equal(hit.severity, 'blocker');
});

test('★ 同一人物在不同时间点的年龄不算冲突（防误报）', () => {
  // 原文「哥哥十五岁就离开了家」说的是离家那一刻；
  // 演绎里的「男性，三十岁上下」说的是多年后。两者一致，绝不能报错。
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '抢救室里躺着一个男性，三十岁上下，血压测不出。她想起母亲说过，他十五岁就走了。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  const factFindings = r.findings.filter((f) => String(f.ruleId).startsWith('FACT'));
  assert.deepEqual(factFindings, [], `不应把不同时间点的年龄判为冲突：${factFindings.map((f) => f.message).join('；')}`);
  assert.equal(r.summary.blockers, 0);
});

test('原文年龄未被承接时降级为清单项而非硬判', () => {
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '伤员四十岁出头，躺在推车上。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.equal(r.findings.filter((f) => String(f.ruleId).startsWith('FACT')).length, 0, '缺证据时不硬判');
  assert.ok(r.checklist.some((c) => c.ruleId === 'FACT-004'), '应转为需要判断的清单项');
});

/* ------------------------------------------------------------------ 出处纪律 */

test('每条 finding 都必须带原文引文（否则不可核对）', () => {
  const { plan, story } = makeStory(anReal, [
    { index: 1, title: '一', text: '他一口气跑完三百公里，只用了两个小时。' },
    { index: 2, title: '二', text: '他已经三天三夜没吃东西，却依然健步如飞。' },
  ]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.ok(r.findings.length > 0);
  for (const f of r.findings) {
    assert.ok(f.quote && f.quote.length > 0, `finding ${f.ruleId} 缺引文`);
    assert.ok(f.ruleId, 'finding 必须有 ruleId');
    assert.ok(f.category, 'finding 必须有 category');
  }
});

test('报告通过结构校验', () => {
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。' }]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.deepEqual(validateCheck(r), []);
});

test('结论口径写明"以 blocker 数为准"', () => {
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。' }]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.ok(r.summary.scoreRule.includes('blocker'));
});

/* ------------------------------------------------------------------ 打分与结论 */

test('打分：按严重度扣分并给出等第', () => {
  const s = scoreFindings([{ severity: 'blocker' }, { severity: 'major' }, { severity: 'minor' }]);
  assert.equal(s.penalty, 15);
  assert.equal(s.score, 85);
  assert.equal(s.grade, 'B');
  assert.equal(scoreFindings([]).score, 100);
  assert.equal(scoreFindings([]).grade, 'A');
});

test('★ 结论：有硬伤即未通过（与分数无关）', () => {
  const many = Array.from({ length: 3 }, () => ({ severity: 'blocker' }));
  const one = decideVerdict([{ severity: 'blocker' }], []);
  assert.equal(one.verdict, 'fail');
  // 即便只有一处硬伤、分数仍然很高，也必须是 fail
  const scored = scoreFindings([{ severity: 'blocker' }]);
  assert.equal(scored.score, 90);
  assert.equal(decideVerdict([{ severity: 'blocker' }], []).verdict, 'fail');
  assert.equal(decideVerdict(many, []).verdict, 'fail');
});

test('结论：有明显可疑或未回答项为 pass_with_warnings', () => {
  assert.equal(decideVerdict([{ severity: 'major' }], []).verdict, 'pass_with_warnings');
  assert.equal(decideVerdict([], [{ verdict: null }]).verdict, 'pass_with_warnings');
  assert.equal(decideVerdict([], []).verdict, 'pass');
});

/* ------------------------------------------------------------------ 清单回填 */

test('回填模型判断：支持数组与对象两种写法', () => {
  const items = [{ id: 'q-1', evidence: [{ segmentId: 's1', line: 1, quote: '原文' }] }, { id: 'q-2', evidence: [] }];
  const byArray = applyModelAnswers(items, [{ id: 'q-1', verdict: 'pass', note: '没问题' }]);
  assert.equal(byArray[0].verdict, 'pass');
  assert.equal(byArray[0].note, '没问题');
  const byObject = applyModelAnswers(items, { 'q-1': { verdict: 'fail' } });
  assert.equal(byObject[0].verdict, 'fail');
});

test('非法 verdict 被忽略而不是写进去', () => {
  const items = [{ id: 'q-1', evidence: [] }];
  const out = applyModelAnswers(items, [{ id: 'q-1', verdict: '肯定没问题' }]);
  assert.equal(out[0].verdict, null);
});

test('★ 模型判定为 fail 时，优先采用模型指明的原文出处', () => {
  // 清单项自带的 evidence 是"关键词触发的候选片段"，未必是问题所在；
  // 若模型指明了 quote，结论必须挂在那一处，否则报告会张冠李戴。
  const items = [{
    id: 'q-x', ruleId: 'CRAFT-009', category: '叙事逻辑', severity: 'major',
    question: '有没有强调过却没下文的细节？',
    evidence: [{ segmentId: 's1', line: 3, quote: '暴雨是从傍晚开始下的，一直没停。' }],
    verdict: 'fail',
    citedQuote: '家里那张全家福的右下角，有一块被剪掉的地方。',
    citedLine: 30,
    note: '这个细节被特意强调，后文没有回收。',
  }];
  const out = materializeFailedChecklist(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].quote, '家里那张全家福的右下角，有一块被剪掉的地方。');
  assert.equal(out[0].line, 30);
  assert.ok(out[0].message.includes('没有回收'));
});

test('没有指明的出处时退回候选证据', () => {
  const items = [{
    id: 'q-y', ruleId: 'X', category: 'Y', severity: 'major',
    question: 'q', evidence: [{ segmentId: 's1', line: 5, quote: '候选证据原文' }],
    verdict: 'fail', note: '有问题',
  }];
  const out = materializeFailedChecklist(items);
  assert.equal(out[0].quote, '候选证据原文');
  assert.equal(out[0].line, 5);
});

test('判定 pass 或无可核对出处的 fail 不进入 findings', () => {
  assert.deepEqual(materializeFailedChecklist([{ id: 'a', verdict: 'pass', evidence: [{ quote: 'x' }] }]), []);
  assert.deepEqual(materializeFailedChecklist([{ id: 'b', verdict: 'fail', evidence: [] }]), []);
  // 引擎明确标注"未找到相关片段"的占位证据也不能当出处
  assert.deepEqual(materializeFailedChecklist([{ id: 'c', verdict: 'fail', evidence: [{ quote: '（正文中未找到与该修改点相关的片段）' }] }]), []);
});

test('回填后报告统计反映已回答数量', () => {
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。林晚看着窗外。' }]);
  const r1 = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.equal(r1.coverage.modelJudgment.answered, 0);
  assert.ok(r1.coverage.modelJudgment.items > 0);
  const answers = r1.checklist.map((c) => ({ id: c.id, verdict: 'pass', note: 'ok' }));
  const r2 = buildCheckReport({ story, analysis: anReal, plan, rules: RULES, modelAnswers: answers });
  assert.equal(r2.coverage.modelJudgment.answered, answers.length);
  assert.equal(r2.coverage.modelJudgment.unanswered, 0);
});

/* ------------------------------------------------------------------ 覆盖率与边界 */

test('报告标明覆盖范围且不评价文笔', () => {
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。' }]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: RULES });
  assert.ok(r.coverage.note.includes('不评价'));
  assert.ok(r.coverage.deterministic.rulesTotal > 0);
});

test('空规则集不崩溃（内部一致性检查照常运行）', () => {
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。' }]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: [] });
  assert.ok(r.verdict, '仍应给出结论');
  // 没有任何规则时，剩下的 finding 只能来自内部一致性检查（方案落实等），
  // 不能凭空冒出规则引擎的判定
  assert.ok(r.findings.every((f) => /^(PLAN|FACT|SET)-/.test(String(f.ruleId))),
    `意外的 finding 来源：${r.findings.map((f) => f.ruleId).join(',') || '(none)'}`);
});

test('缺少方案时仍能校验（只有规则引擎那一路）', () => {
  const story = assembleStory({ plan: null, sections: [{ index: 1, title: '一', text: '他跑了三百公里。' }] });
  const r = buildCheckReport({ story, analysis: anReal, plan: null, rules: RULES });
  assert.ok(r.verdict);
});

test('规则执行异常被记为引擎问题，而不是作品缺陷', () => {
  const badRule = {
    id: 'BAD-001', title: '会抛异常的规则', category: '引擎', severity: 'blocker',
    tiers: ['realistic'], overridable: false, trigger: { keywords: ['雨'] },
    check() { throw new Error('boom'); },
  };
  const { plan, story } = makeStory(anReal, [{ index: 1, title: '一', text: '雨还在下。' }]);
  const r = buildCheckReport({ story, analysis: anReal, plan, rules: [badRule] });
  const f = r.findings.find((x) => x.ruleId === 'BAD-001');
  assert.ok(f, '规则异常应被记录下来');
  assert.equal(f.severity, 'minor', '规则自身出错不能算作品的硬伤');
  assert.ok(f.message.includes('boom'));
  assert.ok(f.suggestion.includes('引擎'), '应说明这是引擎问题');
});
