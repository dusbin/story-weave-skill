/**
 * lib/commonsense/rules/language.mjs — 称谓、亲属关系与用语类常识规则（id 前缀 LANG）。
 *
 * 这一类的核心是**关系与称谓的方向性**：
 *   「弟弟」按定义比本人年幼、「哥哥」按定义年长、父亲不能比儿子年纪小。
 * 这类矛盾属于文本内部可核对的事实，**架空设定也覆盖不了**（除非另设亲属制度，那要明写），
 * 因此本模块的亲属关系类规则全部 overridable: false。
 *
 * 反过来，凡是"要读懂上下文才能确定指的是同一个人"的情况（嫂子/姐混用、
 * 「侄子的爷爷」能不能自洽、对白称呼是否合乎身份），一律写成 ask 交给模型判断——
 * 正则猜不准指代，猜错就是误报。
 */

import { parseNumber } from '../kit.mjs';
import { resolveEra } from './artifact.mjs';

export const meta = { module: 'language', name: '称谓与用语', standard: 'real' };

function finding(hit, message, suggestion) {
  return { segmentId: hit.id, line: hit.line, quote: hit.text, message, suggestion };
}

const CN_NUM = '[0-9零〇一二三四五六七八九十两]{1,3}';

/** 亲属称谓语料（用于触发筛与关系归一） */
const REL_WORDS = '哥哥|弟弟|姐姐|妹妹|父亲|爸爸|爹|母亲|妈妈|娘|儿子|女儿|丈夫|妻子|老公|老婆|爷爷|奶奶|外公|外婆|孙子|孙女|叔叔|舅舅|姑姑|姨妈|侄子|外甥|嫂子|弟妹';

/** 称谓 → 关系键（用于互斥判定） */
const REL_KEY = {
  哥哥: '兄', 弟弟: '弟', 姐姐: '姐', 妹妹: '妹',
  父亲: '父', 爸爸: '父', 爹: '父', 母亲: '母', 妈妈: '母', 娘: '母',
  儿子: '子', 女儿: '女', 丈夫: '夫', 妻子: '妻', 老公: '夫', 老婆: '妻',
  爷爷: '祖父', 奶奶: '祖母', 外公: '外祖父', 外婆: '外祖母',
  孙子: '孙', 孙女: '孙女', 叔叔: '叔', 舅舅: '舅', 姑姑: '姑', 姨妈: '姨',
  侄子: '侄', 外甥: '甥', 嫂子: '嫂', 弟妹: '弟媳',
};

/** 互斥关系对（同一个人不可能同时是这两者） */
const CONFLICT = new Set(['兄|弟', '姐|妹', '父|子', '母|女', '夫|妻', '祖父|孙', '祖母|孙女', '叔|侄', '舅|甥', '姑|侄', '姨|甥']);

const MALE_REL = new Set(['父亲', '爸爸', '爹', '爷爷', '外公', '哥哥', '弟弟', '丈夫', '老公', '儿子']);
const FEMALE_REL = new Set(['母亲', '妈妈', '娘', '奶奶', '外婆', '姐姐', '妹妹', '妻子', '老婆', '女儿']);

/** 只可能由活人做出的动作（避免把"爷爷去世了，他说要继承家业"误判） */
const ALIVE_ACTION = '坐在|站在|正在|笑着|说着|走进|走来|端起|夹菜|做饭|洗菜|择菜|开口|回答|点头|招手|叫他|拍|抱|递给|缝|晒太阳|浇花|喂|下棋|喝茶|唱|织|数落|催他|瞪|白了一眼';

export const rules = [
  {
    id: 'LANG-001',
    title: '亲属称谓与年龄方向矛盾',
    category: '称谓与用语',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: {
      keywords: ['弟弟', '妹妹', '小弟', '小妹', '哥哥', '姐姐', '兄长', '大哥', '大姐'],
      patterns: [new RegExp(`(弟弟|妹妹|小弟|小妹|哥哥|姐姐|兄长|大哥|大姐)[^。，,]{0,8}${CN_NUM}\\s*岁`), new RegExp(`岁[^。，,]{0,4}(弟弟|妹妹|小弟|小妹|哥哥|姐姐|兄长|大哥|大姐)`)],
    },
    why: '「弟弟/妹妹」按定义比参照人年幼，「哥哥/姐姐」按定义年长——这是称谓本身的含义，不是设定自由度。写成"比他大二十岁的弟弟"，读者会立刻停下。',
    fix: '把称谓换成与实际年龄相符的那个（大二十岁就是哥哥/姐姐），或把年龄差改到方向正确的一侧。',
    check(ctx, hits) {
      const younger = [
        new RegExp(`(弟弟|妹妹|小弟|小妹)\\s*比\\s*(他|她|我|你|自己|哥哥|姐姐|兄长|大哥|大姐)[^。，,]{0,2}(大|年长|早出生)\\s*(${CN_NUM})\\s*岁`),
        new RegExp(`(大|年长)\\s*(${CN_NUM})\\s*岁的?\\s*(弟弟|妹妹|小弟|小妹)`),
      ];
      const older = [
        new RegExp(`(哥哥|姐姐|兄长|大哥|大姐)\\s*比\\s*(他|她|我|你|自己|弟弟|妹妹)[^。，,]{0,2}(小|年轻)\\s*(${CN_NUM})\\s*岁`),
        new RegExp(`(小|年轻)\\s*(?:他|她|我|你)?\\s*(${CN_NUM})\\s*岁的?\\s*(哥哥|姐姐|兄长|大哥|大姐)`),
      ];
      const out = [];
      for (const hit of hits) {
        for (const re of younger) {
          if (re.test(hit.text)) {
            out.push(finding(hit, '把「弟弟/妹妹」写成了比参照人年长，与称谓本身的含义冲突。', '改成"哥哥/姐姐"，或把年龄差改到"小 N 岁"一侧。'));
            break;
          }
        }
        if (out.some((f) => f.segmentId === hit.id)) continue;
        for (const re of older) {
          if (re.test(hit.text)) {
            out.push(finding(hit, '把「哥哥/姐姐」写成了比参照人年幼，与称谓本身的含义冲突。', '改成"弟弟/妹妹"，或把年龄差改到"大 N 岁"一侧。'));
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: 'LANG-002',
    title: '多重亲属称谓链条能否自洽',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['侄子', '侄女', '外甥', '婶婶', '舅舅', '岳父', '公公', '叔公', '姑妈', '姨妈', '堂兄', '表妹', '嫂子'] },
    why: '多层称谓（「侄子的爷爷」「外甥的舅舅」「嫂子的妹妹」）可以一层层推出唯一的关系人。推不出来或与全文其他交代冲突时，读者会觉得亲属关系是随手写的——这类错误只有读懂上下文才能确认，故交给模型判断。',
    fix: '把链条改短（直接写"我父亲"），或在首次出现时用一句话把关系交代清楚。',
    ask: '请把文中出现的每一处多层亲属称谓（如「侄子的爷爷」「外甥的舅舅」「嫂子的妹妹」）逐层展开，看它推出的具体人物是否唯一、是否与全文其他地方的亲属关系描述一致？若不一致，指出冲突的两处原文。',
  },
  {
    id: 'LANG-003',
    title: '同一人被赋予互斥亲属关系',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: REL_WORDS.split('|') },
    why: '同一个人不可能同时是「哥哥」和「弟弟」（对同一参照人而言）。若文中对同一个主语既说"是我哥哥"又说"是我弟弟"，就属关系矛盾。',
    fix: '统一称谓，或补一句交代（例如"他既是我的表弟，也是我名义上的哥哥"——把关系说清楚，矛盾就变成设定）。',
    check(ctx, hits) {
      const RE = new RegExp(`([\\u4e00-\\u9fa5]{1,3})(?:是|成了|当上了)(?:他|她|我|你|自己)?(?:的)?(${REL_WORDS})`, 'g');
      const out = [];
      for (const hit of hits) {
        const claims = [];
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(hit.text)) !== null) {
          const rawSubject = m[1];
          const last = rawSubject.slice(-1);
          const subject = '他她我你'.includes(last) ? last : rawSubject.slice(-3);
          const key = REL_KEY[m[2]];
          if (!key) continue;
          claims.push({ subject, isName: !'他她我你'.includes(last), key, word: m[2] });
        }
        const conflicts = [];
        for (let i = 0; i < claims.length; i++) {
          for (let j = i + 1; j < claims.length; j++) {
            if (claims[i].subject !== claims[j].subject) continue;
            if (claims[i].key === claims[j].key) continue;
            if (!CONFLICT.has(`${claims[i].key}|${claims[j].key}`)) continue;
            conflicts.push([claims[i], claims[j]]);
          }
        }
        if (!conflicts.length) continue;
        // 指代明确（用姓名）时是硬矛盾；只用代词时可能是两个人，从严一点判 minor
        const byName = conflicts.some(([a]) => a.isName);
        const [a, b] = conflicts[0];
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: hit.text,
          message: `同一段里对同一主语（${a.subject}）既称「${a.word}」又称「${b.word}」，两者互斥。`,
          suggestion: '统一称谓；若确有双重身份（过继、改嫁、名义关系），请把这个关系明写出来。',
          severity: byName ? 'major' : 'minor',
        });
      }
      return out;
    },
  },
  {
    id: 'LANG-004',
    title: '对同一人的称呼前后混用',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['嫂子', '弟妹', '姐夫', '妹夫', '婶婶', '阿姨', '大哥', '大伯', '叔叔', '舅舅', '姑姑'] },
    why: '称谓是人物关系的坐标。「嫂子」（哥哥的妻子）与「姐」（姐姐）、「阿姨」与「婶婶」指向的关系不同。若同一人在同一场戏里被两种互不相容的称谓指代，读者会以为是两个人。判定需要确认指代，故交给模型。',
    fix: '统一称谓；若要写"随孩子叫"这类称呼迁移，请在文中点一句（"跟着孩子，她也叫他叔叔"）。',
    ask: '文中对同一个人是否出现了两种互不相容的称谓（如一会儿「嫂子」一会儿「姐」、一会儿「阿姨」一会儿「婶婶」）？请指出这两处原文，并说明它们指的是不是同一个人。',
  },
  {
    id: 'LANG-005',
    title: '已逝人物被当作在世描写',
    category: '称谓与用语',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { patterns: [/(去世|过世|逝世|牺牲|殉职|死了|身亡|已故|断了气)/] },
    why: '文本刚写明某人已死，紧接着又让同一个人坐在门口择菜、笑着说话，是时间与事实层面的矛盾。死亡是不可逆的事实，架空设定也不能靠"设定自由"抹掉。',
    fix: '把那句改成回忆（"他想起奶奶坐在门口择菜的样子"）或换成另一个人；若是"假死/复活"，请在那里给出明确交代。',
    check(ctx, hits) {
      const DEATH = /(去世|过世|逝世|牺牲|殉职|死了|身亡|已故|断了气)/;
      const PERSON_RE = new RegExp(`(${REL_WORDS})`, 'g');
      const SKIP_AFTER = /^(后|以后|之后|以前|之前|那年|那天|当天|的时候|那年冬天)/;
      const out = [];
      for (const hit of hits) {
        const dm = DEATH.exec(hit.text);
        if (!dm) continue;
        const before = hit.text.slice(0, dm.index);
        const after = hit.text.slice(dm.index + dm[0].length);
        // 「父亲去世后，他扛起了这个家」——后面的"他"不是死者，跳过
        if (SKIP_AFTER.test(after)) continue;
        const persons = [...before.matchAll(PERSON_RE)].map((m) => m[1]);
        if (!persons.length) continue;
        const person = persons[persons.length - 1]; // 死亡词之前最近的亲属称谓
        const actorRe = new RegExp(`(他|她|${REL_WORDS})[^。，,]{0,3}(${ALIVE_ACTION})`);
        const am = actorRe.exec(after);
        if (!am) continue;
        const actor = am[1];
        const same = actor === person
          || (actor === '他' && MALE_REL.has(person))
          || (actor === '她' && FEMALE_REL.has(person));
        if (!same) continue;
        // 用同一个称谓重申（"奶奶去世了，奶奶还…"）指代唯一 → 硬矛盾；
        // 只靠性别代词吻合时可能是指同性的另一个人 → 从严判 minor。
        const unambiguous = actor === person;
        out.push({
          segmentId: hit.id,
          line: hit.line,
          quote: hit.text,
          message: unambiguous
            ? `文中已写明「${person}」${dm[0]}，同句里又让「${actor}」做出在世者的动作（${am[2]}）。`
            : `文中已写明「${person}」${dm[0]}，同句里又出现与死者同性别的「${actor}」做出在世者的动作（${am[2]}）——若这里的「${actor}」指的是别人，请把主语写明。`,
          suggestion: '把这句改成回忆/遗物/坟前的想象，或把动作的执行者换成在世的人；若写的是假死或复活，请在该处明确交代。',
          severity: unambiguous ? 'major' : 'minor',
        });
      }
      return out;
    },
  },
  {
    id: 'LANG-006',
    title: '现代场景中的帝王自称',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['朕', '寡人', '孤家', '臣妾', '微臣', '奴才'] },
    why: '「朕」「寡人」「臣妾」是古代帝王与后妃的自称，现代（民国以后）场景里出现，除非是戏中戏或引文，否则属自称与年代/身份的错位。',
    fix: '改成现代口语自称（我/鄙人/本人）；若是引用或演戏，请在文中点明是在背台词。',
    check(ctx, hits) {
      const era = resolveEra(ctx);
      if (!era) return []; // 年代不明不判
      const modern = era.year !== undefined ? era.year >= 1912 : (era.to ?? 0) >= 1912;
      if (!modern) return [];
      const EXCUSE = /(台词|剧本|戏里|扮演|饰演|模仿|引用|古文|笑称|开玩笑|自称)/;
      // 【坑】引擎按句末标点切段，「他抬头道：「朕知道了。」」会被切成两段，
      // 所以这里不能要求引号在同一段里闭合——只认"引号 + 自称"同段出现。
      const QUOTE = /[「“」”]/;
      const SELF = /(朕|寡人|孤家|臣妾|微臣|奴才)/;
      const out = [];
      for (const hit of hits) {
        if (!QUOTE.test(hit.text) || !SELF.test(hit.text)) continue;
        if (EXCUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          `设定为${era.label}，对白里却出现帝王/后妃自称（「${(SELF.exec(hit.text) ?? [''])[0]}」）。`,
          '改成现代口语自称；若是引用台词或戏中戏，请在该处点明。',
        ));
      }
      return out;
    },
  },
  {
    id: 'LANG-007',
    title: '古代场景中的现代网络用语',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    trigger: { keywords: ['内卷', '社死', '破防', 'emo', 'YYDS', 'yyds', '绝绝子', '打卡', '点赞', '朋友圈', '刷屏', '摸鱼', '躺平', '上头', '666', '直播间', '干饭', '老铁'] },
    why: '网络流行语有明确的产生年代与语域。古代（1912 年以前）场景里的人物使用它们，属于用语与年代的错位（穿越梗除外，但那要在文中点明是穿越）。',
    fix: '换成同时代的说法；若要写穿越或玩梗效果，请让人物自己点一句"这词儿你们听不懂"。',
    check(ctx, hits) {
      const era = resolveEra(ctx);
      if (!era) return [];
      const ancient = era.year !== undefined ? era.year < 1912 : (era.to ?? 9999) < 1912;
      if (!ancient) return [];
      const SLANG = /(内卷|社死|破防|emo|YYDS|yyds|绝绝子|打卡|点赞|朋友圈|刷屏|摸鱼|躺平|上头|666|直播间|干饭|老铁)/;
      const EXCUSE = /(穿越|现代人|戏仿|玩梗|台词|剧本|直播设备)/;
      const out = [];
      for (const hit of hits) {
        const m = SLANG.exec(hit.text);
        if (!m) continue;
        if (EXCUSE.test(hit.text)) continue;
        out.push(finding(
          hit,
          `设定为${era.label}，正文/对白里却用了现代网络用语「${m[1]}」。`,
          '换成同时代的说法；若是穿越梗，请让人物点明。',
        ));
      }
      return out;
    },
  },
  {
    id: 'LANG-008',
    title: '父母子女年龄倒置',
    category: '称谓与用语',
    standard: 'both',
    severity: 'major',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { keywords: ['父亲', '母亲', '爸爸', '妈妈', '爹', '娘', '继父', '继母', '养父', '养母', '儿子', '女儿', '继子', '继女', '养子', '养女'] },
    why: '生育有生理下限（母亲至少要十余岁才可能生育）。文中若把父亲/母亲的年龄与亲生子女的年龄写得相差不足十二岁（甚至倒挂），就是硬矛盾。',
    fix: '调整两处年龄到正常区间；若写的是继父母/养父母，请把"继/养"写明——这正是本条规则不判的情形。',
    check(ctx, hits) {
      const EXCUSE = /(继父|继母|养父|养母|后爸|后妈|养子|养女|继子|继女|干爹|干妈|抱养|收养|岳父|公公|婆婆|女婿|儿媳|外祖父|外祖母)/;
      const P = new RegExp(`(父亲|母亲|爸爸|妈妈|爹|娘|继父|继母|养父|养母|后爸|后妈)[^。，,]{0,4}?(${CN_NUM})\\s*岁`);
      const C = new RegExp(`(儿子|女儿|继子|继女|养子|养女)[^。，,]{0,4}?(${CN_NUM})\\s*岁`);
      const out = [];
      for (const hit of hits) {
        if (EXCUSE.test(hit.text)) continue;
        const p = P.exec(hit.text);
        const c = C.exec(hit.text);
        if (!p || !c) continue;
        const pa = parseNumber(p[2]);
        const ca = parseNumber(c[2]);
        if (pa === null || ca === null) continue;
        if (pa - ca >= 12) continue;
        out.push(finding(
          hit,
          `同一段里${p[1]} ${pa} 岁、${c[1]} ${ca} 岁，相差不到十二岁（生育的生理下限）。`,
          '把两处年龄调到正常区间；若写的是继/养父母，请把"继/养"二字写明。',
        ));
      }
      return out;
    },
  },
  {
    id: 'LANG-009',
    title: '互斥称谓被明确等同',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: false,
    trigger: { patterns: [/(嫂子|弟妹|姐夫|妹夫|婶婶|姑姑|舅舅|岳父|公公)[^。，,]{0,6}(就是|也就是|其实是|原来是|等于)[^。，,]{0,6}(姐姐|妹妹|嫂子|弟妹|妈妈|母亲|爸爸|父亲|哥哥|弟弟|女儿)/] },
    why: '「嫂子」是哥哥的妻子，与"亲姐姐"是互斥关系；「公公」是丈夫的父亲，不是自己的父亲。文中若用"就是/其实就是"把两者画等号，就属关系矛盾。',
    fix: '换成正确的那个称谓；若确有特殊身份（过继、改嫁、姻亲重叠），请把这个关系交代清楚——那就不再是矛盾而是设定。',
    check(ctx, hits) {
      const INCOMPAT = {
        嫂子: ['姐姐', '妹妹', '妈妈', '母亲', '女儿'],
        弟妹: ['姐姐', '妹妹', '嫂子', '妈妈', '母亲'],
        姐夫: ['哥哥', '弟弟', '爸爸', '父亲'],
        妹夫: ['哥哥', '弟弟', '爸爸', '父亲'],
        婶婶: ['妈妈', '母亲', '姐姐', '妹妹'],
        姑姑: ['妈妈', '母亲', '姐姐', '妹妹'],
        舅舅: ['爸爸', '父亲', '哥哥', '弟弟'],
        岳父: ['爸爸', '父亲'],
        公公: ['爸爸', '父亲'],
      };
      const RE = /(嫂子|弟妹|姐夫|妹夫|婶婶|姑姑|舅舅|岳父|公公)[^。，,]{0,6}(?:就是|也就是|其实是|原来是|等于)[^。，,]{0,2}([表堂干继拜]?)(姐姐|妹妹|嫂子|弟妹|妈妈|母亲|爸爸|父亲|哥哥|弟弟|女儿)/;
      const out = [];
      for (const hit of hits) {
        const m = RE.exec(hit.text);
        if (!m) continue;
        if (m[2] !== '') continue; // 「表姐/堂姐」等有血缘旁支关系，可能是同一个人，不判
        if (!(INCOMPAT[m[1]] || []).includes(m[3])) continue;
        out.push(finding(
          hit,
          `文中把「${m[1]}」与「${m[3]}」画了等号，两者指向的亲属关系互斥。`,
          '换成正确的称谓；若确有特殊身份，请把这个关系交代清楚。',
        ));
      }
      return out;
    },
  },
  {
    id: 'LANG-010',
    title: '对白称呼与人物身份/语境不合',
    category: '称谓与用语',
    standard: 'both',
    severity: 'minor',
    tiers: ['realistic', 'speculative'],
    overridable: true,
    // 有对白（中文引号开头）就问一次；引擎按句末标点切段，引号常与内容分开，故只认开头引号
    trigger: { patterns: [/[「“]/] },
    why: '称呼是最省钱的人物刻画工具：下属对上司、晚辈对长辈、陌生人之间的称呼都受身份与场合约束。称呼用错，人物的社会位置就立不住——但"是否用错"要读懂关系与场合，故交给模型。',
    fix: '按人物的身份与关系改写称呼；若要写故意的失礼（挑衅、亲近、试探），请让叙述或反应点出这是失礼。',
    ask: '请逐句检查对白中的称呼：说话人与听话人的身份、关系、场合，是否支持这个称呼（如身份低者对高者直呼其名、陌生人之间用昵称、现代人对长辈用"你"）？若不合，指出原文并说明应改成什么。',
  },
];

export default { meta, rules };
