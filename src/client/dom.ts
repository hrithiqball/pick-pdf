export type View = "unlock" | "unlocked" | "upload" | "shared" | "open" | "done" | "gone";

export function $(id: string): HTMLElement;
export function $<T extends HTMLElement>(id: string, type: new () => T): T;
export function $(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const views: Record<View, HTMLElement> = {
  unlock: $("view-unlock"),
  unlocked: $("view-unlocked"),
  upload: $("view-upload"),
  shared: $("view-shared"),
  open: $("view-open"),
  done: $("view-done"),
  gone: $("view-gone"),
};

const navFor: Partial<Record<View, string>> = {
  unlock: "nav-unlock",
  unlocked: "nav-unlock",
  upload: "nav-share",
  shared: "nav-share",
};

export function show(view: View, focusTitle = true): void {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  for (const link of document.querySelectorAll(".nav a")) {
    if (link.id === navFor[view]) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (focusTitle) views[view].querySelector<HTMLElement>(".title")?.focus();
}

/** Drag-and-drop onto `zone`; clicking still goes through the zone's file input. */
export function bindDropzone(zone: HTMLElement, onFile: (file: File) => void): void {
  for (const type of ["dragenter", "dragover"] as const) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"] as const) {
    zone.addEventListener(type, () => zone.classList.remove("dragging"));
  }
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  });
}

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
