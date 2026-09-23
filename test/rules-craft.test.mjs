/**
 * test/rules-craft.test.mjs — 叙事逻辑检查清单（CRAFT）测试。
 *
 * 这一模块**不应产出任何 finding**（全部是 ask），测试有三层：
 *   1. 契约：全部有 ask、全部没有 check、问题具体到可回答；
 *   2. 行为：命中触发词 → 变成 checklist 项（含证据）；无触发词 → 不出现；
 *   3. 边界：runRules 只跑 craft 模块时 findings 必须为空数组。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules } from '../lib/commonsense/engine.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';
import craft from '../lib/commonsense/rules/craft.mjs';

const { meta, rules } = craft;
const rule = (id) => rules.find((r) => r.id === id);

function ctxOf(text, { tier = 'realistic' } = {}) {
  return buildRuleContext({
    story: { kind: 'story', text },
    analysis: { standard: { tier }, world: { rules: [] } },
  });
}

const runAll = (text, opts) => runRules({ rules, ctx: ctxOf(text, opts) });
const runOne = (id, text, opts) => runRules({ rules: [rule(id)], ctx: ctxOf(text, opts) });

/* ------------------------------------------------------------------ 契约 */

test('craft：导出格式与规则契约', () => {
  assert.equal(meta.module, 'craft');
  assert.equal(meta.name, '叙事逻辑');
  assert.equal(meta.standard, 'real'); // 与全库其它模块的 meta 约定一致（语义归属看 rule.standard）
  assert.ok(rules.length >= 10 && rules.length <= 16, `规则条数应在 10–16，实际 ${rules.length}`);

  for (const r of rules) {
    assert.match(r.id, /^CRAFT-\d{3}$/, `${r.id} 前缀/格式不对`);
    assert.equal(r.category, '叙事逻辑');
    assert.equal(r.standard, 'internal', `${r.id} 属内部一致性，rule.standard 应为 internal`);
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 含非法值 ${t}`);
    assert.equal(typeof r.overridable, 'boolean', `${r.id} 必须显式声明 overridable`);
    assert.equal(typeof r.check, 'undefined', `${r.id} 不应有 check（本模块全部交给模型判断）`);
    assert.equal(typeof r.ask, 'string', `${r.id} 缺少 ask`);
    assert.ok(r.why.length > 15 && r.fix.length > 5, `${r.id} why/fix 太短`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'id 有重复');
});

test('craft：ask 必须是具体、可回答的问题（问句 + 要求指出原文）', () => {
  for (const r of rules) {
    assert.ok(r.ask.length >= 30, `${r.id} 的问题太短，模型难以给出可用答案`);
    assert.ok(/[？?]/.test(r.ask), `${r.id} 的问题应以问句收束`);
    assert.ok(/(指出|列出|回答|确认|概括|统计|检查)/.test(r.ask), `${r.id} 的问题应要求给出可核对的答复`);
  }
});

/* ------------------------------------------------------------------ 行为：转为清单项 */

test('craft：命中触发词 → 转为 checklist 项，并带原文证据', () => {
  const { findings, checklist } = runOne('CRAFT-004', '就在这时，一辆车恰好停在门口，救兵来了。');
  assert.equal(findings.length, 0);
  assert.equal(checklist.length, 1);
  assert.equal(checklist[0].id, 'q-CRAFT-004');
  assert.equal(checklist[0].ruleId, 'CRAFT-004');
  assert.ok(checklist[0].question.length > 20);
  assert.ok(checklist[0].hint.length > 5, '清单项应带上 fix 作为提示');
  assert.ok(checklist[0].evidence.length >= 1);
  assert.ok(checklist[0].evidence[0].quote.length > 0);
  assert.ok(checklist[0].evidence[0].line >= 1);
  assert.equal(checklist[0].verdict, null);
  assert.equal(checklist[0].answer, null);
});

test('craft：无触发词 → 该规则不进入清单（预筛生效）', () => {
  assert.equal(runOne('CRAFT-004', '他推开门，屋里很暗，桌上放着半杯凉茶。').checklist.length, 0);
});

test('craft：有对白时提问对话是否合身份', () => {
  const { checklist } = runOne('CRAFT-007', '「你懂什么。」他低声说。');
  assert.equal(checklist.length, 1);
  assert.ok(checklist[0].question.includes('对白') || checklist[0].question.includes('说话人'));
});

test('craft：时间跳跃标记会触发场景过渡的检查', () => {
  const { checklist } = runOne('CRAFT-010', '三天后，他站在了另一个城市的站台上。');
  assert.equal(checklist.length, 1);
  assert.ok(checklist[0].question.includes('场景切换'));
});

/* ------------------------------------------------------------------ 行为：全量运行 */

test('craft：全量运行不产出任何 finding（只有清单）', () => {
  const text = [
    '他突然决定离开这座城市。恰好那天下午，老同学打来了电话。',
    '于是第二天一早，他就上了火车。原来父亲早就知道这件事。',
    '多年以后，他站在站台上，泪流满面。',
  ].join('\n\n');
  const { findings, checklist } = runAll(text);
  assert.equal(findings.length, 0, 'craft 模块不应产出确定性判定');
  assert.ok(checklist.length >= 5, `应当命中多条清单项，实际 ${checklist.length}`);
  // 每条规则最多一条清单项
  const ids = checklist.map((c) => c.ruleId);
  assert.equal(new Set(ids).size, ids.length, '同一规则不应重复入清单');
});

test('craft：清单项覆盖到多条不同规则（不是只命中一条）', () => {
  const text = '就在这时，救兵及时赶到。他突然哭了出来。与此同时，另一边的电话响了。';
  const { checklist } = runAll(text);
  assert.ok(checklist.length >= 3);
  assert.ok(checklist.some((c) => c.ruleId === 'CRAFT-004'));
  assert.ok(checklist.some((c) => c.ruleId === 'CRAFT-012'));
});

test('craft：幻想标尺下同样会提问（叙事逻辑与标尺无关）', () => {
  const { checklist } = runOne('CRAFT-003', '他一反常态，把刀收了回去。', { tier: 'speculative' });
  assert.equal(checklist.length, 1);
  assert.equal(checklist[0].verdict, null);
});

test('craft：无任何叙事线索的段落不产生清单项（14 条规则集体不触发）', () => {
  const text = '院子里有一棵枣树。风把叶子吹得沙沙响。屋檐下的水滴落在青石板上。';
  const { findings, checklist } = runAll(text);
  assert.equal(findings.length, 0);
  assert.equal(checklist.length, 0, `不该命中任何清单项，实际命中：${checklist.map((c) => c.ruleId).join(',')}`);
});

/* ------------------------------------------------------------------ 逐条覆盖 */

test('craft：每条规则都有至少一处触发用例（保证清单不会失效）', () => {
  const samples = {
    'CRAFT-001': '他突然决定把房子卖了。',
    'CRAFT-002': '于是事情就这样结束了。',
    'CRAFT-003': '他一反常态，竟然笑了。',
    'CRAFT-004': '恰好这时，救兵赶到了。',
    'CRAFT-005': '他得知了那个秘密。',
    'CRAFT-006': '多年以后，他终于回到了这里。',
    'CRAFT-007': '「你到底要干什么？」',
    'CRAFT-008': '原来真相是这样。',
    'CRAFT-009': '那枚铜钱此后一直没再出现。',
    'CRAFT-010': '第二天，他们出发了。',
    'CRAFT-011': '一个陌生人递给他一张纸条。',
    'CRAFT-012': '他愣住了，然后突然哭了出来。',
    'CRAFT-013': '偏偏这个时候，凑巧遇上了一场雨。',
    'CRAFT-014': '我看到他站在门口，心想他终于来了。',
  };
  for (const r of rules) {
    const sample = samples[r.id];
    assert.ok(sample, `${r.id} 缺少测试样例`);
    const { checklist } = runOne(r.id, sample);
    assert.equal(checklist.length, 1, `${r.id} 在样例「${sample}」上未进入清单`);
  }
});
