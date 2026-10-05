// "Lock PDF": add an open password (AES-256) locally with qpdf (WASM, in a Web Worker).
import { $, bindPasswordHint, show } from "./dom.ts";
import { checkPasswords } from "./format.ts";
import { inspect, lock, renamePdf } from "./pdf/client.ts";
import { createPdfPicker, offerDownload } from "./pdf-picker.ts";
import type { PickedPdf } from "./pdf-picker.ts";
import { MIN_PASSWORD_LENGTH } from "../shared/protocol.ts";

const form = $("lock-form", HTMLFormElement);
const password = $("lock-password", HTMLInputElement);
const confirm = $("lock-confirm", HTMLInputElement);
const restrict = $("lock-restrict", HTMLInputElement);
const submit = $("lock-submit", HTMLButtonElement);
const already = $("lock-already");
const save = $("locked-save", HTMLAnchorElement);

let selected: PickedPdf | null = null;
let lockedFile: File | null = null;

const updateHint = bindPasswordHint(password, confirm, $("lock-password-hint"));

const picker = createPdfPicker("lock", {
  onPick: (pdf) => void check(pdf),
  onReset: () => {
    selected = null;
    form.hidden = true;
    already.hidden = true;
    form.reset();
    updateHint();
  },
});
const { status, error } = picker;

const UNREADABLE = "We couldn't read this PDF. It may be damaged or not a real PDF.";

async function check(pdf: PickedPdf): Promise<void> {
  const current = picker.guard();
  status.textContent = "Checking the PDF…";
  const result = await inspect(pdf.bytes);
  if (!current()) return;
  status.textContent = "";

  switch (result.kind) {
    case "needs_password":
      already.hidden = false;
      return;
    case "invalid_pdf":
      console.warn("qpdf could not read the file:", result.detail);
      error.textContent = UNREADABLE;
      return;
    case "open":
      selected = pdf;
      if (result.restricted) {
        status.textContent =
          "This PDF has print/copy restrictions. Locking it replaces them with the options below.";
      }
      form.hidden = false;
      password.focus();
  }
}

function setBusy(busy: boolean): void {
  submit.disabled = busy;
  submit.textContent = busy ? "Locking…" : "Lock PDF";
  password.readOnly = busy;
  confirm.readOnly = busy;
  restrict.disabled = busy;
}

async function handleLock(): Promise<void> {
  if (!selected) return;
  error.textContent = "";
  const problem = checkPasswords(password.value, confirm.value);
  if (problem === "too_short") {
    error.textContent = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    password.setAttribute("aria-invalid", "true");
    password.focus();
    return;
  }
  if (problem === "mismatch") {
    error.textContent = "Passwords don't match.";
    confirm.setAttribute("aria-invalid", "true");
    confirm.focus();
    return;
  }

  const current = picker.guard();
  const source = selected.file;
  const restricted = restrict.checked;
  setBusy(true);
  try {
    const result = await lock(selected.bytes, { password: password.value, restrict: restricted });
    if (!current()) return;
    if (result.kind !== "locked") {
      console.warn("qpdf could not lock the file:", result);
      error.textContent = UNREADABLE;
      return;
    }
    const name = renamePdf(source.name, "locked");
    lockedFile = offerDownload(save, result.pdf, name);
    $("locked-name").textContent = name;
    $("locked-detail").textContent = restricted
      ? " Printing, copying and editing are blocked too."
      : "";
    picker.reset();
    show("locked");
    save.click();
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleLock();
});

export function showLock(onShare: (file: File) => void): void {
  show("lock", false);
  updateHint();
  $("locked-share").addEventListener("click", () => {
    if (lockedFile) onShare(lockedFile);
  });
}
