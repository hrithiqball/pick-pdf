// Every indexable page: its URL, built HTML file, the view it shows, and its search snippet.
// Used at build time (per-page HTML, sitemap) and by the client router (document.title).

/**
 * The public origin, e.g. "https://pickpdf.app". Canonical links, Open Graph URLs/images
 * and the sitemap need absolute URLs, so they're only emitted once this is set.
 */
export const SITE_URL: string | null = null;

export const SITE_NAME = "pick·pdf";

export type PageView = "unlock" | "lock" | "upload" | "about";

export interface SitePage {
  path: string;
  /** Built file; Cloudflare serves `/lock` from `lock.html`. */
  file: string;
  view: PageView;
  title: string;
  description: string;
}

export const PAGES: readonly SitePage[] = [
  {
    path: "/",
    file: "index.html",
    view: "unlock",
    title: "Unlock PDF: Remove a PDF Password Free & Privately | pick·pdf",
    description:
      "Remove the password from a PDF in seconds, free. It runs entirely in your browser, so your PDF and password are never uploaded or stored.",
  },
  {
    path: "/lock",
    file: "lock.html",
    view: "lock",
    title: "Lock PDF: Add a Password to a PDF Free & Privately | pick·pdf",
    description:
      "Password-protect a PDF with AES-256 encryption, free. It's done in your browser, so the file never leaves your device. Optionally block printing and copying.",
  },
  {
    path: "/share",
    file: "share.html",
    view: "upload",
    title: "Share a File with a One-Time Password Link | pick·pdf",
    description:
      "Send a file behind a password. It's encrypted in your browser and deleted after the first download, so nobody else, not even us, can read it.",
  },
  {
    path: "/about",
    file: "about.html",
    view: "about",
    title: "About pick·pdf: Private PDF Tools That Never See Your Files",
    description:
      "Why pick·pdf exists: online PDF tools ask you to upload private documents. pick·pdf unlocks and locks PDFs on your device and never stores your files.",
  },
];

/** Shown for one-time share links (`/f/:id`); never indexed. */
export const SHARE_LINK_PAGE = {
  file: "f.html",
  title: "A file was shared with you | pick·pdf",
  description: "Someone sent you a password-protected file with pick·pdf.",
} as const;

export function pageFor(path: string): SitePage | undefined {
  return PAGES.find((page) => page.path === path);
}
