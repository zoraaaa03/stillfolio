---
name: web-article-to-pdf
description: Convert one or more public web article URLs into polished, clutter-free reading PDFs while preserving the original title, byline, date, article order, hyperlinks, meaningful images, and captions. Use when Codex is asked to save, archive, print, annotate, package, or convert an online article, blog post, magazine story, news story, essay, or university webpage as a clean PDF; also use for combined reading packets. Do not use to bypass paywalls, logins, access controls, or anti-bot protections.
---

# Stillfolio · 静页

Turn noisy public article pages into quiet, source-faithful reading PDFs. Render each page with Playwright, extract with Mozilla Readability, sanitize the result, embed retrievable article images, and print only the cleaned reading layout.

## Run the workflow

1. Resolve this skill directory and verify Node.js 20 or newer.
2. If `node_modules/` is absent, run `npm install` in this skill directory. If no supported Chrome/Chromium is installed, also run `npm run setup:browser`.
3. Run from the user's working directory so the default `./output/` location is useful:

   ```bash
   node <skill-dir>/scripts/article-to-pdf.mjs "https://example.com/article"
   ```

4. For several separate PDFs, pass several URLs:

   ```bash
   node <skill-dir>/scripts/article-to-pdf.mjs URL1 URL2 URL3
   ```

5. For one packet, add `--combined`:

   ```bash
   node <skill-dir>/scripts/article-to-pdf.mjs --combined URL1 URL2 URL3
   ```

6. Use `--output-dir <directory>` for a destination other than `./output/`, `--page-size A4` when requested, and `--keep-html` only for debugging.
7. Inspect every generated PDF before delivering it. Render pages with `pdftoppm`, check representative first/middle/last pages, and verify text with `pdftotext` or `pdfinfo`. Confirm the title, byline/date when available, paragraph continuity, image placement, source link, and absence of site chrome.

## Preserve source fidelity

- Never summarize, rewrite, translate, reorder, or silently omit article prose.
- Treat title, subtitle/deck, byline, publication, and published date as metadata; preserve them when the page exposes them.
- Preserve section headings, quotations, lists, tables, links, figures, and captions when extraction retains them.
- Use the generated report's word and paragraph counts as diagnostics, not proof. Visually compare suspiciously short output with the rendered page.
- Do not use the website's print view or raw browser print-to-PDF as the deliverable.

## Interpret extraction results

The CLI reports one of these modes:

- `readability`: normal Mozilla Readability extraction.
- `dom-fallback`: Readability was insufficient; the script selected the strongest generic article/main content container.
- `failed`: no credible body could be extracted. Do not present a failed or access-denied page as a completed article.

If output is missing substantial prose, rerun once after checking page access and inspect `--keep-html` output. Prefer improving general extraction logic over adding a site-specific selector.

## Handle failures

- Continue past an individual image failure and report the missing image URL.
- Continue processing later URLs if one article fails.
- Treat a login page, subscription interstitial, CAPTCHA, robots denial, or HTTP access error as blocked. Do not bypass it.
- Keep console output concise: title, source URL, extraction mode, counts, PDF path, and important warnings.
- Read [references/limitations.md](references/limitations.md) when setup fails, access is restricted, images are missing, or extraction is unexpectedly short.

## Deliver results

Report for each article:

- article title;
- source URL;
- absolute PDF path;
- extraction mode;
- missing metadata or image warnings.

For combined output, also list the included articles in packet order. Link the final PDF paths and mention any unavoidable limitation.
