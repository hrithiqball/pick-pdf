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

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "unknown error";
}
