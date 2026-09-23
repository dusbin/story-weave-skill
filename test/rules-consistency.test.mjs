/**
 * test/rules-consistency.test.mjs — 前后一致性规则（NUM）的命中/不命中测试。
 *
 * 这是全库最要紧的一类，所以"不应命中"的用例最多：
 *   - 人数变了但写了交代（又添了个女儿）；
 *   - 年龄不同但处在不同时间点（小时候）；
 *   - 山顶积雪与山下荷花（地域/海拔差异）；
 *   - 后来学会了游泳（能力有来历）；
 *   - 「手机没电了」不等于全村停电。
 *
 * 另外统一断言：本模块所有规则 overridable === false（矛盾永远不是设定自由）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules } from '../lib/commonsense/engine.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';
import consistency from '../lib/commonsense/rules/consistency.mjs';

const { meta, rules } = consistency;
const rule = (id) => rules.find((r) => r.id === id);

function ctxOf(text, { tier = 'realistic' } = {}) {
  return buildRuleContext({
    story: { kind: 'story', text },
    analysis: { standard: { tier }, world: { rules: [] } },
  });
}

function run(id, text, opts) {
  return runRules({ rules: [rule(id)], ctx: ctxOf(text, opts) });
}
const fire = (id, text, opts) => run(id, text, opts).findings;
const asked = (id, text, opts) => run(id, text, opts).checklist;

/* ------------------------------------------------------------------ 模块契约 */

test('consistency：导出格式与规则契约', () => {
  assert.equal(meta.module, 'consistency');
  assert.equal(meta.name, '前后一致性');
  assert.ok(rules.length >= 8 && rules.length <= 14, `规则条数应在 8–14，实际 ${rules.length}`);

  for (const r of rules) {
    assert.match(r.id, /^NUM-\d{3}$/, `${r.id} 前缀/格式不对`);
    assert.equal(r.category, '前后一致性');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 含非法值 ${t}`);
    assert.ok(typeof r.check === 'function' || typeof r.ask === 'string', `${r.id} 既无 check 也无 ask`);
    assert.ok(r.why.length > 10 && r.fix.length > 5, `${r.id} why/fix 太短`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'id 有重复');
});

test('consistency：矛盾类规则全部 overridable:false（架空设定也不能自相矛盾）', () => {
  for (const r of rules) {
    assert.equal(r.overridable, false, `${r.id} 属前后矛盾，必须 overridable:false`);
  }
});

test('consistency：overridable:false 的规则在幻想标尺下不降档', () => {
  const f = fire('NUM-001', '他们一家三口住在城南。\n\n他们一家四口搬去了城北。', { tier: 'speculative' });
  assert.equal(f[0].severity, 'major');
  assert.equal(f[0].softenedFrom, null);
});

/* ------------------------------------------------------------------ NUM-001 */

test('NUM-001 命中：一家三口 → 一家四口', () => {
  const f = fire('NUM-001', '他们一家三口住在城南。\n\n他们一家四口搬去了城北。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
  assert.ok(f[0].quote.includes('四口'));
});

test('NUM-001 命中：他们三个 → 他们四个', () => {
  const f = fire('NUM-001', '他们三个一起进了山。\n\n天黑之前，他们四个人才走到山口。');
  assert.equal(f.length, 1);
});

test('NUM-001 不命中：写了人数变化的交代', () => {
  assert.equal(fire('NUM-001', '他们一家三口住在城南。\n\n后来他们一家四口搬去了城北，因为又添了个女儿。').length, 0);
});

test('NUM-001 不命中：只有一处人数说法', () => {
  assert.equal(fire('NUM-001', '他们三个是同学，关系一直很好。').length, 0);
});

/* ------------------------------------------------------------------ NUM-002 */

test('NUM-002 命中：同一姓名两个年龄', () => {
  const f = fire('NUM-002', '林川今年三十岁，还没有成家。\n\n厂里的人都还记得，林川今年四十岁。');
  assert.equal(f.length, 1);
  assert.ok(f[0].message.includes('林川'));
});

test('NUM-002 不命中：时间跳跃（小时候）', () => {
  assert.equal(fire('NUM-002', '林川今年三十岁。\n\n小时候林川才五岁，就已经会做饭了。').length, 0);
});

test('NUM-002 不命中：只有一个年龄陈述', () => {
  assert.equal(fire('NUM-002', '林川今年三十岁，在城里做木匠。').length, 0);
});

/* ------------------------------------------------------------------ NUM-003 */

test('NUM-003 命中：同一姓名既写男孩又写女孩', () => {
  const f = fire('NUM-003', '小明是个男孩，整天在院子里跑。\n\n邻居们都说，小明是个女孩。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('NUM-003 不命中：不同人物的性别描述', () => {
  assert.equal(fire('NUM-003', '小明是个男孩。\n\n小美是个女孩。').length, 0);
});

test('NUM-003 不命中：只用代词时不判（无法确认指代）', () => {
  assert.equal(fire('NUM-003', '他是个男孩。\n\n她是个女孩。').length, 0);
});

/* ------------------------------------------------------------------ NUM-004 */

test('NUM-004 命中：唯一的一把钥匙 → 两把钥匙', () => {
  const f = fire('NUM-004', '他用唯一的一把钥匙锁上门。\n\n第二天他掏出两把钥匙，递给同伴一把。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('NUM-004 不命中：后来配了新的钥匙', () => {
  assert.equal(fire('NUM-004', '他用唯一的一把钥匙锁上门。\n\n后来他又配了一把新的钥匙。').length, 0);
});

/* ------------------------------------------------------------------ NUM-005 */

test('NUM-005 命中：暴雨之后立刻晴空万里', () => {
  const f = fire('NUM-005', '屋外暴雨如注。\n\n阳光明媚，万里无云。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('NUM-005 不命中：有「第二天」过渡', () => {
  assert.equal(fire('NUM-005', '屋外暴雨如注。\n\n第二天一早，阳光明媚，万里无云。').length, 0);
});

test('NUM-005 命中：矛盾写在同一句里', () => {
  assert.equal(fire('NUM-005', '屋外暴雨如注，天色却晴空万里，万里无云。').length, 1);
});

/* ------------------------------------------------------------------ NUM-006 */

test('NUM-006 命中：大雪与蝉鸣同场', () => {
  const f = fire('NUM-006', '大雪纷飞，他裹紧了棉衣。\n\n蝉鸣声从院里的树上传来。');
  assert.equal(f.length, 1);
});

test('NUM-006 不命中：地域/回忆交代', () => {
  assert.equal(fire('NUM-006', '大雪纷飞，他裹紧了棉衣。\n\n他想起那年夏天游泳的日子。').length, 0);
});

/* ------------------------------------------------------------------ NUM-007 */

test('NUM-007 命中：困了三天三夜却写「第二天」', () => {
  const f = fire('NUM-007', '他被困在山洞里三天三夜，靠着一壶水撑着。\n\n第二天早上，救援队终于找到了他。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('NUM-007 不命中：没有持续时间', () => {
  assert.equal(fire('NUM-007', '他被困在山洞里。\n\n第二天早上，救援队找到了他。').length, 0);
});

test('NUM-007 不命中：写成第四天就对了', () => {
  assert.equal(fire('NUM-007', '他昏迷了三天三夜。\n\n第四天早上，他终于醒了。').length, 0);
});

/* ------------------------------------------------------------------ NUM-008 */

test('NUM-008 命中：不会游泳却下水救人', () => {
  const f = fire('NUM-008', '他从小就不会游泳，连水都不敢下。\n\n那年夏天，他跳进河里游了过去，把她救了上来。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('NUM-008 不命中：中间写了学会', () => {
  assert.equal(fire('NUM-008', '他不会游泳，连水都不敢下。\n\n后来他学会了游泳，才敢跳进河里。').length, 0);
});

test('NUM-008 不命中：主语不是同一个人', () => {
  assert.equal(fire('NUM-008', '她不会游泳，只能站在岸边。\n\n他跳进河里游了过去，把她救了上来。').length, 0);
});

/* ------------------------------------------------------------------ NUM-009 */

test('NUM-009 命中：已死的人后文正常出场', () => {
  const f = fire('NUM-009', '林川三年前就死了。\n\n林川站在门口，笑着说：「我回来了。」');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('NUM-009 不命中：交代了双胞胎', () => {
  assert.equal(fire('NUM-009', '林川三年前就死了。\n\n站在门口的是林川的双胞胎弟弟。').length, 0);
});

test('NUM-009 不命中：遗像（不是活人出场）', () => {
  assert.equal(fire('NUM-009', '林川三年前就死了。\n\n墙上挂着林川的遗像，落了一层灰。').length, 0);
});

test('NUM-009 命中：已死与出场写在同一句里', () => {
  assert.equal(fire('NUM-009', '林川三年前就死了，可昨天有人看见林川站在桥头说话。').length, 1);
});

/* ------------------------------------------------------------------ NUM-010 */

test('NUM-010 命中：村里停电却开电灯', () => {
  const f = fire('NUM-010', '村里停电已经三天了，井水都得靠人挑。\n\n晚上他打开电灯，坐在桌前看书。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('NUM-010 不命中：写了来电', () => {
  assert.equal(fire('NUM-010', '村里停电已经三天了。\n\n今天终于来电，他打开电灯看书。').length, 0);
});

test('NUM-010 不命中：手机没电不等于停电', () => {
  assert.equal(fire('NUM-010', '他的手机没电了，急着找充电器。\n\n他打开电灯，把抽屉翻了个遍。').length, 0);
});

test('NUM-010 命中：停电与用电写在同一句里', () => {
  assert.equal(fire('NUM-010', '村里停电已经三天了，晚上他还是打开电灯看书。').length, 1);
});

test('NUM-006 命中：冬夏特征写在同一句里', () => {
  assert.equal(fire('NUM-006', '大雪纷飞的日子里，院子里的蝉鸣声格外清楚。').length, 1);
});

/* ------------------------------------------------------------------ NUM-011 / NUM-012（ask） */

test('NUM-011 转为清单项：姓名后出现代词时提问', () => {
  const list = asked('NUM-011', '林川他把门关上，谁也没说话。');
  assert.equal(list.length, 1);
  assert.ok(list[0].question.includes('他') && list[0].question.includes('她'));
});

test('NUM-011 不触发：没有人名紧邻代词', () => {
  assert.equal(asked('NUM-011', '雨下了一整夜，他一直没睡。').length, 0);
});

test('NUM-012 转为清单项：出现小名/化名线索时提问', () => {
  const list = asked('NUM-012', '他有个小名，只有他娘才这么叫他。');
  assert.equal(list.length, 1);
  assert.ok(list[0].question.includes('姓名') || list[0].question.includes('称呼'));
});

test('NUM-012 不触发：没有姓名线索', () => {
  assert.equal(asked('NUM-012', '雨下了一整夜，他一直没有睡。').length, 0);
});
