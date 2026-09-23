#!/usr/bin/env node
/**
 * scripts/sw-weave.mjs — 第三步：演绎成文。
 *
 * 两种用法：
 *
 *   A. 生成写作指令（写草稿之前）
 *      node scripts/sw-weave.mjs --out out
 *      → <out>/prompts.md：逐节写作指令 + 常识自查表 + 硬约束
 *
 *   B. 导入草稿，组装正文（写完之后）
 *      node scripts/sw-weave.mjs --draft draft.md --out out
 *      → <out>/story.json、<out>/story.md
 *
 * 本技能不自己"生成文本"：创作由调用它的模型或人完成，这里只负责
 * 把边界讲清楚（A）与把结果收严实（B）。
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, str, bool, unknownErrors } from './_args.mjs';
import { resolveOutDir, readJsonFile, readTextFile, writeJsonFile, writeTextFile, banner, ok, warn, wrote, info, fail, runAsScript, c } from './_io.mjs';
import { isWeavable, weavabilityIssues } from '../lib/plan.mjs';
import { buildBeatPrompts, parseDraft, assembleStory, validateAssembled, previewStory, COMMONSENSE_SELFCHECK } from '../lib/weave.mjs';
import { renderStoryMd } from '../lib/render.mjs';
import { MODE_BY_KEY } from '../lib/modes.mjs';
import { PLAN_STATES } from '../lib/schema.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误', '用 --help 查看支持的参数。'); }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);
  const planPath = str(args.plan) ?? join(outDir, 'plan.json');
  if (!existsSync(planPath)) fail(`找不到方案文件：${planPath}`, '请先执行 sw-plan 与 sw-confirm。');
  const plan = readJsonFile(planPath);

  const analysisPath = str(args.analysis) ?? join(outDir, 'analysis.json');
  const analysis = existsSync(analysisPath) ? readJsonFile(analysisPath) : null;

  // ★ 关键闸门：未确认的方案绝不允许进入演绎
  const issues = weavabilityIssues(plan);
  if (issues.length) {
    banner('第三步：演绎', '方案未通过演绎前校验');
    for (const i of issues) process.stdout.write(`  ${c('red', '✗')} ${i}\n`);
    process.stdout.write('\n');
    fail(
      `方案状态为「${PLAN_STATES[plan.status?.state] ?? plan.status?.state}」，不允许进入演绎`,
      '请先执行 sw-confirm 完成人工确认（确认是第二步的核心，不能跳过）。',
    );
  }

  if (!analysis) warn(`未找到分析结果 ${analysisPath}，写作指令里将缺少"原文事实与设定"部分`);

  const hasDraft = str(args.draft) !== undefined;

  return hasDraft ? importDraft(args, { plan, analysis, outDir }) : emitPrompts(args, { plan, analysis, outDir });
}

/* ------------------------------------------------------------------ A. 写作指令 */

function emitPrompts(args, { plan, analysis, outDir }) {
  banner('第三步：生成写作指令', `${plan.modeLabel}｜${plan.scale.label}｜${plan.beats.length} 节`);

  const { beats, combined } = buildBeatPrompts({ analysis, plan });

  const path = join(outDir, 'prompts.md');
  writeTextFile(path, combined);

  // 同时给一份机器可读的逐节指令，便于分别喂给写作过程
  const jsonPath = writeJsonFile(join(outDir, 'prompts.json'), {
    title: plan.title,
    mode: plan.mode,
    sections: plan.beats.length,
    targetChars: plan.scale.targetChars,
    selfCheck: COMMONSENSE_SELFCHECK,
    beats: beats.map((b) => ({
      index: b.index, title: b.title, purpose: b.purpose, guidance: b.guidance,
      targetChars: b.targetChars, prevTitle: b.prevTitle, nextTitle: b.nextTitle, prompt: b.prompt,
    })),
  });

  process.stdout.write(`  写作总纲：${MODE_BY_KEY[plan.mode]?.guide?.slice(0, 70) ?? ''}…\n\n`);
  process.stdout.write(`  ${c('bold', '逐节指令')}\n\n`);
  for (const b of beats) {
    process.stdout.write(`  ${String(b.index).padStart(2, ' ')}. ${b.title}\n`);
    process.stdout.write(`      ${c('dim', `目的：${b.purpose}｜约 ${b.targetChars} 字`)}\n`);
  }
  process.stdout.write('\n');

  const facts = plan.constraints.mustNotViolate.filter((k) => k.ruleRef === 'FACT-001');
  const rules = plan.constraints.mustNotViolate.filter((k) => k.ruleRef === 'SET-001');
  if (facts.length || rules.length) {
    process.stdout.write(`  ${c('bold', '写作时必须守住')}\n`);
    for (const f of facts) process.stdout.write(`    ${c('red', '事实')} ${f.statement.slice(0, 56)}\n`);
    for (const r of rules) process.stdout.write(`    ${c('yellow', '设定')} ${r.statement.slice(0, 56)}\n`);
    process.stdout.write('\n');
  }

  const accepted = plan.changes.filter((ch) => ch.decision === 'accept' || ch.decision === 'modify');
  if (accepted.length) {
    process.stdout.write(`  ${c('bold', '要落实的人工确认修改点')}：${accepted.length} 条\n`);
    for (const ch of accepted) process.stdout.write(`    · ${ch.target}${ch.userNote ? c('dim', `（${ch.userNote}）`) : ''}\n`);
    process.stdout.write('\n');
  }

  ok(`写作指令已生成（含 ${COMMONSENSE_SELFCHECK.length} 条常识自查项）`);
  wrote(path);
  wrote(jsonPath);
  process.stdout.write(`\n  ${c('dim', '请按 prompts.md 写出草稿（每节一个「## 1. 标题」二级标题），然后：')}\n`);
  process.stdout.write(`  ${c('dim', '  sw-weave --draft 草稿.md --out out   # 导入并组装正文')}\n`);
  process.stdout.write(`  ${c('dim', '  sw-check --out out                    # 常识校验')}\n\n`);
  return 0;
}

/* ------------------------------------------------------------------ B. 导入草稿 */

function importDraft(args, { plan, analysis, outDir }) {
  const draftPath = str(args.draft);
  if (!existsSync(draftPath)) fail(`找不到草稿文件：${draftPath}`);

  banner('第三步：导入草稿并组装正文', draftPath);

  const raw = readTextFile(draftPath);
  const { sections, warnings, format } = parseDraft(raw);

  if (!sections.length) fail('草稿里没有解析出任何正文内容', '请检查文件是否为空，或分节格式是否正确。');

  for (const w of warnings) warn(w);
  info(`分节方式：${formatLabel(format)}｜解析出 ${sections.length} 节`);

  // 节数与 beat 对齐检查：不一致要显眼提示（不阻断，但必须让人知道）
  const beatCount = plan.beats.length;
  if (sections.length !== beatCount) {
    warn(`正文 ${sections.length} 节 ≠ 方案 ${beatCount} 个 beat`);
    if (format === 'single') {
      info('建议按「## 1. 标题」分节，以便与方案逐节对应、逐节核对。');
    }
  }

  const title = str(args.title) ?? plan.title;
  const story = assembleStory({ plan, sections, title, mode: plan.mode, notes: str(args.notes) ?? '' });

  const errs = validateAssembled(story);
  if (errs.length) {
    for (const e of errs.slice(0, 6)) warn(e);
    if (errs.some((e) => e.includes('sections 拼接结果不一致'))) {
      fail('正文组装结果自相矛盾（story.text 与 sections 不一致）', '这是引擎问题，请反馈。');
    }
  }

  const jsonPath = writeJsonFile(join(outDir, 'story.json'), story);
  const mdPath = writeTextFile(join(outDir, 'story.md'), renderStoryMd(story, { analysis, plan }));

  process.stdout.write('\n');
  process.stdout.write(`  标题：${story.title}\n`);
  process.stdout.write(`  篇幅：${story.sections.length} 节 / ${story.chars} 字（目标 ${plan.scale.targetChars} 字）\n`);
  process.stdout.write(`  节数对齐：${story.meta.alignment}\n`);
  const dev = story.chars / (plan.scale.targetChars || 1);
  if (dev < 0.6) warn(`实际字数只有目标的 ${(dev * 100).toFixed(0)}%，可能展开不足`);
  else if (dev > 1.6) warn(`实际字数达到目标的 ${(dev * 100).toFixed(0)}%，可能超出计划篇幅`);
  process.stdout.write('\n');

  process.stdout.write(`${c('dim', '  ── 正文预览 ──')}\n`);
  for (const line of previewStory(story, 400).split('\n')) process.stdout.write(`  ${c('dim', line)}\n`);
  process.stdout.write('\n');

  ok('正文已组装');
  wrote(jsonPath);
  wrote(mdPath);
  process.stdout.write(`\n  ${c('dim', '下一步：sw-check 做常识校验（第三步的验收环节）')}\n\n`);
  return 0;
}

function formatLabel(f) {
  return { heading: '标题分节', separator: '分隔线分节', single: '未分节（整体视为一节）', empty: '空文件' }[f] ?? f;
}

function printHelp() {
  process.stdout.write(`
sw-weave — 第三步：演绎成文（生成写作指令 / 导入草稿组装正文）

用法
  sw-weave [--out out]                        生成写作指令
  sw-weave --draft 草稿.md [--out out]        导入草稿并组装正文

参数
  --draft <文件>       草稿文件（markdown；建议每节用「## 1. 标题」分节）
  --plan <文件>        方案文件（默认 <out>/plan.json）
  --analysis <文件>    分析结果（默认 <out>/analysis.json）
  --title <标题>       覆盖标题（默认用方案标题）
  --notes <文字>       备注，写入 story.json
  --out <目录>         输出目录（默认 out/）
  --help               显示本帮助

前置条件
  方案必须已通过 sw-confirm 人工确认（状态为 confirmed / confirmed_with_edits）。
  未确认的方案会被拒绝，这是第二步的核心保障，不能跳过。

产出
  生成指令：<out>/prompts.md、<out>/prompts.json
  导入草稿：<out>/story.json、<out>/story.md
`);
}

runAsScript(import.meta.url, main);
