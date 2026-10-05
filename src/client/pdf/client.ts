import type { JobResults, PdfJob, PdfRequest, PdfResponse } from "./protocol.ts";
import type { LockOptions } from "./qpdf.ts";

export const MAX_PDF_BYTES = 200 * 1024 * 1024;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { op: PdfJob["op"]; resolve: (response: PdfResponse) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<PdfResponse>) => {
    pending.get(event.data.id)?.resolve(event.data);
    pending.delete(event.data.id);
  });
  worker.addEventListener("error", (event) => {
    // A crashed worker fails every request in flight; the next call starts a fresh one.
    const result = { kind: "invalid_pdf", detail: event.message || "worker crashed" } as const;
    for (const [id, { op, resolve }] of pending) resolve({ id, op, result });
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

/** Run a qpdf job in the Web Worker. The input is copied, so it can be reused for retries. */
function send(input: Uint8Array<ArrayBuffer>, job: PdfJob): Promise<PdfResponse> {
  const id = nextId++;
  const copy = input.slice().buffer;
  return new Promise((resolve) => {
    pending.set(id, { op: job.op, resolve });
    getWorker().postMessage({ ...job, id, input: copy } satisfies PdfRequest, [copy]);
  });
}

function mismatch(expected: string, got: PdfResponse): never {
  throw new Error(`Expected a ${expected} result, got ${got.op}`);
}

export async function inspect(input: Uint8Array<ArrayBuffer>): Promise<JobResults["inspect"]> {
  const response = await send(input, { op: "inspect" });
  return response.op === "inspect" ? response.result : mismatch("inspect", response);
}

export async function unlock(
  input: Uint8Array<ArrayBuffer>,
  password: string,
): Promise<JobResults["unlock"]> {
  const response = await send(input, { op: "unlock", password });
  return response.op === "unlock" ? response.result : mismatch("unlock", response);
}

export async function lock(
  input: Uint8Array<ArrayBuffer>,
  options: LockOptions,
): Promise<JobResults["lock"]> {
  const response = await send(input, { op: "lock", options });
  return response.op === "lock" ? response.result : mismatch("lock", response);
}

/** Quick sniff before handing bytes to qpdf: PDFs start with "%PDF-" within the first 1 KB. */
export function looksLikePdf(head: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(head.subarray(0, 1024));
  return text.includes("%PDF-");
}

/** "report.pdf" → "report-unlocked.pdf" */
export function renamePdf(name: string, suffix: "unlocked" | "locked"): string {
  const base = name.replace(/\.pdf$/i, "");
  return `${base || "document"}-${suffix}.pdf`;
}
