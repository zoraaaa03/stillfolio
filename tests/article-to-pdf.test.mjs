import assert from "node:assert/strict";
import test from "node:test";

import {
  extractArticle,
  normalizeSuppliedArticle,
  renderSourcePage,
  sanitizeContent,
} from "../scripts/article-to-pdf.mjs";

const SOURCE_URL = "https://example.com/essay";

function prose(wordTarget) {
  const sentence =
    "Careful readers preserve the complete public article, its context, its sequence, and its attribution.";
  return `<p>${Array.from({ length: Math.ceil(wordTarget / 13) }, () => sentence).join(" ")}</p>`;
}

function page(body, extra = "") {
  return `<!doctype html><html><head><title>Example Essay</title></head><body>${extra}<article><h1>Example Essay</h1>${body}</article></body></html>`;
}

test("rejects a short extraction when the page advertises a long read", () => {
  const html = page(`<p>15 min read</p>${prose(260)}`);
  assert.throws(
    () => extractArticle(html, SOURCE_URL),
    /suspiciously short.*15-minute read/i,
  );
});

test("rejects access previews instead of treating them as complete articles", () => {
  const html = page(`<p>Member-only story</p>${prose(300)}`);
  assert.throws(() => extractArticle(html, SOURCE_URL), /access preview/i);
});

test("does not reject a complete article that discusses preview wording in prose", () => {
  const html = page(
    `<p>This article discusses the phrase member-only story as one small example inside a much longer analysis. ` +
      `${Array.from({ length: 18 }, () => "The surrounding public argument remains complete and attributable.").join(" ")}</p>`,
  );
  const article = extractArticle(html, SOURCE_URL);
  assert.ok(article.words >= 120);
});

test("recovers a publication date from a generic post metadata element", () => {
  const html = page(
    prose(150),
    '<div class="post-meta">by <span class="post-author">Example Author</span>' +
      '<span class="post-date">September 3, 2015</span></div>',
  );
  const article = extractArticle(html, SOURCE_URL);
  assert.equal(article.published, "September 3, 2015");
});

test("removes image interaction prompts without removing the figure", () => {
  const cleaned = sanitizeContent(
    `<figure><div><p><span>Press enter or click to view image in full size</span></p>` +
      `<img src="data:image/png;base64,AA==" alt="Example"><figcaption>Original caption.</figcaption></div></figure>` +
      prose(140),
    SOURCE_URL,
    "Example Essay",
  );
  assert.doesNotMatch(cleaned, /Press enter/i);
  assert.match(cleaned, /<figure>/);
  assert.match(cleaned, /Original caption/);
  assert.match(cleaned, /data:image\/png;base64,AA==/);
});

test("validates and sanitizes a source-faithful article file", () => {
  const article = normalizeSuppliedArticle(
    {
      sourceUrl: SOURCE_URL,
      title: "Example Essay",
      author: "Example Author",
      publication: "Example Review",
      published: "2026-08-25",
      expectedWords: 140,
      bodyHtml: `<p>Press enter or click to view image in full size</p>${prose(150)}`,
    },
    "example.json",
  );
  assert.equal(article.mode, "article-file");
  assert.equal(article.canonicalUrl, SOURCE_URL);
  assert.equal(article.author, "Example Author");
  assert.ok(article.words >= 140);
  assert.doesNotMatch(article.bodyHtml, /Press enter/i);
});

test("uses direct HTTP HTML when browser navigation fails", async () => {
  const html = page(prose(180));
  const pageMock = {
    async goto() {
      throw new Error("navigation timeout");
    },
    context() {
      return {
        request: {
          async get() {
            return {
              headers: () => ({ "content-type": "text/html; charset=utf-8" }),
              ok: () => true,
              status: () => 200,
              text: async () => html,
            };
          },
        },
      };
    },
  };

  const rendered = await renderSourcePage(pageMock, SOURCE_URL);
  assert.equal(rendered.html, html);
  assert.match(rendered.warnings.join(" "), /direct HTTP fallback/i);
});
