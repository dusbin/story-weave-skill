/**
 * test/rules-biology.test.mjs — 生理与医学规则（BIO）的命中/不命中测试。
 *
 * 这一组全部 overridable: false：架空世界里人物依然是人，
 * 因此幻想标尺下严重度不降级（下面有测试盯着这一点）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules, decideVerdict } from '../lib/commonsense/engine.mjs';
import mod, { meta, rules } from '../lib/commonsense/rules/biology.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';

function run(text, { tier = 'realistic' } = {}) {
  const ctx = buildRuleContext({
    story: { text, segments: [] },
    analysis: { standard: { tier } },
  });
  return runRules({ rules, ctx });
}

const idsOf = (res) => res.findings.map((f) => f.ruleId);
const findingOf = (res, id) => res.findings.find((f) => f.ruleId === id);

const POSITIVE = [
  ['BIO-001', '他断粮两个月，仍能扛着枪连续行军。'],
  ['BIO-002', '他三天没喝水，还背着行囊走了三百里山路。'],
  ['BIO-003', '他连着五天没合眼，还在给病人做手术。'],
  ['BIO-004', '他中了一枪，捂着伤口跑了整整三个小时。'],
  ['BIO-005', '他骨折两周后就参加了马拉松。'],
  ['BIO-006', '他高烧到四十五度还在赶路。'],
  ['BIO-007', '九十岁的老翁翻墙而入，与三个壮汉格斗。'],
  ['BIO-008', '六岁的孩子开着车冲出了巷子。'],
  ['BIO-009', '他被掐住脖子整整十分钟，醒来后什么事都没有。'],
  ['BIO-010', '他喝下毒酒，三天后仍毫无异样。'],
  ['BIO-011', '他身高三米，站在人群里像一座塔。'],
];

const NEGATIVE = [
  ['BIO-001', '他饿了三个小时，随便吃了点东西。'],
  ['BIO-002', '他一天没喝水，嘴唇都干裂了。'],
  ['BIO-003', '他熬了一个通宵，第二天补了一觉。'],
  ['BIO-004', '他中了一枪，捂着伤口跑了两百米就倒下了。'],
  ['BIO-005', '他骨折三个月后才恢复了训练。'],
  ['BIO-006', '他高烧到四十度，还坚持赶路。'],
  ['BIO-007', '九十岁的老翁坐在院子里晒太阳。'],
  ['BIO-008', '十岁的孩子背着书包跑出了巷子。'],
  ['BIO-009', '他被掐住脖子几秒就晕了过去，醒来后头痛欲裂。'],
  ['BIO-010', '他喝下毒酒，半个时辰后就毒发身亡。'],
  ['BIO-011', '他身高一米八，体重七十五公斤。'],
  // 误报回归
  ['BIO-003', '他熬了两个通宵，第三天终于交了方案。'],
  ['BIO-002', '他渴了两天，嘴唇干裂。'],
];

test('模块元信息与规则形状符合引擎契约', () => {
  assert.equal(meta.module, 'biology');
  assert.equal(meta.name, '生理与医学');
  assert.equal(meta.standard, 'real');
  assert.equal(mod.meta.module, 'biology');
  assert.ok(rules.length >= 8 && rules.length <= 15, `规则数量应在 8–15，实际 ${rules.length}`);

  const seen = new Set();
  for (const r of rules) {
    assert.ok(/^BIO-\d{3}$/.test(r.id), `id 格式错误：${r.id}`);
    assert.ok(!seen.has(r.id), `id 重复：${r.id}`);
    seen.add(r.id);
    assert.equal(r.category, '生理与医学');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    assert.ok(Array.isArray(r.tiers) && r.tiers.length > 0, `${r.id} 缺少 tiers`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 非法：${t}`);
    // BIO-011（人体尺寸）允许非人种族覆盖，是这一组里唯一的例外
    const expectOverridable = r.id === 'BIO-011';
    assert.equal(r.overridable, expectOverridable, `${r.id} 的 overridable 判定不符（生理规则应为 false）`);
    assert.ok(typeof r.title === 'string' && r.title.length > 0, `${r.id} 缺少 title`);
    assert.ok(typeof r.why === 'string' && r.why.length > 10, `${r.id} 缺少 why`);
    assert.ok(typeof r.fix === 'string' && r.fix.length > 0, `${r.id} 缺少 fix`);
    assert.ok(r.trigger && (r.trigger.keywords?.length || r.trigger.patterns?.length), `${r.id} 缺少 trigger`);
    assert.ok(typeof r.check === 'function' || typeof r.ask === 'string', `${r.id} 既没有 check 也没有 ask`);
  }
});

test('每条带 check 的规则都有「应命中」用例', () => {
  const covered = new Set(POSITIVE.map(([id]) => id));
  for (const r of rules.filter((x) => typeof x.check === 'function')) {
    assert.ok(covered.has(r.id), `规则 ${r.id} 没有应命中用例`);
  }
});

for (const [ruleId, text] of POSITIVE) {
  test(`应命中 ${ruleId}：${text}`, () => {
    const res = run(text);
    assert.ok(idsOf(res).includes(ruleId), `期望命中 ${ruleId}，实际：${idsOf(res).join(',') || '无'}`);
    for (const f of res.findings) {
      assert.ok(f.quote && f.line && f.segmentId, 'finding 必须带出处');
      assert.ok(SEVERITY_KEYS.includes(f.severity));
    }
  });
}

for (const [ruleId, text] of NEGATIVE) {
  test(`不应命中 ${ruleId}：${text}`, () => {
    const res = run(text);
    assert.ok(!idsOf(res).includes(ruleId), `不该命中 ${ruleId}，实际命中：${JSON.stringify(res.findings.map((f) => [f.ruleId, f.message]))}`);
  });
}

test('严重度阶梯：不进食的三种程度对应 minor / major / blocker', () => {
  assert.equal(findingOf(run('他饿了三天，还跑完了马拉松。'), 'BIO-001').severity, 'minor');
  assert.equal(findingOf(run('他七天没吃东西，躺在帐篷里。'), 'BIO-001').severity, 'major');
  assert.equal(findingOf(run('他七天没吃东西，还在赶路。'), 'BIO-001').severity, 'blocker');
  assert.equal(findingOf(run('他断粮两个月，仍能扛着枪连续行军。'), 'BIO-001').severity, 'blocker');
});

test('脱水三天 + 剧烈活动 = blocker（题目点名的硬伤口径）', () => {
  const f = findingOf(run('他三天没喝水，还背着行囊走了三百里山路。'), 'BIO-002');
  assert.equal(f.severity, 'blocker');
  assert.equal(f.extras.exerting, true);
});

test('有救治/交代的句子不报', () => {
  assert.deepEqual(idsOf(run('他中了一枪，同伴立刻给他止住了血，包扎好了伤口。')), []);
  assert.ok(!idsOf(run('他骨折后打了石膏，医生说要静养三个月。')).includes('BIO-005'));
  assert.ok(!idsOf(run('他怀孕五个月早产，孩子送进了保温箱。')).includes('BIO-006'));
});

test('BIO-012 无 check，转为模型判断的清单项', () => {
  const res = run('他受了重伤，昏迷了三天才醒过来。');
  assert.ok(res.checklist.some((c) => c.ruleId === 'BIO-012'), '应生成 BIO-012 清单项');
  const item = res.checklist.find((c) => c.ruleId === 'BIO-012');
  assert.ok(item.evidence.length > 0 && item.evidence[0].quote, '清单项必须带证据');
});

test('幻想标尺下人体生理规则不降级', () => {
  const res = run('他三天没喝水，还背着行囊走了三百里山路。', { tier: 'speculative' });
  const f = findingOf(res, 'BIO-002');
  assert.equal(f.severity, 'blocker');
  assert.equal(f.softenedFrom, null);
});

test('误报防线：与伤害无关的「伤口」「重伤」不产生硬伤', () => {
  const res = run('他检查了伤口，发现只是擦破了皮。');
  assert.deepEqual(res.findings, []);
});

test('blocker 直接导致 fail 结论', () => {
  const res = run('他三天没喝水，还背着行囊走了三百里山路。');
  assert.equal(decideVerdict(res.findings, res.checklist).verdict, 'fail');
});
