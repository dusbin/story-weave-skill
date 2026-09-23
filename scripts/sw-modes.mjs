#!/usr/bin/env node
/**
 * scripts/sw-modes.mjs — 列出六种演绎模式：适合什么、骨架、需要人工指定什么。
 *
 * 用法：
 *   node scripts/sw-modes.mjs
 *   node scripts/sw-modes.mjs --mode prequel --sections 6
 *   node scripts/sw-modes.mjs --json
 */

import { parseArgs, str, num, bool, unknownErrors } from './_args.mjs';
import { banner, fail, ok, warn, runAsScript, c } from './_io.mjs';
import { MODE_DEFS, MODE_BY_KEY, buildBeats, requiredInputs, SCALE } from '../lib/modes.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误'); }
  if (args.help) { printHelp(); return 0; }

  const one = str(args.mode);
  if (one && !MODE_BY_KEY[one]) {
    fail(`未知模式：${one}`, `可选：${MODE_DEFS.map((m) => m.key).join(' / ')}`);
  }

  const sections = num(args.sections) ?? 8;

  if (bool(args.json)) {
    const data = (one ? [MODE_BY_KEY[one]] : MODE_DEFS).map((m) => ({
      key: m.key,
      label: m.label,
      short: m.short,
      what: m.what,
      howHard: m.howHard,
      invariants: m.invariants,
      guide: m.guide,
      requiredInputs: requiredInputs(m.key),
      skeleton: buildBeats(m.key, { sections, protagonist: '主角' }).map((b) => ({
        index: b.index, title: b.title, purpose: b.purpose, guidance: b.guidance,
      })),
    }));
    process.stdout.write(JSON.stringify({ scales: SCALE, modes: data }, null, 2) + '\n');
    return 0;
  }

  banner('六种演绎模式', one ? MODE_BY_KEY[one].label : '扩写 / 续写 / 前传 / 改编 / 番外 / 多线推演');

  for (const m of (one ? [MODE_BY_KEY[one]] : MODE_DEFS)) {
    process.stdout.write(`\n${c('bold', `${m.label}（${m.key}）`)}  ${c('dim', m.short)}\n`);
    process.stdout.write(`  ${wrap(m.what, 4)}\n`);
    process.stdout.write(`  ${c('yellow', '难度与风险')}：${m.howHard}\n`);
    process.stdout.write(`  ${c('bold', '不变量（不可违反）')}：\n`);
    for (const inv of m.invariants) process.stdout.write(`    · ${wrap(inv, 6)}\n`);
    process.stdout.write(`  ${c('bold', '需要人工指定')}：${requiredInputs(m.key).join('、')}\n`);
    if (!one) continue;
    process.stdout.write(`  ${c('bold', `${sections} 节写作骨架`)}：\n`);
    for (const b of buildBeats(m.key, { sections, protagonist: '主角' })) {
      process.stdout.write(`    ${String(b.index).padStart(2, ' ')}. ${b.title}\n`);
      process.stdout.write(`        ${c('dim', `${b.purpose} — ${b.guidance}`)}\n`);
    }
  }

  process.stdout.write(`\n${c('bold', '篇幅档位')}\n`);
  for (const s of Object.values(SCALE)) {
    process.stdout.write(`  ${s.label}（${s.key}）：${s.desc}\n`);
  }
  process.stdout.write('\n');
  ok(`${MODE_DEFS.length} 种模式；用 --mode <key> --sections <n> 查看某个模式的完整骨架`);
  process.stdout.write('\n');
  return 0;
}

function wrap(s, indent = 0) {
  const t = String(s ?? '');
  const width = 76 - indent;
  const lines = [];
  for (let i = 0; i < t.length; i += width) lines.push(t.slice(i, i + width));
  return lines.join(`\n${' '.repeat(indent)}`);
}

function printHelp() {
  process.stdout.write(`
sw-modes — 列出六种演绎模式

用法
  sw-modes                        列出全部模式概要
  sw-modes --mode prequel         查看某一模式的完整骨架与不变量
  sw-modes --sections 12          指定节数预览骨架
  sw-modes --json                 以 JSON 输出（供程序使用）
  --help                          显示本帮助

模式
  expand    扩写      把梗概/片段展开为完整叙事
  continue  续写      从原文结尾之后接着写
  prequel   前传      补出导致原文情节的成因
  adapt     改编      保留内核、替换外壳（视角/时代/结局/体裁）
  spinoff   番外      支线人物或平行日常的独立小故事
  whatif    多线推演  一个变量取不同值，推演出多条分支
`);
}

runAsScript(import.meta.url, main);
