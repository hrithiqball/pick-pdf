import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  INPUT,
  inspectPdf,
  lockPdf,
  OUTPUT,
  runQpdf,
  unlockPdf,
} from "../../src/client/pdf/qpdf.ts";
import { looksLikePdf, renamePdf } from "../../src/client/pdf/client.ts";

const wasmPath = new URL(
  "../../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  import.meta.url,
).pathname;
const wasm = () => wasmPath;

function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`../fixtures/${name}.pdf`, import.meta.url));
}

/** Decompress all streams so page text can be searched. */
async function pageText(pdf: Uint8Array): Promise<string> {
  const run = await runQpdf(["--qdf", "--object-streams=disable", INPUT, OUTPUT], pdf, wasm);
  return new TextDecoder("latin1").decode(run.readOutput() ?? new Uint8Array());
}

async function isEncrypted(pdf: Uint8Array): Promise<boolean> {
  return (await runQpdf(["--is-encrypted", INPUT], pdf, wasm)).exitCode === 0;
}

// Fixtures were made with qpdf 12.4 from tests/fixtures/plain.pdf; user password "secret123".
const PASSWORD_PROTECTED = ["aes256", "aes128", "rc4-128", "rc4-40"] as const;

describe("unlockPdf", () => {
  for (const name of PASSWORD_PROTECTED) {
    it(`unlocks ${name} with the right password and keeps the content`, async () => {
      const outcome = await unlockPdf(fixture(name), "secret123", wasm);
      expect(outcome.kind).toBe("unlocked");
      if (outcome.kind !== "unlocked") return;
      expect(outcome.restrictionsOnly).toBe(false);
      expect(await isEncrypted(outcome.pdf)).toBe(false);
      const text = await pageText(outcome.pdf);
      expect(text).toContain("Hello from pick-pdf");
      expect(text).toContain("Page two marker");
    });

    it(`asks for a password for ${name} when none or a wrong one is given`, async () => {
      expect(await unlockPdf(fixture(name), "", wasm)).toEqual({ kind: "needs_password" });
      expect(await unlockPdf(fixture(name), "Secret123", wasm)).toEqual({
        kind: "needs_password",
      });
    });
  }

  it("accepts the owner password too", async () => {
    const outcome = await unlockPdf(fixture("aes256"), "owner456", wasm);
    expect(outcome.kind).toBe("unlocked");
  });

  it("handles unicode passwords", async () => {
    expect((await unlockPdf(fixture("unicode"), "pässwörd 密码 🔒", wasm)).kind).toBe("unlocked");
    expect((await unlockPdf(fixture("unicode"), "passwerd", wasm)).kind).toBe("needs_password");
  });

  it("removes print/copy restrictions from PDFs without an open password", async () => {
    const outcome = await unlockPdf(fixture("restricted"), "", wasm);
    expect(outcome.kind).toBe("unlocked");
    if (outcome.kind !== "unlocked") return;
    expect(outcome.restrictionsOnly).toBe(true);
    expect(await isEncrypted(outcome.pdf)).toBe(false);
    expect(await pageText(outcome.pdf)).toContain("Hello from pick-pdf");
  });

  it("reports PDFs that aren't protected", async () => {
    expect(await unlockPdf(fixture("plain"), "", wasm)).toEqual({ kind: "not_encrypted" });
  });

  it("reports damaged files", async () => {
    const outcome = await unlockPdf(fixture("corrupt"), "", wasm);
    expect(outcome.kind).toBe("invalid_pdf");
    const junk = await unlockPdf(new TextEncoder().encode("hello"), "", wasm);
    expect(junk.kind).toBe("invalid_pdf");
  });

  it("does not leak qpdf output to the console", async () => {
    const original = { log: console.log, error: console.error };
    const seen: unknown[] = [];
    console.log = (...args: unknown[]) => seen.push(args);
    console.error = (...args: unknown[]) => seen.push(args);
    try {
      await unlockPdf(fixture("aes256"), "wrong", wasm);
      await unlockPdf(fixture("corrupt"), "", wasm);
    } finally {
      console.log = original.log;
      console.error = original.error;
    }
    expect(seen).toEqual([]);
  });

  it("unlocks a 30 MB PDF", { timeout: 60_000 }, async () => {
    // Build a large plain PDF in memory, encrypt it with qpdf, then unlock it.
    const big = largePdf(30 * 1024 * 1024);
    const encrypt = await runQpdf(
      [
        "--encrypt",
        "--user-password=big",
        "--owner-password=big",
        "--bits=256",
        "--",
        INPUT,
        OUTPUT,
      ],
      big,
      wasm,
    );
    const encrypted = encrypt.readOutput();
    expect(encrypted).not.toBeNull();

    const started = performance.now();
    const outcome = await unlockPdf(encrypted!, "big", wasm);
    const elapsed = performance.now() - started;
    expect(outcome.kind).toBe("unlocked");
    if (outcome.kind === "unlocked") expect(await isEncrypted(outcome.pdf)).toBe(false);
    expect(elapsed).toBeLessThan(20_000);
  });
});

describe("inspectPdf", () => {
  it("tells open, restricted, locked and damaged PDFs apart", async () => {
    expect(await inspectPdf(fixture("plain"), wasm)).toEqual({ kind: "open", restricted: false });
    expect(await inspectPdf(fixture("restricted"), wasm)).toEqual({
      kind: "open",
      restricted: true,
    });
    for (const name of PASSWORD_PROTECTED) {
      expect(await inspectPdf(fixture(name), wasm)).toEqual({ kind: "needs_password" });
    }
    expect((await inspectPdf(fixture("corrupt"), wasm)).kind).toBe("invalid_pdf");
  });
});

/** qpdf --show-encryption output for `pdf` opened with `password`. */
async function encryption(pdf: Uint8Array, password: string): Promise<string> {
  return (await runQpdf([`--password=${password}`, "--show-encryption", INPUT], pdf, wasm)).output;
}

describe("lockPdf", () => {
  it("adds an AES-256 open password and keeps the content", async () => {
    const outcome = await lockPdf(
      fixture("plain"),
      { password: "hunter22", restrict: false },
      wasm,
    );
    expect(outcome.kind).toBe("locked");
    if (outcome.kind !== "locked") return;

    expect(await inspectPdf(outcome.pdf, wasm)).toEqual({ kind: "needs_password" });
    const info = await encryption(outcome.pdf, "hunter22");
    expect(info).toContain("R = 6");
    expect(info).toContain("AESv3");
    // Without restrictions the password grants full access.
    expect(info).toContain("print high resolution: allowed");
    expect(info).toContain("modify anything: allowed");

    // Round trip: our own unlocker opens it again.
    expect((await unlockPdf(outcome.pdf, "wrong", wasm)).kind).toBe("needs_password");
    const unlocked = await unlockPdf(outcome.pdf, "hunter22", wasm);
    expect(unlocked.kind).toBe("unlocked");
    if (unlocked.kind === "unlocked") {
      expect(await pageText(unlocked.pdf)).toContain("Hello from pick-pdf");
    }
  });

  it("can also block printing, copying and editing", async () => {
    const outcome = await lockPdf(fixture("plain"), { password: "hunter22", restrict: true }, wasm);
    expect(outcome.kind).toBe("locked");
    if (outcome.kind !== "locked") return;
    const info = await encryption(outcome.pdf, "hunter22");
    // The user password must not double as the owner password, or the limits would be moot.
    expect(info).toContain("Supplied password is user password");
    expect(info).not.toContain("Supplied password is owner password");
    expect(info).toContain("print high resolution: not allowed");
    expect(info).toContain("extract for any purpose: not allowed");
    expect(info).toContain("modify anything: not allowed");
  });

  it("handles unicode passwords", async () => {
    const outcome = await lockPdf(
      fixture("plain"),
      { password: "pässwörd 密码 🔒", restrict: false },
      wasm,
    );
    expect(outcome.kind).toBe("locked");
    if (outcome.kind !== "locked") return;
    expect((await unlockPdf(outcome.pdf, "pässwörd 密码 🔒", wasm)).kind).toBe("unlocked");
    expect((await unlockPdf(outcome.pdf, "passwort", wasm)).kind).toBe("needs_password");
  });

  it("replaces print/copy restrictions on a PDF that opens without a password", async () => {
    const outcome = await lockPdf(
      fixture("restricted"),
      { password: "hunter22", restrict: false },
      wasm,
    );
    expect(outcome.kind).toBe("locked");
    if (outcome.kind !== "locked") return;
    expect(await encryption(outcome.pdf, "hunter22")).toContain("print high resolution: allowed");
  });

  it("refuses PDFs that already need a password, and damaged files", async () => {
    expect(
      await lockPdf(fixture("aes256"), { password: "hunter22", restrict: false }, wasm),
    ).toEqual({
      kind: "needs_password",
    });
    expect(
      (await lockPdf(fixture("corrupt"), { password: "hunter22", restrict: false }, wasm)).kind,
    ).toBe("invalid_pdf");
  });
});

describe("helpers", () => {
  it("names the output copy", () => {
    expect(renamePdf("report.pdf", "unlocked")).toBe("report-unlocked.pdf");
    expect(renamePdf("Report.PDF", "locked")).toBe("Report-locked.pdf");
    expect(renamePdf("archive", "unlocked")).toBe("archive-unlocked.pdf");
    expect(renamePdf(".pdf", "locked")).toBe("document-locked.pdf");
  });

  it("sniffs the PDF header", () => {
    expect(looksLikePdf(fixture("aes256"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("\n\n%PDF-1.4 with leading junk"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("PK\u0003\u0004 zip file"))).toBe(false);
  });
});

function largePdf(streamBytes: number): Uint8Array {
  const enc = new TextEncoder();
  const content = new Uint8Array(streamBytes);
  // Incompressible-ish filler so qpdf really has to process the bytes.
  for (let i = 0; i < content.length; i += 65_536) {
    crypto.getRandomValues(content.subarray(i, i + 65_536));
  }
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
    length += chunk.length;
  };
  push(enc.encode("%PDF-1.7\n"));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>",
  ];
  objects.forEach((body, i) => {
    offsets.push(length);
    push(enc.encode(`${i + 1} 0 obj\n${body}\nendobj\n`));
  });
  offsets.push(length);
  push(enc.encode(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`));
  push(content);
  push(enc.encode("\nendstream\nendobj\n"));
  const xref = length;
  push(
    enc.encode(
      `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}` +
        `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
