# Setup, access, and extraction limits

## Setup

- Require Node.js 20 or newer.
- Run `npm install` once in the skill directory.
- The script first tries the Chrome channel, then Playwright's bundled Chromium. If neither launches, run `npm run setup:browser`.
- Set `ARTICLE_PDF_BROWSER_PATH` to an explicit Chrome/Chromium executable only when normal discovery fails.

## Access boundaries

Do not bypass a paywall, login, CAPTCHA, robots restriction, geographic restriction, or other access control. A page that exposes only a preview can yield only that preview. Report the restriction instead of claiming a complete conversion.

Some sites distinguish automated browsers, require consent, or return different HTML by region. Retrying may help a transient load, but persistent denial is a hard limitation.

## Extraction limits

- JavaScript-delayed sections may appear after the script's bounded lazy-load pass and therefore remain unavailable.
- Infinite-scroll pages, live blogs, embedded social posts, interactive charts, audio, and video do not map reliably to static article PDFs.
- Generic DOM fallback can retain modest extra material or miss unusually structured body sections. Compare suspicious output with the source and improve generic scoring before considering a narrowly scoped site rule.
- Metadata quality depends on JSON-LD, Open Graph, standard meta tags, and the article DOM. Missing or contradictory source metadata should remain missing rather than be invented.

## Image limits

- Images protected by expiring URLs, cookies, hotlink checks, or anti-bot systems may not embed.
- Lazy image URLs that never enter the rendered DOM cannot be recovered generically.
- The script excludes very small, extreme-aspect-ratio, avatar/logo-like, SVG, and oversized image responses to avoid tracking pixels and page furniture.
- An image failure must not abort the article PDF. Report it and inspect the affected page for an empty figure or broken placeholder.

## Diagnostic checks

Use `--keep-html` to retain the exact cleaned HTML beside the PDF. Check:

1. whether the missing prose is absent from HTML (extraction issue) or only from PDF (render issue);
2. whether a failed image URL is still protected or expired;
3. whether output word and paragraph counts are implausibly low;
4. whether the page loaded an interstitial instead of the article.
