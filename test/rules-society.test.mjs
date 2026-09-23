/**
 * test/rules-society.test.mjs — 社会与制度规则（SOC）的命中/不命中测试。
 *
 * 测试口径：**每条规则至少一个"应命中"和一个"不应命中"**。
 * 不命中的那几条才是真正守住误报率的地方，所以刻意挑了"看起来像、其实合法"的句子
 * （例如"比他小五岁的叔叔"、"临时身份证当天可取"）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRuleContext, runRules } from '../lib/commonsense/engine.mjs';
import { SEVERITY_KEYS, TIER_KEYS } from '../lib/schema.mjs';
import society from '../lib/commonsense/rules/society.mjs';

const { meta, rules } = society;
const rule = (id) => rules.find((r) => r.id === id);
const ids = () => rules.map((r) => r.id);

/** 造一个最小可用的 ctx（story.text 就够，engine 会自己切 segment） */
function ctxOf(text, { tier = 'realistic', era = null } = {}) {
  return buildRuleContext({
    story: { kind: 'story', text },
    analysis: { standard: { tier }, world: era ? { era } : { rules: [] } },
  });
}

/** 只跑这一条规则，隔离干扰 */
function fire(id, text, opts) {
  const r = rule(id);
  return runRules({ rules: [r], ctx: ctxOf(text, opts) }).findings;
}

/* ------------------------------------------------------------------ 模块契约 */

test('society：导出格式与规则契约', () => {
  assert.equal(meta.module, 'society');
  assert.equal(meta.name, '社会与制度');
  assert.equal(typeof meta.standard, 'string');
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length >= 8 && rules.length <= 14, `规则条数应在 8–14，实际 ${rules.length}`);

  for (const r of rules) {
    assert.match(r.id, /^SOC-\d{3}$/, `${r.id} 前缀/格式不对`);
    assert.equal(r.category, '社会与制度');
    assert.ok(SEVERITY_KEYS.includes(r.severity), `${r.id} severity 非法`);
    assert.ok(Array.isArray(r.tiers) && r.tiers.length > 0, `${r.id} 缺 tiers`);
    for (const t of r.tiers) assert.ok(TIER_KEYS.includes(t), `${r.id} tiers 含非法值 ${t}`);
    assert.equal(typeof r.overridable, 'boolean', `${r.id} 必须显式声明 overridable`);
    assert.ok(typeof r.title === 'string' && r.title.length > 0, `${r.id} 缺 title`);
    assert.ok(typeof r.why === 'string' && r.why.length > 10, `${r.id} why 太短，报告里给作者看不够`);
    assert.ok(typeof r.fix === 'string' && r.fix.length > 5, `${r.id} fix 太短`);
    // 有 check 就得有 trigger（否则每次全量跑），或显式不写 trigger 表示必跑
    assert.ok(typeof r.check === 'function' || typeof r.ask === 'string', `${r.id} 既无 check 也无 ask`);
  }
  assert.equal(new Set(ids()).size, rules.length, 'id 有重复');
});

test('society：现实制度类规则应为 overridable: true（架空世界可以有自己的制度）', () => {
  for (const r of rules) {
    assert.equal(r.overridable, true, `${r.id} 属于现实制度，应允许架空设定覆盖`);
  }
});

/* ------------------------------------------------------------------ SOC-001 */

test('SOC-001 命中：无医生却宣告死亡', () => {
  const f = fire('SOC-001', '村长探了探他的鼻息，当众宣布他已经死亡。');
  assert.equal(f.length, 1);
  assert.equal(f[0].ruleId, 'SOC-001');
  assert.ok(f[0].line >= 1 && f[0].quote.length > 0);
});

test('SOC-001 不命中：医生到场后认定死亡', () => {
  assert.equal(fire('SOC-001', '医生赶到后确认他已经死亡，并开出了死亡证明。').length, 0);
});

test('SOC-001 不命中：比喻用法（心里宣布自己死亡）', () => {
  assert.equal(fire('SOC-001', '他在心里宣布了自己的死亡，然后转身离开。').length, 0);
});

/* ------------------------------------------------------------------ SOC-002 */

test('SOC-002 命中：DNA 当场比对完就抓人', () => {
  const f = fire('SOC-002', '警察当场做完了 DNA 比对，随即抓走了他。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('SOC-002 不命中：写了鉴定等待时间', () => {
  assert.equal(fire('SOC-002', '三天后，DNA 鉴定结果出来了，警察才动手抓人。').length, 0);
});

test('SOC-002 不命中：只是提到比对，没有即时性', () => {
  assert.equal(fire('SOC-002', '他把两段文字做了比对，没发现异常。').length, 0);
});

/* ------------------------------------------------------------------ SOC-003 */

test('SOC-003 命中：A 型血直接输给 B 型血', () => {
  const f = fire('SOC-003', '医生把 A 型血输给了 B 型血的他。');
  assert.equal(f.length, 1);
});

test('SOC-003 不命中：AB 型受血（与 A/B 相容）', () => {
  assert.equal(fire('SOC-003', 'AB 型血的他接受了 A 型血的输血。').length, 0);
});

test('SOC-003 不命中：O 型供血', () => {
  assert.equal(fire('SOC-003', 'O 型血可以输给 A 型血的人，这是常识。').length, 0);
});

/* ------------------------------------------------------------------ SOC-004 */

test('SOC-004 命中：不用处方就能买抗生素', () => {
  const f = fire('SOC-004', '那家药店不用处方就能买到抗生素。');
  assert.equal(f.length, 1);
});

test('SOC-004 不命中：有处方的正规流程', () => {
  assert.equal(fire('SOC-004', '医生开了处方，他在医院药房取到了抗生素。').length, 0);
});

/* ------------------------------------------------------------------ SOC-005 */

test('SOC-005 命中：十七岁独自签购房合同', () => {
  const f = fire('SOC-005', '十七岁的他在购房合同上签下了自己的名字。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('SOC-005 不命中：有父母陪同', () => {
  assert.equal(fire('SOC-005', '十七岁的他在父母的陪同下签下了购房合同。').length, 0);
});

test('SOC-005 不命中：成年后签约', () => {
  assert.equal(fire('SOC-005', '三十岁的他签下了购房合同。').length, 0);
});

/* ------------------------------------------------------------------ SOC-006 */

test('SOC-006 命中：一顿饭三万块', () => {
  const f = fire('SOC-006', '他在路边摊一顿饭花了三万块钱。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'minor');
});

test('SOC-006 不命中：正常物价', () => {
  assert.equal(fire('SOC-006', '他在路边摊一顿饭花了三十块钱。').length, 0);
});

test('SOC-006 不命中：外币语境（三万日元）', () => {
  assert.equal(fire('SOC-006', '他在东京一顿饭花了三万日元。').length, 0);
});

/* ------------------------------------------------------------------ SOC-007 */

test('SOC-007 命中：记者调取通话记录', () => {
  const f = fire('SOC-007', '那个记者第二天就拿到了她的通话记录。');
  assert.equal(f.length, 1);
});

test('SOC-007 不命中：刑警依法调取', () => {
  assert.equal(fire('SOC-007', '刑警老陈依法调取了她的通话记录。').length, 0);
});

test('SOC-007 不命中：没写明调取主体时不下判', () => {
  assert.equal(fire('SOC-007', '他拿到了她的通话记录，手心全是汗。').length, 0);
});

/* ------------------------------------------------------------------ SOC-008 */

test('SOC-008 命中：警察出境直接抓人', () => {
  const f = fire('SOC-008', '两名警察出国，在境外把嫌疑人抓回了国内。');
  assert.equal(f.length, 1);
});

test('SOC-008 不命中：写了国际刑警协作', () => {
  assert.equal(fire('SOC-008', '警方通过国际刑警协作，在境外把人押回国内。').length, 0);
});

/* ------------------------------------------------------------------ SOC-009 */

test('SOC-009 命中：仅凭一面之词定罪', () => {
  const f = fire('SOC-009', '法官仅凭一面之词就判了他十年。');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'major');
});

test('SOC-009 不命中：有物证', () => {
  assert.equal(fire('SOC-009', '法官根据现场物证判了他十年。').length, 0);
});

/* ------------------------------------------------------------------ SOC-010 */

test('SOC-010 命中：警察直接判刑', () => {
  const f = fire('SOC-010', '警察当场判了他三年。');
  assert.equal(f.length, 1);
});

test('SOC-010 不命中：移送法院后判决', () => {
  assert.equal(fire('SOC-010', '警察把他移送法院，法官判了他三年。').length, 0);
});

test('SOC-010 不命中：「判断」不是量刑', () => {
  assert.equal(fire('SOC-010', '警察判断错了方向，追了三天也没找到人。').length, 0);
});

/* ------------------------------------------------------------------ SOC-011 */

test('SOC-011 命中：身份证当天办结', () => {
  const f = fire('SOC-011', '他去派出所补办身份证，当天就拿到了新证。');
  assert.equal(f.length, 1);
});

test('SOC-011 不命中：写了两周', () => {
  assert.equal(fire('SOC-011', '他去派出所补办身份证，两周后才拿到。').length, 0);
});

test('SOC-011 不命中：临时证件可以当天取', () => {
  assert.equal(fire('SOC-011', '他当天就拿到了临时身份证。').length, 0);
});

/* ------------------------------------------------------------------ SOC-012 */

test('SOC-012 命中：医院因没交钱拒绝抢救', () => {
  const f = fire('SOC-012', '医院因为他没交钱就拒绝抢救。');
  assert.equal(f.length, 1);
});

test('SOC-012 不命中：先抢救后催费', () => {
  assert.equal(fire('SOC-012', '医院先给他做了急救，家属随后补交了押金。').length, 0);
});

/* ------------------------------------------------------------------ SOC-013 */

test('SOC-013 命中：月薪三千却花五十万', () => {
  const f = fire('SOC-013', '他月薪三千元，却花五十万元买了一辆跑车。');
  assert.equal(f.length, 1);
});

test('SOC-013 不命中：收入量级相称', () => {
  assert.equal(fire('SOC-013', '他月薪三万元，花五十万元买了一辆跑车。').length, 0);
});

test('SOC-013 不命中：交代了贷款来源', () => {
  assert.equal(fire('SOC-013', '他月薪三千元，贷款五十万元买了房。').length, 0);
});

/* ------------------------------------------------------------------ SOC-014 */

test('SOC-014 命中：救护车不到一分钟到场', () => {
  const f = fire('SOC-014', '他刚拨通120，救护车不到一分钟就赶到了楼下。');
  assert.equal(f.length, 1);
});

test('SOC-014 不命中：十几分钟到场', () => {
  assert.equal(fire('SOC-014', '救护车十分钟后赶到，把他送去了医院。').length, 0);
});

/* ------------------------------------------------------------------ 标尺行为 */

test('society：幻想标尺下 overridable 的规则自动降一档', () => {
  const text = '警察当场做完了 DNA 比对，随即抓走了他。';
  const realistic = fire('SOC-002', text, { tier: 'realistic' });
  const speculative = fire('SOC-002', text, { tier: 'speculative' });
  assert.equal(realistic[0].severity, 'major');
  assert.equal(speculative[0].severity, 'minor');
  assert.equal(speculative[0].softenedFrom, 'major');
});
