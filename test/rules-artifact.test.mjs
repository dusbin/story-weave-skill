/**
 * test/rules-artifact.test.mjs — 器物与时代错位规则（ANA）的命中/不命中测试。
 *
 * 重点守两条防线：
 *   1. **年代不明一律不判**（否则"手机"在任何未标年代的文本里都会被误报）；
 *   2. 文言式否定（"这里没有电话"）与夸张比喻（"日行千里"）不算错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules } from '../lib/commonsense/engine.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';
import artifact, { resolveEra } from '../lib/commonsense/rules/artifact.mjs';

const { meta, rules } = artifact;
const rule = (id) => rules.find((r) => r.id === id);

function ctxOf(text, { tier = 'realistic', era = null } = {}) {
  return buildRuleContext({
    story: { kind: 'story', text },
    analysis: { standard: { tier }, world: era ? { era } : { rules: [] } },
  });
}

function fire(id, text, opts) {
  return runRules({ rules: [rule(id)], ctx: ctxOf(text, opts) }).findings;
}

/* ------------------------------------------------------------------ 模块契约 */

test('artifact：导出格式与规则契约', () => {
  assert.equal(meta.module, 'artifact');
  assert.equal(meta.name, '器物与时代');
  assert.ok(rules.length >= 8 && rules.length <= 14, `规则条数应在 8–14，实际 ${rules.length}`);

  for (const r of rules) {
    assert.match(r.id, /^ANA-\d{3}$/, `${r.id} 前缀/格式不对`);
    assert.equal(r.category, '器物与时代');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 含非法值 ${t}`);
    assert.equal(typeof r.overridable, 'boolean', `${r.id} 必须显式声明 overridable`);
    assert.ok(typeof r.check === 'function', `${r.id} 缺 check`);
    assert.ok(r.trigger && (r.trigger.keywords?.length || r.trigger.patterns?.length), `${r.id} 缺 trigger`);
    assert.ok(r.why.length > 10 && r.fix.length > 5, `${r.id} why/fix 太短`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'id 有重复');
});

/* ------------------------------------------------------------------ resolveEra */

test('resolveEra：从 analysis.world.era 取朝代与年份', () => {
  assert.deepEqual(resolveEra(ctxOf('随便一段正文。', { era: '唐朝' })), { from: 618, to: 907, label: '唐' });
  assert.deepEqual(resolveEra(ctxOf('随便一段正文。', { era: '1998年' })), { year: 1998, label: '1998 年' });
  assert.equal(resolveEra(ctxOf('随便一段正文。')), null);
});

test('resolveEra：正文里只有带设定标记的年代才算设定', () => {
  assert.deepEqual(resolveEra(ctxOf('故事发生在唐朝的长安城。')), { from: 618, to: 907, label: '唐' });
  assert.deepEqual(resolveEra(ctxOf('时值 1988 年，胡同里还不富裕。')), { year: 1988, label: '1988 年' });
  // 只是提到某个年代的人，不能把全篇判成那个年代
  assert.equal(resolveEra(ctxOf('他爷爷是清朝人，早就走了。')), null);
});

/* ------------------------------------------------------------------ ANA-001 */

test('ANA-001 命中：唐朝设定里出现手机', () => {
  const f = fire('ANA-001', '长安城的巷子里，他掏出手机给家里打了个电话。', { era: '唐朝' });
  assert.ok(f.length >= 1);
  assert.equal(f[0].ruleId, 'ANA-001');
  assert.match(f[0].message, /手机|电话/);
});

test('ANA-001 不命中：年代不明时不判', () => {
  assert.equal(fire('ANA-001', '他掏出手机给家里打了个电话。').length, 0);
});

test('ANA-001 不命中：清朝与电话（1876 年已有，宁漏勿误）', () => {
  assert.equal(fire('ANA-001', '他拿起电话，摇了摇手柄，接线员接了进来。', { era: '清朝' }).length, 0);
});

test('ANA-001 命中：清朝出现手机（晚于 1912）', () => {
  assert.equal(fire('ANA-001', '他掏出手机看了一眼时间。', { era: '清朝' }).length, 1);
});

test('ANA-001 不命中：否定式交代（没有电话）', () => {
  assert.equal(fire('ANA-001', '这里没有电话，只能靠驿站送信。', { era: '唐朝' }).length, 0);
});

test('ANA-001 不命中：1998 年用手机完全正常', () => {
  assert.equal(fire('ANA-001', '他掏出手机给家里打了个电话。', { era: '1998年' }).length, 0);
});

test('ANA-001 命中：正文带设定标记的年份也能判定', () => {
  const f = fire('ANA-001', '故事发生在 1975 年的北方农村。他掏出一部智能手机，给女儿发了条微信。');
  assert.ok(f.length >= 1);
});

/* ------------------------------------------------------------------ ANA-002 */

test('ANA-002 命中：左轮连开二十枪不换弹', () => {
  const f = fire('ANA-002', '他握着左轮手枪连开了二十枪，对面的人纷纷倒下。');
  assert.equal(f.length, 1);
});

test('ANA-002 不命中：写了换弹', () => {
  assert.equal(fire('ANA-002', '他给左轮手枪换了弹匣，又连开了二十枪。').length, 0);
});

test('ANA-002 不命中：射击次数在容弹量内', () => {
  assert.equal(fire('ANA-002', '他握着手枪连开了三枪。').length, 0);
});

/* ------------------------------------------------------------------ ANA-003 */

test('ANA-003 命中：拔销后握着手雷等三分钟', () => {
  const f = fire('ANA-003', '他拔掉保险销，握着手雷等了三分钟才扔出去。');
  assert.equal(f.length, 1);
});

test('ANA-003 不命中：拔销后立刻投出', () => {
  assert.equal(fire('ANA-003', '他拔掉保险销，立刻把手雷扔了出去。').length, 0);
});

test('ANA-003 不命中：没拔销就长时间握着', () => {
  assert.equal(fire('ANA-003', '他握着手雷等了十分钟，始终没敢拔掉保险销。').length, 0);
});

/* ------------------------------------------------------------------ ANA-004 */

test('ANA-004 命中：纸桥过卡车', () => {
  const f = fire('ANA-004', '他们用纸糊了一座桥，卡车开过去，桥面纹丝不动。');
  assert.equal(f.length, 1);
});

test('ANA-004 不命中：纸桥承重实验', () => {
  assert.equal(fire('ANA-004', '孩子们用纸搭了一座桥做承重实验，最多放了三枚硬币。').length, 0);
});

/* ------------------------------------------------------------------ ANA-005 */

test('ANA-005 命中：头灯连亮三天三夜', () => {
  const f = fire('ANA-005', '他的头灯连续亮了三天三夜，一次电池都没换。');
  assert.equal(f.length, 1);
});

test('ANA-005 不命中：亮了一整夜', () => {
  assert.equal(fire('ANA-005', '手电筒亮了一整夜，天亮时他换上了新电池。').length, 0);
});

/* ------------------------------------------------------------------ ANA-006 */

test('ANA-006 命中：快马日行八百里', () => {
  const f = fire('ANA-006', '他骑快马日行八百里，一天就到了京城。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('ANA-006 不命中：日行百里', () => {
  assert.equal(fire('ANA-006', '他日行百里，走了三天才到。').length, 0);
});

test('ANA-006 不命中：成语式夸张（日行千里）不判', () => {
  assert.equal(fire('ANA-006', '他简直是个日行千里的怪物，传说没人追得上。').length, 0);
});

/* ------------------------------------------------------------------ ANA-007 */

test('ANA-007 命中：无信号却打通了电话', () => {
  const f = fire('ANA-007', '这里是无人区，手机没有信号，可他还是打通了电话。');
  assert.equal(f.length, 1);
});

test('ANA-007 不命中：无信号且通讯失败', () => {
  assert.equal(fire('ANA-007', '这里没有信号，他试了几次都没打通电话。').length, 0);
});

/* ------------------------------------------------------------------ ANA-008 */

test('ANA-008 命中：油箱灌水还能开走', () => {
  const f = fire('ANA-008', '他往油箱里灌了水，汽车居然还是开走了。');
  assert.equal(f.length, 1);
});

test('ANA-008 不命中：加错燃料导致抛锚', () => {
  assert.equal(fire('ANA-008', '他往油箱里灌了水，车子再也发动不起来。').length, 0);
});

/* ------------------------------------------------------------------ ANA-009 */

test('ANA-009 命中：弹弓打穿钢板', () => {
  const f = fire('ANA-009', '他用弹弓打穿了那块钢板。');
  assert.equal(f.length, 1);
});

test('ANA-009 不命中：弹弓打碎玻璃', () => {
  assert.equal(fire('ANA-009', '他用弹弓打碎了窗户上的玻璃。').length, 0);
});

/* ------------------------------------------------------------------ 标尺行为 */

test('artifact：时代错位在幻想标尺下降一档（可能是穿越设定）', () => {
  const f = fire('ANA-001', '长安城的巷子里，他掏出手机打了个电话。', { era: '唐朝', tier: 'speculative' });
  assert.equal(f[0].severity, 'minor');
  assert.equal(f[0].softenedFrom, 'major');
});

test('artifact：枪械容弹量算术 overridable:false，幻想标尺下不降档', () => {
  const f = fire('ANA-002', '他握着左轮手枪连开了二十枪。', { tier: 'speculative' });
  assert.equal(f[0].severity, 'major');
  assert.equal(f[0].softenedFrom, null);
});
