/**
 * lib/commonsense/kit.mjs — 写规则用的工具箱。纯函数。
 *
 * 规则作者用这里的函数把「一句话」变成「可算的量」或「可判的关系」。
 * 所有函数遵守同一条纪律：**判不了就返回 null，绝不猜**。
 * 因为下游的 finding 会以"常识错误"的名义写给作者看，误报的代价比漏报高得多。
 */

import { parseNumber, trim, squeeze } from '../util.mjs';

/* ---------------------------------------------------------------- 文本 */

/** 引文截断 */
export function clip(s, max = 80) {
  const t = squeeze(String(s ?? ''));
  return t.length <= max ? t : t.slice(0, max) + '…';
}

/** 一段文本里是否出现某一组词中的任意一个，返回第一个命中的词 */
export function hitAny(text, terms) {
  const t = String(text ?? '');
  for (const term of terms || []) {
    if (term instanceof RegExp) {
      const m = t.match(term);
      if (m) return m[0];
    } else if (t.includes(String(term))) {
      return String(term);
    }
  }
  return null;
}

/** 一组词是否全部出现 */
export function hitAll(text, terms) {
  return (terms || []).every((term) => hitAny(text, [term]) !== null);
}

/** 两个词组是否在 maxGap 字符内相邻出现（用于"同一个句子里同时提到"） */
export function near(text, termsA, termsB, maxGap = 20) {
  const t = String(text ?? '');
  const posA = positionsOf(t, termsA);
  const posB = positionsOf(t, termsB);
  for (const a of posA) {
    for (const b of posB) {
      if (a === b) continue;
      if (Math.abs(a - b) <= maxGap) return { a, b, gap: Math.abs(a - b) };
    }
  }
  return null;
}

function positionsOf(text, terms) {
  const out = [];
  for (const term of terms || []) {
    if (term instanceof RegExp) {
      const re = new RegExp(term.source, term.flags.includes('g') ? term.flags : term.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        out.push(m.index);
        if (m[0] === '') re.lastIndex++;
      }
    } else {
      const s = String(term);
      let idx = text.indexOf(s);
      while (idx >= 0) {
        out.push(idx);
        idx = text.indexOf(s, idx + 1);
      }
    }
  }
  return out;
}

/** 取命中的文本窗口（用于给作者看上下文） */
export function windowAround(text, index, radius = 25) {
  const t = String(text ?? '');
  const a = Math.max(0, index - radius);
  const b = Math.min(t.length, index + radius);
  return (a > 0 ? '…' : '') + t.slice(a, b) + (b < t.length ? '…' : '');
}

/* ---------------------------------------------------------------- 否定 */

const NEGATORS = ['不', '没', '没有', '无', '未', '别', '莫', '休', '非', '无法', '不能', '不会', '不曾', '从未', '未曾', '绝不', '并不'];

/**
 * 紧贴在动作短语之前的否定形式。
 *
 * 【坑】只看"前 4 个字符是否以否定字**结尾**"会漏掉复合否定：
 * 「他终究没能结成金丹」里，动作前是「没能」，结尾是「能」而不是「没」，
 * 于是旧实现判成"没有否定" —— 把一句**遵守设定**的表述判成了违反设定（硬伤）。
 * 所以这里要枚举"以情态词收尾"的复合否定形式。
 */
const NEG_BEFORE_RE = /(没有|没能|没办法|无法|不能|不会|不曾|未能|并未|从未|未曾|绝不|并不|尚未|不想|不肯|不敢|不愿|不要|不可能|难以|不足以|别|莫|休|非|不|没|无|未)$/;

/**
 * term 在该文本中是否被否定。
 * 「他不能呼吸」→ 呼吸被否定；「他没能结成金丹」→ 结成金丹被否定。
 * 调用方需保证 term 选得足够具体（否定词只在 term 前 6 个字符内生效）。
 */
export function isNegated(text, term) {
  const t = String(text ?? '');
  const s = String(term);
  if (!s) return false;
  let idx = t.indexOf(s);
  while (idx >= 0) {
    const before = t.slice(Math.max(0, idx - 6), idx);
    if (NEG_BEFORE_RE.test(before)) return true;
    idx = t.indexOf(s, idx + 1);
  }
  return false;
}

/** 文本中是否存在对 subject 的否定式陈述（"没有电""不存在魔法"） */
export function hasNegatedMention(text, subjectTerms) {
  const t = String(text ?? '');
  for (const term of subjectTerms || []) {
    const s = String(term);
    let idx = t.indexOf(s);
    while (idx >= 0) {
      const before = t.slice(Math.max(0, idx - 5), idx);
      if (/(没有|不存在|并无|从来没有|不见|缺乏|没有过|无)$/.test(before)) return { term: s, idx };
      idx = t.indexOf(s, idx + 1);
    }
  }
  return null;
}

/* ---------------------------------------------------------------- 时间量 */

/**
 * 「夜」单独出现按 12 小时计（夜间时长）比 24 小时准；
 * 「三天三夜」这类同义反复由 parseDuration 显式跳过「夜」，不受此值影响。
 * 必须在 DURATION_UNITS 之前声明——后者在模块求值时就引用它。
 */
const NIGHT_HOURS = 12;

const DURATION_UNITS = [
  { re: /^(年|载)$/, hours: 365 * 24, label: '年' },
  { re: /^(个月|月)$/, hours: 30 * 24, label: '月' },
  { re: /^(周|星期|礼拜)$/, hours: 7 * 24, label: '周' },
  // 多字单位排在单字之前，避免「整天」被「天」抢先匹配成"整 + 天"
  { re: /^(整天|整夜|昼夜)$/, hours: 24, label: '天' },
  { re: /^(天|日)$/, hours: 24, label: '天' },
  { re: /^夜$/, hours: NIGHT_HOURS, label: '夜' },
  { re: /^(小时|钟头|时辰)$/, hours: 1, label: '小时' },
  { re: /^(分钟|分)$/, hours: 1 / 60, label: '分钟' },
  { re: /^秒$/, hours: 1 / 3600, label: '秒' },
];

// 数量词片段：阿拉伯数字，或 1–8 个中文数字字。
// 【坑】这里必须是 {1,8} 而不是单字符——否则「三十公里」会只匹配到「十」，
// 静默算出 10 公里，把 30 公里的行程判成合理。静默算错比算不出更危险。
const CN_NUM_FRAG = '[0-9]+(?:\\.[0-9]+)?|[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬]{1,8}';

/**
 * 解析时长表达式 → 小时数。
 * 支持：三天三夜 / 两个小时 / 半小时 / 一个半小时 / 一周 / 半个月 / 三个月 / 18 小时 / 两小时二十分钟
 * 解析不出返回 null。
 *
 * 三条易错规则（都有测试盯着）：
 *   - 「半小时」= 0.5h，不能被当成「1 小时 + 半」= 1.5h
 *   - 「半个月」= 15 天，不是 45 天
 *   - 「三天三夜」= 3 天（72h），「夜」在天/日之后只是同义反复，不叠加
 * @returns {{hours:number, raw:string, parts:Array}|null}
 */
export function parseDuration(text) {
  const t = trim(String(text ?? ''));
  if (t === '') return null;

  const parts = [];
  const matched = [];
  const UNIT = '年|载|个月|月|周|星期|礼拜|整天|整夜|昼夜|天|日|夜|小时|钟头|时辰|分钟|分|秒';

  // 三条分支按"具体程度"排序，配合 g 标志的非重叠推进，天然避免重复计入：
  //   A「一个半小时」「两个半月」→ n + 0.5
  //   B「半小时」「半个月」       → 0.5
  //   C「三天」「一小时」「十分钟」→ n   （**必须显式带数量词**）
  //
  // 【坑 1】之前用"前面是不是半"来排除重复，会把「一个半小时」里那个真正的小时也排掉，
  //   导致 1.5 小时被算成 0.5 小时。改用分支优先级 + 非重叠推进后自然解决。
  // 【坑 2】之前分支 C 的数量词是可选的，于是裸的单位字被当成"1 个单位"：
  //   「冬天」→ 1 天、「今天」→ 1 天、「小时候」→ 1 小时、「那天夜里」→ 1 天。
  //   这类词在叙事文本里到处都是，会把时长统计彻底污染。现在分支 C 强制要求数量词。
  const re = new RegExp(
    `(?<aNum>${CN_NUM_FRAG})\\s*(?:个)?\\s*半\\s*(?<aUnit>${UNIT})`
    + `|半\\s*(?<bUnit>${UNIT})`
    + `|(?<cNum>${CN_NUM_FRAG})\\s*(?:个)?\\s*(?<cUnit>${UNIT})`,
    'g',
  );

  let m;
  while ((m = re.exec(t)) !== null) {
    const g = m.groups;
    const unitStr = g.aUnit ?? g.bUnit ?? g.cUnit;
    const numStr = g.bUnit ? null : (g.aUnit ? g.aNum : g.cNum);
    const unit = DURATION_UNITS.find((u) => u.re.test(unitStr));
    if (!unit) continue;

    // 【坑】裸的「八月」「三月」在中文里几乎总是**月份**（"至八月而酒成"），
    // 不是"八个月"。早先一律按 30 天/月算，于是「八月成」被读成 240 天，
    // 时间线算术与季节判定会整体跑偏。
    // 时长的规范写法带「个」：三个月、半个月、一个月。故「月」必须见到「个」才算时长。
    if (unit.label === '月' && !/个\s*月/.test(m[0])) continue;

    let n;
    if (g.bUnit) {
      n = 0.5; // 分支 B
    } else {
      n = parseNumber(numStr);
      if (n === null) continue; // 「几小时后」这类概数：判不了就不判
    }
    if (g.aUnit) n += 0.5; // 分支 A：一个半

    // 「三天三夜」「两日一夜」：「夜」紧跟在 天/日 之后只是同义反复
    if (unitStr === '夜' && /[天日]$/.test(t.slice(0, m.index))) continue;

    parts.push({ n, unit: unit.label, hours: n * unit.hours });
    matched.push(m[0]);
  }

  if (parts.length === 0) return null;

  const hours = parts.reduce((a, p) => a + p.hours, 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return {
    hours: Math.round(hours * 100) / 100,
    raw: t,
    // matched 是真正构成时长的片段（不是整句）——报告里引用它，作者一眼能看出算的是哪几个字
    matched: matched.join('、'),
    parts,
  };
}

/** 时长人性化显示：72 → "3 天" */
export function humanHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '—';
  if (h >= 24) {
    const d = h / 24;
    return Number.isInteger(d) ? `${d} 天` : `${Math.round(d * 10) / 10} 天`;
  }
  if (h >= 1) return `${Math.round(h * 10) / 10} 小时`;
  return `${Math.round(h * 60)} 分钟`;
}

/* ---------------------------------------------------------------- 距离/速度 */

const LENGTH_UNITS = [
  { re: /^(公里|千米|km|KM)$/i, km: 1 },
  { re: /^(米|公尺|m)$/i, km: 0.001 },
  { re: /^(里)$/, km: 0.5 },
  { re: /^(英里|mile|miles)$/i, km: 1.609 },
  { re: /^(海里)$/, km: 1.852 },
  { re: /^(厘米|公分|cm)$/i, km: 0.00001 },
];

/** 解析距离 → 公里。解析不出返回 null */
export function parseDistance(text) {
  const t = trim(String(text ?? ''));
  const re = new RegExp(`(${CN_NUM_FRAG})\\s*(公里|千米|km|KM|米|公尺|里|英里|mile|miles|海里|厘米|公分)`, 'g');
  const parts = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = parseNumber(m[1]);
    const unit = LENGTH_UNITS.find((u) => u.re.test(m[2]));
    if (n === null || !unit) continue;
    parts.push({ n, unit: m[2], km: n * unit.km });
  }
  if (!parts.length) return null;
  const km = parts.reduce((a, p) => a + p.km, 0);
  return { km: Math.round(km * 1000) / 1000, raw: t, parts };
}

/** 平均速度（km/h）。任一参数无效返回 null */
export function speedKmh(km, hours) {
  const k = Number(km);
  const h = Number(hours);
  if (!Number.isFinite(k) || !Number.isFinite(h) || h <= 0) return null;
  return Math.round((k / h) * 10) / 10;
}

/* ---------------------------------------------------------------- 温度 */

/** 解析温度（摄氏）→ 数值。支持「零下二十度」「-5℃」「38度」 */
export function parseCelsius(text) {
  const t = String(text ?? '');
  const m = new RegExp(`(零下|负)?\\s*(-?${CN_NUM_FRAG})\\s*(度|℃|摄氏度|摄氏)`).exec(t);
  if (!m) return null;
  let n = parseNumber(m[2]);
  if (n === null) return null;
  if (m[1] === '零下' || m[1] === '负') n = -Math.abs(n);
  return n;
}

/* ---------------------------------------------------------------- 年龄/日期 */

/** 从文本里抓年龄（"二十八岁""28岁"） */
export function parseAge(text) {
  const t = String(text ?? '');
  const m = new RegExp(`(${CN_NUM_FRAG})\\s*(岁|周岁)`).exec(t);
  if (!m) return null;
  const n = parseNumber(m[1]);
  return n === null ? null : Math.trunc(n);
}

/** 抓公元年份（"1998年""一九九八年"）；朝代/纪年另判，不在此列 */
export function parseYear(text) {
  const t = String(text ?? '');
  const m = /(1[0-9]{3}|20[0-9]{2}|[0-9]{3})\s*年/.exec(t);
  if (m) return Number(m[1]);
  const cn = /([零〇一二三四五六七八九]{4})\s*年/.exec(t);
  if (cn) {
    // 【坑】不能用 indexOf 取位值：'〇' 也占一个下标，会把所有数字整体错位，
    // 一九九八会被算成 3109。必须用显式映射表。
    const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let n = 0;
    for (const ch of cn[1]) n = n * 10 + DIGIT[ch];
    return n >= 1000 && n <= 2100 ? n : null;
  }
  return null;
}

/* ---------------------------------------------------------------- 常见量级表 */

/** 现实世界的人体/物理常识量级，供规则引用（数值都取宽松上限，只抓明显荒谬的情况） */
export const LIMITS = {
  /** 人类持续奔跑：马拉松世界纪录约 2 小时，考虑越野/负重取 3.5 小时跑完 42.195km */
  marathonHours: 3.5,
  /** 人类瞬时速度上限（博尔特约 44.7 km/h 峰值），取 45 */
  sprintKmh: 45,
  /** 人类长距离平均移动（含休息）上限：按全程快走+少量跑，取 10 km/h */
  sustainedKmh: 10,
  /** 骑马长途日行上限（含换马）约 200 km；持续多日取 100 km/日 */
  horseKmPerDay: 100,
  /** 完全不进食的生存上限（有水）约 3 周，但失去行动能力远早于此，取 7 天 */
  noFoodIncapacitatedHours: 7 * 24,
  /** 无水生存上限约 3 天（干燥环境更短） */
  noWaterDeathHours: 3 * 24,
  /** 连续不睡的极限（研究记录约 11 天，但 3 天后认知严重受损） */
  noSleepSevereHours: 3 * 24,
  /** 普通成人失血致死量约占体重 8%，约 1.5–2 小时未止血即危险 */
  severeBleedingHours: 2,
  /** 淹没水中缺氧损伤时间（分钟） */
  drowningMinutes: 4,
  /** 冷水（<10℃）浸泡存活时间（小时） */
  coldWaterHours: 1,
  /** 骨折临床愈合时间（周）—— 完全恢复更久 */
  fractureHealingWeeks: 6,
  /** 步行速度 */
  walkKmh: 5,
  /** 成年人正常体温范围 */
  bodyTempC: [36.0, 37.3],
};

/** 交通工具的大致巡航速度（km/h），用于行程可行性判定 */
export const TRANSPORT_KMH = {
  步行: 5,
  跑步: 12,
  自行车: 18,
  骑马: 15,
  汽车: 80,
  卡车: 60,
  火车: 120,
  高铁: 300,
  飞机: 800,
  轮船: 35,
  帆船: 12,
};

export { parseNumber };
