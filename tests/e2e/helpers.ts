import { chromium } from "playwright";
import type { Browser, BrowserContextOptions, Page } from "playwright";
import { afterAll, afterEach, beforeAll, expect, inject } from "vite-plus/test";
import { INPUT, OUTPUT, runQpdf } from "../../src/client/pdf/qpdf.ts";
import { deriveKeys, encryptFile } from "../../src/shared/crypto.ts";
import {
  HEADER_AUTH_HASH,
  HEADER_EXPIRY,
  HEADER_SALT,
  toB64url,
} from "../../src/shared/protocol.ts";
import type { ExpiryOption, UploadResult } from "../../src/shared/protocol.ts";

export const baseURL = inject("baseURL");

interface TrackedPage {
  page: Page;
  /** Uncaught exceptions, CSP violations and console errors seen on the page. */
  errors: string[];
}

/**
 * Registers a shared Chromium for the calling test file. Every page gets its own
 * context (separate cookies/storage, like a separate person) and is checked for
 * runtime errors after each test.
 */
export function useBrowser(): {
  open: (path: string, options?: BrowserContextOptions) => Promise<TrackedPage>;
} {
  let browser: Browser;
  let tracked: TrackedPage[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  afterEach(async () => {
    const errors = tracked.flatMap((t) => t.errors);
    await Promise.all(tracked.map((t) => t.page.context().close()));
    tracked = [];
    expect(errors, "page produced runtime errors").toEqual([]);
  });

  async function open(path: string, options: BrowserContextOptions = {}): Promise<TrackedPage> {
    const context = await browser.newContext({ baseURL, acceptDownloads: true, ...options });
    // Keep tests hermetic: serve an empty stylesheet instead of hitting Google Fonts.
    await context.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    const page = await context.newPage();
    const entry: TrackedPage = { page, errors: [] };
    page.on("pageerror", (error) => entry.errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      // 401/404 API responses are expected in several flows; Chromium logs them as errors.
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        entry.errors.push(`console: ${message.text()}`);
      }
    });
    tracked.push(entry);
    await page.goto(path);
    return entry;
  }

  return { open };
}

/** Upload a file straight through the API, exactly as the browser client would. */
export async function seedFile(
  password: string,
  options: {
    name?: string;
    type?: string;
    content?: Uint8Array<ArrayBuffer>;
    expiry?: ExpiryOption;
  } = {},
): Promise<{ id: string; path: string; content: Uint8Array<ArrayBuffer>; authKey: string }> {
  const content = options.content ?? new TextEncoder().encode(`secret ${crypto.randomUUID()}`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keys = await deriveKeys(password, salt);
  const body = await encryptFile(
    keys.encryptionKey,
    { name: options.name ?? "seeded.txt", type: options.type ?? "text/plain" },
    content,
  );
  const response = await fetch(`${baseURL}/api/files`, {
    method: "POST",
    headers: {
      [HEADER_SALT]: toB64url(salt),
      [HEADER_AUTH_HASH]: keys.authHash,
      [HEADER_EXPIRY]: options.expiry ?? "1h",
    },
    body,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as UploadResult;
  return { id, path: `/f/${id}`, content, authKey: keys.authKey };
}

export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

const wasmPath = new URL(
  "../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  import.meta.url,
).pathname;

export const fixturePath = (name: string) =>
  new URL(`../fixtures/${name}.pdf`, import.meta.url).pathname;

/** Inspect a downloaded PDF with qpdf in Node: is it still encrypted, and what text does it hold? */
export async function inspectPdf(pdf: Uint8Array): Promise<{ encrypted: boolean; text: string }> {
  const locate = () => wasmPath;
  const encrypted = (await runQpdf(["--is-encrypted", INPUT], pdf, locate)).exitCode === 0;
  const qdf = await runQpdf(["--qdf", "--object-streams=disable", INPUT, OUTPUT], pdf, locate);
  return {
    encrypted,
    text: new TextDecoder("latin1").decode(qdf.readOutput() ?? new Uint8Array()),
  };
}
