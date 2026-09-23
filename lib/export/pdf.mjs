/**
 * @module export/pdf
 * 用本机 Chrome / Chromium / Edge 的 headless 打印模式把 HTML 转成 PDF。
 *
 * 为什么走 CLI（`--print-to-pdf`）而不是 CDP：
 *  - 中文字体、CSS 分页、内嵌 SVG 只有真实浏览器引擎才渲染得对，所以必须用 Chrome；
 *  - CLI 模式不需要手写 WebSocket / DevTools 协议，代码量少、失败面小；
 *  - 本模块**零 npm 依赖**，只用 Node 内置模块。
 *
 * 稳定性设计（都是踩过的坑）：
 *  - 每次使用**唯一临时 user-data-dir**，避免上次异常退出留下的锁文件让 Chrome 起不来；
 *  - 实测部分 Chrome 版本（如 153）写完 PDF 后进程**不退出**，因此不用「等进程退出」判断成功，
 *    而是**轮询产物文件**：文件非空、以 `%PDF-` 开头、连续两次大小稳定即视为完成，随即杀掉进程；
 *  - **超时保护**：超时杀掉子进程（含进程组），返回 `ok:false` 与原因，绝不挂死；
 *  - 找不到 Chrome **不抛异常**，返回 `ok:false, errors:['未找到 Chrome']`，让调用方降级为「只出 md/html」。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ *
 * 探测 Chrome
 * ------------------------------------------------------------------ */

/**
 * 候选可执行文件列表：环境变量 `CHROME_PATH`（兼容旧名 `CHROME`）优先，
 * 其后是 macOS / Linux / Windows 的常见安装路径。
 *
 * @returns {string[]}
 */
function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.CHROME,
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((item) => typeof item === 'string' && item.length > 0);
}

/**
 * 找到一个真实存在的 Chrome 可执行文件。
 * 只返回**确实存在**的路径；都找不到时返回 `null`（不抛异常）。
 *
 * @returns {string|null}
 */
export function findChrome() {
  for (const candidate of chromeCandidates()) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* 权限错误 → 继续找下一个 */
    }
  }
  return null;
}

/**
 * 当前环境能否出 PDF。
 *
 * @returns {{ok:boolean, chrome:string|null, reason:string}}
 */
export function pdfAvailable() {
  const chrome = findChrome();
  if (!chrome) {
    return {
      ok: false,
      chrome: null,
      reason:
        '未找到 Chrome/Chromium/Edge 可执行文件（已搜索 macOS/Windows/Linux 常见路径）。' +
        '可安装 Google Chrome，或用环境变量 CHROME_PATH 指定路径。',
    };
  }
  return { ok: true, chrome, reason: '' };
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 降级建议：Chrome 不可用或转换失败时给调用方看的话 */
const DEGRADE_ADVICE =
  '降级建议：本次仍产出 md/json/html，可直接用浏览器打开 HTML 后按 ⌘P / Ctrl+P 选择「存储为 PDF」（A4、默认边距、勾选「背景图形」）得到同样的 PDF。';

/** 短随机串（用于临时目录/临时文件名，避免并发冲突） */
function rand() {
  return Math.random().toString(36).slice(2, 10);
}

/** 读文件大小，读不到返回 0 */
function fileSize(filePath) {
  try {
    const info = statSync(filePath);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/**
 * 校验产物是不是一份**完整**的 PDF：头部 `%PDF-` + 尾部 `%%EOF`。
 * 只判断「文件非空」是不够的——Chrome 可能正在写入，读到的是半份文件。
 *
 * @returns {{complete:boolean, bytes:number}}
 */
function readPdfVerdict(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 8) return { complete: false, bytes: buffer.length };
    const head = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1').includes('%%EOF');
    return { complete: head && tail, bytes: buffer.length };
  } catch {
    return { complete: false, bytes: 0 };
  }
}

/** 杀掉 Chrome 及其进程组（macOS/Linux 用独立进程组，避免留下 helper 子进程） */
function killTree(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGKILL'); // 整个进程组
      return;
    }
  } catch {
    /* 进程组不可用 → 退回单进程 */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已经退出了 */
  }
}

/** 递归删除临时目录（Chrome 可能还在收尾，允许重试，失败也不影响结果） */
function removeDir(dir) {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
  } catch {
    /* 临时目录清理失败不影响产物 */
  }
}

/**
 * 创建临时 user-data-dir：优先系统临时目录，失败则退到 HTML 所在目录（一定是可写的）。
 *
 * @param {string} htmlDir HTML 文件所在目录
 * @returns {string} 目录路径
 */
function createProfileDir(htmlDir) {
  const name = `story-weave-chrome-${process.pid}-${Date.now()}-${rand()}`;
  const candidates = [path.join(os.tmpdir(), name), path.join(htmlDir, `.${name}`)];
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* 试下一个 */
    }
  }
  return candidates[candidates.length - 1]; // 兜底：交给 Chrome 自己报错
}

/* ------------------------------------------------------------------ *
 * 纸张与页面覆盖
 * ------------------------------------------------------------------ */

/** 内置纸张尺寸（CSS `@page { size }` 的合法取值） */
const PAPER_SIZES = {
  A3: 'A3',
  A4: 'A4',
  A5: 'A5',
  B5: 'B5',
  B4: 'B4',
  Letter: 'Letter',
  Legal: 'Legal',
  Tabloid: 'Tabloid',
};

/** 归一化纸张：内置名（大小写不敏感）或 `<长> <宽>` 形式；无法识别返回 null */
function normalizePaper(paperSize) {
  if (!paperSize || typeof paperSize !== 'string') return null;
  const trimmed = paperSize.trim();
  if (!trimmed) return null;
  const key = Object.keys(PAPER_SIZES).find((name) => name.toLowerCase() === trimmed.toLowerCase());
  if (key) return PAPER_SIZES[key];
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && parts.every((part) => /^[\d.]+(mm|cm|in|pt|px)$/.test(part))) return `${parts[0]} ${parts[1]}`;
  return null;
}

/** 归一化单个长度值：数字按 mm 处理 */
function normalizeLength(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `${value}mm`;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[\d.]+(mm|cm|in|pt|px|%)?$/.test(trimmed)) return /[a-z%]$/i.test(trimmed) ? trimmed : `${trimmed}mm`;
  }
  return null;
}

/** 归一化边距：数字（mm）/ 1–4 个长度值的字符串 / {top,right,bottom,left} */
function normalizeMargin(margin) {
  if (margin === undefined || margin === null) return null;
  if (typeof margin === 'number') return normalizeLength(margin);
  if (typeof margin === 'string') {
    const parts = margin.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 4) return null;
    const lengths = parts.map(normalizeLength);
    return lengths.every(Boolean) ? lengths.join(' ') : null;
  }
  if (typeof margin === 'object') {
    const lengths = ['top', 'right', 'bottom', 'left'].map((side) => normalizeLength(margin[side]));
    return lengths.every(Boolean) ? lengths.join(' ') : null;
  }
  return null;
}

/** 生成覆盖用的 `@page` 样式；没有任何可覆盖项时返回空串 */
function buildPageStyle(paperSize, margin) {
  const declarations = [];
  const paper = normalizePaper(paperSize);
  if (paper) declarations.push(`size: ${paper};`);
  const box = normalizeMargin(margin);
  if (box) declarations.push(`margin: ${box};`);
  return declarations.length > 0 ? `@page { ${declarations.join(' ')} }` : '';
}

/** 把一段 CSS 注入 HTML 的 `</head>` 之前（没有 head 就插到最前面） */
function injectStyle(html, css) {
  const style = `<style data-story-weave-page>\n${css}\n</style>\n`;
  const head = /<\/head\s*>/i.exec(html);
  if (head) return html.slice(0, head.index) + style + html.slice(head.index);
  return style + html;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

/** 解构 chalkrome 进程输出，只保留前若干字符用于报错 */
function collectOutput(stream, sink) {
  if (!stream) return;
  stream.setEncoding?.('utf8');
  stream.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (sink.value.length < 8000) sink.value += text;
  });
  stream.on('error', () => {});
}

/**
 * 等待 Chrome 把 PDF 写出来。
 *
 * 判定顺序：产物存在且大小非空 → 连续两次大小一致 → 头部为 `%PDF-`。
 * 若 Chrome 已退出而产物始终没有 → 立即失败（不必等满超时）。
 *
 * @returns {Promise<{ok:boolean, bytes:number, reason?:string, timedOut?:boolean}>}
 */
async function waitForPdf({ pdfPath, child, deadline, output, pollMs = 120 }) {
  let exited = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.once('error', (error) => {
    exited = { code: null, signal: null, error };
  });

  let lastSize = -1;
  let stable = 0;

  while (Date.now() < deadline) {
    const size = fileSize(pdfPath);
    if (size > 0 && size === lastSize) {
      stable += 1;
      if (stable >= 2) {
        const verdict = readPdfVerdict(pdfPath);
        if (verdict.complete) return { ok: true, bytes: verdict.bytes };
      }
    } else {
      stable = 0;
    }
    lastSize = size;

    // 加速通道：Chrome 会往 stderr 打 "N bytes written to file"，见到且产物完整即完成
    if (size > 0 && /bytes written to file/i.test(output.value)) {
      const verdict = readPdfVerdict(pdfPath);
      if (verdict.complete) return { ok: true, bytes: verdict.bytes };
    }

    if (exited && size === 0) {
      // 进程已退出但还没有产物：再给文件系统一个落盘窗口，然后判失败
      await sleep(pollMs);
      const verdict = readPdfVerdict(pdfPath);
      if (verdict.complete) return { ok: true, bytes: verdict.bytes };
      const code = exited.error ? exited.error.message : `exitCode=${exited.code}${exited.signal ? `, signal=${exited.signal}` : ''}`;
      return { ok: false, bytes: 0, reason: `Chrome 提前退出（${code}）且未生成 PDF` };
    }

    await sleep(pollMs);
  }

  // 超时：只有在产物确实完整时才视为成功（Chrome 偶尔会在写完 PDF 后不退出），
  // 其余情况一律 ok:false，由调用方降级。
  const verdict = readPdfVerdict(pdfPath);
  if (verdict.complete) return { ok: true, bytes: verdict.bytes, timedOut: true };
  return { ok: false, bytes: 0, reason: '转换超时（未在超时时间内生成 PDF）', timedOut: true };
}

/**
 * 把**已存在的** HTML 文件打印成 PDF。**任何失败都不抛异常**。
 *
 * @param {string} htmlPath 输入 HTML 路径
 * @param {string} pdfPath 输出 PDF 路径
 * @param {object} [opts]
 * @param {string} [opts.paperSize='A4'] 纸张：A4/A3/A5/B5/Letter/Legal/Tabloid 或 `210mm 297mm`；传 null 表示不改写页面尺寸
 * @param {number} [opts.timeoutMs=30000] 超时上限（超时会杀掉 Chrome）
 * @param {string|number|object} [opts.margin] 页边距：`18mm` / `18mm 16mm` / 数字（按 mm）/ `{top,right,bottom,left}`
 * @param {string} [opts.chromePath] 指定 Chrome 路径（等价于环境变量 CHROME_PATH）
 * @returns {Promise<{ok:boolean, pdfPath:string|null, bytes:number, warnings:string[], errors:string[], elapsedMs:number, chrome:string|null}>}
 */
export async function htmlToPdf(htmlPath, pdfPath, opts = {}) {
  const started = Date.now();
  const warnings = [];
  const errors = [];
  const chrome = opts.chromePath || findChrome();
  const fail = (message, extra = {}) => {
    if (message) errors.push(message);
    // 注意：显式传 null（未找到 Chrome）不能被 ?? 当成缺省值再回退到探测结果
    const reported = 'chrome' in extra ? extra.chrome : chrome ?? null;
    return {
      ok: false,
      pdfPath: null,
      bytes: 0,
      warnings: [...warnings],
      errors: [...errors],
      elapsedMs: Date.now() - started,
      chrome: reported,
    };
  };

  const absHtml = path.resolve(String(htmlPath ?? ''));
  const absPdf = path.resolve(String(pdfPath ?? ''));
  const timeoutMs =
    Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 30000;

  // —— 前置校验：输入必须存在 ——
  if (!htmlPath || !existsSync(absHtml)) {
    warnings.push(`找不到输入 HTML：${absHtml || '(空路径)'}`);
    return fail('输入 HTML 不存在');
  }

  // —— 输出目录 ——
  try {
    mkdirSync(path.dirname(absPdf), { recursive: true });
  } catch (error) {
    warnings.push(`无法创建输出目录：${error.message}`);
    return fail(String(error.message));
  }

  // —— Chrome 探测：找不到就优雅降级，不抛异常 ——
  if (!chrome) {
    warnings.push(pdfAvailable().reason, DEGRADE_ADVICE);
    return fail('未找到 Chrome', { chrome: null });
  }
  // 显式传进来的路径若不存在（测试用的假路径也走这里），同样按「未找到」处理
  if (/[\\/]/.test(chrome) && !existsSync(chrome)) {
    warnings.push(`指定的 Chrome 路径不存在：${chrome}`, DEGRADE_ADVICE);
    return fail('未找到 Chrome', { chrome: null });
  }

  // —— 页面尺寸覆盖：写一份临时 HTML 副本，避免改动调用方的文件 ——
  // （CLI 打印模式没有 paperWidth/margin 参数，只能靠注入 @page 控制纸张与边距）
  let printHtmlPath = absHtml;
  let tempHtmlPath = null;
  try {
    const pageStyle = buildPageStyle(opts.paperSize === undefined ? 'A4' : opts.paperSize, opts.margin);
    if (pageStyle) {
      tempHtmlPath = path.join(
        path.dirname(absHtml),
        `.${path.basename(absHtml)}.print-${process.pid}-${rand()}.html`,
      );
      writeFileSync(tempHtmlPath, injectStyle(readFileSync(absHtml, 'utf8'), pageStyle), 'utf8');
      printHtmlPath = tempHtmlPath;
    }
  } catch (error) {
    warnings.push(`无法写入临时打印副本（${error.message}），改用原 HTML 打印。`);
    tempHtmlPath = null;
    printHtmlPath = absHtml;
  }

  // 清掉可能存在的旧产物，否则会把上次的文件误判为本次成功
  try {
    rmSync(absPdf, { force: true });
  } catch {
    /* ignore */
  }

  const profileDir = createProfileDir(path.dirname(absHtml));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-crash-reporter',
    '--hide-scrollbars',
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${absPdf}`,
    '--print-to-pdf-no-header',
    '--no-pdf-header-footer',
    pathToFileURL(printHtmlPath).href,
  ];

  const output = { value: '' };
  let child = null;
  try {
    const spawned = await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(chrome, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32', // 独立进程组，便于整组回收
        });
      } catch (error) {
        resolve({ error });
        return;
      }
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      proc.once('error', (error) => done({ error })); // spawn 失败是异步 error 事件，必须接住
      proc.once('spawn', () => done({ child: proc }));
    });

    if (spawned.error) {
      warnings.push(`无法启动 Chrome（${chrome}）：${spawned.error.message}`, DEGRADE_ADVICE);
      return fail(String(spawned.error.message));
    }
    child = spawned.child;
    child.on('error', () => {}); // 之后的错误（被杀等）不允许冒泡成未捕获异常
    collectOutput(child.stdout, output);
    collectOutput(child.stderr, output);

    const result = await waitForPdf({
      pdfPath: absPdf,
      child,
      deadline: Date.now() + timeoutMs,
      output,
    });

    if (!result.ok) {
      warnings.push(`PDF 转换失败：${result.reason}`, DEGRADE_ADVICE);
      if (output.value.trim()) {
        warnings.push(`Chrome 输出（截断）：${output.value.trim().split('\n').slice(-3).join(' | ')}`);
      }
      return fail(result.reason);
    }

    if (result.timedOut) {
      warnings.push(`Chrome 未在 ${timeoutMs}ms 内退出，但 PDF 已生成且完整，已直接回收进程。`);
    }
    if (fileSize(absPdf) < 1024) {
      warnings.push(`PDF 只有 ${fileSize(absPdf)} 字节，可能是空白页，请检查 HTML 内容。`);
    }

    return {
      ok: true,
      pdfPath: absPdf,
      bytes: result.bytes,
      warnings: [...warnings],
      errors: [...errors],
      elapsedMs: Date.now() - started,
      chrome,
    };
  } catch (error) {
    warnings.push(`生成 PDF 时发生异常：${error?.message ?? error}`, DEGRADE_ADVICE);
    return fail(String(error?.message ?? error));
  } finally {
    killTree(child);
    await sleep(80); // 给进程一点时间释放 profile 目录里的文件
    removeDir(profileDir);
    if (tempHtmlPath) {
      try {
        rmSync(tempHtmlPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export default htmlToPdf;
