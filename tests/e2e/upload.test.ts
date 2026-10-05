import { describe, expect, it } from "vite-plus/test";
import { MAX_FILE_BYTES } from "../../src/shared/protocol.ts";
import { baseURL, hasHorizontalOverflow, useBrowser } from "./helpers.ts";

const { open } = useBrowser();

const pdf = {
  name: "contract.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\n% pick-pdf test document\n%%EOF\n"),
};

describe("upload page", () => {
  it("renders the upload form with labelled controls", async () => {
    const { page } = await open("/share");

    expect(await page.title()).toBe("pick·pdf");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Seal a file");
    expect(
      await page.locator("#view-upload").getByLabel("Password", { exact: true }).isVisible(),
    ).toBe(true);
    expect(await page.locator("#view-upload").getByLabel("Confirm password").isVisible()).toBe(
      true,
    );
    expect(await page.getByRole("radio", { name: "1 day" }).isChecked()).toBe(true);
    expect(await page.getByText("Any type · up to 50 MB").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Encrypt & upload" }).isEnabled()).toBe(true);
  });

  it("asks for a file before anything else", async () => {
    const { page } = await open("/share");
    await page.getByRole("button", { name: "Encrypt & upload" }).click();
    expect(await page.getByRole("alert").textContent()).toBe("Choose a file to seal.");
  });

  it("validates password length and confirmation", async () => {
    const { page } = await open("/share");
    await page.locator("#file-input").setInputFiles(pdf);
    const password = page.locator("#view-upload").getByLabel("Password", { exact: true });
    const confirm = page.locator("#view-upload").getByLabel("Confirm password");
    const hint = page.locator("#password-hint");
    const submit = page.getByRole("button", { name: "Encrypt & upload" });

    expect(await hint.textContent()).toBe("At least 6 characters.");

    await password.fill("abc");
    await submit.click();
    expect(await page.getByRole("alert").textContent()).toBe(
      "Password must be at least 6 characters.",
    );
    expect(await password.getAttribute("aria-invalid")).toBe("true");
    expect(await password.evaluate((el) => el === document.activeElement)).toBe(true);

    await password.fill("abcdef");
    expect(await hint.textContent()).toBe("Now confirm it below.");
    await confirm.fill("abcdeX");
    expect(await hint.textContent()).toBe("Passwords don't match yet.");
    await submit.click();
    expect(await page.getByRole("alert").textContent()).toBe("Passwords don't match.");
    expect(await confirm.getAttribute("aria-invalid")).toBe("true");

    await confirm.fill("abcdef");
    expect(await hint.textContent()).toBe("Passwords match.");
    expect(await confirm.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the chosen file and lets you remove it", async () => {
    const { page } = await open("/share");
    await page.locator("#file-input").setInputFiles(pdf);

    expect(await page.locator("#file-name").textContent()).toBe("contract.pdf");
    expect(await page.locator("#file-size").textContent()).toBe(`${pdf.buffer.length} B`);
    expect(await page.getByText("Choose a file", { exact: false }).isVisible()).toBe(false);

    await page.getByRole("button", { name: "Remove selected file" }).click();
    expect(await page.locator("#file-chip").isVisible()).toBe(false);
    expect(await page.locator("#dropzone-label").isVisible()).toBe(true);
  });

  it("accepts a dropped file", async () => {
    const { page } = await open("/share");
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["dropped"], "dropped.pdf", { type: "application/pdf" }));
      document
        .getElementById("dropzone")
        ?.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    });
    expect(await page.locator("#file-name").textContent()).toBe("dropped.pdf");
  });

  it("rejects empty and oversized files", async () => {
    const { page } = await open("/share");
    await page.locator("#file-input").setInputFiles({
      name: "empty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    });
    expect(await page.getByRole("alert").textContent()).toBe("That file is empty.");
    expect(await page.locator("#file-chip").isVisible()).toBe(false);

    await page.evaluate((size) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(size)], "huge.pdf"));
      document
        .getElementById("dropzone")
        ?.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    }, MAX_FILE_BYTES + 1);
    expect(await page.getByRole("alert").textContent()).toBe(
      "That file is too big (50 MB). The limit is 50 MB.",
    );
    expect(await page.locator("#file-chip").isVisible()).toBe(false);
  });

  it("toggles password visibility for both fields", async () => {
    const { page } = await open("/share");
    const toggle = page.locator("#view-upload .reveal");
    await toggle.click();
    expect(await toggle.getAttribute("aria-pressed")).toBe("true");
    expect(await toggle.textContent()).toBe("Hide");
    expect(await page.locator("#password").getAttribute("type")).toBe("text");
    expect(await page.locator("#confirm").getAttribute("type")).toBe("text");
    await toggle.click();
    expect(await page.locator("#password").getAttribute("type")).toBe("password");
  });

  it("encrypts, uploads and shows a copyable share link", async () => {
    const { page } = await open("/share");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseURL,
    });

    // Capture the upload so we can prove plaintext never reaches the server.
    const requestBody = page
      .waitForRequest((r) => r.url().endsWith("/api/files") && r.method() === "POST")
      .then((r) => r.postDataBuffer());

    await page.locator("#file-input").setInputFiles(pdf);
    await page.locator("#view-upload").getByLabel("Password", { exact: true }).fill("tr0ub4dor&3");
    await page.locator("#view-upload").getByLabel("Confirm password").fill("tr0ub4dor&3");
    await page.getByRole("radio", { name: "7 days" }).check();
    await page.getByRole("button", { name: "Encrypt & upload" }).click();

    await page.getByRole("heading", { name: "Your link is ready" }).waitFor();
    const sent = await requestBody;
    expect(sent).not.toBeNull();
    expect(sent?.includes(pdf.buffer)).toBe(false);
    expect(sent?.toString("latin1")).not.toContain("contract.pdf");

    const link = await page.getByLabel("Share link").inputValue();
    expect(link).toMatch(new RegExp(`^${baseURL}/f/[A-Za-z0-9_-]{22}$`));
    expect(await page.locator("#shared-name").textContent()).toBe(
      `contract.pdf (${pdf.buffer.length} B)`,
    );
    expect(await page.locator("#shared-expiry").textContent()).toBe("in 7 days");
    // Focus moves to the new heading for screen-reader users.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("shared-title");

    await page.getByRole("button", { name: "Copy" }).click();
    await page.getByText("Copied to clipboard.").waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    const id = link.split("/f/")[1] ?? "";
    const info = (await (await fetch(`${baseURL}/api/files/${id}`)).json()) as {
      expiresAt: number;
      attemptsLeft: number;
    };
    expect(info.attemptsLeft).toBe(5);
    expect(info.expiresAt - Date.now()).toBeGreaterThan(7 * 86_400_000 - 120_000);

    await page.getByRole("link", { name: "Seal another file" }).click();
    await page.getByRole("heading", { name: "Seal a file" }).waitFor();
    expect(
      await page.locator("#view-upload").getByLabel("Password", { exact: true }).inputValue(),
    ).toBe("");
  });

  it("shows an error and restores the form when the upload fails", async () => {
    const { page, errors } = await open("/share");
    await page.route("**/api/files", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
    );
    await page.locator("#file-input").setInputFiles(pdf);
    await page.locator("#view-upload").getByLabel("Password", { exact: true }).fill("password1");
    await page.locator("#view-upload").getByLabel("Confirm password").fill("password1");
    await page.getByRole("button", { name: "Encrypt & upload" }).click();

    await page.getByText("Upload failed. Check your connection and try again.").waitFor();
    expect(await page.locator("#upload-form").isVisible()).toBe(true);
    expect(await page.locator("#upload-progress").isVisible()).toBe(false);
    // Nothing was lost; the user can retry immediately.
    expect(await page.locator("#file-name").textContent()).toBe("contract.pdf");
    // The failure is logged for debugging; that's the only error we expect.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("500 boom");
    errors.length = 0;
  });

  it("fits a small phone screen without horizontal scrolling", async () => {
    const { page } = await open("/share", {
      viewport: { width: 320, height: 640 },
      isMobile: true,
    });
    await page.locator("#file-input").setInputFiles({
      ...pdf,
      name: `${"very-long-file-name-".repeat(8)}.pdf`,
    });
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
