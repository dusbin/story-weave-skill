/**
 * test/extract.test.mjs — 叙事要素抽取。
 *
 * 抽取器的职责不是"替用户决定"，而是**把值得确认的东西找出来并附上原文出处**。
 * 所以这里既测"该抽到的抽到了"，也测"不该抽的没被乱抽"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanSegments } from '../lib/text.mjs';
import {
  extractCharacters, extractNarrative, extractTimeline, extractPlaces,
  extractWorldRules, extractConflicts, extractFacts,
} from '../lib/extract.mjs';
import { extractVerseFacts, analyzeText } from '../lib/analyze.mjs';

const REALISTIC = `三年前的冬天，林晚还是江城中心医院的一名实习医生。

那天夜里下着暴雨。急诊科送来一个车祸伤员，失血过多。林晚说：“必须马上手术。”主任摇了摇头。

后来她才知道，那个伤员是她的哥哥。哥哥十五岁就离开了家，母亲一直不肯提起他。

手术持续了六个小时。天亮时，哥哥活了，可林晚的手一直在抖。`;

const FANTASY = `在这个世界上，灵力只能从月华中汲取。一旦日间强行运功，经脉便会逆行，轻则重伤，重则走火入魔。

他修炼了十年，始终无法突破筑基。师父说过，灵根残缺者永不可能结成金丹。`;

const POEM = `精卫衔微木，将以填沧海。\n刑天舞干戚，猛志固常在。`;

/* ------------------------------------------------------------------ 人物 */

test('抽出带对话归属的姓名', () => {
  const cs = extractCharacters(scanSegments(REALISTIC));
  const names = cs.map((c) => c.name);
  assert.ok(names.includes('林晚'), `实际：${names.join('、')}`);
  const lin = cs.find((c) => c.name === '林晚');
  assert.ok(lin.speechCount >= 1);
  assert.ok(lin.evidence.length > 0, '必须有原文出处');
});

test('★ 主角按"最强单条证据"判定，不被高频称谓带偏', () => {
  // 「哥哥」在短文里反复出现，累计分会盖过只说过一句台词的主角
  const cs = extractCharacters(scanSegments(REALISTIC));
  assert.equal(cs[0].isTop, true, '第一位应为主角');
  assert.equal(cs.find((c) => c.isTop).name, '林晚');
});

test('回归：「主任摇了摇头」不得抽出人物「任摇了」', () => {
  // 曾经的 bug：把「摇头」这类双字动词放进"对话归属动词"的 lookahead，
  // 贪心的 {1,2} 会先吃掉「摇了」，再让 lookahead 匹配到后面的「摇头」
  const cs = extractCharacters(scanSegments(REALISTIC));
  const names = cs.map((c) => c.name);
  assert.ok(!names.some((n) => n.includes('摇了')), `抽出了碎片人物：${names.join('、')}`);
});

test('回归：「小时候」不得被当成昵称「小时」', () => {
  const cs = extractCharacters(scanSegments('她想起了小时候的事。'));
  assert.ok(!cs.map((c) => c.name).includes('小时'));
});

test('含功能词的候选被丢弃（切错了边界）', () => {
  const cs = extractCharacters(scanSegments(REALISTIC));
  for (const c of cs) {
    assert.ok(!/还是|的了|没有|一个/.test(c.name), `候选「${c.name}」含功能词，说明切错了`);
  }
});

test('亲属称谓被识别为人物', () => {
  const cs = extractCharacters(scanSegments('母亲一直不肯提起他。'));
  assert.ok(cs.map((c) => c.name).includes('母亲'));
});

/* ------------------------------------------------------------------ 神话人物 */

test('★ 神话人物：不带姓氏的名字也要能抽出来', () => {
  // 曾经的缺口：姓名抽取靠"姓氏 + 1–2 字"，而「精卫」「刑天」没有姓氏，
  // 于是《读山海经》这类古诗被抽成"0 人物"，骨架、视角、事实锚点全部落空。
  const cs = extractCharacters(scanSegments(POEM));
  const names = cs.map((c) => c.name);
  assert.ok(names.includes('精卫'), `应抽出精卫，实际：${names.join('、')}`);
  assert.ok(names.includes('刑天'), `应抽出刑天，实际：${names.join('、')}`);
  for (const c of cs) {
    assert.ok(c.kinds.includes('mythic'));
    assert.ok(c.evidence.length > 0, '必须有原文出处');
  }
});

test('事象词不被当成人物', () => {
  // 「沧海」「干戚」是物不是人，只应出现在体裁关键词里
  const names = extractCharacters(scanSegments(POEM)).map((c) => c.name);
  assert.ok(!names.includes('沧海'), '沧海不是人物');
  assert.ok(!names.includes('干戚'), '干戚不是人物');
});

test('神话人物表不干扰普通文本', () => {
  const names = extractCharacters(scanSegments('林晚说：“先救人。”')).map((c) => c.name);
  assert.ok(names.includes('林晚'));
  assert.ok(!names.includes('精卫'));
});

/* ------------------------------------------------------------------ 叙事视角 */

test('第一人称与第三人称的判定', () => {
  assert.equal(extractNarrative(scanSegments('我推开门，看见了她。'), '我推开门，看见了她。').person, 'first');
  assert.equal(extractNarrative(scanSegments(REALISTIC), REALISTIC).person, 'third');
});

test('对话占比用显式码位检测引号（不受编辑器换引号影响）', () => {
  const a = extractNarrative(scanSegments('林晚说：“必须马上手术。”'), '林晚说：“必须马上手术。”');
  assert.ok(a.dialogueRatio > 0, '含引号的句子应计入对话');
  const b = extractNarrative(scanSegments('雨还在下。'), '雨还在下。');
  assert.equal(b.dialogueRatio, 0);
});

/* ------------------------------------------------------------------ 时间线 */

test('时间线抽出绝对/相对时间与明示时长', () => {
  const tl = extractTimeline(scanSegments(REALISTIC));
  const kinds = new Set(tl.events.map((e) => e.kind));
  assert.ok(kinds.has('relative'), '应识别"三年前/后来"这类相对时间');
  assert.ok(kinds.has('duration'), '应识别"六个小时"这类时长');
  const six = tl.events.find((e) => e.kind === 'duration' && e.hours === 6);
  assert.ok(six, '「手术持续了六个小时」应被解析为 6 小时');
});

test('时长的 when 只含真正构成时长的片段', () => {
  const tl = extractTimeline(scanSegments('三年前的冬天，林晚还是实习医生。'));
  const d = tl.events.find((e) => e.kind === 'duration');
  assert.equal(d.when, '三年');
  assert.equal(d.hours, 26280);
});

test('时间线事件都带行号', () => {
  const tl = extractTimeline(scanSegments(REALISTIC));
  for (const e of tl.events) assert.ok(Number.isFinite(e.line) && e.line >= 1);
});

/* ------------------------------------------------------------------ 地点 */

test('抽出带地名后缀的地点，且拒绝切错的候选', () => {
  const ps = extractPlaces(scanSegments(REALISTIC));
  const names = ps.map((p) => p.name);
  assert.ok(names.includes('中心医院'), `实际：${names.join('、')}`);
  // 「林晚还是江城中心医院」不得把「林晚还是江」当地名
  assert.ok(!names.some((n) => /还是|的了/.test(n)), `地名含功能词：${names.join('、')}`);
});

/* ------------------------------------------------------------------ 世界设定 */

test('★ 抽出作品自己立的规则（架空向的判定基准）', () => {
  const w = extractWorldRules(scanSegments(FANTASY));
  assert.ok(w.rules.length >= 2, `实际 ${w.rules.length} 条`);
  assert.ok(w.rules.some((r) => r.type === 'cannot'), '应有"不能/永不"类硬设定');
  assert.ok(w.rules.some((r) => r.type === 'limit'), '应有"只能"类限制');
  for (const r of w.rules) {
    assert.ok(r.statement && r.modality);
    assert.ok(Number.isFinite(r.line));
  }
});

test('现实向文本不凭空抽出世界设定', () => {
  const w = extractWorldRules(scanSegments(REALISTIC));
  assert.equal(w.rules.length, 0, `不应有设定，实际：${JSON.stringify(w.rules.map((r) => r.statement))}`);
});

test('台词里的「必须」不被当成世界设定', () => {
  // 「必须马上手术」是情节义务，不是世界的运作方式
  const w = extractWorldRules(scanSegments('林晚说：“必须马上手术。”'));
  assert.equal(w.rules.length, 0);
});

test('条件句里的逗号不影响规则识别', () => {
  // 「一旦日间强行运功，经脉便会逆行」——用 [^，。] 会把逗号也挡掉，永远匹配不到
  const w = extractWorldRules(scanSegments('一旦日间强行运功，经脉便会逆行。'));
  assert.ok(w.rules.some((r) => r.type === 'mechanic'), '应识别条件规则');
});

/* ------------------------------------------------------------------ 事实锚点 */

test('年龄被标为不可改写', () => {
  const fs2 = extractFacts(scanSegments(REALISTIC));
  const age = fs2.find((f) => f.kind === 'age');
  assert.ok(age, '应抽出年龄事实');
  assert.equal(age.immutable, true, '年龄一旦写明就不可改写');
  assert.equal(age.parsed.age, 15);
});

test('天气类事实允许随情节演进', () => {
  const fs2 = extractFacts(scanSegments(REALISTIC));
  const w = fs2.find((f) => f.kind === 'weather');
  if (w) assert.equal(w.immutable, false, '天气不该被当成不可改写的事实');
});

/* ------------------------------------------------------------------ 冲突 */

test('冲突类型识别', () => {
  assert.ok(extractConflicts(scanSegments('暴雨中他迷了路，几乎冻死。')).some((c) => c.type === '人vs环境'));
  assert.ok(extractConflicts(scanSegments('他报复苏明，两人打斗了起来。')).some((c) => c.type === '人vs人'));
});

test('没有冲突信号时返回空数组', () => {
  assert.deepEqual(extractConflicts(scanSegments('他把杯子放在桌上。')), []);
});

/* ------------------------------------------------------------------ 诗歌锚点 */

test('★ 诗歌：逐句立为事实锚点（散文的事件型锚点在诗里不存在）', () => {
  // 诗句不含"死亡/年龄/职业/天气"这类事件模式词，事件型抽取结果为空，
  // 于是硬约束表里只剩通用不变量，写作指令没有"不得改写什么"的具体依据。
  const facts = extractVerseFacts(scanSegments(POEM));
  assert.equal(facts.length, 4, `四个"顿"应各立一锚，实际 ${facts.length}`);
  assert.ok(facts.every((f) => f.immutable === true));
  assert.ok(facts.every((f) => f.label === '原文诗句'));
  assert.ok(facts.every((f) => Number.isFinite(f.line)), '每句都要能指回行号');
  // 第一节诗的第一句是第一行
  assert.equal(facts[0].value, '精卫衔微木');
  assert.equal(facts[0].line, 1);
});

test('诗歌锚点只对韵文类文本生效，散文仍用事件型锚点', () => {
  const poem = analyzeText({ raw: '精卫衔微木，将以填沧海。\n刑天舞干戚，猛志固常在。' });
  assert.ok(poem.facts.every((f) => f.kind === 'verse'), '韵文应逐句立锚');

  const prose = analyzeText({ raw: '哥哥十五岁就离开了家。母亲一直不肯提起他。' });
  assert.ok(prose.facts.some((f) => f.kind === 'age'), '散文应抽出事件型锚点');
  assert.ok(!prose.facts.some((f) => f.kind === 'verse'), '散文不该逐句立锚');
});

/* ------------------------------------------------------------------ 典章诏令 */

const EDICT = '制：宗庙八月饮酎，用九酝太牢，皇帝侍祠。以正月旦作酒，八月成，名曰酎，一曰九酝，一名醇酎。';

test('★ 典章诏令不得被判成对话记录', () => {
  // 曾经的 bug：dialogue_log 只判"开头若干字 + 冒号"，
  // 于是「制：」被当成说话人，整条诏令判成对话记录，还要给它找"台词"。
  const a = analyzeText({ raw: EDICT });
  assert.equal(a.textType.primary, 'document', `实际：${a.textType.primary}`);
  assert.equal(a.textType.label, '典章/诏令');
});

test('真正的对话记录仍能被识别', () => {
  const a = analyzeText({ raw: '林晚：血库还有多少？\n主任：两个单位。\n林晚：不够。\n主任：等血站调。' });
  assert.equal(a.textType.primary, 'dialogue_log');
});

test('典章文本的月份被当作时间点而非时长', () => {
  const a = analyzeText({ raw: EDICT });
  const durations = (a.elements.timeline.events ?? []).filter((e) => e.kind === 'duration');
  assert.deepEqual(durations, [], `「八月」不应产生时长事件：${JSON.stringify(durations.map((d) => d.when))}`);
  const months = (a.elements.timeline.events ?? []).filter((e) => e.subkind === 'month');
  assert.ok(months.length >= 2, '「八月」应被识别为月份时间点');
});

test('★ 典章诏令：条款逐句立为事实锚点（含短句）', () => {
  // 典章由独立命题构成，不含事件型事实词，事件抽取结果为空，
  // 于是硬约束表只剩通用不变量——正文再也受不到"八月成""皇帝侍祠"的约束。
  const a = analyzeText({ raw: EDICT });
  assert.ok(a.facts.length >= 7, `条款锚点太少：${a.facts.length}`);
  assert.ok(a.facts.every((f) => f.label === '原文条款'));
  assert.ok(a.facts.every((f) => f.immutable === true));
  const values = a.facts.map((f) => f.value);
  for (const must of ['以正月旦作酒', '八月成', '皇帝侍祠', '用九酝太牢']) {
    assert.ok(values.includes(must), `缺少关键条款锚点「${must}」（实际：${values.join('/')}）`);
  }
});

test('设定片段类文本也逐句立锚，但标签不同', () => {
  const a = analyzeText({ raw: '规则：灵力只能从月华中汲取。一旦日间强行运功，经脉便会逆行。' });
  if (a.facts.length) {
    assert.ok(a.facts.every((f) => ['原文诗句', '原文条款', '原文设定'].includes(f.label)));
  }
});
