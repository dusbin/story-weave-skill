#!/usr/bin/env node
/**
 * scripts/sw-confirm.mjs — 第二步（下）：回填人工确认结果，解锁演绎。
 *
 * 这是"人工确认"落盘的地方。它把界面上勾选的结果、逐条批注、尺度调整
 * 写回 plan.json，并把状态从 pending_confirmation 推进到 confirmed / confirmed_with_edits。
 *
 * 用法：
 *   # 1) 用卡片的勾选结果（推荐）
 *   node scripts/sw-confirm.mjs --answers answers.json --out out
 *
 *   # 2) 直接用命令行表达
 *   node scripts/sw-confirm.mjs --mode prequel --scale long --ending maintain \
 *        --accept ch1,ch2 --reject ch3 --note "ch4=这里只写一半" --out out
 *
 *   # 3) 逐条批注（把方案打回，修改点全部重置为待定）
 *   node scripts/sw-confirm.mjs --reject-plan --reason "主线不成立" --out out
 *
 *   # 4) 只看当前状态
 *   node scripts/sw-confirm.mjs --out out --list
 *
 * answers.json 支持两种写法：
 *   A. 直接给字段：{ "mode":"prequel", "acceptedChangeIds":["ch1"], "changeNotes":{"ch1":"…"} }
 *   B. 给 ask_user_question 的答案：{ "answers":[{ "id":"mode", "selected":["prequel"] }, …] }
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, str, bool, list, kvList, unknownErrors } from './_args.mjs';
import { resolveOutDir, readJsonFile, writeJsonFile, writeTextFile, banner, ok, warn, wrote, info, fail, runAsScript, c } from './_io.mjs';
import { applyConfirmation, rejectPlan, summarizePlan } from '../lib/plan.mjs';
import { renderPlanMd } from '../lib/render.mjs';
import { validatePlan, PLAN_STATES } from '../lib/schema.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误', '用 --help 查看支持的参数。'); }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);
  const planPath = str(args.plan) ?? join(outDir, 'plan.json');
  if (!existsSync(planPath)) {
    fail(`找不到方案文件：${planPath}`, '请先执行 sw-plan 生成演绎方案。');
  }
  const plan = readJsonFile(planPath);

  const analysisPath = str(args.analysis) ?? join(outDir, 'analysis.json');
  const analysis = existsSync(analysisPath) ? readJsonFile(analysisPath) : null;

  banner('第二步（下）：回填人工确认', `方案修订 ${plan.status?.revision ?? '?'}`);

  if (args.list) {
    for (const line of summarizePlan(plan).split('\n')) process.stdout.write(`  ${line}\n`);
    process.stdout.write('\n');
    for (const ch of plan.changes) {
      process.stdout.write(`  ${ch.id} ${ch.decision === 'pending' ? c('yellow', '待定') : c('green', ch.decisionLabel)}  [${ch.kind}] ${ch.target}\n`);
      if (ch.userNote) process.stdout.write(`      ${c('dim', `批注：${ch.userNote}`)}\n`);
    }
    process.stdout.write('\n');
    return 0;
  }

  // 打回方案
  if (bool(args['reject-plan'])) {
    const reason = str(args.reason) ?? '';
    const rejected = rejectPlan(plan, reason);
    writeJsonFile(planPath, rejected);
    writeTextFile(join(outDir, 'plan.md'), renderPlanMd(rejected, analysis));
    ok(`方案已打回，状态：${rejected.status.stateLabel}`);
    if (reason) info(`原因：${reason}`);
    wrote(planPath);
    warn('所有修改点已重置为待定，请调整方案后重新确认。');
    return 0;
  }

  // 组装答案
  const answers = buildAnswers(args, outDir, plan);

  if (!hasAnyAnswer(answers)) {
    fail('没有收到任何确认内容', '请用 --answers answers.json，或用 --mode/--scale/--accept/--note 等参数表达确认结果；只看状态请加 --list。');
  }

  const confirmed = applyConfirmation(plan, answers, analysis);
  const errs = validatePlan(confirmed);
  if (errs.length) {
    warn(`确认后的方案未通过结构校验（${errs.length} 项）：`);
    for (const e of errs.slice(0, 5)) info(`- ${e}`);
  }

  writeJsonFile(planPath, confirmed);
  writeTextFile(join(outDir, 'plan.md'), renderPlanMd(confirmed, analysis));

  process.stdout.write('\n');
  for (const line of summarizePlan(confirmed).split('\n')) process.stdout.write(`  ${line}\n`);
  process.stdout.write('\n');

  if (confirmed.status.appliedEdits?.length) {
    process.stdout.write(`  ${c('bold', '本次确认对方案的实际改动')}：\n`);
    for (const e of confirmed.status.appliedEdits) process.stdout.write(`    · ${e}\n`);
    process.stdout.write('\n');
  }

  const acc = confirmed.changes.filter((ch) => ch.decision === 'accept' || ch.decision === 'modify');
  const rej = confirmed.changes.filter((ch) => ch.decision === 'reject');
  process.stdout.write(`  修改点处置：照此修改 ${acc.length} 条 / 不改 ${rej.length} 条\n`);
  if (acc.length) {
    for (const ch of acc) process.stdout.write(`    ${c('green', '✓')} ${ch.id} ${ch.target}${ch.userNote ? c('dim', `（${ch.userNote}）`) : ''}\n`);
  }
  process.stdout.write('\n');

  ok(`状态：${confirmed.status.stateLabel}`);
  wrote(planPath);
  wrote(join(outDir, 'plan.md'));
  process.stdout.write(`\n  ${c('green', '方案已确认，可以进入第三步演绎。')}\n`);
  process.stdout.write(`  ${c('dim', '下一步：sw-weave 生成写作指令 → 写草稿 → sw-weave --draft 导入 → sw-check 校验')}\n\n`);
  return 0;
}

function hasAnyAnswer(a) {
  return Boolean(
    a.mode || a.scale || a.ending || a.title || a.adaptAxis || a.branchVariable || a.spinoffCharacter
    || (a.acceptedChangeIds?.length) || (a.rejectedChangeIds?.length)
    || Object.keys(a.changeNotes ?? {}).length || a.notes,
  );
}

/**
 * 汇总确认答案：优先读 --answers 文件，命令行参数覆盖/补充。
 */
function buildAnswers(args, outDir, plan) {
  const answers = {
    acceptedChangeIds: [],
    rejectedChangeIds: [],
    changeNotes: {},
  };

  // 1) 文件
  const af = str(args.answers);
  if (af) {
    const raw = readJsonFile(af);
    Object.assign(answers, fromFile(raw, plan));
  } else {
    // 没给文件时，若有 confirm-questions.json 且已填 selected，也读进来
    const guess = join(outDir, 'confirm-questions.json');
    if (existsSync(guess)) {
      try {
        const raw = readJsonFile(guess);
        const filled = (raw.questions ?? []).filter((q) => Array.isArray(q.selected) && q.selected.length);
        if (filled.length) {
          Object.assign(answers, fromFile({ answers: filled }, plan));
          info(`已从 ${guess} 读取 ${filled.length} 项已勾选的答案`);
        }
      } catch { /* 忽略：它只是便利入口 */ }
    }
  }

  // 2) 命令行覆盖
  const mode = str(args.mode);
  if (mode) answers.mode = mode;
  const scale = str(args.scale);
  if (scale) answers.scale = scale;
  const ending = str(args.ending);
  if (ending) answers.ending = ending;
  const title = str(args.title);
  if (title) answers.title = title;
  const axis = str(args['adapt-axis']);
  if (axis) answers.adaptAxis = axis;
  const bv = str(args['branch-variable']);
  if (bv) answers.branchVariable = bv;
  const sp = str(args['spinoff-character']);
  if (sp) answers.spinoffCharacter = sp;
  const notes = str(args.notes);
  if (notes) answers.notes = notes;
  const by = str(args.by);
  if (by) answers.confirmedBy = by;

  const accept = list(args.accept);
  if (accept.length) answers.acceptedChangeIds = [...new Set([...answers.acceptedChangeIds, ...accept])];
  const reject = list(args.reject);
  if (reject.length) answers.rejectedChangeIds = [...new Set([...answers.rejectedChangeIds, ...reject])];

  const noteMap = kvList(args.note);
  Object.assign(answers.changeNotes, noteMap);

  // 冲突检查：同一条既 accept 又 reject
  const both = answers.acceptedChangeIds.filter((id) => answers.rejectedChangeIds.includes(id));
  if (both.length) fail(`同一条修改点既同意又拒绝：${both.join('、')}`, '每一条只能有一种处置。');

  // 未知 id 检查：避免拼错 id 后"确认了但没生效"
  const validIds = new Set((plan.changes ?? []).map((ch) => ch.id));
  const unknownIds = [...answers.acceptedChangeIds, ...answers.rejectedChangeIds, ...Object.keys(answers.changeNotes)]
    .filter((id) => !validIds.has(id));
  if (unknownIds.length) {
    fail(`修改点 id 不存在：${[...new Set(unknownIds)].join('、')}`, `本方案的修改点 id 为：${[...validIds].join('、')}`);
  }

  answers.confirmedBy = answers.confirmedBy ?? process.env.USER ?? 'user';
  return answers;
}

/** 解析 answers 文件的两种写法 */
function fromFile(raw, plan) {
  const out = { acceptedChangeIds: [], rejectedChangeIds: [], changeNotes: {} };

  // 写法 A：直接给字段
  if (raw.mode || raw.scale || raw.ending || raw.acceptedChangeIds || raw.changeNotes || raw.answers === undefined) {
    for (const k of ['mode', 'scale', 'ending', 'title', 'adaptAxis', 'branchVariable', 'spinoffCharacter', 'notes', 'confirmedBy', 'tier']) {
      if (raw[k] !== undefined) out[k] = raw[k];
    }
    if (Array.isArray(raw.acceptedChangeIds)) out.acceptedChangeIds = raw.acceptedChangeIds;
    if (Array.isArray(raw.rejectedChangeIds)) out.rejectedChangeIds = raw.rejectedChangeIds;
    if (raw.changeNotes && typeof raw.changeNotes === 'object') out.changeNotes = { ...raw.changeNotes };
  }

  // 写法 B：ask_user_question 的答案数组
  if (Array.isArray(raw.answers)) {
    for (const a of raw.answers) {
      const sel = Array.isArray(a.selected) ? a.selected : a.selected !== undefined ? [a.selected] : [];
      if (!a.id || !sel.length) continue;
      switch (a.id) {
        case 'mode': out.mode = sel[0]; break;
        case 'scale': out.scale = sel[0]; break;
        case 'ending': out.ending = sel[0]; break;
        case 'tier': out.tier = sel[0]; break;
        case 'changes_accept': out.acceptedChangeIds = sel; break;
        case 'changes_note': out.changeNotes = { ...out.changeNotes, ...parseNoteSelections(sel) }; break;
        default: break;
      }
    }
  }

  // 卡片上勾了"接受"，其余自动按"不改"处理（applyConfirmation 已实现）
  return out;
}

/** 批注题目的选项形如 "ch3=只写一半" */
function parseNoteSelections(sel) {
  const out = {};
  for (const s of sel) {
    const eq = String(s).indexOf('=');
    if (eq > 0) out[String(s).slice(0, eq).trim()] = String(s).slice(eq + 1).trim();
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
sw-confirm — 第二步（下）：回填人工确认结果，解锁演绎

用法
  sw-confirm --answers answers.json [--out out]
  sw-confirm --mode prequel --scale long --accept ch1,ch2 --reject ch3 --note "ch4=只写一半"
  sw-confirm --reject-plan --reason "主线不成立"
  sw-confirm --list                      # 只看当前确认状态

确认内容
  --answers <文件>     确认结果文件（支持字段写法与 ask_user_question 答案写法）
  --mode <key>         调整演绎模式
  --scale <key>        调整篇幅（flash/short/long）
  --ending <key>       调整结局倾向（maintain/change/open）
  --title <标题>       确认标题
  --adapt-axis <说明>  改编：替换轴
  --branch-variable <说明> 多线推演：分叉变量
  --spinoff-character <人物> 番外：番外主角
  --accept <id,...>    同意照此执行的修改点
  --reject <id,...>    不同意（保留原文）的修改点
  --note <id=说明,...> 对某条修改点的具体批注（会被视为"按用户说明改"）
  --notes <文字>       整体批注
  --by <名字>          确认人（默认取当前用户名，写入留痕）
  --reject-plan        把方案打回重做，所有修改点重置为待定
  --reason <原因>      打回原因
  --list               只打印当前状态与修改点处置情况
  --out <目录>         输出目录（默认 out/）
  --help               显示本帮助

说明
  未在 --accept 中列出、也没有批注的修改点，一律按"不改"处理并记录下来，
  避免"确认了但其实没人看"的情况。每条处置都带时间戳写入 plan.json 的 history。
`);
}

runAsScript(import.meta.url, main);
