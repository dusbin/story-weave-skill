#!/usr/bin/env node
/**
 * scripts/sw-plan.mjs — 第二步（上）：生成演绎方案，并输出待人工确认的问题卡片。
 *
 * 用法：
 *   node scripts/sw-plan.mjs --out out
 *   node scripts/sw-plan.mjs --mode prequel --scale long --ending maintain --out out
 *   node scripts/sw-plan.mjs --analysis out/analysis.json --spinoff-character 哥哥
 *
 * 产出：<out>/plan.json、<out>/plan.md、<out>/confirm-questions.json
 *
 * ★ 本命令**不会**进入写作。方案初始状态为 pending_confirmation，
 *   必须经 sw-confirm 完成人工确认后才能演绎。
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, str, bool, num, unknownErrors } from './_args.mjs';
import { resolveOutDir, readJsonFile, writeJsonFile, writeTextFile, banner, ok, warn, wrote, info, fail, runAsScript, c } from './_io.mjs';
import { analyzeText } from '../lib/analyze.mjs';
import { buildPlan, buildConfirmationQuestions, summarizePlan } from '../lib/plan.mjs';
import { renderPlanMd } from '../lib/render.mjs';
import { validatePlan, MODE_KEYS } from '../lib/schema.mjs';
import { SCALE } from '../lib/modes.mjs';
import { collectInputText } from './_io.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误', '用 --help 查看支持的参数。'); }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);
  const analysis = loadOrBuildAnalysis(args, outDir);

  const mode = str(args.mode);
  if (mode && !MODE_KEYS.includes(mode)) {
    fail(`--mode 取值非法：${mode}`, `可选：${MODE_KEYS.join(' / ')}`);
  }
  const scale = str(args.scale);
  if (scale && !SCALE[scale]) {
    fail(`--scale 取值非法：${scale}`, `可选：${Object.keys(SCALE).join(' / ')}`);
  }

  const options = {
    scale,
    ending: str(args.ending),
    title: str(args.title),
    tone: str(args.tone),
    audience: str(args.audience),
    adaptAxis: str(args['adapt-axis']),
    branchVariable: str(args['branch-variable']),
    branches: num(args.branches),
    spinoffCharacter: str(args['spinoff-character']),
    sections: num(args.sections),
    targetChars: num(args['target-chars']),
    mainline: str(args.mainline),
    theme: str(args.theme),
    pov: str(args.pov),
  };
  if (options.ending && !['maintain', 'change', 'open'].includes(options.ending)) {
    fail(`--ending 取值非法：${options.ending}`, '可选：maintain（维持原结局）/ change（改写）/ open（开放式）');
  }

  banner('第二步：生成演绎方案', `${analysis.genre?.label ?? ''}｜${analysis.standard?.label ?? ''}`);

  let plan;
  try {
    plan = buildPlan({ analysis, mode, options });
  } catch (err) {
    fail(`生成方案失败：${err.message}`);
  }

  const errs = validatePlan(plan);
  if (errs.length) {
    warn(`方案未通过结构校验（${errs.length} 项）：`);
    for (const e of errs.slice(0, 5)) info(`- ${e}`);
  }

  const jsonPath = writeJsonFile(join(outDir, 'plan.json'), plan);
  const mdPath = writeTextFile(join(outDir, 'plan.md'), renderPlanMd(plan, analysis));

  // 待确认问题卡片：直接就是 ask_user_question 的入参格式
  const questions = buildConfirmationQuestions(plan, analysis);
  const qPath = writeJsonFile(join(outDir, 'confirm-questions.json'), {
    note: '本文件是给 ask_user_question 用的入参：questions 数组可直接传入；selected 字段留空待填，填好后用 sw-confirm --answers 回填。',
    questions,
  });

  process.stdout.write('\n');
  for (const line of summarizePlan(plan).split('\n')) process.stdout.write(`  ${line}\n`);
  process.stdout.write('\n');

  process.stdout.write(`  ${c('bold', '修改点（需逐条确认）')}\n\n`);
  for (const ch of plan.changes.slice(0, 12)) {
    const risk = ch.risk === 'high' ? c('red', '高') : ch.risk === 'medium' ? c('yellow', '中') : c('green', '低');
    process.stdout.write(`  ${ch.id} [${ch.kind}] ${ch.target}  ${c('dim', `风险 ${risk}`)}\n`);
    process.stdout.write(`      ${c('dim', `${ch.from} → ${ch.to}`)}\n`);
  }
  if (plan.changes.length > 12) process.stdout.write(`  …以及另外 ${plan.changes.length - 12} 条，见 plan.md\n`);
  process.stdout.write('\n');

  process.stdout.write(`  ${c('bold', '硬约束（演绎不得违反）')}：${plan.constraints.count} 条\n`);
  for (const k of plan.constraints.mustNotViolate.slice(0, 5)) {
    process.stdout.write(`    ${c('dim', `[${k.source}]`)} ${k.statement.slice(0, 60)}\n`);
  }
  process.stdout.write('\n');

  if (plan.openQuestions?.length) {
    process.stdout.write(`  ${c('yellow', '待确认事项')}：\n`);
    for (const q of plan.openQuestions.slice(0, 6)) process.stdout.write(`    ? ${q.question}\n`);
    process.stdout.write('\n');
  }

  ok(`方案已生成，状态：${plan.status.stateLabel}`);
  wrote(jsonPath);
  wrote(mdPath);
  wrote(qPath);
  process.stdout.write(`\n  ${c('yellow', '⚠ 方案尚未经人工确认，不会进入演绎。')}\n`);
  process.stdout.write(`  ${c('dim', '下一步：把 confirm-questions.json 里的 questions 交给用户勾选，')}\n`);
  process.stdout.write(`  ${c('dim', '        再用 sw-confirm --answers 回填第（二）步的人工确认结果。')}\n\n`);
  return 0;
}

/** 找分析结果：优先 --analysis，其次 <out>/analysis.json，最后用 --text/--in 现算 */
function loadOrBuildAnalysis(args, outDir) {
  const explicit = str(args.analysis);
  if (explicit) return readJsonFile(explicit);

  const guess = join(outDir, 'analysis.json');
  if (existsSync(guess)) return readJsonFile(guess);

  const { text, sources } = collectInputText(args);
  if (text.trim()) {
    warn(`未找到 ${guess}，改为就地分析输入文本`);
    return analyzeText({
      raw: text,
      opts: {
        genreHint: str(args.genre),
        tierOverride: str(args.tier),
        yearHint: str(args.year),
        sourceKind: sources.length ? 'file' : 'text',
        files: sources,
      },
    });
  }

  fail(`找不到分析结果：${guess}`, '请先执行 sw-analyze 生成分析结果，或用 --analysis 指定文件，或直接用 --text/--in 提供原文。');
}

function printHelp() {
  process.stdout.write(`
sw-plan — 第二步（上）：生成演绎方案与待确认问题卡片

用法
  sw-plan [--out out] [选项]

分析结果来源
  --analysis <文件>    指定 analysis.json；缺省用 <out>/analysis.json
  --text / --in        没有分析结果时，可就地分析（等价于先跑 sw-analyze）

方案选项
  --mode <key>         演绎模式：expand 扩写 | continue 续写 | prequel 前传
                       | adapt 改编 | spinoff 番外 | whatif 多线推演（默认用系统推荐）
  --scale <key>        篇幅：flash 短篇(4节) | short 中篇(8节) | long 长篇节选(16节)
  --ending <key>       结局：maintain 维持原结局 | change 改写 | open 开放式
  --sections <n>       自定义节数（覆盖篇幅默认值）
  --target-chars <n>   自定义目标字数
  --title <标题>       指定标题（缺省为占位标题，需人工确认）
  --tone <基调>        指定基调
  --pov <视角>         指定叙述视角
  --adapt-axis <说明>  改编模式：替换轴（换视角/换时代/换结局/换体裁）
  --branch-variable <说明> 多线推演：分叉变量
  --branches <n>       多线推演：分支数（建议 2–3）
  --spinoff-character <人物> 番外模式：番外主角

输出
  --out <目录>         输出目录（默认 out/）
  --help               显示本帮助

产出
  <out>/plan.json              结构化方案（含确认状态机）
  <out>/plan.md                方案报告（含修改点清单与硬约束）
  <out>/confirm-questions.json 待确认问题卡片（ask_user_question 入参格式）
`);
}

runAsScript(import.meta.url, main);
