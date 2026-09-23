/**
 * lib/analyze.mjs — 第一步：分析输入文本，给出演绎思路与方向。纯函数。
 *
 * 产出 analysis.json：看清原文是什么、适合怎么演绎、以及**哪些信息还不确定需要问人**。
 *
 * 这一节的立场：**不假装确定**。
 * 体裁/人物/年代都可能抽错，所以每一条判断都带 confidence 与 evidence，
 * 并把不确定的部分写进 missing（交给第二步的人工确认）。
 */

import { scanSegments, textStats, fingerprint, quote, segmentsWithAny, countChars } from './text.mjs';
import { detectGenre, detectEra, buildStandard, GENRES } from './genre.mjs';
import { extractCharacters, extractNarrative, extractTimeline, extractPlaces, extractWorldRules, extractConflicts, extractFacts } from './extract.mjs';
import { scoreAllModes, MODE_BY_KEY, SCALE, requiredInputs } from './modes.mjs';
import { SCHEMA_VERSION, normScore } from './schema.mjs';
import { uniq } from './util.mjs';

/* ------------------------------------------------------------------ 留白点 */

/**
 * 识别"可演绎的接口"——原文没写、但可以合理地补上的地方。
 *
 * 判据尽量落在**文本可验证的形式**上（省略号、跳跃时间副词、突然+无因动作），
 * 而不是靠语义猜测，这样每一条都能指回原文，人工确认时一眼能判对错。
 */
export function detectGaps(segments, an) {
  const gaps = [];
  let n = 0;

  const push = (kind, kindLabel, seg, description, whyWeavable) => {
    gaps.push({
      id: `g${++n}`,
      kind,
      kindLabel,
      description,
      whyWeavable,
      segmentId: seg?.id ?? null,
      line: seg?.line ?? null,
      evidence: seg ? [{ segmentId: seg.id, line: seg.line, quote: quote(seg.text, 70) }] : [],
    });
  };

  const last = segments[segments.length - 1];

  // 1) 未收束的结局
  if (last) {
    if (/[？?]$/.test(last.text)) push('ending', '未收束的结局', last, '原文以一个疑问收尾，没有给出答案', '可以续写出答案，或写出"没有答案"的后果');
    else if (/[…]$|\.\.\.$/.test(last.text)) push('ending', '未收束的结局', last, '原文以省略收尾，情节悬置', '省略号处是最自然的演绎接口');
    else if (/竟然|却|忽然|突然|没想到|谁知/.test(last.text)) push('ending', '未收束的结局', last, '原文在转折处戛然而止', '转折之后的走向未被交代');
  }

  // 2) 回溯性留白（过往未展开）
  const retro = segmentsWithAny(segments, ['想起', '回忆起', '记得', '从前', '当年', '小时候', '多年前', '曾经']);
  for (const seg of retro.slice(0, 3)) {
    push('backstory', '未展开的过往', seg, '原文提到一段过往但未展开', '前传或回溯段落可直接演绎这段过往');
  }

  // 3) 跳跃的时间（未明时长的过渡）
  const jumps = segmentsWithAny(segments, ['后来', '多年后', '数年后', '几年后', '不久后', '过了', '此后', '从那以后']);
  for (const seg of jumps.slice(0, 3)) {
    push('time_jump', '跳跃的时间', seg, '原文用"后来/多年后"跳过了中间过程', '被跳过的那段时间可以演绎（续写/扩写）');
  }

  // 4) 未交代的动机（突然 + 动作，且同句无因果连词）
  const abrupt = segmentsWithAny(segments, ['突然', '忽然', '猛地', '一下子', '竟然']);
  for (const seg of abrupt) {
    if (/因为|由于|所以|于是|原因是/.test(seg.text)) continue;
    push('motive', '未交代的动机', seg, '原文出现了突变行为但未给出原因', '动机是最容易演绎、也最容易出常识错误的地方，需谨慎');
  }

  // 5) 被省略的过程（概述式表达）
  const summarized = segmentsWithAny(segments, ['就这样', '从此', '终于', '总算', '最后']);
  for (const seg of summarized.slice(0, 3)) {
    push('process', '被省略的过程', seg, '原文用概述句跳过了过程', '扩写的主要落点');
  }

  // 6) 戏份不足的人物
  const chars = an.elements?.characters ?? [];
  for (const c of chars) {
    if (c.mentions <= 2 && c.speechCount === 0) {
      const seg = segments.find((s) => s.text.includes(c.name));
      push('character', '未展开的人物', seg, `「${c.name}」在原文中出现 ${c.mentions} 次但没有台词`, '适合做番外主角，或在扩写中补足');
    }
  }

  // 7) 缺失的细节（原文极短时的整体留白）
  const chars_ = an.source?.chars ?? 0;
  if (chars_ < 500) {
    push('detail', '缺失的细节', segments[0], `原文仅 ${chars_} 字，绝大多数细节（环境、外貌、动作、心理）未交代`, '扩写空间极大');
  }

  // 去重（同一 segment 同一 kind 只留一条）
  const seen = new Set();
  return gaps.filter((g) => {
    const k = `${g.kind}:${g.segmentId ?? g.description}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 24);
}

/* ------------------------------------------------------------------ 主流程 */

/**
 * 分析输入文本。
 * @param {object} p
 * @param {string} p.raw       原文
 * @param {object} [p.opts]    { genreHint, tierOverride, yearHint }
 */
export function analyzeText({ raw, opts = {} } = {}) {
  const text = String(raw ?? '');
  const segments = scanSegments(text);
  const stats = textStats(text);

  const genre = detectGenre(segments, opts);
  const era = detectEra(segments, text, opts.yearHint);
  const standard = buildStandard(genre, era);
  const narrative = extractNarrative(segments, text);
  const characters = extractCharacters(segments);
  const timeline = extractTimeline(segments);
  const places = extractPlaces(segments);
  const worldRaw = extractWorldRules(segments);
  const conflicts = extractConflicts(segments);
  const facts = extractFacts(segments);

  const world = {
    tier: standard.tier,
    era: { label: era.label, key: era.key, range: era.range, year: era.year, confidence: era.confidence, identifiedBy: era.identifiedBy, markers: era.markers },
    rules: worldRaw.rules,
    ruleCount: worldRaw.count,
    places: places.map((p) => ({ id: p.id, name: p.name, kind: p.kind, mentions: p.mentions })),
  };

  // 先组一个"半成品"分析对象，供 gaps 与 modeFit 使用
  const partial = {
    source: { chars: stats.chars, fingerprint: fingerprint(text) },
    genre, standard, narrative, elements: { characters, timeline, places }, world, conflicts, facts,
    meta: { firstSegment: segments[0]?.text ?? '', lastSegment: segments[segments.length - 1]?.text ?? '' },
  };

  const gaps = detectGaps(segments, partial);
  partial.gaps = gaps;
  // 文本类型要在模式评分之前算好：扩写的适配度依赖 completeness
  partial.textType = classifyTextType(segments, stats, genre, narrative);

  const modeFit = scoreAllModes(partial);

  // 推荐：最高分模式；但把"用户给了 hint"的情况单独标注
  const top = modeFit[0] ?? null;
  const alt = modeFit.slice(1, 4);

  const recommendation = {
    mode: top?.mode ?? 'expand',
    modeLabel: top?.label ?? '扩写',
    score: top?.score ?? 0,
    direction: buildDirection(top, partial),
    alternates: alt.map((m) => ({ mode: m.mode, label: m.label, score: m.score })),
    why: top?.reasons ?? [],
    cautions: top?.cautions ?? [],
    // 第二步要人工确认的必备参数
    needConfirm: requiredInputs(top?.mode ?? 'expand'),
    scaleSuggest: suggestScale(stats.chars),
  };

  const missing = detectMissing({ genre, era, characters, world, narrative, stats });

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'analysis',
    generator: 'story-weave',
    generatedAt: new Date().toISOString(),
    source: {
      kind: opts.sourceKind ?? 'text',
      files: opts.files ?? [],
      chars: stats.chars,
      paragraphs: stats.paragraphs,
      sentences: stats.sentences,
      avgSentenceChars: stats.avgSentenceChars,
      fingerprint: fingerprint(text),
    },
    textType: partial.textType,
    genre,
    standard,
    narrative,
    elements: {
      characters,
      timeline,
      places,
      relationships: inferRelationships(segments, characters),
    },
    world,
    facts,
    conflicts,
    gaps,
    modeFit,
    recommendation,
    missing,
    meta: {
      firstQuote: quote(segments[0]?.text ?? '', 70),
      lastQuote: quote(segments[segments.length - 1]?.text ?? '', 70),
      segmentCount: segments.length,
      options: { genreHint: opts.genreHint ?? null, tierOverride: opts.tierOverride ?? null, yearHint: opts.yearHint ?? null },
    },
  };
}

/* ------------------------------------------------------------------ 文本类型 */

const TEXT_TYPES = [
  { key: 'narrative_fragment', label: '叙事片段', re: /[\u4e00-\u9fa5]{2,}[，。]/, hint: '有完整句子的叙事文本' },
  { key: 'outline', label: '梗概大纲', re: /^[一二三四五六七八九十\d]+[、.)）]/, hint: '条目式' },
  { key: 'news', label: '事实报道', re: /(记者|报道|讯|电|据悉|昨日|发布会)/, hint: '新闻/通报体' },
  { key: 'dialogue_log', label: '对话记录', re: /^[^：:\n]{1,8}[：:]/, hint: '以"某人："开头' },
  { key: 'setting', label: '设定片段', re: /(设定|规则|体系|世界观|能力|等级)/, hint: '设定说明体' },
  { key: 'lyric', label: '抒情/诗歌', re: /[\u4e00-\u9fa5]{3,}[，。][\u4e00-\u9fa5]{3,}[，。]/, hint: '整齐短句' },
  { key: 'classical_poem', label: '古诗/文言韵文', re: /[\u4e00-\u9fa5]{4,7}[，。？！][\u4e00-\u9fa5]{4,7}[，。？！]/, hint: '句式整齐、多文言虚词' },
];

export function classifyTextType(segments, stats, genre, narrative) {
  const text = segments.map((s) => s.text).join('\n');
  const scores = {};
  for (const t of TEXT_TYPES) {
    let s = 0;
    const lines = text.split('\n');
    // 条目式：多行以序号开头
    if (t.key === 'outline') {
      const numbered = lines.filter((l) => /^[一二三四五六七八九十\d]+[、.)）]/.test(l.trim())).length;
      s = numbered >= 2 ? 0.8 : 0;
    } else if (t.key === 'dialogue_log') {
      const dl = lines.filter((l) => /^[^：:\n]{1,8}[：:]/.test(l.trim())).length;
      s = lines.length && dl / lines.length > 0.4 ? 0.75 : 0;
    } else if (t.key === 'classical_poem') {
      // 文言韵文：**按"顿"（逗号）切出的短句**长度集中在 4–7 字，且出现文言虚词。
      // 【坑】不能用 segment 长度来判：断句器只在句末标点（。！？；）处切，
      // 「精卫衔微木，将以填沧海。」是**一个** segment（含两个五言），
      // 而且 countChars 会把标点也算进去，于是句长恒为 12，整齐度判定永远为假。
      const clauses = [];
      for (const seg of segments || []) {
        for (const part of String(seg.text).split(/[，、,；;]/)) {
          const clean = part.replace(/[。！？!?…—\u201c\u201d\u300c\u300d、，,；;：:\s]/g, '');
          if (clean.length) clauses.push(clean.length);
        }
      }
      const tidy = clauses.length >= 2
        && clauses.filter((n) => n >= 4 && n <= 7).length / clauses.length >= 0.8;
      const classical = /(之|其|乃|岂|讵|既|固|矣|焉|耳|兮|夫|犹|庶|哉|尔|斯|是以|何以|将以)/.test(text);
      s = tidy && classical ? 0.85 : (tidy && clauses.length >= 4 ? 0.55 : 0);
    } else if (t.key === 'lyric') {
      s = stats.avgSentenceChars <= 9 && stats.sentences >= 4 ? 0.6 : 0;
    } else if (t.key === 'news') {
      s = t.re.test(text) ? 0.6 : 0;
    } else if (t.key === 'setting') {
      s = t.re.test(text) ? 0.55 : 0;
    } else {
      s = stats.sentences >= 3 ? 0.5 : 0.2;
    }
    scores[t.key] = normScore(s);
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [primary, score] = sorted[0];
  const def = TEXT_TYPES.find((t) => t.key === primary);
  return {
    primary,
    label: def?.label ?? '未分类',
    confidence: normScore(score),
    note: def?.hint ?? '',
    scores,
    // 叙事完整度：句子数、对话密度、人物数共同决定"原文离完整叙事有多远"
    completeness: normScore(Math.min(1, (stats.sentences / 20) * 0.5 + (narrative.dialogueRatio ?? 0) * 0.3 + 0.2)),
  };
}

/* ------------------------------------------------------------------ 关系推断 */

/** 从"称谓 + 代词/名字"共现推断关系，置信度一律给低值（需人工确认） */
export function inferRelationships(segments, characters) {
  const out = [];
  const KIN_PAIRS = [
    { a: ['母亲', '妈妈'], b: null, type: '母子/母女' },
    { a: ['父亲', '爸爸'], b: null, type: '父子/父女' },
    { a: ['哥哥'], b: null, type: '兄弟/兄妹' },
    { a: ['姐姐'], b: null, type: '姐妹/姐弟' },
    { a: ['妻子', '老婆'], b: null, type: '夫妻' },
    { a: ['丈夫', '老公'], b: null, type: '夫妻' },
  ];
  for (const seg of segments) {
    for (const k of KIN_PAIRS) {
      if (k.a.some((w) => seg.text.includes(w))) {
        // 该句里出现的其他人名，认为与之有该关系
        const others = characters.filter((c) => seg.text.includes(c.name));
        for (const o of others) {
          out.push({
            type: k.type,
            relatedCharacter: o.name,
            confidence: 0.4,
            evidence: [{ segmentId: seg.id, line: seg.line, quote: quote(seg.text, 60) }],
          });
        }
      }
    }
  }
  return out.slice(0, 10);
}

/* ------------------------------------------------------------------ 推荐方向 */

function buildDirection(top, an) {
  if (!top) return '未能评估出合适的演绎方向，请人工指定模式。';
  const p = an.elements?.characters?.find((c) => c.isTop)?.name ?? an.elements?.characters?.[0]?.name ?? '主角';
  const place = an.world?.places?.[0]?.name ?? '原文场景';
  const gap = an.gaps?.[0];
  const parts = [
    `以「${top.label}」演绎：${MODE_BY_KEY[top.mode]?.what ?? ''}`,
    `建议主线围绕「${p}」在${place}的处境展开`,
  ];
  if (gap) parts.push(`首个落点可选原文的留白：${gap.description}（${gap.whyWeavable}）`);
  return parts.join(' ');
}

function suggestScale(chars) {
  if (chars < 600) return { key: 'short', ...SCALE.short, reason: `原文仅 ${chars} 字，中篇即可充分展开且不易注水` };
  if (chars < 2500) return { key: 'short', ...SCALE.short, reason: `原文 ${chars} 字，中篇（8 节）与原文体量匹配` };
  if (chars < 6000) return { key: 'long', ...SCALE.long, reason: `原文 ${chars} 字，已有相当体量，建议长篇节选以容纳多条线` };
  return { key: 'long', ...SCALE.long, reason: `原文 ${chars} 字，篇幅较大，演绎应聚焦一条线，避免铺得太开` };
}

/* ------------------------------------------------------------------ 待确认信息 */

/**
 * 列出"信息不足、需要问用户"的事项。
 * 这些会在第二步通过 ask_user_question 卡片问，或在对话里问。
 */
export function detectMissing({ genre, era, characters, world, narrative, stats }) {
  const missing = [];

  if (!genre || genre.confidence < 0.5) {
    missing.push({
      id: 'm-tier',
      question: '这篇文本是现实向还是架空（幻想/科幻/穿越等）？',
      why: '常识标尺完全取决于这一点：现实向要严守现实常识，架空向则以"作品内部设定一致性"为主。识别置信度不足时不能替用户猜。',
      affects: ['standard', 'commonsense-rules'],
      options: [
        { value: 'realistic', label: '现实向（严守现实常识）' },
        { value: 'speculative', label: '架空向（以设定一致性为主）' },
      ],
      current: genre?.tier ?? 'unknown',
    });
  }

  if ((!era || era.label === '未指明') && genre?.tier === 'realistic') {
    missing.push({
      id: 'm-era',
      question: '故事发生在哪个年代？',
      why: '年代决定"时代错位"类常识检查的口径（如唐代不该出现手机）。年代不明时该类检查会整体跳过以免误报。',
      affects: ['era', 'anachronism'],
      options: [
        { value: 'ancient', label: '古代（请具体到朝代）' },
        { value: 'republic', label: '民国' },
        { value: 'modern', label: '当代' },
        { value: 'unspecified', label: '故意模糊/架空年代' },
      ],
      current: era?.label ?? '未指明',
    });
  }

  if (!characters.length) {
    missing.push({
      id: 'm-proto',
      question: '这个故事的主角是谁？（原文里的人物用了什么称呼？）',
      why: '未能从原文抽取出人物名（可能全篇只用代词），而演绎必须有承载者。',
      affects: ['elements.characters', 'writing'],
      options: [],
      current: null,
    });
  } else if (characters[0].confidence < 0.4) {
    missing.push({
      id: 'm-proto-confirm',
      question: `抽取到的人物是「${characters.map((c) => c.name).slice(0, 5).join('、')}」，是否正确？谁是主角？`,
      why: '人物抽取置信度偏低，需人工确认，避免演绎时写错人。',
      affects: ['elements.characters'],
      options: characters.slice(0, 5).map((c) => ({ value: c.name, label: c.name })),
      current: characters[0].name,
    });
  }

  if (genre?.tier === 'speculative' && !world.rules.length) {
    missing.push({
      id: 'm-rules',
      question: '这个架空设定的"力量边界"是什么？（能做什么、不能做什么、代价是什么）',
      why: '架空向作品的常识校验以内部设定一致性为主，但没有抽到任何设定条目。缺少边界就无法判断演绎是否违反了设定。',
      affects: ['world.rules', 'internal-consistency'],
      options: [],
      current: null,
    });
  }

  if (narrative?.person === 'third' && (narrative.pronounCounts?.third ?? 0) > 10 && characters.length > 1) {
    missing.push({
      id: 'm-pov',
      question: '演绎用谁的视角叙述？',
      why: '原文第三人称且代词密集，人物多于一个时，视角不明确会导致"角色知道他不可能知道的事"。',
      affects: ['narrative.pov'],
      options: characters.slice(0, 4).map((c) => ({ value: c.name, label: `${c.name}的视角` })),
      current: null,
    });
  }

  if (stats.chars > 8000) {
    missing.push({
      id: 'm-scope',
      question: '原文较长，本次演绎聚焦哪一条线？',
      why: '全文演绎会导致篇幅失控与细节稀释，建议先锁定主线。',
      affects: ['scope'],
      options: [],
      current: null,
    });
  }

  return missing;
}

export { GENRES };
