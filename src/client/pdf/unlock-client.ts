import type { UnlockRequest, UnlockResponse } from "./protocol.ts";
import type { UnlockOutcome } from "./qpdf.ts";

export const MAX_PDF_BYTES = 200 * 1024 * 1024;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (outcome: UnlockOutcome) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./unlock.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<UnlockResponse>) => {
    pending.get(event.data.id)?.(event.data.outcome);
    pending.delete(event.data.id);
  });
  worker.addEventListener("error", (event) => {
    // A crashed worker fails every request in flight; the next call starts a fresh one.
    for (const resolve of pending.values()) {
      resolve({ kind: "invalid_pdf", detail: event.message || "worker crashed" });
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

/** Unlock `input` in a Web Worker. The input is copied, so it can be retried with another password. */
export function unlock(input: Uint8Array<ArrayBuffer>, password: string): Promise<UnlockOutcome> {
  const id = nextId++;
  const copy = input.slice().buffer;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const request: UnlockRequest = { id, input: copy, password };
    getWorker().postMessage(request, [copy]);
  });
}

/** Quick sniff before handing bytes to qpdf: PDFs start with "%PDF-" within the first 1 KB. */
export function looksLikePdf(head: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(head.subarray(0, 1024));
  return text.includes("%PDF-");
}

export function unlockedName(name: string): string {
  const base = name.replace(/\.pdf$/i, "");
  return `${base || "document"}-unlocked.pdf`;
}
