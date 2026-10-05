import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { baseURL, hasHorizontalOverflow, seedFile, useBrowser } from "./helpers.ts";

const { open } = useBrowser();

describe("open link", () => {
  it("full round trip: upload in one browser, unlock once in another", async () => {
    // Sender
    const sender = await open("/share");
    const original = Buffer.from("%PDF-1.7\nround trip ✓\n%%EOF\n");
    await sender.page.locator("#file-input").setInputFiles({
      name: "quarterly report.pdf",
      mimeType: "application/pdf",
      buffer: original,
    });
    await sender.page
      .locator("#view-upload")
      .getByLabel("Password", { exact: true })
      .fill("open sesame");
    await sender.page.locator("#view-upload").getByLabel("Confirm password").fill("open sesame");
    await sender.page.getByRole("button", { name: "Encrypt & upload" }).click();
    await sender.page.getByRole("heading", { name: "Your link is ready" }).waitFor();
    const link = await sender.page.getByLabel("Share link").inputValue();

    // Recipient (separate context: no shared storage with the sender)
    const { page } = await open(link);
    await page.getByRole("heading", { name: "Someone sealed a file for you" }).waitFor();
    expect(await page.locator("#open-attempts").textContent()).toBe("5");
    expect(await page.locator("#open-size").textContent()).toMatch(/^\d+ B$/);
    expect(await page.locator("#open-expiry").textContent()).toBe("tomorrow");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("open-password");

    // Wrong password first
    await page.locator("#view-open").getByLabel("Password").fill("open sesam");
    await page.getByRole("button", { name: "Unlock & download" }).click();
    await page.getByText("Wrong password. 4 attempts left.").waitFor();
    expect(await page.locator("#open-attempts").textContent()).toBe("4");
    expect(
      await page.locator("#view-open").getByLabel("Password").getAttribute("aria-invalid"),
    ).toBe("true");

    // Correct password → download
    await page.locator("#view-open").getByLabel("Password").fill("open sesame");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Unlock & download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("quarterly report.pdf");
    const savedPath = await download.path();
    expect(Buffer.compare(await readFile(savedPath), original)).toBe(0);

    await page.getByRole("heading", { name: "Unlocked" }).waitFor();
    expect(await page.locator("#done-name").textContent()).toBe("quarterly report.pdf");
    expect(await page.getByRole("link", { name: "Save file" }).getAttribute("download")).toBe(
      "quarterly report.pdf",
    );

    // Burnt: the same link is dead for everyone, including the recipient.
    await page.reload();
    await page.getByRole("heading", { name: "Nothing here" }).waitFor();
    await sender.page.goto(link);
    await sender.page.getByRole("heading", { name: "Nothing here" }).waitFor();
  });

  it("destroys the file after five wrong passwords", async () => {
    const seeded = await seedFile("the-real-one");
    const { page } = await open(seeded.path);
    const password = page.locator("#view-open").getByLabel("Password");
    const unlock = page.getByRole("button", { name: "Unlock & download" });

    for (const left of [4, 3, 2, 1]) {
      await password.fill(`guess-${left}`);
      await unlock.click();
      await page
        .getByText(`Wrong password. ${left} ${left === 1 ? "attempt" : "attempts"} left.`)
        .waitFor();
    }
    await password.fill("guess-final");
    await unlock.click();
    await page.getByText("Too many wrong passwords. The file was destroyed.").waitFor();

    // Even the right password can't bring it back.
    expect((await fetch(`${baseURL}/api/files/${seeded.id}`)).status).toBe(404);
    const claim = await fetch(`${baseURL}/api/files/${seeded.id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authKey: seeded.authKey }),
    });
    expect(claim.status).toBe(404);
  });

  it("requires a password before unlocking", async () => {
    const seeded = await seedFile("whatever1");
    const { page } = await open(seeded.path);
    await page.getByRole("button", { name: "Unlock & download" }).click();
    expect(await page.getByRole("alert").textContent()).toBe("Enter the password.");
    expect(await page.locator("#open-attempts").textContent()).toBe("5");
  });

  it("shows the button as busy while unlocking", async () => {
    const seeded = await seedFile("busy-test");
    const { page } = await open(seeded.path);
    await page.route("**/claim", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.locator("#view-open").getByLabel("Password").fill("busy-test");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unlock & download" }).click();
    const busy = page.getByRole("button", { name: "Unlocking…" });
    await busy.waitFor();
    expect(await busy.isDisabled()).toBe(true);
    await download;
  });

  it("only the first of two open tabs gets the file", async () => {
    const seeded = await seedFile("shared-secret", { name: "race.txt" });
    const first = await open(seeded.path);
    const second = await open(seeded.path);
    await second.page.getByRole("heading", { name: "Someone sealed a file for you" }).waitFor();

    await first.page.locator("#view-open").getByLabel("Password").fill("shared-secret");
    const [download] = await Promise.all([
      first.page.waitForEvent("download"),
      first.page.getByRole("button", { name: "Unlock & download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("race.txt");

    await second.page.locator("#view-open").getByLabel("Password").fill("shared-secret");
    await second.page.getByRole("button", { name: "Unlock & download" }).click();
    await second.page.getByRole("heading", { name: "Nothing here" }).waitFor();
    expect(await second.page.locator("#gone-reason").innerText()).toBe(
      "This file was already opened, expired, or never existed.",
    );
  });

  it("preserves unicode file names and binary content", async () => {
    const content = new Uint8Array(256 * 1024);
    for (let i = 0; i < content.length; i += 65_536) {
      crypto.getRandomValues(content.subarray(i, i + 65_536));
    }
    const seeded = await seedFile("ünïcødé-pw", {
      name: "Лист 📄 résumé.pdf",
      type: "application/pdf",
      content,
    });
    const { page } = await open(seeded.path);
    await page.locator("#view-open").getByLabel("Password").fill("ünïcødé-pw");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Unlock & download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("Лист 📄 résumé.pdf");
    expect(new Uint8Array(await readFile(await download.path()))).toEqual(content);
  });

  it("shows a friendly page for unknown and malformed links", async () => {
    for (const path of ["/f/AAAAAAAAAAAAAAAAAAAAAA", "/f/not-a-real-id", "/f/abc/def", "/f/"]) {
      const { page } = await open(path);
      await page.getByRole("heading", { name: "Nothing here" }).waitFor();
      await page.getByRole("link", { name: "Seal a file" }).click();
      await page.getByRole("heading", { name: "Seal a file" }).waitFor();
    }
  });

  it("fits a small phone screen without horizontal scrolling", async () => {
    const seeded = await seedFile("phone-pw");
    const { page } = await open(seeded.path, {
      viewport: { width: 320, height: 640 },
      isMobile: true,
    });
    await page.getByRole("heading", { name: "Someone sealed a file for you" }).waitFor();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
