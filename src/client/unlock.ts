// "Unlock PDF": remove a PDF's password locally with qpdf (WASM, in a Web Worker).
import { $, show } from "./dom.ts";
import { renamePdf, unlock } from "./pdf/client.ts";
import type { UnlockOutcome } from "./pdf/qpdf.ts";
import { createPdfPicker, offerDownload } from "./pdf-picker.ts";
import type { PickedPdf } from "./pdf-picker.ts";

const form = $("pdf-form", HTMLFormElement);
const password = $("pdf-password", HTMLInputElement);
const submit = $("pdf-submit", HTMLButtonElement);
const save = $("unlocked-save", HTMLAnchorElement);

let selected: PickedPdf | null = null;
let unlockedFile: File | null = null;

const picker = createPdfPicker("pdf", {
  onPick: (pdf) => void check(pdf),
  onReset: () => {
    selected = null;
    form.hidden = true;
    form.reset();
  },
});
const { status, error } = picker;

function setBusy(busy: boolean): void {
  submit.disabled = busy;
  submit.textContent = busy ? "Unlocking…" : "Unlock PDF";
  password.readOnly = busy;
}

async function check(pdf: PickedPdf): Promise<void> {
  const current = picker.guard();
  selected = pdf;
  status.textContent = "Checking the PDF…";
  // Try without a password first: restrictions-only PDFs unlock straight away.
  const outcome = await unlock(pdf.bytes, "");
  if (!current()) return;
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
  const name = renamePdf(source.name, "unlocked");
  unlockedFile = offerDownload(save, pdf, name);
  $("unlocked-title").textContent = restrictionsOnly ? "Restrictions removed" : "Password removed";
  $("unlocked-name").textContent = name;
  $("unlocked-detail").textContent = restrictionsOnly
    ? " had no open password, but blocked printing, copying or editing. Those limits are gone."
    : " opens without a password now.";
  picker.reset();
  show("unlocked");
  save.click();
}

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
    const current = picker.guard();
    const attempt = password.value;
    setBusy(true);
    try {
      const outcome = await unlock(selected.bytes, attempt);
      if (current()) handle(outcome, attempt);
    } finally {
      setBusy(false);
    }
  })();
});

export function showUnlock(onShare: (file: File) => void): void {
  show("unlock", false);
  $("unlocked-share").addEventListener("click", () => {
    if (unlockedFile) onShare(unlockedFile);
  });
}
