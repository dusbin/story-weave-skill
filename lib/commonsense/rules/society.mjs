/**
 * lib/commonsense/rules/society.mjs — 社会制度与流程类常识规则（id 前缀 SOC）。
 *
 * 这一类的共同判据：**现实社会里"要资质、要授权、要时间"的事，不能瞬时完成、也不能谁都能做**。
 * 文本把鉴定写成当场出结果、把量刑写成警察说了算、把处方药写成随手可得，
 * 都是可核对的常识问题（而不是"设定不同"）。
 *
 * 写作纪律（严格对齐 engine.mjs 的规则契约）：
 *   1. 只在文本**自己写明**的前提上判定：写明"当场"、写明"十七岁"、写明"不用处方"。
 *      凡是要靠"文中没提到 X"来推断的，一律不写成 check（那是 ask 的活）。
 *   2. 现实制度在架空世界里可以不同 → 本模块全部 overridable: true（幻想标尺下自动降一档）。
 *   3. severity 克制：能靠一句交代就说明白的，给 minor；把流程彻底写反的，才给 major。
 */

import { parseNumber, parseAge } from '../kit.mjs';

export const meta = { module: 'society', name: '社会与制度', standard: 'real' };

/** 统一构造 Finding —— segmentId / line / quote 三件必有，否则 engine 会丢弃这条命中 */
function finding(hit, message, suggestion) {
  return { segmentId: hit.id, line: hit.line, quote: hit.text, message, suggestion };
}

/** 中文/阿拉伯数量词片段（与 kit 的 CN_NUM_FRAG 同构，供本模块局部使用） */
const NUM = '[0-9零〇一二三四五六七八九十百千万两]{1,8}';

export const rules = [
  /* ------------------------------------------------------------------ 死亡与医疗 */
  {
    id: 'SOC-001',
    title: '无医疗人员即宣告死亡',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      patterns: [/(宣布|宣告|确认|认定|断定|判定)[^。，,]{0,4}(死亡|已经死亡|不治)/],
    },
    why: '死亡认定是法律事实，须由执业医师依临床标准（心跳呼吸停止、脑死亡判定）作出并出具证明。非医疗人员只能"发现"死亡现象，不能作出死亡宣告——否则户籍注销、遗产继承、刑事立案都失去依据。',
    fix: '补一位到场医师（或法医）来作死亡认定；若只是人物的主观判断，请改写成"他探了探鼻息，觉得人已经没气了"，别用"宣布死亡"。',
    check(ctx, hits) {
      const MED = /(医生|大夫|医师|法医|护士|医院|急救|医护|主任|120)/;
      const FIG = /(死刑|处死|社会性死亡|心里|心中|仿佛|好像|宣告破产)/;
      const out = [];
      for (const hit of hits) {
        if (MED.test(hit.text) || FIG.test(hit.text)) continue;
        out.push(finding(
          hit,
          '这一段里没有任何医疗人员，却由非医疗者作出了死亡宣告。',
          '补一位到场医师（或法医）来认定死亡；若只是人物的判断，改成"他觉得人已经没气了"这类主观描述。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-002',
    title: 'DNA 鉴定当场出结果',
    category: '社会与制度',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['DNA', 'dna', '基因检测', '亲子鉴定', '比对'] },
    why: '法医 DNA 鉴定要经过取样、提取、PCR 扩增、电泳分型、比对与复核，并出具鉴定文书，现实中通常需要数小时到数天。写"当场比对完就抓人"，缺了这段必须的实验室时间。',
    fix: '给出一段等待时间（"三天后鉴定结果出来"），或先靠现场可得的证据（监控、指纹、目击、口供）锁定嫌疑人，把 DNA 留作后手。',
    check(ctx, hits) {
      const TECH = /(DNA|dna|基因|亲子鉴定|比对)/;
      const FAST = /(当场|当场就|立刻|立即|马上|随即|几分钟|十分钟|半小时内|不到一小时|当天就|当天出)/;
      const SLOW = /(鉴定所|实验室|送检|几天后|三天后|一周后|第二天才|等待|加急|排期)/;
      const out = [];
      for (const hit of hits) {
        if (!TECH.test(hit.text)) continue;
        if (!FAST.test(hit.text)) continue;
        if (SLOW.test(hit.text)) continue; // 已经写了等待或送检，就不判
        out.push(finding(
          hit,
          'DNA 鉴定被写成当场/当天就出结果——鉴定需要实验室流程，快不到这个程度。',
          '补一句等待时间（如"三天后鉴定结果出来"），或改用现场证据推进情节；若设定里有超前的快检技术，请在设定中明确交代。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-003',
    title: 'A 型血与 B 型血直接互输',
    category: '社会与制度',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['输血', '血型'], patterns: [/[ABO]\s*型/] },
    why: 'A 型血清中含抗 B 凝集素、B 型血清中含抗 A 凝集素，两者直接互输会引发溶血反应，是输血医学最基本的禁忌（A↔B 两个方向都不相容）。',
    fix: '把受血者改成 AB 型（可接受 A/B/O），或把供血者改成 O 型（可输给任何血型）；也可补一句"经交叉配血合格"并写明相容血型。',
    check(ctx, hits) {
      // 「输血」也可能写成「把 A 型血输给了 B 型血的人」，故不只认「输血」二字
      const TRANSFUSE = /(输血|血输给|输给[^。]{0,8}血)/;
      const out = [];
      for (const hit of hits) {
        if (!TRANSFUSE.test(hit.text)) continue;
        const hasA = /A\s*型/.test(hit.text);
        const hasB = /B\s*型/.test(hit.text);
        if (!hasA || !hasB) continue;
        if (/AB\s*型/.test(hit.text)) continue; // AB 与 A/B 单向相容，不判
        out.push(finding(
          hit,
          '同一段里同时出现 A 型血与 B 型血，且发生了输血：这两种血型互不相容（双向都会凝集）。',
          '改血型组合（受血者 AB 型，或供血者 O 型），或补"经过交叉配血"这一句。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-004',
    title: '处方药无处方即可获得',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['处方', '抗生素', '消炎药', '头孢', '阿莫西林', '青霉素', '止痛药', '安眠药', '吗啡', '杜冷丁'] },
    why: '抗生素、镇静催眠药、麻醉类镇痛药在我国属处方药，须凭执业医师处方在医疗机构或具备资质的药店购买。文本如果明写"不用处方"，就与药品管理制度冲突（乱用抗生素也是现实中的公共卫生问题）。',
    fix: '补一句"医生开了处方"或改成"他在医院药房取到了药"；若情节需要黑市购药，请写明渠道与风险（这才是故事该交代的）。',
    check(ctx, hits) {
      const DRUG = /(抗生素|消炎药|头孢|阿莫西林|青霉素|止痛药|安眠药|安定|吗啡|杜冷丁|处方药)/;
      const NO_RX = /(没有|没|不用|无需|不需要|不必)[^。，,]{0,4}处方/;
      const EASY = /(随便|随处|随手|直接|任意|到处|轻易)[^。，,]{0,6}(买|拿|开|搞到|弄到|得到|取到)/;
      const out = [];
      for (const hit of hits) {
        if (!DRUG.test(hit.text)) continue;
        if (!(NO_RX.test(hit.text) || EASY.test(hit.text))) continue;
        out.push(finding(
          hit,
          '处方药被写成不需要处方、随处可得。',
          '补上处方来源（医生开具、医院药房），或把获取渠道写成黑市并交代代价。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-005',
    title: '未成年人独立实施法律行为',
    category: '社会与制度',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['合同', '协议', '签约', '签订', '购房', '买房', '贷款', '抵押', '护照', '签证', '出国', '独自'] },
    why: '八周岁以上未成年人为限制民事行为能力人，签合同、贷款、抵押、办理护照等须由法定代理人代理或同意（十六周岁以上以自己劳动收入为主要生活来源者除外）。文本明写年龄不满十八岁又让本人独立完成这类行为，就与民事制度冲突。',
    fix: '补一句"由父母陪同/监护人签字"，或把人物年龄改到十八岁以上（若十六岁以上且已工作，请写明"以自己收入为生"）。',
    check(ctx, hits) {
      const ACT = /(签下|签订|签署|签约|签了)[^。]{0,6}(合同|协议|契约|字|名)|(购房|买房|贷款|抵押|借款)|(办理|申请|拿到|领到|补办)[^。]{0,4}(护照|签证)|独自(出国|出境|旅行|前往)/;
      const GUARD = /(监护人|法定代理|父母|爸爸|妈妈|父亲|母亲|家长|陪同|随行|带着|由他哥|由他姐)/;
      const out = [];
      for (const hit of hits) {
        const age = parseAge(hit.text);
        if (age === null || age >= 18) continue;
        if (!ACT.test(hit.text)) continue;
        if (GUARD.test(hit.text)) continue;
        out.push(finding(
          hit,
          `文中写明此人 ${age} 岁，却由他本人独立完成了需要法定代理人同意的法律行为。`,
          '改为由监护人代为或陪同（补一句即可），或把年龄调整到十八岁以上并交代经济独立情况。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-006',
    title: '常见小额消费的金额离谱',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: {
      patterns: [/(一顿|一碗|一杯|一份|一张|一斤|一瓶|一趟)[^。，,]{0,6}(饭|面|水|咖啡|茶|包子|馒头|鸡蛋|苹果|车票|地铁票|公交|出租车|理发)[^。，,]{0,8}?[0-9零〇一二三四五六七八九十百千万两]{1,8}\s*(元|块钱|块)/],
    },
    why: '一碗面、一瓶水、一趟公交这类日常小额消费有稳定的量级（当代人民币语境下是几十元以内）。把它写成上万元，除非是恶性通胀或特殊年代背景，否则就是货币购买力常识出错。',
    fix: '核对数字与币种；若要写特殊年代的物价（通胀、票证时代），请把年代与币值一并交代清楚。',
    check(ctx, hits) {
      const PRICE_RE = /(一顿|一碗|一杯|一份|一张|一斤|一瓶|一趟)[^。，,]{0,6}(饭|面|水|咖啡|茶|包子|馒头|鸡蛋|苹果|车票|地铁票|公交|出租车|理发)[^。，,]{0,8}?([0-9零〇一二三四五六七八九十百千万两]{1,8})\s*(元|块钱|块)/;
      const OTHER_CURRENCY = /(日元|韩元|越南盾|港币|台币|新台币|卢比|里拉|通胀|通货膨胀|币值|贬值)/;
      const out = [];
      for (const hit of hits) {
        const m = PRICE_RE.exec(hit.text);
        if (!m) continue;
        const n = parseNumber(m[3]);
        if (n === null) continue;
        if (OTHER_CURRENCY.test(hit.text)) continue;
        if (n < 10000) continue; // 只抓明显荒谬的量级
        out.push(finding(
          hit,
          `日常小额消费（${m[2]}）被写成 ${m[3]} ${m[4]}，量级与现实购买力差得太多。`,
          '核对数字与币种；若是特殊年代或通胀背景，请把币值与年代写清楚。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-007',
    title: '非授权主体调取隐私档案',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['调取', '查阅', '调阅', '档案', '户籍', '通话记录', '银行流水', '监控录像', '案卷', '卷宗', '病历'] },
    why: '户籍档案、通话记录、银行流水、案卷、病历都属于受法律保护的受限信息，只有公安、检察、法院等依法定程序才能调取。记者、普通公民即使"有熟人"，也无权调阅——这既是制度常识，也常是情节的关键阻力所在。',
    fix: '补出合法途径（警方依法调取、律师申请法院调查令），或把"拿到信息"写成代价更高的方式（内部人泄露并承担风险）。',
    check(ctx, hits) {
      const ACT = /(调取|调阅|查阅|查到|拿到|复印|获取)/;
      const OBJ = /(档案|户籍|通话记录|银行流水|监控录像|案卷|卷宗|病历)/;
      const AUTH = /(警察|警方|公安|民警|刑警|检察官|法院|法官|律师|纪委|监察|依法|授权|批准|调查令)/;
      const LAY = /(记者|普通人|平民|村民|学生|老百姓|朋友|邻居|同事|路人|小伙子|女人|男人|老人)/;
      const out = [];
      for (const hit of hits) {
        if (!ACT.test(hit.text) || !OBJ.test(hit.text)) continue;
        if (AUTH.test(hit.text)) continue;
        if (!LAY.test(hit.text)) continue; // 必须写明是"非授权主体"才判
        out.push(finding(
          hit,
          '写明由记者/普通人等非授权主体直接调取受限档案信息，且未交代任何合法途径。',
          '补出合法渠道（警方依法调取、律师申请调查令），或写明泄露者的身份与将要承担的后果。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-008',
    title: '警察直接跨境抓捕',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['出国', '境外', '跨国', '外国', '国境', '引渡', '海关', '国外'] },
    why: '一国警察在他国境内没有执法权。跨境抓捕须通过国际刑警协作、引渡条约或当地警方配合，否则属侵犯他国司法主权，抓回来也无法作为合法程序使用。',
    fix: '改成"通过国际刑警组织协查"、"由当地警方实施抓捕后引渡"，或把情节改成非官方行动（私刑/绑架）并交代其法律风险。',
    check(ctx, hits) {
      const COP = /(警察|警官|民警|公安|刑警|探员|特工|警员|警方)/;
      const GRAB = /(抓捕|抓回|抓人|逮捕|带走|抓到|缉拿|击毙|押回)/;
      const LEGAL = /(引渡|国际刑警|当地警方|大使馆|领事馆|协作|联合行动|司法协助|委托)/;
      const out = [];
      for (const hit of hits) {
        if (!COP.test(hit.text) || !GRAB.test(hit.text)) continue;
        if (LEGAL.test(hit.text)) continue;
        out.push(finding(
          hit,
          '写明本国警察直接在他国境内实施抓捕，没有引渡或国际协作环节。',
          '补一句国际刑警协查/当地警方配合/引渡程序；若写的是私自行动，请交代其非法性与后果。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-009',
    title: '无证据即定罪',
    category: '社会与制度',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { patterns: [/(没有|毫无|并无|无任何|仅凭|只凭|光凭)[^。，,]{0,4}(证据|证人|物证|证词|口供|一面之词)/] },
    why: '定罪的证明标准是"证据确实、充分"，且要经庭审质证。文本明写"没有任何证据"却判了刑，或"仅凭一面之词"就定罪，是把司法程序整体写反了。',
    fix: '补出关键证据（物证、证言、鉴定、监控），或把这段写成冤案的起点（那就该交代它为何能成立：胁迫口供、伪证、权力干预）。',
    check(ctx, hits) {
      const VERDICT = /(判决|定罪|宣判|判处|判了|判决|罪名成立|处以|枪决)/;
      const out = [];
      for (const hit of hits) {
        if (!VERDICT.test(hit.text)) continue;
        out.push(finding(
          hit,
          '这一段写明在没有证据（或仅凭一面之词）的情况下作出了定罪/判决。',
          '补出支撑定罪的关键证据，或写明这段是一个冤案并交代它得以成立的具体机制。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-010',
    title: '警察越权量刑',
    category: '社会与制度',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['判了', '判刑', '判处', '判决', '宣判', '量刑'] },
    why: '定罪量刑是人民法院的专有职权，公安机关只有侦查权（可以拘留、提请逮捕、移送起诉），无权判刑。',
    fix: '改写成"警方将他移送检察院起诉，法院判了他三年"，把决定权交回法院。',
    check(ctx, hits) {
      const COP = /(警察|警官|民警|公安|刑警|派出所|警员)/;
      const SENT = /(判了|判刑|判处|判决|宣判|量刑)/;
      const COURT = /(法院|法官|检察院|法庭|依法|判决书|合议庭)/;
      const out = [];
      for (const hit of hits) {
        if (!COP.test(hit.text) || !SENT.test(hit.text)) continue;
        if (COURT.test(hit.text)) continue;
        out.push(finding(
          hit,
          '写明由警察直接作出量刑/判刑决定，没有任何法院环节。',
          '改为"警方移送检察院、法院判决"，把量刑权交回法院。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-011',
    title: '证件审批当天办结',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['身份证', '护照', '签证', '户口', '营业执照', '房产证', '驾驶证', '驾照', '社保卡', '开户'] },
    why: '身份证、护照、营业执照等证件的办理都有法定时限与审核环节（如身份证法规定六十日内发放、护照一般七个工作日以上）。写成"当天就拿到"，除了临时证件与加急通道，都与制度不符。',
    fix: '补上等待时间（"两周后拿到"），或明确写成"临时身份证/加急办理"这类确实可以当天的情形。',
    check(ctx, hits) {
      const DOC = /(身份证|护照|签证|户口|营业执照|房产证|驾驶证|驾照|社保卡|开户)/;
      const FAST = /(当天|当场|立刻|马上|立即|一上午|半个小时|半小时|下午就|当天就)/;
      const DONE = /(办好|拿到|领到|办完|办成|发下来|下来了|就到手)/;
      const EXCUSE = /(加急|临时|绿色通道|预约|网上办)/;
      const out = [];
      for (const hit of hits) {
        if (!DOC.test(hit.text) || !FAST.test(hit.text) || !DONE.test(hit.text)) continue;
        if (EXCUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          '证件被写成当场/当天办结取件，与法定办理时限不符。',
          '补一段等待时间，或写明是临时证件/加急通道。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-012',
    title: '医院因欠费拒绝急救',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['没交钱', '没钱', '交不起', '欠费', '押金', '医药费', '挂号费', '住院费'] },
    why: '对急危重症患者，医疗机构应当立即抢救，不得因费用问题拒绝急救处置（费用可事后追缴）。把"没交钱就不救"当成正常流程写，与医疗制度常识相悖。',
    fix: '改成"先抢救、后催费"的写法；若要写拒诊，请把它写成违规行为并让情节承担后果（投诉、追责、舆论）。',
    check(ctx, hits) {
      const HOSP = /(医院|急诊|医生|护士|抢救|手术|治疗|接诊|救护)/;
      const REFUSE = /(拒绝|不予|赶出|不治|停止治疗|放弃治疗|先交钱|交钱才|没钱就别)/;
      const out = [];
      for (const hit of hits) {
        if (!HOSP.test(hit.text) || !REFUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          '写明医院因费用问题拒绝/中止急救，且叙述把它当作正常流程。',
          '改成"先抢救、后催费"；若确要写拒诊，请让它是违规行为并交代后果。',
        ));
      }
      return out;
    },
  },
  {
    id: 'SOC-013',
    title: '支出与收入量级严重不符',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['月薪', '月工资', '月收入', '每月工资', '年薪'] },
    why: '人物的一次性支出若远超其收入量级（百倍以上），需要交代来源（积蓄、借贷、家族、横财）。不交代会让读者对"钱从哪来"出戏——这是最常被读者抓住的常识漏洞之一。',
    fix: '补一句资金来源（多年的积蓄、贷款、父母支持、变卖了什么），或把金额调回与收入相称的量级。',
    check(ctx, hits) {
      const INCOME_RE = /(月薪|月工资|月收入|每月工资|年薪)[^。]{0,8}?([0-9零〇一二三四五六七八九十百千万两]{1,8})\s*(?:元|块钱|块)?/;
      const PAY_RE = /(花了|花|付了|支付|买了|买下|掏出|拿出)[^。]{0,10}?([0-9零〇一二三四五六七八九十百千万两]{1,8})\s*(?:元|块钱|块)?/;
      const SOURCE = /(贷款|按揭|借|攒|积蓄|存款|继承|父母|家里给|中奖|卖|拆迁|赔偿|遗产|众筹|分红|积蓄)/;

      const incomes = [];
      for (const seg of ctx.segments) {
        const m = INCOME_RE.exec(seg.text);
        if (!m) continue;
        const n = parseNumber(m[2]);
        if (n && n > 0) incomes.push({ seg, n });
      }
      if (!incomes.length) return [];

      const out = [];
      const seen = new Set();
      for (const inc of incomes) {
        for (const seg of ctx.segments) {
          if (Math.abs((seg.index ?? 0) - (inc.seg.index ?? 0)) > 12) continue; // 只在同一场景内比较，避免张冠李戴
          if (seen.has(seg.id)) continue;
          const m = PAY_RE.exec(seg.text);
          if (!m) continue;
          const n = parseNumber(m[2]);
          if (!n || n < 100000) continue;
          if (n < inc.n * 100) continue;
          if (SOURCE.test(seg.text)) continue;
          seen.add(seg.id);
          out.push(finding(
            seg,
            `文中交代收入约 ${inc.n} 元（${inc.seg.id} 段），这一段却出现 ${m[2]} 的支出，相差约 ${Math.round(n / inc.n)} 倍且未交代来源。`,
            '补一句资金来源（积蓄、贷款、家人支持、变卖资产），或把金额调到与收入相称。',
          ));
        }
      }
      return out;
    },
  },
  {
    id: 'SOC-014',
    title: '救护车瞬间到场',
    category: '社会与制度',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['救护车', '急救车', '120', '急救中心'] },
    why: '急救响应包括受理、调派、出车、路况通行，城市里通常也要几分钟到十几分钟。写成"不到一分钟就赶到"，只有在医院门口才可能，属可核对的流程常识。',
    fix: '把时间改成现实可用的量级（"十几分钟后赶到"），或让"赶不上"本身成为情节压力——那往往比秒到更有张力。',
    check(ctx, hits) {
      const AMB = /(救护车|急救车|120|急救中心)/;
      const INSTANT = /(不到一?分钟|不到半分钟|几十秒|半分钟|一分钟内|瞬间|立刻就到|马上就到|立刻赶到|马上就赶到)/;
      const out = [];
      for (const hit of hits) {
        if (!AMB.test(hit.text) || !INSTANT.test(hit.text)) continue;
        out.push(finding(
          hit,
          '救护车被写成不到一分钟就赶到现场。',
          '改成现实量级的响应时间；若就在医院附近，请顺手交代这个前提。',
        ));
      }
      return out;
    },
  },
];

export default { meta, rules };
