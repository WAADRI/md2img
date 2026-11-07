# AI 助手回复示例

你好!这里是 **MD2IMG** 的功能演示 —— 下面展示一份典型的 AI 回复内容,包含公式、代码、表格与图表的完整渲染效果。

## 数学公式

质能方程 $E = mc^2$ 是物理学中最著名的公式之一。欧拉公式 $$e^{i\pi} + 1 = 0$$ 被誉为最优美的等式。

高斯积分:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

也支持 `\( \)` 和 `\[ \]` 定界符,例如 \(a^2 + b^2 = c^2\) 以及:

\[
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
\]

矩阵与求和也毫无压力:

$$
A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}, \qquad \sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}
$$

## 代码块

一个防抖函数(JavaScript):

```javascript
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

// 用法示例
window.addEventListener('resize', debounce(() => {
  console.log('窗口尺寸变化:', window.innerWidth, 'x', window.innerHeight);
}, 200));
```

Python 快速排序:

```python
def quick_sort(arr: list[int]) -> list[int]:
    """快速排序(简洁版)"""
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

print(quick_sort([3, 6, 8, 10, 1, 2, 1]))
# [1, 1, 2, 3, 6, 8, 10]
```

未指定语言的代码块会自动探测,且**超长行会自动换行**而不会被裁剪:

```python
def process(user_id: int, action: str, payload: dict, retries: int = 3, timeout_ms: int = 5000, enable_cache: bool = True, extra_headers: dict | None = None):
    # 这是一行非常长的函数签名,用来验证代码块在窄卡片下的自动换行能力,确保内容完整展示不裁剪
    return {"user_id": user_id, "action": action, "payload": payload, "retries": retries}
```

## 表格

| 模型 | 上下文 | 输入价格 | 输出价格 | 备注 |
| --- | --- | --- | --- | --- |
| GPT-4o | 128K | $2.50 | $10.00 | 多模态 |
| Claude 3.5 Sonnet | 200K | $3.00 | $15.00 | 编程能力强 |
| DeepSeek-V3 | 64K | ¥1.00 | ¥2.00 | 高性价比 |
| GLM-4-Plus | 128K | ¥5.00 | ¥5.00 | 中文优化 |

## 列表与任务

1. 支持的语法特性
   - 数学公式(行内 / 块级 / 对齐环境)
   - 代码高亮(190+ 语言)
   - Mermaid 流程图 / 时序图
   - GFM 表格、任务列表、删除线
2. 输出格式:PNG / JPEG / WebP

- [x] LaTeX 公式渲染
- [x] 深色主题
- [ ] 后续:局部高清重绘

## 引用与提示

> **提示**:这份图片由 MD2IMG 服务渲染生成。
> 适用于 AI 中转站、聊天记录分享、知识库归档等场景。

---

行内元素:*斜体*、**加粗**、~~删除线~~、`inline code`、[链接](https://github.com)、<mark>高亮文本</mark>,以及 emoji 🎉🚀✨。
