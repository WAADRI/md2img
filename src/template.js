/**
 * 渲染页面模板:把所有资源(CSS/字体/Mermaid)内联进单个 HTML,
 * 无头浏览器以 file:// 打开即可完整渲染,零外部请求、完全离线可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT } from './config.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resolvePkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

// ---------------------------------------------------------------- 资源读取与缓存

const cache = {};

/** 读取 KaTeX 样式,并把其中引用的 woff2 字体内联为 data URI(仅保留 woff2,精简体积) */
function katexCssInline() {
  if (cache.katexCss) return cache.katexCss;
  const dist = path.join(resolvePkgDir('katex'), 'dist');
  let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
  css = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    if (!block.includes('.woff2')) return ''; // 只保留 woff2 源
    return block.replace(/,?\s*url\([^)]*\.woff2?[^)]*\)\s*format\(['"]woff2?['"]\)/gi, (m) =>
      m.includes('.woff2') ? m : '',
    );
  });
  css = css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_, rel) => {
    const file = path.join(dist, rel);
    try {
      const b64 = fs.readFileSync(file).toString('base64');
      return `url(data:font/woff2;base64,${b64})`;
    } catch {
      return _;
    }
  });
  cache.katexCss = css;
  return css;
}

/** highlight.js 主题样式 */
const HLJS_THEME_ALIASES = { 'one-dark': 'atom-one-dark', 'one-light': 'atom-one-light' };
function hljsCssInline(name) {
  const key = `hljs:${name}`;
  if (cache[key]) return cache[key];
  const stylesDir = path.join(resolvePkgDir('highlight.js'), 'styles');
  const file = path.join(stylesDir, `${name}.css`);
  let css = '';
  try {
    css = fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
  // 让代码块底色跟随页面主题,避免主题自带的背景色冲突
  css += '\n.hljs{background:transparent !important;}';
  cache[key] = css;
  return css;
}

/** 扫描 assets/fonts 下的自定义字体文件并生成 @font-face(自动并入字体栈) */
function fontsInline() {
  if (cache.fonts) return cache.fonts;
  const dir = path.join(ROOT, 'assets', 'fonts');
  const faces = [];
  const families = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const ext = path.extname(name).toLowerCase();
      if (!['.woff2', '.woff', '.ttf', '.otf'].includes(ext)) continue;
      const base = path.basename(name, ext);
      const family = `MD2Img ${base}`;
      const mime = ext === '.ttf' ? 'font/ttf' : ext === '.otf' ? 'font/otf' : `font/${ext.slice(1)}`;
      const b64 = fs.readFileSync(path.join(dir, name)).toString('base64');
      const format = ext === '.woff2' ? 'woff2' : ext === '.woff' ? 'woff' : ext === '.ttf' ? 'truetype' : 'opentype';
      faces.push(`@font-face{font-family:"${family}";src:url(data:${mime};base64,${b64}) format("${format}");font-display:block;}`);
      families.push({ family, isMono: /mono|code|consol/i.test(base) });
    }
  } catch { /* 目录不存在则跳过 */ }
  cache.fonts = { faces: faces.join('\n'), families };
  return cache.fonts;
}

/** mermaid 运行时(仅当文档包含 mermaid 图表时内联) */
function mermaidJsInline() {
  if (cache.mermaid !== undefined) return cache.mermaid;
  const candidates = ['dist/mermaid.min.js', 'dist/mermaid.js'];
  let js = '';
  for (const rel of candidates) {
    try {
      const file = path.join(resolvePkgDir('mermaid'), rel);
      if (fs.existsSync(file)) {
        js = fs.readFileSync(file, 'utf8');
        break;
      }
    } catch { /* try next */ }
  }
  cache.mermaid = js ? js.replace(/<\/script/gi, '<\\/script') : '';
  return cache.mermaid;
}

export function availableCodeThemes() {
  try {
    const dir = path.join(resolvePkgDir('highlight.js'), 'styles');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => f.replace(/\.css$/, ''))
      .filter((f) => !['base16', 'default'].includes(f))
      .sort();
  } catch {
    return ['github', 'github-dark'];
  }
}

// ---------------------------------------------------------------- 基础样式

const FONT_BODY_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "WenQuanYi Micro Hei", Arial, sans-serif`;
const FONT_MONO_STACK = `"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Source Code Pro", Menlo, Monaco, "Courier New", "Noto Sans Mono CJK SC", monospace`;

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

.theme-light{
  --text:#1f2328; --muted:#59636e; --border:#d1d9e0; --border-soft:#e7ecf1;
  --card-bg:#ffffff;
  --accent:#0969da;
  --inline-code-bg:rgba(129,139,152,.15); --inline-code-color:#cf222e;
  --quote-bg:#f6f8fa; --quote-bar:#d1d9e0;
  --th-bg:#f6f8fa; --table-border:#d8dee4; --table-stripe:rgba(60,80,120,.045);
  --code-bg:#f6f8fa; --code-border:#e4e9ee;
  --heading-border:#d8dee4;
  --shadow:0 1px 2px rgba(31,35,40,.05),0 10px 28px rgba(31,35,40,.10);
  --page-grad:radial-gradient(1200px 480px at 18% -4%,#e9eef7 0%,rgba(233,238,247,0) 60%),linear-gradient(165deg,#f4f6fa 0%,#e3e8f0 100%);
}
.theme-dark{
  --text:#e6edf3; --muted:#9198a1; --border:#3d444d; --border-soft:#2b3138;
  --card-bg:#0d1117;
  --accent:#4493f8;
  --inline-code-bg:rgba(110,118,129,.28); --inline-code-color:#f0883e;
  --quote-bg:#12171e; --quote-bar:#3d444d;
  --th-bg:#151b23; --table-border:#3d444d; --table-stripe:rgba(200,210,230,.04);
  --code-bg:#151b23; --code-border:#2b3138;
  --heading-border:#2b3138;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px rgba(0,0,0,.5);
  --page-grad:radial-gradient(1200px 480px at 18% -4%,#10161f 0%,rgba(16,22,31,0) 60%),linear-gradient(165deg,#0b0f16 0%,#0d1117 100%);
}

#capture{font-family:var(--font-body)}

/* 边缘留白:三种模式统一由 --margin 控制,保证边框宽度一致 */
.frame-card{padding:var(--margin);background:var(--page-grad)}
.frame-card .card{background:var(--card-bg);border-radius:18px;box-shadow:var(--shadow);border:1px solid var(--border-soft)}
/* plain 模式:纯色背景直出;提供 bgColor 时外围变为自定义色环,内容区保持面板底色 */
.frame-plain{padding:var(--margin);background:var(--frame-bg,var(--card-bg))}
.frame-plain.frame-tinted .card{background:var(--card-bg);border-radius:10px}
/* transparent 模式:透明背景(png),放到非白底上才能看出区别 */
.frame-transparent{padding:var(--margin);background:transparent}

.card{padding:var(--pad);overflow:hidden}

.title-bar{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--heading-border);margin-bottom:22px;font-weight:700;font-size:1.08em;letter-spacing:.01em}
.title-bar .logo{font-size:1.15em;line-height:1}
.footer-bar{margin-top:24px;padding-top:12px;border-top:1px solid var(--heading-border);color:var(--muted);font-size:.8em;display:flex;justify-content:space-between;gap:16px}
.footer-bar .brand{opacity:.75}

/* ------- 正文 ------- */
.md-body{color:var(--text);line-height:1.75;word-wrap:break-word}
.md-body>:first-child{margin-top:0!important}
.md-body>:last-child{margin-bottom:0!important}
.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6{margin:1.5em 0 .6em;font-weight:650;line-height:1.4}
.md-body h1{font-size:1.7em;padding-bottom:.32em;border-bottom:1px solid var(--heading-border)}
.md-body h2{font-size:1.42em;padding-bottom:.32em;border-bottom:1px solid var(--heading-border)}
.md-body h3{font-size:1.22em}
.md-body h4{font-size:1.06em}
.md-body h5,.md-body h6{font-size:.96em;color:var(--muted)}
.md-body p{margin:.9em 0}
.md-body a{color:var(--accent);text-decoration:none}
.md-body a:hover{text-decoration:underline}
.md-body strong{font-weight:640}
.md-body em{font-style:italic}
.md-body ul,.md-body ol{margin:.7em 0;padding-left:1.7em}
.md-body li{margin:.32em 0}
.md-body li>ul,.md-body li>ol{margin:.15em 0}
.md-body hr{border:0;height:1px;background:var(--border);margin:1.7em 0}
.md-body blockquote{margin:1em 0;padding:.72em 1.15em;background:var(--quote-bg);border-left:4px solid var(--quote-bar);border-radius:4px 8px 8px 4px;color:var(--muted)}
.md-body blockquote p{margin:.45em 0}
.md-body code{font-family:var(--font-mono);font-size:.875em;background:var(--inline-code-bg);color:var(--inline-code-color);padding:.16em .42em;border-radius:5px}
.md-body pre{margin:0}
.md-body img{max-width:100%;height:auto;border-radius:8px}
.md-body mark{background:rgba(255,213,0,.35);color:inherit;padding:.05em .18em;border-radius:4px}
.md-body kbd{font-family:var(--font-mono);font-size:.82em;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:.1em .45em;background:var(--quote-bg)}
.md-body .task-list-item{list-style:none}
.md-body ul:has(> .task-list-item){padding-left:1.35em}
.md-body .task-list-item input{margin-right:.5em;accent-color:var(--accent);vertical-align:-2px}

/* ------- 表格 ------- */
.md-body table{border-collapse:collapse;margin:1.15em 0;width:100%;font-size:.93em}
.md-body th,.md-body td{border:1px solid var(--table-border);padding:7px 12px;text-align:left;vertical-align:top;overflow-wrap:break-word}
.md-body th{background:var(--th-bg);font-weight:650;white-space:nowrap}
.md-body tbody tr:nth-child(even) td{background:var(--table-stripe)}

/* ------- 代码块 ------- */
.codeblock{margin:1.15em 0;border:1px solid var(--code-border);border-radius:10px;background:var(--code-bg);overflow:hidden}
.codeblock-head{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--code-border)}
.codeblock .dots{display:flex;gap:6px}
.codeblock .dots i{width:10px;height:10px;border-radius:50%;display:block}
.codeblock .dots i:nth-child(1){background:#ff5f57}
.codeblock .dots i:nth-child(2){background:#febc2e}
.codeblock .dots i:nth-child(3){background:#28c840}
.codeblock .lang{font-family:var(--font-mono);font-size:.72em;color:var(--muted);letter-spacing:.04em}
.codeblock pre{padding:13px 16px;overflow:hidden}
.codeblock pre code{background:transparent;color:var(--text);padding:0;font-size:.85em;line-height:1.62;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}

/* ------- KaTeX ------- */
.katex{font-size:1.06em}
.katex-display{margin:1.15em 0;overflow:visible}
.katex-display>.katex{white-space:normal}
.math-error{color:#e5534b;font-family:var(--font-mono);font-size:.85em;background:rgba(229,83,75,.1);padding:.1em .35em;border-radius:4px}

/* ------- Mermaid / 图片占位 ------- */
.md2img-mermaid{display:flex;justify-content:center;margin:1.25em 0;padding:10px 0}
.md2img-mermaid svg{max-width:100%;height:auto}
.mermaid-error{color:#e5534b;font-size:.85em;margin-bottom:8px;font-family:var(--font-mono)}
.mermaid-src{white-space:pre-wrap;font-family:var(--font-mono);font-size:.82em;color:var(--muted);background:var(--code-bg);border:1px dashed var(--border);border-radius:8px;padding:12px 14px;text-align:left}
.img-fallback{display:inline-flex;align-items:center;gap:6px;color:var(--muted);background:var(--quote-bg);border:1px dashed var(--border);border-radius:8px;padding:8px 12px;font-size:.85em;margin:.4em 0}

/* ------- 思考过程 ------- */
.md2img-think{margin:1em 0;padding:.8em 1.1em;border:1px dashed var(--border);border-left:3px solid var(--quote-bar);border-radius:8px;color:var(--muted);font-size:.92em;background:var(--quote-bg);white-space:pre-wrap;position:relative}
.md2img-think::before{content:"💭 思考过程";display:block;font-size:.85em;font-weight:650;margin-bottom:.45em;opacity:.85;letter-spacing:.05em}
`;

// ---------------------------------------------------------------- 页面组装

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 浏览器端引导脚本(字符串化后内联):
 * 渲染 mermaid -> 等待图片 -> 过宽公式自动缩放 -> 等待字体 -> 标记就绪
 */
const BOOT_BODY = String(function (cfg) {
  const markErr = (img) => {
    const alt = img.getAttribute('alt') || '';
    const div = document.createElement('div');
    div.className = 'img-fallback';
    div.textContent = '🖼 ' + (alt ? alt + '(图片加载失败)' : '图片加载失败');
    img.replaceWith(div);
  };

  window.__MD2IMG_READY = (async () => {
    try {
      // 1) Mermaid 图表
      const blocks = Array.from(document.querySelectorAll('.md2img-mermaid[data-src]'));
      if (blocks.length) {
        if (window.mermaid) {
          const body = document.querySelector('.md-body') || document.body;
          window.mermaid.initialize({
            startOnLoad: false,
            theme: cfg.mermaidTheme || 'default',
            securityLevel: 'strict',
            suppressErrorRendering: true,
            fontFamily: getComputedStyle(body).fontFamily,
            flowchart: { curve: 'basis' },
          });
          let i = 0;
          for (const el of blocks) {
            i++;
            let code = '';
            try {
              code = new TextDecoder().decode(Uint8Array.from(atob(el.getAttribute('data-src')), (c) => c.charCodeAt(0)));
            } catch (e) { /* ignore */ }
            if (!code.trim()) {
              el.innerHTML = '<div class="mermaid-src">(空的 mermaid 图表)</div>';
              continue;
            }
            try {
              const out = await window.mermaid.render('md2img-mmd-' + i, code);
              el.innerHTML = out.svg;
              el.classList.add('mermaid-ok');
            } catch (e) {
              el.classList.add('mermaid-fail');
              el.innerHTML =
                '<div class="mermaid-error">⚠️ Mermaid 图表渲染失败: ' +
                String((e && e.message) || e).slice(0, 200) + '</div><pre class="mermaid-src"></pre>';
              el.querySelector('.mermaid-src').textContent = code;
            }
          }
        } else {
          blocks.forEach((el) => {
            el.classList.add('mermaid-fail');
            el.innerHTML = '<div class="mermaid-error">⚠️ Mermaid 库不可用</div><pre class="mermaid-src"></pre>';
            el.querySelector('.mermaid-src').textContent = atob(el.getAttribute('data-src') || '');
          });
        }
      }

      // 2) 图片(带超时,避免外链图片阻塞出图)
      const imgs = Array.from(document.images);
      await Promise.race([
        Promise.all(
          imgs.map(
            (img) =>
              new Promise((res) => {
                if (img.complete) {
                  if (img.naturalWidth === 0) markErr(img);
                  return res();
                }
                img.addEventListener('load', () => res(), { once: true });
                img.addEventListener('error', () => { markErr(img); res(); }, { once: true });
              }),
          ),
        ),
        new Promise((res) => setTimeout(res, cfg.imageTimeout || 15000)),
      ]);

      // 3) 过宽的块级公式等比缩小,保证完整展示
      document.querySelectorAll('.katex-display').forEach((el) => {
        const parent = el.parentElement;
        const avail = (parent ? parent.clientWidth : el.clientWidth) || 0;
        const w = el.scrollWidth;
        if (avail > 0 && w > avail + 2) {
          const s = Math.max(0.3, avail / w);
          el.style.transformOrigin = 'left center';
          el.style.transform = 'scale(' + s + ')';
          el.style.marginBottom = -(1 - s) * el.scrollHeight + 'px';
        }
      });

      // 4) 字体就绪
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) { /* ignore */ }
      }
    } catch (e) {
      if (window.console && console.error) console.error('md2img boot error', e);
    }
  })().then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}).trim();

/**
 * 组装完整 HTML 页面
 * @param {object} p
 * @param {string} p.bodyHtml     内容 HTML(renderMarkdown 输出)
 * @param {object} p.opts         规范化后的渲染选项
 * @param {boolean} p.hasMermaid  是否包含 mermaid 图表
 */
export function buildPage({ bodyHtml, opts, hasMermaid }) {
  const theme = opts.theme === 'dark' ? 'theme-dark' : 'theme-light';
  const codeTheme = opts.codeTheme || (opts.theme === 'dark' ? 'github-dark' : 'github');
  const fonts = fontsInline();
  const monoFamilies = fonts.families.filter((f) => f.isMono).map((f) => `"${f.family}"`);
  const bodyFamilies = fonts.families.filter((f) => !f.isMono).map((f) => `"${f.family}"`);
  const fontBodyVar = [...bodyFamilies, FONT_BODY_STACK].join(', ');
  const fontMonoVar = [...monoFamilies, FONT_MONO_STACK].join(', ');

  let frame = opts.frame;
  if (frame === 'transparent' && opts.format !== 'png') frame = 'plain';

  // 三种模式统一:图片宽 = 内容宽 + 2*margin(外圈留白),文字列宽 = 内容宽 - 2*padding
  const widthCss = `${opts.width + opts.margin * 2}px`;

  // 自定义颜色:card 模式替换渐变环,plain 模式作为外围色环(内容面板保持主题底色)
  const bgColorStyle = opts.bgColor ? `--page-grad:${escapeHtml(opts.bgColor)};--frame-bg:${escapeHtml(opts.bgColor)};` : '';
  const tintedClass = frame === 'plain' && opts.bgColor ? ' frame-tinted' : '';

  const mermaidTheme = opts.mermaidTheme || (opts.theme === 'dark' ? 'dark' : 'default');

  const head =
    (opts.math ? `<style>${katexCssInline()}</style>\n` : '') +
    `<style>${hljsCssInline(HLJS_THEME_ALIASES[codeTheme] || codeTheme)}</style>\n` +
    `<style>${fonts.faces}</style>\n` +
    `<style>:root{--font-body:${fontBodyVar};--font-mono:${fontMonoVar}}</style>\n` +
    `<style>${BASE_CSS}</style>`;

  const mermaidScript = hasMermaid && opts.mermaid !== false ? `<script>${mermaidJsInline()}</script>\n` : '';

  const titleBar = opts.title
    ? `<div class="title-bar"><span class="logo">🤖</span><span>${escapeHtml(opts.title)}</span></div>`
    : '';
  const footerBar = `<div class="footer-bar"><span>${escapeHtml(opts.footer || '')}</span><span class="brand">MD2IMG</span></div>`;

  const bootCfg = JSON.stringify({ mermaidTheme, imageTimeout: opts.imageTimeout });

  const html = `<!doctype html>
<html class="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${head}
</head>
<body>
<div id="capture" class="frame-${frame}${tintedClass} ${theme}" style="width:${widthCss};font-size:${opts.fontSize}px;--pad:${opts.padding}px;--margin:${opts.margin}px;${bgColorStyle}">
  <div class="card">
    ${titleBar}
    <div class="md-body">${bodyHtml}</div>
    ${footerBar}
  </div>
</div>
${mermaidScript}<script>(${BOOT_BODY})(${bootCfg});</script>
</body>
</html>`;

  return { html };
}
