# Source-faithful article files

Use `--article-file` only when normal URL retrieval and the CLI's direct HTTP fallback both fail, but another authorized retrieval path exposes the complete public article. This is a handoff format for retrieval, not a way around access controls.

## JSON shape

Provide one article object per file:

```json
{
  "sourceUrl": "https://example.com/original-article",
  "title": "Original title",
  "subtitle": "Optional deck",
  "author": "Original author",
  "publication": "Original publication",
  "published": "2026-08-25",
  "expectedWords": 1800,
  "retrievalNote": "Complete public text retrieved through an alternate authorized channel.",
  "bodyHtml": "<p>The complete article body...</p>"
}
```

`sourceUrl`, `title`, and `bodyHtml` are required. The source URL must use HTTP or HTTPS. `expectedWords` is optional but recommended when the retrieval path reports a count; Stillfolio rejects a body more than 10% shorter. `retrievalNote` appears as a console warning, not in the PDF.

`bodyHtml` may contain source-faithful paragraphs, headings, lists, blockquotes, tables, hyperlinks, figures, captions, and HTTP(S) or base64 raster images. Stillfolio applies its normal sanitizer, image embedding, reading layout, source footer, and PDF checks.

Run one file:

```bash
node scripts/article-to-pdf.mjs --article-file article.json
```

Files and URLs can be combined in command-line order:

```bash
node scripts/article-to-pdf.mjs --combined URL1 --article-file article2.json URL3
```

## Fidelity and access requirements

- Use the complete article body, not a summary, excerpt, rewritten version, translated version, search snippet, or subscription preview.
- Preserve paragraph order and all available attribution. Keep `sourceUrl` pointed at the user's original article, even when a lawful official mirror supplies an image or metadata.
- Compare the beginning, ending, paragraph count, and word count with the public source or a trustworthy complete index before rendering.
- Record uncertainty in `retrievalNote` and stop if completeness cannot be established.
- Do not assemble content from a paywall preview, authenticated session, CAPTCHA bypass, anti-bot evasion, or unauthorized copy.
- Rights remain with the article's authors, artists, publishers, and other rights holders. The article file does not grant republication or distribution permission.
