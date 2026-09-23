/**
 * lib/extract.mjs — 叙事要素抽取。纯函数。
 *
 * 抽取人物、时间线、地点、世界设定、叙事视角、冲突与留白点。
 *
 * ## 设计取舍
 *
 * 中文没有词边界，人名/地名没法可靠地"分出来"。所以这里**不做假装准确的抽取**，
 * 而是做三件事：
 *   1. 多路取证：姓氏表、称谓后缀、对话归属动词、出现频次，各给一个权重；
 *   2. 每个候选都带 evidence（原文片段 + 行号），让人一眼看出抽得对不对；
 *   3. 明确区分 confidence，并在第二步把结果交给人工确认。
 *
 * 用户是最终裁判，抽取器的职责是把"值得确认的东西"找出来，而不是替用户决定。
 */

import { parseAge, parseDuration } from './commonsense/kit.mjs';
import { quote, segmentsWithAny } from './text.mjs';
import { normScore } from './schema.mjs';
import { uniq } from './util.mjs';

/* ------------------------------------------------------------------ 姓氏与称谓 */

const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫房裘缪干解应宗丁宣邓郁单杭洪包左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊惠甄曲家封芮储靳松井段富巫乌焦巴弓牧山谷车侯全郗班仰秋仲伊宫宁仇栾暴甘历戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲台从鄂索咸籍赖卓蔺屠蒙池乔胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩聂晁勾融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓';

const DAILY_TITLES = ['医生', '大夫', '护士', '老师', '教授', '警官', '警察', '律师', '法官', '经理', '老板', '总监', '主任', '局长', '队长', '师傅', '班长', '校长', '院长', '工程师', '记者', '编辑', '司机', '保安', '厨师', '船长', '将军', '皇帝', '陛下', '殿下', '大人', '先生', '女士', '小姐', '太太', '夫人'];

/** 亲属/社会称谓（无姓名也能当角色，且对常识校验很重要——亲属关系要能核算） */
const KINSHIP = ['母亲', '父亲', '妈妈', '爸爸', '奶奶', '爷爷', '姥姥', '姥爷', '外婆', '外公', '哥哥', '弟弟', '姐姐', '妹妹', '儿子', '女儿', '妻子', '丈夫', '老婆', '老公', '叔叔', '阿姨', '舅舅', '姑姑', '伯伯', '婶婶', '嫂子', '弟媳', '姐夫', '妹夫', '表哥', '堂弟', '侄子', '侄女', '外甥', '孙子', '孙女', '公婆', '婆婆', '岳父', '岳母', '继母', '继父', '养父', '养母'];

/**
 * 对话归属动词：出现「人名 + 这些动词」时，人名置信度大幅提升。
 *
 * 【坑】这里**只能放单字动词**。曾经放了「摇头」「点头」这类双字词，
 * 于是「主任摇了摇头」被切成「任摇了」+ lookahead「摇头」，
 * 硬生生抽出一个叫"任摇了"的人物。多字动词一律不进这个列表。
 */
const SPEECH_VERBS = ['说', '道', '问', '答', '喊', '叫', '笑', '哭', '叹', '想', '看', '皱', '望', '低', '开', '回', '反', '嘟', '喃', '应', '念', '哼', '骂'];

/** 常见"像人名但不是人名"的词（姓氏 + 词 会误判），一律排除 */
/**
 * 昵称黑名单：「小/老/阿 + 字」在中文里绝大多数不是称呼，
 * 「小时候」「老师」「老虎」「小姐」「老婆」「老子」都会被误抽，必须显式排除。
 */
const NICKNAME_STOPWORDS = new Set([
  '小时', '小时', '时候', '老师', '老虎', '老鼠', '老板', '老婆', '老公', '老家', '老实', '老是', '小心', '小姐', '小孩', '小声', '小米', '小说', '小路', '小城', '小镇', '小屋', '小河', '小山', '小雨', '小雪', '小区', '小学', '小吃', '小伙子',
  '老王', '老天', '老远', '老早', '老半天', '阿妈', '阿姨', '阿爸',
]);

/** 中文功能词：出现在候选名/地名里就说明切错了，直接丢弃 */
const FUNCTION_WORDS = ['还是', '的', '了', '是', '在', '和', '与', '也', '都', '就', '而', '但', '很', '把', '被', '给', '让', '向', '从', '对', '为', '着', '过', '这', '那', '一个', '没有', '什么', '怎么', '这样', '那样', '已经', '正在', '要是', '因为', '所以', '但是', '然后', '于是'];

function hasFunctionWord(s) {
  return FUNCTION_WORDS.some((w) => String(s).includes(w));
}

const NAME_STOPWORDS = new Set([
  '时候', '时间', '问题', '东西', '事情', '记忆', '明天', '昨天', '今天', '以后', '以前', '样子', '方法', '结果', '开始', '结束', '心情', '眼睛', '里面', '外面', '上面', '下面', '旁边', '声音', '力气', '感觉', '味道', '脸色', '手里', '心里', '身上', '嘴上', '眼里', '头上', '脚下', '门口', '窗外', '路上', '街上', '家里', '屋里', '车里', '公司', '学校', '医院', '城市', '地方', '方向', '路口', '房间', '院子', '太阳', '月亮', '空气', '雨水', '风里', '梦里', '过去', '未来', '什么', '怎么', '这样', '那样', '一样', '已经', '曾经', '终于', '忽然', '突然', '然后', '于是', '但是', '可是', '如果', '因为', '所以', '虽然', '而且', '并且', '或者', '还有', '没有', '知道', '觉得', '认为', '看到', '听到', '感到', '发现', '想起', '记得', '忘了', '明白', '理解', '相信', '希望', '决定', '拒绝', '同意', '开始', '继续', '停下', '离开', '回来', '过来', '出去', '进来', '起来', '下来', '上去',
]);

/* ------------------------------------------------------------------ 人物抽取 */

/**
 * 抽取人物候选。
 * @returns {Array<{id,name,kind,role,confidence,evidence,speechCount,mentions}>}
 */
export function extractCharacters(segments) {
  /** name → 累计证据 */
  const bag = new Map();

  const add = (name, kind, seg, weight, reason) => {
    if (!name || name.length < 2 || name.length > 4) return;
    if (NAME_STOPWORDS.has(name)) return;
    if (!bag.has(name)) bag.set(name, { name, kinds: new Set(), evidence: [], score: 0, speech: 0, reasons: new Set(), mentions: 0, bestWeight: 0 });
    const e = bag.get(name);
    e.mentions += 1;
    e.score += weight;
    e.bestWeight = Math.max(e.bestWeight, weight);
    e.reasons.add(reason);
    if (kind) e.kinds.add(kind);
    if (e.evidence.length < 4) e.evidence.push({ segmentId: seg.id, line: seg.line, quote: quote(seg.text, 60) });
  };

  for (const seg of segments) {
    const t = seg.text;

    // 1) 姓名 + 对话归属动词：「林晚说」——最强证据
    const nameRe = new RegExp(`([${SURNAMES}][\\u4e00-\\u9fa5]{1,2})(?=${SPEECH_VERBS.join('|')})`, 'g');
    let m;
    while ((m = nameRe.exec(t)) !== null) {
      const name = m[1];
      add(name, 'named', seg, 5, '姓名 + 对话归属动词');
      bag.get(name).speech += 1;
    }

    // 2) 姓氏 + 称谓：「林医生」「王老师」
    const titleRe = new RegExp(`([${SURNAMES}][\\u4e00-\\u9fa5])(${DAILY_TITLES.join('|')})`, 'g');
    while ((m = titleRe.exec(t)) !== null) {
      add(`${m[1]}${m[2]}`, 'titled', seg, 4, `姓氏 + 称谓（${m[2]}）`);
      // 也把「林医生」记成 林医生 与 称谓角色
      add(m[2], 'role', seg, 2, '称谓后缀');
    }

    // 3) 姓氏 + 名字（宽松，靠频次与阈值过滤）
    const looseRe = new RegExp(`([${SURNAMES}][\\u4e00-\\u9fa5]{1,2})`, 'g');
    while ((m = looseRe.exec(t)) !== null) {
      add(m[1], 'named', seg, 1.2, '姓氏 + 1–2 字（待确认）');
    }

    // 4) 「老张」「小李」「阿明」
    const nickRe = /(老|小|阿)([\u4e00-\u9fa5])/g;
    while ((m = nickRe.exec(t)) !== null) {
      const nick = `${m[1]}${m[2]}`;
      if (NICKNAME_STOPWORDS.has(nick) || hasFunctionWord(nick)) continue;
      add(nick, 'nickname', seg, 3, '口语昵称（老/小/阿）');
    }

    // 5) 无姓名的亲属称谓
    for (const k of KINSHIP) {
      if (t.includes(k)) add(k, 'kinship', seg, 2.5, '亲属称谓');
    }

    // 6) 独立称谓
    for (const k of DAILY_TITLES) {
      if (t.includes(k)) add(k, 'role', seg, 1.5, '职业称谓');
    }
  }

  // 过滤：得分太低、且只出现一次的宽松候选一律丢弃（噪音）
  const candidates = [...bag.values()]
    .filter((c) => {
      if (hasFunctionWord(c.name)) return false;
      if (NAME_STOPWORDS.has(c.name) || NICKNAME_STOPWORDS.has(c.name)) return false;
      // 仅靠"宽松姓氏匹配"进来的，必须反复出现才算数（否则"主任摇了摇头"里的碎片也会入选）
      if (c.reasons.size === 1 && c.reasons.has('姓氏 + 1–2 字（待确认）') && c.mentions < 3) return false;
      return c.score >= 3;
    })
    // 【坑】不能只按累计得分排序：亲属称谓（"哥哥"）在一篇短文里会反复出现，
    // 累计分很容易盖过真正有动作、有台词的主角（"林晚说"只出现一次）。
    // 改为主角优先：先比"最强单条证据"（姓名+对话归属 > 姓氏+称谓 > 昵称 > 亲属称谓），
    // 同档再比累计分。这样"谁是主角"才不会被高频称谓带偏。
    .sort((a, b) => (b.bestWeight - a.bestWeight) || (b.score - a.score))
    .slice(0, 24);

  // 作用域过滤：「林医生」与「林医生」这种包含关系去重（保留更长的）
  const names = candidates.map((c) => c.name);
  const filtered = candidates.filter((c) => !names.some((n) => n !== c.name && n.includes(c.name) && n.length > c.name.length));

  // filtered 已按 score 降序：得分最高者即最可能的主角。
  // 【坑】之前按"台词数 >= 2"判主角，原文只有一句台词的真正主角会被判成配角，
  // 于是"番外主角"推荐把主角本人推了出来。改为以得分排序定主角。
  return filtered.map((c, i) => ({
    id: `c${i + 1}`,
    name: c.name,
    kinds: [...c.kinds],
    role: i === 0 ? 'protagonist?' : pickRole(c),
    isTop: i === 0,
    // 置信度：分母从 20 放宽到 12。原公式下"姓名 + 对话归属动词"（权重 5）只得到 0.25，
    // 这是个明显错误的信号——有对话归属的名字是相当强的证据。
    confidence: normScore(Math.min(1, c.score / 12) + (c.speech > 0 ? 0.15 : 0)),
    speechCount: c.speech,
    mentions: c.mentions,
    reasons: [...c.reasons],
    evidence: c.evidence,
  }));
}

function pickRole(c) {
  if (c.kinds.has('titled') || c.kinds.has('role')) return 'supporting?';
  if (c.kinds.has('kinship')) return 'family?';
  if (c.kinds.has('nickname')) return 'supporting?';
  return 'unknown';
}

/* ------------------------------------------------------------------ 叙事视角 */

const FIRST_PERSON = ['我', '我们', '咱', '咱俩'];
const THIRD_PERSON = ['他', '她', '他们', '她们'];

export function extractNarrative(segments, rawText) {
  const text = String(rawText ?? '');
  const count = (terms) => (text.match(new RegExp(terms.join('|'), 'g')) || []).length;

  const first = count(FIRST_PERSON);
  const third = count(THIRD_PERSON);
  let person = 'third';
  if (first > 0 && first >= third * 1.2) person = 'first';
  else if (first > 0 && third === 0) person = 'first';

  // 时态：中文没有形态变化，用时间副词近似判断
  const pastMarkers = ['了', '曾经', '那时', '当时', '后来', '已经', '当时'];
  const presentMarkers = ['正在', '此刻', '现在', '这时'];
  const pastHits = count(pastMarkers);
  const presentHits = count(presentMarkers);
  const tense = presentHits > pastHits ? 'present' : 'past';

  // 语气：按标点与情绪词粗判
  const exclaim = (text.match(/[！!]/g) || []).length;
  const question = (text.match(/[？?]/g) || []).length;
  const dash = (text.match(/[—–-]{1,}/g) || []).length;
  const perSeg = segments.length || 1;
  const tone = [];
  if (exclaim / perSeg > 0.15) tone.push('情绪外放');
  if (question / perSeg > 0.15) tone.push('疑问/悬置');
  if (dash / perSeg > 0.1) tone.push('中断/犹疑');
  if (tone.length === 0) tone.push('克制');

  // 对话密度（引号句占比）
  // 对话/引号检测：用显式码位，避免源文件里弯引号被编辑器换成直引号后静默失效
  const QUOTE_RE = /[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f"']/;
  const dialogueSegs = segments.filter((s) => QUOTE_RE.test(s.text)).length;

  return {
    person,
    personLabel: person === 'first' ? '第一人称' : '第三人称',
    tense,
    tenseLabel: tense === 'present' ? '以现在时感叙述' : '以过去时感叙述',
    pov: person === 'first' ? '限知（主角视角）' : '限知/全知（需确认）',
    tone,
    dialogueRatio: normScore(dialogueSegs / perSeg),
    pronounCounts: { first, third },
  };
}

/* ------------------------------------------------------------------ 时间线 */

/** 相对时间词 → 大致偏移（天），用于粗排时间线顺序 */
const RELATIVE_TIME = [
  { re: /(三|3)?年前|数年前|多年前/, days: -1095, label: '多年前' },
  { re: /(几个|数)?月前|上个月/, days: -90, label: '数月前' },
  { re: /(几|数)?天前|前两天|几天前/, days: -3, label: '数天前' },
  { re: /昨天|昨日|头天/, days: -1, label: '昨天' },
  { re: /今天|今日|当天/, days: 0, label: '今天' },
  { re: /明天|次日|第二天|翌日/, days: 1, label: '明天' },
  { re: /(几|数)天后|几天后|过了几天/, days: 3, label: '数天后' },
  { re: /(几|数)?周后|下?个?星期/, days: 7, label: '一周后' },
  { re: /(几|数)?个月后|下个月/, days: 90, label: '数月后' },
  { re: /(几年后|数年后|多年后|年后)/, days: 1095, label: '多年后' },
  { re: /后来|之后|随后|不久后|过了?一会儿|片刻后/, days: null, label: '此后（未明时长）' },
  { re: /从前|当年|小时候|很久以前|从前/, days: null, label: '回溯（未明时长）' },
];

const ABSOLUTE_TIME = [
  { re: /(春|夏|秋|冬)(天|季|日)?/, kind: 'season', label: '季节' },
  { re: /(一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月|[0-9]{1,2}月)/, kind: 'month', label: '月份' },
  { re: /(凌晨|清晨|早上|上午|中午|正午|下午|傍晚|黄昏|晚上|夜里|深夜|半夜|午夜)/, kind: 'daypart', label: '时段' },
  { re: /(星期[一二三四五六日天]|周[一二三四五六日天]|礼拜[一二三四五六日天])/, kind: 'weekday', label: '星期' },
  { re: /(春节|元宵|清明|端午|中秋|重阳|除夕|元旦|国庆)/, kind: 'festival', label: '节日' },
  { re: /(民国[零〇一二三四五六七八九十]+年|[零〇一二三四五六七八九]{2,4}年|[0-9]{3,4}年)/, kind: 'year', label: '年份' },
];

export function extractTimeline(segments) {
  const events = [];
  let order = 0;

  for (const seg of segments) {
    const t = seg.text;

    for (const a of ABSOLUTE_TIME) {
      const m = a.re.exec(t);
      if (m) {
        events.push({
          id: `t${++order}`,
          kind: 'absolute',
          subkind: a.kind,
          when: m[0],
          order,
          segmentId: seg.id,
          line: seg.line,
          quote: quote(t, 60),
        });
        break;
      }
    }
    for (const r of RELATIVE_TIME) {
      const m = r.re.exec(t);
      if (m) {
        events.push({
          id: `t${++order}`,
          kind: 'relative',
          subkind: 'relative',
          when: m[0],
          offsetDays: r.days,
          order,
          segmentId: seg.id,
          line: seg.line,
          quote: quote(t, 60),
        });
        break;
      }
    }

    // 明示时长（供时长算术校验用）
    const d = parseDuration(t);
    if (d && d.parts.length) {
      events.push({
        id: `t${++order}`,
        kind: 'duration',
        subkind: 'duration',
        // 用真正构成时长的片段（matched），不用整句——否则报告里会显示
        // "三年前的冬天，林晚还是……"，看不出到底算了哪几个字
        when: d.matched || d.raw,
        hours: d.hours,
        order,
        segmentId: seg.id,
        line: seg.line,
        quote: quote(t, 60),
      });
    }
  }

  const spans = events.filter((e) => e.kind === 'duration');
  return {
    events,
    durations: spans,
    span: spans.length ? { minHours: Math.min(...spans.map((s) => s.hours)), maxHours: Math.max(...spans.map((s) => s.hours)) } : null,
    count: events.length,
  };
}

/* ------------------------------------------------------------------ 地点 */

const PLACE_SUFFIX = ['省', '市', '县', '区', '镇', '村', '乡', '街', '路', '巷', '山', '河', '湖', '江', '岛', '国', '州', '港', '湾', '岭', '峰', '寺', '庙', '桥', '站', '机场', '码头', '广场', '大厦', '公寓', '小区', '医院', '学校', '大学', '公园', '酒店', '旅馆', '车站', '公司', '工厂', '仓库'];

export function extractPlaces(segments) {
  const bag = new Map();
  for (const seg of segments) {
    const t = seg.text;
    for (const suf of PLACE_SUFFIX) {
      const re = new RegExp(`([\\u4e00-\\u9fa5]{1,2}${suf})`, 'g');
      let m;
      while ((m = re.exec(t)) !== null) {
        const name = m[1];
        if (name.length < 2) continue;
        // 「林晚还是江城中心医院」里的 suffix=江 会把 "林晚还是江" 当成地名，必须挡掉
        if (hasFunctionWord(name)) continue;
        if (name.length > 4 || name.length < 2) continue;
        if (!bag.has(name)) bag.set(name, { name, suffix: suf, evidence: [], mentions: 0 });
        const e = bag.get(name);
        e.mentions += 1;
        if (e.evidence.length < 3) e.evidence.push({ segmentId: seg.id, line: seg.line, quote: quote(t, 50) });
      }
    }
  }
  return [...bag.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 16)
    .map((p, i) => ({
      id: `p${i + 1}`,
      name: p.name,
      kind: p.suffix,
      mentions: p.mentions,
      confidence: normScore(Math.min(1, p.mentions / 5)),
      evidence: p.evidence,
    }));
}

/* ------------------------------------------------------------------ 世界设定 */

/** 设定类陈述的模态词 → 规则类型 */
const MODALITY = [
  { re: /(不能|不可|无法|禁止|绝不可|不得|永不)/, type: 'cannot', label: '禁止/不可能' },
  { re: /(只能|仅能|唯有|只有)/, type: 'limit', label: '限制' },
  // 「必须」单独出现多半是情节义务（"必须马上手术"），不是世界规则；
  // 只有同句出现"规则类名词"时才认作设定（见 looksLikeRule）
  { re: /(必须|一定要|务必|须得)/, type: 'must', label: '必要条件', requiresRuleNoun: true },
  { re: /(代价|消耗|换取|付出|副作用|反噬|透支)/, type: 'cost', label: '代价' },
  // 【坑】条件句里常有逗号：「一旦日间强行运功，经脉便会逆行」。
  // 用 [^，。] 会把逗号也挡掉，整条规则就永远匹配不到。句内标点必须放行，只挡句末。
  { re: /(一旦[^。！？]{0,16}[就便]|只要[^。！？]{0,16}[就便]|每当|每次)/, type: 'mechanic', label: '机制' },
  { re: /(规则|法则|定律|体系|设定|规矩)/, type: 'mechanic', label: '规则体系' },
];

/** 规则类名词：出现这些词，才说明这句话在讲"世界的运作方式"而不是日常对话 */
const RULE_NOUNS = [
  // 抽象规则词
  '规则', '法则', '定律', '体系', '设定', '契约', '禁忌', '规矩',
  // 力量/能力体系（幻想向最常见的"规则陈述"就长这样）
  '力量', '能力', '魔法', '异能', '灵气', '灵力', '真元', '内力', '法术', '法力',
  '功法', '心法', '招式', '神通', '境界', '灵根', '金丹', '元婴', '经脉', '丹田', '咒术', '符文', '法阵', '封印', '结界',
  // 通用
  '血脉', '妖', '神', '灵', '魂', '咒', '科技', '机器', '系统',
];

/** 引号内的句子按对话处理（对话里的"必须/每次"通常是台词而非设定） */
const QUOTE_TEST = /[\u201c\u201d\u300c\u300d\u300e\u300f]/;

/** 这句话是否真的在陈述一条世界规则 */
function looksLikeRule(segText, mod) {
  const hasRuleNoun = RULE_NOUNS.some((w) => segText.includes(w));
  if (mod.requiresRuleNoun && !hasRuleNoun) return false;
  if (QUOTE_TEST.test(segText) && !hasRuleNoun) return false;
  return true;
}

/**
 * 抽取世界设定条目（幻想向作品的核心约束）。
 * 这些条目会在第三步被逐条对照正文检查——违反自己立下的规则是最刺眼的错误。
 */
export function extractWorldRules(segments) {
  const rules = [];
  let n = 0;

  for (const seg of segments) {
    const t = seg.text;
    for (const mod of MODALITY) {
      const m = mod.re.exec(t);
      if (!m) continue;
      if (!looksLikeRule(t, mod)) continue;
      // 主语：模态词之前最长 6 个字的片段（去掉明显的连接词）
      const idx = t.indexOf(m[0]);
      const subject = t.slice(Math.max(0, idx - 6), idx)
        .replace(/[\u201c\u201d\u300c\u300d\u300e\u300f，。；：、？！!?,.:;\s]+/g, '')
        .replace(/^[的地得了和与及或但而]+/, '');
      // 主语里混进功能词说明左边界切歪了，宁可不给主语
      const cleanSubject = subject && !hasFunctionWord(subject) ? subject : null;
      rules.push({
        id: `w${++n}`,
        statement: quote(t, 80),
        type: mod.type,
        typeLabel: mod.label,
        subject: cleanSubject,
        modality: m[0],
        segmentId: seg.id,
        line: seg.line,
        confidence: normScore(mod.type === 'cannot' ? 0.7 : 0.5),
        evidence: [{ segmentId: seg.id, line: seg.line, quote: quote(t, 60) }],
      });
      break; // 一句只取一个最强模态
    }
  }

  return {
    rules: rules.slice(0, 30),
    sequenceOfUse: null,
    count: rules.length,
  };
}

/* ------------------------------------------------------------------ 冲突 */

const CONFLICT_SIGNALS = [
  { type: '人vs人', terms: ['争吵', '对峙', '反击', '报复', '打斗', '争执', '背叛', '命令', '威胁', '抢', '追捕', '审问', '质问'] },
  { type: '人vs自我', terms: ['挣扎', '犹豫', '后悔', '自责', '恐惧', '内疚', '矛盾', '不甘', '逃避', '妥协'] },
  { type: '人vs环境', terms: ['暴雨', '洪水', '风暴', '地震', '严寒', '酷暑', '荒野', '饥饿', '迷路', '缺氧', '雪崩'] },
  { type: '人vs社会', terms: ['制度', '偏见', '规矩', '舆论', '法律', '歧视', '排挤', '体制', '贫富', '阶层'] },
  { type: '人vs命运', terms: ['宿命', '注定', '预言', '命运', '劫数', '天意'] },
];

export function extractConflicts(segments) {
  const out = [];
  for (const c of CONFLICT_SIGNALS) {
    const hits = segmentsWithAny(segments, c.terms);
    if (!hits.length) continue;
    out.push({
      type: c.type,
      strength: hits.length,
      evidence: hits.slice(0, 3).map((h) => ({ segmentId: h.id, line: h.line, quote: quote(h.text, 60) })),
    });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/* ------------------------------------------------------------------ 客观事实锚点 */

/**
 * 抽出"原文已经写死的事实"——演绎不得与之冲突。
 * 这些是第三步的硬约束：演绎可以补写，但不能改写已发生的事。
 */
export function extractFacts(segments) {
  const facts = [];
  let n = 0;

  const PATTERNS = [
    { kind: 'death', re: /(死|去世|牺牲|身亡|遇害|断气|没了呼吸)/, label: '死亡', immutable: true },
    { kind: 'injury', re: /(骨折|重伤|昏迷|瘫痪|失明|截肢|吐血|中弹|刀伤)/, label: '重伤', immutable: true },
    { kind: 'marriage', re: /(结婚|离婚|订婚|婚礼|领证)/, label: '婚姻状态', immutable: true },
    { kind: 'age', re: /([零〇一二三四五六七八九十百0-9]{1,4}\s*(岁|周岁))/, label: '年龄', immutable: false },
    { kind: 'job', re: /(是|当|做)(医生|护士|警察|律师|教师|老师|司机|厨师|记者|演员|程序员|工程师|老板|学生)/, label: '职业', immutable: false },
    { kind: 'location', re: /(住在|搬到|来自|出生在|老家在)/, label: '居所/籍贯', immutable: false },
    { kind: 'weather', re: /(下雨|暴雨|大雪|刮风|晴天|阴天|台风|洪水)/, label: '天气', immutable: false },
  ];

  for (const seg of segments) {
    for (const p of PATTERNS) {
      const m = p.re.exec(seg.text);
      if (!m) continue;
      facts.push({
        id: `f${++n}`,
        kind: p.kind,
        label: p.label,
        value: m[0],
        immutable: p.immutable,
        segmentId: seg.id,
        line: seg.line,
        quote: quote(seg.text, 70),
        parsed: parseFactValue(p.kind, seg.text, m[0]),
      });
    }
  }
  return facts;
}

function parseFactValue(kind, text, raw) {
  if (kind === 'age') return { age: parseAge(text) };
  if (kind === 'weather') return { weather: raw };
  return null;
}
