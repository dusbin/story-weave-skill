/**
 * lib/util.mjs — 纯函数工具。无 IO、无副作用、可测试。
 */

/* ---------------------------------------------------------------- 基础类型 */

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isStr(v) {
  return typeof v === 'string';
}

export function isFn(v) {
  return typeof v === 'function';
}

export function isNil(v) {
  return v === null || v === undefined;
}

/** 安全取值：obj?.a?.b，路径用点号 */
export function get(obj, path, fallback = undefined) {
  if (!isStr(path) || path === '') return fallback;
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[key];
  }
  return cur === undefined ? fallback : cur;
}

/** 只保留 keys 里列出的字段 */
export function pick(obj, keys) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** 去掉 null / undefined / 空数组 / 空对象的字段 */
export function compact(obj) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (isNil(v)) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isObj(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/* ---------------------------------------------------------------- 数值 */

export function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function round(n, digits = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

export function sum(arr) {
  return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function avg(arr) {
  const a = (arr || []).filter((x) => Number.isFinite(Number(x)));
  return a.length ? sum(a) / a.length : 0;
}

export function maxBy(arr, fn) {
  let best = null;
  let bestV = -Infinity;
  for (const item of arr || []) {
    const v = Number(fn(item));
    if (Number.isFinite(v) && v > bestV) {
      bestV = v;
      best = item;
    }
  }
  return best;
}

/** 数组按 fn 分组成 Map */
export function groupBy(arr, fn) {
  const m = new Map();
  for (const item of arr || []) {
    const k = fn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

/** 计数成普通对象 */
export function countBy(arr, fn) {
  const out = {};
  for (const item of arr || []) {
    const k = String(fn(item));
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function uniq(arr) {
  return [...new Set((arr || []).filter((x) => !isNil(x)))];
}

export function uniqBy(arr, fn) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    const k = String(fn(item));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** 稳定的降序排序（同分保持原顺序），用于"按分数排名但结果可复现" */
export function rankDesc(items, scoreFn) {
  return (items || [])
    .map((item, i) => ({ item, i, s: Number(scoreFn(item)) || 0 }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.item);
}

/* ---------------------------------------------------------------- 字符串 */

/** 去掉首尾空白与中文全角空格 */
export function trim(s) {
  return isStr(s) ? s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '') : '';
}

/** 压缩连续空白（保留段落内单空格） */
export function squeeze(s) {
  return isStr(s) ? s.replace(/[ \t\u3000]+/g, ' ').trim() : '';
}

/** 去掉所有空白，用于"按字数"统计（中文场景更准） */
export function noSpace(s) {
  return isStr(s) ? s.replace(/\s+/g, '') : '';
}

/** 视觉宽度：CJK 记 2，其它记 1。用于列对齐，不用于字数统计 */
export function width(s) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

/** 按最大字符数截断，超出补省略号。用于把原文片段塞进报告 */
export function ellipsis(s, max = 60, tail = '…') {
  const t = squeeze(s);
  if (t.length <= max) return t;
  return t.slice(0, max) + tail;
}

export function padEndW(s, targetW) {
  const pad = Math.max(0, targetW - width(s));
  return String(s ?? '') + ' '.repeat(pad);
}

/** 简单 slug：中文保留，空白转连字符，去掉文件系统危险字符 */
export function slugify(s, fallback = 'untitled') {
  const t = trim(String(s ?? ''))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return t ? t.slice(0, 80) : fallback;
}

/** 允许作为文件名的中文标题（保留中文、字母数字，其余转下划线） */
export function safeFilename(s, fallback = 'story') {
  const t = trim(String(s ?? ''))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  return (t || fallback).slice(0, 80);
}

/** 稳定的短哈希（FNV-1a 变体，用于 fingerprint，不用于安全） */
export function shortHash(s, len = 8) {
  const str = String(s ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  return hex.slice(0, len);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 给 HTML 里塞 JSON（</script> 会截断脚本） */
export function jsonForScript(obj) {
  return JSON.stringify(obj ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* ---------------------------------------------------------------- 中文数字 */

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
const CN_UNIT = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

const CN_CHARS = /^[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬亿億]+$/;

/**
 * 纯中文整数（≤ 亿级）解析，处理中文口语省略单位的习惯写法。
 *
 * 关键难点：「一千二」= 1200 而不是 1002，「一万三」= 13000。
 * 判据是**末尾裸数字是否紧跟在一个单位之后**：
 *   - 「一千二」三代字紧跟「千」→ 按 千/10 = 100 解读 → 1200
 *   - 「一千零二」有「零」→ 强制字面解读 → 1002
 *   - 「一千二百」末尾有单位「百」→ 字面 → 1200
 *
 * 解析失败返回 null：宁可不判，不可误判（下游规则依赖这个约定）。
 */
function parseCnInt(s) {
  if (!CN_CHARS.test(s)) return null;
  const literal = /[零〇]/.test(s);

  // 先把 万/亿 当作分段乘数切开（从高到低）
  const segRe = /^(.*?)([万萬亿億])(.*)$/;
  const seg = segRe.exec(s);
  if (seg) {
    const [, headStr, unitCh, tailStr] = seg;
    const mult = /[万萬]/.test(unitCh) ? 1e4 : 1e8;
    // 「一万」的 head 为空时表示 1
    const head = headStr === '' ? 1 : parseCnInt(headStr);
    if (head === null) return null;
    if (tailStr === '') return head * mult;
    // 尾部是紧跟单位后的裸数字且无「零」→ 按 单位/10 缩放（「一万三」=13000）
    if (!literal && tailStr.length === 1 && tailStr in CN_DIGIT) {
      return head * mult + CN_DIGIT[tailStr] * (mult / 10);
    }
    const tail = parseCnInt(tailStr);
    if (tail === null) return null;
    return head * mult + tail;
  }

  // 千以内：累加"系数 × 单位"，末尾裸数字按上文判据决定量级
  let total = 0;
  let pending = null;       // 已读入但尚未乘单位的系数（null = 未读入）
  let prevWasUnit = false;  // 上一个字是不是单位
  let highestUnit = 0;
  let trailingAfterUnit = false; // 末尾裸数字是否紧跟单位

  for (const ch of s) {
    if (ch in CN_DIGIT) {
      pending = CN_DIGIT[ch];
      trailingAfterUnit = prevWasUnit;
      prevWasUnit = false;
    } else if (ch in CN_UNIT) {
      const u = CN_UNIT[ch];
      total += (pending === null ? 1 : pending) * u; // 「十五」的系数缺省为 1
      highestUnit = Math.max(highestUnit, u);
      pending = null;
      prevWasUnit = true;
    } else {
      return null;
    }
  }

  if (pending !== null) {
    // 末尾裸数字：跟在 ≥百 的单位后且无「零」时，按 该单位/10 解读
    if (!literal && trailingAfterUnit && highestUnit >= 100) total += pending * (highestUnit / 10);
    else total += pending;
  }
  return total;
}

/**
 * 解析中文/阿拉伯数字为数值。
 * 支持：12 / 12.5 / 1,200 / 三百五十 / 一千二 / 二十 / 两 / 十五 / 半
 * 不支持的写法（如「十几」「若干」）返回 null —— 下游规则据此跳过判定。
 */
export function parseNumber(raw) {
  if (isNil(raw)) return null;
  const s = trim(String(raw));
  if (s === '') return null;

  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === '半' || s === '一半') return 0.5;
  if (s === '两') return 2;

  return parseCnInt(s);
}

/** 是否是可解析的数量词（含阿拉伯数字或中文数字） */
export function looksNumeric(s) {
  return parseNumber(s) !== null;
}

/** 数值转中文（用于报告里写"三"而不是"3"，限 0–9999） */
export function numToCn(n) {
  const d = '零一二三四五六七八九';
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x) || x < 0 || x > 9999) return String(n);
  if (x < 10) return d[x];
  if (x < 20) return x === 10 ? '十' : '十' + d[x % 10];
  if (x < 100) return d[Math.trunc(x / 10)] + '十' + (x % 10 ? d[x % 10] : '');
  if (x < 1000) {
    const r = x % 100;
    return d[Math.trunc(x / 100)] + '百' + (r === 0 ? '' : r < 10 ? '零' + d[r] : numToCn(r));
  }
  const r = x % 1000;
  return d[Math.trunc(x / 1000)] + '千' + (r === 0 ? '' : r < 100 ? '零' + numToCn(r) : numToCn(r));
}

/* ---------------------------------------------------------------- 其它 */

export function nowIso(d = new Date()) {
  return d.toISOString();
}

/** 本地时间的紧凑时间戳，用于文件名 */
export function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function truncateList(arr, n, tailLabel = '等') {
  const a = arr || [];
  if (a.length <= n) return a.join('、');
  return a.slice(0, n).join('、') + tailLabel;
}

/** 极简断言，用于 lib 内部不变量（脚本层用 try/catch 转成友好报错） */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Zod 风格的轻量形状校验：返回错误字符串数组 */
export function checkShape(obj, spec, path = '') {
  const errs = [];
  if (!isObj(obj)) return [`${path || '<root>'} 应为对象`];
  for (const [key, rule] of Object.entries(spec)) {
    const p = path ? `${path}.${key}` : key;
    const v = obj[key];
    if (rule.required && isNil(v)) {
      errs.push(`缺少必填字段 ${p}`);
      continue;
    }
    if (isNil(v)) continue;
    const t = rule.type;
    if (t === 'string' && !isStr(v)) errs.push(`${p} 应为字符串`);
    else if (t === 'number' && !Number.isFinite(Number(v))) errs.push(`${p} 应为数字`);
    else if (t === 'boolean' && typeof v !== 'boolean') errs.push(`${p} 应为布尔值`);
    else if (t === 'array' && !Array.isArray(v)) errs.push(`${p} 应为数组`);
    else if (t === 'object' && !isObj(v)) errs.push(`${p} 应为对象`);
    else if (t === 'array' && Array.isArray(v) && rule.itemShape) {
      v.forEach((item, i) => errs.push(...checkShape(item, rule.itemShape, `${p}[${i}]`)));
    }
    if (rule.enum && !rule.enum.includes(v)) errs.push(`${p} 取值应为 ${rule.enum.join('/')}，实际为 ${v}`);
  }
  return errs;
}
