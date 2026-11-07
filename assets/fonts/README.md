# 自定义字体目录

把字体文件放入本目录(`.woff2` / `.woff` / `.ttf` / `.otf`),服务启动时会把它们**自动内嵌**(base64)到渲染页面,无需任何配置。

规则:

- 文件名(去扩展名)含 `mono` / `code` / `consol`(不区分大小写)→ 并入**代码**字体栈
- 其余 → 并入**正文**字体栈
- 自定义字体优先于系统字体,适合在无中文字体的服务器上放置 `NotoSansSC-Regular.woff2` 等

示例:

```
assets/fonts/
├── NotoSansSC-Regular.woff2      # 正文中文字体
└── JetBrainsMono-Regular.woff2   # 代码字体(命中 mono 规则)
```

> 提示:同一字体放入多个字重文件时以 family 命名区分即可;建议只放需要的字重以控制内存占用。
