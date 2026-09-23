/**
 * scripts/_io.mjs — 文件读写与终端输出。**这是脚本层才允许有 IO 的地方**。
 *
 * 约定：
 *   - lib/** 一律纯函数；所有读写集中在这里，便于测试与审阅。
 *   - 写文件前先确保目录存在；输出的每个文件都打印出来，让使用者知道东西去哪了。
 *   - 出错一律走 fail()（抛 CliError），由顶层统一转成"人话 + 退出码"。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

export class CliError extends Error {
  constructor(message, { hint = '', code = 1 } = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
    this.code = code;
  }
}

export function fail(message, hint = '') {
  throw new CliError(message, { hint });
}

/* ------------------------------------------------------------------ 路径 */

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readTextFile(p) {
  if (!p) fail('没有指定输入文件');
  const abs = resolve(p);
  if (!existsSync(abs)) fail(`文件不存在：${p}`, '请检查路径；相对路径是相对于当前工作目录的。');
  const st = statSync(abs);
  if (st.isDirectory()) fail(`${p} 是一个目录，不是文件`, '本命令需要单个文件。');
  return readFileSync(abs, 'utf8');
}

export function readJsonFile(p) {
  const text = readTextFile(p);
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${p} 不是合法的 JSON：${err.message}`, '若是手工编辑过，请检查是否少了逗号或引号。');
  }
}

export function writeTextFile(p, content) {
  const abs = resolve(p);
  ensureDir(dirname(abs));
  writeFileSync(abs, content, 'utf8');
  return abs;
}

export function writeJsonFile(p, obj) {
  return writeTextFile(p, JSON.stringify(obj, null, 2) + '\n');
}

export function fileSize(p) {
  try { return statSync(resolve(p)).size; } catch { return 0; }
}

/* ------------------------------------------------------------------ 输入文本 */

/**
 * 收集输入文本：--text 直接给文字；--in 支持重复传多个文件。
 * 多个文件之间用空行拼接，并按文件名加小标题（便于报告中定位）。
 */
export function collectInputText(args) {
  const parts = [];
  const files = Array.isArray(args.in) ? args.in : args.in ? [args.in] : [];
  const dirs = [];

  if (files.length) {
    for (const f of files) {
      const abs = resolve(f);
      if (!existsSync(abs)) fail(`输入文件不存在：${f}`);
      if (statSync(abs).isDirectory()) {
        // 目录：取其中的文本文件（按文件名排序，保证顺序可复现）
        const names = readdirTextFiles(abs);
        if (!names.length) fail(`目录里没有可读的文本文件：${f}`, '支持 .txt / .md / .markdown。');
        dirs.push({ dir: f, count: names.length });
        for (const n of names) {
          const full = join(abs, n);
          parts.push({ name: n, text: readFileSync(full, 'utf8') });
        }
      } else {
        parts.push({ name: f, text: readFileSync(abs, 'utf8') });
      }
    }
  }

  if (args.text !== undefined) {
    const t = Array.isArray(args.text) ? args.text.join('\n\n') : String(args.text);
    parts.push({ name: '（命令行传入）', text: t });
  }

  if (!parts.length) return { text: '', sources: [], dirs };

  const multi = parts.length > 1;
  const text = parts
    .map((p) => (multi && p.name !== '（命令行传入）' ? `【${p.name}】\n${p.text}` : p.text))
    .join('\n\n');

  return { text, sources: parts.map((p) => p.name), dirs };
}

function readdirTextFiles(dir) {
  // 注意：ESM 里没有 require，readdirSync 必须在顶层 import
  return readdirSync(dir)
    .filter((n) => ['.txt', '.md', '.markdown'].includes(extname(n).toLowerCase()))
    .filter((n) => !n.startsWith('.'))
    .sort();
}

/* ------------------------------------------------------------------ 输出目录 */

/**
 * 解析输出目录：--out 给了就用，没给就用 out/。
 * 相对路径按当前工作目录解析（不是脚本目录），符合命令行直觉。
 */
export function resolveOutDir(args, fallback = 'out') {
  const raw = args.out;
  const val = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const dir = val ? String(val) : fallback;
  return ensureDir(isAbsolute(dir) ? dir : resolve(process.cwd(), dir));
}

/* ------------------------------------------------------------------ 终端 */

const COLORS = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', blue: '\u001b[34m', cyan: '\u001b[36m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export function c(color, s) {
  return useColor ? `${COLORS[color] ?? ''}${s}${COLORS.reset}` : String(s);
}

export function banner(title, subtitle = '') {
  const line = '─'.repeat(Math.max(20, Math.min(72, title.length * 2 + 12)));
  process.stdout.write(`\n${c('cyan', line)}\n${c('bold', `  ${title}`)}\n`);
  if (subtitle) process.stdout.write(`${c('dim', `  ${subtitle}`)}\n`);
  process.stdout.write(`${c('cyan', line)}\n`);
}

export function step(n, total, msg) {
  process.stdout.write(`${c('blue', `[${n}/${total}]`)} ${msg}\n`);
}

export function ok(msg) {
  process.stdout.write(`${c('green', '  ✓')} ${msg}\n`);
}

export function warn(msg) {
  process.stdout.write(`${c('yellow', '  !')} ${msg}\n`);
}

export function info(msg) {
  process.stdout.write(`    ${msg}\n`);
}

export function wrote(p) {
  const size = fileSize(p);
  process.stdout.write(`${c('green', '  →')} ${p} ${c('dim', `(${formatBytes(size)})`)}\n`);
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 统一的错误出口：把 CliError 转成"人话 + 提示 + 退出码" */
export function runCli(main) {
  return async () => {
    try {
      const code = await main();
      process.exitCode = Number.isFinite(code) ? code : 0;
    } catch (err) {
      if (err instanceof CliError) {
        process.stderr.write(`\n${c('red', '✗ ' + err.message)}\n`);
        if (err.hint) process.stderr.write(`${c('dim', '  提示：' + err.hint)}\n`);
        process.stderr.write('\n');
        process.exitCode = err.code;
        return;
      }
      process.stderr.write(`\n${c('red', '✗ 未预期的错误：' + (err?.stack ?? err))}\n\n`);
      process.exitCode = 2;
    }
  };
}

export { readdirTextFiles as _readdirTextFiles };

/* ------------------------------------------------------------------ 入口 */

/**
 * 当本文件是被直接执行的脚本时运行 main；被 sw.mjs 作为模块引入时不运行。
 *
 * 这样每个 sw-xxx.mjs 既能单独用（`node scripts/sw-analyze.mjs ...`），
 * 也能被 dispatcher 复用，逻辑只写一份。
 */
export function runAsScript(importMetaUrl, main) {
  const entry = process.argv[1];
  if (!entry) return;
  const entryUrl = new URL(`file://${resolve(entry)}`).href;
  if (entryUrl !== importMetaUrl) return;
  runCli(() => main(process.argv.slice(2)))();
}
