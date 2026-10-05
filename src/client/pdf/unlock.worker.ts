// Runs qpdf off the main thread so large PDFs don't freeze the page.
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { unlockPdf } from "./qpdf.ts";
import type { UnlockRequest, UnlockResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<UnlockRequest>) => {
  const { id, input, password } = event.data;
  unlockPdf(new Uint8Array(input), password, () => wasmUrl).then(
    (outcome) => {
      const response: UnlockResponse = { id, outcome };
      self.postMessage(response, outcome.kind === "unlocked" ? [outcome.pdf.buffer] : []);
    },
    (error: unknown) => {
      const response: UnlockResponse = {
        id,
        outcome: { kind: "invalid_pdf", detail: String(error) },
      };
      self.postMessage(response, []);
    },
  );
});
