/**
 * MD2IMG HTTP API 服务
 *
 *  POST /api/render      JSON/纯文本 -> 图片二进制(或 base64 JSON)
 *  GET  /render?md=...   URL 快捷渲染(方便 <img> 嵌入 / curl 测试)
 *  POST /api/preview     返回渲染后的 HTML(用于 iframe 预览/调试)
 *  GET  /health          健康检查
 *  GET  /api/config      服务能力信息
 *  GET  /                网页 Playground
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serverConfig as cfg,
  normalizeOptions,
  optionsFromQuery,
  PKG,
} from './config.js';
import { renderMarkdown } from './markdown.js';
import { buildPage } from './template.js';
import { renderImage, browserStatus, shutdown } from './renderer.js';
import { availableCodeThemes } from './template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------- 工具

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sendError(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

function buildResponsePayload(markdown, opts) {
  const t0 = Date.now();
  const { html, hasMermaid, title } = renderMarkdown(markdown, opts);
  const page = buildPage({ bodyHtml: html, opts: { ...opts, title }, hasMermaid });
  return { page, opts, t0 };
}

function contentDisposition(filename, mime) {
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const safe = filename.replace(/[^\w.\- ]+/g, '_').trim() || `md2img.${ext}`;
  if (!/\.[a-z0-9]+$/i.test(safe)) return `${safe}.${ext}`;
  return safe;
}

// ---------------------------------------------------------------- 应用

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');

  // CORS
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    res.set('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // 请求体解析
  const bodyLimit = `${cfg.maxBodyKB}kb`;
  app.use(express.json({ limit: bodyLimit, strict: false }));
  app.use(express.text({ type: ['text/markdown', 'text/x-markdown', 'application/markdown', 'text/plain'], limit: bodyLimit }));

  // 简单访问日志
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const t0 = Date.now();
    res.on('finish', () => {
      const size = res.get('Content-Length') || '';
      console.log(`[md2img] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms ${size ? size + 'B' : ''}`);
    });
    next();
  });

  // API Key 鉴权(设置环境变量 API_KEY 后启用)
  const authGuard = (req, res, next) => {
    if (!cfg.apiKey) return next();
    const key =
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() ||
      req.get('x-api-key') ||
      req.query.key ||
      '';
    if (key && key === cfg.apiKey) return next();
    return sendError(res, 401, 'unauthorized', 'API Key 缺失或错误(请求头 Authorization: Bearer <key> 或 X-API-Key)');
  };

  // ------------------------------------------------ GET / 页面
  app.use(express.static(path.join(ROOT, 'public')));
  app.get('/sample', (_req, res) => {
    res.type('text/markdown; charset=utf-8');
    res.sendFile(path.join(ROOT, 'examples', 'sample.md'));
  });

  app.get('/health', ah(async (_req, res) => {
    res.json({
      ok: true,
      service: 'md2img',
      version: PKG.version,
      browser: await browserStatus(),
      concurrency: cfg.concurrency,
      uptime: Math.round(process.uptime()),
    });
  }));

  app.get('/api/config', (_req, res) => {
    res.json({
      service: 'md2img',
      version: PKG.version,
      themes: ['light', 'dark'],
      codeThemes: availableCodeThemes(),
      formats: ['png', 'jpeg', 'webp'],
      maxBodyKB: cfg.maxBodyKB,
      concurrency: cfg.concurrency,
    });
  });

  // ------------------------------------------------ 渲染核心
  async function handleRender(req, res, markdown, opts) {
    if (!markdown || !String(markdown).trim()) {
      return sendError(res, 400, 'empty_content', '缺少渲染内容:请在 JSON 的 markdown/md/content 字段,或以 text/plain 正文提供 Markdown 文本');
    }
    markdown = String(markdown);
    if (markdown.length > cfg.maxBodyKB * 1024) {
      return sendError(res, 413, 'payload_too_large', `内容超过限制 ${cfg.maxBodyKB}KB`);
    }

    const { page, t0 } = buildResponsePayload(markdown, opts);
    const result = await renderImage({ html: page.html, opts });

    const elapsed = Date.now() - t0;
    const mime =
      opts.format === 'png' ? 'image/png' : opts.format === 'webp' ? 'image/webp' : 'image/jpeg';

    const meta = {
      width: result.width,
      height: result.height,
      format: opts.format,
      elapsedMs: elapsed,
    };

    res.set('X-Md2img-Width', String(result.width));
    res.set('X-Md2img-Height', String(result.height));
    res.set('X-Md2img-Elapsed-Ms', String(elapsed));

    // 多分片(超高内容):只能以 JSON 返回
    if (result.buffers.length > 1) {
      const images = result.buffers.map((b) => b.toString('base64'));
      res.set('X-Md2img-Chunks', String(images.length));
      return res.json({ ...meta, chunks: images.length, images });
    }

    const buffer = result.buffers[0];

    if (opts.return === 'base64') {
      return res.json({ ...meta, mime, base64: buffer.toString('base64') });
    }

    res.set('Content-Type', mime);
    res.set('Content-Length', String(buffer.length));
    if (opts.filename) {
      const name = contentDisposition(opts.filename, mime);
      res.set('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    res.send(buffer);
  }

  // ------------------------------------------------ POST /api/render
  const renderHandler = ah(async (req, res) => {
    let markdown = '';
    let input = {};

    if (typeof req.body === 'string') {
      markdown = req.body;
      input = optionsFromQuery(req.query);
    } else if (req.body && typeof req.body === 'object') {
      markdown = req.body.markdown ?? req.body.md ?? req.body.content ?? req.body.text ?? '';
      input = req.body;
    }

    const norm = normalizeOptions(input);
    if (!norm.ok) return sendError(res, 400, 'invalid_options', '参数校验失败', norm.error);

    await handleRender(req, res, markdown, norm.value);
  });

  app.post('/api/render', authGuard, renderHandler);
  app.post('/render', authGuard, renderHandler);
  app.post('/api/md2img', authGuard, renderHandler);
  app.post('/api/image', authGuard, renderHandler);

  // ------------------------------------------------ GET /render?md=
  const getRenderHandler = ah(async (req, res) => {
    const markdown = String(req.query.md ?? req.query.text ?? '');
    if (markdown.length > cfg.maxGetQueryChars) {
      return sendError(res, 413, 'payload_too_large', `URL 查询参数过长(>${cfg.maxGetQueryChars} 字符),请使用 POST`);
    }
    const norm = normalizeOptions(optionsFromQuery(req.query));
    if (!norm.ok) return sendError(res, 400, 'invalid_options', '参数校验失败', norm.error);
    await handleRender(req, res, markdown, norm.value);
  });

  app.get('/render', authGuard, getRenderHandler);
  app.get('/api/render', authGuard, getRenderHandler);

  // ------------------------------------------------ POST /api/preview(返回 HTML,调试/iframe 用)
  const previewHandler = ah(async (req, res) => {
    let markdown = '';
    let input = {};
    if (typeof req.body === 'string') {
      markdown = req.body;
      input = optionsFromQuery(req.query);
    } else if (req.body && typeof req.body === 'object') {
      markdown = req.body.markdown ?? req.body.md ?? req.body.content ?? req.body.text ?? '';
      input = { ...req.query, ...req.body };
    }
    const norm = normalizeOptions(input);
    if (!norm.ok) return sendError(res, 400, 'invalid_options', '参数校验失败', norm.error);
    if (!String(markdown).trim()) return sendError(res, 400, 'empty_content', '缺少渲染内容');

    const { html, hasMermaid, title } = renderMarkdown(String(markdown), norm.value);
    const page = buildPage({ bodyHtml: html, opts: { ...norm.value, title }, hasMermaid });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(page.html);
  });

  app.post('/api/preview', authGuard, previewHandler);
  app.get('/preview', authGuard, previewHandler);

  // ------------------------------------------------ 404 & 错误处理
  app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path === '/render') {
      return sendError(res, 404, 'not_found', `接口不存在: ${req.method} ${req.path}`);
    }
    res.status(404).send('Not Found');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return sendError(res, 400, 'invalid_json', '请求体不是合法的 JSON');
    }
    if (err?.type === 'entity.too.large' || err?.statusCode === 413) {
      return sendError(res, 413, 'payload_too_large', `请求体超过限制 ${cfg.maxBodyKB}KB`);
    }
    console.error('[md2img] error:', err);
    sendError(res, 500, 'internal_error', String(err?.message || err).slice(0, 300));
  });

  return app;
}

// ---------------------------------------------------------------- 入口

export function main() {
  const app = buildApp();
  const server = app.listen(cfg.port, cfg.host, () => {
    console.log(`\n  MD2IMG v${PKG.version}`);
    console.log(`  ➜ API:     http://localhost:${cfg.port}/api/render`);
    console.log(`  ➜ Playground: http://localhost:${cfg.port}/`);
    console.log(`  ➜ Health:  http://localhost:${cfg.port}/health`);
    console.log(`  ➜ 并发: ${cfg.concurrency}  内容上限: ${cfg.maxBodyKB}KB${cfg.apiKey ? '  鉴权: 已启用' : ''}\n`);
  });

  const stop = async () => {
    console.log('\n[md2img] shutting down...');
    server.close();
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
