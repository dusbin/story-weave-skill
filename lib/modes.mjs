/**
 * lib/modes.mjs — 六种演绎模式：适配度评分、写作骨架、不变量、修改点提案。纯函数。
 *
 * ## 每种模式都必须回答三个问题
 *
 *   1. **适不适合**（fit）：这篇原文适合用这种模式演绎吗？给分数 + 理由（可解释，不是玄学）
 *   2. **怎么落地**（skeleton）：一节一节写什么（beats），且节数与用户选的篇幅一致
 *   3. **不能动什么**（invariants）：演绎的硬边界——原文已发生的事实不得改写
 *
 * 第三步的写作严格按 plan 的 beats 走，每条 beat 都要能被常识校验回查到。
 *
 * ## 关于「不变量」
 *
 * 这是本技能与"随便让模型编一段"的根本区别：
 * 原文写死了「哥哥十五岁离开家」「手术持续六个小时」，演绎可以补写这中间发生了什么，
 * 但**不能改成"哥哥十八岁离开家"**。不变量会被写进 plan.constraints，
 * 并在第三步逐条对照正文检查。
 */

import { normScore } from './schema.mjs';
import { MODES } from './schema.mjs';

/* ------------------------------------------------------------------ 规模档位 */

export const SCALE_KEYS = ['flash', 'short', 'long'];

export const SCALE = {
  flash: { key: 'flash', label: '短篇', sections: 4, targetChars: 3000, desc: '4 节，约 3000 字。一个场景、一条因果链，收得干净。' },
  short: { key: 'short', label: '中篇', sections: 8, targetChars: 8000, desc: '8 节，约 8000 字。可容纳两条线、一次转折、一次代价。' },
  long: { key: 'long', label: '长篇节选', sections: 16, targetChars: 20000, desc: '16 节，约 20000 字。多线交织、多次升级，需保持设定一致。' },
};

/* ------------------------------------------------------------------ 通用不变量 */

/** 所有模式共有的硬边界 */
const COMMON_INVARIANTS = [
  '原文已明确写出的事实（时间、地点、人物身份、已发生的死亡/伤势/婚姻等）不得改写，只能补充其成因或后果。',
  '原文人物已表现出的性格倾向不得无铺垫地反转；若要反转，必须在演绎中写出驱动事件。',
  '不得引入"恰好解决一切"的巧合；关键转折必须有因果链。',
  '不得让角色知道他不可能知道的信息（信息来源必须交代）。',
];

/* ------------------------------------------------------------------ 六模式 */

export const EXPAND = {
  key: 'expand',
  label: '扩写',
  short: '把梗概/片段展开为完整叙事',
  what: '原文是一个片段、梗概或场景骨架。扩写=在不改变既有事实与结局的前提下，把省略的场景、动作、对话、心理与感官细节补足，让它成为可独立阅读的完整叙事。',
  howHard: '难度中。风险是"注水"（只加形容词不推进）与"偷改事实"（顺手把结局改了）。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    let score = 0.4;
    const chars = an.source?.chars ?? 0;
    const gaps = an.gaps ?? [];

    if (chars < 1200) { score += 0.25; reasons.push(`原文仅 ${chars} 字，属于片段/梗概规模，有充分的展开空间`); }
    else if (chars < 3500) { score += 0.15; reasons.push(`原文 ${chars} 字，属于短篇骨架，可扩为完整叙事`); }
    else { score -= 0.15; cautions.push(`原文已有 ${chars} 字，本身较完整，扩写容易变成注水`); }

    const detailGaps = gaps.filter((g) => ['process', 'detail', 'motive'].includes(g.kind)).length;
    if (detailGaps >= 1) { score += 0.1 * Math.min(2, detailGaps); reasons.push(`识别到 ${detailGaps} 处"省略的过程/缺失的细节/未交代的动机"，正是扩写该填的地方`); }

    // 原文越不完整，扩写越是对症的手段
    const completeness = an.textType?.completeness ?? 0.5;
    if (completeness < 0.5) { score += 0.15; reasons.push(`原文叙事完整度仅 ${completeness}（句子少、无对话、人物未展开），扩写是对症的展开手段`); }

    if (an.narrative?.dialogueRatio !== undefined && an.narrative.dialogueRatio < 0.15) {
      score += 0.1; reasons.push('原文几乎没有对话，扩写可通过对话还原人物');
    }
    if ((an.elements?.characters ?? []).length >= 2) { score += 0.05; reasons.push(`原文已出现 ${an.elements.characters.length} 个可展开的人物`); }

    return { score: normScore(score), reasons, cautions };
  },

  invariants: [...COMMON_INVARIANTS, '原文的结尾状态（谁在哪里、发生了什么事）必须保持不变；扩写只填中间的空白。'],

  skeleton(ctx) {
    const p = ctx.protagonist;
    const place = ctx.place;
    return [
      { title: '落地：把原文的第一句展开成场景', purpose: '让读者"站在现场"', guidance: `从原文起点写起，补足时间、地点、天气、身体感受。若原文首句是「${ctx.firstQuote}」，就以它为锚，向前后各展开，但不得改变其含义。` },
      { title: `${p}的处境与想要的东西`, purpose: '建立人物目标', guidance: `写出${p}此刻的处境、手头的困难、他/她真正想要的是什么。用行动与对话体现，不要直接陈述。` },
      { title: '第一个阻碍', purpose: '引入冲突', guidance: '让目标受挫。阻碍要来自已有人物或已立设定，不要凭空新增外力。' },
      { title: '代价浮现', purpose: '提高筹码', guidance: '让继续推进必须付出代价（时间/关系/健康/名声），并让角色意识到这个代价。' },
      { title: '转折：信息或立场改变', purpose: '推动情节', guidance: '通过一个新信息或一次选择改变局面。信息来源必须交代清楚。' },
      { title: '临界时刻', purpose: '情绪与情节的峰值', essential: true, guidance: '角色必须在两个都不好的选项里选一个。写清他为什么选这个。' },
      { title: '收束回到原文的结尾状态', purpose: '闭合因果', guidance: `演绎必须落在原文已有的终点上${ctx.lastQuote ? `（「${ctx.lastQuote}」）` : ''}。最后一段收在原文那个画面上，读者能看出"原来是这么走到这一步的"。` },
    ];
  },

  guide: '以原文为骨架填充血肉：每一节都要推进（状态发生变化），不能只堆描写。原文没有的细节可以补，原文写死的事实不能改。',

  proposeChanges(an) {
    const out = [];
    const chars = an.elements?.characters ?? [];
    if (chars.length) {
      out.push({
        kind: '承接', target: `人物：${chars.map((c) => c.name).join('、')}`,
        from: '原文只给了名字/称谓与零散动作', to: '补足外貌、说话方式、当下的处境与目标',
        reason: '扩写需要人物立体，但必须与原文已表现的性格一致', risk: 'low',
      });
    }
    if ((an.narrative?.dialogueRatio ?? 0) < 0.15) {
      out.push({
        kind: '新增', target: '对话',
        from: '原文几乎无对话', to: '在冲突与转折处加入对话，还原人物关系',
        reason: '对话是扩写最自然的增效手段', risk: 'low',
      });
    }
    const detailGaps = (an.gaps ?? []).filter((g) => g.kind === 'process' || g.kind === 'detail');
    for (const g of detailGaps.slice(0, 3)) {
      out.push({
        kind: '新增', target: `补写：${g.description}`,
        from: '原文省略', to: '展开为具体场景（1 节）',
        reason: g.whyWeavable ?? '这是原文明确省略的部分', risk: 'low',
      });
    }
    return out;
  },
};

export const CONTINUE = {
  key: 'continue',
  label: '续写',
  short: '从原文结尾之后接着写',
  what: '原文已经讲完一段故事、留下一个状态或一个悬念。续写=从这里往后推演：直接后果、人物反应、新的阻碍与最终的落点。',
  howHard: '难度中偏高。风险是"为了精彩而违背人物"和"把悬念解得太平庸"。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    let score = 0.35;
    const last = an.meta?.lastSegment ?? '';
    const endingGaps = (an.gaps ?? []).filter((g) => g.kind === 'ending').length;

    if (endingGaps) { score += 0.25; reasons.push('原文的结局处于未收束状态，续写有明确切入点'); }
    if (/[？?…]$/.test(last)) { score += 0.2; reasons.push('原文以疑问/省略收尾，天然留有续写钩子'); }
    if ((an.elements?.timeline?.count ?? 0) > 0) { score += 0.1; reasons.push('原文有时间线信息，后续推演可锚定时间'); }
    if ((an.facts ?? []).some((f) => f.immutable)) { score += 0.1; reasons.push('原文存在不可改写的强事实，续写可在其上建立后果'); }
    const chars = an.elements?.characters ?? [];
    if (chars.length === 0) { cautions.push('未能从原文抽取出人物，续写前需人工确认人物是谁'); score -= 0.1; }
    if ((an.source?.chars ?? 0) < 200) { cautions.push('原文过短，续写等于另起炉灶，建议先扩写'); score -= 0.15; }
    if (an.genre?.conflict) { cautions.push('原文含架空内核，续写必须遵守已立设定（见 constraints）'); }

    return { score: normScore(score), reasons, cautions };
  },

  invariants: [...COMMON_INVARIANTS, '原文结尾的状态是续写的起点，不得回退或重写；续写中出现的新事实不得与原文冲突。'],

  skeleton(ctx) {
    return [
      { title: '紧接原文最后一句', purpose: '无缝承接', guidance: `从「${ctx.lastQuote}」之后立刻开始，不要重新交代背景。第一段就要让读者感到故事在继续。` },
      { title: '直接后果', purpose: '兑现原文埋下的因果', guidance: '原文结尾那件事的即时后果（身体上的、关系上的、现实层面的）。' },
      { title: '人物反应与代价', purpose: '写人', guidance: `${ctx.protagonist}对后果的反应必须符合原文已表现的性格；反应之后要付出代价。` },
      { title: '新的阻碍', purpose: '制造张力', guidance: '阻碍应源于原文已有的设定或人物关系，不引入无来由的新敌人。' },
      { title: '中段转折', purpose: '改变方向', guidance: '让角色发现自己的判断有误，或发现了新的信息。' },
      { title: '逼近终局', purpose: '收紧', guidance: '所有线索向一个不可避免的选择汇聚。' },
      { title: '选择与后果', purpose: '兑现主题', essential: true, guidance: '角色做出选择并承担后果——不一定要好结局，但必须是他自己的选择导致。' },
      { title: '落点', purpose: '收束', guidance: '最后一节回到一个具体画面或动作上，不要用总结性议论收尾。' },
    ];
  },

  guide: '把原文当作"已经发生的历史"，续写是它的合理延伸。人物性格、世界规则、已付出的代价都要延续，不允许为了戏剧性而推翻。',

  proposeChanges(an) {
    return [
      {
        kind: '新增', target: '后续情节线', from: '原文止于当前状态', to: '推演 3–5 个因果链明确的后续事件',
        reason: '续写的核心', risk: 'medium',
      },
      {
        kind: '承接', target: `人物：${(an.elements?.characters ?? []).map((c) => c.name).join('、') || '（需人工确认）'}`,
        from: '原文给出的性格与处境', to: '延续其性格弧线，可让其成长但不突然反转',
        reason: '人物一致性是续写最容易被读者抓错的地方', risk: 'medium',
      },
    ];
  },
};

export const PREQUEL = {
  key: 'prequel',
  label: '前传',
  short: '补出导致原文情节的成因',
  what: '原文呈现的是"结果"。前传=回溯到更早，写出为什么会变成这样：某个选择、某次失去、某个隐瞒。它必须能"推出"原文。',
  howHard: '难度高。硬要求：前传的终点必须与原文的起点严丝合缝地对上，否则读者会觉得"接不上"。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    let score = 0.3;
    const backstory = (an.gaps ?? []).filter((g) => g.kind === 'backstory' || g.kind === 'motive').length;
    if (backstory) { score += 0.25; reasons.push(`识别到 ${backstory} 处"未展开的过往/未交代的动机"，正是前传要回答的`); }
    if ((an.facts ?? []).some((f) => f.immutable)) { score += 0.15; reasons.push('原文有明确的"结果性事实"（死亡/伤病/婚姻等），可倒推成因'); }
    const hasRetro = (an.elements?.timeline?.events ?? []).some((e) => e.subkind === 'relative' && /前|当年|从前|小时候/.test(e.when || ''));
    if (hasRetro) { score += 0.2; reasons.push('原文已出现回溯性时间标记（多年前/当年/小时候），提供了前传的入口'); }
    if ((an.source?.chars ?? 0) > 3000) { cautions.push('原文较长，前传容易与原文重复，建议聚焦一条因果链'); score -= 0.1; }
    if (!(an.elements?.characters ?? []).length) { cautions.push('未抽取出人物，前传缺少承载者'); score -= 0.15; }

    return { score: normScore(score), reasons, cautions };
  },

  invariants: [
    ...COMMON_INVARIANTS,
    // 注意：这里是**注进 plan.constraints 的运行时文本**，会给每一次前传演绎看，
    // 因此不能带任何样例专属的人名/年龄（早先写死了"哥哥十五岁离开家"，
    // 结果给一首古诗做前传时，硬约束表里冒出一句与本文毫不相干的示例）。
    '前传的终点必须能推出原文的起点：前传收笔时的局面，必须正好是原文起笔时已经存在的那个局面。',
    '前传不得解释掉原文的所有留白——保留至少一处神秘感，否则原文会失去余味。',
  ],

  skeleton(ctx) {
    return [
      { title: '更早的常态', purpose: '建立对照', guidance: '写出"还没变成这样"时的日常。这一段越平静，后面的改变越有力。' },
      { title: '裂缝', purpose: '埋下成因', guidance: '一个小的异常、一句被忽略的话、一次误会。它当时看起来不重要。' },
      { title: '第一次选择', purpose: '启动因果', guidance: `${ctx.protagonist}做了一个当时看来合理的选择，这个选择决定了后面的一切。` },
      { title: '代价累积', purpose: '让局面恶化', guidance: '选择的后果一层层显现，人物开始补救，但补救又带来新的问题。' },
      { title: '无法回头的一刻', purpose: '不可逆', essential: true, guidance: '发生一件事，使事情再也无法回到从前。这一步必须与原文的某个结果对应。' },
      { title: '接上原文开头', purpose: '闭环', guidance: `最后一节必须严丝合缝地接上原文第一句（「${ctx.firstQuote}」）。写完后自我检查：读者读完前传再读原文，会觉得"原来如此"。` },
    ];
  },

  guide: '前传的成败取决于"接得上"。先确定原文的哪些事实是终点，再倒推每一步的动机。每一节都要问：这一步是让终点不可避免，还是只是热闹？',

  proposeChanges(an) {
    return [
      {
        kind: '新增', target: '前史事件链', from: '原文只给出结果', to: '补出 3–4 个导致该结果的关键事件',
        reason: '前传的骨架', risk: 'medium',
      },
      {
        kind: '新增', target: '人物前史动机', from: '原文未交代人物为何如此', to: '给出一段可解释其行为模式的过往经历',
        reason: '动机是前传真正要回答的东西', risk: 'medium',
      },
      {
        kind: '承接', target: '原文的留白', from: '原文刻意未解释的部分', to: '只解释其中一部分，保留至少一处不解释',
        reason: '全部揭开会让原文失去张力', risk: 'low',
      },
    ];
  },
};

export const ADAPT = {
  key: 'adapt',
  label: '改编',
  short: '保留内核、替换外壳（视角/时代/结局/体裁）',
  what: '保留原文的主题、人物弧线与核心冲突，替换外壳：换叙述视角、换时代背景、换结局、换体裁。改编把"改什么、留什么"变成一张明账。',
  howHard: '难度中。风险是"改着改着内核也丢了"，或换了时代却留着原来的时代细节（春秋时代出现手机）。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    // 基线刻意压低：「改编」是重干预（换外壳要重建整套器物/称谓/制度），
    // 不该仅凭"有冲突"就默认胜出、把更轻的扩写/续写挤下去。
    let score = 0.35;
    if ((an.conflicts ?? []).length) { score += 0.15; reasons.push(`原文有明确的冲突（${an.conflicts.map((c) => c.type).join('、')}），可跨时代移植`); }
    if (an.genre?.tier === 'realistic') { score += 0.1; reasons.push('现实向文本适合换时代/换视角改编'); }
    const chars = an.elements?.characters ?? [];
    if (chars.length >= 2) { score += 0.1; reasons.push('人物关系清晰，适合换视角重述'); }
    if ((an.facts ?? []).filter((f) => f.immutable).length >= 2) {
      cautions.push('原文含较多不可改写的强事实，若改编要改结局，必须明确标注为"改写"而非"承接"');
    }
    if ((an.world?.rules ?? []).length > 0) { cautions.push('原文有世界设定，改编换时代后设定需一并重建'); }
    return { score: normScore(score), reasons, cautions };
  },

  invariants: [
    ...COMMON_INVARIANTS,
    '改编必须明确列出"保留项"与"替换项"。替换项之外的一切，按不变量处理。',
    '换时代后，器物、称谓、制度、货币必须整体对齐新年代，不得残留原时代细节。',
  ],

  skeleton(ctx) {
    return [
      { title: '新外壳下的开场', purpose: '确立替换后的世界', guidance: `把原文的开场移植到新设定中。${ctx.adaptAxis ? `本次替换轴：${ctx.adaptAxis}。` : ''}器物、称谓、环境全部对齐新外壳。` },
      { title: '内核显现', purpose: '让读者认出这是同一个故事', guidance: '把原文的核心冲突（"想要却得不到""必须牺牲一样"）用新外壳的语言重新演一遍。' },
      { title: '外壳带来的新意', purpose: '体现改编的价值', guidance: '新视角/新时代会改变某些因果——把它写出来，这正是改编比复制有意思的地方。' },
      { title: '转折点的重演', purpose: '锚定内核', guidance: '原文的转折在新外壳下如何发生？若换视角，写"另一个人的转折"。' },
      { title: '代价与选择', purpose: '保留内核重量', essential: true, guidance: '原文的选择及其代价必须保留，这是内核的本体。' },
      { title: '新结局（若用户选择改结局）', purpose: '完成替换', guidance: '若结局改写：新结局必须由新外壳下的因果推出，而不是"作者希望它这样"。若不改结局：收在原文的落点上。' },
    ];
  },

  guide: '改编的纪律是"明账"：改什么、留什么，在 plan 里逐条写清，正文里严格执行。最忌糊里糊涂改了一半。',

  proposeChanges(an) {
    return [
      {
        kind: '改动', target: '叙述视角', from: `原文为${an.narrative?.personLabel ?? '第三人称'}`, to: '可改为另一人物视角（需用户选）',
        reason: '换视角是改编最见效的一刀', risk: 'medium',
      },
      {
        kind: '改动', target: '时代背景', from: `原文年代：${an.world?.era?.label ?? '未指明'}`, to: '可迁移到另一时代（需用户选）',
        reason: '换时代会带动器物/称谓/制度的整体重写', risk: 'high',
      },
      {
        kind: '保留', target: '核心冲突与主题', from: `${(an.conflicts ?? []).map((c) => c.type).join('、') || '原文冲突'}`, to: '保持不变',
        reason: '这是"内核"，改了就不是改编而是另写', risk: 'low',
      },
    ];
  },
};

export const SPINOFF = {
  key: 'spinoff',
  label: '番外',
  short: '支线人物或平行日常的独立小故事',
  what: '原文主线之外，某个配角、某段关系、某个未被展开的日常。番外自成一体，读者不看主线也读得懂，但老读者能认出熟人。',
  howHard: '难度低。风险是"没有冲突变成流水账"，或"番外反过来改了主线事实"。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    let score = 0.35;
    const chars = an.elements?.characters ?? [];
    // 【坑】必须排除主角本人：主角"出现次数少"是原文短，不是他被冷落。
    // 之前把主角当成"未充分展开的人物"推举为番外主角，是自相矛盾的推荐。
    const minor = chars.filter((c) => !c.isTop && (c.mentions <= 2 || c.role === 'supporting?' || c.role === 'unknown' || c.role === 'family?'));
    if (minor.length) { score += 0.25; reasons.push(`有 ${minor.length} 个未充分展开的配角（${minor.slice(0, 3).map((c) => c.name).join('、')}），适合做番外主角`); }
    else { score -= 0.1; cautions.push('原文没有戏份不足的配角可供担纲番外，写番外等于新造人物'); }
    if (an.genre?.tier === 'realistic') { score += 0.1; reasons.push('现实向文本适合写日常向番外'); }
    if ((an.conflicts ?? []).length && (an.conflicts[0].strength ?? 0) <= 2) { score += 0.1; reasons.push('原文冲突强度适中，番外可写冲突之外的一面'); }
    const kinship = chars.filter((c) => (c.kinds ?? []).includes('kinship'));
    if (kinship.length >= 2) { score += 0.15; reasons.push('原文存在亲属关系，适合写家庭日常番外'); }
    if (chars.length < 2) { cautions.push('未抽取出两个以上人物，番外缺少可写的关系'); score -= 0.2; }
    if ((an.facts ?? []).filter((f) => f.immutable && (f.kind === 'death' || f.kind === 'injury')).length) {
      cautions.push('原文存在死亡/重伤等强事实：写"平行日常"番外时须明确这是平行时空，否则会与主线冲突');
    }
    return { score: normScore(score), reasons, cautions };
  },

  invariants: [
    ...COMMON_INVARIANTS,
    '番外不得改变主线已发生的事实；若写平行时空，必须在开头或结尾明确标示。',
    '番外必须自足：不看主线也读得懂，冲突与解决都在番外内部完成。',
  ],

  skeleton(ctx) {
    return [
      { title: '小切口', purpose: '建立独立情境', guidance: `从一个具体的小事开场（一顿饭、一次等待、一件物品）。不必重新交代主线背景，用一两句带过即可。` },
      { title: '这个人物的日常', purpose: '立人物', guidance: `以${ctx.spinoffCharacter ?? '配角'}为主视角，写出他/她独自面对的生活质地。` },
      { title: '一个小冲突', purpose: '避免流水账', essential: true, guidance: '冲突要小但真实（面子、习惯、说不出口的话），不要动用主线级别的大事件。' },
      { title: '余味', purpose: '收束', guidance: '不追求戏剧性解决，收在事情"就这样过去了"的那一刻，但读者心里留下点什么。' },
    ];
  },

  guide: '番外写的是"生活"，不是"事件"。力量来自细节与关系的质地，而不是情节强度。绝不要为了好看而让配角做出与其设定不符的事。',

  proposeChanges(an) {
    const chars = an.elements?.characters ?? [];
    const minor = chars.filter((c) => !c.isTop && (c.mentions <= 2 || c.role === 'supporting?' || c.role === 'family?'));
    return [
      {
        kind: '新增', target: `番外主角：${minor[0]?.name ?? '（需人工指定）'}`,
        from: '原文中戏份很少', to: '作为番外主视角，补足其处境与心事',
        reason: '番外的价值在于照亮主线没照到的地方', risk: 'low',
      },
      {
        kind: '新增', target: '独立小事件', from: '原文未涉及', to: '一件与主线无关但与本人物相关的小事',
        reason: '番外必须自足', risk: 'low',
      },
      {
        kind: '承接', target: '主线事实', from: '原文已确立的世界与人际关系', to: '保持不变，仅作为背景',
        reason: '番外不得反噬主线', risk: 'low',
      },
    ];
  },
};

export const WHATIF = {
  key: 'whatif',
  label: '多线推演',
  short: '一个变量取不同值，推演出多条分支',
  what: '在原文里找到那个"关键分叉点"（一个选择、一次错过、一句话），让这个变量取不同值，推演出两条或更多分支，每条都自洽，最后并置对比。',
  howHard: '难度高。每条分支都必须与分叉点之前的原文完全一致，且分支内部不能自相矛盾。',

  fit(an) {
    const reasons = [];
    const cautions = [];
    let score = 0.3;
    const conflicts = an.conflicts ?? [];
    if (conflicts.length) { score += 0.2; reasons.push(`原文存在明确冲突（${conflicts.map((c) => c.type).join('、')}），其中通常含可作分叉点的抉择`); }
    const decisionish = (an.elements?.timeline?.events ?? []).length;
    if (decisionish >= 2) { score += 0.15; reasons.push(`原文有 ${decisionish} 个时间/事件锚点，便于定位分叉点`); }
    const motiveGaps = (an.gaps ?? []).filter((g) => g.kind === 'motive').length;
    if (motiveGaps) { score += 0.15; reasons.push('存在未交代的动机，说明原文某处正是"人做了选择"的地方，适合做分叉点'); }
    if ((an.facts ?? []).filter((f) => f.immutable).length >= 2) {
      score += 0.1; reasons.push('原文有多个强事实（死亡/婚姻等），分支之间的反差会很明显');
    }
    if (an.genre?.tier === 'speculative' && (an.world?.rules ?? []).length === 0) {
      cautions.push('架空文本但未抽到世界设定，推演前需人工补充"力量边界"，否则分支容易前后矛盾');
      score -= 0.1;
    }
    cautions.push('多线推演篇幅需求最大：每条分支都需完整因果链，建议选"中篇"以上篇幅，且分支数不超过 3。');
    return { score: normScore(score), reasons, cautions };
  },

  invariants: [
    ...COMMON_INVARIANTS,
    '所有分支在分叉点之前必须与原文完全一致：原文写到哪个时刻，分支就从哪个时刻之后开始分。',
    '分支之间的差异必须**只**来自那一个变量；不得偷偷改第二个条件（否则推演失去意义）。',
    '每条分支内部必须自洽，且遵守原文已立规则。',
  ],

  skeleton(ctx) {
    return [
      { title: '分叉点：原文的那一刻', purpose: '锚定共同起点', guidance: `重述原文到分叉点为止已发生的事，一字不改地确立共同起点。明确点出：接下来唯一变化的是「${ctx.branchVariable ?? '（需人工指定变量）'}」。` },
      { title: '分支一：变量取原值', purpose: '确立基线', guidance: '按原文实际走向写这条分支，作为对照基线。' },
      { title: '分支一：后果链', purpose: '推到终点', guidance: '由原值出发，一步步推出后果，不跳跃。' },
      { title: '分叉点重演：变量取新值', purpose: '唯一变量生效', essential: true, guidance: '回到分叉点，只改那一个变量。**这一步必须让读者清楚看到"只改了这个"**。' },
      { title: '分支二：后果链', purpose: '推到终点', guidance: '由新值出发，一步步推出不同的后果。与分支一形成对照。' },
      { title: '两条分支并置', purpose: '收束对比', guidance: '并置两条分支的关键画面，让差异自己说话。不要用议论强行总结主题。' },
    ];
  },

  guide: '多线推演的可信度全靠"只改一个变量"。写作时反复自查：这个差异真的只是那一个变量造成的吗？还是我偷偷改了两个条件？',

  proposeChanges(an) {
    return [
      {
        kind: '新增', target: '分叉点', from: '原文中一个关键抉择/错过', to: '明确定位为分叉点（需用户确认）',
        reason: '分叉点选错，推演就没有意义', risk: 'high',
      },
      {
        kind: '新增', target: '分支数', from: '原文只有一条线', to: '2 条（推荐）或 3 条分支',
        reason: '分支过多会让每条都写不透', risk: 'medium',
      },
      {
        kind: '保留', target: '分叉点之前的全部原文事实', from: '原文', to: '完全保留，作为共同起点',
        reason: '这是多线推演的逻辑基础', risk: 'low',
      },
    ];
  },
};

/* ------------------------------------------------------------------ 注册表 */

export const MODE_DEFS = [EXPAND, CONTINUE, PREQUEL, ADAPT, SPINOFF, WHATIF];
export const MODE_BY_KEY = Object.fromEntries(MODE_DEFS.map((m) => [m.key, m]));

/** 与 schema.MODES 一致性自检用 */
export function assertModeParity() {
  const a = Object.keys(MODES).sort();
  const b = MODE_DEFS.map((m) => m.key).sort();
  if (a.join() !== b.join()) {
    throw new Error(`模式表不一致：schema=${a.join()} modes=${b.join()}`);
  }
  return true;
}

/**
 * 对六种模式全部评分并排序。
 * @returns {Array<{mode,label,score,reasons,cautions}>}
 */
export function scoreAllModes(an) {
  return MODE_DEFS.map((m) => {
    let fit;
    try {
      fit = m.fit(an);
    } catch (err) {
      fit = { score: 0, reasons: [], cautions: [`适配度评估失败：${err?.message ?? err}`] };
    }
    return {
      mode: m.key,
      label: m.label,
      short: m.short,
      score: fit.score,
      reasons: fit.reasons,
      cautions: fit.cautions,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 生成写作骨架。
 * @param {string} mode
 * @param {object} ctx { protagonist, place, firstQuote, lastQuote, spinoffCharacter, adaptAxis, branchVariable, sections }
 * @returns {Array<{index, title, purpose, guidance, branch?}>}
 */
export function buildBeats(mode, ctx = {}) {
  const def = MODE_BY_KEY[mode];
  if (!def) throw new Error(`未知演绎模式：${mode}`);
  const target = Number(ctx.sections) || 8;
  const base = def.skeleton(ctx);

  // 把模板节拍铺到目标节数：模板短于目标就细化（按 purpose 分拆），长于目标就合并
  const beats = fitBeatCount(base, target, ctx, mode);
  return beats.map((b, i) => ({ index: i + 1, ...b }));
}

/**
 * 把模板节拍适配到目标节数。
 * 短篇：合并（保留首尾，中间按比例合并）
 * 长篇：细化（在"代价/转折/升级"类节点后追加细化节拍）
 */
function fitBeatCount(base, target, ctx, mode) {
  if (base.length === target) return base.map(clone);

  if (base.length > target) {
    // 首尾必留；**标记 essential 的结构支点也必须留**；剩下的名额才按等距抽样。
    // 【坑】早先是无差别等距抽样，于是「前传」缩到 4 节时，
    // 支点「无法回头的一刻」被静默丢掉——而前传的成立恰恰靠那一步的不可逆。
    const head = base[0];
    const tail = base[base.length - 1];
    const middle = base.slice(1, -1);

    const essentials = middle.filter((b) => b.essential);
    const rest = middle.filter((b) => !b.essential);
    const slots = Math.max(0, target - 2 - essentials.length);

    const picked = [];
    for (let i = 0; i < slots; i++) {
      const idx = Math.floor((i * rest.length) / slots);
      picked.push(rest[Math.min(idx, rest.length - 1)]);
    }
    const chosen = new Set([head, tail, ...essentials, ...picked]);
    return base.filter((b) => chosen.has(b)).map(clone);
  }

  // 需要更多节：按序细化为"前半/后半"两拍，再循环补充
  const out = base.map(clone);
  const fillers = [
    { title: '细节：环境与身体感受', purpose: '增加质感', guidance: '写一段不推进情节但让人物立起来的细节：气味、温度、手上的动作、一处旧伤。' },
    { title: '细节：一段对话', purpose: '通过对话透露信息', guidance: '用对话交代一个只能这样说出口的信息，注意双方地位与说话习惯。' },
    { title: '细节：一个次要人物', purpose: '丰富世界', guidance: '让一个次要人物带来一个外部视角，但不能由他解决主线问题。' },
    { title: '细节：一次小挫败', purpose: '维持张力', guidance: '加一次小的挫败让进程不那么顺，挫败原因必须来自已立设定。' },
  ];
  let fi = 0;
  // 在中间位置插入，避免破坏首尾的强收束
  while (out.length < target) {
    const pos = Math.max(1, out.length - 2);
    out.splice(pos, 0, clone(fillers[fi % fillers.length]));
    fi++;
  }
  return out;
}

function clone(b) {
  return { title: b.title, purpose: b.purpose, guidance: b.guidance, branch: b.branch, essential: b.essential };
}

/** 模式的"难度与风险"提示，写进报告让用户有预期 */
export function modeRisk(mode) {
  return MODE_BY_KEY[mode]?.howHard ?? '';
}

/** 模式必须人工指定的参数（缺了就无法生成合理骨架） */
export function requiredInputs(mode) {
  const base = ['篇幅（短篇/中篇/长篇节选）', '结局倾向（维持原结局 / 改写结局 / 开放式）'];
  if (mode === 'adapt') return [...base, '替换轴（换视角 / 换时代 / 换结局 / 换体裁，可多选）'];
  if (mode === 'whatif') return [...base, '分叉点（原文中的哪一刻）', '变量（哪一件事取不同值）', '分支数（2 或 3）'];
  if (mode === 'spinoff') return [...base, '番外主角（主线中的哪个配角）'];
  if (mode === 'prequel') return [...base, '前传的起点时间（比原文早多久）'];
  if (mode === 'continue') return [...base, '续写的时间跨度（紧接着 / 若干年后）'];
  return base;
}

export { MODES, normScore };
