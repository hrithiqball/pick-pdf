import "./style.css";
import { openLink, showGone, showShare } from "./share.ts";
import { showLock } from "./lock.ts";
import { showUnlock } from "./unlock.ts";
import { isFileId } from "../shared/protocol.ts";

const path = location.pathname.replace(/\/$/, "") || "/";

if (path === "/f" || path.startsWith("/f/")) {
  const id = path.slice(3);
  if (isFileId(id)) void openLink(id);
  else showGone();
} else if (path === "/share") {
  showShare();
} else if (path === "/lock") {
  showLock(shareFile);
} else {
  showUnlock(shareFile);
}

/** Hand a freshly locked/unlocked PDF to the one-time share flow. */
function shareFile(file: File): void {
  history.pushState(null, "", "/share");
  showShare(file);
}

// Back from the share hand-off returns to the page it came from.
addEventListener("popstate", () => location.reload());
