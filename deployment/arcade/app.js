import { lobbyPath, inviteFromPath } from "./lobby-url.mjs";

const frame = document.querySelector("#game");
const notice = document.querySelector("#notice");
const message = document.querySelector("#message");
const status = document.querySelector("#status");
const share = document.querySelector("#share");
const fullscreen = document.querySelector("#fullscreen");
let serverOrigin = null;
let connecting = false;
let invite = new URLSearchParams(location.search).has("lobby")
  ? location.href
  : null;
let generation = 0;

async function connect() {
  if (connecting) return;
  connecting = true;
  const current = ++generation;
  status.textContent = "Connecting…";
  message.textContent = "Connecting to the community game server…";
  try {
    const configResponse = await fetch(`./server.json?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!configResponse.ok)
      throw new Error("The game connection has not been configured yet.");
    const config = await configResponse.json();
    if (!config.serverUrl)
      throw new Error(
        "The host has not started the game server yet. Please try again later.",
      );
    const server = new URL(config.serverUrl);
    const local =
      server.hostname === "localhost" || server.hostname === "127.0.0.1";
    if (
      server.protocol !== "https:" &&
      !(
        location.hostname === "localhost" &&
        local &&
        server.protocol === "http:"
      )
    )
      throw new Error("The game server needs an HTTPS address.");
    if (
      server.username ||
      server.password ||
      server.pathname !== "/" ||
      server.search ||
      server.hash
    )
      throw new Error("Invalid game server address.");
    const target = lobbyPath(location.search);
    serverOrigin = server.origin;
    // A simple cross-origin image-free fetch checks the gateway without needing
    // broad CORS access. The PC's health endpoint explicitly allows this site.
    const healthResponse = await fetch(`${serverOrigin}/selfhost/health`, {
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!healthResponse.ok || !(await healthResponse.json()).online)
      throw new Error(
        "The host's PC is currently offline. Try again when the host starts the game.",
      );
    if (current !== generation) return;
    frame.src = serverOrigin + target;
    frame.hidden = false;
    notice.hidden = true;
    fullscreen.disabled = false;
    share.disabled = !invite;
    status.textContent = "Server online";
  } catch (error) {
    status.textContent = "Server offline";
    message.textContent =
      error.name === "TypeError" || error.name === "TimeoutError"
        ? "The host's PC is currently unreachable. Try again when the host starts the game server."
        : error.message;
    frame.hidden = true;
    notice.hidden = false;
    share.disabled = true;
    fullscreen.disabled = true;
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
    invite = next;
    history.replaceState(null, "", next);
    share.disabled = false;
    status.textContent = "Lobby ready · invite friends";
  } else {
    // Leaving a lobby must not leave a stale invitation in the address bar.
    invite = null;
    share.disabled = true;
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    history.replaceState(null, "", url);
    status.textContent = "Server online";
  }
});
share.addEventListener("click", async () => {
  if (!invite) return;
  try {
    await navigator.clipboard.writeText(invite);
    document.querySelector("#feedback").textContent = "Lobby link copied.";
  } catch {
    document.querySelector("#feedback").textContent =
      "Copy the lobby link from your address bar.";
  }
});
fullscreen.addEventListener("click", async () => {
  try {
    await document.querySelector("#stage").requestFullscreen();
  } catch {}
});
document.querySelector("#retry").addEventListener("click", connect);
addEventListener("popstate", () => {
  if (serverOrigin) frame.src = serverOrigin + lobbyPath(location.search);
});
connect();
