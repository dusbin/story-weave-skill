/**
 * lib/text.mjs — 文本切分与定位。纯函数，无 IO。
 *
 * 设计要点：**所有下游产物都必须能指回原文**。
 * 因此切分不返回裸字符串，而是返回带 `line` / `start` / `end` 的 segment，
 * 常识校验的每条 finding 都挂 segmentId，报告里能显示「第 12 行：……」
 * 没有位置信息的规则命中一律视为无效命中。
 */

import { noSpace, squeeze, trim } from './util.mjs';

/** 句末标点（中文语境）。省略号与破折号不算句末——它们常连接同句。 */
const SENT_END = /[。！？!?；;…]+["'”’）)】」』]*$/;

/** 句内分隔符：先按这些切，但切完仍算"同一句"的从属成分时不单独成句 */
const SENT_SPLIT_RE = /(?<=[。！？!?；;])/;

/** 段落分隔：一个或多个空行 */
const PARA_SPLIT_RE = /\n[ \t\u3000]*\n+/;

/**
 * 把全文切成段落，记录每段的起始行号与字符区间。
 * @returns {{index:number, text:string, start:number, end:number, line:number}[]}
 */
export function splitParagraphs(raw) {
  const src = String(raw ?? '').replace(/\r\n?/g, '\n');
  if (trim(src) === '') return [];

  const paras = [];
  let cursor = 0;
  let line = 1;

  const parts = src.split(PARA_SPLIT_RE);
  for (const part of parts) {
    // split 会吃掉分隔符，重新定位：从 cursor 起找这段文本
    const idx = src.indexOf(part, cursor);
    const start = idx >= 0 ? idx : cursor;
    // 该段之前的行数
    const before = src.slice(0, start);
    line = before.split('\n').length;
    cursor = start + part.length;

    const text = trim(part);
    if (text === '') continue;

    // 段内首行行号（去掉段首空行偏移）
    const leadBlank = part.length - part.replace(/^[\s\u3000]+/, '').length;
    const innerLine = line + (part.slice(0, leadBlank).split('\n').length - 1);

    paras.push({
      index: paras.length,
      text,
      start: start + leadBlank,
      end: start + leadBlank + text.length,
      line: innerLine,
    });
  }
  return paras;
}

/**
 * 把全文切成 segment（句子级），带原文位置。
 * 这是常识校验与证据引用的最小单位。
 */
export function scanSegments(raw) {
  const src = String(raw ?? '').replace(/\r\n?/g, '\n');
  const paras = splitParagraphs(src);
  const segs = [];

  for (const para of paras) {
    // 全文偏移 → 行号
    const lineOf = (offset) => src.slice(0, offset).split('\n').length;

    const pieces = para.text.split(SENT_SPLIT_RE);
    let localCursor = 0;
    for (const piece of pieces) {
      if (trim(piece) === '') continue;
      const leading = piece.length - piece.replace(/^[\s\u3000]+/, '').length;
      const text = trim(piece);
      const localStart = localCursor + leading;
      localCursor += piece.length;

      const absStart = para.start + localStart;
      // 去掉尾部空白后的真实范围
      const trailing = piece.length - piece.replace(/[\s\u3000]+$/, '').length;
      const absEnd = para.start + localCursor - trailing;

      segs.push({
        id: `s${segs.length + 1}`,
        index: segs.length,
        paraIndex: para.index,
        text,
        start: absStart,
        end: absEnd,
        line: lineOf(absStart),
        isParaStart: localStart === 0,
      });
    }
  }
  return segs;
}

/** 建 id → segment 索引 */
export function indexSegments(segments) {
  const m = new Map();
  for (const s of segments) m.set(s.id, s);
  return m;
}

/**
 * 在 segments 里按正则找命中，返回带位置的命中列表。
 * @param {Array} segments
 * @param {RegExp|string} pattern 需要全局匹配；字符串会被当成字面量
 * @param {object} [opts] { limit, name }
 */
export function findMatches(segments, pattern, opts = {}) {
  const limit = opts.limit ?? 200;
  const re = pattern instanceof RegExp
    ? new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    : new RegExp(escapeRe(pattern), 'g');

  const hits = [];
  for (const seg of segments) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(seg.text)) !== null) {
      hits.push({
        segmentId: seg.id,
        line: seg.line,
        match: m[0],
        groups: m.slice(1),
        // 命中在 segment 内的字符偏移 → 全文偏移
        charStart: seg.start + m.index,
        snippet: seg.text,
      });
      if (m[0] === '') re.lastIndex++; // 防空转
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** 命中任一关键词的 segments（大小写不敏感） */
export function segmentsWithAny(segments, keywords) {
  const list = (keywords || []).filter(Boolean);
  if (list.length === 0) return [];
  const out = [];
  for (const seg of segments) {
    const lower = seg.text.toLowerCase();
    if (list.some((k) => lower.includes(String(k).toLowerCase()))) out.push(seg);
  }
  return out;
}

/** 命中全部关键词（AND），用于"两个条件同时出现才需检查"的规则 */
export function segmentsWithAll(segments, keywords) {
  const list = (keywords || []).filter(Boolean);
  if (list.length === 0) return [];
  return segments.filter((seg) => {
    const lower = seg.text.toLowerCase();
    return list.every((k) => lower.includes(String(k).toLowerCase()));
  });
}

/** 整个 segment 列表里是否出现过某个词 */
export function hasAnywhere(segments, keywords) {
  const list = (keywords || []).filter(Boolean);
  if (list.length === 0) return false;
  return segments.some((seg) => list.some((k) => seg.text.includes(k)));
}

/** 数字+单位的邻近抽取：在 segment 内找「数字 单位」组合 */
export function findQuantities(segments, unitPattern, opts = {}) {
  const unitSrc = unitPattern instanceof RegExp ? unitPattern.source : escapeRe(String(unitPattern));
  const numSrc = '[0-9]+(?:\\.[0-9]+)?|[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬]{1,8}';
  const re = new RegExp(`(${numSrc})\\s*(${unitSrc})`, 'g');
  return findMatches(segments, re, opts);
}

export function escapeRe(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 提取中文标点以外的"词"（简易：按标点与空白切，过滤单字虚词） */
const STOPWORDS = new Set(['的', '了', '是', '在', '和', '与', '也', '都', '就', '而', '及', '或', '但', '很', '把', '被', '给', '让', '向', '从', '对', '为', '着', '过', '吗', '呢', '吧', '啊', '他', '她', '它', '我', '你', '们', '这', '那', '一', '个', '上', '下', '里', '有', '没', '不']);

export function tokenize(text) {
  const t = String(text ?? '')
    .replace(/[，。！？、；：""''（）《》【】…—～·,.!?;:"'()<>\[\]\s]+/g, '\u0001');
  return t.split('\u0001').map(trim).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** 字数统计（不含空白，中文场景） */
export function countChars(text) {
  return noSpace(String(text ?? '')).length;
}

/** 显示用引文：压缩空白 + 截断 */
export function quote(text, max = 60) {
  const t = squeeze(String(text ?? ''));
  return t.length <= max ? t : t.slice(0, max) + '…';
}

/**
 * 文本指纹：用于判断"分析的是不是同一份输入"。
 * 归一化掉空白差异，避免因为换行不同就判定为不同文本。
 */
export function fingerprint(text) {
  const norm = noSpace(String(text ?? '')).replace(/[，。！？、；：""''（）]/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h = (h ^ norm.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 中文段落/句子统计，给分析报告用 */
export function textStats(raw) {
  const src = String(raw ?? '');
  const segments = scanSegments(src);
  const paras = splitParagraphs(src);
  const sentences = segments.length;
  const chars = countChars(src);
  return {
    chars,
    paragraphs: paras.length,
    sentences,
    avgSentenceChars: sentences ? Math.round(chars / sentences) : 0,
    longestSentence: segments.reduce((a, s) => Math.max(a, countChars(s.text)), 0),
  };
}
