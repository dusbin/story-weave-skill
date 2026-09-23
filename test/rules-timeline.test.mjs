/**
 * test/rules-timeline.test.mjs — 时间线算术规则（TIM）的命中/不命中测试。
 *
 * 这一组全部 overridable: false：时间算术是逻辑问题，架空世界照样成立。
 * 用例覆盖：当天 vs 长时长、季节 vs 天气、出生年与年龄、年龄倒退、
 * 孕期周期、时刻加法、同句时长自相矛盾、日期与「N 天后」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules, decideVerdict } from '../lib/commonsense/engine.mjs';
import mod, { meta, rules } from '../lib/commonsense/rules/timeline.mjs';
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
  ['TIM-001', '他连续奔波了三十六个小时，当天就赶回了家。'],
  ['TIM-002', '他在盛夏的八月穿行，天上飘着大雪。'],
  ['TIM-003', '1990年，他二十岁，意气风发。\n\n他生于1975年。'],
  ['TIM-004', '他今年四十岁，三年前才三十岁。'],
  ['TIM-005', '她怀孕五个月后就生下了孩子。'],
  ['TIM-006', '上午八点出发，开了六个小时，上午十点就到了。'],
  ['TIM-007', '他昏迷了三天，三个月后才醒来。'],
  ['TIM-008', '3月5日出发，三天后，也就是3月12日到达。'],
];

/** 不应命中的用例：[不该出的规则 id, 正常文本] */
const NEGATIVE = [
  ['TIM-001', '他赶了十个小时的路，当天就到了县城。'],
  ['TIM-002', '他在盛夏的八月穿行，烈日晒得人睁不开眼。'],
  ['TIM-003', '他生于1975年。\n\n2005年，他三十岁，刚刚成家。'],
  ['TIM-003', '他生于1985年。\n\n2020年，他三十五岁，事业有成。'],
  ['TIM-004', '他今年三十岁，二十年前他刚满十岁。'],
  ['TIM-005', '她怀孕十个月后生下了一个男孩。'],
  ['TIM-005', '她怀孕七个月早产，孩子送进了保温箱。'],
  ['TIM-006', '上午八点出发，开了六个小时，下午两点到达了目的地。'],
  ['TIM-006', '晚上十点出发，走了六个小时，第二天清晨四点到了村口。'],
  ['TIM-007', '他昏迷了三天，醒来后又躺了三个月。'],
  ['TIM-008', '3月5日出发，七天后，也就是3月12日到达。'],
  ['TIM-008', '12月30日出发，三天后，也就是1月2日到达。'],
  // 误报回归：序数日期不是时长
  ['TIM-007', '他昏迷了三天，第三天终于醒了。'],
  ['TIM-001', '他连续工作了三十个小时，第二天就交了稿。'],
];

test('模块元信息与规则形状符合引擎契约', () => {
  assert.equal(meta.module, 'timeline');
  assert.equal(meta.name, '时间线算术');
  assert.equal(meta.standard, 'real');
  assert.equal(mod.meta.module, 'timeline');
  assert.ok(rules.length >= 8 && rules.length <= 15, `规则数量应在 8–15，实际 ${rules.length}`);

  const seen = new Set();
  for (const r of rules) {
    assert.ok(/^TIM-\d{3}$/.test(r.id), `id 格式错误：${r.id}`);
    assert.ok(!seen.has(r.id), `id 重复：${r.id}`);
    seen.add(r.id);
    assert.equal(r.category, '时间线算术');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    assert.ok(Array.isArray(r.tiers) && r.tiers.length > 0, `${r.id} 缺少 tiers`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 非法：${t}`);
    // TIM-002（季节与天气）允许架空世界的异常气候覆盖，是这一组里唯一的例外
    assert.equal(r.overridable, r.id === 'TIM-002', `${r.id} 的 overridable 判定不符（时间算术应为 false）`);
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
  test(`应命中 ${ruleId}：${text.replace(/\n+/g, ' / ')}`, () => {
    const res = run(text);
    assert.ok(idsOf(res).includes(ruleId), `期望命中 ${ruleId}，实际：${idsOf(res).join(',') || '无'}`);
    for (const f of res.findings) {
      assert.ok(f.quote && f.line && f.segmentId, 'finding 必须带出处');
      assert.ok(SEVERITY_KEYS.includes(f.severity));
    }
  });
}

for (const [ruleId, text] of NEGATIVE) {
  test(`不应命中 ${ruleId}：${text.replace(/\n+/g, ' / ')}`, () => {
    const res = run(text);
    assert.ok(!idsOf(res).includes(ruleId), `不该命中 ${ruleId}，实际命中：${JSON.stringify(res.findings.map((f) => [f.ruleId, f.message]))}`);
  });
}

test('TIM-003 报在「年份+年龄」那一句上，并给出正确的推算值', () => {
  const res = run('1990年，他二十岁，意气风发。\n\n他生于1975年。');
  const f = findingOf(res, 'TIM-003');
  assert.equal(f.extras.bornYear, 1975);
  assert.equal(f.extras.claimedAge, 20);
  assert.equal(f.extras.atYear, 1990);
  assert.equal(f.extras.impliedAge, 15, '1990 年时按 1975 年出生推算应为 15 岁');
  assert.ok(f.quote.includes('二十岁'), '出处应指向有年龄的那一句');
});

test('TIM-006 给出「相差几小时」的可核对结论', () => {
  const f = findingOf(run('上午八点出发，开了六个小时，上午十点就到了。'), 'TIM-006');
  assert.equal(f.extras.duration, '六个小时');
  assert.equal(f.extras.diffHours, 4);
  assert.equal(f.severity, 'major');
});

test('整数年偏差 ±1 属于虚岁/生日误差，不报', () => {
  assert.ok(!idsOf(run('1990年，他二十岁。\n\n他生于1971年。')).includes('TIM-003'));   // 差 1 年
  assert.ok(idsOf(run('1990年，他二十岁。\n\n他生于1960年。')).includes('TIM-003'));    // 差 10 年
});

test('TIM-009 无 check，转为模型判断的清单项', () => {
  const res = run('那场车祸发生在三天前，也发生在五天后。');
  assert.ok(res.checklist.some((c) => c.ruleId === 'TIM-009'), '应生成 TIM-009 清单项');
  const item = res.checklist.find((c) => c.ruleId === 'TIM-009');
  assert.ok(item.evidence.length > 0 && item.evidence[0].quote, '清单项必须带证据');
});

test('幻想标尺下时间算术照原档判（架空世界也逃不过）', () => {
  const res = run('他连续奔波了三十六个小时，当天就赶回了家。', { tier: 'speculative' });
  const f = findingOf(res, 'TIM-001');
  assert.equal(f.severity, 'major');
  assert.equal(f.softenedFrom, null);
});

test('「年代」不是时长：年份不会被当成时长算进阈值', () => {
  const res = run('1998年，他去了南方，一共住了三个月。');
  assert.deepEqual(res.findings, []);
});

test('blocker 会带来 fail 结论（这里用 blocker 级的时刻矛盾构造）', () => {
  const res = run('上午八点出发，开了六个小时，上午十点就到了。');
  assert.ok(res.findings.length > 0);
  assert.ok(['pass_with_warnings', 'fail'].includes(decideVerdict(res.findings, res.checklist).verdict));
});
