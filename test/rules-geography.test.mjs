/**
 * test/rules-geography.test.mjs — 空间与行程规则（GEO）的命中/不命中测试。
 *
 * 两类速度判定：明示距离+时长（kit 解析）、以及城市对坐标估算（偏小估计，宁漏不误）。
 * 用例覆盖：徒步/游泳超速、交通工具超速、明示时速、城际瞬移、徒步爬升、地点气候、骑马日行、方向。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules, decideVerdict } from '../lib/commonsense/engine.mjs';
import mod, { meta, rules } from '../lib/commonsense/rules/geography.mjs';
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
  ['GEO-001', '他徒步走了三百公里，只用了三个小时。'],
  ['GEO-002', '他开着汽车，三个小时走了一千二百公里。'],
  ['GEO-003', '这辆车时速三百公里，在高速上飞驰。'],
  ['GEO-004', '他三个小时后从北京赶到了广州。'],
  ['GEO-005', '他们在海拔三千米的地方爬到了海拔六千米的山口，只用了两个小时。'],
  ['GEO-006', '北极的盛夏，气温高达四十度，他穿着短袖。'],
  ['GEO-007', '他骑着快马，一天跑了八百里。'],
  ['GEO-008', '他一路向北，从北京到了上海。'],
];

const NEGATIVE = [
  ['GEO-001', '他徒步走了三十公里，用了十个小时。'],
  ['GEO-002', '他开着汽车，三个小时走了三百公里。'],
  ['GEO-003', '这辆车时速一百公里，在高速上行驶。'],
  ['GEO-004', '他坐飞机三个小时后从北京到了广州。'],
  ['GEO-004', '他从北京坐高铁，四个小时就到了上海。'],
  ['GEO-005', '他们在海拔三千米的地方爬到了海拔四千米的山口，用了四个小时。'],
  ['GEO-006', '北极的冬天，气温零下四十度，他裹着厚衣。'],
  ['GEO-007', '他骑着快马，一天跑了二百里。'],
  ['GEO-008', '他从北京一路南下，三天后到了上海。'],
  ['GEO-008', '他去了北上广三座城市。'],
  // 误报回归：两小时疾驰不能外推成日行距离；「飞到」要算作飞机
  ['GEO-007', '他骑马跑了两个小时，一共六十公里。'],
  ['GEO-004', '他从北京飞到纽约，十三个小时。'],
  ['GEO-003', '他的车速达到时速一百八十公里。'],
  ['GEO-003', '他坐在火车上，时速三百公里。'],
  ['GEO-001', '他从县城开车到市里，一百二十公里，走了一个半小时。'],
];

test('模块元信息与规则形状符合引擎契约', () => {
  assert.equal(meta.module, 'geography');
  assert.equal(meta.name, '空间与行程');
  assert.equal(meta.standard, 'real');
  assert.equal(mod.meta.module, 'geography');
  assert.ok(rules.length >= 8 && rules.length <= 15, `规则数量应在 8–15，实际 ${rules.length}`);

  const seen = new Set();
  for (const r of rules) {
    assert.ok(/^GEO-\d{3}$/.test(r.id), `id 格式错误：${r.id}`);
    assert.ok(!seen.has(r.id), `id 重复：${r.id}`);
    seen.add(r.id);
    assert.equal(r.category, '空间与行程');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    assert.ok(Array.isArray(r.tiers) && r.tiers.length > 0, `${r.id} 缺少 tiers`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 非法：${t}`);
    assert.equal(typeof r.overridable, 'boolean', `${r.id} 缺少 overridable`);
    assert.ok(typeof r.title === 'string' && r.title.length > 0, `${r.id} 缺少 title`);
    assert.ok(typeof r.why === 'string' && r.why.length > 10, `${r.id} 缺少 why`);
    assert.ok(typeof r.fix === 'string' && r.fix.length > 0, `${r.id} 缺少 fix`);
    assert.ok(r.trigger && (r.trigger.keywords?.length || r.trigger.patterns?.length), `${r.id} 缺少 trigger`);
    assert.ok(typeof r.check === 'function' || typeof r.ask === 'string', `${r.id} 既没有 check 也没有 ask`);
  }
});

test('人力移动规则 overridable=false，交通工具类 overridable=true', () => {
  const soft = new Set(['GEO-002', 'GEO-003', 'GEO-004', 'GEO-006', 'GEO-007', 'GEO-008']);
  for (const r of rules) {
    assert.equal(r.overridable, soft.has(r.id), `${r.id} 的 overridable 判定不符（可在设定里被覆盖的应为 true）`);
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

test('GEO-004 用坐标表算距离，给出可核对的 km 与速度', () => {
  const f = findingOf(run('他三个小时后从北京赶到了广州。'), 'GEO-004');
  assert.equal(f.extras.from, '北京');
  assert.equal(f.extras.to, '广州');
  assert.ok(f.extras.km > 1800 && f.extras.km < 2000, `北京—广州直线距离应约 1900 公里，实际 ${f.extras.km}`);
  assert.ok(f.extras.speed > 600);
});

test('交通工具有匹配的巡航速度：骑车超速但坐高铁正常', () => {
  assert.ok(idsOf(run('他骑自行车，时速两百公里。')).includes('GEO-003'));
  assert.deepEqual(run('他坐高铁，时速三百公里，四个小时从北京到了上海。').findings, []);
});

test('同距离不同交通方式：马车荒谬、飞机合理', () => {
  const cart = run('他坐着马车，三天走了两千公里。');
  assert.ok(cart.findings.some((f) => f.ruleId === 'GEO-002'), '马车三天两千公里应报');
  const plane = run('他坐飞机，三个小时飞了两千公里。');
  assert.deepEqual(plane.findings, []);
});

test('GEO-009 无 check，转为模型判断的清单项', () => {
  const res = run('他从县城出发，赶了一百公里的路。');
  assert.ok(res.checklist.some((c) => c.ruleId === 'GEO-009'), '应生成 GEO-009 清单项');
  const item = res.checklist.find((c) => c.ruleId === 'GEO-009');
  assert.ok(item.evidence.length > 0 && item.evidence[0].quote, '清单项必须带证据');
});

test('幻想标尺：城际瞬移降一档（可能是设定中的飞行/瞬移），徒步超速不降', () => {
  // 「1 小时从北京到广州」连飞机都做不到 → 现实标尺下 major，幻想标尺下降为 minor
  const jumpReal = findingOf(run('他一个小时后从北京赶到了广州。'), 'GEO-004');
  assert.equal(jumpReal.severity, 'major');
  const jump = run('他一个小时后从北京赶到了广州。', { tier: 'speculative' });
  const f = findingOf(jump, 'GEO-004');
  assert.equal(f.severity, 'minor', 'overridable 规则在幻想标尺下降一档');
  assert.equal(f.softenedFrom, 'major');

  const walk = run('他徒步走了三百公里，只用了三个小时。', { tier: 'speculative' });
  const w = findingOf(walk, 'GEO-001');
  assert.equal(w.severity, 'blocker', '人力速度上限与设定无关');
  assert.equal(w.softenedFrom, null);
});

test('近距离移动不做速度判定（同城/邻城不报）', () => {
  assert.deepEqual(run('他从北京到了天津，用了两个小时。').findings, []);
});

test('blocker 会带来 fail 结论', () => {
  const res = run('他徒步走了三百公里，只用了三个小时。');
  assert.equal(decideVerdict(res.findings, res.checklist).verdict, 'fail');
});
