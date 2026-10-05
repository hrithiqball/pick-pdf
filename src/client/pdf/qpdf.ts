// Removes PDF passwords with qpdf compiled to WebAssembly. Runs anywhere WASM does:
// the browser (inside a Web Worker) and Node (unit tests). Nothing leaves the device.

import createModule from "@neslinesli93/qpdf-wasm";

export type UnlockOutcome =
  /** `restrictionsOnly`: the PDF opened without a password; only print/copy/edit limits were removed. */
  | { kind: "unlocked"; pdf: Uint8Array<ArrayBuffer>; restrictionsOnly: boolean }
  | { kind: "not_encrypted" }
  | { kind: "needs_password" }
  | { kind: "invalid_pdf"; detail: string };

export interface QpdfRun {
  exitCode: number;
  output: string;
  readOutput: () => Uint8Array<ArrayBuffer> | null;
}

export const INPUT = "/input.pdf";
export const OUTPUT = "/output.pdf";

/** qpdf exit codes: 0 = ok, 2 = error, 3 = ok with warnings (output is still valid). */
const succeeded = (code: number) => code === 0 || code === 3;

/**
 * Runs one qpdf command in a fresh WASM instance. Emscripten programs aren't meant to have
 * `main` called twice, and instantiation from a cached module takes a few milliseconds.
 */
export async function runQpdf(
  args: string[],
  input: Uint8Array,
  locateWasm: () => string,
): Promise<QpdfRun> {
  // This build ignores Emscripten's `print`/`printErr` and binds console.log/console.error
  // when the factory runs, so swap them for the synchronous part of instantiation.
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
  const { log, error } = console;
  console.log = capture;
  console.error = capture;
  let pending: ReturnType<typeof createModule>;
  try {
    pending = createModule({ locateFile: locateWasm, thisProgram: "qpdf" });
  } finally {
    console.log = log;
    console.error = error;
  }
  const instance = await pending;

  instance.FS.writeFile(INPUT, input);
  let exitCode: number;
  try {
    exitCode = instance.callMain(args);
  } catch (thrown) {
    // Emscripten signals exit() by throwing an ExitStatus with a numeric `status`.
    exitCode =
      typeof thrown === "object" && thrown !== null && "status" in thrown
        ? Number(thrown.status)
        : 2;
    if (exitCode === 2 && lines.length === 0) lines.push(String(thrown));
  }

  return {
    exitCode,
    output: lines.join("\n"),
    readOutput: () => {
      try {
        return new Uint8Array(instance.FS.readFile(OUTPUT));
      } catch {
        return null;
      }
    },
  };
}

export async function unlockPdf(
  input: Uint8Array,
  password: string,
  locateWasm: () => string,
): Promise<UnlockOutcome> {
  const decrypt = await runQpdf(
    [`--password=${password}`, "--decrypt", INPUT, OUTPUT],
    input,
    locateWasm,
  );

  if (!succeeded(decrypt.exitCode)) {
    if (/invalid password/i.test(decrypt.output)) return { kind: "needs_password" };
    return { kind: "invalid_pdf", detail: lastLine(decrypt.output) };
  }

  const pdf = decrypt.readOutput();
  if (!pdf) return { kind: "invalid_pdf", detail: "qpdf produced no output" };

  // --is-encrypted exits 0 when encrypted and 2 when not.
  const check = await runQpdf(
    [`--password=${password}`, "--is-encrypted", INPUT],
    input,
    locateWasm,
  );
  if (check.exitCode === 2) return { kind: "not_encrypted" };

  return { kind: "unlocked", pdf, restrictionsOnly: password === "" };
}

export type PdfStatus =
  /** Opens without a password (may still carry print/copy/edit restrictions). */
  | { kind: "open"; restricted: boolean }
  | { kind: "needs_password" }
  | { kind: "invalid_pdf"; detail: string };

/** What protection a PDF has, without decrypting or writing anything. */
export async function inspectPdf(input: Uint8Array, locateWasm: () => string): Promise<PdfStatus> {
  // --is-encrypted exits 0 when encrypted, 2 when not; it also fails (2, with a message)
  // when the file can't be opened at all.
  const run = await runQpdf(["--is-encrypted", INPUT], input, locateWasm);
  if (run.exitCode === 0) return { kind: "open", restricted: true };
  if (/invalid password/i.test(run.output)) return { kind: "needs_password" };
  if (run.output.trim()) return { kind: "invalid_pdf", detail: lastLine(run.output) };
  return { kind: "open", restricted: false };
}

export interface LockOptions {
  password: string;
  /** Also block printing, copying and editing (behind a random owner password). */
  restrict: boolean;
}

export type LockOutcome =
  | { kind: "locked"; pdf: Uint8Array<ArrayBuffer> }
  | { kind: "needs_password" }
  | { kind: "invalid_pdf"; detail: string };

/** Encrypt with AES-256. Any existing restrictions on an openable PDF are replaced. */
export async function lockPdf(
  input: Uint8Array,
  { password, restrict }: LockOptions,
  locateWasm: () => string,
): Promise<LockOutcome> {
  // With restrictions, the owner password must differ from the user password or opening
  // with the user password would grant full access. Nobody needs to know it.
  const owner = restrict ? randomOwnerPassword() : password;
  const limits = restrict ? ["--print=none", "--modify=none", "--extract=n", "--annotate=n"] : [];
  const run = await runQpdf(
    [
      "--encrypt",
      `--user-password=${password}`,
      `--owner-password=${owner}`,
      "--bits=256",
      ...limits,
      "--",
      INPUT,
      OUTPUT,
    ],
    input,
    locateWasm,
  );

  if (!succeeded(run.exitCode)) {
    if (/invalid password/i.test(run.output)) return { kind: "needs_password" };
    return { kind: "invalid_pdf", detail: lastLine(run.output) };
  }
  const pdf = run.readOutput();
  if (!pdf) return { kind: "invalid_pdf", detail: "qpdf produced no output" };
  return { kind: "locked", pdf };
}

function randomOwnerPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "unknown error";
}
