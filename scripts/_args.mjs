/**
 * scripts/_args.mjs — 命令行参数解析。纯函数（不读文件）。
 *
 * 支持：
 *   --key value        取值
 *   --key=value        取值
 *   --key              布尔开关（下一个 token 以 -- 开头或不存在时）
 *   --key a --key b    重复出现 → 数组
 *   -k                 短开关
 *   位置参数           进 positionals
 *
 * 刻意不引第三方库：本技能零依赖，且在解析层出错会浪费使用者大量时间，
 * 所以这里对未知参数直接报错（而不是静默忽略拼错的 --scal short）。
 */

const FLAG_KEYS = new Set([
  'help', 'h', 'version', 'json', 'quiet', 'verbose', 'force', 'dry-run', 'yes', 'list',
]);

export function parseArgs(argv = []) {
  const out = { _: [], _unknown: [] };
  const tokens = argv.slice();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok === '--') { out._.push(...tokens.slice(i + 1)); break; }

    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      let key;
      let value;

      if (eq >= 0) {
        key = body.slice(0, eq);
        value = body.slice(eq + 1);
      } else {
        key = body;
        const next = tokens[i + 1];
        const isFlag = FLAG_KEYS.has(key);
        if (!isFlag && next !== undefined && !next.startsWith('--')) {
          value = next;
          i++;
        } else if (isFlag) {
          value = true;
        } else if (next !== undefined && next.startsWith('--')) {
          // 需要值却给了下一个开关：报错而不是静默当成 true
          out._unknown.push({ key, reason: `--${key} 需要一个值，但后面紧跟 --${next.slice(2)}` });
          value = undefined;
        } else {
          value = true;
        }
      }
      assign(out, key, value);
      continue;
    }

    if (tok.startsWith('-') && tok.length > 1 && tok !== '-') {
      const key = tok.slice(1);
      if (!FLAG_KEYS.has(key)) { out._unknown.push({ key, reason: `未知的短开关 -${key}` }); continue; }
      assign(out, key, true);
      continue;
    }

    out._.push(tok);
  }

  return out;
}

function assign(out, key, value) {
  if (key in out) {
    if (Array.isArray(out[key])) out[key].push(value);
    else out[key] = [out[key], value];
  } else {
    out[key] = value;
  }
}

/** 取值为字符串（数组取最后一个） */
export function str(v, fallback = undefined) {
  if (v === undefined || v === null) return fallback;
  if (Array.isArray(v)) return v.length ? String(v[v.length - 1]) : fallback;
  if (v === true) return fallback;
  return String(v);
}

/** 取值为布尔 */
export function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(Array.isArray(v) ? v[v.length - 1] : v).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return fallback;
}

/** 取值为数字 */
export function num(v, fallback = undefined) {
  const s = str(v);
  if (s === undefined) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** 拆成数组：既支持重复传参，也支持逗号分隔 */
export function list(v) {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((x) => String(x).split(',').map((s) => s.trim()).filter(Boolean));
}

/** 解析 key=value 列表（用于 --note ch1=xxx） */
export function kvList(v) {
  const out = {};
  for (const item of list(v)) {
    const eq = item.indexOf('=');
    if (eq < 0) continue;
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return out;
}

/** 未知参数的友好报错文本 */
export function unknownErrors(args) {
  return (args._unknown ?? []).map((u) => `参数错误：${u.reason}`);
}
