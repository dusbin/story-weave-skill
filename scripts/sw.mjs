#!/usr/bin/env node
/**
 * scripts/sw.mjs — story-weave 主入口（dispatcher）。
 *
 * 把「分析原文 → 人工确认 → 演绎成文 → 常识校验 → 出产物」五步串起来，
 * 每一步都可以单独调用，也可以只跑其中一步（产物是文件，步骤之间是解耦的）。
 *
 * 用法：
 *   node scripts/sw.mjs analyze --text "原文……" --out out
 *   node scripts/sw.mjs plan --out out
 *   node scripts/sw.mjs confirm --accept ch1,ch2 --out out
 *   node scripts/sw.mjs weave --out out
 *   node scripts/sw.mjs weave --draft 草稿.md --out out
 *   node scripts/sw.mjs check --out out
 *   node scripts/sw.mjs render --out out
 *   node scripts/sw.mjs all --text "原文……" --out out     # 跑到校验为止（跳过人工确认，仅用于试跑）
 *   node scripts/sw.mjs selfcheck                          # 自检
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseArgs, bool, str, unknownErrors } from './_args.mjs';
import { banner, fail, ok, warn, info, runCli, c, resolveOutDir, readJsonFile, writeJsonFile, writeTextFile } from './_io.mjs';

import * as analyzeCmd from './sw-analyze.mjs';
import * as planCmd from './sw-plan.mjs';
import * as confirmCmd from './sw-confirm.mjs';
import * as weaveCmd from './sw-weave.mjs';
import * as checkCmd from './sw-check.mjs';
import * as renderCmd from './sw-render.mjs';
import * as modesCmd from './sw-modes.mjs';
import * as rulesCmd from './sw-rules.mjs';
import * as verifyCmd from './sw-verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  analyze: { mod: analyzeCmd, desc: '第一步：分析输入文本，给出演绎思路与方向' },
  plan: { mod: planCmd, desc: '第二步（上）：生成演绎方案与待确认问题卡片' },
  confirm: { mod: confirmCmd, desc: '第二步（下）：回填人工确认结果，解锁演绎' },
  weave: { mod: weaveCmd, desc: '第三步：生成写作指令 / 导入草稿组装正文' },
  check: { mod: checkCmd, desc: '第三步（验收）：常识校验' },
  render: { mod: renderCmd, desc: '渲染 markdown / html / pdf / json 四种格式' },
  modes: { mod: modesCmd, desc: '列出六种演绎模式' },
  rules: { mod: rulesCmd, desc: '查看与自检常识规则库' },
  selfcheck: { mod: verifyCmd, desc: '自检：跑完整流水线并断言关键不变量' },
  verify: { mod: verifyCmd, desc: '同 selfcheck' },
};

async function main(argv) {
  const cmd = argv[0];
  const rest = argv.slice(1);

  // 版本 / 帮助 / 无命令
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printMainHelp();
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return 0;
  }

  if (cmd === 'all') return runAll(rest);

  const entry = COMMANDS[cmd];
  if (!entry) {
    process.stderr.write(`\n${c('red', `✗ 未知命令：${cmd}`)}\n`);
    process.stderr.write(`${c('dim', `  可用命令：${Object.keys(COMMANDS).join(' / ')}`)}\n\n`);
    printMainHelp();
    return 2;
  }

  return entry.mod.main(rest);
}

/* ------------------------------------------------------------------ all */

/**
 * 一键试跑：分析 → 方案 → （自动确认）→ 写作指令 → （用占位草稿）→ 校验 → 渲染。
 *
 * ★ 这里会**自动确认方案**（把修改点全部按"不改"处理），只适合快速试跑流程。
 *   真正的创作必须走 sw-plan → 用户勾选 → sw-confirm 的人工确认路径，
 *   否则第二步就形同虚设。所以本命令会在输出里明确警告。
 */
async function runAll(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误'); }
  if (args.help) return main(['--help']);

  const outDir = resolveOutDir(args);

  banner('一键试跑', '分析 → 方案 → 自动确认 → 写作指令 → 占位草稿 → 校验 → 渲染');
  warn('本命令会**自动确认方案**（修改点按"不改"处理），仅用于试跑流程。');
  warn('真正创作请走：sw-plan →（用户勾选）→ sw-confirm → sw-weave → 写草稿 → sw-weave --draft → sw-check');
  process.stdout.write('\n');

  const passthrough = argv.filter((a) => !['--yes'].includes(a));

  // 1) 分析
  let code = await analyzeCmd.main([...passthrough, '--out', outDir]);
  if (code) return code;

  // 2) 方案
  const planArgs = [...passthrough, '--out', outDir];
  if (args.mode) planArgs.push('--mode', String(args.mode));
  if (args.scale) planArgs.push('--scale', String(args.scale));
  code = await planCmd.main(planArgs);
  if (code) return code;

  // 3) 自动确认（写明是脚本自动确认，便于事后区分）
  const plan = readJsonFile(join(outDir, 'plan.json'));
  const accepted = (plan.changes ?? []).filter((ch) => ch.origin === 'gap').map((ch) => ch.id);
  const answersPath = join(outDir, 'auto-confirm.json');
  writeJsonFile(answersPath, {
    note: '由 sw all 自动生成的确认结果，仅用于试跑。真实创作请由用户勾选后回填。',
    acceptedChangeIds: accepted,
    ending: str(args.ending) ?? plan.direction.ending,
    confirmedBy: 'auto(sw all)',
    notes: '自动确认，仅用于流程试跑',
  });
  code = await confirmCmd.main(['--answers', answersPath, '--out', outDir]);
  if (code) return code;

  // 4) 写作指令
  code = await weaveCmd.main(['--out', outDir]);
  if (code) return code;

  // 5) 占位草稿（内容明显是占位符，避免被误当成成品）
  const confirmed = readJsonFile(join(outDir, 'plan.json'));
  const draftLines = confirmed.beats.map((b, i) => [
    `## ${i + 1}. ${b.title}`,
    '',
    `（【占位正文 · 第 ${i + 1} 节】本节目的：${b.purpose}）`,
    `（写作指引：${b.guidance}）`,
    '',
    '这一段应由模型或作者按 prompts.md 的指令写成真正的叙事正文，此处仅为打通流程。',
  ].join('\n'));
  const draftPath = join(outDir, 'draft-placeholder.md');
  writeTextFile(draftPath, draftLines.join('\n\n'));
  info(`占位草稿：${draftPath}`);

  code = await weaveCmd.main(['--draft', draftPath, '--out', outDir]);
  if (code) return code;

  // 6) 校验
  code = await checkCmd.main(['--out', outDir]);

  // 7) 渲染
  const renderCode = await renderCmd.main(['--out', outDir]);

  process.stdout.write('\n');
  ok('一键试跑完成');
  process.stdout.write(`  ${c('yellow', '⚠ 正文是占位内容，不是成品。')}\n`);
  process.stdout.write(`  ${c('dim', '  真实创作：把 prompts.md 的指令交给模型写草稿 → sw weave --draft 你的草稿.md → sw check')}\n`);
  process.stdout.write(`  ${c('dim', '  注意：本次方案是自动确认的（见 auto-confirm.json），重新创作前请用 sw plan 重来并由用户勾选。')}\n\n`);

  return code || renderCode;
}

/* ------------------------------------------------------------------ 帮助 */

function printMainHelp() {
  const lines = [];
  lines.push('');
  lines.push(c('bold', '  story-weave — 根据输入文本合理演绎故事'));
  lines.push('');
  lines.push('  三步流水线，每步都有确定性的命令行工具产出结构化文件：');
  lines.push('');
  lines.push(`    ${c('cyan', '第一步')}  分析输入的文本内容，给出演绎的思路与方向`);
  lines.push(`             ${c('dim', 'sw analyze --text "原文……"')}`);
  lines.push(`             ${c('dim', '→ analysis.json / analysis.md（体裁、常识标尺、人物、留白点、模式推荐）')}`);
  lines.push('');
  lines.push(`    ${c('cyan', '第二步')}  人工确认演绎方向和修改点  ${c('yellow', '★ 必须确认，否则不允许演绎')}`);
  lines.push(`             ${c('dim', 'sw plan    → plan.json / confirm-questions.json（待勾选）')}`);
  lines.push(`             ${c('dim', 'sw confirm --answers answers.json  （把勾选结果写回，留痕）')}`);
  lines.push('');
  lines.push(`    ${c('cyan', '第三步')}  进行故事演绎，并做常识校验`);
  lines.push(`             ${c('dim', 'sw weave              → prompts.md（逐节写作指令 + 常识自查表）')}`);
  lines.push(`             ${c('dim', 'sw weave --draft 草稿.md → story.json / story.md（组装正文）')}`);
  lines.push(`             ${c('dim', 'sw check              → check.json / check.md（常识校验报告）')}`);
  lines.push(`             ${c('dim', 'sw render             → markdown / html / pdf / json 四种格式')}`);
  lines.push('');
  lines.push(`  ${c('bold', '命令')}`);
  for (const [name, e] of Object.entries(COMMANDS)) {
    lines.push(`    ${name.padEnd(11)}${e.desc}`);
  }
  lines.push(`    ${'all'.padEnd(11)}一键试跑整条流水线（会自动确认方案，仅供试跑）`);
  lines.push('');
  lines.push(`  ${c('bold', '常识保障')}`);
  lines.push('    演绎前把"不可改写的事实 + 作品已立的设定 + 演绎不变量"写成硬约束，写进每一节的写作指令；');
  lines.push('    演绎后由规则库逐条校验：可计算的硬伤（时长/距离/速度/生理极限/时代错位/数字矛盾）由引擎判定，');
  lines.push('    需要理解语义的问题由引擎收窄成带原文证据的问题、交给模型判断并留痕。');
  lines.push('    结论口径：**有硬伤即未通过，与分数无关**。');
  lines.push('');
  lines.push(`  ${c('dim', '各步详细参数：sw <命令> --help')}`);
  lines.push(`  ${c('dim', '术语表：sw rules --terms')}`);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

runCli(() => main(process.argv.slice(2)))();
