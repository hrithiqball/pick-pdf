// Runs qpdf off the main thread so large PDFs don't freeze the page.
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { inspectPdf, lockPdf, unlockPdf } from "./qpdf.ts";
import type { PdfRequest, PdfResponse } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const locate = () => wasmUrl;

async function run(request: PdfRequest): Promise<PdfResponse> {
  const { id } = request;
  const input = new Uint8Array(request.input);
  if (request.op === "inspect") {
    return { id, op: request.op, result: await inspectPdf(input, locate) };
  }
  if (request.op === "unlock") {
    return { id, op: request.op, result: await unlockPdf(input, request.password, locate) };
  }
  return { id, op: request.op, result: await lockPdf(input, request.options, locate) };
}

self.addEventListener("message", (event: MessageEvent<PdfRequest>) => {
  const { id, op } = event.data;
  run(event.data).then(
    (response) => {
      const transfer = "pdf" in response.result ? [response.result.pdf.buffer] : [];
      self.postMessage(response, transfer);
    },
    (error: unknown) => {
      const response: PdfResponse = {
        id,
        op,
        result: { kind: "invalid_pdf", detail: String(error) },
      };
      self.postMessage(response, []);
    },
  );
});
