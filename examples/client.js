/**
 * MD2IMG 客户端示例:把 Markdown 文件渲染为图片
 * 用法:node examples/client.js reply.md [输出.png] [主题]
 */
import fs from 'node:fs';

const [input = 'sample.md', output = 'output.png', theme = 'light'] = process.argv.slice(2);
const base = process.env.MD2IMG_URL || 'http://localhost:8307';

const resp = await fetch(`${base}/api/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    markdown: fs.readFileSync(input, 'utf8'),
    theme,
    width: 800,
    scale: 2,
  }),
});

if (!resp.ok) {
  console.error(`渲染失败 HTTP ${resp.status}:`, await resp.text());
  process.exit(1);
}

fs.writeFileSync(output, Buffer.from(await resp.arrayBuffer()));
console.log(`✅ 已生成 ${output} (${resp.headers.get('x-md2img-width')}x${resp.headers.get('x-md2img-height')})`);
