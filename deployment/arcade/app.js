import { lobbyPath, inviteFromPath } from "./lobby-url.mjs";
import { findServer } from "./server-connection.mjs";

const frame = document.querySelector("#game");
const notice = document.querySelector("#notice");
const message = document.querySelector("#message");
let serverOrigin = null;
let connecting = false;
let generation = 0;
let retryTimer;

async function connect() {
  if (connecting) return;
  connecting = true;
  clearTimeout(retryTimer);
  const current = ++generation;
  message.textContent = "Connecting to the community game server…";
  try {
    const target = lobbyPath(location.search);
    serverOrigin = await findServer();
    if (current !== generation) return;
    frame.src = serverOrigin + target;
    frame.hidden = false;
    notice.hidden = true;
  } catch (error) {
    message.textContent =
      error.name === "TypeError" || error.name === "TimeoutError"
        ? "The host's PC is currently unreachable. Try again when the host starts the game server."
        : error.message;
    frame.hidden = true;
    notice.hidden = false;
    retryTimer = setTimeout(connect, 5000);
  } finally {
    connecting = false;
  }
}

addEventListener("message", (event) => {
  if (event.origin !== serverOrigin || event.source !== frame.contentWindow)
    return;
  if (
    event.data?.type !== "openfront:navigation" ||
    typeof event.data.path !== "string"
  )
    return;
  const next = inviteFromPath(location.href, event.data.path);
  if (next) {
    history.replaceState(null, "", next);
  } else {
    // Leaving a lobby must not leave a stale invitation in the address bar.
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    history.replaceState(null, "", url);
  }
});
document.querySelector("#retry").addEventListener("click", connect);
addEventListener("popstate", () => {
  connect();
});
connect();

setInterval(async () => {
  if (frame.hidden || connecting || !serverOrigin) return;
  try {
    const health = await fetch(`${serverOrigin}/selfhost/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok || !(await health.json()).online) connect();
  } catch {
    connect();
  }
}, 15000);
