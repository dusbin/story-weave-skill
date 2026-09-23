/**
 * lib/commonsense/rules/physics.mjs — 物理与自然常识规则（id 前缀 PHY）。
 *
 * 纪律（本文件所有规则共同遵守）：
 *   1. 只报「可算的量级荒谬」。「他跑得很快」不报；「他一小时跑三百公里」要报。
 *   2. 所有数值都交给 kit 的解析函数，解析返回 null 一律跳过——判不了就不判。
 *   3. 误报的代价远高于漏报：拿不准时选择不报，宁可放过。
 *
 * 人体生理/物理常数类规则 overridable: false（架空世界里人物还是人）；
 * 超能力/轻功/钢铁之躯类规则 overridable: true（设定可以合法覆盖，幻想标尺下降一档）。
 */

import {
  parseDuration, parseDistance, parseCelsius, speedKmh, humanHours, parseNumber,
  isNegated, LIMITS, TRANSPORT_KMH,
} from '../kit.mjs';

export const meta = { module: 'physics', name: '物理与自然', standard: 'real' };

/* ------------------------------------------------------------------ 局部工具 */

const NUM = '[0-9]+(?:\\.[0-9]+)?|[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬]{1,8}';
const UNIT_DUR = '年|个月|月|周|星期|礼拜|整天|昼夜|天|日|夜|小时|钟头|时辰|分钟|分|秒';
const UNIT_DIST = '公里|千米|[kK][mM]|米|公尺|里|英里|mile|miles|海里|厘米|公分';

/**
 * 时长片段：三种形态与 kit.parseDuration 的内部分支一一对应。
 * 必须要求「数字或半」在前——否则「天空」「月亮」「小时候」里的裸单位会被当成时长。
 */
const DUR_TOKEN = `(?:${NUM}\\s*(?:个)?\\s*半\\s*(?:${UNIT_DUR})|半\\s*(?:${UNIT_DUR})|${NUM}\\s*(?:个)?\\s*(?:${UNIT_DUR}))`;
/** 允许把「一小时三十分钟」这种连写的两段合成一个时长（解析函数本身会求和） */
const DUR_TOKEN2 = `(?:${DUR_TOKEN})(?:\\s*(?:${DUR_TOKEN}))?`;
const DIST_TOKEN = `${NUM}\\s*(?:${UNIT_DIST})`;

/** 年份不是时长：「1998年」「一九九八年」被 parseDuration 算成 8 年，必须剔除 */
const YEAR_LIKE = /^(?:[0-9]{3,4}|[零〇一二三四五六七八九]{4})\s*年$/;

/** 取段内所有可解析时长（小时） */
function durations(text) {
  const out = [];
  const re = new RegExp(DUR_TOKEN2, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (YEAR_LIKE.test(m[0].trim())) continue; // 年份不是时长
    const d = parseDuration(m[0]);
    if (d) out.push({ hours: d.hours, raw: m[0], index: m.index });
  }
  return out;
}

/** 取段内所有可解析距离（公里） */
function distances(text) {
  const out = [];
  const re = new RegExp(DIST_TOKEN, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const d = parseDistance(m[0]);
    if (d) out.push({ km: d.km, raw: m[0], index: m.index });
  }
  return out;
}

/** 距离与时长取「文本上最近的一对」——最可能就是作者想表达的「多远 / 多久」 */
function nearestPair(as, bs, maxGap = 40) {
  let best = null;
  for (const a of as) {
    for (const b of bs) {
      const gap = Math.abs(a.index - b.index);
      if (!best || gap < best.gap) best = { a, b, gap };
    }
  }
  return best && best.gap <= maxGap ? best : null;
}

/** 段内是否明显在否定这件事（否定的句子不算违反常识） */
const DENY_RE = /(不可能|无法|不能|没能|哪能|别说是|算不上|绝无可能|并非|(?:没有|没|未|不曾|从未)\s*(?:跑|走|游|骑|爬|跳))/;

const LOCO_SWIM = /(游泳|游了|游过|泅渡|潜游|横渡)/;
const LOCO_BIKE = /(骑车|骑行|自行车|单车|脚踏车)/;
const LOCO_WALK = /(步行|徒步|跋涉|赶路|走路|行走|走了|走着)/;
const LOCO_RUN = /(奔跑|狂奔|飞奔|疾奔|冲刺|跑步|跑)/;
/** 出现交通工具/坐骑就不做「人力速度」判定——分不清是车在跑还是人在跑 */
const VEHICLE = /(汽车|轿车|卡车|货车|跑车|赛车|火车|高铁|动车|地铁|公交|飞机|航班|直升机|轮船|帆船|渔船|舰|艇|摩托|机车|马|马车|缆车|电梯|无人机)/;

function locoMode(text) {
  if (VEHICLE.test(text)) return null;
  if (LOCO_SWIM.test(text)) return 'swim';
  if (LOCO_BIKE.test(text)) return 'bike';
  if (LOCO_WALK.test(text)) return 'walk';
  if (LOCO_RUN.test(text)) return 'run';
  return null;
}

const MODE_LABEL = { run: '奔跑', walk: '步行', swim: '游泳', bike: '骑行' };

/**
 * 人力移动的速度上限（km/h）。取的都是「宽松上限」，只抓明显荒谬的情况：
 *   - 奔跑：瞬时取 LIMITS.sprintKmh(45，博尔特峰值约 44.7)；
 *           1 小时内取 21（马拉松世界纪录约 20.9 km/h，已经是人类耐力极限）；
 *           12 小时内取 15；更久按 LIMITS.sustainedKmh(10，含休息的长距离平均)。
 *   - 步行：超过慢跑均速就不可能还是「走」——用 TRANSPORT_KMH.跑步(12) 作门槛。
 *   - 游泳：半小时内 8，更久 5（横渡英吉利海峡约 3 km/h，纪录约 4.5）。
 *   - 骑行：半小时内 80（冲坡），5 小时内 45（职业车手级），更久 30（超长距离纪录级）。
 */
function speedCeiling(mode, hours) {
  if (mode === 'walk') return TRANSPORT_KMH.跑步;
  if (mode === 'swim') return hours <= 0.5 ? 8 : 5;
  if (mode === 'bike') return hours <= 0.5 ? 80 : hours <= 5 ? 45 : 30;
  if (hours <= 0.5) return LIMITS.sprintKmh;
  if (hours <= LIMITS.marathonHours) return 21;
  if (hours <= 12) return 15;
  return LIMITS.sustainedKmh;
}

/** 人力移动速度判定：wantShort=true 判短时（≤0.5h），false 判长时 */
function humanSpeedFinding(seg, wantShort) {
  const text = seg.text;
  if (DENY_RE.test(text)) return null;
  const mode = locoMode(text);
  if (!mode) return null;
  const ds = distances(text);
  const ts = durations(text);
  if (!ds.length || !ts.length) return null;
  const pair = nearestPair(ds, ts);
  if (!pair) return null;

  const hours = pair.b.hours;
  const isShort = hours <= 0.5;
  if (isShort !== wantShort) return null;

  const speed = speedKmh(pair.a.km, hours);
  if (speed === null) return null;
  const ceiling = speedCeiling(mode, hours);
  if (speed <= ceiling) return null;

  const ratio = speed / ceiling;
  return {
    segmentId: seg.id,
    line: seg.line,
    quote: seg.text,
    severity: ratio >= 2 ? 'blocker' : 'major',
    message: `此处${MODE_LABEL[mode]} ${pair.a.km} 公里 / ${humanHours(hours)}，平均 ${speed} km/h，`
      + `超出人类${MODE_LABEL[mode]}的合理上限（约 ${ceiling} km/h）。`,
    suggestion: `改成「${humanHours(hours)}内${MODE_LABEL[mode]} ${Math.max(1, Math.round(ceiling * hours))} 公里以内」，`
      + '或把「跑/走/游」换成交通工具，或交代这是设定中的超凡能力。',
    extras: { mode, km: pair.a.km, hours, speed, ceiling },
  };
}

/** 段落里量词缺失时的兜底：身高/高度用「米」，层用「3 米/层」 */
const FLOOR_M = 3;

export const rules = [
  /* ---------------------------------------------------------------- PHY-001 */
  {
    id: 'PHY-001',
    title: '短时奔跑速度超出人类极限',
    category: '物理与自然',
    severity: 'blocker',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['跑', '奔', '走', '游', '骑'],
      patterns: [/(奔跑|狂奔|飞奔|冲刺|跑步|跑|步行|徒步|跋涉|赶路|游泳|骑车|骑行|自行车)/],
    },
    why: '人类瞬时速度上限约 45 km/h（博尔特百米峰值 44.7 km/h），且只能维持几秒。'
      + '半小时内跑出上百公里意味着超过这个生理上限，无论什么年代、什么人物都不成立。',
    fix: '把距离改小、把时间改长，或改成交通工具/设定能力（飞行、瞬移、超能）并明确交代。',
    check(ctx, hits) {
      return hits.map((hit) => humanSpeedFinding(hit, true)).filter(Boolean);
    },
  },

  /* ---------------------------------------------------------------- PHY-002 */
  {
    id: 'PHY-002',
    title: '长距离持续移动速度超出人类极限',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['跑', '奔', '走', '游', '骑', '赶路'],
      patterns: [/(奔跑|狂奔|飞奔|跑步|跑|步行|徒步|跋涉|赶路|行走|走了|游泳|骑车|骑行)/],
    },
    why: '马拉松世界纪录约 2 小时（平均 20.9 km/h）已是人类耐力极限；'
      + '超过半小时的持续移动，平均速度超过 21 km/h、或超过 10 小时仍平均 10 km/h（含休息），'
      + '都需要交代非人的体力来源。',
    fix: '按「每小时 5–10 公里」重写行程时间，或明确这是设定中的超凡体力并给出代价。',
    check(ctx, hits) {
      return hits.map((hit) => humanSpeedFinding(hit, false)).filter(Boolean);
    },
  },

  /* ---------------------------------------------------------------- PHY-003 */
  {
    id: 'PHY-003',
    title: '高处坠落后毫发无伤',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['坠', '摔', '掉下', '跳下', '跌落', '楼'],
      patterns: [/(坠|摔|掉下|跌落|跳下|跃下)[^。；]{0,12}(楼|层|米|丈|悬崖|桥|飞机|高)/],
    },
    why: '自由落体 10 米落地速度约 50 km/h，人体骨骼与内脏难以承受；'
      + '25 米（约 8 层）以上无缓冲生还且不受伤，在现实世界里没有解释空间。',
    fix: '交代缓冲物（雨棚、雪堆、树冠、水），或改成受伤（骨折、内伤、昏迷），'
      + '或明确这是设定中的超凡体质。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        // 没有「安然无事」的表述就不用管：摔死了、摔断腿都是正常写法
        const okCue = /(毫发无伤|毫发无损|毫发未伤|毫发未损|毫发不伤|安然无恙|安然无事|完好无损|一点伤也没有|一点事都没有|行动自如|活了下来|生还|站了起来|爬了起来|拍了拍)/;
        const badCue = /(摔死|死了|身亡|丧命|断了气|昏迷|重伤|骨折|摔断|断了|瘫痪|流血|吐血|瘸|残疾)/;
        const cushion = /(降落伞|伞降|气垫|安全网|绳子|绳索|藤蔓|缓冲|草垛|雪堆|水里|河中|湖里|落水|屋顶|雨棚|帐篷|遮阳棚|挂在)/;
        if (!okCue.test(text) || badCue.test(text) || cushion.test(text)) continue;

        const h = fallHeightMeters(text);
        if (!h || h.meter < 10) continue; // 10 米以下（约 3 层）幸存并不罕见
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: h.meter >= 25 ? 'blocker' : 'major',
          message: `此处坠落高度约 ${Math.round(h.meter)} 米（按${h.raw}估算），却描写为没有受伤。`,
          suggestion: '补上缓冲物或幸存原因（雨棚、雪堆、树枝、水），或改成受伤/昏迷的后果，'
            + '若为设定能力请明确交代。',
          extras: { heightMeters: Math.round(h.meter), from: h.raw },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-004 */
  {
    id: 'PHY-004',
    title: '水下憋气时长超出人类极限',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['憋气', '屏住呼吸', '屏息', '潜水', '水下', '水底'],
      patterns: [/(憋气|屏住呼吸|屏息|潜水|潜入|沉入|在水下|水底|水下)/],
    },
    why: `成人缺氧 ${LIMITS.drowningMinutes} 分钟即开始脑损伤；未经训练者憋气约 1–2 分钟，`
      + '受过训练的静态闭气纪录约 11 分钟。因此 8 分钟以上必须交代训练或装备，30 分钟以上不可能。',
    fix: '缩短水下时间，或交代氧气瓶/潜水装备/训练背景，或明确这是设定中的水下呼吸能力。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const gear = /(氧气瓶|氧气罐|氧气面罩|呼吸器|潜水装备|潜水服|水肺|鳃|法术|异能|法宝|气泡)/;
        const nonHuman = /(鲛人|人鱼|美人鱼|水妖|龙王|海妖|鱼人)/;
        if (gear.test(text) || nonHuman.test(text)) continue;

        const ts = durations(text);
        if (!ts.length) continue;
        const maxHours = Math.max(...ts.map((t) => t.hours));
        const minutes = maxHours * 60;
        if (minutes <= LIMITS.drowningMinutes * 2) continue; // ≤8 分钟：训练有素者可以做到
        const raw = ts.find((t) => t.hours === maxHours).raw;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: minutes >= 30 ? 'blocker' : 'major',
          message: `此处水下/憋气时长为 ${humanHours(maxHours)}，`
            + `远超人脑缺氧耐受（约 ${LIMITS.drowningMinutes} 分钟即开始不可逆损伤）。`,
          suggestion: '把水下时间改到 2 分钟以内；若要写长，须交代潜水装备、专业训练，'
            + '或明确是设定中的水下呼吸能力。',
          extras: { minutes: Math.round(minutes), raw },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-005 */
  {
    id: 'PHY-005',
    title: '声光先后顺序写反（光速远大于声速）',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      patterns: [
        /(先|首先)[^。；]{0,10}(听到|听见|闻声)[^。；]{0,12}(之后|以后|后才|后|才|再)[^。；]{0,8}(看到|看见|望见)/,
        /(听到|听见)[^。；]{0,10}(雷声|巨响|轰鸣|爆炸声|炮声)[^。；]{0,10}(之后|以后|后才|才)[^。；]{0,6}(看到|看见)/,
        /(看到|看见)[^。；]{0,8}(闪电|闪光|电光)[^。；]{0,8}(之前|以前)[^。；]{0,8}(听到|听见)/,
      ],
    },
    why: '光速约 30 万 km/s，声速约 340 m/s。远处的闪光必然先到、雷声后到；'
      + '「先听到雷声再看到闪电」在物理上不可能。',
    fix: '改成「先看到闪电，过了几秒才听到雷声」，并可用「几秒×340 米」推算距离（如 3 秒≈1 公里）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (!/(雷|闪电|闪光|电光|炮|爆炸|枪声|火光)/.test(text)) continue; // 不是声光问题（如先听到脚步后看到人）
        if (isNegated(text, '听到') && isNegated(text, '看到')) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: '此处把「听到声音」写在「看到光」之前，与光速远大于声速相矛盾。',
          suggestion: '把顺序改成先看到闪电/火光，几秒后才听到雷声/爆炸声。',
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-006 */
  {
    id: 'PHY-006',
    title: '徒手举起车辆等重物',
    category: '物理与自然',
    severity: 'blocker',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['举起', '抬起', '搬起', '扛起', '抬起', '汽车', '卡车'],
      patterns: [
        /(举起|抬起|搬起|扛起|提起|抱起|推起)[^。；]{0,10}(汽车|轿车|面包车|卡车|货车|公交车|坦克|集装箱|挖掘机)/,
        /(汽车|轿车|面包车|卡车|货车|公交车|坦克)[^。；]{0,8}(举|抬|扛|搬|抱|推)起了?来?/,
      ],
    },
    why: '一辆轿车约 1.5 吨，卡车以吨计。人类硬拉纪录约 500 公斤且只能维持数秒；'
      + '徒手举起车辆属于明确的超凡力量。',
    fix: '要么去掉这个动作（改为推开车门、搬开压住人的车用千斤顶），'
      + '要么在设定里明确力量来源（异能、机械外骨骼、非人种族）并给出代价。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(吊车|起重机|挖掘机|叉车|铲车|机械|千斤顶|机甲|机器人|法术|异能)/.test(text)) continue; // 机器或设定能力
        if (isNegated(text, '举起') || /(没能|无法|抬不动|举不动)/.test(text)) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'blocker',
          message: '此处让角色徒手举起/抬起车辆（约 1.5 吨以上），超出人类力量极限（硬拉纪录约 500 公斤）。',
          suggestion: '改成借助工具（千斤顶、杠杆、绳索），或把对象换成可以搬动的重物，'
            + '或交代这是设定中的超凡力量。',
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-007 */
  {
    id: 'PHY-007',
    title: '冰水浸泡时长超出人体耐受',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['冰水', '冰窟', '冰河', '冰湖', '冰窖', '冰潭', '冰海', '寒潭'],
      patterns: [/(冰水|冰窟|冰河|冰湖|冰窖|冰潭|冰海|寒潭|冰川|冰面下)/],
    },
    why: `接近 0℃ 的水中，人通常 15 分钟内失去有效行动能力，`
      + `${LIMITS.coldWaterHours} 小时左右已属失温致死区（个别低温存活案例依赖极快救援与复温）。`,
    fix: '缩短浸泡时间到十几分钟以内，或明确写出救援与复温过程及其后果（失温、冻伤、昏迷）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(温泉|热水|火|火焰|热气|锅炉)/.test(text)) continue;
        if (!/(泡|浸|漂|游|落|掉|困|待|待了|挣扎|沉|冻|漂在)/.test(text)) continue;
        const ts = durations(text);
        if (!ts.length) continue;
        const maxHours = Math.max(...ts.map((t) => t.hours));
        if (maxHours <= LIMITS.coldWaterHours) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: maxHours >= 3 ? 'blocker' : 'major',
          message: `此处角色在冰水/冰窟中停留 ${humanHours(maxHours)}，`
            + `已超出冷水浸泡的存活时限（约 ${LIMITS.coldWaterHours} 小时即进入致死区）。`,
          suggestion: '把时间压到 15 分钟以内，或补上被及时救起并复温的过程与失温后果。',
          extras: { hours: maxHours },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-008 */
  {
    id: 'PHY-008',
    title: '爆炸或烈火近距离无伤',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['爆炸', '炸药', '炸弹', '手榴弹', '火海', '烈焰', '大火'],
      patterns: [/(爆炸|炸药|炸弹|手榴弹|雷管|爆燃|火海|烈焰|火场|大火)/],
    },
    why: '炸药在数米内的冲击波（超压）即可造成鼓膜破裂、肺挫伤与内脏损伤，'
      + '火焰几米内会立即造成呼吸道与皮肤烧伤；「毫发无伤」需要解释。',
    fix: '交代掩体、距离（十几米外且有遮挡）、或写成被冲击波震伤（耳鸣、短暂失聪、内伤）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const closeCue = /(中心|正中|近旁|身边|身边|旁边|紧挨|紧贴|咫尺|几米内|两米|三米|火海|烈焰|火中|火里|大火中|冲进|扑进)/;
        const okCue = /(毫发无伤|毫发无损|安然无恙|一点伤也没有|一点事都没有|没事|完好无损|爬起来|站了起来)/;
        const away = /(躲开|避开|及时|远处|远处|逃出|冲出|掩体|墙后|障碍|隔了|幸运|侥幸)/;
        if (!closeCue.test(text) || !okCue.test(text) || away.test(text)) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: '此处角色在爆炸/烈火近旁却毫发无伤，未交代掩体或距离。',
          suggestion: '补上距离与掩体（十几米外、墙后、坑里），或写成受冲击伤/烧伤的后果。',
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-009 */
  {
    id: 'PHY-009',
    title: '极端高温环境中长时间活动',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['高温', '酷热', '热浪', '气温', '摄氏度', '℃'],
      patterns: [/(高温|酷热|热浪|气温|摄氏|℃)/],
    },
    why: '湿球温度约 35℃（对应气温 50–60℃ 的高湿环境）时人体无法靠出汗散热；'
      + '气温 55℃ 以上长时间户外活动会迅速热射病致死。',
    fix: '把气温改到 40℃ 上下（已是极端热浪），或缩短短时间/改成夜间行动/交代防护与饮水。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(温泉|桑拿|汗蒸|烤箱|熔炉|火炉|锅炉|发动机|铁水|炉火)/.test(text)) continue;
        const t = parseCelsius(text);
        if (t === null || t < 55) continue;
        if (!/(走在|行走|赶路|跋涉|奔跑|行进|巡逻|干活|劳动|坚持|待了|待在|驻扎|行军)/.test(text)) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: `此处气温达 ${t}℃，而角色仍在户外长时间活动；该温度已超出人类散热能力，会迅速导致热射病。`,
          suggestion: '把气温降到 40℃ 左右，或改为夜间行动、短暂暴露、并有水源/掩体的详细交代。',
          extras: { celsius: t },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-010 */
  {
    id: 'PHY-010',
    title: '溺水超时后无后遗症生还',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['溺水', '沉入水底', '沉到水底', '落水', '淹'],
      patterns: [/(溺水|沉入水|沉到水|沉底|落水|掉进|淹)/],
    },
    why: `缺氧 ${LIMITS.drowningMinutes} 分钟起脑细胞开始不可逆损伤；`
      + '溺水 10 分钟以上生还且毫无后遗症极罕见（少数低温溺水案例例外，且通常伴随后遗症）。',
    fix: '缩短溺水时间、写明心肺复苏与送医过程，并交代后遗症（吸入性肺炎、脑损伤、记忆问题）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const revived = /(救活|救醒|救了过来|苏醒|醒来|醒了过来|生还|活了|获救|脱离危险|救回来)/;
        if (!revived.test(text)) continue;
        if (/(后遗症|脑损伤|植物人|失忆|昏迷不醒|抢救无效|一直没有醒)/.test(text)) continue;
        const ts = durations(text);
        if (!ts.length) continue;
        const maxHours = Math.max(...ts.map((t) => t.hours));
        const minutes = maxHours * 60;
        if (minutes <= 10) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: minutes >= 30 ? 'blocker' : 'major',
          message: `此处溺水/沉水 ${humanHours(maxHours)} 后生还，`
            + `且未交代任何后遗症；缺氧 ${LIMITS.drowningMinutes} 分钟即会造成脑损伤。`,
          suggestion: '把时间压到几分钟内并写明急救过程；若要写长时间溺水生还，须交代低温保护等特殊条件与后遗症。',
          extras: { minutes: Math.round(minutes) },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-011 */
  {
    id: 'PHY-011',
    title: '跳跃高度或距离超出人类极限',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['跃', '跳'],
      patterns: [/(跳|跃)(上|过|到|越|起|向|下)/],
    },
    why: '人类跳高纪录 2.45 米（含助跑）、立定跳远约 3.5 米、跳远纪录 8.95 米；'
      + '原地跳上 3 米高处、或跃过 9 米以上的距离都超出人体极限。',
    fix: '把高度/距离改到人体范围（跳上 1.5 米、跃过 3–5 米），'
      + '或明确这是设定中的轻功/超凡能力。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const up = new RegExp(`(?:跳|跃)(?:上|到)[^。；]{0,6}?(${DIST_TOKEN})`).exec(text);
        const far = new RegExp(`(?:跳|跃)(?:过|越)[^。；]{0,6}?(${DIST_TOKEN})`).exec(text);
        const m = up || far;
        if (!m) continue;
        const d = parseDistance(m[1]);
        if (!d) continue;
        const meters = d.km * 1000;
        const isUp = Boolean(up);
        if (isUp && meters < 3) continue;
        if (!isUp && meters < 9) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'major',
          message: isUp
            ? `此处一跃跳上约 ${Math.round(meters)} 米高处，超出人类跳跃极限（跳高纪录 2.45 米）。`
            : `此处一跃跃过约 ${Math.round(meters)} 米，超出人类跳远极限（纪录 8.95 米）。`,
          suggestion: '改成人体范围内的距离，或交代这是设定中的轻功/超凡能力及其代价。',
          extras: { meters: Math.round(meters), direction: isUp ? 'up' : 'far' },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-012 */
  {
    id: 'PHY-012',
    title: '负重超出人类力量极限',
    category: '物理与自然',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['扛', '背', '举', '抬', '提起', '公斤', '千克', '吨', '斤'],
      patterns: [/(举起|抬起|扛起|背起|抱起|提起|拎起|扛着|背着|抬着)/],
    },
    why: '人类硬拉纪录约 500 公斤（仅数秒），行军负重通常在 20–45 公斤；'
      + '扛着数百公斤还能行走/奔跑属于超凡力量。',
    fix: '把重量降到合理范围；若要点出角色力大，可写「扛起两百斤」（100 公斤）这个量级。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(吊车|起重机|挖掘机|叉车|铲车|机械|机甲|千斤顶|机器人|法术|异能)/.test(text)) continue;
        const m = new RegExp(`(${NUM})\\s*(吨|公斤|千克|[kK][gG]|斤|磅)`).exec(text);
        if (!m) continue;
        const n = parseNumber(m[1]);
        if (n === null) continue;
        const kg = m[2] === '吨' ? n * 1000 : m[2] === '斤' ? n * 0.5 : m[2] === '磅' ? n * 0.4536 : n;
        const lift = /(举起|抬起|抱起|搬起|举起|拎起)/.test(text);
        const carry = /(扛|背|挑|提着|拎着|扛着|背着)/.test(text);
        const moving = /(走|跑|奔|爬|行军|赶路|登山|上楼|前进)/.test(text);
        const limit = lift ? 600 : carry && moving ? 200 : 400;
        if (kg < limit) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: kg >= 1500 ? 'blocker' : 'major',
          message: `此处让角色${lift ? '举起' : '搬运'}约 ${Math.round(kg)} 公斤，超出人类力量极限`
            + `（硬拉纪录约 500 公斤；负重行军通常在 45 公斤以内）。`,
          suggestion: '把重量降到合理范围，或改成借助工具/多人协作，或交代超凡力量的来源与代价。',
          extras: { kg: Math.round(kg), mode: lift ? 'lift' : 'carry' },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- PHY-013 */
  {
    id: 'PHY-013',
    title: '受撞击/击飞后的后果是否与量级相称',
    category: '物理与自然',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['撞飞', '撞上', '击飞', '甩出', '踢飞', '撞倒'],
      patterns: [/(撞飞|撞上|击飞|甩出|踢飞|撞倒|撞了出去)/],
    },
    why: '被行驶中的车辆撞击、被重击击飞数米，通常伴随骨折、内脏损伤或脑震荡；'
      + '是否与后文「站起来继续战斗」相称，需要结合上下文判断，引擎无法确定。',
    fix: '补上后果（骨裂、内出血、脑震荡、行动受限），或交代防护/体质的特殊性。',
    ask: '此处角色受到撞击/被击飞后的后果（受伤程度、能否立刻继续行动）是否与撞击的量级、'
      + '以及与前后文描写的伤势相称？若不相称，请指出应补充的后果。',
  },
];

/** 从「三十层楼」「二十五米高的桥」里估出坠落高度（米） */
function fallHeightMeters(text) {
  let best = null;
  const reFloor = new RegExp(`(${NUM})\\s*(?:层|楼)`, 'g');
  let m;
  while ((m = reFloor.exec(text)) !== null) {
    const n = parseNumber(m[1]);
    if (n === null || n <= 0) continue;
    const meter = n * FLOOR_M;
    if (!best || meter > best.meter) best = { meter, raw: m[0] };
  }
  const d = parseDistance(text);
  if (d) {
    const meter = d.km * 1000;
    if ((!best || meter > best.meter) && meter > 0) best = { meter, raw: d.raw };
  }
  return best;
}

export default { meta, rules };
