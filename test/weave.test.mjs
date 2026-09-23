/**
 * test/weave.test.mjs — 第三步：写作指令、草稿导入与正文组装。
 *
 * 关键不变量：`story.text` 必须与 `sections` 拼接结果完全一致。
 * 否则"校验的正文"和"交付的正文"就是两份东西，校验结论也就失去意义。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeText } from '../lib/analyze.mjs';
import { buildPlan, applyConfirmation } from '../lib/plan.mjs';
import {
  buildBeatPrompts, parseDraft, assembleStory, validateAssembled,
  storyFilename, previewStory, COMMONSENSE_SELFCHECK,
} from '../lib/weave.mjs';
import { buildBeats, scoreAllModes, assertModeParity, requiredInputs, MODE_DEFS, MODE_BY_KEY, SCALE } from '../lib/modes.mjs';
import { MODES } from '../lib/schema.mjs';

const SRC = `三年前的冬天，林晚还是江城中心医院的一名实习医生。那天夜里下着暴雨。后来她才知道，那个伤员是她的哥哥。哥哥十五岁就离开了家。手术持续了六个小时。`;

const an = analyzeText({ raw: SRC });
const plan = buildPlan({ analysis: an, options: { scale: 'flash' } });
const confirmed = applyConfirmation(plan, {
  acceptedChangeIds: plan.changes.map((c) => c.id),
  confirmedBy: 'test',
}, an);

/* ------------------------------------------------------------------ 模式 */

test('模式表与 schema 枚举一致（防止两处定义漂移）', () => {
  assert.equal(assertModeParity(), true);
  assert.deepEqual(Object.keys(MODES).sort(), MODE_DEFS.map((m) => m.key).sort());
});

test('六种模式都齐全且各有说明', () => {
  assert.equal(MODE_DEFS.length, 6);
  for (const m of MODE_DEFS) {
    assert.ok(m.label && m.short && m.what && m.howHard, `${m.key} 说明不全`);
    assert.ok(m.invariants.length >= 2, `${m.key} 的不变量太少`);
    assert.equal(typeof m.fit, 'function');
    assert.equal(typeof m.skeleton, 'function');
  }
});

test('每个模式都能给出适配度评分与理由', () => {
  const fits = scoreAllModes(an);
  assert.equal(fits.length, 6);
  for (const f of fits) {
    assert.ok(f.score >= 0 && f.score <= 1, `${f.mode} 分数越界：${f.score}`);
  }
  // 分数降序
  for (let i = 1; i < fits.length; i++) assert.ok(fits[i - 1].score >= fits[i].score);
});

test('每个模式都要求人工指定必要参数', () => {
  for (const m of MODE_DEFS) {
    const req = requiredInputs(m.key);
    assert.ok(req.some((r) => r.includes('篇幅')), `${m.key} 未要求篇幅`);
  }
  assert.ok(requiredInputs('whatif').some((r) => r.includes('分叉点')));
  assert.ok(requiredInputs('adapt').some((r) => r.includes('替换轴')));
  assert.ok(requiredInputs('spinoff').some((r) => r.includes('番外主角')));
});

test('骨架节数随目标节数自适应', () => {
  for (const key of Object.keys(MODE_BY_KEY)) {
    for (const n of [4, 6, 8, 12, 16]) {
      const beats = buildBeats(key, { sections: n, protagonist: '林晚' });
      assert.equal(beats.length, n, `${key} 在 ${n} 节下得到了 ${beats.length} 节`);
      assert.deepEqual(beats.map((b) => b.index), Array.from({ length: n }, (_, i) => i + 1));
    }
  }
});

test('多线推演的骨架包含"只改一个变量"的纪律', () => {
  const beats = buildBeats('whatif', { sections: 6, branchVariable: '他没说出真相' });
  const text = beats.map((b) => b.guidance).join(' ');
  assert.ok(text.includes('只改') || text.includes('唯一变量'), '骨架必须强调只改一个变量');
});

test('改编骨架提示替换轴', () => {
  const beats = buildBeats('adapt', { sections: 6, adaptAxis: '换视角：改成哥哥的视角' });
  assert.ok(beats.some((b) => b.guidance.includes('换视角')), '骨架应带入替换轴');
});

/* ------------------------------------------------------------------ 写作指令 */

test('逐节写作指令包含必要信息', () => {
  const { beats, combined } = buildBeatPrompts({ analysis: an, plan: confirmed });
  assert.equal(beats.length, confirmed.beats.length);
  assert.ok(combined.includes('常识自查表'));
  assert.ok(combined.includes('输出格式'));
  assert.ok(combined.includes(confirmed.title));
  for (const b of beats) {
    assert.ok(b.prompt.includes(`第 ${b.index} 节`), '指令应标明节号');
    assert.ok(b.prompt.includes(b.title), '指令应含本节标题');
    assert.ok(b.targetChars > 0);
  }
});

test('写作指令注入不可改写的事实与已立设定', () => {
  const { combined } = buildBeatPrompts({ analysis: an, plan: confirmed });
  const facts = confirmed.constraints.mustNotViolate.filter((k) => k.ruleRef === 'FACT-001');
  if (facts.length) assert.ok(combined.includes('不可改写的事实'), '应列出不可改写的事实');
  assert.ok(combined.includes('演绎边界'), '应列出演绎边界');
});

test('写作指令列出人工确认要落实的修改点', () => {
  const { combined } = buildBeatPrompts({ analysis: an, plan: confirmed });
  const accepted = confirmed.changes.filter((c) => c.decision === 'accept' || c.decision === 'modify');
  if (accepted.length) assert.ok(combined.includes('人工确认要落实的修改点'));
});

test('常识自查表覆盖十类常见硬伤', () => {
  assert.ok(COMMONSENSE_SELFCHECK.length >= 10);
  const all = COMMONSENSE_SELFCHECK.join(' ');
  for (const kw of ['时间记账', '生理极限', '空间与行程', '信息来源', '因果关系', '时代一致', '数字一致', '专业流程', '架空设定', '人物一致']) {
    assert.ok(all.includes(kw), `自查表缺少「${kw}」`);
  }
});

test('最后一节的指令含收束要求', () => {
  const { beats } = buildBeatPrompts({ analysis: an, plan: confirmed });
  const last = beats[beats.length - 1];
  assert.ok(last.isLast);
  assert.ok(last.prompt.includes('收束要求'), '最后一节应给出收束要求');
});

/* ------------------------------------------------------------------ 草稿解析 */

test('按标题分节（带序号）', () => {
  const d = parseDraft('## 1. 开头\n\n正文一。\n\n## 2. 结尾\n\n正文二。');
  assert.equal(d.format, 'heading');
  assert.equal(d.sections.length, 2);
  assert.deepEqual(d.sections.map((s) => s.title), ['开头', '结尾']);
  assert.equal(d.sections[0].text, '正文一。');
});

test('按标题分节（无序号 / 带"第N节"）', () => {
  const a = parseDraft('## 开头\n\n甲。\n\n## 结尾\n\n乙。');
  assert.equal(a.sections.length, 2);
  const b = parseDraft('## 第1节 开头\n\n甲。\n\n## 第2节 结尾\n\n乙。');
  assert.equal(b.sections.length, 2);
  assert.deepEqual(b.sections.map((s) => s.index), [1, 2]);
});

test('标题序号与实际顺序不一致时按出现顺序重排并给出提示', () => {
  const d = parseDraft('## 2. 第二节\n\n乙。\n\n## 1. 第一节\n\n甲。');
  assert.deepEqual(d.sections.map((s) => s.index), [1, 2]);
  assert.ok(d.warnings.some((w) => w.includes('序号')), '应提示序号不一致');
});

test('按分隔线分节', () => {
  const d = parseDraft('甲。\n\n---\n\n乙。\n\n***\n\n丙。');
  assert.equal(d.format, 'separator');
  assert.equal(d.sections.length, 3);
});

test('未分节草稿给出警告而不是静默接受', () => {
  const d = parseDraft('只有一段文字，没有任何标题。');
  assert.equal(d.format, 'single');
  assert.equal(d.sections.length, 1);
  assert.ok(d.warnings.some((w) => w.includes('分节')));
});

test('第一个标题之前的说明性内容被忽略并提示', () => {
  const d = parseDraft('# 演绎写作指令\n\n（一些说明）\n\n## 1. 开头\n\n正文。');
  assert.equal(d.sections.length, 1);
  assert.ok(d.warnings.some((w) => w.includes('忽略')));
});

test('空草稿被明确拒绝', () => {
  const d = parseDraft('   \n  ');
  assert.equal(d.sections.length, 0);
  assert.ok(d.warnings.some((w) => w.includes('空')));
});

test('全角标题与多余空格都能解析', () => {
  const d = parseDraft('##  1、  开头 \n\n正文。\n\n## 2、结尾\n\n正文二。');
  assert.equal(d.sections.length, 2);
});

/* ------------------------------------------------------------------ 组装 */

test('★ story.text 必须与 sections 拼接结果一致', () => {
  const d = parseDraft('## 1. 甲\n\n第一段。\n\n## 2. 乙\n\n第二段。');
  const story = assembleStory({ plan: confirmed, sections: d.sections, title: '一致性测试' });
  const joined = story.sections.map((s) => s.text).join('');
  assert.equal(story.text.replace(/\s+/g, ''), joined.replace(/\s+/g, ''));
  assert.deepEqual(validateAssembled(story), []);
});

test('schema 会复核 text 与 sections 的一致性', () => {
  const d = parseDraft('## 1. 甲\n\n第一段。');
  const story = assembleStory({ plan: confirmed, sections: d.sections, title: 't' });
  const tampered = { ...story, text: story.text + '偷偷加的字' };
  assert.ok(validateAssembled(tampered).length > 0, '不一致必须被结构校验发现');
});

test('组装结果带方案引用与对齐信息', () => {
  const d = parseDraft(confirmed.beats.map((b, i) => `## ${i + 1}. ${b.title}\n\n第 ${i + 1} 节正文。`).join('\n\n'));
  const story = assembleStory({ plan: confirmed, sections: d.sections, title: '对齐测试' });
  assert.equal(story.planRef.mode, confirmed.mode);
  assert.equal(story.planRef.beats, confirmed.beats.length);
  assert.ok(story.meta.alignment.includes('一致'), `实际：${story.meta.alignment}`);
  assert.equal(story.chars, story.text.replace(/\s+/g, '').length);
});

test('节数与 beat 不符时对齐信息显式标出', () => {
  const story = assembleStory({ plan: confirmed, sections: [{ index: 1, title: '一', text: '只有一节。' }], title: 't' });
  assert.ok(story.meta.alignment.includes('≠'), `实际：${story.meta.alignment}`);
});

test('空节被丢弃（空章节会让字数与校验失真）', () => {
  const story = assembleStory({
    plan: confirmed,
    sections: [{ index: 1, title: '一', text: '正文。' }, { index: 2, title: '二', text: '   ' }],
    title: 't',
  });
  assert.equal(story.sections.length, 1);
});

test('组装结果通过结构校验（含节号唯一、正文非空）', () => {
  const d = parseDraft('## 1. 甲\n\n甲文。\n\n## 2. 乙\n\n乙文。');
  const story = assembleStory({ plan: confirmed, sections: d.sections, title: '校验' });
  assert.deepEqual(validateAssembled(story), []);
});

test('文件名安全化与预览', () => {
  const story = assembleStory({ plan: confirmed, sections: [{ index: 1, title: '一', text: '甲。' }], title: '切片/测试:名' });
  assert.ok(!storyFilename(story).includes('/'));
  const long = assembleStory({ plan: confirmed, sections: [{ index: 1, title: '一', text: '甲'.repeat(2000) }], title: 'long' });
  const prev = previewStory(long, 100);
  assert.ok(prev.length < 400, '预览应被截断');
  assert.ok(prev.includes('共'));
});

test('草稿节数与 beat 一致时，每节能对应到 beatId', () => {
  const d = parseDraft(confirmed.beats.map((b, i) => `## ${i + 1}. ${b.title}\n\n正文 ${i + 1}。`).join('\n\n'));
  const story = assembleStory({ plan: confirmed, sections: d.sections, title: 't' });
  assert.deepEqual(story.sections.map((s) => s.beatId), confirmed.beats.map((b) => b.index));
});

test('篇幅档位定义完整', () => {
  for (const [k, v] of Object.entries(SCALE)) {
    assert.equal(v.key, k);
    assert.ok(v.label && v.sections > 0 && v.targetChars > 0 && v.desc);
  }
});

test('★ 缩小节数时必须保住各模式的结构支点', () => {
  // 曾经的 bug：缩小节数用无差别等距抽样，于是「前传」缩到 4 节时，
  // 支点「无法回头的一刻」被静默丢掉——而前传的成立恰恰靠那一步的不可逆。
  const must = {
    prequel: '无法回头的一刻',
    expand: '临界时刻',
    continue: '选择与后果',
    spinoff: '一个小冲突',
    whatif: '分叉点重演：变量取新值',
    adapt: '代价与选择',
  };
  for (const [mode, title] of Object.entries(must)) {
    for (const n of [3, 4, 5]) {
      const beats = buildBeats(mode, { sections: n, protagonist: '精卫', branchVariable: 'x' });
      assert.equal(beats.length, n);
      assert.ok(beats.some((b) => b.title === title),
        `${mode} 缩到 ${n} 节时丢失了支点「${title}」：${beats.map((b) => b.title).join(' → ')}`);
    }
  }
});

test('缩小节数后节拍仍按原叙事顺序排列', () => {
  const beats = buildBeats('prequel', { sections: 4, protagonist: '精卫' });
  assert.equal(beats[0].title, '更早的常态');
  assert.equal(beats[beats.length - 1].title, '接上原文开头');
  assert.deepEqual(beats.map((b) => b.index), [1, 2, 3, 4]);
});
