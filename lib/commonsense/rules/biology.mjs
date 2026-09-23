/**
 * lib/commonsense/rules/biology.mjs — 生理与医学常识规则（id 前缀 BIO）。
 *
 * 这一组全部 overridable: false —— 架空设定里人物仍然是人：
 * 不喝水会死、骨折要长六周、失血会昏迷。幻想标尺下这些规则照原档判定。
 *
 * 判不了就不判：解析不出时长/年龄/温度时一律跳过，只报可核对的量级荒谬。
 */

import { parseDuration, parseDistance, parseCelsius, parseAge, parseNumber, isNegated, LIMITS } from '../kit.mjs';

export const meta = { module: 'biology', name: '生理与医学', standard: 'real' };

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
    const d = parseDuration(m[0]);
    if (d) out.push({ hours: d.hours, raw: m[0], index: m.index });
  }
  return out;
}

function maxHours(text) {
  const ts = durations(text);
  return ts.length ? Math.max(...ts.map((t) => t.hours)) : null;
}

/** 剧烈活动：体力消耗的判据 */
const EXERTION = /(马拉松|长跑|奔跑|狂奔|飞奔|跑|赶路|长途|跋涉|翻山|登山|爬|格斗|搏斗|战斗|打斗|厮杀|急行军|行军|劳作|干活|扛|背|搬运|追击|逃|奔袭|游泳)/;
const DAY = 24;
const WEEK = 7 * DAY;

/** 数字+单位的人体重量（公斤） */
function weightKg(text) {
  const m = new RegExp(`(${NUM})\\s*(吨|公斤|千克|[kK][gG]|斤|磅)`).exec(text);
  if (!m) return null;
  const n = parseNumber(m[1]);
  if (n === null) return null;
  const unit = m[2];
  const kg = unit === '吨' ? n * 1000 : unit === '斤' ? n * 0.5 : unit === '磅' ? n * 0.4536 : n;
  return { kg, raw: m[0] };
}

export const rules = [
  /* ---------------------------------------------------------------- BIO-001 */
  {
    id: 'BIO-001',
    title: '长时间不进食仍剧烈活动',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['没吃', '断粮', '挨饿', '饿了', '绝食', '没进食', '粒米未进', '水米未进', '饥饿'],
      patterns: [/(没吃|没吃东西|断粮|挨饿|饿了|绝食|没进食|粒米未进|水米未进|几天没吃饭)/],
    },
    why: `有水无食的情况下，人约 ${LIMITS.noFoodIncapacitatedHours / DAY} 天即明显丧失行动力，`
      + '约 2–3 个月为生存极限（脂肪耗尽后迅速衰竭）。长期不进食还维持高强度活动需要交代原因。',
    fix: '缩短饥饿时长，或补上水源、身体状态的下降（虚弱、发抖、判断力变差），'
      + '或说明有特殊补给（打点滴、营养液、设定能力）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(输液|打点滴|营养液|葡萄糖|吃了一点|吃了些|喝了粥|进食了|啃了|吃了野果|吃了树皮)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null) continue;
        const exerting = EXERTION.test(text);

        let severity = null;
        if (hours >= 12 * WEEK) severity = 'blocker';                 // 84 天：已过人类生存极限
        else if (hours >= LIMITS.noFoodIncapacitatedHours && exerting) severity = 'blocker';
        else if (hours >= LIMITS.noFoodIncapacitatedHours) severity = 'major';
        else if (hours >= 3 * DAY && exerting) severity = 'minor';    // 三天未进食还剧烈活动
        if (!severity) continue;

        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity,
          message: `此处角色已 ${hours / DAY >= 1 ? `${Math.round((hours / DAY) * 10) / 10} 天` : `${Math.round(hours)} 小时`}`
            + `未进食${exerting ? '，同时仍在进行剧烈活动' : ''}；`
            + `不进食约 ${LIMITS.noFoodIncapacitatedHours / DAY} 天即失去行动能力，2–3 个月为生存极限。`,
          suggestion: '缩短时长，或补上水源与体力衰退的描写，或交代补给来源。',
          extras: { hours, exerting },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-002 */
  {
    id: 'BIO-002',
    title: '长时间不饮水仍活动',
    category: '生理与医学',
    severity: 'blocker',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['没喝水', '没喝一口水', '断水', '缺水', '无水', '滴水未进', '没水喝', '没有水喝', '渴了', '干渴'],
      patterns: [/(没喝水|没喝一口水|没喝过水|断水|缺水|滴水未进|没水喝|没有水喝|渴了|干渴|饥渴)/],
    },
    why: `成年人无水生存上限约 ${LIMITS.noWaterDeathHours / DAY} 天（干燥炎热环境更短），`
      + '且失水 10% 即出现严重症状。断水三天还长途跋涉在生理上不成立。',
    fix: '把断水时间压到一天以内，或交代水源（露水、雨水、植物汁液、绿洲），'
      + '或写成濒死的脱水状态并给出救治过程。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(喝了|饮了|水源|绿洲|河水|露水|雨水|水壶|水囊|找到了水|补充了水)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null) continue;
        const exerting = EXERTION.test(text);

        let severity = null;
        if (hours >= 5 * DAY) severity = 'blocker';                       // 5 天：即使静卧也已超生存极限
        else if (hours >= LIMITS.noWaterDeathHours && exerting) severity = 'blocker';
        else if (hours >= LIMITS.noWaterDeathHours) severity = 'major';
        else if (hours >= 2 * DAY && exerting) severity = 'minor';        // 两天断水还赶路
        if (!severity) continue;

        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity,
          message: `此处断水 ${Math.round((hours / DAY) * 10) / 10} 天${exerting ? '，且仍在长途活动' : ''}；`
            + `无水生存上限约 ${LIMITS.noWaterDeathHours / DAY} 天。`,
          suggestion: '缩短断水时长，或补上水源与濒死脱水的身体状态（舌头发硬、神志不清、无尿）。',
          extras: { hours, exerting },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-003 */
  {
    id: 'BIO-003',
    title: '连续多日不睡仍正常行动',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['没睡', '未眠', '不眠', '没合眼', '没睡觉', '通宵', '熬了', '失眠'],
      patterns: [/(没睡|没合眼|没睡觉|未眠|不眠|通宵|熬了|一夜没|几天没睡|没闭上眼睛)/],
    },
    why: `连续 ${LIMITS.noSleepSevereHours / DAY} 天不睡即出现严重认知与感知障碍`
      + '（幻觉、微睡眠、反应迟钝）；人类记录极限约 11 天，且此后必须长时间补睡。',
    fix: '缩短不睡时长，或写出认知受损的表现（看错、手抖、短暂断片），或交代药物/设定支撑。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(补睡|睡了一天|昏睡|睡着了|打了个盹|小睡)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null) continue;
        let severity = null;
        if (hours >= 8 * DAY) severity = 'blocker';                       // 超过 8 天：超出人类记录
        else if (hours >= LIMITS.noSleepSevereHours) severity = 'major';  // 超过 3 天
        if (!severity) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity,
          message: `此处角色连续 ${Math.round((hours / DAY) * 10) / 10} 天未睡；`
            + `连续 ${LIMITS.noSleepSevereHours / DAY} 天以上会出现严重认知障碍，8 天以上接近人类记录极限。`,
          suggestion: '缩短时长，或写出认知与感知的明显退化，或补上药物/设定支撑及其代价。',
          extras: { hours },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-004 */
  {
    id: 'BIO-004',
    title: '重伤失血后仍持续剧烈活动',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['大出血', '流血不止', '失血', '重伤', '中枪', '中弹', '伤口', '血如泉涌'],
      patterns: [/(大出血|流血不止|血流不止|失血过多|血如泉涌|血喷|动脉|重伤|中枪|中弹|被砍伤|肠子)/],
    },
    why: `成年人失血约 1.5 升（体重的 20–30%）即休克；未止血时约 ${LIMITS.severeBleedingHours} 小时`
      + '即进入危险期。大出血状态下还能持续奔跑、格斗数小时，与失血性休克的进程不符。',
    fix: '把活动时间压缩到几十分钟内，或补上止血包扎的处理与时间点，'
      + '或写出晕厥、视线发黑、行动迟缓的失血表现。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (!EXERTION.test(text)) continue;
        if (/(止住了血|止了血|止住|包扎好了|缠好了|按住了伤口|加压包扎|缝合|输血|输了血)/.test(text)) continue;
        const hours = maxHours(text);
        const unstoppable = /(流血不止|血流不止|止不住|还没止血|来不及包扎|顾不上包扎|血一直在流|血流了一路)/.test(text);

        let severity = null;
        if (hours !== null && hours >= 6) severity = 'blocker';
        else if (hours !== null && hours >= LIMITS.severeBleedingHours) severity = 'major';
        else if (unstoppable) severity = 'minor';
        if (!severity) continue;

        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity,
          message: `此处角色在重伤/大出血状态下${hours !== null ? `仍持续活动约 ${Math.round(hours * 10) / 10} 小时` : '仍持续剧烈活动'}；`
            + `未止血约 ${LIMITS.severeBleedingHours} 小时即进入危险期，失血 1.5 升左右会休克。`,
          suggestion: '缩短活动时间，补上止血包扎与吐血/晕厥等失血表现，或安排送往救治。',
          extras: { hours, unstoppable },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-005 */
  {
    id: 'BIO-005',
    title: '骨折/重伤恢复快于生理过程',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['骨折', '骨裂', '断了腿', '断腿', '肋骨', '骨碎', '韧带'],
      patterns: [/(骨折|骨裂|断了腿|腿断了|断腿|肋骨断了|断了肋骨|骨头断了|骨碎|粉碎性)/],
    },
    why: `骨折临床愈合通常需要 ${LIMITS.fractureHealingWeeks} 周以上，完全恢复负重与运动需 3–6 个月；`
      + '两周内痊愈并参加剧烈运动在生理上不成立。',
    fix: '把恢复期改为「数月」，或写明带伤、打石膏、用拐的状态，并保持后续行动受限。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const healing = /(痊愈|康复|恢复|愈合|长好|能走路|能下地|下地|拆了石膏|参加|上场|复出|归队|重新跑|跑了起来|参赛|训练|比试|格斗|搏斗|打斗|登山|扛|搬)/;
        if (!healing.test(text)) continue;
        if (isNegated(text, '跑') || isNegated(text, '参加') || /(不能|无法|禁止|至少|还没好|没有好)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null) continue;
        const weeks = hours / WEEK;
        if (weeks >= LIMITS.fractureHealingWeeks) continue; // 六周以上是正常范围

        const heavy = EXERTION.test(text);
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: heavy ? 'major' : 'minor',
          message: `此处骨折/重伤后约 ${Math.round(weeks * 10) / 10} 周${heavy ? '就参加剧烈活动' : '即恢复活动'}；`
            + `骨折临床愈合需约 ${LIMITS.fractureHealingWeeks} 周，完全恢复更久。`,
          suggestion: '把时间改为数月，或保留带伤状态（石膏、拐杖、行动受限）并写明代价。',
          extras: { weeks: Math.round(weeks * 10) / 10 },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-006 */
  {
    id: 'BIO-006',
    title: '体温超出人体耐受范围',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['体温', '发烧', '高烧', '低体温', '失温'],
      patterns: [/(体温|发烧|高烧|低体温|失温)/],
    },
    why: `正常体温 ${LIMITS.bodyTempC[0]}–${LIMITS.bodyTempC[1]}℃；`
      + '43℃ 以上会造成蛋白质变性、脑损伤（幸存纪录约 46.5℃ 且伴随严重后遗症）；'
      + '核心体温 30℃ 以下会昏迷、心律失常。',
    fix: '把温度改到 40℃ 上下的高热，或写出对应的后果与救治（降温、送医、昏迷、后遗症）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const t = parseCelsius(text);
        if (t === null) continue;
        let severity = null;
        if (t >= 45 || t <= 28) severity = 'blocker';
        else if (t >= 43 || t <= 30) severity = 'major';
        if (!severity) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity,
          message: `此处体温为 ${t}℃；人体核心体温超过 43℃ 会脑损伤，低于 30℃ 会昏迷、心律失常。`,
          suggestion: '把体温改到 40℃ 左右的高热（或 33℃ 以上的低温症），并写出相应的救治与后果。',
          extras: { celsius: t },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-007 */
  {
    id: 'BIO-007',
    title: '高龄人物的体能动作超出年龄生理',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['老人', '老翁', '老人', '老太太', '花甲', '古稀', '耄耋', '高龄', '老妪', '老汉'],
      patterns: [/(老人|老翁|老太太|花甲|古稀|耄耋|高龄|老妪|老汉|老妇|老者)/],
    },
    why: '80 岁以上人群的骨密度、肌力与心肺功能大幅下降：翻墙、格斗、长跑、搬运重物'
      + '这类极限体能动作在生理上不成立（长期习武的老人可以强于同龄人，但达不到青壮年的极限水平）。',
    fix: '把动作改成与年龄相称的形式（拄杖点穴、以巧取胜、坐镇指挥），'
      + '或明确交代其保持锻炼的背景与代价。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const AGE_WORD = { 花甲: 60, 古稀: 70, 耄耋: 85, 百岁: 100 };
        let age = parseAge(text);
        if (age === null) {
          for (const [w, v] of Object.entries(AGE_WORD)) {
            if (text.includes(w)) { age = v; break; }
          }
        }
        if (age === null || age < 70) continue; // 判不了年龄就不判

        const extreme = /(翻墙|墙头|纵身|飞身|跃上|跃过|格斗|搏斗|打斗|厮杀|奔跑|狂奔|飞奔|马拉松|长跑|举起|扛起|抬起|搬起|摔跤|擒|制服|打倒|疾驰|急行军)/;
        if (!extreme.test(text)) continue;

        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: age >= 80 ? 'major' : 'minor',
          message: `此处 ${age} 岁的人物做出高强度体能动作（${extreme.exec(text)[0]}），`
            + '与其年龄的肌力、骨密度与心肺能力不符。',
          suggestion: '改成与年龄相称的动作（借力、用器物、以经验取胜），或交代其保持训练的背景与身体代价。',
          extras: { age },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-008 */
  {
    id: 'BIO-008',
    title: '幼童完成成人行为',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['孩子', '孩童', '小孩', '幼童', '儿童', '少年'],
      patterns: [/(孩子|孩童|小孩|幼童|儿童|少年|小童)/],
    },
    why: '8 岁以下儿童的身高、肌力与认知控制不足以驾驶车辆或搬动成人；'
      + '这类描写需要交代身体条件的特殊性（或设定的不同）。',
    fix: '把年龄调大，或改成孩子能做到的行为（躲在车里、踩不到油门、够不到离合），'
      + '或明确交代设定的特殊性。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const age = parseAge(text);
        if (age === null || age > 8) continue;
        const driving = /(开车|驾车|驾驶|开卡车|开货车|开公交|开着车|握着方向盘|踩下油门|骑摩托|开飞机)/;
        const heavy = /(举起|扛起|抱起大人|背起大人|抬起|搬起)/;
        if (!driving.test(text) && !heavy.test(text)) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: age <= 6 ? 'major' : 'minor',
          message: `此处 ${age} 岁的孩子${driving.test(text) ? '在驾驶车辆' : '搬动成人/重物'}，`
            + '与其年龄的身高、肌力与控制能力不符。',
          suggestion: '调大年龄，或把行为改写成孩子真能做到的动作；若为特殊设定请明确交代。',
          extras: { age },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-009 */
  {
    id: 'BIO-009',
    title: '长时间缺氧/窒息后完全恢复',
    category: '生理与医学',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['掐住脖子', '掐着脖子', '勒住', '上吊', '窒息', '掐死', '勒死', '捂住口鼻'],
      patterns: [/(掐住脖子|掐着脖子|勒住|上吊|窒息|掐死|勒死|捂住口鼻|扼住咽喉)/],
    },
    why: `脑缺氧 ${LIMITS.drowningMinutes} 分钟起出现不可逆损伤，6–10 分钟后生还且无后遗症极罕见；`
      + '勒颈还会造成喉部损伤与迟发性水肿。',
    fix: '把时间压到几分钟以内，并写出苏醒后的状态（头痛、失声、咳嗽、记忆空白）或救治过程。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const revived = /(苏醒|醒来|醒了过来|救活|生还|活了下来|获救|缓了过来|脱离危险)/;
        if (!revived.test(text)) continue;
        if (/(后遗症|脑损伤|植物人|失忆|缺氧性脑病|没能救|抢救无效)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null) continue;
        const minutes = hours * 60;
        if (minutes <= LIMITS.drowningMinutes) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: minutes >= 10 ? 'blocker' : 'major',
          message: `此处窒息/勒颈约 ${Math.round(minutes)} 分钟后完全恢复；`
            + `脑缺氧 ${LIMITS.drowningMinutes} 分钟即开始不可逆损伤。`,
          suggestion: '缩短缺氧时间，或写出后遗症（头痛、记忆缺失、声音嘶哑）与救治过程。',
          extras: { minutes: Math.round(minutes) },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-010 */
  {
    id: 'BIO-010',
    title: '急性中毒后长时间毫无症状',
    category: '生理与医学',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['毒药', '剧毒', '砒霜', '氰化物', '毒酒', '下毒', '蒙汗药', '迷药', '鹤顶红'],
      patterns: [/(毒药|剧毒|砒霜|氰化物|毒酒|下毒|蒙汗药|迷药|鹤顶红|毒发)/],
    },
    why: '急性中毒（砒霜、氰化物、毒蕈等）通常在数十分钟到数小时内出现呕吐、腹痛、抽搐等症状；'
      + '服下剧毒后长时间毫无反应，需要交代毒物种类、剂量或慢性中毒的设定。',
    fix: '把发作时间改到数十分钟至数小时，或明确这是慢性毒（微量、长期服用）与解药的存在。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (!/(喝下|服下|吞下|吃下|饮下|咽下)/.test(text)) continue;
        if (/(慢性|长期|微量|解药|解毒|催吐|洗胃|及时救治)/.test(text)) continue;
        if (!/(毫无异样|毫无反应|若无其事|安然无恙|一点事都没有|没事|没有中毒|毫无症状|照常)/.test(text)) continue;
        const hours = maxHours(text);
        if (hours === null || hours < 12) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'minor',
          message: `此处服毒后 ${Math.round((hours / 24) * 10) / 10} 天仍毫无症状；`
            + '急性中毒一般在数十分钟至数小时内发作。',
          suggestion: '把发作时间改到数小时内，或明确交代这是慢性毒（微量长期）以及解药/耐受的来由。',
          extras: { hours },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-011 */
  {
    id: 'BIO-011',
    title: '人体尺寸/体重描写是否与人类相符',
    category: '生理与医学',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['身高', '体重', '体型'],
      patterns: [/(身高|体重|体型|身长)/],
    },
    why: '人类成年身高通常 1.5–2.0 米（纪录约 2.72 米）、体重 40–150 公斤；'
      + '远超这个范围需要交代非人种族或设定。',
    fix: '把数值改到人类范围，或明确交代这是非人种族/设定中的体型并保持全书一致。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const d = parseDistance(text);
        if (d && /(身高|体高)/.test(text)) {
          const meters = d.km * 1000;
          if (meters >= 2.5) {
            out.push({
              segmentId: hit.id,
              line: hit.line,
              quote: text,
              severity: 'major',
              message: `此处身高约 ${Math.round(meters * 100) / 100} 米，超出人类身高范围（纪录约 2.72 米）。`,
              suggestion: '改到人类范围，或交代这是非人种族/设定中的体型。',
              extras: { meters: Math.round(meters * 100) / 100 },
            });
          }
        }
        const w = weightKg(text);
        if (w && /(体重|重达|体重有)/.test(text) && w.kg >= 300) {
          out.push({
            segmentId: hit.id,
            line: hit.line,
            quote: text,
            severity: 'major',
            message: `此处体重约 ${Math.round(w.kg)} 公斤，超出人类体重范围（纪录约 440 公斤）。`,
            suggestion: '改到人类范围，或交代这是非人种族/设定中的体型。',
            extras: { kg: Math.round(w.kg) },
          });
        }
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- BIO-012 */
  {
    id: 'BIO-012',
    title: '伤势的救治与恢复过程是否交代',
    category: '生理与医学',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['重伤', '伤口', '骨折', '失血', '中枪', '中弹', '昏迷'],
      patterns: [/(重伤|大出血|失血|骨折|中枪|中弹|昏迷不醒)/],
    },
    why: '重伤、大出血、骨折这类伤害需要救治过程（止血、清创、固定、输血）与恢复期；'
      + '是否与后文行动能力自洽，需要结合上下文判断，引擎无法确定，只能收窄成问题交给模型。',
    fix: '补上救治过程与恢复期，或明确伤害程度比字面更轻。',
    ask: '文中人物的重伤（大出血/骨折/中枪/昏迷）是否交代了救治过程与恢复期？'
      + '其后的行动能力（奔跑、格斗、长途跋涉）与所受伤害是否自洽？',
  },
];

export default { meta, rules };
