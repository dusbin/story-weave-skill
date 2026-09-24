/**
 * test/genre.test.mjs — 体裁、常识标尺与年代识别。
 *
 * 这一步决定了后面所有校验的口径，判错會导致系统性误判：
 * 把架空当现实 → 飞龙被判成错误；把现实当架空 → 放过真正的常识硬伤。
 * 所以这里既测"该判对的"，也测"证据不足时的兜底姿态"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanSegments } from '../lib/text.mjs';
import { detectGenre, detectEra, buildStandard, GENRES } from '../lib/genre.mjs';

const g = (t) => detectGenre(scanSegments(t));
const e = (t, y) => detectEra(scanSegments(t), t, y);

/* ------------------------------------------------------------------ 体裁 */

test('都市现实向 → 现实标尺', () => {
  const r = g('她加完班走出写字楼，地铁已经停了。手机响了，是老板发来的微信。');
  assert.equal(r.tier, 'realistic');
  assert.equal(r.primary, 'urban');
  assert.ok(r.confidence > 0.5);
});

test('仙侠 → 架空标尺', () => {
  const r = g('他盘膝而坐，体内灵气缓缓流转，金丹已凝。长老说，渡过天劫便可飞升。');
  assert.equal(r.tier, 'speculative');
  assert.equal(r.primary, 'xianxia');
});

test('科幻 → 架空标尺', () => {
  const r = g('飞船跃出光年之外，机器人副官报告：殖民地的人工智能又出现了异常。');
  assert.equal(r.tier, 'speculative');
  assert.equal(r.primary, 'scifi');
});

test('医疗现实向 → 现实标尺', () => {
  const r = g('急诊科的医生推着病人冲进抢救室，护士已经在准备输血，病历上写着失血性休克。');
  assert.equal(r.tier, 'realistic');
  assert.equal(r.primary, 'medical');
});

test('回归：都市重生（现实外壳 + 架空内核）必须判为架空并标出冲突', () => {
  // 曾经的 bug：关键词表里没有「重生/穿越」，于是判成现实标尺，
  // 后面会把"重生带来的先知"当成违反常识来报。
  const r = g('她重生了。回到2010年，她记得那支股票会涨。手机屏幕亮着，微信还在响。');
  assert.equal(r.tier, 'speculative', '有穿越重生内核时应取架空标尺');
  assert.equal(r.conflict, true, '应标记现实/幻想信号冲突');
  assert.ok(r.confidence < 0.9, '存在冲突时置信度应下调');
});

test('没有任何题材信号 → 现实标尺兜底，并明确说明证据不足', () => {
  const r = g('他把杯子放在桌上。');
  assert.equal(r.tier, 'realistic', '证据不足时应站在更严的一侧');
  assert.equal(r.identifiedBy, 'fallback');
  assert.ok(r.note.includes('架空') || r.note.includes('覆盖'), '应提示用户可手动覆盖');
});

test('用户显式指定体裁时采纳并标为 hint', () => {
  const r = detectGenre(scanSegments('他把杯子放在桌上。'), { genreHint: 'xianxia' });
  assert.equal(r.primary, 'xianxia');
  assert.equal(r.identifiedBy, 'hint');
  assert.equal(r.confidence, 1);
});

test('用户显式指定标尺时优先于自动判定', () => {
  const r = detectGenre(scanSegments('灵气流转，金丹已成。'), { tierOverride: 'realistic' });
  assert.equal(r.tier, 'realistic');
  assert.equal(r.identifiedBy, 'tier_override');
});

test('每个体裁都能被关键词命中（防止写了 key 但没有可命中的词）', () => {
  for (const genre of GENRES) {
    assert.ok(Array.isArray(genre.keywords) && genre.keywords.length > 0, `${genre.key} 没有关键词`);
    assert.ok(['realistic', 'speculative'].includes(genre.tier), `${genre.key} 的 tier 非法`);
    const r = detectGenre(scanSegments(genre.keywords.join('，') + '。'));
    assert.equal(r.primary, genre.key, `用自身关键词应能命中 ${genre.key}`);
  }
});

/* ------------------------------------------------------------------ 年代 */

test('回归：未指定年份时不得凭空判出年代', () => {
  // 曾经的 bug：Number(null) === 0 且 isFinite(0) 为真，
  // 于是"没指定"被当成公元 0 年，正好落进秦汉区间 [-221, 220]。
  const r = e('他把杯子放在桌上。', null);
  assert.equal(r.identifiedBy, 'none');
  assert.equal(r.year, null);
  assert.equal(r.label, '未指明');
});

test('明确年份优先于关键词', () => {
  const r = e('2010年的冬天，她回到了江城。');
  assert.equal(r.identifiedBy, 'year');
  assert.equal(r.year, 2010);
  assert.ok(r.label.includes('2010'));
});

test('命令行指定的年份被采纳', () => {
  const r = e('他把杯子放在桌上。', 1998);
  assert.equal(r.year, 1998);
  assert.equal(r.label, '当代（1998 年）');
});

test('朝代关键词能识别年代', () => {
  assert.equal(e('长安城的大街上，节度使的车马缓缓驶过，路边考生正等着科举放榜。').key, 'tang');
  assert.equal(e('康熙年间，八旗子弟在京城里遛鸟。').key, 'qing');
});

test('现代器物词指向当代', () => {
  assert.equal(e('她掏出手机，点开微信，扫了一辆共享单车。').key, 'modern');
});

/* ------------------------------------------------------------------ 标尺说明 */

test('现实标尺说明强调"明确违反即硬伤"', () => {
  const s = buildStandard({ tier: 'realistic', label: '都市情感', identifiedBy: 'auto' }, { label: '当代' });
  assert.equal(s.tier, 'realistic');
  assert.ok(s.reason.includes('现实'));
  assert.ok(s.eraNote.includes('当代'));
});

test('架空标尺说明包含三条边界（设定/人物仍按真人/不自相矛盾）', () => {
  const s = buildStandard({ tier: 'speculative', label: '仙侠修真', identifiedBy: 'auto' }, { label: '未指明' });
  assert.equal(s.tier, 'speculative');
  assert.ok(s.reason.includes('规则'), '应说明"自己立的规则不可违反"');
  assert.ok(s.reason.includes('会饿') || s.reason.includes('真人'), '应说明人物仍按真人判');
  assert.ok(s.reason.includes('自相矛盾'), '应说明数量/时间不得自相矛盾');
  assert.ok(s.eraNote.includes('未指明'), '年代不明时应说明会跳过时代错位检查');
});

/* ------------------------------------------------------------------ 神话/咏史 */

const POEM = `精卫衔微木，将以填沧海。
刑天舞干戚，猛志固常在。
同物既无虑，化去不复悔。
徒设在昔心，良晨讵可待?`;

test('神话/咏史：古诗中的神话语域应判为架空标尺', () => {
  // 曾经的缺口：体裁表里没有神话一类，于是《读山海经》被判成"通用叙事 + 现实标尺"，
  // 后面会把"人化为鸟""无头仍舞"当成违反现实常识来报。
  const r = detectGenre(scanSegments(POEM));
  assert.equal(r.primary, 'myth');
  assert.equal(r.tier, 'speculative');
  assert.ok(r.confidence > 0.8);
  assert.ok(r.note.includes('神话'), '应说明神话语域不算常识错误');
});

test('神话体裁不误伤现实文本', () => {
  const r = detectGenre(scanSegments('她加完班走出写字楼，地铁已经停了。手机响了。'));
  assert.equal(r.tier, 'realistic');
});

test('每个体裁的 tier 都在枚举内（防止新增体裁写错）', () => {
  for (const g of GENRES) {
    assert.ok(['realistic', 'speculative'].includes(g.tier), `${g.key} 的 tier 非法：${g.tier}`);
    assert.ok(g.keywords.length >= 8, `${g.key} 关键词太少，容易漏检`);
  }
});

test('★ 典章制度文本靠制度名词定年代（全篇无朝代名）', () => {
  // 曾经的缺口：年代表只收朝代名与器物名，
  // 「制：宗庙八月饮酎，用九酝太牢，皇帝侍祠」全篇没有一个「汉」字，
  // 于是判成"年代未指明"，时代错位检查被整体跳过。
  const r = e('制：宗庙八月饮酎，用九酝太牢，皇帝侍祠。以正月旦作酒，八月成，名曰酎，一曰九酝，一名醇酎。');
  assert.equal(r.identifiedBy, 'keyword');
  assert.equal(r.key, 'han');
  assert.ok(r.label.includes('秦汉'));
});
