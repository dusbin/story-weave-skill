/**
 * lib/commonsense/rules/timeline.mjs — 时间线算术常识规则（id 前缀 TIM）。
 *
 * 这一组全部 overridable: false —— 时间算术是逻辑问题，架空世界也照样成立：
 * 「当天」装不下 36 小时，「今年 40 岁」与「三年前 30 岁」不能同时为真。
 *
 * 只做「明示数字之间的算术核对」：文本没给数字就跳过，绝不替作者推算剧情时间。
 */

import { parseDuration, parseAge, parseYear, parseNumber } from '../kit.mjs';

export const meta = { module: 'timeline', name: '时间线算术', standard: 'real' };

/* ------------------------------------------------------------------ 局部工具 */

const NUM = '[0-9]+(?:\\.[0-9]+)?|[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬]{1,8}';
const UNIT_DUR = '年|个月|月|周|星期|礼拜|整天|昼夜|天|日|夜|小时|钟头|时辰|分钟|分|秒';
const DUR_TOKEN = `(?:${NUM}\\s*(?:个)?\\s*半\\s*(?:${UNIT_DUR})|半\\s*(?:${UNIT_DUR})|${NUM}\\s*(?:个)?\\s*(?:${UNIT_DUR}))`;
const DUR_TOKEN2 = `(?:${DUR_TOKEN})(?:\\s*(?:${DUR_TOKEN}))?`;
/** 年份不是时长（「1998年」会被 parseDuration 算成 8 年） */
const YEAR_LIKE = /^(?:[0-9]{3,4}|[零〇一二三四五六七八九]{4})\s*年$/;

function durations(text) {
  const out = [];
  const re = new RegExp(DUR_TOKEN2, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (YEAR_LIKE.test(m[0].trim())) continue;
    // 「第三天」「第二天」是序数日期，不是时长——否则「熬了两个通宵，第三天交稿」会被算成 3 天不睡
    if (m.index > 0 && text[m.index - 1] === '第') continue;
    const d = parseDuration(m[0]);
    if (d) out.push({ hours: d.hours, raw: m[0], index: m.index });
  }
  return out;
}

function maxHours(text) {
  const ts = durations(text);
  return ts.length ? Math.max(...ts.map((t) => t.hours)) : null;
}

const DAY = 24;

/** 「今年 40 岁」「三年前 30 岁」里的岁数取法（带修饰词，避免抓到别人的年龄） */
function ageWithCue(text, cues) {
  const re = new RegExp(`(?:${cues})[^，。；]{0,8}?(${NUM})\\s*(?:岁|周岁)`);
  const m = re.exec(text);
  if (!m) return null;
  const n = parseNumber(m[1]);
  return n === null ? null : { age: Math.trunc(n), raw: m[0], index: m.index };
}

/** 时段词。必须是非捕获组：捕获组会多占一个下标，让后续 pm[2] 取到时段而不是数字。 */
const PERIOD = '(?:凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|半夜|深夜|正午)';

/** 月/日 → 一年中的第几天（不含闰年差异；只用于算术核对） */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function dayOfYear(month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day > MONTH_DAYS[month - 1]) return null;
  let n = day;
  for (let i = 0; i < month - 1; i++) n += MONTH_DAYS[i];
  return n;
}

/** 段内的「M月D日」列表 */
function monthDays(text) {
  const out = [];
  const re = new RegExp(`(${NUM})\\s*月\\s*(${NUM})\\s*[日号]`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const mo = parseNumber(m[1]);
    const da = parseNumber(m[2]);
    if (mo === null || da === null) continue;
    const doy = dayOfYear(Math.trunc(mo), Math.trunc(da));
    if (doy === null) continue;
    out.push({ month: Math.trunc(mo), day: Math.trunc(da), doy, index: m.index, raw: m[0] });
  }
  return out;
}

export const rules = [
  /* ---------------------------------------------------------------- TIM-001 */
  {
    id: 'TIM-001',
    title: '「当天」装不下超过 24 小时的时长',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['当天', '当日', '同一天', '这一天'],
      patterns: [/(当天|当日|同一天|这一天)/],
    },
    why: '一个自然日最多 24 小时。明示时长超过 26 小时后仍写「当天就……」，'
      + '无论从哪个时刻起算都不可能落在同一天里。',
    fix: '改成「第二天」「翌日」或「次日凌晨」，或把时长改到 24 小时以内。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const hours = maxHours(text);
        if (hours === null || hours <= 26) continue; // 24 小时附近留出余量，避免误报
        const m = /(当天|当日|同一天|这一天)/.exec(text);
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `此处时长约 ${Math.round((hours / DAY) * 10) / 10} 天（${Math.round(hours)} 小时），`
            + `却写成「${m[1]}」完成；一天只有 24 小时。`,
          suggestion: '把「当天」改成「第二天/翌日」，或把时长改到 24 小时以内。',
          extras: { hours },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-002 */
  {
    id: 'TIM-002',
    title: '季节与天气/气温描写互相矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['盛夏', '炎夏', '酷暑', '三伏', '隆冬', '寒冬', '严冬', '数九'],
      patterns: [/(盛夏|炎夏|酷暑|三伏|隆冬|寒冬|严冬|数九|大暑|冬至)/],
    },
    why: '季节决定了气温与降水的基本量级：盛夏不会同时大雪封门、结冰滴水成冰；'
      + '隆冬也不会同时酷热挥汗。若设定上确实反常（架空世界、气候异变），需要明确交代。',
    fix: '改掉其中一个季节/天气词，或明确写成异常气候（灾变、设定）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const hot = /(盛夏|炎夏|酷暑|三伏|大暑|挥汗|烈日炎炎|酷热)/;
        const cold = /(大雪|暴雪|飘雪|下雪|结冰|冰封|严寒|寒风刺骨|霜冻|滴水成冰|隆冬|寒冬|严冬|数九)/;
        const hasHot = hot.test(text);
        const hasCold = cold.test(text);
        if (!hasHot || !hasCold) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `此处同时出现「${hot.exec(text)[0]}」与「${cold.exec(text)[0]}」两类描写，季节与天气互相矛盾。`,
          suggestion: '改掉其中一个季节/天气词；若确实是反常气候，请明确写出成因（灾变、设定）。',
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-003 */
  {
    id: 'TIM-003',
    title: '出生年份与年龄的算术矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['出生', '生于', '岁'],
      patterns: [/(出生|生于|诞生)[^。；]{0,10}(1[0-9]{3}|20[0-9]{2}|[0-9]{3})\s*年/, /(1[0-9]{3}|20[0-9]{2})\s*年[^。；]{0,14}(岁|周岁)/],
    },
    why: '年份 - 出生年 = 年龄。同一部作品里给出的出生年与「某年他多少岁」必须自洽'
      + '（允许 ±1 年差额，因为有虚岁与生日前后之差）。',
    fix: '统一出生年份或年龄，或明确交代这是另一个角色/回忆中的时点。',
    check(ctx, hits) {
      const out = [];
      const birth = [];
      const ageYear = [];
      const OTHER_PERSON = /(父亲|母亲|儿子|女儿|妻子|丈夫|哥哥|姐姐|弟弟|妹妹|朋友|老师|同事|邻居)/;

      for (const seg of ctx.segments) {
        const text = seg.text;
        if (/(出生|生于|诞生)/.test(text)) {
          const y = parseYear(text);
          if (y !== null) birth.push({ year: y, seg });
        }
        // 「2020 年，他已经三十岁」这种把年份与岁数写在一起的句子，才算可直接核对
        if (!/(出生|生于|诞生)/.test(text) && !OTHER_PERSON.test(text)) {
          const y = parseYear(text);
          const a = parseAge(text);
          if (y !== null && a !== null) ageYear.push({ year: y, age: a, seg });
        }
      }
      if (!birth.length || !ageYear.length) return out;

      for (const ay of ageYear) {
        for (const b of birth) {
          const impliedAge = ay.year - b.year;      // 按出生年推算，那时他应该是几岁
          const diff = Math.abs(impliedAge - ay.age);
          if (diff < 2) continue; // ±1 年以内属正常误差（虚岁、生日前后）
          out.push({
            segmentId: ay.seg.id,
            line: ay.seg.line,
            quote: ay.seg.text,
            severity: 'major',
            message: `若生于 ${b.year} 年，则 ${ay.year} 年他应为 ${impliedAge} 岁，`
              + `与此处「${ay.age} 岁」相差 ${diff} 岁（另见出处：「${b.seg.text.slice(0, 20)}」）。`,
            suggestion: `统一为「生于 ${ay.year - ay.age} 年」（这样 ${ay.year} 年正好 ${ay.age} 岁），`
              + `或把该处年龄改为 ${impliedAge} 岁；若指的是另一个角色，请明确写出主体。`,
            extras: { bornYear: b.year, claimedAge: ay.age, atYear: ay.year, impliedAge },
          });
          break; // 一个句子只报一次
        }
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-004 */
  {
    id: 'TIM-004',
    title: '「今年 N 岁」与「M 年前 K 岁」算术矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['今年', '如今', '现在', '年前', '岁'],
      patterns: [
        /(今年|如今|现在|此时)[^，。；]{0,8}?(?:[0-9零〇一二三四五六七八九十两]{1,8})\s*(?:岁|周岁)/,
        /(?:[0-9零〇一二三四五六七八九十两]{1,8})\s*年(?:前|以前)[^，。；]{0,12}?(?:[0-9零〇一二三四五六七八九十两]{1,8})\s*(?:岁|周岁)/,
      ],
    },
    why: '「今年 40 岁」与「三年前 30 岁」隐含矛盾：三年前应约为 37 岁。'
      + '同一句内的两个年龄必须满足「现在年龄 − 年数 ≈ 当时年龄」（允许 ±1 年）。',
    fix: '改动其中一处年龄，或把「三年前」改成正确的时间差。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const nowM = ageWithCue(text, '今年|如今|现在|此时');
        if (!nowM) continue;
        // 「M 年前……K 岁」
        const agoM = new RegExp(`(${NUM})\\s*(?:年|载)\\s*(?:前|以前)[^，。；]{0,14}?(${NUM})\\s*(?:岁|周岁)`).exec(text);
        if (!agoM) continue;
        const years = parseNumber(agoM[1]);
        const then = parseNumber(agoM[2]);
        if (years === null || then === null) continue;
        const expect = nowM.age - Math.trunc(years);
        const diff = Math.abs(expect - Math.trunc(then));
        if (diff < 2) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `「今年 ${nowM.age} 岁」与「${Math.trunc(years)} 年前 ${Math.trunc(then)} 岁」矛盾：`
            + `${Math.trunc(years)} 年前应约为 ${expect} 岁。`,
          suggestion: `把「${Math.trunc(then)} 岁」改为「${expect} 岁」，或修正年数。`,
          extras: { now: nowM.age, yearsAgo: Math.trunc(years), claimedThen: Math.trunc(then), expectedThen: expect },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-005 */
  {
    id: 'TIM-005',
    title: '孕期时长与人类妊娠周期不符',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['怀孕', '身孕', '有喜', '怀胎', '妊娠'],
      patterns: [/(怀孕|身孕|有喜|怀胎|妊娠)/],
    },
    why: '人类妊娠约 40 周（280 天）。少于 30 周属极早产（须交代保温箱与存活风险），'
      + '超过 45 周则早已需要引产。',
    fix: '把孕期改到 37–42 周（约九到十个足月），或明确写成早产并交代救治与风险。',
    check(ctx, hits) {
      const out = [];
      const pregSegs = ctx.segments.filter((s) => /(怀孕|身孕|有喜|怀胎|妊娠|孕妇)/.test(s.text));
      if (!pregSegs.length) return out; // 全篇没提怀孕，句中的「N 个月后生下」可能是别的事

      for (const seg of ctx.segments) {
        const text = seg.text;
        if (!/(分娩|临盆|生下|产下|生产|生了|出世|降生)/.test(text)) continue;
        if (/(早产|流产|小产|引产|剖宫|剖腹|不足月|保温箱|难产)/.test(text)) continue; // 作者已交代异常情形
        // 只认紧贴分娩动词的时长：「五个月后生下了」「怀孕七个月就生了」
        const m = new RegExp(`(${DUR_TOKEN})\\s*(?:后|之后|以后)?[^，。；]{0,8}?(?:分娩|临盆|生下|产下|生产|生了)`).exec(text);
        if (!m) continue;
        const d = parseDuration(m[1]);
        if (!d) continue;
        const weeks = d.hours / (7 * DAY);
        if (weeks >= 30 && weeks <= 45) continue;
        out.push({
          segmentId: seg.id,
          line: seg.line,
          quote: text,
          severity: 'major',
          message: `此处把孕期写作约 ${Math.round(weeks * 10) / 10} 周（${m[1]}）后就分娩；`
            + '人类孕期约 40 周（280 天）。',
          suggestion: '改为 37–42 周；若要写早产，请明确交代（早产、保温箱、存活风险）。',
          extras: { weeks: Math.round(weeks * 10) / 10 },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-006 */
  {
    id: 'TIM-006',
    title: '出发时刻 + 时长 与到达时刻矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['点', '时', '出发', '到达', '抵达'],
      patterns: [/(出发|动身|启程|赶到|到达|抵达|回到)[^。；]{0,20}(小时|钟头|分钟)/],
    },
    why: '「上午八点出发，走了六个小时」必然在下午两点前后到达。'
      + '给出出发时刻、时长与到达时刻三者的句子可以直接做加法核对。',
    fix: '把到达时刻改成算术结果（或反之修正出发时刻/时长）。',
    check(ctx, hits) {
      const out = [];
      // 用整段匹配：出发时刻 → 时长 → 到达时刻 → 到达动词，一次抓全
      // 起始时刻可能没写「上午/下午」，到达时刻也不会写（见 clockHours 的两种解释）
      for (const hit of hits) {
        const text = hit.text;
        const re = new RegExp(
          `(?:${PERIOD})?\\s*(${NUM})\\s*(?:点|点钟|时)(半)?[^。；]{0,24}?(${DUR_TOKEN})`
          + `[^。；]{0,16}?(${PERIOD})?\\s*(${NUM})\\s*(?:点|点钟|时)(半)?[^。；]{0,8}?(到达|抵达|赶到|回到|回家|来到|走到|到了|到)`,
        );
        const m = re.exec(text);
        if (!m) continue;
        // 捕获组下标会被前面的可选组影响，因此把整段命中再用小正则拆一次
        const full = m[0];
        const pm = new RegExp(`^(${PERIOD})?\\s*(${NUM})\\s*(?:点|点钟|时)(半)?`).exec(full);
        if (!pm) continue;
        const tail = new RegExp(`(${PERIOD})?\\s*(${NUM})\\s*(?:点|点钟|时)(半)?[^。；]{0,8}?(?:到达|抵达|赶到|回到|回家|来到|走到|到了|到)$`).exec(full);
        if (!tail) continue;
        const durRaw = new RegExp(`(${DUR_TOKEN})`).exec(full);
        if (!durRaw) continue;
        const dur = parseDuration(durRaw[1]);
        if (!dur) continue;

        const starts = clockHours(pm[1], parseNumber(pm[2]), Boolean(pm[3]));
        const ends = clockHours(tail[1], parseNumber(tail[2]), Boolean(tail[3]));
        if (!starts.length || !ends.length) continue;

        let best = Infinity;
        for (const s of starts) {
          for (const e of ends) {
            const expect = s + dur.hours;
            let diff = ((e - expect) % 24 + 24) % 24;
            if (diff > 12) diff -= 24;
            best = Math.min(best, Math.abs(diff));
          }
        }
        if (!Number.isFinite(best) || best <= 1.5) continue; // 1.5 小时内视为叙述性出入
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: best >= 3 ? 'major' : 'minor',
          message: `按此处给出的时刻与时长推算，到达时间与文中相差约 ${Math.round(best * 10) / 10} 小时`
            + `（${pm[0].trim()} + ${durRaw[1]} ≠ ${tail[0].trim()}）。`,
          suggestion: '修正出发时刻、途中所用时长、或到达时刻中的一处，使三者相加自洽。',
          extras: { diffHours: Math.round(best * 10) / 10, duration: durRaw[1] },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-007 */
  {
    id: 'TIM-007',
    title: '同一句里同一事件的时长自相矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['昏迷', '沉睡', '被困', '关押', '等待', '跋涉', '守候'],
      patterns: [/(昏迷|沉睡|昏睡|守候|等候|等待|被困|关押|囚禁|跋涉|搜寻|苦战|鏖战|僵持|围困)/],
    },
    why: '同一句里同一个持续动作被赋予两个相差数倍的时长（如「昏迷了三天，三个月后才醒来」），'
      + '两者不可能同时成立。',
    fix: '删掉其中一个时长，或把两者改成不同的事件（如「昏迷三天，之后卧床三个月」）。',
    check(ctx, hits) {
      const DUR_VERB = /(昏迷|沉睡|昏睡|昏死|守候|等候|等待|被困|关押|囚禁|跋涉|搜寻|苦战|鏖战|僵持|围困|醒来|苏醒|醒过来|清醒)/g;
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const ts = durations(text);
        if (ts.length < 2) continue;
        // 时长必须紧邻同一个持续动词（前 3 字或后 6 字内），且两处时长相距不远
        const bound = [];
        for (const t of ts) {
          const before = text.slice(Math.max(0, t.index - 3), t.index);
          const after = text.slice(t.index + t.raw.length, t.index + t.raw.length + 6);
          if (DUR_VERB.test(before) || DUR_VERB.test(after)) bound.push(t);
        }
        if (bound.length < 2) continue;
        const a = bound[0];
        const b = bound[bound.length - 1];
        if (Math.abs(b.index - a.index) > 24) continue; // 离得远则视为两件事
        const ratio = Math.max(a.hours, b.hours) / Math.min(a.hours, b.hours);
        if (ratio < 3) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `同一句里同一个动作被赋予两个时长（${a.raw} 与 ${b.raw}，相差 ${Math.round(ratio * 10) / 10} 倍），二者不能同时成立。`,
          suggestion: '删掉其中一个时长，或把第二个时长改成另一件事（如「昏迷三天，之后卧床三个月」）。',
          extras: { first: a.raw, second: b.raw, hours: [a.hours, b.hours] },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-008 */
  {
    id: 'TIM-008',
    title: '明示日期与「N 天后」算术矛盾',
    category: '时间线算术',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['月', '日', '天后', '号'],
      patterns: [/([0-9零〇一二三四五六七八九十两]{1,3})\s*月\s*([0-9零〇一二三四五六七八九十]{1,3})\s*[日号]/],
    },
    why: '给出两个具体日期与中间的「N 天后」，可以直接用日历核对：'
      + '3 月 5 日到 3 月 12 日是 7 天，不能写作「三天后」。',
    fix: '修正其中一处日期或天数，使日历差值与叙述一致。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const dates = monthDays(text);
        if (dates.length < 2) continue;
        const d1 = dates[0];
        const d2 = dates[1];
        if (d1.doy === d2.doy) continue; // 同一天可能是别的意思（纪念日），不判
        // 「N 天后」必须夹在两个日期之间
        const gapRe = new RegExp(`(${NUM})\\s*(?:天|日)\\s*(?:后|之后|以后)`);
        const between = text.slice(d1.index, d2.index);
        const gapM = gapRe.exec(between);
        if (!gapM) continue;
        const n = parseNumber(gapM[1]);
        if (n === null) continue;
        let delta = d2.doy - d1.doy;
        if (delta < 0) delta += 365; // 跨年
        if (Math.abs(delta - n) < 2) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `${d1.month} 月 ${d1.day} 日到 ${d2.month} 月 ${d2.day} 日相隔 ${delta} 天，`
            + `与文中的「${gapM[0]}」不符。`,
          suggestion: `把「${gapM[0]}」改为「${delta} 天后」，或修正其中一个日期。`,
          extras: { from: d1.raw, to: d2.raw, actualDays: delta, claimedDays: Math.trunc(n) },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- TIM-009 */
  {
    id: 'TIM-009',
    title: '相对时间指向是否与事件同一',
    category: '时间线算术',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      patterns: [/(?:[0-9零〇一二三四五六七八九十两]{1,8})\s*(?:天|日|周|个月|年|小时)\s*(?:前|以前)[^。；]{0,20}(?:[0-9零〇一二三四五六七八九十两]{1,8})\s*(?:天|日|周|个月|年|小时)\s*(?:后|以后|之后)/],
    },
    why: '同一段里出现「X 前」与「Y 后」两个相对时间，是否指向同一件事需要语义判断：'
      + '若指向同一时刻（同一件事既在三天前又在五天后）就是矛盾；若指两件不同的事则正常。',
    fix: '若指向同一件事，改为一致的时间；否则补上区分两件事的说明。',
    ask: '这一段里同时出现了「X 前」与「Y 后」两个相对时间。它们指的是同一件事/同一时刻吗？'
      + '如果是，两者互相矛盾；如果不是，请在答复中说明各自指向的事件。',
  },
];

/** 时段词 + 数字 → 该数字可能的钟点（0–23）。不带时段词时给出两种解释。 */
function clockHours(period, n, half) {
  if (n === null || !Number.isFinite(n) || n < 0 || n > 24) return [];
  let h = Math.trunc(n);
  if (half) h += 0.5;
  if (h >= 24) h -= 24;
  if (!period) {
    // 没写上午/下午：白天与夜间两种解释都保留（只有都不成立时才判定矛盾）
    return h < 12 ? [h, h + 12] : [h];
  }
  if (period === '中午' || period === '正午') return [h === 12 ? 12 : h];
  if (period === '半夜' || period === '深夜' || period === '夜里' || period === '夜晚') {
    return [h < 12 ? h : h % 12];
  }
  if (period === '下午' || period === '傍晚' || period === '晚上') {
    return h < 12 ? [h + 12] : [h];
  }
  // 凌晨/清晨/早上/早晨/上午
  return h === 12 ? [0, 12] : [h];
}

export default { meta, rules };
