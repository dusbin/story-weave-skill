#!/usr/bin/env node
/**
 * scripts/sw-analyze.mjs — 第一步：分析输入文本，给出演绎思路与方向。
 *
 * 用法：
 *   node scripts/sw-analyze.mjs --text "原文……" --out out
 *   node scripts/sw-analyze.mjs --in draft.md --out out
 *   node scripts/sw-analyze.mjs --in a.md --in b.txt --genre urban --tier realistic --year 2010
 *
 * 产出：<out>/analysis.json、<out>/analysis.md
 */

import { join } from 'node:path';
import { parseArgs, str, bool, unknownErrors } from './_args.mjs';
import { collectInputText, resolveOutDir, writeJsonFile, writeTextFile, banner, ok, warn, wrote, info, fail, runAsScript } from './_io.mjs';
import { analyzeText } from '../lib/analyze.mjs';
import { renderAnalysisMd } from '../lib/render.mjs';
import { validateAnalysis } from '../lib/schema.mjs';
import { c } from './_io.mjs';

export async function main(argv) {
  const args = parseArgs(argv);

  const unknown = unknownErrors(args);
  if (unknown.length) {
    for (const u of unknown) warn(u);
    fail('命令行参数有误', '用 --help 查看支持的参数。');
  }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);

  // 1) 取输入
  const { text, sources } = collectInputText(args);
  if (!text.trim()) {
    fail('没有输入文本', '请用 --text "原文" 直接给文字，或用 --in 文件.md 指定文件。');
  }

  banner('第一步：分析输入文本', `${sources.length ? `来源：${sources.join('、')}` : '命令行文本'}`);

  const opts = {
    genreHint: str(args.genre),
    tierOverride: str(args.tier),
    yearHint: str(args.year),
    sourceKind: sources.length ? 'file' : 'text',
    files: sources,
  };
  if (opts.tierOverride && !['realistic', 'speculative'].includes(opts.tierOverride)) {
    fail(`--tier 取值必须是 realistic 或 speculative，收到：${opts.tierOverride}`);
  }

  // 2) 分析
  let an;
  try {
    an = analyzeText({ raw: text, opts });
  } catch (err) {
    fail(`分析失败：${err.message}`, '这通常是引擎的问题，请把输入文本一起反馈。');
  }

  const errs = validateAnalysis(an);
  if (errs.length) {
    warn(`分析结果未通过结构校验（${errs.length} 项）——产物仍会写出，但下游可能出错：`);
    for (const e of errs.slice(0, 5)) info(`- ${e}`);
  }

  // 3) 落盘
  const jsonPath = writeJsonFile(join(outDir, 'analysis.json'), an);
  const mdPath = writeTextFile(join(outDir, 'analysis.md'), renderAnalysisMd(an));

  ok(`分析完成：${an.source.chars} 字 / ${an.source.sentences} 句`);
  info(`体裁：${an.genre.label}（${an.genre.confidence}）｜常识标尺：${an.standard.label}`);
  info(`年代：${an.world.era.label}｜人物 ${an.elements.characters.length} 个｜留白点 ${an.gaps.length} 处`);
  if (an.genre.conflict) warn('检测到现实向与架空向信号并存，已按架空标尺处理（现实常识仍作背景约束）');
  wrote(jsonPath);
  wrote(mdPath);

  // 4) 推荐
  process.stdout.write('\n');
  process.stdout.write(`${c('bold', '  演绎思路与方向')}\n\n`);
  process.stdout.write(`  推荐模式：${c('green', an.recommendation.modeLabel)}（适配度 ${an.recommendation.score}）\n`);
  process.stdout.write(`  方向：${an.recommendation.direction}\n`);
  if (an.recommendation.why?.length) {
    process.stdout.write('\n  推荐理由：\n');
    for (const r of an.recommendation.why) process.stdout.write(`    · ${r}\n`);
  }
  if (an.recommendation.cautions?.length) {
    process.stdout.write('\n  需要注意：\n');
    for (const r of an.recommendation.cautions) process.stdout.write(`    ${c('yellow', '⚠')} ${r}\n`);
  }
  process.stdout.write('\n  其它可选模式：');
  process.stdout.write(an.modeFit.slice(1).map((m) => `${m.label}(${m.score})`).join('、') + '\n');
  process.stdout.write(`  篇幅建议：${an.recommendation.scaleSuggest.label} —— ${an.recommendation.scaleSuggest.reason}\n`);

  if (an.missing?.length) {
    process.stdout.write(`\n  ${c('yellow', '需要你确认的信息：')}\n`);
    for (const m of an.missing) process.stdout.write(`    ? ${m.question}\n`);
  }

  process.stdout.write(`\n  ${c('dim', '下一步：sw-plan 生成演绎方案（第二步）')}\n\n`);
  return 0;
}

function printHelp() {
  process.stdout.write(`
sw-analyze — 第一步：分析输入文本，给出演绎思路与方向

用法
  sw-analyze --text "原文……" [选项]
  sw-analyze --in 文件.md [--in 文件2.txt] [选项]

输入（二选一，可同时用）
  --text <文字>        直接把原文写在命令行
  --in <路径>          原文文件；可重复传入多个文件，也可传目录（读取其中 .txt/.md）
                       多个输入会按"【文件名】"分段拼接，便于在报告中定位

识别覆盖（一般不需要手动指定）
  --genre <key>        手动指定体裁（如 urban / xianxia / scifi / crime），跳过自动识别
  --tier <tier>        手动指定常识标尺：realistic（严守现实常识）| speculative（以设定一致性为主）
  --year <年份>        手动指定年代（用于"时代错位"检查）

输出
  --out <目录>         输出目录（默认 out/）
  --help               显示本帮助

产出
  <out>/analysis.json  结构化分析结果（供下游使用）
  <out>/analysis.md    分析报告（给人读：原文有什么、可演绎的接口、推荐方向）
`);
}

runAsScript(import.meta.url, main);
