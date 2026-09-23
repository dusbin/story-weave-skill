#!/usr/bin/env node
/**
 * scripts/sw-rules.mjs — 查看与自检常识规则库。
 *
 * 用法：
 *   node scripts/sw-rules.mjs                 # 统计概览
 *   node scripts/sw-rules.mjs --list          # 列出全部规则
 *   node scripts/sw-rules.mjs --module physics --severity blocker
 *   node scripts/sw-rules.mjs --check         # 结构自检（推荐在改动规则后跑）
 *   node scripts/sw-rules.mjs --json
 */

import { parseArgs, str, bool, unknownErrors } from './_args.mjs';
import { banner, fail, ok, warn, info, runAsScript, c } from './_io.mjs';
import { REGISTRY, loadAllRules, ruleStats, verifyRules, listRules } from '../lib/commonsense/rules/index.mjs';
import { TERMS, renderTermsMd } from '../lib/terms.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误'); }
  if (args.help) { printHelp(); return 0; }

  if (bool(args.terms)) {
    process.stdout.write(renderTermsMd());
    return 0;
  }

  const stats = ruleStats();

  if (bool(args.json)) {
    process.stdout.write(JSON.stringify({
      stats,
      verification: verifyRules(),
      rules: listRules({ module: str(args.module), severity: str(args.severity) }),
    }, null, 2) + '\n');
    return 0;
  }

  banner('常识规则库', `${stats.total} 条规则，来自 ${stats.modules} 个模块`);

  process.stdout.write(`\n  ${c('bold', '按模块')}\n\n`);
  process.stdout.write(`  ${'模块'.padEnd(14)}${'规则数'.padEnd(8)}${'确定性'.padEnd(8)}${'需模型判断'.padEnd(12)}编号范围\n`);
  for (const [key, m] of Object.entries(stats.byModule)) {
    process.stdout.write(`  ${(m.name).padEnd(12)}${String(m.total).padEnd(9)}${String(m.deterministic).padEnd(10)}${String(m.modelJudgment).padEnd(14)}${c('dim', m.idRange)}\n`);
  }
  process.stdout.write(`\n  合计：确定性判定 ${stats.deterministic} 条 / 需模型判断 ${stats.modelJudgment} 条\n`);

  const v = verifyRules();
  process.stdout.write(`\n  ${c('bold', '结构自检')}\n\n`);
  if (v.errors.length) {
    for (const e of v.errors.slice(0, 20)) process.stdout.write(`  ${c('red', '✗')} ${e}\n`);
  }
  if (v.warnings.length) {
    for (const w of v.warnings.slice(0, 12)) process.stdout.write(`  ${c('yellow', '!')} ${w}\n`);
    if (v.warnings.length > 12) process.stdout.write(`  ${c('dim', `…另有 ${v.warnings.length - 12} 条提示`)}\n`);
  }
  if (!v.errors.length && !v.warnings.length) process.stdout.write(`  ${c('green', '✓')} 全部规则结构正常\n`);
  else if (!v.errors.length) process.stdout.write(`  ${c('green', '✓')} 无错误（${v.warnings.length} 条提示）\n`);

  if (bool(args.list)) {
    const list = listRules({ module: str(args.module), severity: str(args.severity) });
    process.stdout.write(`\n  ${c('bold', `规则清单（${list.length} 条）`)}\n\n`);
    for (const r of list) {
      const sev = r.severity === 'blocker' ? c('red', '硬伤') : r.severity === 'major' ? c('yellow', '可疑') : c('dim', '留意');
      const kind = r.kind === '确定性' ? c('green', r.kind) : c('blue', r.kind);
      process.stdout.write(`  ${r.id.padEnd(9)}${sev.padEnd(6)} ${kind.padEnd(14)} ${r.title}\n`);
      process.stdout.write(`  ${' '.repeat(9)}${c('dim', `${r.category}｜tiers: ${r.tiers.join('+')}｜可被设定覆盖: ${r.overridable ? '是' : '否'}`)}\n`);
    }
  }

  process.stdout.write(`\n  ${c('dim', '术语表：sw-rules --terms')}\n`);
  process.stdout.write(`  ${c('dim', '只看某个模块：--module physics --list；只看到硬伤：--severity blocker --list')}\n\n`);

  ok('规则库自检完成');
  process.stdout.write('\n');
  return v.errors.length ? 1 : 0;
}

function printHelp() {
  process.stdout.write(`
sw-rules — 查看与自检常识规则库

用法
  sw-rules                     统计概览 + 结构自检
  sw-rules --list              列出全部规则
  sw-rules --module physics    只看某个模块
  sw-rules --severity blocker  只看某个严重度
  sw-rules --json              以 JSON 输出（供程序使用）
  sw-rules --terms             打印术语表
  --help                       显示本帮助

模块
  physics     物理与自然   biology     生理与医学   timeline    时间线
  geography   空间与行程   society     社会与制度   artifact    器物与时代
  language    称谓与用语   consistency 前后一致性   craft       叙事逻辑

结构自检会抓
  id 重复、前缀不符、缺 title/why/fix、severity 非法、未声明 overridable、
  tiers 为空、同时有 check 与 ask、既无 check 也无 ask（此类规则永远不会产出结果）
`);
}

runAsScript(import.meta.url, main);
