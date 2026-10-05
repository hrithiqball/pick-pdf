// "Unlock PDF": remove a PDF's password locally with qpdf (WASM, in a Web Worker).
import { $, bindDropzone, show } from "./dom.ts";
import { formatBytes } from "./format.ts";
import { looksLikePdf, MAX_PDF_BYTES, unlock, unlockedName } from "./pdf/unlock-client.ts";
import type { UnlockOutcome } from "./pdf/qpdf.ts";

const input = $("pdf-input", HTMLInputElement);
const dropzone = $("pdf-dropzone");
const dropzoneLabel = $("pdf-dropzone-label");
const chip = $("pdf-chip");
const status = $("pdf-status");
const error = $("pdf-error");
const form = $("pdf-form", HTMLFormElement);
const password = $("pdf-password", HTMLInputElement);
const submit = $("pdf-submit", HTMLButtonElement);
const save = $("unlocked-save", HTMLAnchorElement);

interface Selected {
  file: File;
  bytes: Uint8Array<ArrayBuffer>;
}

let selected: Selected | null = null;
let unlockedFile: File | null = null;
let objectUrl: string | null = null;
/** Ignore results for a file the user has since replaced. */
let generation = 0;

$("pdf-limit-hint").textContent =
  `PDF · up to ${formatBytes(MAX_PDF_BYTES)} · stays on your device`;

function reset(): void {
  generation++;
  selected = null;
  input.value = "";
  chip.hidden = true;
  dropzoneLabel.hidden = false;
  form.hidden = true;
  form.reset();
  status.textContent = "";
  error.textContent = "";
}

function setBusy(busy: boolean, label: string): void {
  submit.disabled = busy;
  submit.textContent = busy ? label : "Unlock PDF";
  password.readOnly = busy;
}

async function choose(file: File): Promise<void> {
  reset();
  const run = generation;
  if (file.size === 0) {
    error.textContent = "That file is empty.";
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    error.textContent = `That file is too big (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_PDF_BYTES)}.`;
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (run !== generation) return;
  if (!looksLikePdf(bytes)) {
    error.textContent = "That doesn't look like a PDF. Choose a .pdf file.";
    return;
  }

  selected = { file, bytes };
  chip.hidden = false;
  dropzoneLabel.hidden = true;
  $("pdf-name").textContent = file.name;
  $("pdf-size").textContent = formatBytes(file.size);
  status.textContent = "Checking the PDF…";

  // Try without a password first: restrictions-only PDFs unlock straight away.
  const outcome = await unlock(bytes, "");
  if (run !== generation) return;
  status.textContent = "";
  handle(outcome, "");
}

function handle(outcome: UnlockOutcome, attempted: string): void {
  if (!selected) return;
  switch (outcome.kind) {
    case "unlocked":
      finish(selected.file, outcome.pdf, outcome.restrictionsOnly);
      return;
    case "not_encrypted":
      status.textContent = "This PDF isn't password-protected. There's nothing to remove.";
      return;
    case "needs_password":
      form.hidden = false;
      if (attempted) {
        error.textContent = "That password didn't work. Check it and try again.";
        password.setAttribute("aria-invalid", "true");
        password.select();
      } else {
        status.textContent = "This PDF is password-protected. Enter its password to unlock it.";
        password.focus();
      }
      return;
    case "invalid_pdf":
      console.warn("qpdf could not read the file:", outcome.detail);
      form.hidden = true;
      error.textContent = "We couldn't read this PDF. It may be damaged or not a real PDF.";
      return;
  }
}

function finish(source: File, pdf: Uint8Array<ArrayBuffer>, restrictionsOnly: boolean): void {
  const name = unlockedName(source.name);
  unlockedFile = new File([pdf], name, { type: "application/pdf" });
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(unlockedFile);
  save.href = objectUrl;
  save.download = name;

  $("unlocked-title").textContent = restrictionsOnly ? "Restrictions removed" : "Password removed";
  $("unlocked-name").textContent = name;
  $("unlocked-detail").textContent = restrictionsOnly
    ? " had no open password, but blocked printing, copying or editing. Those limits are gone."
    : " opens without a password now.";
  reset();
  show("unlocked");
  save.click();
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) void choose(file);
});
bindDropzone(dropzone, (file) => void choose(file));
$("pdf-clear").addEventListener("click", () => {
  reset();
  input.focus();
});
password.addEventListener("input", () => {
  password.removeAttribute("aria-invalid");
  error.textContent = "";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    if (!selected) return;
    error.textContent = "";
    status.textContent = "";
    if (!password.value) {
      error.textContent = "Enter the PDF's password.";
      password.focus();
      return;
    }
    const run = generation;
    const attempt = password.value;
    setBusy(true, "Unlocking…");
    try {
      const outcome = await unlock(selected.bytes, attempt);
      if (run === generation) handle(outcome, attempt);
    } finally {
      setBusy(false, "");
    }
  })();
});

export function showUnlock(onShare: (file: File) => void): void {
  show("unlock", false);
  $("unlocked-share").addEventListener("click", () => {
    if (unlockedFile) onShare(unlockedFile);
  });
}
