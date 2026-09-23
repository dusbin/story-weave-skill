/**
 * lib/commonsense/rules/geography.mjs — 空间与行程常识规则（id 前缀 GEO）。
 *
 * 两条取数纪律：
 *   1. 明示距离 + 明示时长 → 用 kit 的 parseDistance/parseDuration/speedKmh 算平均速度，
 *      与 TRANSPORT_KMH 的巡航速度比对；解析不出就跳过。
 *   2. 没有明示距离时，只在「两地名成对出现 + 有位移动词 + 有时长」时，
 *      用下面的城市坐标表算直线距离（保守取低估），据此估算速度。
 *      坐标是常识性数字，距离按球面直线算，比陆路里程更保守，故不会把正常行程判成错误。
 *
 * 交通/坐骑类规则 overridable: true（飞行、瞬移、神驹都可由设定覆盖，幻想标尺下降一档）；
 * 徒步、负重、海拔这类人体与地形约束 overridable: false。
 */

import { parseDuration, parseDistance, speedKmh, humanHours, parseNumber, LIMITS, TRANSPORT_KMH } from '../kit.mjs';

export const meta = { module: 'geography', name: '空间与行程', standard: 'real' };

/* ------------------------------------------------------------------ 局部工具 */

const NUM = '[0-9]+(?:\\.[0-9]+)?|[零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万萬]{1,8}';
const UNIT_DUR = '年|个月|月|周|星期|礼拜|整天|昼夜|天|日|夜|小时|钟头|时辰|分钟|分|秒';
const UNIT_DIST = '公里|千米|[kK][mM]|米|公尺|里|英里|mile|miles|海里|厘米|公分';
const DUR_TOKEN = `(?:${NUM}\\s*(?:个)?\\s*半\\s*(?:${UNIT_DUR})|半\\s*(?:${UNIT_DUR})|${NUM}\\s*(?:个)?\\s*(?:${UNIT_DUR}))`;
const DUR_TOKEN2 = `(?:${DUR_TOKEN})(?:\\s*(?:${DUR_TOKEN}))?`;
const DIST_TOKEN = `${NUM}\\s*(?:${UNIT_DIST})`;
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

/** 取离某个字符位置最近的元素（用于「A 到 B 用了 X 小时」里挑出那个 X） */
function nearestTo(items, index) {
  let best = null;
  for (const it of items) {
    const gap = Math.abs(it.index - index);
    if (!best || gap < best.gap) best = { item: it, gap };
  }
  return best;
}

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

/**
 * 交通工具识别：顺序敏感（先长后短，避免「马车」被「车」抢走）。
 *   ceiling —— 「长途平均速度」的合理上限（判行程时间是否荒谬）
 *   maxKmh  —— 「瞬时/明示时速」的物理可能上限（判「时速 XXX 公里」是否荒谬）
 * 两个值都取宽松上限：只抓明显荒谬的写法，不抓超速、竞速、高原下坡这类正常夸张。
 */
const MODES = [
  { key: '飞机', re: /(飞机|航班|客机|专机|直升机|空运|飞往|飞到|飞抵|飞回|飞向|飞行|登机|机场|坐飞机|搭飞机)/, ceiling: TRANSPORT_KMH.飞机 * 1.3, maxKmh: 1100 },
  { key: '高铁', re: /(高铁|动车|复兴号)/, ceiling: TRANSPORT_KMH.高铁 * 1.2, maxKmh: 420 },
  { key: '火车', re: /(火车|列车|绿皮车)/, ceiling: TRANSPORT_KMH.火车 * 1.5, maxKmh: 400 },
  { key: '汽车', re: /(汽车|轿车|越野车|开车|驾车|自驾|打车|大巴|客车|面包车)/, ceiling: TRANSPORT_KMH.汽车 * 1.5, maxKmh: 220 },
  { key: '卡车', re: /(卡车|货车|拉货)/, ceiling: TRANSPORT_KMH.卡车 * 1.5, maxKmh: 130 },
  { key: '轮船', re: /(轮船|客轮|邮轮|渡轮|货轮|渔船|军舰)/, ceiling: TRANSPORT_KMH.轮船 * 1.5, maxKmh: 70 },
  { key: '帆船', re: /(帆船|木船|小舟|划船|舢板)/, ceiling: TRANSPORT_KMH.帆船 * 1.6, maxKmh: 30 },
  { key: '骑马', re: /(骑马|马背|骑上马|策马|坐骑|马匹|快马|马车|驴车|牛车)/, ceiling: TRANSPORT_KMH.骑马 * 1.5, maxKmh: 65 },
  { key: '自行车', re: /(自行车|单车|骑行|骑车|脚踏车)/, ceiling: 45, maxKmh: 80 },
];

function modeOf(text) {
  for (const m of MODES) if (m.re.test(text)) return m;
  return null;
}

/** 纯人力移动：走路/游泳（几何速度上限见下） */
const WALK_RE = /(步行|徒步|跋涉|走路|行走|走了|赶路)/;
const SWIM_RE = /(游泳|游过|游了|泅渡|横渡)/;
/** 出现交通工具就不判「人力速度」：「开车…走了一个半小时」里的「走」是赶路的意思 */
const VEHICLE_RE = /(车|船|舰|艇|飞机|航班|直升机|飞行|摩托|机车|马|缆车|电梯|无人机|高铁|动车|地铁)/;

/* ---------------------------------------------------------------- 城市坐标表 */

/**
 * 常用城市的经纬度（大致市中心，取整数位即可——只用于量级判断）。
 * 用球面直线距离而不是陆路里程，得到的是偏小的估计，因此只会漏报不会误报。
 */
const CITIES = {
  北京: [39.9, 116.4], 天津: [39.1, 117.2], 石家庄: [38.0, 114.5], 太原: [37.9, 112.6],
  呼和浩特: [40.8, 111.8], 沈阳: [41.8, 123.4], 大连: [38.9, 121.6], 长春: [43.8, 125.3],
  哈尔滨: [45.8, 126.5], 上海: [31.2, 121.5], 南京: [32.1, 118.8], 苏州: [31.3, 120.6],
  杭州: [30.3, 120.2], 宁波: [29.9, 121.6], 温州: [28.0, 120.7], 合肥: [31.8, 117.2],
  福州: [26.1, 119.3], 厦门: [24.5, 118.1], 南昌: [28.7, 115.9], 济南: [36.7, 117.1],
  青岛: [36.1, 120.4], 郑州: [34.8, 113.6], 武汉: [30.6, 114.3], 长沙: [28.2, 112.9],
  广州: [23.1, 113.3], 深圳: [22.5, 114.1], 南宁: [22.8, 108.4], 海口: [20.0, 110.3],
  三亚: [18.3, 109.5], 重庆: [29.6, 106.6], 成都: [30.6, 104.1], 贵阳: [26.7, 106.6],
  昆明: [25.0, 102.7], 西安: [34.3, 108.9], 兰州: [36.1, 103.8], 西宁: [36.6, 101.8],
  银川: [38.5, 106.2], 乌鲁木齐: [43.8, 87.6], 拉萨: [29.7, 91.1], 敦煌: [40.1, 94.7],
  喀什: [39.5, 76.0], 香港: [22.3, 114.2], 澳门: [22.2, 113.5], 台北: [25.0, 121.6],
  东京: [35.7, 139.7], 首尔: [37.6, 127.0], 新加坡: [1.4, 103.8], 曼谷: [13.8, 100.5],
  新德里: [28.6, 77.2], 迪拜: [25.2, 55.3], 莫斯科: [55.8, 37.6], 伦敦: [51.5, -0.1],
  巴黎: [48.9, 2.4], 纽约: [40.7, -74.0], 洛杉矶: [34.1, -118.2], 悉尼: [-33.9, 151.2],
  开罗: [30.0, 31.2],
};

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** 两点球面直线距离（km） */
function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 起点的初始方位角（0=正北，90=正东） */
function bearing(a, b) {
  const φ1 = rad(a[0]); const φ2 = rad(b[0]); const Δλ = rad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 段内出现的城市（按出现位置排序），最多取两个 */
function cityMentions(text) {
  const out = [];
  for (const name of Object.keys(CITIES)) {
    let idx = text.indexOf(name);
    while (idx >= 0) {
      out.push({ name, index: idx });
      idx = text.indexOf(name, idx + 1);
    }
  }
  return out.sort((x, y) => x.index - y.index);
}

/** 位移动词：没有它就不认为「两座城市」构成了行程 */
const MOVE_RE = /(从|到|去|往|飞往|赶往|开往|前往|抵达|到达|回到|回到|走了|跑了|坐了|乘|搭|开车|驾车|启程|出发|路上|路上|赶路|动身)/;

/* ------------------------------------------------------------------ 规则 */

export const rules = [
  /* ---------------------------------------------------------------- GEO-001 */
  {
    id: 'GEO-001',
    title: '徒步/游泳的行程速度超出人力极限',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['走', '步行', '徒步', '跋涉', '游', '公里', '里'],
      patterns: [/(步行|徒步|跋涉|走路|行走|走了|赶路|游泳|游过|泅渡|横渡)/],
    },
    why: `步行速度约 ${LIMITS.walkKmh} km/h（快走约 6–7 km/h，竞走纪录约 15 km/h）；`
      + '超过慢跑均速（约 12 km/h）就说明作者把跑步/坐车的行程写成了走路。'
      + '游泳约 2–3 km/h，横渡英吉利海峡约 3 km/h。',
    fix: '把时间改长、距离改短，或把「走」改成「跑」/交通工具。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (VEHICLE_RE.test(text)) continue; // 有交通工具，不能算作人力速度
        const mode = SWIM_RE.test(text) ? 'swim' : WALK_RE.test(text) ? 'walk' : null;
        if (!mode) continue;
        if (/(不可能|无法|不能|没能|没有走|没走|未走|没游|没游过)/.test(text)) continue;
        const ds = distances(text);
        const ts = durations(text);
        if (!ds.length || !ts.length) continue;
        const pair = nearestPair(ds, ts);
        if (!pair) continue;
        const speed = speedKmh(pair.a.km, pair.b.hours);
        if (speed === null) continue;
        const ceiling = mode === 'swim' ? (pair.b.hours <= 0.5 ? 8 : 5) : 12; // 12 = TRANSPORT_KMH.跑步
        if (speed <= ceiling) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: speed / ceiling >= 2.5 ? 'blocker' : 'major',
          message: `此处用 ${humanHours(pair.b.hours)}${mode === 'swim' ? '游' : '走'}了 ${pair.a.km} 公里，`
            + `折合 ${speed} km/h，超出人力${mode === 'swim' ? '游泳' : '步行'}上限（约 ${ceiling} km/h）。`,
          suggestion: `把时间改成约 ${humanHours(pair.a.km / (mode === 'swim' ? 3 : 5))}，或把距离改小，`
            + '或改成「跑」/乘车。',
          extras: { mode, km: pair.a.km, hours: pair.b.hours, speed, ceiling },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-002 */
  {
    id: 'GEO-002',
    title: '交通工具行程速度不符',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['公里', '千米', '小时', '车', '飞机', '火车', '骑马', '船'],
      patterns: [/(公里|千米|里|海里)[^。；]{0,20}(小时|分钟|天)|(小时|分钟|天)[^。；]{0,20}(公里|千米|里)/],
    },
    why: `各类交通工具的大致巡航速度：汽车 ${TRANSPORT_KMH.汽车}、火车 ${TRANSPORT_KMH.火车}、`
      + `高铁 ${TRANSPORT_KMH.高铁}、飞机 ${TRANSPORT_KMH.飞机}、轮船 ${TRANSPORT_KMH.轮船} km/h，`
      + `骑马约 ${TRANSPORT_KMH.骑马}（日行不超过 ${LIMITS.horseKmPerDay} 公里）。`
      + '明示距离与时长算出的平均速度远超该上限，说明行程时间写错了。',
    fix: '按该交通工具的巡航速度重算时间（含起降、换乘、休息），或换成更快的交通工具。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const mode = modeOf(text);
        if (!mode) continue; // 没提交通工具就交给 GEO-001 / GEO-004
        if (mode.key === '自行车') continue; // 归 GEO-001 之后的人力规则意义不大，避免重复
        const ds = distances(text);
        const ts = durations(text);
        if (!ds.length || !ts.length) continue;
        const pair = nearestPair(ds, ts);
        if (!pair) continue;
        const speed = speedKmh(pair.a.km, pair.b.hours);
        if (speed === null) continue;
        let ceiling = mode.ceiling;
        if (mode.key === '骑马' && pair.b.hours <= 2) ceiling = Math.max(ceiling, 45); // 短程可以疾驰
        if (speed <= ceiling) continue;
        const ratio = speed / ceiling;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: ratio >= 2.5 ? 'blocker' : ratio >= 1.5 ? 'major' : 'minor',
          message: `此处${mode.key}在 ${humanHours(pair.b.hours)}内走了 ${pair.a.km} 公里，`
            + `折合 ${speed} km/h，超出${mode.key}的合理巡航速度（约 ${Math.round(ceiling)} km/h）。`,
          suggestion: `把时间改为约 ${humanHours(pair.a.km / (mode.ceiling / 1.3))}，或缩短距离、换更快的交通方式。`,
          extras: { mode: mode.key, km: pair.a.km, hours: pair.b.hours, speed, ceiling: Math.round(ceiling) },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-003 */
  {
    id: 'GEO-003',
    title: '明示时速与交通工具不符',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['时速', '每小时', '速度'],
      patterns: [/(时速|每小时|速度)\s*(是|为|达|约|大概|只有|高达)?\s*([0-9]+(?:\.[0-9]+)?|[零〇一二三四五六七八九十百千万两]{1,6})\s*(公里|千米|里|km|KM)/],
    },
    why: `自行车 ${TRANSPORT_KMH.自行车}、汽车 ${TRANSPORT_KMH.汽车}、火车 ${TRANSPORT_KMH.火车}、`
      + `飞机 ${TRANSPORT_KMH.飞机} km/h 是各类交通工具的常规量级；`
      + '「骑自行车时速两百公里」「汽车时速三百公里」都需要解释。',
    fix: '把时速改到该工具的量级，或改成对应的工具（跑车、高铁、飞机）。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(跑车|赛车|超跑|F1|高铁|动车|飞机|战斗机|火箭|导弹)/.test(text)) continue;
        // 紧邻匹配：中间不能留可回溯的窗口，否则「时速三百公里」会被拆成「百公里」=100
        const m = new RegExp(`(?:时速|每小时|速度)\\s*(?:是|为|达|约|大概|只有|高达)?\\s*(${DIST_TOKEN})`).exec(text);
        if (!m) continue;
        const d = parseDistance(m[1]);
        if (!d) continue;
        const kmh = d.km;
        const mode = modeOf(text);
        // 明示时速比的是「物理上能否跑到」，而不是「巡航速度」——超速行驶不算常识错误
        const ceiling = mode ? mode.maxKmh : 220;
        const label = mode ? mode.key : '一般车辆';
        if (kmh <= ceiling) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: kmh >= ceiling * 2 ? 'blocker' : 'major',
          message: `此处${label}的时速写作 ${kmh} km/h，超出该类交通工具的可能上限（约 ${Math.round(ceiling)} km/h）。`,
          suggestion: '把时速改到该交通工具的量级；若要写超高速，请换成飞机/高铁或交代这是特殊车辆。',
          extras: { mode: label, kmh, ceiling: Math.round(ceiling) },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-004 */
  {
    id: 'GEO-004',
    title: '城际移动的时间与距离不匹配',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['从', '到', '去', '出发', '到了', '赶到'],
      patterns: [/(从|到|去|往|飞往|赶往|抵达|到达)[^。；]{0,10}(北京|上海|广州|深圳|成都|重庆|西安|武汉|杭州|南京|哈尔滨|拉萨|乌鲁木齐|昆明|三亚|香港|东京|纽约|伦敦|巴黎|悉尼)/],
    },
    why: '两座城市之间的实际距离是固定的（此处按下表坐标算球面直线距离，属偏小的估计）。'
      + '用时明显短于「最快交通工具也到不了」的时间，说明时间或地点写错了。',
    fix: '按实际距离换算时间（先算最短飞行时间），或把地点改成更近的地方。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (!MOVE_RE.test(text)) continue;
        const cities = cityMentions(text);
        if (cities.length < 2) continue;
        const a = cities[0];
        const b = cities.find((c) => c.name !== a.name);
        if (!b) continue;
        const ts = durations(text);
        if (!ts.length) continue;
        // 取离两座城市中较近者的那个时长：避免把句子里别的时长（「等了三个小时」）算成行程时间
        const nearA = nearestTo(ts, a.index);
        const nearB = nearestTo(ts, b.index);
        const picked = (nearA && nearB && nearA.gap <= nearB.gap) ? nearA : nearB;
        if (!picked || picked.gap > 40) continue;
        const hours = picked.item.hours;
        if (hours <= 0) continue;
        const km = haversine(CITIES[a.name], CITIES[b.name]);
        if (km < 50) continue; // 太近，速度无从判荒谬
        const speed = speedKmh(km, hours);
        if (speed === null) continue;

        const mode = modeOf(text);
        const ceiling = mode ? mode.ceiling : TRANSPORT_KMH.飞机 * 1.3; // 未提工具时按最快（飞机）比
        if (speed > ceiling) {
          out.push({
            segmentId: hit.id,
            line: hit.line,
            quote: text,
            severity: speed / ceiling >= 2 ? 'blocker' : 'major',
            message: `${a.name}到${b.name}直线距离约 ${Math.round(km)} 公里，`
              + `此处只用 ${humanHours(hours)}（折合 ${speed} km/h），`
              + `已超过${mode ? mode.key : '飞机'}的速度上限（约 ${Math.round(ceiling)} km/h）。`,
            suggestion: `把时间改为至少 ${humanHours(km / (mode ? mode.ceiling / 1.3 : TRANSPORT_KMH.飞机))}，`
              + '或换成更快的交通方式，或明确交代这是飞行/瞬移等设定能力。',
            extras: { from: a.name, to: b.name, km: Math.round(km), hours, speed, mode: mode?.key ?? null },
          });
          continue;
        }
        // 比飞机慢、但快过高铁/汽车时，只提示「需交代交通方式」
        if (!mode && speed > TRANSPORT_KMH.高铁 * 1.2) {
          out.push({
            segmentId: hit.id,
            line: hit.line,
            quote: text,
            severity: 'minor',
            message: `${a.name}到${b.name}约 ${Math.round(km)} 公里，此处用 ${humanHours(hours)} 抵达`
              + `（折合 ${speed} km/h），未交代交通方式；这个速度需要飞机/高铁级别才能做到。`,
            suggestion: '补上交通方式（航班/高铁），或把时间改长。',
            extras: { from: a.name, to: b.name, km: Math.round(km), hours, speed },
          });
        }
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-005 */
  {
    id: 'GEO-005',
    title: '徒步爬升/下降速率超出人体能力',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['海拔', '高度', '爬山', '登', '下山'],
      patterns: [/(海拔|高度)\s*(为|是|达|约|高|大约|只有)?\s*([0-9零〇一二三四五六七八九十百千万两]{1,6})\s*米/],
    },
    why: '徒步上坡速率通常 300–500 米/小时，强登山者短时可达 600–700 米/小时；'
      + '1000 米/小时以上在徒步状态下不可能（下坡通常也不超过 1000–1500 米/小时）。',
    fix: '把时间改长（每 1000 米爬升至少 2 小时），或改成缆车/公路/飞行等交通方式。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const hs = [];
        const re = new RegExp(`(?:海拔|高度)\\s*(?:为|是|达|约|高|大约|只有)?\\s*(${NUM})\\s*米`, 'g');
        let m;
        while ((m = re.exec(text)) !== null) {
          const n = parseNumber(m[1]);
          if (n !== null && n > 0) hs.push({ meter: n, index: m.index, raw: m[0] });
        }
        if (hs.length < 2) continue;
        if (!/(徒步|步行|走路|走了|爬|登|上山|攀|行进|下坡|下山)/.test(text)) continue;
        if (/(飞机|直升机|缆车|索道|汽车|开车|火车|电梯|飞船)/.test(text)) continue;
        const ts = durations(text);
        if (!ts.length) continue;
        // 时长取离「终点海拔」最近的那一个：它通常就写在爬升之后（避免把「休息十分钟」算进来）
        const picked = nearestTo(ts, hs[hs.length - 1].index);
        if (!picked || picked.gap > 30) continue;
        const hours = picked.item.hours;
        if (hours <= 0) continue;
        const dh = Math.abs(hs[hs.length - 1].meter - hs[0].meter);
        const rate = dh / hours;
        const climbing = /(爬|登|上山|攀|升|上行)/.test(text) && !/(下坡|下山|降)/.test(text);
        const ceiling = climbing ? 700 : 1500; // 上坡 700、下坡 1500 米/小时
        if (rate <= ceiling) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: rate >= ceiling * 2 ? 'blocker' : 'major',
          message: `此处海拔变化 ${Math.round(dh)} 米 / ${humanHours(hours)}，`
            + `折合 ${Math.round(rate)} 米/小时，超出徒步${climbing ? '爬升' : '下降'}的合理速率（约 ${ceiling} 米/小时）。`,
          suggestion: '把时间改长（每 1000 米爬升至少 2 小时），或改成缆车/公路/飞行。',
          extras: { deltaMeters: Math.round(dh), hours, rate: Math.round(rate), ceiling },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-006 */
  {
    id: 'GEO-006',
    title: '地点与气候/气温矛盾',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['北极', '南极', '赤道', '热带', '沙漠', '冰川', '高原'],
      patterns: [/(北极|南极|极地|冰原|冰川|赤道|热带|沙漠|雨林)/],
    },
    why: '极地终年严寒（夏季也多在 0℃ 上下）、赤道与热带终年高温多雨、'
      + '沙漠昼夜温差大但极少持续暴雨、高原气温随海拔显著降低；'
      + '地点与气候互相矛盾时（如「北极正值盛夏 40℃」）需要交代异常成因。',
    fix: '改掉地点或气候描写；若确实是设定中的异常气候（气候变化、灾变、架空世界），请明确写出。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const cold = /(北极|南极|极地|冰原|冰川|冰盖|格陵兰|西伯利亚|高原|雪山)/;
        const hot = /(盛夏|酷暑|炎热|酷热|高温|挥汗|烈日|摄氏?[三四五][0-9]\s*度|[三四五][0-9]\s*℃|40\s*度|三十八度)/;
        const tropic = /(赤道|热带|雨林|亚马逊|刚果盆地)/;
        const freezing = /(终年积雪|冰雪覆盖|零下|严寒|冰封|大雪)/;
        const desert = /(沙漠|戈壁|撒哈拉)/;
        const rain = /(暴雨|大雨|洪水|连下了?[一二三四五六七八九十]+天)/;

        if (cold.test(text) && hot.test(text)) {
          out.push(finding(hit, 'major',
            `此处把${cold.exec(text)[0]}与「${hot.exec(text)[0]}」写在一起，地点与气温互相矛盾（极地/高海拔终年严寒）。`));
          continue;
        }
        if (tropic.test(text) && freezing.test(text)) {
          out.push(finding(hit, 'major',
            `此处把${tropic.exec(text)[0]}与「${freezing.exec(text)[0]}」写在一起，地点与气候互相矛盾（热带终年高温多雨）。`));
          continue;
        }
        if (desert.test(text) && rain.test(text)) {
          out.push(finding(hit, 'minor',
            `此处把${desert.exec(text)[0]}与「${rain.exec(text)[0]}」写在一起；沙漠地区极少持续性降水，若确有此情节请交代成因（如罕见暴雨、山洪）。`));
        }
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-007 */
  {
    id: 'GEO-007',
    title: '骑马单日行程超出马的耐力行',
    category: '空间与行程',
    severity: 'major',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['骑马', '快马', '策马', '日行', '马不停蹄'],
      patterns: [/(骑马|快马|策马|马不停蹄|日行|纵马)/],
    },
    why: `马的长期耐力约 ${LIMITS.horseKmPerDay} 公里/天（含换马的单日上限约 200 公里）；`
      + '持续多日高速奔驰会把马跑死（历史上驿站换马才能日行数百里）。',
    fix: '把日行程改到 100 公里以内，或写明中途换马、宿营与马的损耗。',
    check(ctx, hits) {
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        const ds = distances(text);
        if (!ds.length) continue;
        const km = Math.max(...ds.map((d) => d.km));
        const ts = durations(text);
        const byDay = /(一天|一日|当日|每天|日行|连日|多日|几日)/.test(text);
        let perDay = null;
        if (byDay) {
          perDay = km; // 已明说「一天/每天」
        } else if (ts.length) {
          const hours = Math.max(...ts.map((t) => t.hours));
          // 只有跨越多日的行程才折算日行距离：两小时疾驰 60 公里不能外推成 720 公里/天
          if (hours >= 20) perDay = (km / hours) * 24;
        }
        if (perDay === null) continue;
        // 门槛取 250：史料记载「八百里加急」约 400 公里/天已到马的极限，单日 200 公里属换马可达
        if (perDay < 250) continue;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: perDay >= 400 ? 'blocker' : 'major',
          message: `此处折算骑马行程约 ${Math.round(perDay)} 公里/天，`
            + `超出马的长期耐力（约 ${LIMITS.horseKmPerDay} 公里/天，单日上限约 200 公里且需换马）。`,
          suggestion: '把日行程压到 100 公里以内，或写明驿站换马、休息与马的损耗。',
          extras: { perDay: Math.round(perDay), km },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-008 */
  {
    id: 'GEO-008',
    title: '行进方向与两地相对方位矛盾',
    category: '空间与行程',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      keywords: ['一路', '南下', '北上', '东行', '西行', '往北', '往南'],
      patterns: [/(往北|向北|朝北|往南|向南|朝南|往东|向东|朝东|往西|向西|朝西|一路向[北南东西]|南下|北上|东进|东行|西进|西行|南行|北行)/],
    },
    why: '「从北京南下到上海」是自洽的（上海在北京以南），'
      + '「从北京北上到上海」则与两地实际方位矛盾。方位是固定事实，可以直接核对。',
    fix: '改掉方向词，或改成与方向相符的目的地。',
    check(ctx, hits) {
      if (!CITIES) return [];
      const out = [];
      for (const hit of hits) {
        const text = hit.text;
        if (/(北上广|广深|京广线|大西南|大西北|东三省)/.test(text)) continue; // 「北上广」是地名合称，不是方向
        const dir = /(往北|向北|朝北|北上|北行|往南|向南|朝南|南下|南行|往东|向东|朝东|东进|东行|往西|向西|朝西|西进|西行|一路向[北南东西])/.exec(text);
        if (!dir) continue;
        if (!MOVE_RE.test(text)) continue;
        const cities = cityMentions(text);
        if (cities.length < 2) continue;
        const a = cities[0];
        const b = cities.find((c) => c.name !== a.name);
        if (!b) continue;
        const deg = bearing(CITIES[a.name], CITIES[b.name]);
        const want = dir[0].includes('北') ? 0 : dir[0].includes('南') ? 180 : dir[0].includes('东') ? 90 : 270;
        let d = Math.abs(deg - want);
        if (d > 180) d = 360 - d;
        if (d <= 60) continue; // 60° 以内算方向大致正确
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: text,
          severity: 'minor',
          message: `${a.name}到${b.name}的实际方位约为${compassName(deg)}（约 ${Math.round(deg)}°），`
            + `与文中的「${dir[0]}」方向不符。`,
          suggestion: '改掉方向词，或换成与方向相符的城市。',
          extras: { from: a.name, to: b.name, bearing: Math.round(deg), claimed: dir[0] },
        });
      }
      return out;
    },
  },

  /* ---------------------------------------------------------------- GEO-009 */
  {
    id: 'GEO-009',
    title: '行程的交通方式与路线是否交代',
    category: '空间与行程',
    severity: 'minor',
    standard: 'real',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['出发', '赶到', '抵达', '回到', '路上'],
      patterns: [/(出发|赶到|抵达|到达|回到|前往|启程|赶路)[^。；]{0,16}(公里|小时|天)/],
    },
    why: '中远距离的位移若不交代交通方式与路线，读者无法判断时间是否合理'
      + '（同一段距离，步行、骑马、火车的时间差几十倍）。这类判断需要语义信息，'
      + '引擎只能收窄成问题交给模型。',
    fix: '补上交通工具、路线与途中事件（换乘、休息、路况）。',
    ask: '这段行程交代了交通方式与路线吗？给出的耗时与距离/地点是否相称'
      + '（例如没有交通工具却跨省、或步行时间内到达数百公里外）？',
  },
];

/** 生成一条 finding（quote/line 必须有出处，否则引擎会丢弃） */
function finding(hit, severity, message) {
  return {
    segmentId: hit.id,
    line: hit.line,
    quote: hit.text,
    severity,
    message,
    suggestion: '改掉地点或气候描写；若这是设定中的异常气候，请明确写出成因（气候变化、灾变、架空世界）。',
  };
}

/** 方位角 → 中文方位描述 */
function compassName(deg) {
  const names = [
    [22.5, '北'], [67.5, '东北'], [112.5, '东'], [157.5, '东南'],
    [202.5, '南'], [247.5, '西南'], [292.5, '西'], [337.5, '西北'],
  ];
  for (const [limit, name] of names) if (deg < limit) return name;
  return '北';
}

export default { meta, rules };
