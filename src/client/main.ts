import "./style.css";
import { openLink, showGone, showShare } from "./share.ts";
import { showUnlock } from "./unlock.ts";
import { isFileId } from "../shared/protocol.ts";

const path = location.pathname.replace(/\/$/, "") || "/";

if (path === "/f" || path.startsWith("/f/")) {
  const id = path.slice(3);
  if (isFileId(id)) void openLink(id);
  else showGone();
} else if (path === "/share") {
  showShare();
} else {
  showUnlock((file) => {
    history.pushState(null, "", "/share");
    showShare(file);
  });
}

// Back from the share hand-off returns to the unlocker.
addEventListener("popstate", () => location.reload());
