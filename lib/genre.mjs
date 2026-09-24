/**
 * lib/genre.mjs — 体裁、常识标尺与年代识别。纯函数。
 *
 * ## 为什么这一步最关键
 *
 * 常识标尺决定了后面所有校验的口径：把架空作品按现实标尺判，会把飞龙判成错误；
 * 把现实作品按架空标尺判，会放过"饿了三天还跑马拉松"。
 * 所以识别必须**有正面证据才算数**，并且允许用户显式覆盖。
 *
 * 判定策略（保守优先）：
 *   - 必须有**正面信号**（魔法/异能/星际/丧尸…）才判 speculative；
 *   - 没有任何幻想信号 → realistic（现实标尺，校验更严，误报风险由 overridable 机制兜住）；
 *   - 两种信号都很强 → 取强者，但 confidence 降低并在 signals 里说明冲突；
 *   - 用户传了 tierOverride → 直接采纳，并在 reason 里写明"用户指定"。
 */

import { normScore } from './schema.mjs';
import { uniq } from './util.mjs';
import { segmentsWithAny } from './text.mjs';

/* ------------------------------------------------------------------ 题材信号库 */

/**
 * 每个题材：{ key, label, tier, keywords[], note }
 * tier 表示这个题材默认属于哪把标尺。
 */
export const GENRES = [
  // ---------------- 幻想/架空（speculative）
  {
    key: 'xianxia', label: '仙侠修真', tier: 'speculative',
    keywords: ['修炼', '灵气', '元婴', '金丹', '飞升', '仙门', '法宝', '渡劫', '剑仙', '内丹', '神通', '宗门', '筑基', '道友', '灵根', '天劫'],
    note: '力量体系违反现实物理，但其自身规则必须自洽。',
  },
  {
    key: 'fantasy', label: '奇幻', tier: 'speculative',
    keywords: ['魔法', '咒语', '精灵', '巨龙', '巫师', '魔王', '法杖', '卷轴', '矮人', '兽人', '法师', '魔杖', '结界', '召唤术', '王国'],
    note: '魔法体系需有代价与限制，且不可自相矛盾。',
  },
  {
    key: 'scifi', label: '科幻', tier: 'speculative',
    keywords: ['飞船', '星际', '机器人', '人工智能', '克隆', '外星', '太空舱', '义体', '赛博', '元宇宙', '平行宇宙', '时空穿梭', '量子通信', '基因编辑', '殖民地', '光年'],
    note: '技术设定可以超前，但需内部一致；人物生理仍受现实约束。',
  },
  {
    key: 'wuxia', label: '武侠', tier: 'speculative',
    keywords: ['内力', '轻功', '点穴', '江湖', '掌门', '真气', '帮主', '武功', '秘籍', '剑法', '镖局', '客栈'],
    note: '轻功与内力超出常人，但伤病、刀剑伤害等仍按现实判。',
  },
  {
    key: 'myth', label: '神话/咏史', tier: 'speculative',
    keywords: [
      // 《山海经》系神话人物与事象
      '精卫', '刑天', '女娲', '盘古', '夸父', '后羿', '嫦娥', '共工', '蚩尤', '大禹', '神农', '仓颉',
      '炎帝', '黄帝', '羲和', '常羲', '烛龙', '相柳', '西王母', '鲲鹏', '山海经', '衔木', '干戚',
      '沧海', '天柱', '不周山', '弱水', '扶桑', '蓬莱', '昆仑', '九尾', '凤凰', '烛阴',
      // 神话/咏史语域
      '神话', '上古', '太古', '洪荒', '天神', '仙人', '下凡', '羽化', '丹心', '猛志',
    ],
    note: '神话与咏史诗：文本里的"违反现实"来自神话语域本身（人会化为鸟、无头仍能舞），不算常识错误。'
      + '但神话内部仍要自洽——一旦设定"化了就不能回头"，演绎里就不能又回头。人物仍按真人/真神判：会受伤、会力竭、会有代价。',
  },
  {
    key: 'timetravel', label: '穿越重生', tier: 'speculative',
    keywords: ['重生', '穿越', '回到过去', '前世', '夺舍', '异世界', '系统提示', '金手指', '宿主', '任务面板', '再次醒来', '睁眼又'],
    note: '最常见的"现实外壳 + 架空内核"：场景看着像现实，但主角带着超前信息或异世界能力。标尺取幻想侧，但现实常识（生理、时间、制度）仍作背景约束。',
  },
  {
    key: 'superpower', label: '超能力', tier: 'speculative',
    keywords: ['异能', '超能力', '读心', '预知', '念力', '瞬间移动', '超自然', '变异', '觉醒', '透视'],
    note: '能力边界必须明确，否则容易出现"该用时不用"。',
  },
  {
    key: 'horror', label: '灵异恐怖', tier: 'speculative',
    keywords: ['鬼魂', '幽灵', '怨灵', '驱魔', '符咒', '阴间', '附身', '僵尸', '诅咒', '鬼打墙', '阴阳眼'],
    note: '灵异规则需一致；现实中的人仍会受伤、会死。',
  },
  {
    key: 'apocalypse', label: '末世废土', tier: 'speculative',
    keywords: ['丧尸', '废土', '避难所', '末日', '病毒爆发', '幸存者', '辐射区', '物资匮乏'],
    note: '资源稀缺的设定反而更要求物资记账自洽。',
  },
  {
    key: 'fairytale', label: '童话寓言', tier: 'speculative',
    keywords: ['童话', '寓言', '会说话', '小矮人', '仙女', '魔镜', '王子', '公主', '森林深处'],
    note: '允许拟人与魔法，但内部逻辑仍要讲得通。',
  },

  // ---------------- 现实向（realistic）
  {
    key: 'urban', label: '都市情感', tier: 'realistic',
    keywords: ['公司', '老板', '加班', '地铁', '外卖', '手机', '微信', '房产', '面试', '同事', '写字楼', '咖啡', '租房', '房贷'],
    note: '职场流程、时间安排、金钱数额都按现实判。',
  },
  {
    key: 'campus', label: '校园', tier: 'realistic',
    keywords: ['学校', '教室', '老师', '同学', '高考', '宿舍', '班主任', '作业', '考试', '毕业', '家长会'],
    note: '学制、考试时间、年龄与年级对应关系可核算。',
  },
  {
    key: 'family', label: '家庭伦理', tier: 'realistic',
    keywords: ['母亲', '父亲', '结婚', '离婚', '婆媳', '孩子', '亲戚', '养老', '遗产', '月子'],
    note: '亲属称谓与辈分、年龄关系必须自洽。',
  },
  {
    key: 'crime', label: '犯罪悬疑', tier: 'realistic',
    keywords: ['刑警', '案发现场', '证据', '审讯', '法医', '检察院', '报警', '尸检', '嫌疑人', '侦查', '供述', '立案'],
    note: '司法程序有严格顺序，最容易出常识硬伤。',
  },
  {
    key: 'medical', label: '医疗职场', tier: 'realistic',
    keywords: ['医院', '手术', '病人', '急诊', '病历', '医生', '护士', '输血', '抢救', '住院', '主治', '麻醉'],
    note: '医疗流程与生理极限是硬常识，错得最明显。',
  },
  {
    key: 'history', label: '历史', tier: 'realistic',
    keywords: ['皇帝', '朝廷', '大臣', '将军', '科举', '奏折', '圣旨', '知府', '县令', '年号', '边关'],
    note: '年代一旦明确，器物、称谓、制度都要对得上。',
  },
  {
    key: 'military', label: '军旅', tier: 'realistic',
    keywords: ['部队', '连队', '演习', '命令', '战术', '战士', '阵地', '番号', '军令', '弹药'],
    note: '武器性能、行军速度、指挥层级可核算。',
  },
  {
    key: 'rural', label: '乡土', tier: 'realistic',
    keywords: ['村子', '庄稼', '承包地', '打工', '方言', '乡里', '赶集', '农忙', '麦子', '稻田'],
    note: '农时与节气、作物周期可核算。',
  },
  {
    key: 'workplace', label: '职场商战', tier: 'realistic',
    keywords: ['董事会', '收购', '融资', '股权', '合同', '谈判', '竞标', '审计', '财报', '上市'],
    note: '商业流程与金额量级、决策权限易出错。',
  },
];

/** 题材 key → 定义 */
export const GENRE_BY_KEY = Object.fromEntries(GENRES.map((g) => [g.key, g]));

/* ------------------------------------------------------------------ 年代信号 */

/** 年代识别表，按时间顺序排列；range 是保守的年代区间 */
export const ERAS = [
  { key: 'ancient_preqin', label: '先秦', range: [-1000, -221], keywords: ['诸侯', '天子', '周礼', '先秦', '春秋', '战国', '列国'] },
  {
    key: 'han', label: '秦汉', range: [-221, 220],
    // 典章制度类文本（《西京杂记》《汉书》这类）靠制度名词定年代，几乎不出现朝代名本身。
    // 「制：宗庙八月饮酎，用九酝太牢」全篇没有一个「汉」字，早先因此判成"年代未指明"，
    // 时代错位检查被整体跳过。
    keywords: ['秦', '汉', '刘邦', '项羽', '郡县', '丝绸之路', '汉朝', '丞相', '汉家', '汉室',
      '宗庙', '太牢', '少牢', '饮酎', '九酝', '醇酎', '侍祠', '太常', '少府', '御史大夫',
      '未央宫', '长乐宫', '郡国', '列侯', '元鼎', '武帝', '高祖', '孝武', '诏令', '制诏'],
  },
  { key: 'tang', label: '唐', range: [618, 907], keywords: ['唐朝', '大唐', '长安', '贞观', '开元', '节度使', '诗人', '科举'] },
  { key: 'song', label: '宋', range: [960, 1279], keywords: ['宋朝', '大宋', '汴京', '临安', '东京', '知州', '宋代', '词人'] },
  { key: 'yuan_ming', label: '元明', range: [1271, 1644], keywords: ['元朝', '大明', '明朝', '朱元璋', '锦衣卫', '郑和', '内阁', '东厂'] },
  { key: 'qing', label: '清', range: [1636, 1912], keywords: ['清朝', '大清', '康熙', '乾隆', '雍正', '慈禧', '八旗', '巡抚', '总督'] },
  { key: 'republic', label: '民国', range: [1912, 1949], keywords: ['民国', '军阀', '租界', '洋行', '大帅', '法币', '抗战', '枪毙'] },
  { key: 'modern', label: '当代', range: [1949, 2035], keywords: ['手机', '微信', '互联网', '地铁', '大学', '电脑', '高铁', '视频', '快递', '外卖', '医院', '警察', '身份证', '银行卡'] },
  { key: 'future', label: '未来/架空', range: [2036, 2999], keywords: ['星际', '飞船', '殖民地', '光年', '赛博', '元宇宙', '人工智能', '时空'] },
];

/** 明确的公元年份/朝代纪年识别 */
export function detectEra(segments, rawText, yearHint = null) {
  const markers = [];

  // 1) 明确公元年（最可靠）
  const years = [];
  for (const seg of segments) {
    const m = /(1[0-9]{3}|20[0-9]{2})\s*年/.exec(seg.text);
    if (m) years.push({ year: Number(m[1]), segmentId: seg.id, line: seg.line, quote: seg.text });
    const cn = /([零〇一二三四五六七八九]{4})\s*年/.exec(seg.text);
    if (cn) {
      const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
      let n = 0;
      for (const ch of cn[1]) n = n * 10 + D[ch];
      if (n >= 1000 && n <= 2100) years.push({ year: n, segmentId: seg.id, line: seg.line, quote: seg.text });
    }
  }
  // 【坑】不能用 Number.isFinite(Number(yearHint)) 判"是否指定了年份"：
  // Number(null) === 0 且 isFinite(0) 为真，于是"没指定"会被当成"公元 0 年"，
  // 再被 ERAS 的秦汉区间 [-221,220] 接住，凭空判出一个年代。
  const hasHint = yearHint !== null && yearHint !== undefined && yearHint !== ''
    && Number.isFinite(Number(yearHint));
  if (hasHint) years.push({ year: Number(yearHint), segmentId: null, line: null, quote: '（命令行指定）' });

  if (years.length) {
    const year = years[0].year;
    const era = ERAS.find((e) => year >= e.range[0] && year <= e.range[1]) ?? null;
    markers.push(...years.map((y) => ({ kind: 'year', label: `${y.year} 年`, segmentId: y.segmentId, line: y.line, quote: y.quote })));
    return {
      label: era ? `${era.label}（${year} 年）` : `${year} 年`,
      key: era?.key ?? null,
      range: era?.range ?? [year, year],
      year,
      confidence: normScore(0.95),
      identifiedBy: 'year',
      markers,
    };
  }

  // 2) 朝代/年代关键词
  const scored = [];
  for (const era of ERAS) {
    const hits = segmentsWithAny(segments, era.keywords);
    if (hits.length) scored.push({ era, hits, score: hits.length });
  }
  if (scored.length === 0) {
    return { label: '未指明', key: null, range: null, year: null, confidence: 0, identifiedBy: 'none', markers: [] };
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  // 现代器物词出现得多，说明是当代
  const totalHits = scored.reduce((a, s) => a + s.score, 0);
  const confidence = normScore(0.4 + 0.5 * (top.score / Math.max(1, totalHits)));
  for (const h of top.hits.slice(0, 6)) {
    markers.push({ kind: 'era_keyword', label: top.era.label, segmentId: h.id, line: h.line, quote: h.text });
  }
  return {
    label: top.era.label,
    key: top.era.key,
    range: top.era.range,
    year: null,
    confidence,
    identifiedBy: 'keyword',
    alternates: scored.slice(1, 4).map((s) => ({ key: s.era.key, label: s.era.label, score: s.score })),
    markers,
  };
}

/* ------------------------------------------------------------------ 体裁识别 */

/**
 * 识别体裁与常识标尺。
 * @param {Array} segments
 * @param {object} [opts] { genreHint, tierOverride, yearHint }
 */
export function detectGenre(segments, opts = {}) {
  const scored = [];

  for (const g of GENRES) {
    const hits = segmentsWithAny(segments, g.keywords);
    if (hits.length === 0) continue;
    const distinct = uniq(hits.flatMap((h) => g.keywords.filter((k) => h.text.includes(k))));
    // 分数：命中句数 + 命中关键词种类数（种类多比重复多更能说明体裁）
    const score = hits.length * 1.0 + distinct.length * 1.6;
    scored.push({ genre: g, hits, distinct, score });
  }

  // 用户显式指定
  if (opts.genreHint) {
    const key = String(opts.genreHint).toLowerCase();
    const g = GENRE_BY_KEY[key] ?? GENRES.find((x) => x.label === opts.genreHint || x.key === key);
    if (g) {
      return {
        primary: g.key,
        label: g.label,
        tier: opts.tierOverride ?? g.tier,
        confidence: normScore(1),
        identifiedBy: 'hint',
        note: '用户指定',
        signals: [],
        alternates: scored.slice(0, 3).map(toAlternative),
      };
    }
  }

  if (scored.length === 0) {
    // 没有任何题材信号：判现实标尺（校验更严），并明说证据不足
    return {
      primary: 'general',
      label: '通用叙事',
      tier: opts.tierOverride ?? 'realistic',
      confidence: normScore(0.3),
      identifiedBy: 'fallback',
      note: '未识别到明显的题材信号，按现实世界常识标尺校验（更严格的一侧）。若这是架空设定，请用 --tier speculative 覆盖。',
      signals: [],
      alternates: [],
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const speculativeSignals = scored.filter((s) => s.genre.tier === 'speculative');
  const realisticSignals = scored.filter((s) => s.genre.tier === 'realistic');

  let tier = top.genre.tier;
  let note = top.genre.note;

  // 冲突：两类信号都很强时，说明可能是"现实外壳 + 幻想内核"（如都市重生、历史穿越）。
  // 此时一律取幻想侧标尺：宁可在架空侧宽松（靠 overridable 降级兜底），
  // 也不要把「他会飞」这种设定当成硬伤报给作者。
  const specScore = speculativeSignals.reduce((a, s) => a + s.score, 0);
  const realScore = realisticSignals.reduce((a, s) => a + s.score, 0);
  let conflict = false;
  if (specScore > 0 && realScore > 0 && Math.min(specScore, realScore) / Math.max(specScore, realScore) > 0.5) {
    conflict = true;
    tier = 'speculative';
    note = '检测到现实向与幻想向信号并存（可能是"现实外壳+架空内核"，如穿越/重生）。'
      + `标尺取幻想侧，但现实常识仍作为背景约束生效（人物生理、时间、数量关系照旧按现实判）。原题材说明：${top.genre.note}`;
  }

  if (opts.tierOverride) {
    tier = opts.tierOverride;
    note = `标尺由用户显式指定为 ${tier}。${note ?? ''}`;
  }

  const totalScore = scored.reduce((a, s) => a + s.score, 0);
  let confidence = normScore(0.35 + 0.6 * (top.score / Math.max(1, totalScore)));
  if (conflict) confidence = normScore(confidence * 0.75);

  const signals = top.hits.slice(0, 5).map((h) => ({
    segmentId: h.id,
    line: h.line,
    quote: h.text,
    matched: uniq(top.genre.keywords.filter((k) => h.text.includes(k))),
  }));

  return {
    primary: top.genre.key,
    label: top.genre.label,
    tier,
    confidence,
    identifiedBy: opts.tierOverride ? 'tier_override' : 'auto',
    conflict,
    note,
    signals,
    alternates: scored.slice(1, 4).map(toAlternative),
    tierScores: {
      speculative: Math.round(specScore * 10) / 10,
      realistic: Math.round(realScore * 10) / 10,
    },
  };
}

function toAlternative(s) {
  return {
    key: s.genre.key,
    label: s.genre.label,
    tier: s.genre.tier,
    score: Math.round(s.score * 10) / 10,
    matched: s.distinct.slice(0, 6),
  };
}

/**
 * 生成常识标尺说明（写进 analysis.json 与报告）。
 */
export function buildStandard(genre, era) {
  const tier = genre?.tier ?? 'realistic';
  if (tier === 'speculative') {
    return {
      tier,
      label: '内部设定一致性标尺（现实常识作为背景约束）',
      reason: `体裁判定为「${genre?.label ?? '未知'}」（${genre?.identifiedBy === 'hint' ? '用户指定' : '自动识别'}）。架空设定本身不算常识错误，但必须遵守三点：`
        + '① 作品自己立下的规则、代价与限制不可违反；'
        + '② 人物仍按真人判（会饿、会累、会失血、会死），除非设定明确说明不是人；'
        + '③ 时间、数量、空间关系不可自相矛盾。',
      eraNote: era?.label && era.label !== '未指明' ? `年代判定为「${era.label}」。` : '年代未指明，时代错位类检查将跳过（避免误报）。',
    };
  }
  return {
    tier: 'realistic',
    label: '现实世界常识标尺',
    reason: `体裁判定为「${genre?.label ?? '通用叙事'}」（${genre?.identifiedBy === 'hint' ? '用户指定' : '自动识别'}）。`
      + '以现实世界的物理、生理、时间、社会制度为准：明确违反即视为常识性错误。',
    eraNote: era?.label && era.label !== '未指明' ? `年代判定为「${era.label}」，器物与用语需与该年代相符。` : '年代未指明，时代错位类检查将跳过（避免误报）。',
  };
}
