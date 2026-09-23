/**
 * test/rules-physics.test.mjs — 物理与自然规则（PHY）的命中/不命中测试。
 *
 * 两类用例：
 *   应命中：文本确实违反硬常识，必须报出来（漏报会让作者以为写对了）
 *   不应命中：正常文本、被否定句、被解释过的情形，绝不能报（误报代价更高）
 * 调用方式与引擎一致：buildRuleContext → runRules(rules, ctx)。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules, selectRules, decideVerdict } from '../lib/commonsense/engine.mjs';
import mod, { meta, rules } from '../lib/commonsense/rules/physics.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';

/** 用一段文本跑本模块的全部规则 */
function run(text, { tier = 'realistic' } = {}) {
  const ctx = buildRuleContext({
    story: { text, segments: [] },
    analysis: { standard: { tier } },
  });
  return runRules({ rules, ctx });
}

const idsOf = (res) => res.findings.map((f) => f.ruleId);

/** 应命中的用例：[规则 id, 文本] */
const POSITIVE = [
  ['PHY-001', '他十分钟跑了三十公里，脸不红气不喘。'],
  ['PHY-002', '他一小时跑了三百公里，把追兵远远甩开。'],
  ['PHY-003', '他从三十层楼跳下，落在水泥地上，却毫发无伤地站了起来。'],
  ['PHY-004', '他在水底憋气二十分钟，直到同伴把他拉上来。'],
  ['PHY-005', '他先听到了雷声，过了很久才看到闪电。'],
  ['PHY-006', '他单手把汽车举了起来。'],
  ['PHY-007', '他在冰窟里泡了三个小时，直到被人拖上岸。'],
  ['PHY-008', '炸弹就在他身边爆炸，他却毫发无伤。'],
  ['PHY-009', '气温六十度的高温天气里，他仍在烈日下赶路。'],
  ['PHY-010', '他溺水二十分钟后被救活，第二天就康复了。'],
  ['PHY-011', '他跳上五米高的墙头，翻身进了院子。'],
  ['PHY-012', '他扛着三百公斤的箱子走了十里山路。'],
];

/** 不应命中的用例：[不该出的规则 id, 正常文本] */
const NEGATIVE = [
  ['PHY-001', '他十分钟跑了两公里，额头微微见汗。'],
  ['PHY-002', '他一小时跑了十二公里。'],
  ['PHY-003', '他从三楼跳下，摔断了腿。'],
  ['PHY-003', '他从三十层楼跳下，落在雪堆上，毫发无伤。'],
  ['PHY-004', '他背着氧气瓶在水下待了两个小时。'],
  ['PHY-005', '他先看到闪电，过了三秒才听到雷声。'],
  ['PHY-006', '他用千斤顶把汽车抬了起来。'],
  ['PHY-006', '他使出全力，也没能把汽车推动。'],
  ['PHY-007', '他在冰水里泡了十分钟就被拉了上来。'],
  ['PHY-008', '他及时躲开了爆炸，毫发无伤。'],
  ['PHY-009', '气温四十度的高温天气里，他仍在烈日下赶路。'],
  ['PHY-010', '他溺水两分钟后被救活，送进了医院。'],
  ['PHY-011', '他跳过了两米宽的沟。'],
  ['PHY-012', '他扛着三十公斤的背包走了十里山路。'],
  // 误报回归：曾经会被误判、修正后必须放过的句子
  ['PHY-006', '他举起了两百斤的杠铃。'],
  ['PHY-006', '他举起酒杯，向众人致意。'],
  ['PHY-004', '他屏息以待了半个小时。'],
  ['PHY-007', '他在冰面上待了三个小时。'],
  ['PHY-011', '他跳上车，开出三米远。'],
  ['PHY-002', '他开车时速一百二十公里，在高速上开了六个小时，跑了七百公里。'],
];

test('模块元信息与规则形状符合引擎契约', () => {
  assert.equal(meta.module, 'physics');
  assert.equal(meta.name, '物理与自然');
  assert.equal(meta.standard, 'real');
  assert.equal(mod.meta.module, 'physics');
  assert.ok(rules.length >= 8 && rules.length <= 15, `规则数量应在 8–15，实际 ${rules.length}`);

  const seen = new Set();
  for (const r of rules) {
    assert.ok(/^PHY-\d{3}$/.test(r.id), `id 格式错误：${r.id}`);
    assert.ok(!seen.has(r.id), `id 重复：${r.id}`);
    seen.add(r.id);
    assert.equal(r.category, '物理与自然');
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

test('每条规则都有「应命中」用例', () => {
  const covered = new Set(POSITIVE.map(([id]) => id));
  const checkRules = rules.filter((r) => typeof r.check === 'function').map((r) => r.id);
  for (const id of checkRules) assert.ok(covered.has(id), `规则 ${id} 没有应命中用例`);
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

test('误报回归：序数日期不是时长（「第三天」≠ 3 天）', () => {
  const res = run('他熬了两个通宵，第三天终于交了方案。');
  assert.ok(!idsOf(res).includes('BIO-003'), 'BIO-003 不该把「第三天」算成不睡时长');
});

test('主观描述不报（「他跑得很快」不是常识错误）', () => {
  const res = run('他跑得很快，像一阵风；他力气大得惊人，能徒手掰弯钢筋。');
  assert.deepEqual(res.findings, []);
});

test('PHY-013 无 check，转为模型判断的清单项', () => {
  const res = run('他被卡车撞飞出去，却爬起来继续战斗。');
  assert.ok(res.checklist.some((c) => c.ruleId === 'PHY-013'), '应生成 PHY-013 清单项');
  const item = res.checklist.find((c) => c.ruleId === 'PHY-013');
  assert.ok(item.question.length > 10);
  assert.ok(item.evidence.length > 0 && item.evidence[0].quote, '清单项必须带证据');
});

test('速度判定给出可核对的 extras', () => {
  const res = run('他一小时跑了三百公里。');
  const f = res.findings.find((x) => x.ruleId === 'PHY-002');
  assert.ok(f, '应命中 PHY-002');
  assert.equal(f.extras.km, 300);
  assert.equal(f.extras.hours, 1);
  assert.equal(f.extras.speed, 300);
  assert.equal(f.severity, 'blocker');
});

test('幻想标尺：overridable 规则降一档，人体生理规则不降', () => {
  const superHuman = run('他单手把汽车举了起来。', { tier: 'speculative' });
  const lift = superHuman.findings.find((f) => f.ruleId === 'PHY-006');
  assert.ok(lift, 'PHY-006 在幻想标尺下仍应报出（提示改文或补设定）');
  assert.equal(lift.severity, 'major', 'overridable 规则在幻想标尺下降一档');
  assert.equal(lift.softenedFrom, 'blocker');

  const running = run('他一小时跑了三百公里。', { tier: 'speculative' });
  const f = running.findings.find((x) => x.ruleId === 'PHY-002');
  assert.equal(f.severity, 'blocker', '人体生理规则即使架空也照原档判');
  assert.equal(f.softenedFrom, null);
});

test('标尺筛选：规则可被 selectRules 按 tiers 过滤', () => {
  assert.equal(selectRules(rules, { tier: 'realistic' }).length, rules.length);
  assert.equal(selectRules(rules, { tier: 'speculative' }).length, rules.length);
  assert.equal(selectRules(rules, { tier: '不存在的标尺' }).length, rules.length); // 非法值回落 realistic
});

test('blocker 会直接导致 fail 结论', () => {
  const res = run('他一小时跑了三百公里。');
  assert.equal(decideVerdict(res.findings, res.checklist).verdict, 'fail');
});
