/**
 * test/kit.test.mjs — 规则工具箱的回归测试。
 *
 * 这里的每一条几乎都对应一个**曾经真实存在过的静默误判 bug**：
 * 解析器算错不会抛异常，只会让校验结论悄悄跑偏，
 * 所以这类"算得对不对"的断言比"能不能跑"重要得多。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNumber, numToCn, width, ellipsis, safeFilename, shortHash, checkShape, groupBy, countBy, uniqBy } from '../lib/util.mjs';
import {
  parseDuration, parseDistance, parseCelsius, parseAge, parseYear,
  speedKmh, humanHours, isNegated, hasNegatedMention, near, hitAny, clip, LIMITS,
} from '../lib/commonsense/kit.mjs';

/* ------------------------------------------------------------------ 中文数字 */

test('中文数字：基本值', () => {
  const cases = [
    ['零', 0], ['一', 1], ['两', 2], ['十', 10], ['十五', 15], ['二十', 20],
    ['三百五十', 350], ['一千', 1000], ['三千', 3000], ['五万', 50000], ['一万', 10000],
    ['12', 12], ['1,200', 1200], ['12.5', 12.5], ['半', 0.5],
  ];
  for (const [input, want] of cases) {
    assert.equal(parseNumber(input), want, `parseNumber(${input}) 应为 ${want}`);
  }
});

test('中文数字：口语省略单位的习惯写法', () => {
  // 「一千二」= 1200，不是 1002。这是中文口语最常见的省略，算错会静默放大 200 倍误差
  assert.equal(parseNumber('一千二'), 1200);
  assert.equal(parseNumber('两千五'), 2500);
  assert.equal(parseNumber('一万三'), 13000);
  // 有「零」就强制字面解读
  assert.equal(parseNumber('一千零二'), 1002);
  assert.equal(parseNumber('一万零三'), 10003);
  // 末尾带单位则按字面
  assert.equal(parseNumber('一千二百'), 1200);
  assert.equal(parseNumber('三万五千'), 35000);
});

test('中文数字：判不了就返回 null，不许猜', () => {
  for (const s of ['十几', '若干', '许多', '几个', '桌子', '三十几']) {
    assert.equal(parseNumber(s), null, `parseNumber(${s}) 应为 null`);
  }
});

test('中文数字回归：约数表达不能被当成确定值', () => {
  // 曾经的 bug：取最后一个数字字，「一两」被算成 2、
  // 于是「一两个小时」（约数）被静默解析成恰好 2 小时，参与量级判定。
  for (const s of ['一两', '三五', '两三', '七八', '五六']) {
    assert.equal(parseNumber(s), null, `约数「${s}」应判不了（null）`);
  }
});

test('中文数字：逐位读法（含「零」）合法', () => {
  assert.equal(parseNumber('一零二'), 102);
  // 纯 4 位中文字年份交给 parseYear，不在这里当数量词——
  // 否则「一九九八年」会被当成"1998 年"这个时长算进阈值。
  assert.equal(parseNumber('一九九八'), null);
});

test('numToCn 往返一致', () => {
  for (const n of [1, 10, 15, 20, 100, 102, 350, 1002, 1200, 9999]) {
    assert.equal(parseNumber(numToCn(n)), n, `numToCn(${n}) 往返失败`);
  }
});

/* ------------------------------------------------------------------ 时长 */

test('时长：基本写法', () => {
  const cases = [
    ['两个小时', 2], ['18 小时', 18], ['十分钟', 0.17], ['一周', 168],
    ['三个月', 2160], // 2 小时 + 20 分钟 = 2.33。修正前因数字解析只取到「十」而错算成 2.17
    ['两小时二十分钟', 2.33], ['一夜', 12],
  ];
  for (const [input, want] of cases) {
    assert.equal(parseDuration(input)?.hours, want, `parseDuration(${input}) 应为 ${want}`);
  }
});

test('时长回归：「半小时」是 0.5 小时，不是 1.5 小时', () => {
  // 曾经的 bug：主分支把「小时」当系数缺省的 1 小时，加上「半」的 0.5 → 1.5
  assert.equal(parseDuration('半小时')?.hours, 0.5);
  assert.equal(parseDuration('半个月')?.hours, 0.5 * 30 * 24);
});

test('时长回归：「一个半小时」是 1.5 小时', () => {
  // 曾经的 bug：为修「半小时」而写的"前面是半就跳过"规则，把这个真正的小时也跳掉了 → 0.5
  assert.equal(parseDuration('一个半小时')?.hours, 1.5);
  assert.equal(parseDuration('三个半小时')?.hours, 3.5);
});

test('时长回归：「三天三夜」是 3 天，不是 6 天', () => {
  // 曾经的 bug：「三天」+「三夜」各计 24 小时
  assert.equal(parseDuration('三天三夜')?.hours, 72);
  assert.equal(parseDuration('两天两夜')?.hours, 48);
  assert.equal(parseDuration('两日一夜')?.hours, 48);
});

test('时长回归：裸单位字不能被当成"1 个单位"', () => {
  // 曾经的 bug：数量词可选，于是「冬天」→1 天、「今天」→1 天、「小时候」→1 小时。
  // 这类词在叙事文本里遍地都是，会把时长统计彻底污染。
  for (const s of ['冬天', '今天', '明天', '昨夜', '小时候', '那天夜里', '春天', '白天', '夏天']) {
    assert.equal(parseDuration(s), null, `「${s}」不应被解析为时长`);
  }
});

test('时长：matched 只包含真正构成时长的片段', () => {
  const d = parseDuration('手术持续了六个小时。');
  assert.equal(d.hours, 6);
  assert.equal(d.matched, '六个小时');
  // 不能把整句当作时长来源，否则报告里的引用看不出算了哪几个字
  assert.ok(!d.matched.includes('手术'));
});

test('时长：无法解析时返回 null 而不是 0', () => {
  assert.equal(parseDuration('很久'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('一两个小时'), null);
});

test('humanHours 可读化', () => {
  assert.equal(humanHours(72), '3 天');
  assert.equal(humanHours(2.5), '2.5 小时');
  assert.equal(humanHours(0.5), '30 分钟');
  assert.equal(humanHours(NaN), '—');
});

/* ------------------------------------------------------------------ 距离/温度/年龄/年份 */

test('距离：中文与阿拉伯数字都要对', () => {
  // 曾经的 bug：数量词片段只匹配单个中文字，「三十公里」被算成 10 公里
  assert.equal(parseDistance('三十公里')?.km, 30);
  assert.equal(parseDistance('5公里')?.km, 5);
  assert.equal(parseDistance('一百米')?.km, 0.1);
  assert.equal(parseDistance('两里')?.km, 1);
  assert.equal(parseDistance('没有距离') , null);
});

test('速度计算', () => {
  assert.equal(speedKmh(42.195, 2), 21.1);
  assert.equal(speedKmh(300, 2), 150);
  assert.equal(speedKmh(10, 0), null);
  assert.equal(speedKmh(NaN, 3), null);
});

test('温度：中文、负号、零下都要认', () => {
  // 曾经的 bug：正则只吃阿拉伯数字，「零下二十度」解析为 null
  assert.equal(parseCelsius('零下二十度'), -20);
  assert.equal(parseCelsius('38度'), 38);
  assert.equal(parseCelsius('-5℃'), -5);
  assert.equal(parseCelsius('三十八摄氏度'), 38);
});

test('年龄/年份：中文写法都要认', () => {
  // 年龄走 parseNumber，所以「二十八」这种带单位的中文数字都认
  assert.equal(parseAge('二十八岁'), 28);
  assert.equal(parseAge('28岁'), 28);
  assert.equal(parseAge('九十岁'), 90);
  assert.equal(parseAge('他很大了'), null);
  // 曾经的 bug：用 indexOf 取位值，'〇' 也占一个下标导致整体错位，一九九八算成 3109
  assert.equal(parseYear('一九九八年'), 1998);
  assert.equal(parseYear('1998年'), 1998);
  assert.equal(parseYear('很久以前'), null);
});

/* ------------------------------------------------------------------ 否定 */

test('否定检测', () => {
  assert.equal(isNegated('他不能呼吸', '呼吸'), true);
  assert.equal(isNegated('他在呼吸', '呼吸'), false);
  assert.equal(isNegated('他没想到会下雨', '下雨'), false);
});

test('否定式存在陈述：用于识别"设定里说没有 X"', () => {
  assert.ok(hasNegatedMention('这座城没有电', ['电']));
  assert.ok(hasNegatedMention('世上并不存在魔法', ['魔法']));
  assert.equal(hasNegatedMention('他打开了电灯', ['电']), null);
});

test('邻近检测与命中', () => {
  assert.ok(near('他跑完三百公里只用了两个小时', ['公里'], ['小时'], 30));
  assert.equal(near('他在北京。很久以后，她在上海。', ['北京'], ['上海'], 2), null);
  assert.equal(hitAny('他奔跑着', ['奔跑', '行走']), '奔跑');
  assert.equal(hitAny('他站着', ['奔跑', '行走']), null);
});

/* ------------------------------------------------------------------ 量级表 */

test('量级表数值合理（防止手误写成荒谬值）', () => {
  assert.ok(LIMITS.sprintKmh > 30 && LIMITS.sprintKmh < 60);
  assert.ok(LIMITS.noFoodIncapacitatedHours > 3 * 24 && LIMITS.noFoodIncapacitatedHours < 14 * 24);
  assert.ok(LIMITS.noWaterDeathHours < LIMITS.noFoodIncapacitatedHours);
  assert.ok(LIMITS.walkKmh > 3 && LIMITS.walkKmh < 8);
  assert.ok(LIMITS.bodyTempC[0] > 34 && LIMITS.bodyTempC[1] < 40);
});

/* ------------------------------------------------------------------ 通用工具 */

test('checkShape 能报出必填缺失与类型错误', () => {
  const errs = checkShape({ a: 1 }, { a: { required: true, type: 'number' }, b: { required: true, type: 'string' } });
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('b'));
  const errs2 = checkShape({ a: 'x' }, { a: { required: true, type: 'number' } });
  assert.ok(errs2[0].includes('数字'));
});

test('文件名安全化：中文保留、危险字符替换', () => {
  assert.equal(safeFilename('晚风把信吹到窗前'), '晚风把信吹到窗前');
  assert.ok(!safeFilename('a/b:c*d?e').includes('/'));
  assert.ok(!safeFilename('   ').includes(' '));
  assert.equal(safeFilename('', 'fallback'), 'fallback');
});

test('短哈希稳定且区分大小写', () => {
  assert.equal(shortHash('abc'), shortHash('abc'));
  assert.notEqual(shortHash('abc'), shortHash('abd'));
  assert.equal(shortHash('abc').length, 8);
});

test('集合工具', () => {
  assert.deepEqual([...groupBy([1, 2, 3, 4], (x) => (x % 2 ? 'odd' : 'even'))], [['odd', [1, 3]], ['even', [2, 4]]]);
  assert.deepEqual(countBy(['a', 'a', 'b'], (x) => x), { a: 2, b: 1 });
  assert.deepEqual(uniqBy([{ a: 1 }, { a: 1 }, { a: 2 }], (x) => x.a), [{ a: 1 }, { a: 2 }]);
});

test('宽度与截断：中文按双宽计算', () => {
  assert.equal(width('ab'), 2);
  assert.equal(width('中文'), 4);
  assert.equal(ellipsis('一二三四五', 3), '一二三…');
  assert.equal(ellipsis('一二', 5), '一二');
});

test('clip 压缩空白并截断', () => {
  assert.equal(clip('  a   b  '), 'a b');
  assert.ok(clip('一'.repeat(200), 10).endsWith('…'));
});

test('★ 回归：裸「X月」是月份，不是时长', () => {
  // 曾经的 bug：把「八月」当成"8 个月" = 240 天。
  // 典章文本里「以正月旦作酒，八月成」指的是第八个月，时间线会整体跑偏。
  assert.equal(parseDuration('八月成'), null, '「八月成」不应被解析为时长');
  assert.equal(parseDuration('至八月'), null);
  assert.equal(parseDuration('正月旦作酒'), null, '「正月」同样不是时长');
  // 时长的规范写法带「个」
  assert.equal(parseDuration('八个月')?.hours, 8 * 30 * 24);
  assert.equal(parseDuration('三个月')?.hours, 3 * 30 * 24);
  assert.equal(parseDuration('半个月')?.hours, 0.5 * 30 * 24);
});
