import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { renderPage, renderShareLink, robotsTxt, sitemapXml } from "../../build/seo-pages.ts";
import { PAGES } from "../../src/shared/pages.ts";

const template = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const SITE = "https://pickpdf.example";

const visibleViews = (html: string) =>
  [...html.matchAll(/<[a-z]+\s+id="(view-[a-z]+)"([^>]*)>/g)]
    .filter(([, , attrs]) => !/\shidden\b/.test(attrs!))
    .map(([, id]) => id);

describe("page metadata", () => {
  it("gives every page a unique title and description of search-snippet length", () => {
    expect(new Set(PAGES.map((p) => p.title)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.description)).size).toBe(PAGES.length);
    for (const page of PAGES) {
      expect(page.title.length, page.title).toBeLessThanOrEqual(65);
      expect(page.description.length, page.description).toBeGreaterThanOrEqual(110);
      expect(page.description.length, page.description).toBeLessThanOrEqual(160);
    }
  });
});

describe("renderPage", () => {
  for (const page of PAGES) {
    it(`renders ${page.path} with its own head and only its view visible`, () => {
      const html = renderPage(template, page, SITE);
      const title = page.title.replace(/&/g, "&amp;");
      expect(html).toContain(`<title>${title}</title>`);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html.match(/<meta name="description"/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="${new URL(page.path, SITE).href}" />`);
      expect(html).toContain(`<meta property="og:image" content="${SITE}/og.png" />`);
      expect(visibleViews(html)).toEqual([`view-${page.view}`]);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    });
  }

  it("adds WebApplication structured data to the home page only", () => {
    const [home, ...rest] = PAGES;
    const html = renderPage(template, home!, SITE);
    const block = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1];
    const data = JSON.parse(block ?? "null") as Record<string, unknown>;
    expect(data["@type"]).toBe("WebApplication");
    expect(data.url).toBe(SITE);
    expect(data.offers).toMatchObject({ price: "0" });
    for (const page of rest) expect(renderPage(template, page, SITE)).not.toContain("ld+json");
  });

  it("leaves out absolute URLs when the site URL isn't known", () => {
    const html = renderPage(template, PAGES[0]!, null);
    expect(html).not.toContain("canonical");
    expect(html).not.toContain("og:image");
    expect(html).toContain('<meta property="og:title"');
  });
});

describe("share links, robots and sitemap", () => {
  it("keeps one-time share links out of search results", () => {
    const html = renderShareLink(template);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain("<title>A file was shared with you | pick·pdf</title>");
    expect(visibleViews(html)).toEqual([]);
  });

  it("lists every page in the sitemap and points robots.txt at it", () => {
    const sitemap = sitemapXml(SITE);
    for (const page of PAGES)
      expect(sitemap).toContain(`<loc>${new URL(page.path, SITE).href}</loc>`);
    expect(robotsTxt(SITE)).toBe(
      `User-agent: *\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`,
    );
    expect(robotsTxt(null)).toBe("User-agent: *\nDisallow: /api/\n");
  });
});
