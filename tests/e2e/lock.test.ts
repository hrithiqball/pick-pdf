import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";
import { fixturePath, hasHorizontalOverflow, inspectPdf, useBrowser } from "./helpers.ts";

const { open } = useBrowser();

const lockView = (page: Page) => page.locator("#view-lock");

async function choose(page: Page, fixture: string): Promise<void> {
  await page.locator("#lock-input").setInputFiles(fixturePath(fixture));
}

async function fillPasswords(page: Page, password: string, confirm = password): Promise<void> {
  await lockView(page).getByLabel("New password").fill(password);
  await lockView(page).getByLabel("Confirm password").fill(confirm);
}

describe("lock PDF", () => {
  it("is linked from the nav and marks itself current", async () => {
    const { page } = await open("/");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Lock PDF", exact: true })
      .click();
    await page.getByRole("heading", { name: "Lock a PDF", level: 1 }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/lock");
    expect(
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Lock PDF", exact: true })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(await page.locator("#lock-form").isVisible()).toBe(false);
  });

  it("locks a PDF so it needs the password, and keeps the content", async () => {
    const { page } = await open("/lock");
    await choose(page, "plain");
    const password = lockView(page).getByLabel("New password");
    await password.waitFor();
    expect(await password.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await page.locator("#lock-name").textContent()).toBe("plain.pdf");

    await fillPasswords(page, "hunter22");
    expect(await page.locator("#lock-password-hint").textContent()).toBe("Passwords match.");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Lock PDF", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("plain-locked.pdf");
    const locked = await readFile(await download.path());

    // No password → can't open. Right password → full content, no restrictions.
    expect((await inspectPdf(locked)).encrypted).toBe(true);
    const opened = await inspectPdf(locked, "hunter22");
    expect(opened.text).toContain("Hello from pick-pdf");
    expect(opened.text).toContain("Page two marker");
    expect(opened.encryption).toContain("AESv3");
    expect(opened.encryption).toContain("print high resolution: allowed");

    await page.getByRole("heading", { name: "PDF locked" }).waitFor();
    expect(await page.locator("#view-locked .lede").innerText()).toBe(
      "plain-locked.pdf now needs the password to open.",
    );
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("locked-title");
  });

  it("can block printing, copying and editing", async () => {
    const { page } = await open("/lock");
    await choose(page, "plain");
    await fillPasswords(page, "hunter22");
    await lockView(page).getByLabel("Also block printing, copying and editing").check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Lock PDF", exact: true }).click(),
    ]);
    const opened = await inspectPdf(await readFile(await download.path()), "hunter22");
    expect(opened.encryption).toContain("Supplied password is user password");
    expect(opened.encryption).toContain("print high resolution: not allowed");
    expect(opened.encryption).toContain("modify anything: not allowed");
    expect(await page.locator("#view-locked .lede").innerText()).toContain(
      "Printing, copying and editing are blocked too.",
    );
  });

  it("checks the password and confirmation", async () => {
    const { page } = await open("/lock");
    await choose(page, "plain");
    await lockView(page).getByLabel("New password").waitFor();
    expect(await page.locator("#lock-password-hint").textContent()).toBe("At least 6 characters.");

    await fillPasswords(page, "abc");
    await page.getByRole("button", { name: "Lock PDF", exact: true }).click();
    expect(await page.locator("#lock-error").textContent()).toBe(
      "Password must be at least 6 characters.",
    );
    expect(await lockView(page).getByLabel("New password").getAttribute("aria-invalid")).toBe(
      "true",
    );

    await fillPasswords(page, "hunter22", "hunter23");
    expect(await page.locator("#lock-password-hint").textContent()).toBe(
      "Passwords don't match yet.",
    );
    await page.getByRole("button", { name: "Lock PDF", exact: true }).click();
    expect(await page.locator("#lock-error").textContent()).toBe("Passwords don't match.");
    expect(await lockView(page).getByLabel("Confirm password").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("sends PDFs that already have a password to the unlocker", async () => {
    const { page } = await open("/lock");
    await choose(page, "aes256");
    const notice = page.locator("#lock-already");
    await notice.waitFor();
    expect(await notice.innerText()).toBe(
      "This PDF already has a password. Unlock it first, then lock it again with a new one.",
    );
    expect(await page.locator("#lock-form").isVisible()).toBe(false);
    await notice.getByRole("link", { name: "Unlock it first" }).click();
    await page.getByRole("heading", { name: "Unlock a PDF", level: 1 }).waitFor();
  });

  it("explains it will replace existing print/copy restrictions", async () => {
    const { page } = await open("/lock");
    await choose(page, "restricted");
    await page.getByText("This PDF has print/copy restrictions.", { exact: false }).waitFor();
    expect(await page.locator("#lock-form").isVisible()).toBe(true);
  });

  it("rejects damaged and non-PDF files", async () => {
    const { page } = await open("/lock");
    await choose(page, "corrupt");
    await page.getByText("We couldn't read this PDF.", { exact: false }).waitFor();
    expect(await page.locator("#lock-form").isVisible()).toBe(false);

    await page.locator("#lock-input").setInputFiles({
      name: "photo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("\x89PNG not a pdf"),
    });
    expect(await page.locator("#lock-error").textContent()).toBe(
      "That doesn't look like a PDF. Choose a .pdf file.",
    );
  });

  it("clears everything when the PDF is removed", async () => {
    const { page } = await open("/lock");
    await choose(page, "aes256");
    await page.locator("#lock-already").waitFor();
    await page.getByRole("button", { name: "Remove selected PDF" }).click();
    expect(await page.locator("#lock-already").isVisible()).toBe(false);
    expect(await page.locator("#lock-dropzone-label").isVisible()).toBe(true);

    await choose(page, "plain");
    await fillPasswords(page, "hunter22");
    await page.getByRole("button", { name: "Remove selected PDF" }).click();
    await choose(page, "plain");
    expect(await lockView(page).getByLabel("New password").inputValue()).toBe("");
  });

  it("never sends the PDF or password anywhere", async () => {
    const { page } = await open("/lock");
    const requests: string[] = [];
    page.on("request", (request) =>
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );
    await choose(page, "plain");
    await fillPasswords(page, "hunter22");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Lock PDF", exact: true }).click();
    await download;
    expect(requests.filter((r) => !r.startsWith("GET /assets/"))).toEqual([]);
  });

  it("hands the locked PDF to the one-time share flow", async () => {
    const { page } = await open("/lock");
    await choose(page, "plain");
    await fillPasswords(page, "hunter22");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Lock PDF", exact: true }).click();
    await download;
    await page.getByRole("button", { name: "Share it with a one-time link" }).click();
    await page.getByRole("heading", { name: "Seal a file" }).waitFor();
    expect(await page.locator("#file-name").textContent()).toBe("plain-locked.pdf");
    await page.goBack();
    await page.getByRole("heading", { name: "Lock a PDF", level: 1 }).waitFor();
  });

  it("fits a small phone screen without horizontal scrolling", async () => {
    const { page } = await open("/lock", { viewport: { width: 320, height: 640 }, isMobile: true });
    await choose(page, "plain");
    await lockView(page).getByLabel("New password").waitFor();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
