#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_ARTICLE_WORDS = 120;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 20_000;
const NAVIGATION_TIMEOUT_MS = 50_000;
const DIRECT_FETCH_TIMEOUT_MS = 30_000;
const NOISE_RE =
  /(^|[-_\s])(ad|ads|advert|advertisement|banner|breadcrumb|cookie|consent|comment|footer|header|masthead|menu|nav|newsletter|outbrain|paywall|popup|promo|recommend|related|share|sharing|sidebar|social|sponsor|subscribe|taboola|toolbar)([-_\s]|$)/i;
const IMAGE_NOISE_RE =
  /(^|[-_\s])(avatar|badge|brand|emoji|favicon|headshot|icon|logo|pixel|profile|share|social|sprite|tracking)([-_\s]|$)/i;
const INTERACTION_PROMPT_RE =
  /^(?:press enter or click to view image in full size|click to (?:expand|enlarge|view) (?:the )?image|tap to (?:expand|enlarge|view) (?:the )?image|open (?:the )?image in full size)$/i;
const ACCESS_PREVIEW_RE =
  /\b(?:member[- ]only story|subscriber[- ]only|sign in to (?:continue|read)|subscribe to (?:continue|keep reading|read)|create an account to continue|unlock (?:this|the) (?:article|story)|already a subscriber)\b/i;
const ARTICLE_TYPES = new Set([
  "Article",
  "NewsArticle",
  "BlogPosting",
  "ReportageNewsArticle",
  "ScholarlyArticle",
  "TechArticle",
]);

function usage() {
  return `Usage:
  article-to-pdf.mjs [options] URL [URL ...]
  article-to-pdf.mjs [options] --article-file article.json [--article-file article.json ...]

Options:
  --combined              Create one reading packet instead of one PDF per article
  --article-file FILE     Use one source-faithful article JSON file (repeatable)
  --output-dir DIR        Output directory (default: ./output)
  --page-size SIZE        Letter or A4 (default: Letter)
  --keep-html             Retain cleaned HTML beside each PDF for debugging
  --help                  Show this help

Environment:
  ARTICLE_PDF_BROWSER_PATH  Explicit Chrome/Chromium executable path`;
}

function parseArgs(argv) {
  const options = {
    combined: false,
    keepHtml: false,
    outputDir: path.resolve(process.cwd(), "output"),
    pageSize: "Letter",
    inputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (value === "--combined") {
      options.combined = true;
    } else if (value === "--keep-html") {
      options.keepHtml = true;
    } else if (value === "--article-file") {
      const next = argv[++index];
      if (!next) throw new Error("--article-file requires a JSON file");
      options.inputs.push({ kind: "article-file", value: path.resolve(process.cwd(), next) });
    } else if (value === "--output-dir") {
      const next = argv[++index];
      if (!next) throw new Error("--output-dir requires a directory");
      options.outputDir = path.resolve(process.cwd(), next);
    } else if (value === "--page-size") {
      const next = argv[++index];
      if (!next || !["letter", "a4"].includes(next.toLowerCase())) {
        throw new Error("--page-size must be Letter or A4");
      }
      options.pageSize = next.toLowerCase() === "a4" ? "A4" : "Letter";
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`Invalid URL: ${value}`);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`Only HTTP(S) URLs are supported: ${value}`);
      }
      options.inputs.push({ kind: "url", value: parsed.href });
    }
  }

  if (options.inputs.length === 0) {
    throw new Error("Provide at least one article URL or --article-file");
  }
  return options;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n ]+/g, " ")
    .trim();
}

function textKey(value) {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function wordCount(value) {
  const matches = cleanText(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return matches?.length || 0;
}

function documentBodyText(document) {
  const selector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, td, th, dt, dd";
  const blocks = [...document.querySelectorAll(selector)].filter(
    (element) => !element.querySelector(selector),
  );
  if (blocks.length) return cleanText(blocks.map((element) => element.textContent).join(" "));
  return cleanText(document.body?.textContent);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeImageUrl(value, baseUrl) {
  if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(value || "")) return value;
  return normalizeUrl(value, baseUrl);
}

function filenameFromTitle(title, fallback = "article") {
  const normalized = cleanText(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 110);
  return normalized || fallback;
}

function metaValue(document, ...keys) {
  for (const key of keys) {
    const escaped = key.replaceAll('"', '\\"');
    const element =
      document.querySelector(`meta[property="${escaped}"]`) ||
      document.querySelector(`meta[name="${escaped}"]`) ||
      document.querySelector(`meta[itemprop="${escaped}"]`);
    const value = cleanText(element?.getAttribute("content"));
    if (value) return value;
  }
  return "";
}

function flattenJsonLd(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output);
  } else if (value && typeof value === "object") {
    output.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], output);
  }
  return output;
}

function jsonLdArticles(document) {
  const nodes = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      flattenJsonLd(JSON.parse(script.textContent), nodes);
    } catch {
      // Invalid JSON-LD is common and must not abort extraction.
    }
  }
  return nodes.filter((node) => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.some((type) => ARTICLE_TYPES.has(type));
  });
}

function personName(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(personName).filter(Boolean).join(", ");
  if (typeof value === "string") return cleanText(value);
  return cleanText(value.name || [value.givenName, value.familyName].filter(Boolean).join(" "));
}

function publisherName(value) {
  if (!value) return "";
  if (typeof value === "string") return cleanText(value);
  return cleanText(value.name);
}

function domAuthorName(document) {
  const selector = [
    '[rel="author"]',
    '[itemprop="author"]',
    '[data-testid*="byline" i]',
    '[data-testid*="author" i]',
    '[class*="byline" i]',
    '[class*="author-name" i]',
    '[class*="authorName"]',
  ].join(", ");
  for (const element of document.querySelectorAll(selector)) {
    if (element.querySelector(selector)) continue;
    const candidate = cleanText(element.textContent)
      .replace(/^(?:by|written by|words by)\s+/i, "")
      .replace(/\s+(?:published|updated)\s+.+$/i, "")
      .trim();
    if (!candidate || candidate.length > 100) continue;
    if (/\b(?:newsletter|contributors?|editors?|staff directory)\b/i.test(candidate)) continue;
    if (wordCount(candidate) > 12) continue;
    return candidate;
  }
  return "";
}

function domPublishedDate(document) {
  const selector = [
    '[itemprop="datePublished"]',
    '[data-testid*="publish" i][data-testid*="date" i]',
    '[class*="date-published" i]',
    '[class*="publish-date" i]',
    '[class*="published-date" i]',
    '[class*="post-date" i]',
    '[class*="entry-date" i]',
    '[class*="article-date" i]',
  ].join(", ");
  const month =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const patterns = [
    new RegExp(`\\b(?:${month})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+\\d{4}\\b`, "i"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${month})\\s+\\d{4}\\b`, "i"),
    /\b\d{4}-\d{2}-\d{2}\b/,
  ];
  for (const element of document.querySelectorAll(selector)) {
    const text = cleanText(element.getAttribute("datetime") || element.textContent);
    if (!text || text.length > 160) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
  }
  return "";
}

function extractMetadata(document, sourceUrl) {
  const ld = jsonLdArticles(document)[0] || {};
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  const dateElement = document.querySelector("time[datetime]");
  const title = cleanText(
    ld.headline ||
      metaValue(document, "og:title", "twitter:title") ||
      document.querySelector("h1")?.textContent ||
      document.title,
  );
  const subtitle = cleanText(
    ld.alternativeHeadline ||
      metaValue(document, "article:subtitle", "parsely-title", "description", "og:description"),
  );
  const author = cleanText(
    domAuthorName(document) ||
      personName(ld.author) ||
      metaValue(document, "author", "byl", "article:author", "parsely-author") ||
      document.querySelector('[rel="author"], [itemprop="author"]')?.textContent,
  );
  const publication = cleanText(
    publisherName(ld.publisher) ||
      metaValue(document, "og:site_name", "application-name") ||
      new URL(sourceUrl).hostname.replace(/^www\./, ""),
  );
  const published = cleanText(
    ld.datePublished ||
      metaValue(
        document,
        "article:published_time",
        "datePublished",
        "date",
        "pubdate",
        "parsely-pub-date",
      ) ||
      dateElement?.getAttribute("datetime") ||
      dateElement?.textContent ||
      domPublishedDate(document),
  );
  return {
    author,
    canonicalUrl: normalizeUrl(canonical, sourceUrl) || sourceUrl,
    publication,
    published,
    subtitle: subtitle && textKey(subtitle) !== textKey(title) ? subtitle : "",
    title,
  };
}

function scoreContainer(element) {
  const text = cleanText(element.textContent);
  const textLength = text.length;
  if (textLength < 400) return -Infinity;
  const paragraphs = [...element.querySelectorAll("p")];
  const paragraphText = paragraphs.reduce((sum, paragraph) => sum + cleanText(paragraph.textContent).length, 0);
  const linkText = [...element.querySelectorAll("a")].reduce(
    (sum, link) => sum + cleanText(link.textContent).length,
    0,
  );
  const density = paragraphText / Math.max(textLength, 1);
  const linkRatio = linkText / Math.max(textLength, 1);
  const semanticBonus = element.matches("article, [itemprop='articleBody']") ? 1200 : 0;
  const noisePenalty = NOISE_RE.test(`${element.id} ${element.className}`) ? 2000 : 0;
  return textLength + paragraphs.length * 140 + density * 800 - linkRatio * 2500 + semanticBonus - noisePenalty;
}

function domFallback(document) {
  const candidates = [
    ...document.querySelectorAll(
      "article, main, [role='main'], [itemprop='articleBody'], .article-body, .article-content, .entry-content, .post-content, .story-body",
    ),
  ];
  if (candidates.length === 0 && document.body) candidates.push(document.body);
  candidates.sort((left, right) => scoreContainer(right) - scoreContainer(left));
  const winner = candidates[0];
  return winner && Number.isFinite(scoreContainer(winner)) ? winner.innerHTML : "";
}

function bestSrcsetCandidate(srcset, baseUrl) {
  if (!srcset) return "";
  const candidates = srcset
    .split(",")
    .map((entry) => {
      const [rawUrl, descriptor = ""] = entry.trim().split(/\s+/);
      const width = descriptor.endsWith("w") ? Number.parseInt(descriptor, 10) : 0;
      const density = descriptor.endsWith("x") ? Number.parseFloat(descriptor) * 1000 : 0;
      return { score: width || density, url: normalizeImageUrl(rawUrl, baseUrl) };
    })
    .filter((candidate) => candidate.url)
    .sort((left, right) => right.score - left.score);
  return candidates.find((candidate) => candidate.score <= 2600)?.url || candidates.at(-1)?.url || "";
}

function isLikelyNoiseImage(image, url) {
  const identity = `${image.id} ${image.className} ${image.getAttribute("alt") || ""} ${url}`;
  if (IMAGE_NOISE_RE.test(identity)) return true;
  const width = Number.parseInt(
    image.getAttribute("data-codex-natural-width") || image.getAttribute("width") || "0",
    10,
  );
  const height = Number.parseInt(
    image.getAttribute("data-codex-natural-height") || image.getAttribute("height") || "0",
    10,
  );
  if (width > 0 && height > 0) {
    if (width < 180 && height < 120) return true;
    const ratio = width / height;
    if (ratio > 8 || ratio < 0.12) return true;
  }
  return /(?:^|[?&])(pixel|tracking)=/i.test(url) || /(?:1x1|spacer|clear)\.(?:gif|png)/i.test(url);
}

function unwrap(element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
}

function sanitizeContent(contentHtml, baseUrl, title) {
  const dom = new JSDOM(`<main id="article-root">${contentHtml || ""}</main>`, { url: baseUrl });
  const document = dom.window.document;
  const root = document.querySelector("#article-root");

  root
    .querySelectorAll(
      "script, style, link, meta, iframe, object, embed, canvas, video, audio, form, input, button, select, textarea, nav, aside, footer, noscript",
    )
    .forEach((element) => element.remove());

  for (const element of [...root.querySelectorAll("*")]) {
    if (element.matches("figure, figcaption, img")) continue;
    if (NOISE_RE.test(`${element.id} ${element.className}`)) element.remove();
  }

  for (const element of [...root.querySelectorAll("p, div, span, small")]) {
    const text = cleanText(element.textContent);
    if (text && !element.querySelector("img") && INTERACTION_PROMPT_RE.test(text)) element.remove();
  }

  for (const link of root.querySelectorAll("a[href]")) {
    const href = normalizeUrl(link.getAttribute("href"), baseUrl);
    if (href) {
      link.setAttribute("href", href);
      link.setAttribute("rel", "noopener noreferrer");
    } else {
      link.removeAttribute("href");
    }
  }

  for (const image of [...root.querySelectorAll("img")]) {
    const srcset =
      image.getAttribute("srcset") ||
      image.closest("picture")?.querySelector("source[srcset]")?.getAttribute("srcset") ||
      "";
    const source =
      bestSrcsetCandidate(srcset, baseUrl) ||
      normalizeImageUrl(
        image.getAttribute("data-codex-current-src") ||
          image.getAttribute("data-src") ||
          image.getAttribute("data-lazy-src") ||
          image.getAttribute("data-original") ||
          image.getAttribute("src"),
        baseUrl,
      );
    if (!source || isLikelyNoiseImage(image, source)) {
      const figure = image.closest("figure");
      image.remove();
      if (figure && !figure.querySelector("img")) figure.remove();
      continue;
    }
    image.setAttribute("src", source);
    image.setAttribute("data-source-url", source);
    image.setAttribute("loading", "eager");
    image.setAttribute("decoding", "sync");
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.removeAttribute("style");
  }

  for (const source of root.querySelectorAll("source")) source.remove();
  for (const picture of [...root.querySelectorAll("picture")]) unwrap(picture);

  const allowedTags = new Set([
    "A",
    "B",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "EM",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "I",
    "IMG",
    "LI",
    "OL",
    "P",
    "PRE",
    "S",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "U",
    "UL",
  ]);
  const safeAttributes = new Set([
    "alt",
    "colspan",
    "decoding",
    "data-source-url",
    "href",
    "loading",
    "rel",
    "rowspan",
    "src",
    "title",
  ]);

  for (const element of [...root.querySelectorAll("*")]) {
    if (!allowedTags.has(element.tagName)) {
      unwrap(element);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (!safeAttributes.has(attribute.name)) element.removeAttribute(attribute.name);
    }
  }

  const titleKey = textKey(title);
  for (const heading of [...root.querySelectorAll("h1, h2")].slice(0, 3)) {
    if (titleKey && textKey(heading.textContent) === titleKey) heading.remove();
  }
  for (const element of root.querySelectorAll("p, div, span, figcaption")) {
    if (!cleanText(element.textContent) && !element.querySelector("img")) element.remove();
  }

  return root.innerHTML;
}

function shortError(error) {
  return cleanText(error?.message || error).slice(0, 240);
}

async function directHttpFallback(page, url, navigationError) {
  let response;
  try {
    response = await page.context().request.get(url, {
      failOnStatusCode: false,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
      },
      timeout: DIRECT_FETCH_TIMEOUT_MS,
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const contentType = (response.headers()["content-type"] || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error(`unsupported content type ${contentType}`);
    }
    const html = await response.text();
    if (!/<(?:html|body|article|main)\b/i.test(html)) throw new Error("response did not contain article HTML");
    return {
      html,
      warnings: [
        `Browser navigation failed: ${shortError(navigationError)}`,
        "Used direct HTTP fallback; JavaScript-delayed content may be unavailable",
      ],
    };
  } catch (fetchError) {
    throw new Error(
      `Browser navigation failed (${shortError(navigationError)}); direct HTTP fallback failed (${shortError(fetchError)})`,
    );
  }
}

async function renderSourcePage(page, url) {
  const warnings = [];
  let response;
  try {
    response = await page.goto(url, {
      // Some article pages stream or defer a resource indefinitely. Treat the
      // committed response as successful navigation, then wait for DOM readiness
      // separately so usable server-rendered content is not discarded on timeout.
      waitUntil: "commit",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) warnings.push("Navigation returned no HTTP response");
    else if (response.status() >= 400) throw new Error(`source returned HTTP ${response.status()}`);
  } catch (navigationError) {
    return directHttpFallback(page, url, navigationError);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {
    warnings.push("DOMContentLoaded timed out; continued with available rendered content");
  });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(750);
  await page.evaluate(async () => {
    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const step = Math.max(600, Math.floor(window.innerHeight * 0.8));
    let lastHeight = 0;
    for (let count = 0; count < 45; count += 1) {
      const height = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0);
      const next = Math.min((count + 1) * step, height);
      window.scrollTo(0, next);
      await delay(90);
      if (next >= height && height === lastHeight) break;
      lastHeight = height;
    }
    await delay(350);
    for (const image of document.images) {
      if (image.currentSrc) image.setAttribute("data-codex-current-src", image.currentSrc);
      image.setAttribute("data-codex-natural-width", String(image.naturalWidth || 0));
      image.setAttribute("data-codex-natural-height", String(image.naturalHeight || 0));
    }
    window.scrollTo(0, 0);
  });
  return { html: await page.content(), warnings };
}

function advertisedReadingMinutes(document) {
  const primary =
    document.querySelector("article, main, [role='main'], [itemprop='articleBody']") || document.body;
  const candidates = [...primary.querySelectorAll("p, span, small, time, div")]
    .map((element) => cleanText(element.textContent))
    .filter((text) => text.length <= 100);
  const text = candidates.join(" ") || cleanText(primary?.textContent).slice(0, 5_000);
  const match = text.match(/(?:^|\D)(\d{1,3})\s*(?:min(?:ute)?s?)\s+(?:read|reading)\b/i);
  if (!match) return 0;
  const minutes = Number.parseInt(match[1], 10);
  return minutes >= 1 && minutes <= 120 ? minutes : 0;
}

function hasAccessPreviewMarker(document) {
  return [...document.querySelectorAll("p, span, small, div")].some((element) => {
    const text = cleanText(element.textContent);
    return text.length > 0 && text.length <= 180 && ACCESS_PREVIEW_RE.test(text);
  });
}

function extractArticle(renderedHtml, sourceUrl) {
  const dom = new JSDOM(renderedHtml, { url: sourceUrl });
  const document = dom.window.document;
  const metadata = extractMetadata(document, sourceUrl);
  const readingMinutes = advertisedReadingMinutes(document);
  const readable = new Readability(document.cloneNode(true), {
    charThreshold: 350,
    keepClasses: false,
    nbTopCandidates: 8,
  }).parse();

  let content = readable?.content || "";
  let mode = "readability";
  if (wordCount(readable?.textContent) < MIN_ARTICLE_WORDS) {
    content = domFallback(document);
    mode = "dom-fallback";
  }

  const title = cleanText(metadata.title || readable?.title || "Untitled article");
  const subtitleCandidate = cleanText(metadata.subtitle || readable?.excerpt || "");
  const firstText = cleanText(new JSDOM(content).window.document.body.textContent).slice(0, 320);
  const subtitle =
    subtitleCandidate &&
    subtitleCandidate.length <= 420 &&
    textKey(subtitleCandidate) !== textKey(title) &&
    !textKey(firstText).startsWith(textKey(subtitleCandidate))
      ? subtitleCandidate
      : "";
  const cleanHtml = sanitizeContent(content, sourceUrl, title);
  const cleanDom = new JSDOM(cleanHtml);
  const bodyText = documentBodyText(cleanDom.window.document);
  const words = wordCount(bodyText);
  const paragraphs = cleanDom.window.document.querySelectorAll("p").length;
  const expectedMinimumWords = readingMinutes ? Math.max(MIN_ARTICLE_WORDS, readingMinutes * 80) : MIN_ARTICLE_WORDS;
  if (hasAccessPreviewMarker(cleanDom.window.document)) {
    throw new Error("Extracted an access preview instead of the public article; login or subscription may be required");
  }
  if (words < expectedMinimumWords) {
    const expectation = readingMinutes ? `; the page advertises a ${readingMinutes}-minute read` : "";
    throw new Error(`Extracted body is suspiciously short (${words} words${expectation})`);
  }
  if (words < 800 && /(?:…|\.\.\.)[”'\"]?$/.test(bodyText)) {
    throw new Error(`Extracted body appears truncated (${words} words and an ellipsis ending)`);
  }

  return {
    ...metadata,
    author: metadata.author || cleanText(readable?.byline),
    bodyHtml: cleanHtml,
    mode,
    paragraphs,
    readingMinutes,
    subtitle,
    title,
    words,
  };
}

function normalizeSuppliedArticle(value, filePath = "article file") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath}: expected one JSON object`);
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(cleanText(value.sourceUrl));
  } catch {
    throw new Error(`${filePath}: sourceUrl must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    throw new Error(`${filePath}: sourceUrl must be an absolute HTTP(S) URL`);
  }

  const title = cleanText(value.title);
  if (!title) throw new Error(`${filePath}: title is required`);
  if (typeof value.bodyHtml !== "string" || !cleanText(value.bodyHtml)) {
    throw new Error(`${filePath}: bodyHtml is required`);
  }

  const bodyHtml = sanitizeContent(value.bodyHtml, sourceUrl.href, title);
  const cleanDom = new JSDOM(bodyHtml);
  const bodyText = documentBodyText(cleanDom.window.document);
  const words = wordCount(bodyText);
  const paragraphs = cleanDom.window.document.querySelectorAll("p").length;
  if (hasAccessPreviewMarker(cleanDom.window.document)) {
    throw new Error(`${filePath}: bodyHtml contains an access preview rather than a complete public article`);
  }
  if (words < MIN_ARTICLE_WORDS) {
    throw new Error(`${filePath}: bodyHtml is too short (${words} words)`);
  }
  if (words < 800 && /(?:…|\.\.\.)[”'\"]?$/.test(bodyText)) {
    throw new Error(`${filePath}: bodyHtml appears truncated (${words} words and an ellipsis ending)`);
  }

  const expectedWords = Number.parseInt(value.expectedWords, 10);
  if (Number.isFinite(expectedWords) && expectedWords > 0 && words < Math.floor(expectedWords * 0.9)) {
    throw new Error(`${filePath}: bodyHtml has ${words} words; expected about ${expectedWords}`);
  }

  const retrievalNote = cleanText(value.retrievalNote).slice(0, 300);
  return {
    author: cleanText(value.author),
    bodyHtml,
    canonicalUrl: sourceUrl.href,
    loadWarnings: retrievalNote ? [retrievalNote] : [],
    mode: "article-file",
    paragraphs,
    publication: cleanText(value.publication) || sourceUrl.hostname.replace(/^www\./, ""),
    published: cleanText(value.published),
    readingMinutes: 0,
    subtitle: cleanText(value.subtitle),
    title,
    words,
  };
}

async function loadArticleFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: could not read valid JSON (${shortError(error)})`);
  }
  return normalizeSuppliedArticle(parsed, filePath);
}

async function embedImages(article, request, sourceUrl) {
  const dom = new JSDOM(`<main>${article.bodyHtml}</main>`, { url: sourceUrl });
  const document = dom.window.document;
  const warnings = [];
  let embedded = 0;
  const cache = new Map();

  for (const image of [...document.querySelectorAll("img")]) {
    const imageUrl = image.getAttribute("data-source-url") || image.src;
    if (!imageUrl) continue;
    if (imageUrl.startsWith("data:image/")) {
      embedded += 1;
      continue;
    }
    let result = cache.get(imageUrl);
    if (!result) {
      try {
        const response = await request.get(imageUrl, {
          failOnStatusCode: false,
          headers: {
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            Referer: sourceUrl,
          },
          timeout: IMAGE_TIMEOUT_MS,
        });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const contentType = (response.headers()["content-type"] || "").split(";")[0].trim();
        if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
          throw new Error(`unsupported content type ${contentType || "unknown"}`);
        }
        const body = await response.body();
        if (body.length > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
        result = `data:${contentType};base64,${body.toString("base64")}`;
      } catch (error) {
        result = null;
        warnings.push(`Image not embedded: ${imageUrl} (${error.message})`);
      }
      cache.set(imageUrl, result);
    }
    if (result) {
      image.setAttribute("src", result);
      image.removeAttribute("data-source-url");
      embedded += 1;
    } else {
      image.setAttribute("alt", cleanText(image.getAttribute("alt")) || "Image unavailable");
      image.setAttribute("class", "image-unavailable");
    }
  }

  article.bodyHtml = document.querySelector("main").innerHTML;
  article.imagesEmbedded = embedded;
  article.imageWarnings = warnings;
  return article;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function localIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function articleMarkup(article, index, combined) {
  const metaParts = [article.author, article.publication, formatDate(article.published)].filter(Boolean);
  const lengthClass = article.words < 1_000 ? " short-article" : "";
  return `
    <article class="reading-article${lengthClass}${combined && index > 0 ? " packet-break" : ""}">
      <header class="article-header">
        <h1>${escapeHtml(article.title)}</h1>
        ${article.subtitle ? `<p class="deck">${escapeHtml(article.subtitle)}</p>` : ""}
        ${metaParts.length ? `<p class="byline">${metaParts.map(escapeHtml).join(" · ")}</p>` : ""}
      </header>
      <section class="article-body">${article.bodyHtml}</section>
      <footer class="source-note">
        <span>Original article:</span>
        <a href="${escapeHtml(article.canonicalUrl)}">${escapeHtml(article.canonicalUrl)}</a><br>
        <span>PDF generated ${escapeHtml(localIsoDate())}</span>
      </footer>
    </article>`;
}

function readingHtml(articles, { combined }) {
  const title = combined ? "Reading Packet" : articles[0].title;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html { background: #fff; }
    body {
      margin: 0;
      color: #191919;
      background: #fff;
      font-family: Georgia, "Times New Roman", Times, serif;
      font-size: 11.5pt;
      line-height: 1.46;
      text-rendering: optimizeLegibility;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .reading-article { max-width: 6.55in; margin: 0 auto; }
    .packet-break { break-before: page; }
    .article-header { margin: 0 0 2rem; padding-bottom: 1.1rem; border-bottom: 1px solid #d9d6cf; }
    h1 { margin: 0 0 0.55rem; font-size: 26pt; line-height: 1.08; font-weight: 700; letter-spacing: -0.018em; }
    .deck { margin: 0.55rem 0 0.9rem; color: #4d4a45; font-size: 14pt; line-height: 1.34; }
    .byline { margin: 0; color: #66615a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 9.5pt; line-height: 1.4; }
    .article-body p { margin: 0 0 0.92em; orphans: 3; widows: 3; }
    .article-body h2 { margin: 1.75em 0 0.55em; font-size: 18pt; line-height: 1.2; break-after: avoid; }
    .article-body h3 { margin: 1.55em 0 0.45em; font-size: 14.5pt; line-height: 1.25; break-after: avoid; }
    .article-body h4, .article-body h5, .article-body h6 { margin: 1.4em 0 0.4em; font-size: 12pt; break-after: avoid; }
    .article-body ul, .article-body ol { margin: 0.35em 0 1em 1.5em; padding: 0; }
    .article-body li { margin: 0.22em 0; }
    blockquote { margin: 1.15em 0 1.15em 1.1em; padding-left: 1em; border-left: 3px solid #aaa49a; color: #3f3c38; }
    pre { max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 9pt; line-height: 1.35; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.88em; }
    a { color: #234f7d; text-decoration-thickness: 0.06em; text-underline-offset: 0.12em; overflow-wrap: anywhere; }
    figure { margin: 1.35em 0 1.55em; break-inside: avoid; }
    img { display: block; max-width: 100%; max-height: 8.1in; width: auto; height: auto; margin: 0 auto; object-fit: contain; }
    .short-article .article-body img { max-height: 4.25in; }
    figcaption { margin: 0.55em auto 0; max-width: 94%; color: #68635c; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 8.5pt; line-height: 1.35; }
    .image-unavailable { display: none; }
    table { width: 100%; margin: 1em 0; border-collapse: collapse; font-size: 9pt; break-inside: auto; }
    th, td { padding: 0.35em 0.45em; border: 1px solid #c8c4bd; vertical-align: top; }
    tr { break-inside: avoid; }
    hr { margin: 1.6em 0; border: 0; border-top: 1px solid #c8c4bd; }
    .source-note { margin-top: 0.65rem; padding-top: 0.45rem; border-top: 1px solid #d9d6cf; color: #68635c; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 8.5pt; line-height: 1.35; break-inside: avoid; }
    @media print {
      a { color: #183e64; }
      .reading-article { max-width: none; }
    }
  </style>
</head>
<body>${articles.map((article, index) => articleMarkup(article, index, combined)).join("\n")}</body>
</html>`;
}

async function writePdf(browser, html, pdfPath, pageSize) {
  const page = await browser.newPage({ viewport: { height: 900, width: 1200 } });
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await Promise.all(
        [...document.images].map((image) => {
          if (image.complete) return undefined;
          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 10_000);
          });
        }),
      );
    });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      displayHeaderFooter: true,
      footerTemplate:
        '<div style="width:100%;font:8px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#777;text-align:center"><span class="pageNumber"></span></div>',
      format: pageSize,
      headerTemplate: "<div></div>",
      margin: { bottom: "0.65in", left: "0.82in", right: "0.82in", top: "0.72in" },
      outline: true,
      path: pdfPath,
      printBackground: true,
      tagged: true,
    });
  } finally {
    await page.close();
  }
}

async function launchBrowser() {
  const attempts = [];
  const explicitPath = process.env.ARTICLE_PDF_BROWSER_PATH;
  const candidates = [];
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new Error(`ARTICLE_PDF_BROWSER_PATH does not exist: ${explicitPath}`);
    candidates.push({ executablePath: explicitPath, label: explicitPath });
  }
  candidates.push({ channel: "chrome", label: "Google Chrome" });
  candidates.push({ label: "Playwright Chromium" });

  for (const candidate of candidates) {
    try {
      const options = { headless: true };
      if (candidate.channel) options.channel = candidate.channel;
      if (candidate.executablePath) options.executablePath = candidate.executablePath;
      return await chromium.launch(options);
    } catch (error) {
      attempts.push(`${candidate.label}: ${cleanText(error.message).slice(0, 180)}`);
    }
  }
  throw new Error(
    `Could not launch Chrome/Chromium. Run "npm run setup:browser" in the skill directory. ${attempts.join(" | ")}`,
  );
}

async function uniquePdfPath(outputDir, baseName) {
  let counter = 1;
  let candidate = path.join(outputDir, `${baseName}.pdf`);
  while (existsSync(candidate)) {
    counter += 1;
    candidate = path.join(outputDir, `${baseName}_${counter}.pdf`);
  }
  return candidate;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });
  const browser = await launchBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: true,
    locale: "en-US",
    userAgent: USER_AGENT,
    viewport: { height: 900, width: 1280 },
  });
  const articles = [];
  const failures = [];

  try {
    for (const [index, input] of options.inputs.entries()) {
      let page;
      const sourceLabel = input.value;
      try {
        let article;
        if (input.kind === "url") {
          page = await context.newPage();
          const rendered = await renderSourcePage(page, input.value);
          article = extractArticle(rendered.html, input.value);
          article.loadWarnings = rendered.warnings;
        } else {
          article = await loadArticleFile(input.value);
        }
        await embedImages(article, context.request, article.canonicalUrl);
        articles.push(article);
        console.log(`[${index + 1}/${options.inputs.length}] ${article.title}`);
        console.log(`  source: ${article.canonicalUrl}`);
        console.log(`  extraction: ${article.mode} (${article.words} words, ${article.paragraphs} paragraphs)`);
      } catch (error) {
        failures.push({ error: error.message, source: sourceLabel });
        console.error(`[${index + 1}/${options.inputs.length}] FAILED ${sourceLabel}`);
        console.error(`  ${error.message}`);
      } finally {
        if (page) await page.close();
      }
    }

    if (articles.length === 0) throw new Error("No articles could be extracted");

    if (options.combined) {
      const html = readingHtml(articles, { combined: true });
      const pdfPath = await uniquePdfPath(options.outputDir, "Reading_Packet");
      await writePdf(browser, html, pdfPath, options.pageSize);
      if (options.keepHtml) await fs.writeFile(pdfPath.replace(/\.pdf$/i, ".html"), html, "utf8");
      for (const article of articles) article.pdfPath = pdfPath;
      console.log(`  pdf: ${pdfPath}`);
    } else {
      for (const article of articles) {
        const baseName = filenameFromTitle(article.title);
        const pdfPath = await uniquePdfPath(options.outputDir, baseName);
        const html = readingHtml([article], { combined: false });
        await writePdf(browser, html, pdfPath, options.pageSize);
        if (options.keepHtml) await fs.writeFile(pdfPath.replace(/\.pdf$/i, ".html"), html, "utf8");
        article.pdfPath = pdfPath;
        console.log(`  pdf: ${pdfPath}`);
      }
    }

    for (const article of articles) {
      const warnings = [...article.loadWarnings, ...article.imageWarnings];
      console.log(`  images: ${article.imagesEmbedded} embedded${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
      for (const warning of warnings.slice(0, 5)) console.log(`  warning: ${warning}`);
      if (warnings.length > 5) console.log(`  warning: ${warnings.length - 5} additional warning(s) omitted`);
    }
    if (failures.length) console.log(`Completed with ${failures.length} failed URL(s).`);
  } finally {
    await context.close();
    await browser.close();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  extractArticle,
  normalizeSuppliedArticle,
  renderSourcePage,
  sanitizeContent,
};
