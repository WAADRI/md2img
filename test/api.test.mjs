/**
 * API 集成测试:启动本地服务,覆盖主要渲染场景,输出 PNG 到 test/out/ 供人工检查。
 * 运行:npm test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const app = buildApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sample = fs.readFileSync(path.join(ROOT, 'examples', 'sample.md'), 'utf8');
const results = [];
let failed = 0;

function record(name, ok, info) {
  results.push({ name, ok: ok ? '✅' : '❌', info });
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}  ${info}`);
}

async function postRender(body, name, expect = {}) {
  expect = { type: 'image', ...expect };
  const resp = await fetch(`${base}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    record(name, false, `HTTP ${resp.status}: ${text.slice(0, 300)}`);
    return resp;
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const w = resp.headers.get('x-md2img-width');
  const h = resp.headers.get('x-md2img-height');
  if (expect.type === 'image') {
    const ct = resp.headers.get('content-type');
    const ok = ct?.startsWith('image/') && buf.length > 3000;
    record(name, ok, `${ct} ${w}x${h} ${(buf.length / 1024).toFixed(1)}KB`);
    if (expect.save) fs.writeFileSync(path.join(OUT, expect.save), buf);
  } else {
    const j = JSON.parse(buf.toString('utf8'));
    record(name, !!j.base64 || !!j.images, `${j.width}x${j.height} ${j.elapsedMs}ms base64:${(j.base64?.length || 0)}`);
  }
  return resp;
}

// 1. 健康检查
{
  const r = await fetch(`${base}/health`);
  const j = await r.json();
  record('GET /health', r.ok && j.ok && String(j.browser).includes('ready'), `browser=${j.browser}`);
}

// 2. 主样例(浅色/深色)
await postRender({ markdown: sample, title: 'AI 助手回复示例' }, 'POST 全功能样例 light', { save: 'sample-light.png' });
await postRender({ markdown: sample, theme: 'dark' }, 'POST 全功能样例 dark', { save: 'sample-dark.png' });

// 3. 数学公式专项(\(...\) 与 $...$ 与货币防误判)
const mathMd = [
  '行内 \\( a^2+b^2=c^2 \\) 与 $E=mc^2$ 混用。',
  '',
  '$$\\int_0^1 x^2 dx = \\frac13$$',
  '',
  '会员价格 $5-$10 之间,合计 $15.50,不应被识别为公式。',
  '$$\\begin{cases} x+y=1 \\\\ x-y=3 \\end{cases}$$',
].join('\n');
await postRender({ markdown: mathMd, frame: 'plain', padding: 24 }, 'POST 数学公式专项', { save: 'math.png' });

// 4. Mermaid
const mermaidMd = '```mermaid\nflowchart LR\n  A[请求] --> B{解析}\n  B -->|成功| C[渲染]\n  C --> D([出图])\n```';
await postRender({ markdown: mermaidMd, title: 'Mermaid 测试' }, 'POST mermaid 图表', { save: 'mermaid.png' });

// 5. 超长代码自动换行
const longLine = 'x'.repeat(120);
const codeMd = '```text\n' + Array.from({ length: 30 }, (_, i) => `line ${String(i).padStart(2, '0')}: ${longLine}`).join('\n') + '\n```';
await postRender({ markdown: codeMd, width: 600 }, 'POST 长代码换行', { save: 'code-wrap.png' });

// 6. JPEG
await postRender({ markdown: sample, format: 'jpeg', quality: 88 }, 'POST JPEG 输出', { save: 'sample.jpg' });

// 7. base64 返回
await postRender({ markdown: '## 你好\n\n$e^{i\\pi}+1=0$', return: 'base64' }, 'POST base64 返回', { type: 'json' });

// 8. GET 快捷渲染
{
  const resp = await fetch(`${base}/render?md=${encodeURIComponent('# GET 渲染\n\n**成功!** $x^2$')}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'get-render.png'), buf);
  record('GET /render?md=', resp.ok && resp.headers.get('content-type')?.startsWith('image/'), `${resp.headers.get('content-type')} ${(buf.length / 1024).toFixed(1)}KB`);
}

// 9. 纯文本 body
{
  const resp = await fetch(`${base}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown' },
    body: '# 纯文本 POST\n\n- 支持 `text/markdown`\n- $\\alpha + \\beta = \\gamma$',
  });
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'text-post.png'), buf);
  record('POST text/markdown', resp.ok && buf.length > 3000, `HTTP ${resp.status} ${(buf.length / 1024).toFixed(1)}KB`);
}

// 10. 错误处理
{
  const r1 = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  record('空内容 -> 400', r1.status === 400, `HTTP ${r1.status}`);
  const r2 = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  record('非法 JSON -> 400', r2.status === 400, `HTTP ${r2.status}`);
  const r3 = await fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: '# x', theme: 'purple' }) });
  record('非法参数 -> 400', r3.status === 400, `HTTP ${r3.status}`);
  const r4 = await fetch(`${base}/api/notexist`);
  record('未知接口 -> 404', r4.status === 404, `HTTP ${r4.status}`);
}

console.log('\n' + (failed ? `❌ ${failed} 项失败` : '🎉 全部通过') + ` · 图片输出目录: test/out/\n`);
server.close();
process.exit(failed ? 1 : 0);
