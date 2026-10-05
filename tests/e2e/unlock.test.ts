import { readFile } from "node:fs/promises";
import type { Download, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";
import { fixturePath, hasHorizontalOverflow, inspectPdf, useBrowser } from "./helpers.ts";

const { open } = useBrowser();

const view = (page: Page) => page.locator("#view-unlock");

async function choose(page: Page, fixture: string): Promise<void> {
  await view(page).locator("#pdf-input").setInputFiles(fixturePath(fixture));
}

async function expectUnlockedDownload(download: Download, expectedName: string): Promise<void> {
  expect(download.suggestedFilename()).toBe(expectedName);
  const { encrypted, text } = await inspectPdf(await readFile(await download.path()));
  expect(encrypted).toBe(false);
  expect(text).toContain("Hello from pick-pdf");
  expect(text).toContain("Page two marker");
}

describe("unlock PDF", () => {
  it("is the home page", async () => {
    const { page } = await open("/");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Unlock a PDF");
    expect(
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Unlock PDF" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(await page.getByText("PDF · up to 200 MB · stays on your device").isVisible()).toBe(
      true,
    );
    // The password field only appears once we know the PDF needs one.
    expect(await page.locator("#pdf-form").isVisible()).toBe(false);
  });

  it("asks for the password, rejects a wrong one, and downloads the unlocked PDF", async () => {
    const { page } = await open("/");
    await choose(page, "aes256");

    await page
      .getByText("This PDF is password-protected. Enter its password to unlock it.")
      .waitFor();
    expect(await page.locator("#pdf-name").textContent()).toBe("aes256.pdf");
    const password = page.getByLabel("PDF password");
    expect(await password.evaluate((el) => el === document.activeElement)).toBe(true);

    await password.fill("wrong-password");
    await page.getByRole("button", { name: "Unlock PDF" }).click();
    await page.getByText("That password didn't work. Check it and try again.").waitFor();
    expect(await password.getAttribute("aria-invalid")).toBe("true");

    // Typing again clears the error.
    await password.fill("secret12");
    expect(await page.locator("#pdf-error").textContent()).toBe("");
    expect(await password.getAttribute("aria-invalid")).toBeNull();

    await password.fill("secret123");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Unlock PDF" }).click(),
    ]);
    await expectUnlockedDownload(download, "aes256-unlocked.pdf");

    await page.getByRole("heading", { name: "Password removed" }).waitFor();
    expect(await page.locator("#view-unlocked .lede").innerText()).toBe(
      "aes256-unlocked.pdf opens without a password now.",
    );
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("unlocked-title");
  });

  for (const fixture of ["aes128", "rc4-128", "rc4-40"]) {
    it(`unlocks ${fixture} PDFs`, async () => {
      const { page } = await open("/");
      await choose(page, fixture);
      await page.getByLabel("PDF password").fill("secret123");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByLabel("PDF password").press("Enter"),
      ]);
      await expectUnlockedDownload(download, `${fixture}-unlocked.pdf`);
    });
  }

  it("unlocks with a unicode password", async () => {
    const { page } = await open("/");
    await choose(page, "unicode");
    await page.getByLabel("PDF password").fill("pässwörd 密码 🔒");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Unlock PDF" }).click(),
    ]);
    await expectUnlockedDownload(download, "unicode-unlocked.pdf");
  });

  it("removes print/copy restrictions without asking for a password", async () => {
    const { page } = await open("/");
    const download = page.waitForEvent("download");
    await choose(page, "restricted");
    await expectUnlockedDownload(await download, "restricted-unlocked.pdf");
    await page.getByRole("heading", { name: "Restrictions removed" }).waitFor();
    expect(await page.locator("#view-unlocked .lede").innerText()).toContain(
      "blocked printing, copying or editing",
    );
  });

  it("says so when a PDF has no password", async () => {
    const { page } = await open("/");
    await choose(page, "plain");
    await page.getByText("This PDF isn't password-protected. There's nothing to remove.").waitFor();
    expect(await page.locator("#pdf-form").isVisible()).toBe(false);
  });

  it("rejects files that aren't PDFs", async () => {
    const { page } = await open("/");
    await view(page)
      .locator("#pdf-input")
      .setInputFiles({
        name: "notes.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("just text"),
      });
    expect(await page.getByRole("alert").first().textContent()).toBe(
      "That doesn't look like a PDF. Choose a .pdf file.",
    );
    expect(await page.locator("#pdf-chip").isVisible()).toBe(false);
  });

  it("explains when a PDF is damaged", async () => {
    const { page } = await open("/");
    await choose(page, "corrupt");
    await page
      .getByText("We couldn't read this PDF. It may be damaged or not a real PDF.")
      .waitFor();
    expect(await page.locator("#pdf-form").isVisible()).toBe(false);
  });

  it("requires a password before trying", async () => {
    const { page } = await open("/");
    await choose(page, "aes256");
    await page.getByLabel("PDF password").waitFor();
    await page.getByRole("button", { name: "Unlock PDF" }).click();
    expect(await page.locator("#pdf-error").textContent()).toBe("Enter the PDF's password.");
  });

  it("lets you remove or replace the chosen PDF", async () => {
    const { page } = await open("/");
    await choose(page, "aes256");
    await page.getByLabel("PDF password").waitFor();

    // Replacing it with an unprotected PDF hides the password step.
    await choose(page, "plain");
    await page.getByText("This PDF isn't password-protected.", { exact: false }).waitFor();
    expect(await page.locator("#pdf-form").isVisible()).toBe(false);
    expect(await page.locator("#pdf-name").textContent()).toBe("plain.pdf");

    await page.getByRole("button", { name: "Remove selected PDF" }).click();
    expect(await page.locator("#pdf-chip").isVisible()).toBe(false);
    expect(await page.locator("#pdf-dropzone-label").isVisible()).toBe(true);
    expect(await page.locator("#pdf-status").isVisible()).toBe(false);
  });

  it("accepts a dropped PDF", async () => {
    const { page } = await open("/");
    const bytes = [...(await readFile(fixturePath("aes256")))];
    await page.evaluate((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(data)], "dropped.pdf", { type: "application/pdf" }),
      );
      document
        .getElementById("pdf-dropzone")
        ?.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    }, bytes);
    await page.getByLabel("PDF password").waitFor();
    expect(await page.locator("#pdf-name").textContent()).toBe("dropped.pdf");
  });

  it("never sends the PDF or password anywhere", async () => {
    const { page } = await open("/");
    const requests: string[] = [];
    page.on("request", (request) =>
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );
    await choose(page, "aes256");
    await page.getByLabel("PDF password").fill("secret123");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unlock PDF" }).click();
    await download;
    // Only the worker script and qpdf.wasm are fetched; no API calls, no uploads.
    expect(requests.filter((r) => !r.startsWith("GET /assets/"))).toEqual([]);
    expect(requests.some((r) => r.endsWith(".wasm"))).toBe(true);
  });

  it("hands the unlocked PDF to the one-time share flow", async () => {
    const { page } = await open("/");
    await choose(page, "aes256");
    await page.getByLabel("PDF password").fill("secret123");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unlock PDF" }).click();
    await download;

    await page.getByRole("button", { name: "Share it with a one-time link" }).click();
    await page.getByRole("heading", { name: "Seal a file" }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/share");
    expect(await page.locator("#file-name").textContent()).toBe("aes256-unlocked.pdf");
    expect(
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Share a file" })
        .getAttribute("aria-current"),
    ).toBe("page");

    await page.locator("#view-upload").getByLabel("Password", { exact: true }).fill("share-pass");
    await page.locator("#view-upload").getByLabel("Confirm password").fill("share-pass");
    await page.getByRole("button", { name: "Encrypt & upload" }).click();
    await page.getByRole("heading", { name: "Your link is ready" }).waitFor();
    expect(await page.locator("#shared-name").textContent()).toMatch(/^aes256-unlocked\.pdf \(/);

    // Back returns to the unlocker.
    await page.goBack();
    await page.getByRole("heading", { name: "Unlock a PDF" }).waitFor();
  });

  it("fits a small phone screen without horizontal scrolling", async () => {
    const { page } = await open("/", { viewport: { width: 320, height: 640 }, isMobile: true });
    await choose(page, "aes256");
    await page.getByLabel("PDF password").waitFor();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
