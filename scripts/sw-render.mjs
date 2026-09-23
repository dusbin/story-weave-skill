#!/usr/bin/env node
/**
 * scripts/sw-render.mjs — 把产物渲染成 markdown / html / pdf / json 四种格式。
 *
 * 用法：
 *   node scripts/sw-render.mjs --out out
 *   node scripts/sw-render.mjs --out out --no-pdf
 *   node scripts/sw-render.mjs --out out --paper A3
 *
 * 说明：
 *   - markdown / json 由 lib/render.mjs 直接生成（纯函数）。
 *   - html 由 lib/export/html.mjs 生成（离线可用，无外部资源）。
 *   - pdf 用本机 Chrome headless 打印；**找不到 Chrome 时只出 md/html/json 并给出提示，
 *     不报错、不中断**，因为 PDF 只是交付便利，不是产物完整性的必要条件。
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, str, bool, unknownErrors } from './_args.mjs';
import { resolveOutDir, readJsonFile, writeTextFile, banner, ok, warn, info, fail, runAsScript, c, formatBytes, fileSize } from './_io.mjs';
import { renderAll, buildDeliveryMarkdown } from '../lib/render.mjs';
import { mdToHtml, renderHtmlDocument } from '../lib/export/html.mjs';
import { htmlToPdf, pdfAvailable } from '../lib/export/pdf.mjs';
import { safeFilename } from '../lib/util.mjs';

export async function main(argv) {
  const args = parseArgs(argv);
  const unknown = unknownErrors(args);
  if (unknown.length) { for (const u of unknown) warn(u); fail('命令行参数有误', '用 --help 查看支持的参数。'); }
  if (args.help) { printHelp(); return 0; }

  const outDir = resolveOutDir(args);
  const noPdf = bool(args['no-pdf']);
  const noHtml = bool(args['no-html']);
  const paper = str(args.paper) ?? 'A4';

  const artifacts = loadArtifacts(args, outDir);
  const { analysis, plan, story, check } = artifacts;
  if (!analysis && !plan && !story && !check) {
    fail(`在 ${outDir} 里没有找到任何产物`, '请先执行 sw-analyze / sw-plan / sw-weave / sw-check。');
  }

  banner('渲染产物', `${outDir}｜${describe(artifacts)}`);

  // 1) markdown + json（纯函数直出）
  const mdJson = renderAll({ analysis, plan, story, check });
  const written = [];
  for (const item of mdJson) {
    const name = fileNameFor(item.key, ext(item.key, item.ext), { analysis, plan, story });
    const p = writeTextFile(join(outDir, name), item.content);
    written.push(p);
    info(`写出 ${name} ${c('dim', `(${formatBytes(fileSize(p))})`)}`);
  }

  // 2) html
  const htmlTargets = [];
  if (!noHtml) {
    if (story && analysis && plan && check) {
      const delivery = buildDeliveryMarkdown({ analysis, plan, story, check });
      const html = mdToHtml(delivery);
      const doc = renderHtmlDocument({
        title: `《${story.title}》演绎交付文档`,
        subtitle: `${story.modeLabel || story.mode}｜${story.sections.length} 节 / ${story.chars} 字`,
        meta: [
          ['原文指纹', analysis.source?.fingerprint ?? '—'],
          ['常识标尺', analysis.standard?.label ?? '—'],
          ['方案状态', plan.status?.stateLabel ?? '—'],
          ['校验结论', check.verdictLabel ?? check.verdict],
          ['常识得分', `${check.summary?.score} / 100`],
        ],
        bodyHtml: html,
      });
      const p = writeTextFile(join(outDir, `${safeFilename(story.title)}.delivery.html`), doc);
      htmlTargets.push({ path: p, title: story.title, kind: 'delivery' });
      info(`写出 ${c('bold', '交付 HTML')}（含正文 + 演绎说明 + 校验报告）`);
    }
    // 报告类 html
    for (const [key, data] of [['analysis', analysis], ['plan', plan], ['check', check]]) {
      if (!data) continue;
      const item = mdJson.find((m) => m.key === key && m.ext === 'md');
      if (!item) continue;
      const doc = renderHtmlDocument({
        title: titleFor(key, { analysis, plan, story }),
        subtitle: subTitleFor(key, { analysis, plan, story, check }),
        bodyHtml: mdToHtml(item.content),
      });
      const p = writeTextFile(join(outDir, `${key}.html`), doc);
      htmlTargets.push({ path: p, title: titleFor(key), kind: key });
    }
  }

  // 3) pdf
  let pdfResult = null;
  if (!noPdf) {
    const avail = pdfAvailable();
    if (!avail.ok) {
      warn(`未找到 Chrome（${avail.reason ?? '未知原因'}），跳过 PDF`);
      info('markdown / html / json 均已生成，PDF 只是交付便利，不影响产物完整性。');
      info('如需 PDF：安装 Chrome，或设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
    } else {
      // 优先把"交付文档"转成 PDF（那一份才是给人读的完整文档）
      const target = htmlTargets.find((h) => h.kind === 'delivery') ?? htmlTargets[0];
      if (!target) {
        warn('没有可转 PDF 的 HTML');
      } else {
        const pdfPath = join(outDir, `${safeFilename(story?.title ?? 'story')}.delivery.pdf`);
        info(`转换 PDF（${paper}）…`);
        const r = await htmlToPdf(target.path, pdfPath, { paperSize: paper, timeoutMs: Number(str(args.timeout)) || 45000 });
        pdfResult = r;
        if (r.ok) {
          info(`PDF：${formatBytes(r.bytes)}，耗时 ${r.elapsedMs}ms`);
        } else {
          warn(`PDF 转换失败：${(r.errors ?? []).join('；')}`);
          if (r.warnings?.length) for (const w of r.warnings.slice(0, 3)) info(w);
        }
      }
    }
  }

  // 汇总
  process.stdout.write('\n');
  process.stdout.write(`  ${c('bold', '产物清单')}\n`);
  for (const p of written) process.stdout.write(`    ${p}\n`);
  for (const h of htmlTargets) process.stdout.write(`    ${h.path}\n`);
  if (pdfResult?.ok) process.stdout.write(`    ${join(outDir, `${safeFilename(story?.title ?? 'story')}.delivery.pdf`)}\n`);

  ok('渲染完成');
  process.stdout.write(`\n  ${c('dim', `全部产物在：${outDir}`)}\n\n`);
  return 0;
}

function loadArtifacts(args, outDir) {
  const pick = (name, override) => {
    const p = str(override) ?? join(outDir, name);
    return existsSync(p) ? readJsonFile(p) : null;
  };
  return {
    analysis: pick('analysis.json', args.analysis),
    plan: pick('plan.json', args.plan),
    story: pick('story.json', args.story),
    check: pick('check.json', args.check),
  };
}

function describe({ analysis, plan, story, check }) {
  const has = [];
  if (analysis) has.push('分析');
  if (plan) has.push('方案');
  if (story) has.push('正文');
  if (check) has.push('校验');
  return has.length ? `包含：${has.join(' / ')}` : '无产物';
}

function ext(key, fallback) {
  return fallback;
}

function fileNameFor(key, e, { analysis, plan, story }) {
  const title = story?.title ?? plan?.title ?? 'story';
  if (key === 'story') return `${safeFilename(title)}.story.${e}`;
  return `${key}.${e}`;
}

function titleFor(key, { analysis, plan, story } = {}) {
  return {
    analysis: '文本分析报告',
    plan: `演绎方案：${plan?.title ?? ''}`,
    check: `常识校验报告：${story?.title ?? ''}`,
  }[key] ?? key;
}

function subTitleFor(key, { analysis, plan, story, check } = {}) {
  return {
    analysis: `${analysis?.source?.chars ?? 0} 字｜体裁：${analysis?.genre?.label ?? '—'}｜标尺：${analysis?.standard?.label ?? '—'}`,
    plan: `${plan?.modeLabel ?? ''}｜${plan?.scale?.label ?? ''}｜状态：${plan?.status?.stateLabel ?? ''}`,
    check: `${check?.verdictLabel ?? ''}｜得分 ${check?.summary?.score ?? '—'}/100`,
  }[key] ?? '';
}

function printHelp() {
  process.stdout.write(`
sw-render — 渲染 markdown / html / pdf / json 四种格式

用法
  sw-render [--out out] [选项]

参数
  --out <目录>         产物目录（默认 out/）
  --analysis <文件>    指定 analysis.json
  --plan <文件>        指定 plan.json
  --story <文件>       指定 story.json
  --check <文件>       指定 check.json
  --no-pdf             不生成 PDF
  --no-html            不生成 HTML
  --paper <A4|A3|...>  PDF 纸张（默认 A4）
  --timeout <毫秒>     PDF 转换超时（默认 45000）
  --help               显示本帮助

产出
  <out>/analysis.md / .json
  <out>/plan.md / .json
  <out>/<标题>.story.md / .json
  <out>/check.md / .json
  <out>/<标题>.delivery.md / .html / .pdf   交付文档（正文 + 演绎说明 + 校验报告）
  <out>/analysis.html、plan.html、check.html

说明
  找不到 Chrome 时只跳过 PDF 并给出提示，不报错、不中断——PDF 只是交付便利。
`);
}

runAsScript(import.meta.url, main);
