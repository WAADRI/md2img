/**
 * Markdown 渲染管线:
 *  - <think> 标签预处理(保留为浅色"思考过程"卡片或剔除)
 *  - LaTeX 数学公式预提取(防止 markdown 语法破坏公式,支持 $...$ / $$...$$ / \(...\) / \[...\] / \begin{env})
 *  - markdown-it(GFM 表格/删除线/任务列表/emoji/linkify)
 *  - 代码块 highlight.js 高亮(未指定语言时自动探测)+ Mermaid 图表
 *  - 内嵌 HTML 的 token 级净化(白名单)
 */
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import * as emojiModule from 'markdown-it-emoji';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import sanitizeHtml from 'sanitize-html';

// ---------------------------------------------------------------- 基础工具

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'aligned', 'gather', 'gather*', 'gathered',
  'multline', 'multline*', 'split', 'eqnarray', 'eqnarray*', 'cases', 'dcases', 'rcases',
  'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
  'smallmatrix', 'subarray', 'darray', 'CD',
]);

// 占位符使用 Unicode 私有区字符,不会被 markdown-it 的转义/排版规则改动
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';
const PH_RE = /(\uE000\d+\uE001)/;
const PH_FULL_RE = /^\uE000(\d+)\uE001$/;

// ---------------------------------------------------------------- 数学公式提取

/**
 * 扫描源文本,把 LaTeX 公式替换为占位符并记录公式内容。
 * 代码块 / 行内代码中的 $ 不参与匹配;`\$` 转义保持字面量。
 * 行内 $...$ 带货币金额启发式防误判(如 "$5 and $10" 不会当作公式)。
 */
function extractMath(src) {
  const items = [];
  const n = src.length;
  let out = '';
  let i = 0;

  const push = (tex, display) => {
    const t = tex.trim();
    if (!t) return false;
    items.push({ tex: t, display });
    out += `${PH_OPEN}${items.length - 1}${PH_CLOSE}`;
    return true;
  };

  while (i < n) {
    const ch = src[i];
    const atLineStart = i === 0 || src[i - 1] === '\n';

    // 1) 围栏代码块 —— 原样保留
    if (atLineStart && (ch === '`' || ch === '~' || ch === ' ')) {
      let p = i;
      let sp = 0;
      while (p < n && src[p] === ' ' && sp < 3) { sp++; p++; }
      if (p < n && (src[p] === '`' || src[p] === '~')) {
        const mark = src[p];
        let run = 0;
        let q = p;
        while (q < n && src[q] === mark) { run++; q++; }
        if (run >= 3) {
          const closeRe = new RegExp(`^ {0,3}${mark}{${run},}\\s*$`);
          let pos2 = src.indexOf('\n', q);
          pos2 = pos2 === -1 ? n : pos2 + 1;
          let end = n;
          let closed = false;
          while (pos2 < n) {
            const nl = src.indexOf('\n', pos2);
            const lineEnd = nl === -1 ? n : nl;
            if (closeRe.test(src.slice(pos2, lineEnd))) {
              end = nl === -1 ? n : nl + 1;
              closed = true;
              break;
            }
            if (nl === -1) break;
            pos2 = nl + 1;
          }
          const stop = closed ? end : n;
          out += src.slice(i, stop);
          i = stop;
          continue;
        }
      }
    }

    // 2) 行内代码 —— 原样保留
    if (ch === '`') {
      let run = 0;
      let p = i;
      while (p < n && src[p] === '`') { run++; p++; }
      const m = new RegExp(`\`${run}\`(?!\`)`).exec(src.slice(p));
      if (m) {
        const end = p + m.index + run;
        out += src.slice(i, end);
        i = end;
      } else {
        out += src.slice(i, p);
        i = p;
      }
      continue;
    }

    // 3) 反斜杠:LaTeX 定界符优先,其次 markdown 转义
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '[' || next === '(') {
        const closer = next === '[' ? '\\]' : '\\)';
        const end = src.indexOf(closer, i + 2);
        if (end !== -1) {
          push(src.slice(i + 2, end), next === '[');
          i = end + 2;
          continue;
        }
      }
      if (next === 'b') {
        const m = /^\\begin\s*\{([a-zA-Z*]+)\}/.exec(src.slice(i));
        if (m && MATH_ENVS.has(m[1])) {
          const endTag = `\\end{${m[1]}}`;
          const end = src.indexOf(endTag, i);
          if (end !== -1) {
            push(src.slice(i, end + endTag.length), true);
            i = end + endTag.length;
            continue;
          }
        }
      }
      if (next !== undefined && /^[-\\`*_{}[\]()#+.!~>|$<>]/.test(next)) {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
    }

    // 4) $$ ... $$ 块级公式
    if (ch === '$' && src[i + 1] === '$') {
      const end = src.indexOf('$$', i + 2);
      if (end !== -1 && end > i + 2) {
        if (push(src.slice(i + 2, end), true)) {
          i = end + 2;
          continue;
        }
      }
      out += '$$';
      i += 2;
      continue;
    }

    // 5) $ ... $ 行内公式(启发式)
    if (ch === '$') {
      let j = i + 1;
      while (j < n && src[j] !== '$' && src[j] !== '\n') j++;
      if (j < n && src[j] === '$' && j > i + 1) {
        const content = src.slice(i + 1, j);
        const prevChar = i > 0 ? src[i - 1] : '';
        const afterClose = src[j + 1] || '';
        const ok =
          !/^\s/.test(content) &&                    // 开头不能是空白
          !/\s$/.test(content) &&                    // 结尾不能是空白
          !/\d/.test(afterClose) &&                  // 结束 $ 后不能紧跟数字(排除 "$5-$10")
          !/\d/.test(prevChar) &&                    // 开始 $ 前不能是数字
          !/^[\d.,\s+\-*/%]+$/.test(content);        // 排除纯数字/金额样式
        if (ok) {
          push(content, false);
          i = j + 1;
          continue;
        }
      }
      out += '$';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return { text: out, items };
}

// ---------------------------------------------------------------- <think> 处理

function thinkBlockHtml(inner, mode) {
  if (mode === 'strip') return '\n';
  const text = inner.trim();
  if (!text) return '\n';
  // 保留换行,由 CSS white-space:pre-wrap 呈现
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `\n\n<div class="md2img-think">${esc}</div>\n\n`;
}

function preprocessThink(src, mode) {
  let out = src.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => thinkBlockHtml(inner, mode));
  const m = /<think>([\s\S]*)$/i.exec(out); // 未闭合的 think(回复被截断)
  if (m) out = out.replace(/<think>[\s\S]*$/i, thinkBlockHtml(m[1], mode));
  return out;
}

// ---------------------------------------------------------------- frontmatter

function stripFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(src);
  if (!m) return { src, title: '' };
  let title = '';
  const tm = /^title:\s*(.+?)\s*$/m.exec(m[1]);
  if (tm) title = tm[1].replace(/^["']|["']$/g, '').trim();
  return { src: src.slice(m[0].length), title };
}

// ---------------------------------------------------------------- HTML 净化(白名单)

const SANITIZE_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em',
    's', 'del', 'ins', 'u', 'strike', 'code', 'pre', 'hr', 'br', 'img', 'blockquote',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div', 'span', 'center',
    'small', 'sub', 'sup', 'mark', 'kbd', 'abbr', 'cite', 'q', 'dfn', 'var', 'samp',
    'figure', 'figcaption', 'details', 'summary', 'input', 'dl', 'dt', 'dd', 'time', 'font',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'align', 'loading'],
    input: ['type', 'checked', 'disabled', 'class'],
    th: ['align', 'colspan', 'rowspan', 'scope', 'valign'],
    td: ['align', 'colspan', 'rowspan', 'valign'],
    ol: ['start', 'type', 'reversed'],
    time: ['datetime'],
    font: ['color', 'face', 'size'],
    '*': ['class', 'align', 'dir', 'title', 'lang'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

// ---------------------------------------------------------------- markdown-it 实例

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use(taskLists);
md.use(emojiModule.default ?? emojiModule.full ?? emojiModule.emoji ?? emojiModule);

// token 级 HTML 净化(在 KaTeX 注入之前,所以不会破坏公式输出)
md.core.ruler.push('md2img_sanitize', (state) => {
  if (state.env?.opts?.sanitize === false) return;
  const walk = (tokens) => {
    for (const tok of tokens) {
      if (tok.type === 'html_block') tok.content = sanitizeHtml(tok.content, SANITIZE_OPTIONS);
      if (tok.children) walk(tok.children);
    }
  };
  walk(state.tokens);
});

// 占位符 -> KaTeX 渲染
function renderTex(tex, display, env) {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: false,
      macros: env?.opts?.mathMacros || {},
    });
  } catch (e) {
    const msg = escapeHtml(String(e?.message || e).slice(0, 200));
    return `<span class="math-error" title="${msg}">${escapeHtml(tex)}</span>`;
  }
}

const replaceInHtml = (html, store, env) =>
  html.replace(/\uE000(\d+)\uE001/g, (_, id) => {
    const item = store[Number(id)];
    return item ? renderTex(item.tex, item.display, env) : '';
  });

md.core.ruler.push('md2img_math', (state) => {
  const store = state.env?.mathStore || [];
  if (!store.length) return;

  const processLevel = (children) => {
    const out = [];
    for (const child of children) {
      if (child.type === 'text' && child.content.includes(PH_OPEN)) {
        for (const part of child.content.split(PH_RE)) {
          if (!part) continue;
          const m = PH_FULL_RE.exec(part);
          if (m) {
            const item = store[Number(m[1])];
            if (item) {
              const mt = new state.Token('md2img_math', '', 0);
              mt.content = item.tex;
              mt.meta = { display: item.display };
              out.push(mt);
              continue;
            }
          }
          const t = new state.Token('text', '', 0);
          t.content = part;
          out.push(t);
        }
      } else if (child.type === 'html_inline' && child.content.includes(PH_OPEN)) {
        child.content = replaceInHtml(child.content, store, state.env);
        out.push(child);
      } else {
        out.push(child);
      }
    }
    return out;
  };

  const walk = (tokens) => {
    for (const tok of tokens) {
      if (tok.type === 'html_block' && tok.content.includes(PH_OPEN)) {
        tok.content = replaceInHtml(tok.content, store, state.env);
        continue;
      }
      if (tok.children && tok.children.length) {
        tok.children = processLevel(tok.children);
        walk(tok.children);
      }
    }
  };
  walk(state.tokens);
});

md.renderer.rules.md2img_math = (tokens, idx, options, env) =>
  renderTex(tokens[idx].content, tokens[idx].meta?.display, env);

// 围栏代码块:高亮 / Mermaid
md.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx];
  const opts = env?.opts || {};
  const info = token.info ? token.info.trim().split(/\s+/)[0].toLowerCase() : '';
  const code = token.content.replace(/\n$/, '');

  if (info === 'mermaid' && opts.mermaid !== false) {
    env.mermaidCount = (env.mermaidCount || 0) + 1;
    const b64 = Buffer.from(token.content, 'utf8').toString('base64');
    return `<div class="md2img-mermaid" data-src="${b64}"></div>`;
  }

  let body = null;
  let lang = info;
  if (opts.highlight !== false) {
    if (info && hljs.getLanguage(info)) {
      try {
        body = hljs.highlight(code, { language: info, ignoreIllegals: true }).value;
      } catch { body = null; }
    }
    if (body === null && !info && opts.highlightAuto && code.length >= 16) {
      try {
        const r = hljs.highlightAuto(code);
        if (r.relevance >= 6 && r.language) {
          body = r.value;
          lang = r.language;
        }
      } catch { /* 忽略自动探测失败 */ }
    }
  }
  if (body === null) {
    body = md.utils.escapeHtml(code);
    if (!lang) lang = 'text';
  }

  return `<div class="codeblock"><div class="codeblock-head">`
    + `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>`
    + `<span class="lang">${escapeHtml(lang)}</span></div>`
    + `<pre><code class="hljs">${body}</code></pre></div>`;
};

// ---------------------------------------------------------------- 对外入口

/**
 * 渲染 Markdown -> 内容 HTML 片段
 * @returns {{ html: string, hasMermaid: boolean, title: string }}
 */
export function renderMarkdown(source, opts) {
  let src = String(source ?? '');
  const useOpts = { ...opts };

  const fm = stripFrontmatter(src);
  src = fm.src;
  if (!useOpts.title && fm.title) useOpts.title = fm.title;

  src = preprocessThink(src, useOpts.think);

  let text = src;
  let items = [];
  if (useOpts.math) {
    const r = extractMath(src);
    text = r.text;
    items = r.items;
  }

  md.set({ breaks: !!useOpts.breaks });
  const env = { opts: useOpts, mathStore: items };
  const html = md.render(text, env);

  return { html, hasMermaid: !!env.mermaidCount, title: useOpts.title };
}
