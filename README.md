# Stillfolio · 静页

**English** | [简体中文](README.zh-CN.md)

Stillfolio is a personal Codex Skill that turns one or more public article URLs into PDFs for reading, annotation, and archiving. It preserves article order, title, author, publication date, links, meaningful images, and captions while removing ads, navigation, signup boxes, comments, and recommendations where possible.

The technical skill identifier remains `web-article-to-pdf`, keeping its automatic invocation clear and reliable.

## The name

**Stillfolio** combines:

- **still**: quiet, and also a way to hold a changing webpage still;
- **folio**: a gathered set of pages made to be read and kept.

The Chinese name **静页** expresses the same idea: preserve the article and its attribution without reproducing the noise of the website around it.

## Use it

Ask Codex:

```text
Convert this article into a clean reading PDF: <URL>
```

Or invoke the skill explicitly:

```text
Use $web-article-to-pdf to convert <URL> into a clean reading PDF.
```

Run the CLI directly:

```bash
node scripts/article-to-pdf.mjs "https://example.com/article"
```

Export several articles separately or create one reading packet:

```bash
node scripts/article-to-pdf.mjs URL1 URL2 URL3
node scripts/article-to-pdf.mjs --combined URL1 URL2 URL3
```

## How it works

```text
URL
  → browser rendering and lazy loading
  → article extraction
  → generic DOM fallback
  → sanitization and image normalization
  → reading-focused typesetting
  → PDF with page numbers and source links
```

Stillfolio does not use the website's native Print to PDF output. It extracts the article first and applies an independent reading layout so website UI and advertising do not become part of the document.

## Inspiration, references, and acknowledgements

Stillfolio belongs to a long tradition of reader modes. This section separates direct dependencies from conceptual references so that inspiration is credited accurately without implying a partnership.

### Direct dependencies

| Project | Role in Stillfolio | License and attribution |
|---|---|---|
| [Mozilla Readability](https://github.com/mozilla/readability) | Identifies article titles, bylines, metadata, and body content from the DOM; it is the standalone extraction library used by Firefox Reader View | Apache License 2.0; its NOTICE credits Arc90 Inc, Mozilla, and contributors |
| [Playwright](https://github.com/microsoft/playwright) | Renders JavaScript-dependent pages, triggers lazy loading, and prints the cleaned HTML as PDF | Apache License 2.0; Microsoft and contributors |
| [jsdom](https://github.com/jsdom/jsdom) | Parses, inspects, and sanitizes DOM content in Node.js | MIT License; jsdom authors and contributors |

The names and trademarks of these projects belong to their respective owners. Stillfolio is independent and is not affiliated with, sponsored by, or endorsed by Mozilla, Microsoft, the jsdom project, or any website it processes. Third-party dependencies remain governed by their own licenses; installed dependency directories retain their license and NOTICE files.

### Conceptual references

- [Percollate](https://github.com/danburzo/percollate) demonstrated that “webpage → extraction → custom typesetting → reading document” can be an elegant, maintainable command-line workflow. It also informed the interaction model for multiple URLs and combined reading packets.
- Firefox Reader View, browser reader modes, and traditional long-form editorial typography informed the content-first layout, restrained decoration, comfortable spacing, and clear hierarchy.

The current implementation does not copy Percollate source code or templates, and it does not reproduce the visual design of HuffPost, Aeon, or any other publisher. Its extraction extensions, sanitization, and reading layout are independently implemented for this Skill.

## Copyright and responsible use

Stillfolio changes the **format of a copy**; it does not transfer copyright in the article:

- Rights in article text, photography, illustration, captions, and other content remain with their authors, photographers, illustrators, publishers, or other rights holders.
- Creating a PDF does not grant permission to republish, publicly distribute, sell, or sublicense the article.
- Process only publicly accessible pages you are authorized to access, and use the results only as permitted by applicable law, site terms, and rights-holder permissions.
- Do not upload or distribute generated PDFs without permission. Preserve author, publisher, and original URL information when quoting or citing a source.
- Do not bypass paywalls, logins, CAPTCHAs, geographic restrictions, anti-bot systems, or other access controls.
- If an image cannot be retrieved lawfully and reliably, the tool continues without it and reports the omission instead of circumventing the restriction.

Every PDF retains the original article URL and, when available, the author, publication, and publication date. Do not remove this information to create unattributed copies.

These are project usage principles, not legal advice. For public distribution, teaching materials, institutional archiving, or commercial use, independently confirm the necessary permissions under applicable law and source-site terms.

## License for original Skill code

The original Stillfolio source code currently has no separate open-source license. Public availability is not permission to copy, modify, redistribute, commercialize, or relicense it beyond rights provided by applicable law and GitHub's Terms of Service. Contact the source-code rights holder for permission unless a license is added later. Third-party dependencies are unaffected and always remain subject to their respective licenses.

## Limitations

Article extraction cannot be perfect across every website. Paywalls, login pages, infinite scroll, interactive graphics, expiring image links, and anti-automation systems can result in missing text or images. Stillfolio reports these conditions rather than presenting an incomplete access page as a complete article.
