/**
 * Puppeteer 渲染引擎:
 *  - 浏览器单例(崩溃自动重启),页面并发池
 *  - 渲染 HTML -> 等待就绪 -> 按内容尺寸截图
 *  - 超高内容处理:先降 deviceScaleFactor,仍超高则按安全高度分片截取
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { serverConfig } from './config.js';

let browser = null;
let launching = null;
const pagePool = [];
const waiters = [];
let activeCount = 0;

// ---------------------------------------------------------------- 浏览器启动

function platformCandidates() {
  const list = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env['LOCALAPPDATA'] || '';
    list.push(
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(lad, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    list.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium');
  }
  return list;
}

export function resolveExecutablePath() {
  if (serverConfig.chromePath && fs.existsSync(serverConfig.chromePath)) return serverConfig.chromePath;
  try {
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 未下载浏览器则继续探测 */ }
  for (const p of platformCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  return '';
}

async function getBrowser() {
  if (browser && browser.connected) return browser;
  if (launching) return launching;
  launching = (async () => {
    const executablePath = resolveExecutablePath();
    if (!executablePath) {
      throw new Error(
        '未找到可用的 Chrome/Edge 浏览器。请执行 `npm run setup`(重新运行 npm install 下载 Chromium),或通过环境变量 CHROME_PATH 指定浏览器路径。',
      );
    }
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--disable-gpu',
    ];
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args,
      dumpio: false,
    });
    browser.on('disconnected', () => {
      browser = null;
      pagePool.length = 0;
    });
    return browser;
  })();
  try {
    return await launching;
  } catch (e) {
    launching = null;
    throw e;
  }
}

// ---------------------------------------------------------------- 并发信号量

async function acquire() {
  if (activeCount < serverConfig.concurrency) {
    activeCount++;
    return;
  }
  await new Promise((res) => waiters.push(res));
  activeCount++;
}

function release() {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

async function withPage(fn) {
  await acquire();
  let page = null;
  try {
    const b = await getBrowser();
    page = pagePool.pop() || (await b.newPage());
    page.setDefaultNavigationTimeout(serverConfig.renderTimeoutMs);
    return await fn(page);
  } catch (e) {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
      page = null;
    }
    throw e;
  } finally {
    if (page) {
      if (pagePool.length < serverConfig.concurrency) pagePool.push(page);
      else { try { await page.close(); } catch { /* ignore */ } }
    }
    release();
  }
}

// ---------------------------------------------------------------- 渲染

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 渲染 HTML 为图片
 * @returns {{ buffers: Buffer[], width: number, height: number, scale: number }}
 */
export async function renderImage({ html, opts }) {
  const tmpFile = path.join(os.tmpdir(), `md2img-${crypto.randomUUID()}.html`);
  await fs.promises.writeFile(tmpFile, html, 'utf8');
  const url = pathToFileURL(tmpFile).href;

  try {
    return await withPage(async (page) => {
      const CARD_MARGIN = 56;
      const pageWidth =
        opts.frame === 'card' ? opts.width + CARD_MARGIN * 2 : opts.width;
      let scale = opts.scale;

      await page.setViewport({ width: pageWidth, height: 900, deviceScaleFactor: scale });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: serverConfig.renderTimeoutMs });

      // 等待引导脚本完成(mermaid/图片/字体),带超时兜底
      await page.evaluate(
        (t) => Promise.race([
          window.__MD2IMG_READY || Promise.resolve(),
          new Promise((r) => setTimeout(r, t)),
        ]),
        opts.imageTimeout + 4000,
      );

      const box = await page.evaluate(() => {
        const el = document.getElementById('capture');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.left)),
          y: Math.max(0, Math.floor(r.top)),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        };
      });
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error('渲染结果为空,请检查输入内容');
      }

      // 超高图片:优先降低缩放;仍超高则分片
      const MAX_DEV_PX = 16000;
      let scaleUsed = scale;
      if (box.height * scale > MAX_DEV_PX) {
        const fitted = Math.max(1, Math.floor((MAX_DEV_PX / box.height) * 10) / 10);
        if (fitted < scale) {
          scaleUsed = fitted;
          await page.setViewport({ width: pageWidth, height: 900, deviceScaleFactor: scaleUsed });
          await sleep(60);
        }
      }

      const type = opts.format === 'jpeg' ? 'jpeg' : opts.format;
      const quality = opts.format === 'png' ? undefined : opts.quality;
      const omitBackground = opts.frame === 'transparent' && opts.format === 'png';

      const shoot = async (clip) =>
        page.screenshot({
          ...(clip ? { clip, captureBeyondViewport: true } : {}),
          type,
          quality,
          omitBackground,
          optimizeForSpeed: false,
        });

      const buffers = [];
      let heightTotal = box.height;

      const toBuffer = (data) => (Buffer.isBuffer(data) ? data : Buffer.from(data));

      if (box.height * scaleUsed <= MAX_DEV_PX) {
        const el = await page.$('#capture');
        buffers.push(toBuffer(await el.screenshot({ type, quality, omitBackground })));
      } else {
        const chunkH = Math.floor((MAX_DEV_PX - 1000) / scaleUsed);
        const maxChunks = 12;
        let y = 0;
        while (y < box.height && buffers.length < maxChunks) {
          const h = Math.min(chunkH, box.height - y);
          buffers.push(toBuffer(await shoot({ x: box.x, y: box.y + y, width: box.width, height: h })));
          y += h;
        }
        heightTotal = Math.min(box.height, chunkH * buffers.length);
      }

      return {
        buffers,
        width: Math.round(box.width * scaleUsed),
        height: Math.round(heightTotal * scaleUsed),
        scale: scaleUsed,
      };
    });
  } catch (e) {
    const msg = String(e?.message || e);
    // 浏览器/标签页崩溃 -> 重置浏览器后重试一次
    if (/Target closed|Session closed|Browser closed|detached/i.test(msg)) {
      try { if (browser) await browser.close(); } catch { /* ignore */ }
      browser = null;
      return renderImage({ html, opts });
    }
    throw e;
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

/** 健康检查信息 */
export async function browserStatus() {
  try {
    const b = await getBrowser();
    return b && b.connected ? 'ready' : 'error';
  } catch (e) {
    return `error: ${String(e?.message || e).slice(0, 120)}`;
  }
}

export async function shutdown() {
  try {
    if (browser) await browser.close();
  } catch { /* ignore */ }
  browser = null;
  pagePool.length = 0;
}
