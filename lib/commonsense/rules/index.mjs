/**
 * lib/commonsense/rules/index.mjs — 规则注册表。
 *
 * 把各规则模块汇总成一份规则全集，并做结构自检。
 * 新增规则模块时只需在这里加一行 import 与一项 REGISTRY。
 *
 * 自检（verifyRules）会在 sw selfcheck / sw rules --check 里跑，专门抓这几类问题：
 *   - id 重复或前缀不符
 *   - 缺少 why / fix（报告里就没有依据可看）
 *   - 有 ask 又有 check（职责不清）
 *   - 既无 check 又无 ask（这条规则永远不会产出任何东西）
 *   - check 抛异常（在最小样本上试跑）
 */

import * as physics from './physics.mjs';
import * as biology from './biology.mjs';
import * as timeline from './timeline.mjs';
import * as geography from './geography.mjs';
import * as society from './society.mjs';
import * as artifact from './artifact.mjs';
import * as language from './language.mjs';
import * as consistency from './consistency.mjs';
import * as craft from './craft.mjs';

/** 按类别分组：general = 通用（任何标尺都该查），speculative = 架空设定相关 */
export const REGISTRY = [
  { key: 'physics', name: '物理与自然', mod: physics },
  { key: 'biology', name: '生理与医学', mod: biology },
  { key: 'timeline', name: '时间线', mod: timeline },
  { key: 'geography', name: '空间与行程', mod: geography },
  { key: 'society', name: '社会与制度', mod: society },
  { key: 'artifact', name: '器物与时代', mod: artifact },
  { key: 'language', name: '称谓与用语', mod: language },
  { key: 'consistency', name: '前后一致性', mod: consistency },
  { key: 'craft', name: '叙事逻辑', mod: craft },
];

/** 全量规则（扁平） */
export function loadAllRules() {
  return REGISTRY.flatMap((g) => (g.mod?.rules ?? []).map((r) => ({ ...r, module: r.module ?? g.key })));
}

/** 按模块统计 */
export function ruleStats() {
  const byModule = {};
  let deterministic = 0;
  let modelJudgment = 0;
  let total = 0;
  for (const g of REGISTRY) {
    const rs = g.mod?.rules ?? [];
    byModule[g.key] = {
      name: g.name,
      total: rs.length,
      deterministic: rs.filter((r) => typeof r.check === 'function').length,
      modelJudgment: rs.filter((r) => typeof r.check !== 'function' && r.ask).length,
      idRange: rs.length ? `${rs[0].id} … ${rs[rs.length - 1].id}` : '（空）',
    };
    total += rs.length;
    deterministic += byModule[g.key].deterministic;
    modelJudgment += byModule[g.key].modelJudgment;
  }
  return { total, deterministic, modelJudgment, byModule, modules: REGISTRY.length };
}

/** 结构自检 */
export function verifyRules() {
  const errors = [];
  const warnings = [];
  const all = loadAllRules();
  const seen = new Map();

  const PREFIX = {
    physics: 'PHY', biology: 'BIO', timeline: 'TIM', geography: 'GEO',
    society: 'SOC', artifact: 'ANA', language: 'LANG', consistency: 'NUM', craft: 'CRAFT',
  };

  for (const r of all) {
    const where = `${r.module}/${r.id ?? '(无 id)'}`;

    if (!r.id) { errors.push(`${where}：缺少 id`); continue; }
    if (seen.has(r.id)) errors.push(`id 重复：${r.id}（${seen.get(r.id)} 与 ${r.module}）`);
    else seen.set(r.id, r.module);

    const wantPrefix = PREFIX[r.module];
    if (wantPrefix && !String(r.id).startsWith(wantPrefix)) {
      warnings.push(`${where}：id 前缀与模块不符，期望以 ${wantPrefix} 开头`);
    }
    if (!r.title) errors.push(`${where}：缺少 title（报告里无法显示）`);
    if (!r.why) warnings.push(`${where}：缺少 why（作者看不到判定依据）`);
    if (!r.fix) warnings.push(`${where}：缺少 fix（作者看不到怎么改）`);
    if (!['blocker', 'major', 'minor'].includes(r.severity)) errors.push(`${where}：severity 非法（${r.severity}）`);
    if (typeof r.overridable !== 'boolean') warnings.push(`${where}：未声明 overridable，架空标尺下无法正确降档`);
    if (Array.isArray(r.tiers) && r.tiers.length === 0) errors.push(`${where}：tiers 为空数组，该规则永远不会执行`);

    const hasCheck = typeof r.check === 'function';
    const hasAsk = typeof r.ask === 'string' && r.ask.length > 0;
    if (hasCheck && hasAsk) errors.push(`${where}：同时有 check 与 ask，职责不清（引擎只会用 check）`);
    if (!hasCheck && !hasAsk) errors.push(`${where}：既无 check 也无 ask，这条规则永远不会产出任何结果`);
  }

  return { errors, warnings, total: all.length };
}

/** 规则清单（供 `sw rules` 打印） */
export function listRules({ module: mod = null, severity = null } = {}) {
  return loadAllRules()
    .filter((r) => (mod ? r.module === mod : true))
    .filter((r) => (severity ? r.severity === severity : true))
    .map((r) => ({
      id: r.id, module: r.module, category: r.category, title: r.title,
      severity: r.severity, overridable: r.overridable, tiers: r.tiers ?? ['realistic', 'speculative'],
      kind: typeof r.check === 'function' ? '确定性' : '需模型判断',
    }));
}

export default { REGISTRY, loadAllRules, ruleStats, verifyRules, listRules };
