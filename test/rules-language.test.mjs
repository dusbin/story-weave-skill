/**
 * test/rules-language.test.mjs — 称谓、亲属关系与用语规则（LANG）的命中/不命中测试。
 *
 * 这一模块最容易误报，所以"不应命中"的用例刻意挑了三类合法情形：
 *   - 辈分大于年龄（比他小五岁的叔叔）——现实中很常见；
 *   - 时间状语限定（父亲去世后，他扛起了这个家）——后面的"他"不是死者；
 *   - 继父母/养子女——年龄差不适用亲生的生理下限。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules } from '../lib/commonsense/engine.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';
import language from '../lib/commonsense/rules/language.mjs';

const { meta, rules } = language;
const rule = (id) => rules.find((r) => r.id === id);

function ctxOf(text, { tier = 'realistic', era = null } = {}) {
  return buildRuleContext({
    story: { kind: 'story', text },
    analysis: { standard: { tier }, world: era ? { era } : { rules: [] } },
  });
}

function run(id, text, opts) {
  return runRules({ rules: [rule(id)], ctx: ctxOf(text, opts) });
}
const fire = (id, text, opts) => run(id, text, opts).findings;
const asked = (id, text, opts) => run(id, text, opts).checklist;

/* ------------------------------------------------------------------ 模块契约 */

test('language：导出格式与规则契约', () => {
  assert.equal(meta.module, 'language');
  assert.equal(meta.name, '称谓与用语');
  assert.ok(rules.length >= 8 && rules.length <= 14, `规则条数应在 8–14，实际 ${rules.length}`);

  for (const r of rules) {
    assert.match(r.id, /^LANG-\d{3}$/, `${r.id} 前缀/格式不对`);
    assert.equal(r.category, '称谓与用语');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 含非法值 ${t}`);
    assert.equal(typeof r.overridable, 'boolean', `${r.id} 必须显式声明 overridable`);
    assert.ok(typeof r.check === 'function' || typeof r.ask === 'string', `${r.id} 既无 check 也无 ask`);
    assert.ok(r.why.length > 10 && r.fix.length > 5, `${r.id} why/fix 太短`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'id 有重复');
});

test('language：亲属关系类矛盾 overridable:false；年代/语域类允许设定覆盖', () => {
  for (const id of ['LANG-001', 'LANG-002', 'LANG-003', 'LANG-004', 'LANG-005', 'LANG-008', 'LANG-009']) {
    assert.equal(rule(id).overridable, false, `${id} 涉及亲属关系矛盾，不应允许架空覆盖`);
  }
  for (const id of ['LANG-006', 'LANG-007', 'LANG-010']) {
    assert.equal(rule(id).overridable, true, `${id} 与年代/语域有关，应允许设定覆盖`);
  }
});

/* ------------------------------------------------------------------ LANG-001 */

test('LANG-001 命中：比他大二十岁的弟弟', () => {
  const f = fire('LANG-001', '比他大二十岁的弟弟站在门口，手里拎着一个旧皮箱。');
  assert.equal(f.length, 1);
  assert.equal(f[0].ruleId, 'LANG-001');
});

test('LANG-001 命中：弟弟比他大二十岁（语序相反）', () => {
  assert.equal(fire('LANG-001', '这个弟弟比他大二十岁，却总叫他哥。').length, 1);
});

test('LANG-001 不命中：比他大二十岁的哥哥是正常的', () => {
  assert.equal(fire('LANG-001', '比他大二十岁的哥哥站在门口。').length, 0);
});

test('LANG-001 不命中：弟弟比他小二十岁（方向正确）', () => {
  assert.equal(fire('LANG-001', '弟弟比他小二十岁，今年刚上小学。').length, 0);
});

test('LANG-001 不命中：辈分大于年龄是合法的', () => {
  assert.equal(fire('LANG-001', '他那个比他小五岁的叔叔，在族里辈分却最高。').length, 0);
});

test('LANG-001 不命中：他比弟弟大二十岁（正确表述）', () => {
  assert.equal(fire('LANG-001', '他比弟弟大二十岁，一直把这个弟弟当儿子养。').length, 0);
});

/* ------------------------------------------------------------------ LANG-002（ask） */

test('LANG-002 转为清单项：出现多层称谓时提问', () => {
  const list = asked('LANG-002', '他侄子的爷爷当年也是这般脾气。');
  assert.equal(list.length, 1);
  assert.equal(list[0].ruleId, 'LANG-002');
  assert.ok(list[0].question.includes('亲属称谓'));
  assert.ok(list[0].evidence.length >= 1);
  assert.equal(list[0].verdict, null);
});

test('LANG-002 不触发：没有任何多层称谓', () => {
  assert.equal(asked('LANG-002', '他一个人走在雨里，什么也没想。').length, 0);
});

/* ------------------------------------------------------------------ LANG-003 */

test('LANG-003 命中：同一段里既称哥哥又称弟弟', () => {
  const f = fire('LANG-003', '他说他是我哥哥，又说他是我弟弟。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor'); // 只用代词，可能是两个人 → 从严判 minor
});

test('LANG-003 命中：用姓名时判 major', () => {
  const f = fire('LANG-003', '林川是他哥哥，林川是他弟弟。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('LANG-003 不命中：不同主语各是一个称谓', () => {
  assert.equal(fire('LANG-003', '他是我哥哥，她是我弟弟。').length, 0);
});

test('LANG-003 不命中：非互斥关系（哥哥与朋友）', () => {
  assert.equal(fire('LANG-003', '他是我哥哥，也是我最好的朋友。').length, 0);
});

/* ------------------------------------------------------------------ LANG-004（ask） */

test('LANG-004 转为清单项：出现称谓词时提问是否混用', () => {
  const list = asked('LANG-004', '嫂子把菜端上桌，笑着说多吃点。');
  assert.equal(list.length, 1);
  assert.ok(list[0].question.includes('称谓'));
});

test('LANG-004 不触发：文本里没有称谓词', () => {
  assert.equal(asked('LANG-004', '雨下了整整一夜。').length, 0);
});

/* ------------------------------------------------------------------ LANG-005 */

test('LANG-005 命中：奶奶已去世又被写成在世动作（代词指代 → minor）', () => {
  const f = fire('LANG-005', '奶奶去世三年了，她还坐在门口择菜等他回来。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
  assert.ok(f[0].message.includes('若这里的'));
});

test('LANG-005 命中：用同一称谓重申 → 指代唯一，判 major', () => {
  const f = fire('LANG-005', '奶奶去世三年了，奶奶还坐在门口择菜等他回来。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('LANG-005 不命中：时间状语限定（父亲去世后…）', () => {
  assert.equal(fire('LANG-005', '父亲去世后，他扛起了这个家。').length, 0);
});

test('LANG-005 不命中：动作执行者是别人（奶奶去世了，他哭了一整夜）', () => {
  assert.equal(fire('LANG-005', '奶奶去世了，他哭了一整夜。').length, 0);
});

test('LANG-005 不命中：后继句是活人的打算（爷爷去世了，他说要继承家业）', () => {
  assert.equal(fire('LANG-005', '爷爷去世了，他说要继承家业。').length, 0);
});

/* ------------------------------------------------------------------ LANG-006 */

test('LANG-006 命中：现代设定里自称「朕」', () => {
  const f = fire('LANG-006', '故事发生在 2015 年。他抬头道：「朕知道了。」');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('LANG-006 不命中：唐朝设定里自称「朕」是合理的', () => {
  assert.equal(fire('LANG-006', '故事发生在唐朝。他抬头道：「朕知道了。」').length, 0);
});

test('LANG-006 不命中：年代不明时不判', () => {
  assert.equal(fire('LANG-006', '他抬头道：「朕知道了。」').length, 0);
});

/* ------------------------------------------------------------------ LANG-007 */

test('LANG-007 命中：唐朝场景里出现打卡/朋友圈', () => {
  const f = fire('LANG-007', '故事发生在唐朝的长安城。他每天都要打卡，还要发朋友圈。');
  assert.equal(f.length, 1);
});

test('LANG-007 不命中：当代场景里用网络用语正常', () => {
  assert.equal(fire('LANG-007', '故事发生在 2020 年。他每天都要打卡，还要发朋友圈。').length, 0);
});

/* ------------------------------------------------------------------ LANG-008 */

test('LANG-008 命中：父亲三十岁、儿子二十五岁', () => {
  const f = fire('LANG-008', '父亲今年三十岁，儿子今年二十五岁。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('LANG-008 不命中：年龄差正常', () => {
  assert.equal(fire('LANG-008', '父亲今年五十岁，儿子今年二十五岁。').length, 0);
});

test('LANG-008 不命中：继父不适用亲生生育下限', () => {
  assert.equal(fire('LANG-008', '继父今年三十岁，儿子今年二十五岁。').length, 0);
});

/* ------------------------------------------------------------------ LANG-009 */

test('LANG-009 命中：嫂子其实就是姐姐', () => {
  const f = fire('LANG-009', '他嫂子其实就是他姐姐，这事他一直没对外说。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('LANG-009 不命中：表姐可以是同一个人（旁支关系）', () => {
  assert.equal(fire('LANG-009', '他嫂子其实就是他表姐。').length, 0);
});

test('LANG-009 不命中：只是比喻（像姐姐一样）', () => {
  assert.equal(fire('LANG-009', '他嫂子对他就像亲姐姐一样。').length, 0);
});

/* ------------------------------------------------------------------ LANG-010（ask） */

test('LANG-010 转为清单项：有对白时提问称呼是否合身份', () => {
  const list = asked('LANG-010', '「你懂什么！」他冲着老局长喊道。');
  assert.equal(list.length, 1);
  assert.ok(list[0].question.includes('称呼'));
});

test('LANG-010 不触发：没有对白', () => {
  assert.equal(asked('LANG-010', '他走进空无一人的办公室，坐了很久。').length, 0);
});

/* ------------------------------------------------------------------ 标尺行为 */

test('language：亲属矛盾（overridable:false）在幻想标尺下也不降档', () => {
  const f = fire('LANG-001', '比他大二十岁的弟弟站在门口。', { tier: 'speculative' });
  assert.equal(f[0].severity, 'major');
  assert.equal(f[0].softenedFrom, null);
});

test('language：年代类用语问题（overridable:true）在幻想标尺下降一档', () => {
  const f = fire('LANG-007', '故事发生在唐朝的长安城。他每天都要打卡。', { tier: 'speculative' });
  assert.equal(f[0].severity, 'minor');
});
