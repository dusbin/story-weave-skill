/**
 * test/text.test.mjs — 文本切分、定位与指纹。
 *
 * 核心不变量：**每条判定都能指回原文行号**。
 * 所以这里重点盯"行号对不对"，而不是"切得漂不漂亮"。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitParagraphs, scanSegments, indexSegments, findMatches,
  segmentsWithAny, segmentsWithAll, hasAnywhere, tokenize,
  countChars, quote, fingerprint, textStats,
} from '../lib/text.mjs';

const SAMPLE = `第一段第一句。第一段第二句！

第二段第一句；第二段第二句？
第三段在这里。`;

test('引号感知断句：不从句末标点切在引号内部', () => {
  // 曾经的 bug：按 /(?<=[。！？])/ 切分，看不见引号，
  // 「林晚说：“必须马上手术。”主任摇了摇头。」被切成
  // 「林晚说：“必须马上手术。」和「”主任摇了摇头。」——引号被撕开，
  // 于是所有用配对引号判断"是不是台词"的规则都静默失效。
  const segs = scanSegments('林晚说：“必须马上手术。”主任摇了摇头。');
  assert.deepEqual(segs.map((s) => s.text), ['林晚说：“必须马上手术。”', '主任摇了摇头。']);
});

test('引号感知断句：直角引号与括号同样处理', () => {
  assert.deepEqual(scanSegments('他说：「朕知道了。」然后转身走了。').map((s) => s.text),
    ['他说：「朕知道了。」', '然后转身走了。']);
  assert.deepEqual(scanSegments('（他当时并不知道。）后来一切都变了。').map((s) => s.text),
    ['（他当时并不知道。）', '后来一切都变了。']);
});

test('引号感知断句：孤立引号不会把全文吞成一句', () => {
  const segs = scanSegments('「孤立的引号没有收尾。下一句应该正常切分。');
  assert.equal(segs.length, 2, '未闭合的引号应按普通字符处理');
});

test('引号感知断句：连续对话各自成句', () => {
  assert.deepEqual(scanSegments('她说：“第一句。”他说：“第二句。”').map((s) => s.text),
    ['她说：“第一句。”', '他说：“第二句。”']);
});

test('段落切分：只按空行分段（相邻非空行属同一段）', () => {
  // SAMPLE 里第 3、4 行之间没有空行，因此它们属于同一段——共 2 段。
  // 这一点很重要：不能按换行分段，否则每一行都会被当成新段落，段落统计全错。
  const paras = splitParagraphs(SAMPLE);
  assert.equal(paras.length, 2);
  assert.equal(paras[0].line, 1);
  assert.equal(paras[1].line, 3, '第二段应从第 3 行开始（含第 4 行）');
  assert.ok(paras[1].text.includes('第三段在这里'), '相邻非空行应并入同一段');
});

test('句子切分：句末标点切分并保留标点', () => {
  const segs = scanSegments(SAMPLE);
  assert.equal(segs.length, 5);
  assert.deepEqual(segs.map((s) => s.text), [
    '第一段第一句。', '第一段第二句！', '第二段第一句；', '第二段第二句？', '第三段在这里。',
  ]);
});

test('句子行号能定位回原文', () => {
  const segs = scanSegments(SAMPLE);
  assert.equal(segs[0].line, 1);
  assert.equal(segs[2].line, 3);
  assert.equal(segs[4].line, 4);
});

test('segment 的 start/end 与原文切片一致', () => {
  const segs = scanSegments(SAMPLE);
  for (const s of segs) {
    assert.equal(SAMPLE.slice(s.start, s.end), s.text, `segment ${s.id} 的偏移区间对不上`);
  }
});

test('segment id 唯一且连续', () => {
  const segs = scanSegments(SAMPLE);
  const ids = segs.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['s1', 's2', 's3', 's4', 's5']);
});

test('CRLF 换行被归一化，不影响行号', () => {
  const segs = scanSegments('第一句。\r\n\r\n第二句。');
  assert.equal(segs.length, 2);
  assert.equal(segs[1].line, 3);
  assert.ok(!segs[1].text.includes('\r'));
});

test('空输入返回空数组而不是抛异常', () => {
  assert.deepEqual(scanSegments(''), []);
  assert.deepEqual(scanSegments('   \n\n  '), []);
  assert.deepEqual(splitParagraphs(''), []);
});

test('indexSegments 可用 id 取回 segment', () => {
  const segs = scanSegments(SAMPLE);
  const idx = indexSegments(segs);
  assert.equal(idx.get('s3').text, '第二段第一句；');
  assert.equal(idx.get('nope'), undefined);
});

test('findMatches 返回全局偏移与命中文本', () => {
  const segs = scanSegments(SAMPLE);
  const hits = findMatches(segs, /第一句/g);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].match, '第一句');
  assert.equal(hits[0].line, 1);
  assert.equal(SAMPLE.slice(hits[0].charStart, hits[0].charStart + 3), '第一句');
});

test('findMatches 支持 limit 与字符串字面量', () => {
  const segs = scanSegments(SAMPLE);
  assert.equal(findMatches(segs, '第一', { limit: 1 }).length, 1);
  // 特殊字符按字面量处理，不会当正则
  const segs2 = scanSegments('价格是 (元)。');
  assert.equal(findMatches(segs2, '(元)').length, 1);
});

test('关键词检索：any / all / anywhere', () => {
  const segs = scanSegments(SAMPLE);
  // 「第二句」在第 1 段和第 2 段各出现一次
  assert.equal(segmentsWithAny(segs, ['第二句']).length, 2);
  assert.equal(segmentsWithAll(segs, ['第二段', '第二句']).length, 1);
  // 「第一段第二句！」这一句里两个词同时出现
  assert.equal(segmentsWithAll(segs, ['第一段', '第二句']).length, 1);
  assert.equal(segmentsWithAll(segs, ['第一段', '不存在']).length, 0);
  assert.equal(hasAnywhere(segs, ['第三段']), true);
  assert.equal(hasAnywhere(segs, ['不存在的词']), false);
});

test('指纹忽略空白差异，但区分内容', () => {
  assert.equal(fingerprint('他走了。'), fingerprint('他 走了 。'));
  assert.equal(fingerprint('他走了。'), fingerprint('他走了。\n\n'));
  assert.notEqual(fingerprint('他走了。'), fingerprint('她走了。'));
});

test('字数统计不计空白', () => {
  assert.equal(countChars('他 走 了 。'), 4);
  assert.equal(countChars('a b c'), 3);
});

test('textStats 统计段落/句子/长句', () => {
  const st = textStats(SAMPLE);
  assert.equal(st.paragraphs, 2);
  assert.equal(st.sentences, 5);
  assert.ok(st.chars > 20);
  assert.ok(st.longestSentence >= st.avgSentenceChars);
});

test('quote 截断到指定长度', () => {
  assert.equal(quote('一二三四五', 3), '一二三…');
  assert.equal(quote('一二三', 5), '一二三');
});

test('tokenize 按标点切分并过滤单字/虚词（注意：它不是分词器）', () => {
  // 这个函数是"按标点切短语"，不是中文分词：中文没有词边界，
  // 所以人物名是靠 extract.mjs 里的姓氏/称谓/对话归属等专门模式抽取的，
  // 不依赖 tokenize。这里把这个能力边界写进测试，避免有人误以为它能分词。
  const words = tokenize('林晚走进急诊科，看着病人。');
  assert.deepEqual(words, ['林晚走进急诊科', '看着病人']);
  // 单字与虚词被过滤
  assert.ok(!tokenize('他 的 走').includes('的'));
  assert.ok(!tokenize('他 的 走').includes('走'));
});
