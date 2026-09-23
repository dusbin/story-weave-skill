/**
 * lib/commonsense/rules/consistency.mjs — 文本内部数字/事实前后矛盾（id 前缀 NUM）。
 *
 * 这是全库最要紧、也最容易误报的一类，所以写作纪律比其它模块更严：
 *
 *   1. **矛盾永远不是设定自由** → 本模块所有规则 overridable: false（幻想标尺下也不降档）。
 *   2. **确定性判定只建立在"文本自己写明的两个事实"上**：
 *      同一群体的两种人数、同一姓名的两个年龄、断电与用电、写成"第二天"却在两天后。
 *      任何需要推测指代的（代词漂移、称呼不一致），一律写成 ask 交给模型。
 *   3. **凡是有合法解释的，都不报**：群体后来添了人（"又添了个女儿"）、
 *      时间跳跃（"小时候""几年后"）、地域差异（"山顶积雪、山下荷花"）、
 *      能力是后来学会的（"他学会了游泳"）——这些都不是矛盾。
 */

import { parseNumber, parseDuration } from '../kit.mjs';

export const meta = { module: 'consistency', name: '前后一致性', standard: 'both' };

function finding(hit, message, suggestion) {
  return { segmentId: hit.id, line: hit.line, quote: hit.text, message, suggestion };
}

/** 两个 segment 是否处在同一场景（同一 section，或索引足够接近） */
function nearScene(ctx, a, b, maxGap = 3) {
  const sa = ctx.sectionOf?.get?.(a.id);
  const sb = ctx.sectionOf?.get?.(b.id);
  if (sa !== undefined && sb !== undefined && sa !== sb) return false;
  return Math.abs((a.index ?? 0) - (b.index ?? 0)) <= maxGap;
}

/** 群体人数发生变化的交代（有这些词就不算矛盾） */
const GROUP_CHANGE = /(加入|来了|多了|剩下|只剩|少了|少了一个|新来|又来了|走了一个|死了|牺牲|出生|生了个|添了|后来|第二年|几年后|长大后|分开|散了|退出了|离开了)/;

/** 时间跳跃/回忆的交代（有这些词就不算矛盾）。
 *  注意：这里不收「记得」——「他还记得，林川今年四十岁」依然是当下的陈述，不能豁免矛盾。 */
const TIME_SKIP = /(后来|之后|以后|第二年|几年后|多年后|长大后|小时候|童年|那年|当时|那时|此前|曾经|回忆|梦里|梦中|据说|传说|如果|要是|假如|将来|未来)/;

/** 非人物姓名的高频词（避免把"他们/那年他"当成人名） */
const NOT_A_NAME = new Set(['他们', '她们', '我们', '你们', '大家', '人们', '所有', '一个', '两个', '那年', '当时', '此时', '这时', '那时', '如今', '父亲', '母亲', '儿子', '女儿', '老人', '男人', '女人', '孩子', '小伙', '姑娘', '诸位', '各位']);

/** 判定一个候选词能否当作"人物名" */
function isName(s) {
  if (!s || s.length < 2 || s.length > 3) return false;
  if (NOT_A_NAME.has(s)) return false;
  if (/[他她我你它]$/.test(s)) return false; // 以代词收尾的候选几乎都是切错了
  return true;
}

export const rules = [
  {
    id: 'NUM-001',
    title: '同一群体的人数前后不一致',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      patterns: [
        /(一家|全家|他们家|他家|这家人)[^。，,]{0,3}[0-9零〇一二三四五六七八九十两]{1,2}\s*(口|个人|人)/,
        /(兄弟|兄妹|姐妹)[^。，,]{0,3}[0-9零〇一二三四五六七八九十两]{1,2}\s*(个|人|位)/,
        /[0-9零〇一二三四五六七八九十两]{1,2}\s*(兄弟|兄妹|姐妹)(人|俩)?/,
        /(他们|她们|我们|你们|这伙人|一行人)[^。，,]{0,3}[0-9零〇一二三四五六七八九十两]{1,2}\s*(个|人|名|位)/,
      ],
    },
    why: '"一家三口"与"一家四口"、"他们三个"与"他们四个"指向的是同一个群体的基数。开头给读者一个数、后文换一个数又没有任何交代，读者会立刻发现。',
    fix: '统一数字；若人数确实变了（添了人、走了一个），请在变化处写一句交代，那就不算矛盾。',
    check(ctx, hits) {
      const FRAMES = [
        { key: 'family', re: /(一家|全家|他们家|他家|这家人)[^。，,]{0,3}([0-9零〇一二三四五六七八九十两]{1,2})\s*(口|个人|人)/ },
        { key: 'siblings', re: /(兄弟|兄妹|姐妹)[^。，,]{0,3}([0-9零〇一二三四五六七八九十两]{1,2})\s*(个|人|位)/ },
        { key: 'siblings', re: /([0-9零〇一二三四五六七八九十两]{1,2})\s*(兄弟|兄妹|姐妹)(人|俩)?/ },
        { key: 'they', re: /(他们|她们|我们|你们|这伙人|一行人)[^。，,]{0,3}([0-9零〇一二三四五六七八九十两]{1,2})\s*(个|人|名|位)/ },
      ];
      const claims = [];
      for (const seg of ctx.segments) {
        for (const fr of FRAMES) {
          const m = fr.re.exec(seg.text);
          if (!m) continue;
          const n = parseNumber(m[2]);
          if (n === null || n < 2 || n > 20) continue;
          claims.push({ key: fr.key, n, seg });
          break; // 一段只取一个说法
        }
      }
      const byKey = new Map();
      for (const c of claims) {
        if (!byKey.has(c.key)) byKey.set(c.key, []);
        byKey.get(c.key).push(c);
      }
      const out = [];
      for (const [key, list] of byKey) {
        if (list.length < 2) continue;
        if (new Set(list.map((c) => c.n)).size < 2) continue;
        for (let i = 1; i < list.length; i++) {
          if (list[i].n === list[0].n) continue;
          if (GROUP_CHANGE.test(list[i].seg.text)) continue; // 群体变了，有交代
          // 「他们」是纯指代词，必须前后就近，否则可能是两拨人
          if (key === 'they' && !nearScene(ctx, list[0].seg, list[i].seg, 40)) continue;
          out.push(finding(
            list[i].seg,
            `同一群体的人数前后不一致：第 ${list[0].seg.line} 行写 ${list[0].n}，这里写 ${list[i].n}。`,
            '统一人数；若人数确实发生了变化，请在变化处写一句交代（谁来了/谁走了）。',
          ));
          break; // 每组只报一条
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-002',
    title: '同一人物的年龄前后不一致',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { patterns: [/[0-9零〇一二三四五六七八九十两]{1,3}\s*岁/] },
    why: '一个人在同一时期只有一个年龄。文中两处对同一姓名的年龄给出不同数值，又没有时间跳跃的交代，就是数字层面的矛盾（比"人物性格变了"这类主观问题可核对得多）。',
    fix: '统一年龄；若两处确实处在不同时间点，请把时间跨度写明（"十年后"），矛盾就消失了。',
    check(ctx, hits) {
      const RE = /([0-9零〇一二三四五六七八九十两]{1,3})\s*岁/g;
      const claims = [];
      for (const seg of ctx.segments) {
        if (TIME_SKIP.test(seg.text)) continue; // 回忆/时间跳跃段落不参与比对
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(seg.text)) !== null) {
          const age = parseNumber(m[1]);
          if (age === null || age > 120) continue;
          const before = seg.text.slice(0, m.index).replace(/(今年|如今|已经|年满|年方|刚满|过了|才|刚)$/, '');
          const nm = /([\u4e00-\u9fa5]{2,3})$/.exec(before);
          if (!nm || !isName(nm[1])) continue;
          claims.push({ name: nm[1], age, seg });
        }
      }
      const byName = new Map();
      for (const c of claims) {
        if (!byName.has(c.name)) byName.set(c.name, []);
        byName.get(c.name).push(c);
      }
      const out = [];
      for (const [name, list] of byName) {
        if (list.length < 2) continue;
        if (new Set(list.map((c) => c.age)).size < 2) continue;
        for (let i = 1; i < list.length; i++) {
          if (list[i].age === list[0].age) continue;
          if (TIME_SKIP.test(list[i].seg.text)) continue;
          if (GROUP_CHANGE.test(list[i].seg.text)) continue;
          out.push(finding(
            list[i].seg,
            `「${name}」的年龄前后不一致：第 ${list[0].seg.line} 行是 ${list[0].age} 岁，这里是 ${list[i].age} 岁。`,
            '统一年龄；若两处处在不同时间点，请补出时间跨度（"十年后"）。',
          ));
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-003',
    title: '同一人物的性别描述矛盾',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['男人', '女人', '男孩', '女孩', '男子', '女子', '男生', '女生', '汉子', '姑娘'] },
    why: '文中对同一个姓名既写"是个男孩"又写"是个女孩"，是明确的事实矛盾（除非是性别伪装并已交代）。这条只认"姓名 + 是/成了 + 性别词"的写法，不靠代词推测。',
    fix: '统一性别描述；若写的是女扮男装之类的设定，请在第一次出现时交代清楚。',
    check(ctx, hits) {
      const G = /(男人|男孩|男子|男生|汉子|女人|女孩|女子|女生|姑娘)/g;
      const MALE = new Set(['男人', '男孩', '男子', '男生', '汉子']);
      const claims = [];
      for (const seg of ctx.segments) {
        G.lastIndex = 0;
        let m;
        while ((m = G.exec(seg.text)) !== null) {
          const before = seg.text.slice(0, m.index);
          const cop = /(是个|是位|是一位|成了个|成了|当上了|是)$/.exec(before);
          if (!cop) continue;
          const head = before.slice(0, before.length - cop[0].length);
          const nm = /([\u4e00-\u9fa5]{2,3})$/.exec(head);
          if (!nm || !isName(nm[1])) continue;
          claims.push({ name: nm[1], gender: MALE.has(m[1]) ? 'm' : 'f', seg, word: m[1] });
        }
      }
      const byName = new Map();
      for (const c of claims) {
        if (!byName.has(c.name)) byName.set(c.name, []);
        byName.get(c.name).push(c);
      }
      const out = [];
      for (const [name, list] of byName) {
        const genders = new Set(list.map((c) => c.gender));
        if (genders.size < 2) continue;
        const last = list[list.length - 1];
        out.push(finding(
          last.seg,
          `「${name}」的性别描述矛盾：第 ${list[0].seg.line} 行写「${list[0].word}」，这里写「${last.word}」。`,
          '统一性别描述；若确为性别伪装，请在首次出现时交代。',
        ));
      }
      return out;
    },
  },
  {
    id: 'NUM-004',
    title: '唯一物件又出现多件',
    category: '前后一致性',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['唯一', '只有一', '仅有一', '两把', '三把', '两辆', '两支'] },
    why: '前文强调"唯一的一把钥匙/一辆车"，后文又出现两件同样的东西，两者不能同时为真（除非后文交代是另一件、新买的）。',
    fix: '删掉"唯一"这类强调，或补一句交代（"另一把是车钥匙"、"后来又配了一把"）。',
    check(ctx, hits) {
      const NOUNS = ['钥匙', '车', '汽车', '枪', '手枪', '刀', '手机', '信', '船', '马', '戒指', '手表', '地图', '照片', '剑', '弓', '伞', '眼镜', '水壶', '背包'];
      const UNIT = '(把|支|辆|个|张|条|件|枚|匹|座|部|台)?';
      const EXCUSE = /(另一|别的|新的|新配|借|买|配了|额外|备用|一共|总共|分别|各|同一把|同一辆)/;
      const out = [];
      for (const noun of NOUNS) {
        const UNIQUE = new RegExp(`(唯一|只有一|仅有一)[^。，,]{0,4}${UNIT}\\s*${noun}`);
        const MULTI = new RegExp(`(两|二|三|四|五|六|七|八|九|十|[0-9]{1,2})\\s*${UNIT}\\s*${noun}`);
        const uniq = [];
        const multi = [];
        for (const seg of ctx.segments) {
          if (UNIQUE.test(seg.text)) uniq.push(seg);
          if (MULTI.test(seg.text)) multi.push(seg);
        }
        if (!uniq.length || !multi.length) continue;
        const first = uniq[0];
        for (const seg of multi) {
          if ((seg.index ?? 0) <= (first.index ?? 0)) continue;
          if (EXCUSE.test(seg.text)) continue;
          out.push(finding(
            seg,
            `第 ${first.line} 行强调${noun}是"唯一"的，这里却出现了多件。`,
            '删掉"唯一"这类强调，或补一句交代（另一件是什么、从哪来）。',
          ));
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-005',
    title: '同一场景天气前后矛盾',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['暴雨', '大雨', '倾盆', '瓢泼', '雷雨', '阴雨', '晴空', '万里无云', '阳光明媚', '艳阳', '烈日'] },
    why: '同一场戏里前一句"暴雨如注"、后一句"万里无云"，中间又没有雨停/放晴/次日之类的过渡，读者会以为漏了一段。天气是可核对的事实，不属设定自由。',
    fix: '补一句过渡（"雨停时""第二天一早"），或把两句改成同一时段的同一天气。',
    check(ctx, hits) {
      const RAIN = /(暴雨|大雨|倾盆大雨|瓢泼大雨|下着雨|阴雨|雷雨|雨下得|大雨如注|暴雨如注|雨点|撑着伞)/;
      const CLEAR = /(晴空万里|万里无云|阳光明媚|艳阳高照|天空湛蓝|大晴天|太阳高照|烈日当空|阳光灿烂)/;
      const TRANS = /(雨停|停了|放晴|云开|转晴|雨后|渐渐|天气转|第二天|次日|翌日|隔天|几天后|傍晚|到了中午|过了一会儿|不久|后来|深夜|凌晨|出了太阳)/;
      const out = [];
      const segs = ctx.segments;
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i];
        const aRain = RAIN.test(a.text);
        const aClear = CLEAR.test(a.text);
        // 同一句里既暴雨又万里无云（矛盾常常写在一句话内，不能只看相邻段）
        if (aRain && aClear && !TRANS.test(a.text)) {
          out.push(finding(a, '同一句里既写暴雨又写晴空万里，两个天气状态不可能同时成立。', '补一句过渡，或让这一句只保留一种天气。'));
          continue;
        }
        if (!aRain && !aClear) continue;
        for (let j = i + 1; j <= Math.min(i + 2, segs.length - 1); j++) {
          const b = segs[j];
          const opposite = (aRain && CLEAR.test(b.text)) || (aClear && RAIN.test(b.text));
          if (!opposite) continue;
          if (!nearScene(ctx, a, b, 2)) continue;
          if (TRANS.test(a.text) || TRANS.test(b.text)) continue;
          out.push(finding(
            b,
            `与上一句（第 ${a.line} 行）的天气直接冲突，中间没有任何过渡。`,
            '补一句过渡（"雨停时""第二天一早"），或让两句处在同一时段。',
          ));
          i = j; // 避免同一处反复报
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-006',
    title: '同一场景季节特征冲突',
    category: '前后一致性',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['大雪', '飘雪', '下雪', '积雪', '冰封', '寒冬', '结冰', '荷花', '蝉鸣', '知了', '西瓜', '冰镇'] },
    why: '同一场景里同时出现冬夏两季的典型特征（大雪与蝉鸣、冰封与荷花），在平原同一地点不可能同时成立（山地/跨地域另有交代的除外）。',
    fix: '把季节特征统一；若确有地域或海拔差异，请写明地点差异。',
    check(ctx, hits) {
      const WINTER = /(大雪|飘雪|下雪|积雪|冰封|寒冬|寒风刺骨|结冰|雪地)/;
      const SUMMER = /(荷花|蝉鸣|知了|烈日炎炎|西瓜|游泳|穿短袖|大汗淋漓|冰镇|蒲扇)/;
      const EXCUSE = /(回忆|想起|那年|小时候|南方|北方|山顶|山下|高原|海拔|雪线|景区|电视|书里|据说)/;
      const out = [];
      const segs = ctx.segments;
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i];
        const aWin = WINTER.test(a.text);
        const aSum = SUMMER.test(a.text);
        if (aWin && aSum && !EXCUSE.test(a.text)) {
          out.push(finding(a, '同一句里同时出现冬季与夏季的典型特征，同一地点不可能同时成立。', '统一季节特征；若确有地域/海拔差异，请把地点交代清楚。'));
          continue;
        }
        if (!aWin && !aSum) continue;
        for (let j = i + 1; j <= Math.min(i + 2, segs.length - 1); j++) {
          const b = segs[j];
          const opposite = (aWin && SUMMER.test(b.text)) || (aSum && WINTER.test(b.text));
          if (!opposite) continue;
          if (!nearScene(ctx, a, b, 2)) continue;
          if (EXCUSE.test(a.text) || EXCUSE.test(b.text)) continue;
          out.push(finding(
            b,
            `与上一句（第 ${a.line} 行）的季节特征冲突（冬夏特征出现在同一场景）。`,
            '统一季节特征；若确有地域/海拔差异，请把地点交代清楚。',
          ));
          i = j;
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-007',
    title: '历时数日却写成「第二天」',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['第二天', '次日', '翌日', '隔天', '转天'] },
    why: '前文已经写了"困了三天三夜""昏迷了两天"，后文却说"第二天一早"，两个时间量自相矛盾——这是纯算术，读者一算就发现。',
    fix: '把后文改成与前文相称的时间（"第四天早上"），或把前文的持续时间改短。',
    check(ctx, hits) {
      const NEXT = /(第二天|次日|翌日|隔天|转天)/;
      const ENDURE = /(困|昏迷|昏睡|关了|锁|走了|赶了|跋涉|逃|饿|守|等|熬|病|漂|挖|追|骑马)/;
      const out = [];
      const segs = ctx.segments;
      for (let j = 0; j < segs.length; j++) {
        const b = segs[j];
        if (!NEXT.test(b.text)) continue;
        for (let i = Math.max(0, j - 10); i < j; i++) {
          const a = segs[i];
          if (!ENDURE.test(a.text)) continue;
          if (!nearScene(ctx, a, b, 10)) continue;
          const dur = parseDuration(a.text);
          if (!dur || dur.hours < 48) continue;
          out.push(finding(
            b,
            `第 ${a.line} 行写了约 ${Math.round(dur.hours / 24)} 天的持续，这里却写「${(NEXT.exec(b.text) ?? [''])[0]}」。`,
            '把后文的时间改成与前文相称（"第四天早上"），或把前文的持续时间改短。',
          ));
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-008',
    title: '已写明的能力前后矛盾',
    category: '前后一致性',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['不会游泳', '不会开车', '不会骑马', '不懂水性', '游泳', '开车', '骑马'] },
    why: '前文写明"他不会游泳"，后文没有任何交代就让他下水救人，读者会回头翻书。若中间写了"学会"，那就不算矛盾。',
    fix: '补一句他会游泳的来历（何时学会、跟谁学的），或把下水的人换成别人。',
    check(ctx, hits) {
      const ABILITIES = [
        { name: '游泳', neg: /(不会|不懂|学不会|从没|从未|不敢)[^。]{0,3}(游泳|水性|下水)/, pos: /(游了过去|游过去|游到|下水|跳进水里|跳进河里|救起了|把她救了|把他救了|救了她|救了他)/, recover: /(学会|学了|苦练|请教|练了|练会)/ },
        { name: '开车', neg: /(不会|不懂|从没|从未)[^。]{0,3}(开车|驾驶|驾车)/, pos: /(开车|驾车|亲自驾驶|坐进驾驶位|握着方向盘)/, recover: /(学会|学了|考了驾照|练了)/ },
        { name: '骑马', neg: /(不会|不懂|从没|从未)[^。]{0,3}(骑马|马术)/, pos: /(策马|纵马|翻身上马|骑着马)/, recover: /(学会|学了|练了)/ },
      ];
      const segs = ctx.segments;
      const out = [];
      for (const ab of ABILITIES) {
        for (let i = 0; i < segs.length; i++) {
          const a = segs[i];
          if (!ab.neg.test(a.text)) continue;
          // 允许"他从小就不会游泳"这类中间有状语的写法
          const subjM = /(他|她|我|你)[^。，,]{0,6}(不会|不懂|从没|从未|不敢)/.exec(a.text);
          if (!subjM) continue;
          const subject = subjM[1];
          for (let j = i + 1; j < segs.length; j++) {
            const b = segs[j];
            // 判定主语必须是动作的施事：在正面动作之前 12 字内出现同一代词才算同一个人。
            // 只看"这一段里出现过这个代词"会把「他跳进河里…把她救了上来」误判成她下水。
            const posRe = new RegExp(ab.pos.source, 'g');
            let agent = false;
            let pm;
            while ((pm = posRe.exec(b.text)) !== null) {
              const before = b.text.slice(Math.max(0, pm.index - 12), pm.index);
              if (before.includes(subject)) { agent = true; break; }
              if (pm[0] === '') posRe.lastIndex++;
            }
            if (!agent) continue;
            if (!nearScene(ctx, a, b, 25)) continue;
            // 中间（含首尾）有"学会"的交代就不算矛盾
            const between = segs.slice(i, j + 1).some((s) => ab.recover.test(s.text));
            if (between) continue;
            out.push(finding(
              b,
              `第 ${a.line} 行写明「${subject}」不会${ab.name}，这里却没有交代就${ab.name}了。`,
              `补一句他会${ab.name}的来历（何时学会、跟谁学的），或把这段的动作换成别人。`,
            ));
            j = segs.length; // 一个能力只报一次
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-009',
    title: '已死人物后文正常出场',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { patterns: [/(死了|去世|过世|牺牲|殉职|身亡|断气)/] },
    why: '文中写明某人已死，后文该人又像活人一样说话、走动，且没有任何交代（假死、回忆、遗像、双胞胎），是事实层面的硬矛盾。死亡不可逆，架空设定也不能默默抹掉。',
    fix: '要么在那段改成回忆/遗物/旁人的转述，要么在首次"复活"处给出交代（假死、被救、双胞胎、幻觉）。',
    check(ctx, hits) {
      const DEATH = /(去世|过世|逝世|牺牲|殉职|死了|身亡|断气)/g;
      const STRIP = /(三年前|两年前|一年前|几年前|多年前|昨天|前天|去年|今年|那一年|那年|就|已经|早已|早就|也|都|才|刚|便|终于|后来|是|被)$/;
      const ACTION = /(说|笑|走|站|坐|点头|开口|回答|挥手|跑|看|喝|吃|抱|喊|骂|唱|跳|伸手|抬头)/;
      const EXPLAIN = /(竟然|居然|复活|没死|假死|原来|回忆|梦里|梦中|照片|遗像|当年|生前|墓前|坟前|遗书|双胞胎|长得像|像极了|灵魂|鬼|幻觉|饰演|剧本|小说|转述|据说)/;
      const deceased = [];
      for (const seg of ctx.segments) {
        DEATH.lastIndex = 0;
        let m;
        while ((m = DEATH.exec(seg.text)) !== null) {
          let head = seg.text.slice(0, m.index);
          for (let k = 0; k < 4 && STRIP.test(head); k++) head = head.replace(STRIP, '');
          const nm = /([\u4e00-\u9fa5]{2,3})$/.exec(head);
          if (!nm || !isName(nm[1])) continue;
          deceased.push({
            name: nm[1],
            seg,
            // 同一句里"死了…又出现"也算：只取死亡词之后的那半句来比对
            tail: seg.text.slice(m.index + m[0].length),
          });
        }
      }
      const hitTarget = (name, text) => {
        if (!text.includes(name)) return false;
        if (!ACTION.test(text)) return false;
        if (EXPLAIN.test(text)) return false;
        return true;
      };
      const out = [];
      for (const d of deceased) {
        // 先看同一句的后半段，再看后面的段
        if (hitTarget(d.name, d.tail)) {
          out.push(finding(
            d.seg,
            `同一句里写了「${d.name}」已死，又让他像活人一样行动，中间没有交代。`,
            '把这段改成回忆/遗物/转述，或在此处交代死而复生的机制（假死、被救、双胞胎）。',
          ));
          continue;
        }
        for (const seg of ctx.segments) {
          if ((seg.index ?? 0) <= (d.seg.index ?? 0)) continue;
          if (!hitTarget(d.name, seg.text)) continue;
          out.push(finding(
            seg,
            `「${d.name}」在第 ${d.seg.line} 行已经死了，这里又像活人一样行动，中间没有交代。`,
            '把这段改成回忆/遗物/转述，或在此处交代死而复生的机制（假死、被救、双胞胎）。',
          ));
          break; // 一个人物只报一次
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-010',
    title: '已写没电却又正常用电',
    category: '前后一致性',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['停电', '断电', '没通电', '不通电', '电力中断', '供电中断'] },
    why: '前文交代"村里停电三天了/一直没通电"，后文却开灯、看电视、充电，中间没有来电/发电的交代——这是同一事实的两次相反陈述。',
    fix: '要么删掉停电的交代，要么补一句"来电了/他们自己发了电"（这本身也能成为情节）。',
    check(ctx, hits) {
      const OUTAGE = /(停电|断电|没有通电|不通电|没通电|电力中断|供电中断|电还没来|电一直没来)/;
      const RESTORE = /(来电|恢复供电|修好|发电|通电了|电力恢复|接上了电|架了电线|发电机)/;
      const USE = /((打开|开了|亮起|亮了|点亮|启动)[^。]{0,4}(灯|电灯|台灯|电视|空调|电脑|风扇|电梯|冰箱|洗衣机|热水器)|充电|用电|上网|刷手机|开灯)/;
      const segs = ctx.segments;
      const out = [];
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i];
        if (!OUTAGE.test(a.text)) continue;
        // 同一句里"停电…却开灯"（矛盾常常写在一句话内）
        if (USE.test(a.text) && !RESTORE.test(a.text)) {
          out.push(finding(a, '同一句里交代了没有电，又写正常用电，中间没有来电/发电的交代。', '删掉停电的交代，或补一句"来电了/自己发了电"。'));
          continue;
        }
        for (let j = i + 1; j < segs.length; j++) {
          const b = segs[j];
          if (!nearScene(ctx, a, b, 20)) continue;
          if (!USE.test(b.text)) continue;
          if (RESTORE.test(b.text)) continue;
          if (segs.slice(i, j + 1).some((s) => RESTORE.test(s.text))) continue;
          out.push(finding(
            b,
            `第 ${a.line} 行交代了没有电，这里却正常用电，中间没有来电/发电的交代。`,
            '删掉停电的交代，或补一句"来电了/自己发了电"（用它制造情节更好）。',
          ));
          i = j;
          break;
        }
      }
      return out;
    },
  },
  {
    id: 'NUM-011',
    title: '代词性别漂移（需模型判断）',
    category: '前后一致性',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { patterns: [/[\u4e00-\u9fa5]{2,3}(他|她)/] },
    why: '同一个人物在文中被交替用"他"和"她"指代，读者会以为是两个人。判定的难点在于确认两次代词指的是同一个人（多人物场景下正则猜不准），故交由模型。',
    fix: '统一代词；若确为性别伪装/身份反转，请在转折处交代。',
    ask: '文中同一个人物是否被交替用「他」与「她」指代？请指出两处原文，并确认它们指的是同一个人（若只是不同人物，请说明）。',
  },
  {
    id: 'NUM-012',
    title: '姓名或称呼前后不一致（需模型判断）',
    category: '前后一致性',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['名字', '全名', '小名', '绰号', '外号', '化名', '自称', '也叫'] },
    why: '同一人物出现两个姓名/称呼而无交代（化名、小名、改名），会让读者前后对不上号。是否"同一人"需要理解上下文，故交由模型判断。',
    fix: '统一称呼，或在首次出现第二个称呼时点明关系（"她的小名叫……"）。',
    ask: '文中同一人物是否出现了两个不同的姓名或称呼而没有交代（化名、小名、改名、绰号）？请指出两处原文，并说明是否为同一人。',
  },
];

export default { meta, rules };
