#!/usr/bin/env node
/**
 * scripts/sw-check.mjs — 第三步（验收）：常识校验。
 *
 * 用法：
 *   node scripts/sw-check.mjs --out out
 *   node scripts/sw-check.mjs --answers verdicts.json --out out   # 回填模型判断
 *
 * 产出：<out>/check.json、<out>/check.md、<out>/checklist-template.json
 *
 * 退出码：
 *   0 = 通过 / 通过但有待核对项
 *   1 = 未通过（存在硬伤 blocker）
 *   2 = 用法或读取错误
 * 这样可以直接在 CI 或脚本里用 if 判断。
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, str, bool, unknownErrors } from './_args.mjs';
import { resolveOutDir, readJsonFile, writeJsonFile, writeTextFile, banner, ok, warn, wrote, info, fail, runAsScript, c } from './_io.mjs';
import { buildCheckReport } from '../lib/check.mjs';
import { renderCheckMd } from '../lib/render.mjs';
import { loadAllRules, verifyRules, ruleStats } from '../lib/commonsense/rules/index.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误', '用 --help 查看支持的参数。'); }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);

  const storyPath = str(args.story) ?? join(outDir, 'story.json');
  if (!existsSync(storyPath)) fail(`找不到正文文件：${storyPath}`, '请先执行 sw-weave --draft 导入草稿。');
  const story = readJsonFile(storyPath);

  const planPath = str(args.plan) ?? join(outDir, 'plan.json');
  const plan = existsSync(planPath) ? readJsonFile(planPath) : null;

  const analysisPath = str(args.analysis) ?? join(outDir, 'analysis.json');
  const analysis = existsSync(analysisPath) ? readJsonFile(analysisPath) : null;

  // 规则集自检：规则库自身有问题时先说清楚，避免把引擎缺陷当成作品缺陷
  const rv = verifyRules();
  if (rv.errors.length) {
    warn(`规则库自身有 ${rv.errors.length} 项错误（可能影响校验完整性）：`);
    for (const e of rv.errors.slice(0, 5)) info(`- ${e}`);
  }

  const rules = loadAllRules();
  if (!rules.length) fail('规则集为空，无法校验', '请检查 lib/commonsense/rules/ 下的规则模块。');

  // 标尺不一致提醒：方案/分析/正文可能来自不同标尺
  if (plan && analysis && plan.constraints?.standard?.tier && analysis.standard?.tier
      && plan.constraints.standard.tier !== analysis.standard.tier) {
    warn(`标尺不一致：分析为 ${analysis.standard.tier}，方案记录为 ${plan.constraints.standard.tier}（按分析的标尺执行）`);
  }

  banner('第三步（验收）：常识校验', `${story.sections?.length ?? 0} 节 / ${story.chars ?? 0} 字`);

  const stats = ruleStats();
  info(`规则集：${stats.total} 条（确定性 ${stats.deterministic} / 需模型判断 ${stats.modelJudgment}），来自 ${stats.modules} 个模块`);
  info(`常识标尺：${analysis?.standard?.label ?? plan?.constraints?.standard?.label ?? '现实世界常识标尺（默认）'}`);

  let answers = null;
  const af = str(args.answers);
  if (af) {
    answers = readJsonFile(af);
    info(`已读取判断结果：${af}`);
  }

  let report;
  try {
    report = buildCheckReport({ story, analysis, plan, rules, modelAnswers: answers });
  } catch (err) {
    fail(`校验执行失败：${err.message}`, '这通常是引擎问题，请把 story.json 一起反馈。');
  }

  const jsonPath = writeJsonFile(join(outDir, 'check.json'), report);

  // 待判断项的空白模板：方便把"需要模型判断"的部分逐条回答后回填
  const template = {
    note: '把每条 verdict 填成 pass / fail / na 后，用 sw-check --answers 本文件 回填。'
      + 'evidence 是引擎按关键词取的**候选**证据，供判断参考；'
      + '若判 fail，请在 quote 里填上你实际指的那一处原文（可加 line），'
      + '否则结论会挂在候选证据上，作者会以为报告张冠李戴。',
    answers: report.checklist.map((item) => ({
      id: item.id,
      ruleId: item.ruleId,
      category: item.category,
      question: item.question,
      why: item.why,
      evidence: item.evidence,
      verdict: item.verdict ?? '',
      note: item.note ?? '',
      quote: item.citedQuote ?? '',
      line: item.citedLine ?? '',
    })),
  };
  const tPath = writeJsonFile(join(outDir, 'checklist-template.json'), template);

  const mdPath = writeTextFile(join(outDir, 'check.md'), renderCheckMd(report, { analysis, plan, story }));

  // 打印结论
  const s = report.summary;
  process.stdout.write('\n');
  const verdictColor = report.verdict === 'fail' ? 'red' : report.verdict === 'pass' ? 'green' : 'yellow';
  process.stdout.write(`  ${c('bold', '结论')}：${c(verdictColor, report.verdictLabel)}（${report.verdict}）\n`);
  process.stdout.write(`  ${c('dim', report.verdictReason)}\n\n`);
  process.stdout.write(`  常识得分：${s.score} / 100（等第 ${s.grade}）\n`);
  process.stdout.write(`  统计：${c('red', `硬伤 ${s.blockers}`)} · ${c('yellow', `明显可疑 ${s.majors}`)} · 值得留意 ${s.minors}\n`);
  process.stdout.write(`  待判断项：${report.coverage.modelJudgment.items} 条（已答 ${report.coverage.modelJudgment.answered}，未答 ${report.coverage.modelJudgment.unanswered}）\n`);
  process.stdout.write('\n');

  if (report.findings.length) {
    process.stdout.write(`  ${c('bold', '发现的问题')}\n\n`);
    for (const f of report.findings.slice(0, Number(str(args.limit) ?? 15))) {
      const tag = f.severity === 'blocker' ? c('red', '[硬伤]') : f.severity === 'major' ? c('yellow', '[可疑]') : c('dim', '[留意]');
      process.stdout.write(`  ${tag} ${f.category}｜第 ${f.line ?? '?'} 行\n`);
      process.stdout.write(`      原文：${c('dim', f.quote)}\n`);
      process.stdout.write(`      问题：${f.message}\n`);
      if (f.suggestion) process.stdout.write(`      建议：${c('dim', f.suggestion)}\n`);
      process.stdout.write('\n');
    }
    if (report.findings.length > Number(str(args.limit) ?? 15)) {
      process.stdout.write(`  ${c('dim', `…以及另外 ${report.findings.length - Number(str(args.limit) ?? 15)} 条，见 check.md`)}\n\n`);
    }
  } else {
    process.stdout.write(`  ${c('green', '未发现可计算的常识硬伤。')}\n\n`);
  }

  const unanswered = report.checklist.filter((x) => !x.verdict);
  if (unanswered.length) {
    process.stdout.write(`  ${c('yellow', `还有 ${unanswered.length} 条需理解语义才能判定的问题未回答：`)}\n`);
    for (const u of unanswered.slice(0, 5)) process.stdout.write(`    ? [${u.category}] ${u.question.slice(0, 60)}\n`);
    if (unanswered.length > 5) process.stdout.write(`    ${c('dim', '…')}\n`);
    process.stdout.write(`\n  ${c('dim', `模板已写出：${tPath}`)}\n`);
    process.stdout.write(`  ${c('dim', '填好后：sw-check --answers ' + tPath + ' --out ' + outDir)}\n\n`);
  }

  wrote(jsonPath);
  wrote(mdPath);
  wrote(tPath);
  process.stdout.write('\n');

  return report.verdict === 'fail' ? 1 : 0;
}

function printHelp() {
  process.stdout.write(`
sw-check — 第三步（验收）：常识校验

用法
  sw-check [--out out]
  sw-check --answers checklist-template.json [--out out]

参数
  --story <文件>       正文（默认 <out>/story.json）
  --plan <文件>        方案（默认 <out>/plan.json，用于核对修改点是否落实）
  --analysis <文件>    分析结果（默认 <out>/analysis.json，提供设定与事实）
  --answers <文件>     回填的判断结果（verdict: pass / fail / na）
  --limit <n>          终端最多显示多少条问题（默认 15）
  --out <目录>         输出目录（默认 out/）
  --help               显示本帮助

校验内容
  ① 可计算的常识硬伤：时长/距离/速度/生理极限/时代错位/数字矛盾等
  ② 内部一致性：作品自己立的设定、原文写死的事实是否被违反
  ③ 方案落实：人工确认的修改点与 beat 骨架是否真的被执行

结论口径
  有硬伤(blocker) → 未通过（**即使分数很高**）
  有明显可疑或存在未回答项 → 通过（有待核对项）
  否则 → 通过

退出码
  0 = 通过 / 通过（有待核对项）    1 = 未通过（存在硬伤）    2 = 用法或读取错误

产出
  <out>/check.json              结构化校验报告
  <out>/check.md                校验报告（给人读，含逐条证据）
  <out>/checklist-template.json 待判断项模板（填 verdict 后回填）
`);
}

runAsScript(import.meta.url, main);
