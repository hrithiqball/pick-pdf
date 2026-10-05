import { describe, expect, it } from "vite-plus/test";
import { baseURL, hasHorizontalOverflow, useBrowser } from "./helpers.ts";
import { PAGES } from "../../src/shared/pages.ts";

const { open } = useBrowser();

describe("search engines", () => {
  for (const page of PAGES) {
    it(`serves ${page.path} with its content readable without JavaScript`, async () => {
      const { page: tab } = await open(page.path, { javaScriptEnabled: false });
      expect(await tab.title()).toBe(page.title);
      expect(await tab.locator('meta[name="description"]').getAttribute("content")).toBe(
        page.description,
      );
      const heading = tab.getByRole("heading", { level: 1 });
      expect(await heading.count()).toBe(1);
      expect(await heading.isVisible()).toBe(true);
    });
  }

  it("keeps one-time share links out of the index without losing security headers", async () => {
    const response = await fetch(`${baseURL}/f/abcdefghijklmnopqrstuv`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain("<title>A file was shared with you | pick·pdf</title>");
  });

  it("serves robots.txt", async () => {
    const response = await fetch(`${baseURL}/robots.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Disallow: /api/");
  });
});

describe("about page", () => {
  it("explains the privacy model and is reachable from the nav", async () => {
    const { page } = await open("/");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "About" })
      .click();
    await page.getByRole("heading", { name: "Why pick·pdf exists", level: 1 }).waitFor();
    expect(await page.title()).toBe(PAGES.find((p) => p.path === "/about")!.title);
    const text = await page.locator("#view-about").innerText();
    expect(text).toContain("never uploaded");
    expect(text).toContain("the developer included");
    expect(
      await page.getByRole("link", { name: "Read the code on GitHub" }).getAttribute("href"),
    ).toBe("https://github.com/hrithiqball/pick-pdf");
  });

  it("has no footer", async () => {
    const { page } = await open("/about");
    expect(await page.locator("footer").count()).toBe(0);
  });

  it("fits a small phone screen, nav included", async () => {
    const { page } = await open("/about", {
      viewport: { width: 320, height: 640 },
      isMobile: true,
    });
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
