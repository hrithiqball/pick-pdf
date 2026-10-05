import "./style.css";
import { openLink, showGone, showShare } from "./share.ts";
import { showLock } from "./lock.ts";
import { showUnlock } from "./unlock.ts";
import { show } from "./dom.ts";
import { pageFor, SHARE_LINK_PAGE } from "../shared/pages.ts";
import { isFileId } from "../shared/protocol.ts";

const path = location.pathname.replace(/\/$/, "") || "/";

if (path === "/f" || path.startsWith("/f/")) {
  const id = path.slice(3);
  if (isFileId(id)) void openLink(id);
  else showGone();
} else if (path === "/share") {
  showShare();
} else if (path === "/about") {
  show("about", false);
} else if (path === "/lock") {
  showLock(shareFile);
} else {
  showUnlock(shareFile);
}

/** Keep the tab title in step with the view (the built HTML already has it for each page). */
function syncTitle(): void {
  const current = location.pathname.replace(/\/$/, "") || "/";
  document.title = current.startsWith("/f/")
    ? SHARE_LINK_PAGE.title
    : (pageFor(current) ?? pageFor("/"))!.title;
}
syncTitle();

/** Hand a freshly locked/unlocked PDF to the one-time share flow. */
function shareFile(file: File): void {
  history.pushState(null, "", "/share");
  syncTitle();
  showShare(file);
}

// Back from the share hand-off returns to the page it came from.
addEventListener("popstate", () => location.reload());
