// The "choose a PDF" drop zone shared by the Unlock and Lock pages. Element ids are
// `${prefix}-input`, `${prefix}-dropzone`, `${prefix}-chip`, and so on (see index.html).
import { $, bindDropzone } from "./dom.ts";
import { formatBytes } from "./format.ts";
import { looksLikePdf, MAX_PDF_BYTES } from "./pdf/client.ts";

export interface PickedPdf {
  file: File;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface PdfPicker {
  status: HTMLElement;
  error: HTMLElement;
  reset(): void;
  /** Returns a check that turns false once the user picks another file or removes this one. */
  guard(): () => boolean;
}

export function createPdfPicker(
  prefix: string,
  handlers: { onPick: (pdf: PickedPdf) => void; onReset: () => void },
): PdfPicker {
  const input = $(`${prefix}-input`, HTMLInputElement);
  const label = $(`${prefix}-dropzone-label`);
  const chip = $(`${prefix}-chip`);
  const status = $(`${prefix}-status`);
  const error = $(`${prefix}-error`);
  let generation = 0;

  $(`${prefix}-limit-hint`).textContent =
    `PDF · up to ${formatBytes(MAX_PDF_BYTES)} · stays on your device`;

  function reset(): void {
    generation++;
    input.value = "";
    chip.hidden = true;
    label.hidden = false;
    status.textContent = "";
    error.textContent = "";
    handlers.onReset();
  }

  function guard(): () => boolean {
    const run = generation;
    return () => run === generation;
  }

  async function choose(file: File): Promise<void> {
    reset();
    const current = guard();
    if (file.size === 0) {
      error.textContent = "That file is empty.";
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      error.textContent = `That file is too big (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_PDF_BYTES)}.`;
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!current()) return;
    if (!looksLikePdf(bytes)) {
      error.textContent = "That doesn't look like a PDF. Choose a .pdf file.";
      return;
    }
    chip.hidden = false;
    label.hidden = true;
    $(`${prefix}-name`).textContent = file.name;
    $(`${prefix}-size`).textContent = formatBytes(file.size);
    handlers.onPick({ file, bytes });
  }

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void choose(file);
  });
  bindDropzone($(`${prefix}-dropzone`), (file) => void choose(file));
  $(`${prefix}-clear`).addEventListener("click", () => {
    reset();
    input.focus();
  });

  return { status, error, reset, guard };
}

let objectUrl: string | null = null;

/** Point `link` at `pdf` as a download named `name`. Returns the File for reuse. */
export function offerDownload(
  link: HTMLAnchorElement,
  pdf: Uint8Array<ArrayBuffer>,
  name: string,
): File {
  const file = new File([pdf], name, { type: "application/pdf" });
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  link.href = objectUrl;
  link.download = name;
  return file;
}
