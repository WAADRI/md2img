import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 服务端环境变量配置 */
export const serverConfig = {
  port: int(process.env.PORT, 8307),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || '',
  concurrency: clamp(int(process.env.CONCURRENCY, 4), 1, 16),
  maxBodyKB: clamp(int(process.env.MAX_BODY_KB, 2048), 16, 20480),
  renderTimeoutMs: clamp(int(process.env.RENDER_TIMEOUT_MS, 45000), 5000, 300000),
  imageTimeoutMs: clamp(int(process.env.IMAGE_TIMEOUT_MS, 15000), 1000, 60000),
  chromePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxGetQueryChars: 30000,
};

export const THEMES = ['light', 'dark'];
export const FORMATS = ['png', 'jpeg', 'webp'];
export const FRAMES = ['card', 'plain', 'transparent'];
export const THINK_MODES = ['keep', 'strip'];

/** 请求参数规范化与校验:返回 { ok, value } 或 { ok:false, error } */
export function normalizeOptions(input = {}) {
  const errors = [];
  const o = {};
  const src = (k) => input[k];

  const pickEnum = (k, list, def) => {
    const v = src(k);
    if (v === undefined || v === null || v === '') return def;
    const s = String(v).toLowerCase();
    if (!list.includes(s)) {
      errors.push(`参数 ${k} 的取值必须是 ${list.join(' / ')} 之一,收到: "${v}"`);
      return def;
    }
    return s;
  };
  const pickInt = (k, def, min, max) => {
    const v = src(k);
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors.push(`参数 ${k} 必须是数字,收到: "${v}"`);
      return def;
    }
    return clamp(Math.round(n), min, max);
  };
  const pickBool = (k, def) => {
    const v = src(k);
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    if (['1', 'true', 'yes', 'on', 'y'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', 'n'].includes(s)) return false;
    errors.push(`参数 ${k} 必须是布尔值,收到: "${v}"`);
    return def;
  };
  const pickStr = (k, def, maxLen) => {
    const v = src(k);
    if (v === undefined || v === null || v === '') return def;
    const s = String(v);
    if (s.length > maxLen) {
      errors.push(`参数 ${k} 长度不能超过 ${maxLen}`);
      return def;
    }
    return s;
  };

  o.theme = pickEnum('theme', THEMES, 'light');
  o.format = pickEnum('format', FORMATS, 'png');
  o.frame = pickEnum('frame', FRAMES, pickBool('card', true) ? 'card' : 'plain');
  o.think = pickEnum('think', THINK_MODES, 'keep');
  o.codeTheme = pickStr('codeTheme', '', 40);
  o.mermaidTheme = pickStr('mermaidTheme', '', 20);
  o.width = pickInt('width', 800, 200, 3840);
  o.scale = pickInt('scale', 2, 1, 4);
  o.quality = pickInt('quality', 90, 10, 100);
  o.padding = pickInt('padding', 56, 0, 200);
  o.fontSize = pickInt('fontSize', 15, 10, 32);
  o.title = pickStr('title', '', 300);
  o.footer = pickStr('footer', '', 300);
  o.bgColor = pickStr('bgColor', '', 200);
  o.filename = pickStr('filename', '', 120);
  o.breaks = pickBool('breaks', true);
  o.math = pickBool('math', true);
  o.mermaid = pickBool('mermaid', true);
  o.highlight = pickBool('highlight', true);
  o.highlightAuto = pickBool('highlightAuto', true);
  o.emoji = pickBool('emoji', true);
  o.sanitize = pickBool('sanitize', true);
  o.return = pickEnum('return', ['binary', 'base64'], 'binary');
  o.imageTimeout = pickInt('imageTimeout', serverConfig.imageTimeoutMs, 1000, 60000);

  // 自定义背景色:仅放行常见安全格式(纯色 / 渐变)
  if (o.bgColor) {
    const ok =
      /^#[0-9a-f]{3,8}$/i.test(o.bgColor) ||
      /^(rgba?|hsla?)\([^()]*\)$/i.test(o.bgColor) ||
      /^linear-gradient\([^()]*\)$/i.test(o.bgColor) ||
      /^radial-gradient\([^()]*\)$/i.test(o.bgColor);
    if (!ok) {
      errors.push('参数 bgColor 仅支持 #hex、rgb()/rgba()/hsl()、linear-gradient(...)、radial-gradient(...) 格式');
      o.bgColor = '';
    }
  }

  // KaTeX 自定义宏
  let macros = src('mathMacros');
  if (macros === undefined || macros === null || macros === '') macros = {};
  if (typeof macros !== 'object' || Array.isArray(macros)) {
    errors.push('参数 mathMacros 必须是对象,如 {"RR": "\\\\mathbb{R}"}');
    macros = {};
  } else {
    const clean = {};
    for (const [k, v] of Object.entries(macros)) {
      if (typeof v === 'string' && /^\\?[a-zA-Z][a-zA-Z0-9]*$/.test(k)) clean[k] = v.slice(0, 500);
      else errors.push(`mathMacros 中 "${k}" 不是合法的宏(键需为 \\名称,值为字符串)`);
    }
    macros = clean;
  }
  o.mathMacros = macros;

  // 透明背景只对 png 有意义;jpeg/webp 回退为 plain
  if (o.frame === 'transparent' && o.format !== 'png') {
    o.frame = o.bgColor ? 'card' : 'plain';
  }

  if (errors.length) return { ok: false, error: errors };
  return { ok: true, value: o };
}

/** 从 GET 查询串构造 normalizeOptions 的输入(做基本类型转换) */
export function optionsFromQuery(query = {}) {
  const out = {};
  const numKeys = ['width', 'scale', 'quality', 'padding', 'fontSize', 'imageTimeout'];
  const boolKeys = ['breaks', 'math', 'mermaid', 'highlight', 'highlightAuto', 'emoji', 'sanitize', 'card'];
  for (const [k, v] of Object.entries(query)) {
    if (numKeys.includes(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (boolKeys.includes(k)) {
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}
