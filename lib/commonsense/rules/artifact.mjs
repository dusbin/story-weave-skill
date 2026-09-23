/**
 * lib/commonsense/rules/artifact.mjs — 器物技术与时代错位类常识规则（id 前缀 ANA）。
 *
 * 这一类的核心纪律：**年代判不出来就不判**。
 * 时代错位只有一条合法判据——"文本自己声明了年代，而该器物在那个年代还不存在"。
 * 因此 ANA-001 只认两种情况下的年代：
 *   a) analysis.world.era（分析阶段已定的年代/朝代）；
 *   b) 正文里带明显设定标记的年份或朝代（"故事发生在唐朝""时值 1998 年"）。
 * 正文里偶然提到"他爷爷是清朝人"不会把整篇判成清朝——那种推断全是误报。
 *
 * 器物类规则全部 overridable: true：架空世界可以有超前科技，也可以有引信更长的炸弹。
 * 但"文本自己写下的数字自相矛盾"不在此列（那属于 consistency 模块）。
 */

import { parseNumber, parseDuration, parseDistance, parseYear, isNegated } from '../kit.mjs';

export const meta = { module: 'artifact', name: '器物与时代', standard: 'real' };

function finding(hit, message, suggestion) {
  return { segmentId: hit.id, line: hit.line, quote: hit.text, message, suggestion };
}

/* ------------------------------------------------------------------ 年代判定 */

/** 中国主要朝代区间（用于把"唐朝"这类设定换算成年代上下限） */
const DYNASTIES = [
  { re: /(先秦|春秋|战国|周朝|西周|东周)/, from: -1046, to: -221, label: '先秦' },
  { re: /(秦朝|秦代|大秦)/, from: -221, to: -206, label: '秦' },
  { re: /(汉朝|汉代|西汉|东汉|大汉)/, from: -202, to: 220, label: '汉' },
  { re: /(三国|魏晋|晋朝|南北朝)/, from: 220, to: 589, label: '魏晋南北朝' },
  { re: /(隋朝|隋代)/, from: 581, to: 618, label: '隋' },
  { re: /(唐朝|唐代|大唐|盛唐|晚唐|初唐)/, from: 618, to: 907, label: '唐' },
  { re: /(五代十国|五代)/, from: 907, to: 979, label: '五代十国' },
  { re: /(宋朝|宋代|北宋|南宋|大宋)/, from: 960, to: 1279, label: '宋' },
  { re: /(元朝|元代|大元)/, from: 1271, to: 1368, label: '元' },
  { re: /(明朝|明代|大明)/, from: 1368, to: 1644, label: '明' },
  { re: /(清朝|清代|大清|晚清|清末|光绪|康熙|乾隆)/, from: 1636, to: 1912, label: '清' },
  { re: /(民国|抗战时期|解放前)/, from: 1912, to: 1949, label: '民国' },
];

/** 正文里的年代必须带"设定标记"才作数（避免把回忆里的年代当成全篇设定） */
const ERA_FRAME = /(故事|剧情|背景|时间|时代|时值|时逢|正值|设定)(发生|设定|定格|定格在|是|在|于)?[^。]{0,8}/;

/**
 * 解析文本设定的年代。
 * @returns {{year:number,label:string}|{from:number,to:number,label:string}|null} 判不出返回 null
 */
export function resolveEra(ctx) {
  const world = ctx?.world ?? {};
  const raw = world.era ?? world.period ?? world.eraLabel ?? '';
  const eraStr = typeof raw === 'string' ? raw : String(raw?.label ?? raw?.name ?? raw?.value ?? '');

  const fromAnalysis = eraFromString(eraStr);
  if (fromAnalysis) return fromAnalysis;

  // 正文兜底：只在"带设定标记"的窗口里找年代
  const text = String(ctx?.text ?? '');
  const framed = ERA_FRAME.exec(text);
  if (framed) {
    const win = text.slice(framed.index, framed.index + 40);
    const fromText = eraFromString(win);
    if (fromText) return fromText;
  }
  return null;
}

function eraFromString(s) {
  const str = String(s ?? '');
  if (str.trim() === '') return null;
  const year = parseYear(str);
  if (year !== null) return { year, label: `${year} 年` };
  for (const d of DYNASTIES) {
    if (d.re.test(str)) return { from: d.from, to: d.to, label: d.label };
  }
  return null;
}

/** 该器物是否晚于设定年代（朝代取"王朝结束年"作上限——宁漏勿误） */
function isLate(tech, era) {
  return era.year !== undefined ? tech.year > era.year : tech.year > era.to;
}

/* ------------------------------------------------------------------ 器物年表 */

/**
 * 器物最早出现年份（发明或首次实用）。
 * ⚠️ 只收录有共识的年份；有争议的（如宋代眼镜）一律不收——**宁少勿错**。
 */
const TECH = [
  { term: '纸', year: 105 },
  { term: '火药', year: 850 },
  { term: '活字印刷', year: 1040 },
  { term: '印刷机', year: 1450 },
  { term: '怀表', year: 1510 },
  { term: '显微镜', year: 1590 },
  { term: '望远镜', year: 1608 },
  { term: '蒸汽机', year: 1712 },
  { term: '疫苗', year: 1796 },
  { term: '电池', year: 1800 },
  { term: '轮船', year: 1807 },
  { term: '听诊器', year: 1816 },
  { term: '自行车', year: 1817 },
  { term: '输血', year: 1818 },
  { term: '打火机', year: 1823 },
  { term: '水泥', year: 1824 },
  { term: '火车', year: 1825 },
  { term: '火柴', year: 1826 },
  { term: '电报', year: 1837 },
  { term: '照相机', year: 1839 },
  { term: '麻醉', year: 1846 },
  { term: '缝纫机', year: 1846 },
  { term: '电梯', year: 1857 },
  { term: '地铁', year: 1863 },
  { term: '打字机', year: 1870 },
  { term: '体温计', year: 1870 },
  { term: '电话', year: 1876 },
  { term: '汽油', year: 1876 },
  { term: '留声机', year: 1877 },
  { term: '电灯', year: 1879 },
  { term: '电风扇', year: 1882 },
  { term: '指纹鉴定', year: 1892 },
  { term: '电影', year: 1895 },
  { term: '录音机', year: 1898 },
  { term: '手电筒', year: 1899 },
  { term: '阿司匹林', year: 1899 },
  { term: '飞机', year: 1903 },
  { term: '手表', year: 1904 },
  { term: '塑料', year: 1907 },
  { term: '洗衣机', year: 1908 },
  { term: '冰箱', year: 1913 },
  { term: '坦克', year: 1916 },
  { term: '收音机', year: 1920 },
  { term: '电视', year: 1925 },
  { term: '抗生素', year: 1928 },
  { term: '青霉素', year: 1928 },
  { term: '尼龙', year: 1935 },
  { term: '导弹', year: 1944 },
  { term: '原子弹', year: 1945 },
  { term: '微波炉', year: 1945 },
  { term: '电脑', year: 1946 },
  { term: '计算机', year: 1946 },
  { term: '信用卡', year: 1950 },
  { term: '高铁', year: 1964 },
  { term: '监控摄像头', year: 1968 },
  { term: '互联网', year: 1969 },
  { term: '电子邮件', year: 1971 },
  { term: '手机', year: 1973 },
  { term: '核磁共振', year: 1977 },
  { term: 'DNA', year: 1985 },
  { term: '智能手机', year: 1994 },
  { term: '网购', year: 1995 },
  { term: '微信', year: 2011 },
  { term: '扫码支付', year: 2011 },
];

/* ------------------------------------------------------------------ 规则 */

export const rules = [
  {
    id: 'ANA-001',
    title: '器物与设定年代不符（时代错位）',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: TECH.map((t) => t.term) },
    why: '每一件器物都有它最早出现的年份。文本一旦自己声明了年代（"唐朝""1998 年"），这个年代就成了作品对读者的承诺；此时出现该年代之后才有的器物，就是可核对的时代错位（若年代声明与器物同属"穿越/架空的设定"，那是另一回事，需在设定里说明）。',
    fix: '删掉超前器物，换成当时已有的等价手段（如用驿站快马代替电报、用口信代替电话）；若确实要写穿越或超前科技，请在设定或人物交代中点明，让它成为设定的一部分。',
    check(ctx, hits) {
      const era = resolveEra(ctx);
      if (!era) return []; // 年代判不出来 → 不判（这是本规则最重要的防线）
      const SKIP = /(后世|未来|将来|倘若|如果|假如|想象|梦中|梦里|据说|传说|戏说)/;
      const out = [];
      for (const hit of hits) {
        for (const tech of TECH) {
          if (!hit.text.includes(tech.term)) continue;
          if (isNegated(hit.text, tech.term)) continue; // 「这里没有电话」是正确写法
          if (SKIP.test(hit.text)) continue;
          if (!isLate(tech, era)) continue;
          out.push(finding(
            hit,
            `文本设定为${era.label}，但出现了「${tech.term}」（约 ${tech.year} 年才出现）。`,
            `删除「${tech.term}」或改为当时已有的器物；若确为穿越/架空设定，请在设定或人物台词中明确交代。`,
          ));
          break; // 一段只报一次，避免同段刷屏
        }
      }
      return out;
    },
  },
  {
    id: 'ANA-002',
    title: '手枪/左轮连射数超过容弹量',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['手枪', '左轮', '转轮手枪', '驳壳枪', '开枪', '子弹', '弹匣'] },
    why: '文中已经指名了现实器物的型号（左轮 6 发、常规手枪弹匣 15 发上下），又写明连续射击的次数，这两组数字必须相容——这是同一段文字内的算术核对，不是设定自由度问题。',
    fix: '写一句换弹（"他换上第三个弹匣"），或把射击次数压到容弹量之内；也可改用容弹更多的长枪并写明型号。',
    check(ctx, hits) {
      const REVOLVER = /(左轮|转轮手枪)/;
      const PISTOL = /(手枪|驳壳枪)/;
      const LONG = /(步枪|冲锋枪|机枪|自动步枪|霰弹枪|猎枪)/;
      const RELOAD = /((换|装|压|上)(上)?(弹|弹匣|子弹|梭子)|重新装弹|换了弹匣|补了子弹)/;
      const out = [];
      for (const hit of hits) {
        const revolver = REVOLVER.test(hit.text);
        const pistol = PISTOL.test(hit.text);
        if (!revolver && !pistol) continue;
        if (LONG.test(hit.text)) continue;      // 长枪容弹量另论，不判
        if (RELOAD.test(hit.text)) continue;    // 写了换弹就不判
        const nums = [];
        for (const m of hit.text.matchAll(/([0-9]+|[零〇一二三四五六七八九十百两]{1,4})\s*(发|枪|颗|枚)/g)) {
          const n = parseNumber(m[1]);
          if (n !== null) nums.push(n);
        }
        if (!nums.length) continue;
        const n = Math.max(...nums);
        const cap = revolver ? 12 : 25; // 已按现实最大值放宽（左轮多为 6–8 发，手枪弹匣多在 15–20 发）
        if (n < cap) continue;
        out.push(finding(
          hit,
          `${revolver ? '左轮手枪' : '手枪'}被写成连续射出 ${n} 发，未写换弹，超过现实容弹量。`,
          '补一句换弹，或把射击次数压到容弹量以内；也可写明所用的是容弹更大的长枪。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-003',
    title: '爆炸物拔销后长时间握持',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['手雷', '手榴弹', '引信', '拉环', '保险销', '炸药包', '雷管', '炸弹'] },
    why: '常见手榴弹的延期引信只有 3–5 秒。文本写明"拔掉保险销"又让人握着它过了一分钟以上（甚至还能交谈），等于把引信时长写成了不存在。',
    fix: '把拔销动作放到投掷前一瞬（这是动作戏的正确写法），或写明这是特殊引信/定时装置并给出时长。',
    check(ctx, hits) {
      const BOMB = /(手雷|手榴弹|炸药包|雷管|炸弹)/;
      const PULL = /(拔|拉开|拽下|拔出|拉掉)[^。]{0,6}(销|环|拉环|引信|保险)/;
      const HOLD = /(握|拿|攥|拎|举)(着|在手里|在手中)/;
      const out = [];
      for (const hit of hits) {
        if (!BOMB.test(hit.text) || !PULL.test(hit.text)) continue;
        const dur = parseDuration(hit.text);
        const minutes = dur ? dur.hours * 60 : null;
        const chatty = /(聊|说|谈|等)[^。]{0,6}(几分钟|一会儿|好一会儿|半天|十分钟|半小时)/.test(hit.text);
        if (!(chatty || (minutes !== null && minutes >= 1))) continue;
        if (!HOLD.test(hit.text) && !chatty) continue;
        out.push(finding(
          hit,
          '拔掉保险销后又长时间握持（按常见引信 3–5 秒，早该炸了）。',
          '把拔销放到投掷前的一瞬；若写的是特殊引信/定时装置，请给出具体时长。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-004',
    title: '脆弱材料承重荒谬',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { patterns: [/(纸|纸张|纸糊|竹子|竹条|布|塑料布|冰)(做|搭|糊|造|制|铺|绑)?(的|成)?(桥|桥面|吊桥|屋顶|梯子|路面)/] },
    why: '纸、竹、布、冰这类材料的抗拉抗压强度有量级上限（一张纸桥能承几公斤，撑不住一辆卡车）。文本让它们承载汽车/数吨重量，就与材料强度常识冲突。',
    fix: '换材料（钢索、混凝土、木梁），或把承载物改成人的重量并写明加固方式；若是奇术加固，请交代代价。',
    check(ctx, hits) {
      const LOAD = /(吨|汽车|卡车|货车|拖拉机|装甲车|几十人|十几个人|上百人|重达|满载)/;
      const EXCUSE = /(实验|比赛|模型|玩具|折纸|法术|咒|魔法|结界)/;
      const out = [];
      for (const hit of hits) {
        if (!LOAD.test(hit.text)) continue;
        if (EXCUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          '脆弱材料（纸/竹/布/冰）被写成能承载车辆或数吨重量。',
          '换用有相应强度的材料，或改小承载量；若靠奇术加固，请写出代价与限制。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-005',
    title: '电池续航荒谬',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['手电', '手电筒', '头灯', '对讲机', '电池', '充电'] },
    why: '干电池/锂电池手电与头灯的连续照明时间通常是几小时到几十小时。写成连续亮着两天以上，就超出了电池能量密度的常识量级。',
    fix: '补上更换电池/充电的动作，或把连续使用时间压到合理范围（"省着用，撑了两夜"）。',
    check(ctx, hits) {
      const DEVICE = /(手电|手电筒|头灯|对讲机)/;
      const CONTINUOUS = /(一直|连续|不停|没停|照了|开了|亮着|用了一直)/;
      const out = [];
      for (const hit of hits) {
        if (!DEVICE.test(hit.text)) continue;
        const dur = parseDuration(hit.text);
        if (!dur || dur.hours < 48) continue;
        if (!CONTINUOUS.test(hit.text)) continue;
        out.push(finding(
          hit,
          `${hit.text.length > 0 ? '照明设备' : ''}被写成连续工作约 ${Math.round(dur.hours / 24)} 天而无需换电池。`,
          '补一次换电池/充电，或把连续时长压到几十小时以内。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-006',
    title: '古代交通日行里程超出上限',
    category: '器物与时代',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['日行', '快马', '驿站', '八百里加急', '马不停蹄', '加急'] },
    why: '马匹单日行进上限约 100–200 公里（驿站换马的加急传讯才能接近上限），人步行约 30–50 公里，自行车约 100 公里。文本写"日行八百里"（400 公里）而不给换马与道路条件，就超出了交通常识。',
    fix: '改用驿站换马、水陆兼程等具有现实依据的写法，或把距离/天数算到合理量级。',
    check(ctx, hits) {
      const PER_DAY = /(一天|一日|昼夜|日行|每天|当天)/;
      const FIG = /(夸张|比喻|号称|传说|形容|仿佛|简直是)/;
      const out = [];
      for (const hit of hits) {
        if (!PER_DAY.test(hit.text)) continue;
        if (FIG.test(hit.text)) continue; // 「日行千里」多半是成语式夸张，不判
        const d = parseDistance(hit.text);
        if (!d) continue;
        if (d.km <= 200) continue;
        out.push(finding(
          hit,
          `写明一天之内行进 ${d.km} 公里，超出马匹日行上限（约 100–200 公里，须换马）。`,
          '补上换马/水陆兼程等条件，或把里程与天数改成现实量级。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-007',
    title: '无信号却通讯成功',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['信号', '网络', '盲区', '深山', '无人区', '没信号', '无信号'] },
    why: '手机通讯依赖基站覆盖。文本在同一段里先写"没有信号"，又让通话/上网成功，两者在同一次动作里不能同时成立（若失败才是正确写法）。',
    fix: '要么删掉"没有信号"的交代，要么把通讯写成失败并让情节绕路（走出去、爬上山头、找有线电话）。',
    check(ctx, hits) {
      const NOSIGNAL = /(没有信号|无信号|没信号|没有网络|无网络|信号盲区|没有信号覆盖)/;
      const SUCCESS = /(打通了|接通了|发了出去|发送成功|上传成功|视频通话|刷到了|收到消息|连上了网|定位成功|打通|接通)/;
      const out = [];
      for (const hit of hits) {
        if (!NOSIGNAL.test(hit.text)) continue;
        const cues = hit.text.match(new RegExp(SUCCESS.source, 'g')) ?? [];
        // 「他试了几次都没打通」里的"打通"是被否定的，不算成功
        if (!cues.some((c) => !isNegated(hit.text, c))) continue;
        out.push(finding(
          hit,
          '同一段里既写"没有信号"，又写通讯/联网成功。',
          '删掉"没有信号"的交代，或把通讯改写成失败并让情节绕路解决。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-008',
    title: '内燃机加入非燃料仍能行驶',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['汽车', '发动机', '油箱', '加油', '汽油', '柴油', '轿车', '货车'] },
    why: '汽油/柴油内燃机只能烧相应的燃料。往油箱里灌水、酒精或煤油后车还能照常开走，是把内燃机的工作原理写错了（水会让发动机立刻熄火并可能损坏）。',
    fix: '改成加对应的燃料；若想写"加错了导致抛锚"，那正是现实结果，可以保留并用来制造困境。',
    check(ctx, hits) {
      const CAR = /(汽车|轿车|卡车|货车|面包车|发动机)/;
      const WRONG = /(加|灌|倒|兑)[^。]{0,4}(水|酒精|白酒|煤油)/;
      const MOVE = /(照常|依然|照样|还是|竟然|居然|果然)[^。]{0,6}(开|跑|行驶|启动|发动|上路)/;
      const EXCUSE = /(蒸汽|电动|新能源|氢|改装|烧的是)/;
      const out = [];
      for (const hit of hits) {
        if (!CAR.test(hit.text) || !WRONG.test(hit.text) || !MOVE.test(hit.text)) continue;
        if (EXCUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          '写明往油箱里加了水/酒精/煤油，车却照常行驶——内燃机不能以这些为燃料。',
          '改成加对应燃料；或保留"加错燃料"但让车抛锚，用它制造情节困境。',
        ));
      }
      return out;
    },
  },
  {
    id: 'ANA-009',
    title: '普通器材穿透力荒谬',
    category: '器物与时代',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['弹弓', '石子', '木棍', '拳头', '竹竿', '铁钉', '砖头', '匕首'] },
    why: '弹弓、石子、木棍、拳头的动能有限，打不穿钢板、混凝土墙或防弹材料。文本让普通器材击穿硬质防护，是把材料强度与动能写反了。',
    fix: '换成火器或专业工具，或把目标改成能被它破坏的东西（玻璃、木板、皮肉）。',
    check(ctx, hits) {
      const TOOL = /(弹弓|石子|木棍|拳头|竹竿|铁钉|砖头|匕首|石块)/;
      const PIERCE = /(打穿|击穿|穿透|刺穿|砸穿|捅穿|洞穿)/;
      const HARD = /(钢板|铁板|混凝土|水泥墙|防弹|装甲|铁门|保险柜|钢门|承重墙)/;
      const out = [];
      for (const hit of hits) {
        if (!TOOL.test(hit.text) || !PIERCE.test(hit.text) || !HARD.test(hit.text)) continue;
        out.push(finding(
          hit,
          '普通器材被写成击穿了钢板/混凝土/防弹材料，超出其动能与材料强度常识。',
          '改用火器或专业工具；或把破坏对象换成该器材确实能破坏的东西。',
        ));
      }
      return out;
    },
  },
];

export default { meta, rules };
