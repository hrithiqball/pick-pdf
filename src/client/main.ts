import "./style.css";
import { ApiError, claimFile, getFileInfo, uploadFile } from "./api.ts";
import { checkPasswords, formatBytes, formatRelative } from "./format.ts";
import { decryptFile, deriveKeys, encryptFile, SALT_BYTES } from "../shared/crypto.ts";
import {
  DEFAULT_EXPIRY,
  fromB64url,
  isExpiryOption,
  isFileId,
  MAX_FILE_BYTES,
  MIN_PASSWORD_LENGTH,
  toB64url,
} from "../shared/protocol.ts";
import type { FileInfo } from "../shared/protocol.ts";

type View = "upload" | "shared" | "open" | "done" | "gone";

function $(id: string): HTMLElement;
function $<T extends HTMLElement>(id: string, type: new () => T): T;
function $(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const views: Record<View, HTMLElement> = {
  upload: $("view-upload"),
  shared: $("view-shared"),
  open: $("view-open"),
  done: $("view-done"),
  gone: $("view-gone"),
};

function show(view: View, focusTitle = true): void {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  if (focusTitle) views[view].querySelector<HTMLElement>(".title")?.focus();
}

// ---------------------------------------------------------------------------
// Password reveal toggles
// ---------------------------------------------------------------------------

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-reveal]")) {
  button.addEventListener("click", () => {
    const reveal = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(reveal));
    button.textContent = reveal ? "Hide" : "Show";
    for (const id of (button.dataset.reveal ?? "").split(" ")) {
      $(id, HTMLInputElement).type = reveal ? "text" : "password";
    }
  });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

const uploadForm = $("upload-form", HTMLFormElement);
const fileInput = $("file-input", HTMLInputElement);
const dropzone = $("dropzone");
const dropzoneLabel = $("dropzone-label");
const fileChip = $("file-chip");
const passwordInput = $("password", HTMLInputElement);
const confirmInput = $("confirm", HTMLInputElement);
const passwordHint = $("password-hint");
const uploadError = $("upload-error");
const progress = $("upload-progress");
const progressLabel = $("progress-label");
const progressBar = $("progress-bar");
const progressFill = $("progress-fill");

let selectedFile: File | null = null;

$("file-limit-hint").textContent = `Any type · up to ${formatBytes(MAX_FILE_BYTES)}`;

function selectFile(file: File | null): void {
  uploadError.textContent = "";
  if (file && file.size === 0) {
    uploadError.textContent = "That file is empty.";
    file = null;
  } else if (file && file.size > MAX_FILE_BYTES) {
    uploadError.textContent = `That file is too big (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_FILE_BYTES)}.`;
    file = null;
  }
  selectedFile = file;
  fileChip.hidden = !file;
  dropzoneLabel.hidden = !!file;
  if (file) {
    $("file-name").textContent = file.name;
    $("file-size").textContent = formatBytes(file.size);
  } else {
    fileInput.value = "";
  }
}

fileInput.addEventListener("change", () => selectFile(fileInput.files?.[0] ?? null));
$("file-clear").addEventListener("click", () => {
  selectFile(null);
  fileInput.focus();
});

for (const type of ["dragenter", "dragover"] as const) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"] as const) {
  dropzone.addEventListener(type, () => dropzone.classList.remove("dragging"));
}
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) selectFile(file);
});

function updatePasswordHint(): void {
  const password = passwordInput.value;
  const confirm = confirmInput.value;
  passwordHint.classList.remove("ok");
  if (password.length < MIN_PASSWORD_LENGTH) {
    passwordHint.textContent = `At least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (confirm && confirm !== password) {
    passwordHint.textContent = "Passwords don't match yet.";
  } else if (confirm === password) {
    passwordHint.textContent = "Passwords match.";
    passwordHint.classList.add("ok");
  } else {
    passwordHint.textContent = "Now confirm it below.";
  }
  passwordInput.removeAttribute("aria-invalid");
  confirmInput.removeAttribute("aria-invalid");
}
passwordInput.addEventListener("input", updatePasswordHint);
confirmInput.addEventListener("input", updatePasswordHint);

function setProgress(label: string, fraction: number | null): void {
  progressLabel.textContent = label;
  progressBar.classList.toggle("indeterminate", fraction === null);
  if (fraction === null) {
    progressBar.removeAttribute("aria-valuenow");
    progressFill.style.width = "";
  } else {
    const percent = Math.round(fraction * 100);
    progressBar.setAttribute("aria-valuenow", String(percent));
    progressFill.style.width = `${percent}%`;
  }
}

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleUpload();
});

async function handleUpload(): Promise<void> {
  uploadError.textContent = "";
  if (!selectedFile) {
    uploadError.textContent = "Choose a file to seal.";
    fileInput.focus();
    return;
  }
  const problem = checkPasswords(passwordInput.value, confirmInput.value);
  if (problem === "too_short") {
    uploadError.textContent = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    passwordInput.setAttribute("aria-invalid", "true");
    passwordInput.focus();
    return;
  }
  if (problem === "mismatch") {
    uploadError.textContent = "Passwords don't match.";
    confirmInput.setAttribute("aria-invalid", "true");
    confirmInput.focus();
    return;
  }

  const expiryValue = new FormData(uploadForm).get("expiry");
  const expiry = isExpiryOption(expiryValue) ? expiryValue : DEFAULT_EXPIRY;
  const file = selectedFile;

  uploadForm.hidden = true;
  progress.hidden = false;
  try {
    setProgress("Deriving key from password…", null);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const keys = await deriveKeys(passwordInput.value, salt);

    setProgress("Encrypting in your browser…", null);
    const data = new Uint8Array(await file.arrayBuffer());
    const body = await encryptFile(
      keys.encryptionKey,
      { name: file.name, type: file.type || "application/octet-stream" },
      data,
    );

    setProgress("Uploading 0%", 0);
    const result = await uploadFile({
      body,
      salt: toB64url(salt),
      authHash: keys.authHash,
      expiry,
      onProgress: (fraction) => setProgress(`Uploading ${Math.round(fraction * 100)}%`, fraction),
    });

    $("share-link", HTMLInputElement).value = `${location.origin}/f/${result.id}`;
    $("shared-name").textContent = `${file.name} (${formatBytes(file.size)})`;
    $("shared-expiry").textContent = formatRelative(result.expiresAt);
    $("copy-status").textContent = "";
    uploadForm.reset();
    selectFile(null);
    updatePasswordHint();
    show("shared");
  } catch (error) {
    console.error(error);
    uploadError.textContent =
      error instanceof ApiError && error.code === "too_large"
        ? "That file is too large."
        : "Upload failed. Check your connection and try again.";
  } finally {
    uploadForm.hidden = false;
    progress.hidden = true;
  }
}

$("copy-link").addEventListener("click", () => {
  const input = $("share-link", HTMLInputElement);
  const status = $("copy-status");
  navigator.clipboard.writeText(input.value).then(
    () => {
      status.textContent = "Copied to clipboard.";
      status.classList.add("ok");
    },
    () => {
      input.select();
      status.textContent = "Press Ctrl/⌘ + C to copy.";
      status.classList.remove("ok");
    },
  );
});

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

const openForm = $("open-form", HTMLFormElement);
const openPassword = $("open-password", HTMLInputElement);
const openError = $("open-error");
const openSubmit = $("open-submit", HTMLButtonElement);
let objectUrl: string | null = null;

function showGone(reason?: string): void {
  if (reason) $("gone-reason").textContent = reason;
  show("gone");
}

function attemptsText(left: number): string {
  return `${left} ${left === 1 ? "attempt" : "attempts"} left`;
}

async function openLink(id: string): Promise<void> {
  let info: FileInfo | null;
  try {
    info = await getFileInfo(id);
  } catch {
    showGone("We couldn't reach the server. Refresh to try again.");
    return;
  }
  if (!info) {
    showGone();
    return;
  }
  $("open-size").textContent = formatBytes(info.size);
  $("open-expiry").textContent = formatRelative(info.expiresAt);
  $("open-attempts").textContent = String(info.attemptsLeft);
  show("open", false);
  openPassword.focus();

  const salt = fromB64url(info.salt);
  openForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleClaim(id, salt);
  });
}

async function handleClaim(id: string, salt: Uint8Array<ArrayBuffer>): Promise<void> {
  openError.textContent = "";
  if (!openPassword.value) {
    openError.textContent = "Enter the password.";
    openPassword.focus();
    return;
  }

  openSubmit.disabled = true;
  openSubmit.textContent = "Unlocking…";
  openPassword.removeAttribute("aria-invalid");
  try {
    const keys = await deriveKeys(openPassword.value, salt);
    const outcome = await claimFile(id, keys.authKey);
    if (!outcome.ok) {
      if (outcome.error === "destroyed") {
        showGone("Too many wrong passwords. The file was destroyed.");
        return;
      }
      if (outcome.error === "gone") {
        showGone();
        return;
      }
      openError.textContent = `Wrong password. ${attemptsText(outcome.attemptsLeft)}.`;
      $("open-attempts").textContent = String(outcome.attemptsLeft);
      openPassword.setAttribute("aria-invalid", "true");
      openPassword.select();
      return;
    }

    const { header, data } = await decryptFile(keys.encryptionKey, outcome.payload);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(new Blob([data], { type: header.type }));
    const save = $("done-save", HTMLAnchorElement);
    save.href = objectUrl;
    save.download = header.name;
    $("done-name").textContent = header.name;
    openForm.reset();
    show("done");
    save.click();
  } catch (error) {
    console.error(error);
    openError.textContent = "Something went wrong. Try again.";
  } finally {
    openSubmit.disabled = false;
    openSubmit.textContent = "Unlock & download";
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

if (location.pathname.startsWith("/f/")) {
  const id = location.pathname.slice(3).replace(/\/$/, "");
  if (isFileId(id)) void openLink(id);
  else showGone();
} else {
  show("upload", false);
  updatePasswordHint();
}
