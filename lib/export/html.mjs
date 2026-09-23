/**
 * @module export/html
 * 通用渲染管线（与具体数据形状无关）：
 *   1. `mdToHtml(md)`          —— 一份「够用就好」的 Markdown → HTML 转换器；
 *   2. `renderHtmlDocument()`  —— 把若干片段拼成一份可独立打开的完整 HTML 文档；
 *   3. `DEFAULT_CSS`           —— 中文排版友好的打印样式表（零外链，离线可用）。
 *
 * 支持的 Markdown 语法（覆盖本技能实际会用到的部分，不做完整 CommonMark）：
 *   标题 `#`–`######`、段落、无序/有序列表（含嵌套）、GFM 管道表、围栏代码块、
 *   引用块、水平线，以及行内 `**粗体**`、`*斜体*`、`` `代码` ``、`[文本](链接)`。
 *
 * 安全约定：**先做 HTML 转义，再替换 Markdown 标记**，因此正文里的 `<script>` 之类
 * 只会变成可见文本，不会成为标签；`javascript:` 等危险链接协议会被拒绝。
 * 代码块内部不做任何行内替换。
 */

/* ------------------------------------------------------------------ *
 * 行内处理
 * ------------------------------------------------------------------ */

/** 转义 HTML 特殊字符（& 必须最先处理，否则会二次转义） */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 校验链接地址：只允许 http/https/mailto/tel 与相对地址、页内锚点，
 * 拒绝 `javascript:`、`data:`、`vbscript:` 等可执行协议。
 *
 * @param {string} href 已经过 HTML 转义的地址
 * @returns {string|null} 可用则返回地址，否则返回 null
 */
function sanitizeUrl(href) {
  const raw = String(href ?? '').trim();
  if (!raw) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
  if (!scheme) return raw; // 相对路径 / 页内锚点
  const allow = new Set(['http', 'https', 'mailto', 'tel']);
  return allow.has(scheme[1].toLowerCase()) ? raw : null;
}

/**
 * 行内标记 → HTML：
 * 先整体转义，再把行内代码抽成占位符（保护其内容不被后续替换），
 * 然后依次处理链接、粗体、斜体，最后还原占位符。
 *
 * @param {string} text 原始（未转义）行内文本
 * @returns {string} 安全的内联 HTML
 */
function inline(text) {
  let out = escapeHtml(text);

  // 1) 行内代码 → 占位符（占位符用 \u0000 包裹，不会与正文冲突）
  const codes = [];
  out = out.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // 2) 链接：地址不合法时原样输出 Markdown 文本（此时已转义，安全）
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, href) => {
    const url = sanitizeUrl(href);
    if (!url) return match;
    return `<a href="${url}">${label}</a>`;
  });

  // 3) 粗体（先于斜体，避免 **x** 被拆成两个 *）
  out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');

  // 4) 斜体
  out = out.replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>');
  out = out.replace(/(?<![0-9A-Za-z_])_(?=\S)([^_\n]*?\S)_(?![0-9A-Za-z_])/g, '<em>$1</em>');

  // 5) 还原行内代码（内容已在第 1 步之前完成转义）
  return out.replace(/\u0000(\d+)\u0000/g, (_match, index) => `<code>${codes[Number(index)] ?? ''}</code>`);
}

/* ------------------------------------------------------------------ *
 * 块级处理
 * ------------------------------------------------------------------ */

/** 无序列表项：`- x` / `* x` / `+ x`（不含 `---` 这类水平线） */
const ITEM_UNORDERED = /^(\s*)([-*+])\s+(.*)$/;
/** 有序列表项：`1. x` / `1) x` */
const ITEM_ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
/** 表格分隔行：`| --- | :--: |` */
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** 水平线：`---` / `***` / `___`（3 个以上，中间可带空格） */
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
/** 标题 */
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** 围栏代码块起始（``` 或 ~~~，可带语言） */
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)\s*$/;

/** 匹配列表项，返回缩进 / 类型 / 文本，非列表项返回 null */
function matchItem(line) {
  const unordered = ITEM_UNORDERED.exec(line);
  if (unordered) return { indent: unordered[1].length, ordered: false, text: unordered[3], number: 1 };
  const ordered = ITEM_ORDERED.exec(line);
  if (ordered) return { indent: ordered[1].length, ordered: true, text: ordered[3], number: Number(ordered[2]) };
  return null;
}

/** 找到从 index 起第一个非空行，返回其下标（找不到返回 -1） */
function nextNonBlank(lines, index) {
  for (let i = index; i < lines.length; i++) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

/**
 * 按未转义的 `|` 切分表格行：支持 `\|` 转义，并忽略行内代码里的竖线。
 * `\|` 在这里就还原成字面量 `|`。
 *
 * @param {string} row 原始表格行
 * @returns {string[]} 单元格文本（已 trim，已去掉首尾管道产生的空单元）
 */
function splitRow(row) {
  const cells = [];
  let buffer = '';
  let inCode = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') {
      buffer += '|'; // \| → 字面量竖线，不参与切分
      i++;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      buffer += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  cells.push(buffer);

  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/** 判断 lines[i] 是否是一张 GFM 管道表的表头（下一行必须是分隔行） */
function isTableStart(lines, i) {
  const head = lines[i];
  const delim = lines[i + 1];
  if (head === undefined || delim === undefined) return false;
  if (!head.includes('|') || !delim.includes('|')) return false;
  return TABLE_DELIM.test(delim);
}

/** 解析分隔行 → 各列对齐方式（left / center / right） */
function parseAlignments(delimRow) {
  return splitRow(delimRow).map((cell) => {
    const m = /^(:)?-+(:)?$/.exec(cell);
    if (!m) return 'left';
    if (m[1] && m[2]) return 'center';
    if (m[2]) return 'right';
    return 'left';
  });
}

/** 对齐方式 → 内联样式（left 为默认值，不输出样式） */
function alignStyle(align) {
  return align && align !== 'left' ? ` style="text-align:${align}"` : '';
}

/**
 * 解析一个列表块（递归支持嵌套列表）。
 *
 * @param {string[]} lines 全部行
 * @param {number} start 起始行号
 * @param {number} baseIndent 本层缩进
 * @param {boolean} ordered 是否有序
 * @returns {{html:string, next:number}}
 */
function parseList(lines, start, baseIndent, ordered) {
  const items = [];
  let current = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      // 空行：只有当后面还有属于本列表的项时才继续（松散列表）
      const next = nextNonBlank(lines, i);
      const candidate = next === -1 ? null : matchItem(lines[next]);
      if (candidate && candidate.indent >= baseIndent) {
        i = next;
        continue;
      }
      break;
    }

    const item = matchItem(line);
    if (item && item.indent >= baseIndent) {
      if (item.indent > baseIndent && current) {
        // 更深缩进 → 作为上一个列表项的子列表（递归）
        const sub = parseList(lines, i, item.indent, item.ordered);
        current.children.push(sub.html);
        i = sub.next;
        continue;
      }
      if (item.ordered !== ordered) break; // 同缩进但换了列表类型 → 新列表
      current = { text: item.text, number: item.number, children: [] };
      items.push(current);
      i++;
      continue;
    }

    // 续行：缩进的普通文本接到上一项后面
    if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
      i++;
      continue;
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAt = ordered && items.length > 0 && items[0].number !== 1 ? ` start="${items[0].number}"` : '';
  const body = items
    .map((item) => `<li>${inline(item.text)}${item.children.join('')}</li>`)
    .join('\n');
  return { html: `<${tag}${startAt}>\n${body}\n</${tag}>`, next: i };
}

/**
 * 逐行解析块级结构。
 *
 * @param {string[]} lines
 * @returns {string} HTML（块与块之间用换行分隔）
 */
function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // —— 围栏代码块：内部不做任何行内替换 ——
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = /^[A-Za-z0-9_+#.-]{1,32}$/.test(fence[2]) ? fence[2] : '';
      const buffer = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        buffer.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳过收尾围栏
      const cls = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buffer.join('\n'))}</code></pre>`);
      continue;
    }

    // —— 水平线 ——
    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // —— 标题 ——
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // —— 引用块：收集连续的 `>` 行，内部再按 Markdown 解析一次 ——
    if (/^\s{0,3}>/.test(line)) {
      const buffer = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>\n${renderBlocks(normalizeLines(buffer.join('\n')))}\n</blockquote>`);
      continue;
    }

    // —— 表格 ——
    if (isTableStart(lines, i)) {
      const headers = splitRow(lines[i]);
      const aligns = parseAlignments(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const headHtml = headers
        .map((cell, index) => `<th${alignStyle(aligns[index])}>${inline(cell)}</th>`)
        .join('');
      const bodyHtml = rows
        .map((row) => {
          // 按表头列数对齐：多了截断，少了补空
          const cells = headers.map((_h, index) => row[index] ?? '');
          return `<tr>${cells
            .map((cell, index) => `<td${alignStyle(aligns[index])}>${inline(cell)}</td>`)
            .join('')}</tr>`;
        })
        .join('\n');
      out.push(
        `<table>\n<thead>\n<tr>${headHtml}</tr>\n</thead>\n` +
          (bodyHtml ? `<tbody>\n${bodyHtml}\n</tbody>\n` : '') +
          '</table>',
      );
      continue;
    }

    // —— 列表 ——
    const item = matchItem(line);
    if (item) {
      const list = parseList(lines, i, item.indent, item.ordered);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // —— 段落：连续的非空、非块起始行 ——
    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) break;
      if (paragraph.length > 0 && startsBlock(lines, i)) break;
      paragraph.push(current.trim());
      i++;
    }
    out.push(`<p>${inline(paragraph.join('\n'))}</p>`);
  }

  return out.join('\n');
}

/** 判断该行是否开启一个新的块（用于结束段落） */
function startsBlock(lines, i) {
  const line = lines[i];
  return (
    FENCE.test(line) ||
    HR.test(line) ||
    HEADING.test(line) ||
    /^\s{0,3}>/.test(line) ||
    matchItem(line) !== null ||
    isTableStart(lines, i)
  );
}

/** 统一换行符与制表符（制表符按 4 空格展开，便于按缩进判断嵌套） */
function normalizeLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');
}

/**
 * Markdown → HTML 片段（不含 `<html>` 外壳）。
 *
 * @param {string} md Markdown 文本
 * @returns {string} HTML 片段
 */
export function mdToHtml(md) {
  return renderBlocks(normalizeLines(md));
}

/* ------------------------------------------------------------------ *
 * 完整 HTML 文档
 * ------------------------------------------------------------------ */

/** 把 meta 归一化成 [{label, value}] */
function normalizeMeta(meta) {
  if (meta === null || meta === undefined || meta === '') return [];
  const entries = [];
  const push = (label, value) => {
    if (value === null || value === undefined) return;
    entries.push({ label: String(label ?? ''), value: String(value) });
  };
  if (typeof meta === 'string' || typeof meta === 'number') {
    push('', meta);
  } else if (Array.isArray(meta)) {
    for (const item of meta) {
      if (Array.isArray(item)) push(item[0], item[1]);
      else if (item && typeof item === 'object') push(item.label ?? item.key ?? '', item.value);
      else push('', item);
    }
  } else if (typeof meta === 'object') {
    for (const [key, value] of Object.entries(meta)) push(key, value);
  }
  return entries;
}

/** 渲染 `.doc-meta` 区块（生成时间 / 输入指纹等） */
function renderMeta(meta) {
  const entries = normalizeMeta(meta);
  if (entries.length === 0) return '';
  const body = entries
    .map(({ label, value }) => {
      const dt = label ? `<dt>${escapeHtml(label)}</dt>` : '<dt class="doc-meta-empty"></dt>';
      return `${dt}<dd>${escapeHtml(value)}</dd>`;
    })
    .join('\n');
  return `<dl class="doc-meta">\n${body}\n</dl>`;
}

/**
 * 拼装一份可独立打开的完整 HTML 文档（UTF-8、离线、无任何外部资源）。
 *
 * @param {object} options
 * @param {string} [options.title] 文档标题（同时写入 `<title>` 与页首大标题）
 * @param {string} [options.subtitle] 副标题
 * @param {object|Array|string} [options.meta] 元信息（生成时间 / 输入指纹等）
 * @param {string} [options.bodyHtml] 正文 HTML（通常来自 mdToHtml）
 * @param {string} [options.css] 自定义样式；省略时使用 DEFAULT_CSS
 * @returns {string} 完整 HTML 文档字符串
 */
export function renderHtmlDocument({ title, subtitle, meta, bodyHtml, css } = {}) {
  const docTitle = title === undefined || title === null || title === '' ? '未命名文档' : String(title);
  const style = css === undefined || css === null ? DEFAULT_CSS : String(css);
  const header = [
    `<h1 class="doc-title">${escapeHtml(docTitle)}</h1>`,
    subtitle ? `<p class="doc-subtitle">${escapeHtml(subtitle)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="story-weave-skill">
<title>${escapeHtml(docTitle)}</title>
<style>
${style.replace(/<\/style/gi, '<\\/style')}
</style>
</head>
<body>
<main class="doc">
<header class="doc-header">
${header}
</header>
${renderMeta(meta)}
<section class="doc-body">
${bodyHtml ? String(bodyHtml) : ''}
</section>
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * 默认样式
 * ------------------------------------------------------------------ */

/**
 * 默认打印样式表：中文排版友好、A4 分页、零外链（不引用任何 CDN / 网络字体），
 * 直接交给 Chrome headless 打印即可得到与屏幕一致的 PDF。
 */
export const DEFAULT_CSS = `/* story-weave 默认打印样式（离线可用，无任何外部资源） */
*, *::before, *::after { box-sizing: border-box; }

:root {
  --ink: #1f2328;
  --ink-soft: #5b6673;
  --line: #ccd3dc;
  --line-soft: #e6e9ee;
  --bg-soft: #f6f8fa;
  --accent: #2f5d8a;
}

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  padding: 32px 20px 64px;
  background: #ffffff;
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
  font-size: 16px;
  line-height: 1.75;
  overflow-wrap: break-word;
  text-align: justify;
}

.doc { max-width: 820px; margin: 0 auto; }

/* —— 标题区 —— */
.doc-header { margin-bottom: 1.2em; }
.doc-title {
  margin: 0 0 .3em;
  padding-bottom: .35em;
  font-size: 1.85em;
  line-height: 1.35;
  border-bottom: 2px solid var(--accent);
  break-after: avoid;
  page-break-after: avoid;
}
.doc-subtitle { margin: 0; color: var(--ink-soft); font-size: 1.02em; }

/* —— 元信息区（生成时间 / 输入指纹等） —— */
.doc-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0 0 1.6em;
  padding: .7em .9em;
  background: var(--bg-soft);
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  font-size: .88em;
  line-height: 1.6;
  color: var(--ink-soft);
  text-align: left;
  break-inside: avoid;
  page-break-inside: avoid;
}
.doc-meta dt { font-weight: 600; color: var(--ink); white-space: nowrap; }
.doc-meta dt.doc-meta-empty { display: none; }
.doc-meta dd { margin: 0; word-break: break-all; }

/* —— 正文块 —— */
.doc-body > :first-child { margin-top: 0; }

h1, h2, h3, h4, h5, h6 {
  margin: 1.6em 0 .6em;
  line-height: 1.4;
  font-weight: 600;
  text-align: left;
  break-after: avoid;
  page-break-after: avoid;
}
h1 { font-size: 1.6em; }
h2 { font-size: 1.35em; padding-bottom: .25em; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.15em; }
h4 { font-size: 1.05em; }
h5, h6 { font-size: 1em; color: var(--ink-soft); }

p { margin: 0 0 1em; }

a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

hr { height: 1px; margin: 2em 0; border: 0; background: var(--line); }

ul, ol { margin: 0 0 1em; padding-left: 1.7em; }
li { margin: .25em 0; }
li > ul, li > ol { margin: .25em 0; }

blockquote {
  margin: 1em 0;
  padding: .6em 1em;
  background: #f8fafc;
  border-left: 3px solid var(--accent);
  border-radius: 0 4px 4px 0;
  color: var(--ink-soft);
  break-inside: avoid;
  page-break-inside: avoid;
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }

/* —— 代码 —— */
code {
  padding: .12em .35em;
  font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: .9em;
  background: var(--bg-soft);
  border: 1px solid var(--line-soft);
  border-radius: 4px;
  word-break: break-word;
}
pre {
  margin: 0 0 1.2em;
  padding: .8em 1em;
  background: var(--bg-soft);
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  overflow-x: auto;
  line-height: 1.6;
  text-align: left;
  break-inside: avoid;
  page-break-inside: avoid;
}
pre code {
  padding: 0;
  background: none;
  border: 0;
  font-size: .88em;
  white-space: pre-wrap;
  word-break: break-word;
}

/* —— 表格：有边框、表头底色、长表格不溢出 —— */
table {
  width: 100%;
  margin: 0 0 1.4em;
  border-collapse: collapse;
  font-size: .94em;
  line-height: 1.6;
  table-layout: auto;
  break-inside: avoid;
  page-break-inside: avoid;
}
th, td {
  padding: .45em .7em;
  border: 1px solid var(--line);
  vertical-align: top;
  text-align: left;
  overflow-wrap: break-word;
  word-break: break-word;
}
thead th {
  background: var(--bg-soft);
  font-weight: 600;
  white-space: nowrap;
}
tbody tr:nth-child(even) { background: #fbfcfd; }

img, svg { max-width: 100%; height: auto; }

/* —— 打印 —— */
@media print {
  @page { size: A4; margin: 18mm 16mm; }

  body { padding: 0; background: #fff; }
  .doc { max-width: none; }

  a { color: inherit; text-decoration: none; }

  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }

  table, pre, blockquote, figure, .doc-meta, img {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* 长表格跨页时重复表头 */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
}
`;

export default { mdToHtml, renderHtmlDocument, DEFAULT_CSS };
