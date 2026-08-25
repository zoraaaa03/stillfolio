# Stillfolio · 静页

[English](README.md) | **简体中文**

Stillfolio 是一个个人 Codex Skill：输入一篇或多篇公开文章的 URL，得到适合阅读、批注与归档的 PDF。它保留正文顺序、标题、作者、发布日期、链接、正文图片与图注，同时尽量移除广告、导航、订阅框、评论和推荐内容。

技术标识仍为 `web-article-to-pdf`，以保持清晰可靠的自动触发。

## 名字

**Stillfolio** 由两个词组成：

- **still**：安静的，也指把不断变化的网页“定格”下来；
- **folio**：成册的书页、可收藏的纸本。

中文名 **静页** 表达的是同一件事：不复制网站外围的喧闹，只保留文章本身及其应有的来源与署名。

## 使用

对 Codex 说：

```text
把这篇文章转成干净、适合阅读的 PDF：<URL>
```

或显式调用：

```text
Use $web-article-to-pdf to convert <URL> into a clean reading PDF.
```

直接运行：

```bash
node scripts/article-to-pdf.mjs "https://example.com/article"
```

多篇文章可分别导出，也可以合成阅读包：

```bash
node scripts/article-to-pdf.mjs URL1 URL2 URL3
node scripts/article-to-pdf.mjs --combined URL1 URL2 URL3
```

如果浏览器导航和自动的直接 HTTP 回退都失败，Stillfolio 也可以接收由其他授权通道取得、经过校验且忠于来源的文章 JSON：

```bash
node scripts/article-to-pdf.mjs --article-file article.json
```

这个回退只适用于能够确认完整的公开文章，不能使用摘要、搜索片段、订阅预览或访问控制绕过结果。格式与完整性要求见 [`references/article-file.zh-CN.md`](references/article-file.zh-CN.md)。

## 工作方式

```text
URL
  → 浏览器渲染与懒加载
  → 导航失败时进行一次有时限的直接 HTTP 回退
  → 正文提取
  → 通用 DOM 回退
  → 安全清理与图片归一化
  → 阅读版排版
  → 带页码与来源链接的 PDF
```

Stillfolio 不使用网站原生的“打印为 PDF”。它先提取文章，再用独立的阅读样式排版，以避免把网页界面和广告一起印进文件。

它也会防止“假成功”：常见的访问预览提示、可疑的省略号结尾，以及与页面标示阅读时长明显不符的过短正文，都会被拒绝，而不会被当成完整 PDF 交付。

## 能转换哪些内容

主要限制不是文章主题或编辑类别，而是能否取得完整、连贯、公开的文章正文：

- 很适合：新闻、随笔、杂志长文、博客、访谈、评论，以及高校或机构文章。
- 通常可处理：服务端渲染页面，以及能在有限渲染时间内暴露正文的 JavaScript 页面。
- 可能有损：实时博客、无限滚动、图集、复杂表格、嵌入式社交串和交互图表。
- 应使用其他流程：音频、视频、Web 应用，以及已有的 PDF 或 Office 文档。
- 不在范围内：付费墙、登录、CAPTCHA、地域限制、反机器人门槛及其他访问控制。

## 灵感、参考与致谢

Stillfolio 站在一条很长的“阅读模式”传统上。这里把“实际依赖”和“概念参考”分开说明，避免把灵感误写成原创，也避免暗示不存在的合作关系。

### 实际依赖

| 项目 | 在 Stillfolio 中的作用 | 许可与署名 |
|---|---|---|
| [Mozilla Readability](https://github.com/mozilla/readability) | 从 DOM 中识别标题、署名与文章正文；这是 Firefox Reader View 使用的独立正文提取库 | Apache License 2.0；其 NOTICE 署名 Arc90 Inc、Mozilla 及贡献者 |
| [Playwright](https://github.com/microsoft/playwright) | 渲染需要 JavaScript 的页面、触发懒加载，并把清理后的 HTML 输出为 PDF | Apache License 2.0；Microsoft 及贡献者 |
| [jsdom](https://github.com/jsdom/jsdom) | 在 Node.js 中解析、检查与清理 DOM | MIT License；jsdom 作者与贡献者 |

这些项目的名称和商标属于各自权利人。Stillfolio 是独立项目，与 Mozilla、Microsoft、jsdom 项目及任何被转换的网站均无隶属、赞助或背书关系。第三方依赖继续受各自许可证约束；安装后的依赖目录中保留其许可证与 NOTICE 文件。

### 概念参考

- [Percollate](https://github.com/danburzo/percollate) 证明了“网页 → 正文提取 → 自定义排版 → 阅读文件”是一条优雅、可维护的命令行工作流，也启发了多 URL 与阅读包的交互方式。
- Firefox Reader View、浏览器阅读模式与传统长文编辑排版，共同启发了“内容优先、低装饰、舒适行距、清晰层级”的设计原则。

当前实现没有复制 Percollate 的源码或模板，也没有复刻 HuffPost、Aeon 或其他媒体的视觉设计。版式和清理逻辑为本 Skill 独立实现。

## 版权与负责任使用

Stillfolio 处理的是文章的**副本格式**，不是文章版权的转让：

- 文章文字、摄影、插画、图注及其他内容的权利仍属于原作者、摄影师、插画师、出版方或其他权利人。
- 生成 PDF 不会赋予使用者转载、公开传播、销售或再授权文章内容的权利。
- 仅处理你有权访问的公开页面，并仅在适用法律、网站条款和权利人许可允许的范围内使用结果。
- 未经许可，不要公开上传或分发生成的 PDF；引用时应保留作者、出版方和原始 URL。
- 不绕过付费墙、登录、CAPTCHA、地域限制、反机器人措施或其他访问控制。
- 图片无法合法或可靠获取时，工具会继续生成 PDF 并报告缺失，而不是规避限制。

每份 PDF 都会在末尾保留原始文章 URL；有可用元数据时，也会保留作者、出版方和发布日期。不要删除这些信息以制造来源不明的副本。

本段是项目的使用原则，不构成法律意见。若用途涉及公开传播、教学材料、机构归档或商业使用，请根据所在地法律与来源网站条款另行确认授权。

## Skill 源码许可

Stillfolio 的原创源码目前未附加单独的开源许可证。公开可见不等于获得复制、修改、再分发、商业化或再授权的许可；除适用法律及 GitHub 服务条款另有规定外，应先取得源码权利人许可，或等待日后添加明确的许可证。第三方依赖不受这一说明影响，始终按各自许可证使用。

## 边界

正文提取不可能对所有网站都完美。即使页面仍被公开索引，本机网络路由也可能失败；无限滚动、交互图表、短时效图片链接和特殊页面结构仍可能造成缺失。Stillfolio 会使用有边界的获取回退与完整性启发式检查，并要求最终核验，而不会把已知预览或访问页冒充成完整文章。
