/**
 * 通用渲染管线测试：markdown → html → pdf。
 * 运行：node --test test/export.test.mjs
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CSS, mdToHtml, renderHtmlDocument } from '../lib/export/html.mjs';
import { findChrome, htmlToPdf, pdfAvailable } from '../lib/export/pdf.mjs';

/* ------------------------------------------------------------------ *
 * 临时目录
 * ------------------------------------------------------------------ */

const tempDirs = [];

/** 建一个测试用临时目录，测试结束后统一清理 */
function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'story-weave-export-test-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* 清理失败不影响测试结论 */
    }
  }
});

/* ------------------------------------------------------------------ *
 * mdToHtml
 * ------------------------------------------------------------------ */

test('mdToHtml：标题 1–4 级', () => {
  const html = mdToHtml('# 一级\n\n## 二级\n\n### 三级\n\n#### 四级');
  assert.match(html, /<h1>一级<\/h1>/);
  assert.match(html, /<h2>二级<\/h2>/);
  assert.match(html, /<h3>三级<\/h3>/);
  assert.match(html, /<h4>四级<\/h4>/);
});

test('mdToHtml：段落', () => {
  const html = mdToHtml('第一段。\n\n第二段第一行\n第二行。');
  const paragraphs = html.split('\n').filter((line) => line.startsWith('<p>'));
  assert.equal(paragraphs.length, 2);
  assert.match(html, /<p>第一段。<\/p>/);
  assert.match(html, /<p>第二段第一行\n第二行。<\/p>/);
});

test('mdToHtml：无序列表与有序列表', () => {
  const unordered = mdToHtml('- 甲\n- 乙\n- 丙');
  assert.match(unordered, /<ul>/);
  assert.equal((unordered.match(/<li>/g) || []).length, 3);
  assert.match(unordered, /<li>甲<\/li>/);

  const ordered = mdToHtml('1. 第一\n2. 第二');
  assert.match(ordered, /<ol>/);
  assert.equal((ordered.match(/<li>/g) || []).length, 2);

  // 有序列表不从 1 开始时保留 start
  assert.match(mdToHtml('3. 第三\n4. 第四'), /<ol start="3">/);
});

test('mdToHtml：列表嵌套一层', () => {
  const html = mdToHtml('- 外层一\n  - 内层甲\n  - 内层乙\n- 外层二');
  assert.match(html, /<ul>/);
  assert.match(html, /<li>外层一<ul>/);
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.match(html, /<li>外层二<\/li>/);
});

test('mdToHtml：GFM 管道表（表头/对齐/表体）', () => {
  const html = mdToHtml('| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| 甲 | 3 | 好 |\n| 乙 | 12 | 一般 |');
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.equal((html.match(/<th[ >]/g) || []).length, 3);
  assert.equal((html.match(/<td/g) || []).length, 6);
  assert.match(html, /<th>名称<\/th>/);
  assert.match(html, /<th style="text-align:right">数量<\/th>/);
  assert.match(html, /<th style="text-align:center">备注<\/th>/);
  assert.match(html, /<td>乙<\/td>/);
  // 列数不足的行补空单元格，多的截断
  const ragged = mdToHtml('| a | b |\n| --- | --- |\n| 只有一个 |');
  assert.equal((ragged.match(/<td[^>]*>/g) || []).length, 2);
});

test('mdToHtml：表格单元格里的 \\| 转义不参与切分', () => {
  const html = mdToHtml('| 表达式 | 含义 |\n| --- | --- |\n| a \\| b | 逻辑或 |\n| c \\\\| d | 反斜杠加竖线 |');
  // 每个数据行仍然是 2 个单元格
  const cells = html.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
  assert.equal(cells.length, 4);
  assert.match(html, /<td>a \| b<\/td>/);
  assert.match(html, /<td>逻辑或<\/td>/);
  // 转义后的竖线是文本，不是标签
  assert.ok(!html.includes('<td>a <'));
});

test('mdToHtml：行内加粗 / 斜体 / 行内代码 / 链接', () => {
  const html = mdToHtml('这是 **加粗** 与 *斜体* 与 `code()` 与 [链接](https://example.com/a?b=1)。');
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>code\(\)<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1">链接<\/a>/);
});

test('mdToHtml：围栏代码块内部不做行内替换，且被转义', () => {
  const html = mdToHtml('```js\nconst a = **b**;\nif (a < 3) { c(`x`); }\n```');
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const a = \*\*b\*\*;/);
  assert.ok(!html.includes('<strong>'));
  assert.match(html, /if \(a &lt; 3\)/);
  assert.ok(!html.includes('c(<code>'));
  assert.match(html, /<\/code><\/pre>/);
});

test('mdToHtml：引用块、水平线', () => {
  const html = mdToHtml('> 引用第一行\n> 引用第二行\n\n---\n\n正文');
  assert.match(html, /<blockquote>/);
  assert.match(html, /引用第一行/);
  assert.match(html, /<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('mdToHtml：HTML 转义（XSS：<script> 必须被转义）', () => {
  const html = mdToHtml('危险内容 <script>alert("xss")</script> 结束');
  assert.ok(!html.includes('<script'), '不得产出真实 script 标签');
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);

  // 标题、表格、代码块里的标签同样被转义
  assert.match(mdToHtml('# <img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(mdToHtml('| a |\n| --- |\n| <b>粗</b> |'), /&lt;b&gt;粗&lt;\/b&gt;/);
  assert.match(mdToHtml('```\n<script>x</script>\n```'), /&lt;script&gt;x&lt;\/script&gt;/);

  // 危险协议的链接不产出 a 标签，原文以文本形式保留
  const jsLink = mdToHtml('[点我](javascript:alert(1))');
  assert.ok(!jsLink.includes('<a '), 'javascript: 链接必须被拒绝');
  assert.match(jsLink, /\[点我\]\(javascript:alert\(1\)\)/);
});

test('mdToHtml：空输入与极端输入不抛异常', () => {
  assert.equal(mdToHtml(''), '');
  assert.equal(mdToHtml(undefined), '');
  assert.equal(typeof mdToHtml('**未闭合\n\n- 单项\n\n| 只有一个管道 |\n'), 'string');
});

/* ------------------------------------------------------------------ *
 * renderHtmlDocument
 * ------------------------------------------------------------------ */

test('renderHtmlDocument：产出完整可独立打开的文档', () => {
  const html = renderHtmlDocument({
    title: '故事演绎报告',
    subtitle: 'story-weave',
    meta: { 生成时间: '2026-01-01 00:00', 输入指纹: 'abcdef' },
    bodyHtml: mdToHtml('# 标题\n\n正文'),
  });
  assert.ok(html.startsWith('<!doctype html>'), '必须以 <!doctype html> 开头');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>故事演绎报告<\/title>/);
  assert.match(html, /<h1 class="doc-title">故事演绎报告<\/h1>/);
  assert.match(html, /class="doc-subtitle">story-weave</);
  assert.match(html, /class="doc-meta"/);
  assert.match(html, /生成时间/);
  assert.match(html, /<h1>标题<\/h1>/); // bodyHtml 原样嵌入
  // 零外部资源：不引用 http(s) 资源
  assert.ok(!/src=["']https?:/.test(html));
  assert.ok(!/href=["']https?:/.test(html));
});

test('renderHtmlDocument：标题与 meta 里的事件属性被转义', () => {
  const html = renderHtmlDocument({ title: '<img src=x onerror=alert(1)>', meta: { a: '<script>' } });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /<title>&lt;img src=x onerror=alert\(1\)&gt;<\/title>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderHtmlDocument：默认标题与自定义 CSS', () => {
  assert.match(renderHtmlDocument({}), /<title>未命名文档<\/title>/);
  const custom = renderHtmlDocument({ title: 'x', bodyHtml: '<p>y</p>', css: 'body{color:red}' });
  assert.match(custom, /body\{color:red\}/);
  assert.ok(!custom.includes('.doc-meta {'), '自定义 css 应替换默认样式');
});

test('DEFAULT_CSS：中文字体栈与打印规则齐备', () => {
  assert.match(DEFAULT_CSS, /"PingFang SC"/);
  assert.match(DEFAULT_CSS, /"Microsoft YaHei"/);
  assert.match(DEFAULT_CSS, /"Noto Sans CJK SC"/);
  assert.match(DEFAULT_CSS, /font-size: 16px/);
  assert.match(DEFAULT_CSS, /line-height: 1\.75/);
  assert.match(DEFAULT_CSS, /@media print/);
  assert.match(DEFAULT_CSS, /@page \{ size: A4; margin: 18mm 16mm; \}/);
  assert.match(DEFAULT_CSS, /break-inside: avoid/);
  assert.match(DEFAULT_CSS, /break-after: avoid/);
  assert.match(DEFAULT_CSS, /\.doc-meta/);
  // 零外链
  assert.ok(!/url\(/.test(DEFAULT_CSS));
  assert.ok(!/@import/.test(DEFAULT_CSS));
});

/* ------------------------------------------------------------------ *
 * findChrome / pdfAvailable
 * ------------------------------------------------------------------ */

test('findChrome：返回 null 或一个真实存在的路径', () => {
  const chrome = findChrome();
  if (chrome === null) {
    assert.equal(chrome, null);
    return;
  }
  assert.equal(typeof chrome, 'string');
  assert.ok(existsSync(chrome), `findChrome 返回了不存在的路径：${chrome}`);
});

test('pdfAvailable：形状正确，且与 findChrome 一致', () => {
  const available = pdfAvailable();
  assert.equal(typeof available.ok, 'boolean');
  assert.equal(typeof available.reason, 'string');
  const chrome = findChrome();
  assert.equal(available.ok, chrome !== null);
  assert.equal(available.chrome, chrome);
  if (!available.ok) assert.ok(available.reason.length > 0);
});

/* ------------------------------------------------------------------ *
 * htmlToPdf
 * ------------------------------------------------------------------ */

test('htmlToPdf：找不到 Chrome 时返回 ok:false 而不抛异常', async () => {
  const dir = makeTempDir();
  const htmlPath = path.join(dir, 'input.html');
  const pdfPath = path.join(dir, 'output.pdf');
  writeFileSync(htmlPath, renderHtmlDocument({ title: '探测用', bodyHtml: mdToHtml('# 你好') }), 'utf8');

  const result = await htmlToPdf(htmlPath, pdfPath, {
    chromePath: path.join(dir, 'chrome-does-not-exist', 'chrome'),
    timeoutMs: 3000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.bytes, 0);
  assert.ok(result.errors.includes('未找到 Chrome'), `errors 应包含「未找到 Chrome」，实际：${JSON.stringify(result.errors)}`);
  assert.ok(result.warnings.length > 0);
  assert.ok(Number.isFinite(result.elapsedMs));
  assert.ok(!existsSync(pdfPath), '不应留下空的 PDF 产物');
  assert.equal(result.chrome, null);
});

test('htmlToPdf：输入 HTML 不存在时也不抛异常', async () => {
  const dir = makeTempDir();
  const result = await htmlToPdf(path.join(dir, 'nope.html'), path.join(dir, 'out.pdf'), { timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.bytes, 0);
});

test('htmlToPdf：真实转换（无 Chrome 则跳过）', async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip('本机未找到 Chrome/Chromium/Edge，跳过真实 PDF 转换测试');
    return;
  }

  const dir = makeTempDir();
  const htmlPath = path.join(dir, 'report.html');
  const pdfPath = path.join(dir, 'report.pdf');
  writeFileSync(
    htmlPath,
    renderHtmlDocument({
      title: '渲染管线自测',
      subtitle: '中文排版样本',
      meta: { 生成时间: new Date().toISOString(), Chrome: chrome },
      bodyHtml: mdToHtml(
        '# 一级标题\n\n这是一段中文正文，用于验证字体、行高与分页样式。**加粗**、*斜体*、`code`。\n\n' +
          '| 项目 | 值 |\n| --- | ---: |\n| 纸张 | A4 |\n| 边距 | 18mm |\n\n' +
          '- 列表甲\n- 列表乙\n\n```js\nconsole.log("hi");\n```\n\n> 引用块。\n',
      ),
    }),
    'utf8',
  );

  const result = await htmlToPdf(htmlPath, pdfPath, { paperSize: 'A4', timeoutMs: 45000 });

  assert.equal(result.ok, true, `转换失败：${JSON.stringify(result.errors)} ${JSON.stringify(result.warnings)}`);
  assert.ok(result.bytes > 0, `bytes 应为正数，实际 ${result.bytes}`);
  assert.ok(existsSync(pdfPath), 'PDF 文件应存在');
  assert.equal(statSync(pdfPath).size, result.bytes, 'bytes 应与磁盘文件大小一致');
  assert.equal(readFileSync(pdfPath).subarray(0, 5).toString('latin1'), '%PDF-', '产物应是合法 PDF');
  assert.ok(result.errors.length === 0, `不应有 errors：${JSON.stringify(result.errors)}`);
  assert.equal(result.chrome, chrome);

  // 临时打印副本与临时 user-data-dir 必须被清理干净
  const leftovers = readdirSync(dir).filter((name) => name !== 'report.html' && name !== 'report.pdf');
  assert.deepEqual(leftovers, [], `转换后目录里不应留下临时文件：${JSON.stringify(leftovers)}`);
});
