# MD2IMG 🖼️

[![Build & Publish Docker Image](https://github.com/WAADRI/md2img/actions/workflows/docker.yml/badge.svg)](https://github.com/WAADRI/md2img/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**将 Markdown(AI 回复)完美渲染为图片的 HTTP 服务。**

专为 AI 中转站 / 聊天机器人场景设计:把大模型输出的 Markdown —— 包括 **LaTeX 数学公式、代码高亮、表格、Mermaid 图表、任务列表、`<think>` 思考过程** 等 —— 渲染成一张精美的分享图,通过 API 直接返回图片字节。渲染基于真实浏览器排版引擎(与 NextChat 等网页端渲染同源的 markdown-it + KaTeX + highlight.js 方案),所见即所得。

![示例](test/out/sample-light.png)

## ✨ 特性

- **LaTeX 数学公式**:`$...$`、`$$...$$`、`\(...\)`、`\[...\]`、独立 `\begin{align}` 环境全部支持(KaTeX 渲染,公式内 `*_\\` 等符号不会被 Markdown 语法破坏;自动缩放过宽公式,保证完整展示)
- **智能货币防误判**:`价格 $5-$10`、`合计 $15.50` 不会被当成公式;代码块里的 `$` 不参与匹配
- **代码高亮**:highlight.js,190+ 语言,未指定语言时自动探测;超长行自动换行不裁剪;Mac 风格窗口圆点 + 语言标签
- **Mermaid 图表**:流程图 / 时序图 / 甘特图等,失败时优雅降级为源码展示
- **AI 友好细节**:`<think>...</think>` 思考过程渲染为浅色卡片(可剔除);任务列表;GFM 表格;emoji;自动链接;YAML frontmatter 标题提取
- **多种输出**:PNG(可透明背景)/ JPEG / WebP,1x-4x 高清倍率,浅色 / 深色主题,卡片 / 纯色 / 透明三种边框模式
- **健壮的 API**:并发页面池、内容大小限制、渲染超时、浏览器崩溃自愈、超高图片自动降采样或分片
- **零外部依赖渲染**:字体、CSS、Mermaid 全部内联,渲染阶段完全离线;支持放入自定义字体文件自动内嵌

## 🚀 快速开始

```bash
npm install        # 会自动下载 Chromium(约 150MB)
npm start          # 默认 http://localhost:8307
```

打开 `http://localhost:8307/` 即是网页 Playground(左侧粘贴 Markdown,右侧出图)。

> 如果本机没有下载成功 Chromium,服务会自动探测系统已安装的 Chrome / Edge;也可以用环境变量 `CHROME_PATH` 指定浏览器路径。

## 📡 API

### `POST /api/render`

请求体支持两种形式:

1. **JSON**(推荐):

```bash
curl -X POST http://localhost:8307/api/render \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "# 你好\n\n支持公式 $E=mc^2$ 与代码块:",
    "theme": "light",
    "width": 800,
    "scale": 2
  }' \
  --output result.png
```

2. **纯文本正文**(选项通过 URL 查询串传递):

```bash
curl -X POST "http://localhost:8307/api/render?theme=dark&scale=2" \
  -H "Content-Type: text/markdown" \
  --data-binary @reply.md \
  --output reply.png
```

兼容别名:`POST /render`、`POST /api/md2img`、`POST /api/image`。

#### 请求参数

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `markdown` | string | (必填) | Markdown 内容,兼容 `md` / `content` / `text` 字段名 |
| `theme` | string | `light` | `light` / `dark` |
| `frame` | string | `card` | `card` 渐变背景+圆角卡片 / `plain` 纯色直出 / `transparent` 透明背景(仅 PNG);兼容布尔 `card` |
| `width` | number | `800` | 内容宽度(px,200-3840) |
| `scale` | number | `2` | 清晰度倍率(1-4),2x 即 Retina |
| `format` | string | `png` | `png` / `jpeg` / `webp` |
| `quality` | number | `90` | JPEG/WebP 质量(10-100) |
| `padding` | number | `40` | 卡片内边距(px) |
| `fontSize` | number | `15` | 正文字号(px) |
| `title` | string | 空 | 顶部标题(🤖 前缀);Markdown 的 YAML frontmatter `title` 会自动填入 |
| `footer` | string | 空 | 底部水印文字(右下角固定显示 MD2IMG) |
| `bgColor` | string | 主题默认 | 自定义背景色,支持 `#hex`、`rgb()`、`linear-gradient(...)` |
| `codeTheme` | string | 随主题 | highlight.js 主题名,如 `github`、`github-dark`、`atom-one-dark`、`nord`… |
| `breaks` | bool | `true` | 单换行是否转为 `<br>`(聊天风格);关闭则遵循标准 Markdown |
| `math` | bool | `true` | 是否渲染 LaTeX 公式 |
| `mathMacros` | object | `{}` | KaTeX 自定义宏,如 `{"RR": "\\mathbb{R}"}` |
| `mermaid` | bool | `true` | 是否渲染 Mermaid 图表 |
| `mermaidTheme` | string | 随主题 | `default` / `dark` / `neutral` / `forest` |
| `highlight` | bool | `true` | 代码高亮开关 |
| `highlightAuto` | bool | `true` | 未指定语言时自动探测 |
| `emoji` | bool | `true` | 解析 `:smile:` 短代码 |
| `sanitize` | bool | `true` | 净化内嵌 HTML(白名单);关闭则原样输出 |
| `think` | string | `keep` | `<think>` 处理:`keep` 渲染为思考卡片 / `strip` 剔除 |
| `imageTimeout` | number | `15000` | 等待远程图片加载的超时(ms),超时后占位符替代 |
| `return` | string | `binary` | `binary` 图片字节 / `base64` JSON 包装 |
| `filename` | string | 空 | 设置后响应带 `Content-Disposition` 附件下载 |

#### 响应

- 默认:图片二进制,`Content-Type: image/png|jpeg|webp`,响应头带 `X-Md2img-Width/Height/Elapsed-Ms`
- `return=base64`:`{"width":1824,"height":502,"format":"png","elapsedMs":284,"base64":"..."}`
- 内容特别超高(超过 Chromium 单图约 16000px 物理上限)时:先自动降低倍率;仍超高则分片截取,返回 `{"chunks":2,"images":["<base64>","<base64>"],...}`

#### 错误码

`400` 参数/内容非法 · `401` API Key 错误 · `404` 接口不存在 · `413` 内容超限 · `500` 渲染失败

### `GET /render?md=...`

URL 快捷渲染,方便嵌入 `<img>` 标签或快速测试:

```
GET /render?md=#%20%E6%A0%87%E9%A2%98&theme=dark&scale=1
```

### 其他端点

| 端点 | 说明 |
| --- | --- |
| `GET /` | 网页 Playground |
| `GET /health` | 健康检查(含浏览器状态) |
| `GET /api/config` | 服务能力与可选主题列表 |
| `POST /api/preview` | 返回渲染后的 HTML(iframe 预览 / 调试用) |

### Python 客户端示例

```python
import requests

resp = requests.post("http://localhost:8307/api/render", json={
    "markdown": open("reply.md", encoding="utf-8").read(),
    "theme": "light",
    "width": 800,
    "scale": 2,
})
resp.raise_for_status()
with open("reply.png", "wb") as f:
    f.write(resp.content)
```

### JavaScript 客户端示例

```js
const resp = await fetch("http://localhost:8307/api/render", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ markdown, theme: "light" }),
});
const blob = await resp.blob(); // 直接得到图片
```

## ⚙️ 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8307` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `API_KEY` | 空 | 设置后启用鉴权(`Authorization: Bearer <key>` / `X-API-Key` / `?key=`) |
| `CONCURRENCY` | `4` | 同时渲染的页面数(建议 = CPU 核数) |
| `MAX_BODY_KB` | `2048` | 请求体大小上限 |
| `RENDER_TIMEOUT_MS` | `45000` | 单次渲染超时 |
| `IMAGE_TIMEOUT_MS` | `15000` | 远程图片等待超时 |
| `CHROME_PATH` | 自动探测 | 无头浏览器路径 |
| `CORS_ORIGIN` | `*` | 跨域允许来源 |

## 🐳 Docker 部署

预构建镜像由 GitHub Actions 自动发布到 GHCR(推送到 `main` 或打 `v*` 标签时触发):

```bash
# 拉取并运行预构建镜像
docker pull ghcr.io/waadri/md2img:latest
docker run -d --name md2img -p 8307:8307 -e API_KEY=your-secret ghcr.io/waadri/md2img:latest

# 或使用 compose(镜像不存在时自动本地构建)
docker compose up -d
```

本地构建:

```bash
docker build -t md2img .
docker run -d -p 8307:8307 -e API_KEY=your-secret md2img
```

镜像内置 Chromium 与 Noto CJK / Emoji 字体,中文与 emoji 开箱即用。

## 🔤 自定义字体

把字体文件(`.woff2` / `.woff` / `.ttf` / `.otf`)放入 `assets/fonts/`,重启后自动内嵌到渲染页面;文件名含 `mono/code` 的会并入代码字体栈,其余并入正文字体栈。例如部署到无中文字体的 Linux 服务器时,放入 `NotoSansSC-Regular.woff2` 即可。

## 🔒 安全说明

- 内嵌 HTML 默认经白名单净化(`sanitize-html`),`<script>`、事件属性、危险协议均被移除
- KaTeX 输出为静态 HTML,`trust` 关闭,不执行 `\href` 等敏感命令
- 建议在生产环境设置 `API_KEY`,并在前置 Nginx 做限流

## ❓ FAQ

**公式没有渲染,显示原始 `$...$`?**
检查是否被反斜杠转义(如 JSON 里需 `\\(`)、或触发了货币防误判(公式以数字开头/结尾时建议改用 `\(...\)` 定界符)。

**Linux 服务器中文显示为方框?**
安装 Noto CJK 字体(`apt install fonts-noto-cjk`),或按上文放入自定义字体文件。

**图片内存 / 速度?**
单张 800px 宽 2x 图典型耗时 300-800ms;并发由 `CONCURRENCY` 控制,浏览器实例全局复用。

## License

MIT
