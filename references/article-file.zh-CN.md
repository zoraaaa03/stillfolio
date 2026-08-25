# 忠于来源的文章文件

仅当普通 URL 获取与 CLI 的直接 HTTP 回退都失败，但另一个已获授权的通道能够提供完整公开文章时，才使用 `--article-file`。这是获取层与排版层之间的交接格式，不是绕过访问控制的方法。

## JSON 格式

每个文件只放一篇文章：

```json
{
  "sourceUrl": "https://example.com/original-article",
  "title": "原始标题",
  "subtitle": "可选副标题",
  "author": "原作者",
  "publication": "原出版方",
  "published": "2026-08-25",
  "expectedWords": 1800,
  "retrievalNote": "通过另一条授权通道取得完整公开正文。",
  "bodyHtml": "<p>完整文章正文……</p>"
}
```

`sourceUrl`、`title` 和 `bodyHtml` 为必填项，来源 URL 必须使用 HTTP 或 HTTPS。若获取通道提供词数，建议填写 `expectedWords`；实际正文比它少 10% 以上时，Stillfolio 会拒绝继续。`retrievalNote` 只显示为终端警告，不写入 PDF。

`bodyHtml` 可以包含忠于来源的段落、标题、列表、引用、表格、链接、图片与图注，以及 HTTP(S) 或 base64 位图。Stillfolio 仍会执行正常的内容清理、图片嵌入、阅读版排版、来源页脚和 PDF 检查。

```bash
node scripts/article-to-pdf.mjs --article-file article.json
node scripts/article-to-pdf.mjs --combined URL1 --article-file article2.json URL3
```

## 完整性与访问要求

- 必须使用完整正文，不能使用摘要、节选、改写、翻译、搜索片段或订阅预览。
- 保持段落顺序与所有可用署名；即使图片或元数据来自合法的官方镜像，`sourceUrl` 仍应指向用户给出的原文。
- 渲染前对照公开来源或可信的完整索引，检查开头、结尾、段落数和词数。
- 如有不确定性，写入 `retrievalNote`；无法确认完整性时停止。
- 不得用付费墙预览、登录会话、CAPTCHA 绕过、反机器人规避或未授权副本拼装文章。
- 文章、插画与图片权利仍属于作者、艺术家、出版方及其他权利人；文章文件不会赋予转载或传播许可。
