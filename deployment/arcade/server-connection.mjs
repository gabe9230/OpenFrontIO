const latestConfig =
  "https://raw.githubusercontent.com/gabe9230/gabe9230.github.io/main/Arcade/openfront/server.json";

export function normalizeServerConfig(config, pageOrigin) {
  if (!config?.serverUrl)
    throw new Error("No game server address is available yet.");
  const server = new URL(config.serverUrl);
  const page = new URL(pageOrigin);
  const local =
    ["localhost", "127.0.0.1"].includes(server.hostname) &&
    ["localhost", "127.0.0.1"].includes(page.hostname);
  if (server.protocol !== "https:" && !(local && server.protocol === "http:"))
    throw new Error("The game server needs an HTTPS address.");
  if (
    server.username ||
    server.password ||
    server.pathname !== "/" ||
    server.search ||
    server.hash
  )
    throw new Error("Invalid game server address.");
  return {
    origin: server.origin,
    updatedAt: Date.parse(config.updatedAt) || 0,
  };
}

export async function findServer({
  fetcher = fetch,
  pageOrigin = location.origin,
  now = Date.now(),
} = {}) {
  // The repository copy changes as soon as the host pushes its address; Pages
  // can take another minute to deploy. Keep the local copy as an offline fallback.
  const results = await Promise.allSettled(
    [latestConfig, "./server.json"].map(async (source) => {
      const response = await fetcher(`${source}?t=${now}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Address unavailable.");
      return normalizeServerConfig(await response.json(), pageOrigin);
    }),
  );
  const candidates = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const tried = new Set();
  for (const server of candidates) {
    if (tried.has(server.origin)) continue;
    tried.add(server.origin);
    try {
      const response = await fetcher(`${server.origin}/selfhost/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok && (await response.json()).online) return server.origin;
    } catch {}
  }
  throw new Error(
    "The host is offline or still starting. Reconnecting automatically…",
  );
}
