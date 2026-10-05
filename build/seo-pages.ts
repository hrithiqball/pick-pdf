// Build step: turn the single index.html into one HTML file per page, each with its own
// <title>, description, canonical/Open Graph tags and its view visible without JavaScript,
// plus the share-link shell (noindex), robots.txt and sitemap.xml.
import type { Plugin } from "vite-plus";
import { PAGES, SHARE_LINK_PAGE, SITE_NAME, SITE_URL } from "../src/shared/pages.ts";
import type { PageView, SitePage } from "../src/shared/pages.ts";

const NAV_FOR: Record<PageView, string> = {
  unlock: "nav-unlock",
  lock: "nav-lock",
  upload: "nav-share",
  about: "nav-about",
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Like String.replace, but fails the build if the pattern isn't found. */
function mustReplace(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) throw new Error(`seo-pages: couldn't find ${what} in index.html`);
  return html.replace(pattern, replacement);
}

function setHead(html: string, title: string, description: string, extra: string[]): string {
  html = mustReplace(
    html,
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(title)}</title>`,
    "<title>",
  );
  html = mustReplace(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    "meta description",
  );
  return mustReplace(
    html,
    /<\/head>/,
    `${extra.map((tag) => `    ${tag}\n`).join("")}  </head>`,
    "</head>",
  );
}

function jsonLd(data: object): string {
  // "<" can't appear raw inside a <script> block.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function socialTags(page: SitePage, siteUrl: string | null): string[] {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (siteUrl) {
    const url = new URL(page.path, siteUrl).href;
    tags.push(
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${new URL("/og.png", siteUrl).href}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="pick·pdf: unlock, lock and share PDFs privately" />`,
    );
  }
  return tags;
}

function structuredData(siteUrl: string | null): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    ...(siteUrl ? { url: siteUrl } : {}),
    description: PAGES[0]!.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and WebAssembly",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Remove a password from a PDF",
      "Remove PDF printing and copying restrictions",
      "Add a password to a PDF with AES-256",
      "Share a file with a one-time, end-to-end encrypted link",
    ],
  });
}

export function renderPage(template: string, page: SitePage, siteUrl: string | null): string {
  const extra = socialTags(page, siteUrl);
  if (page.path === "/") extra.push(structuredData(siteUrl));
  let html = setHead(template, page.title, page.description, extra);
  // Show this page's view in the static HTML so crawlers (and first paint) see real content.
  html = mustReplace(
    html,
    new RegExp(`(<[a-z]+\\s+id="view-${page.view}"[^>]*?)\\s+hidden(\\s*>)`),
    "$1$2",
    `#view-${page.view}`,
  );
  return mustReplace(
    html,
    new RegExp(`id="${NAV_FOR[page.view]}"`),
    `id="${NAV_FOR[page.view]}" aria-current="page"`,
    `#${NAV_FOR[page.view]}`,
  );
}

export function renderShareLink(template: string): string {
  return setHead(template, SHARE_LINK_PAGE.title, SHARE_LINK_PAGE.description, [
    `<meta name="robots" content="noindex, nofollow" />`,
  ]);
}

export function robotsTxt(siteUrl: string | null): string {
  const lines = ["User-agent: *", "Disallow: /api/", ""];
  if (siteUrl) lines.push(`Sitemap: ${new URL("/sitemap.xml", siteUrl).href}`, "");
  return lines.join("\n");
}

export function sitemapXml(siteUrl: string): string {
  const urls = PAGES.map((page) => `  <url><loc>${new URL(page.path, siteUrl).href}</loc></url>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}

export function seoPages(): Plugin {
  return {
    name: "pick-pdf:seo-pages",
    apply: "build",
    enforce: "post",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (index?.type !== "asset" || typeof index.source !== "string") {
        this.error("seo-pages: index.html missing from the client bundle");
      }
      const template = index.source;
      for (const page of PAGES) {
        const html = renderPage(template, page, SITE_URL);
        if (page.file === "index.html") index.source = html;
        else this.emitFile({ type: "asset", fileName: page.file, source: html });
      }
      this.emitFile({
        type: "asset",
        fileName: SHARE_LINK_PAGE.file,
        source: renderShareLink(template),
      });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt(SITE_URL) });
      if (SITE_URL) {
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(SITE_URL) });
      } else {
        this.warn(
          "SITE_URL isn't set in src/shared/pages.ts: skipping canonical URLs and sitemap.xml",
        );
      }
    },
  };
}
