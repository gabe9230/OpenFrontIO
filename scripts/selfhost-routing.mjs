// Keep every game request on the same PC; never accept an arbitrary upstream.
export function routeRequest(rawUrl, method = "GET", workers = 2) {
  const url = new URL(rawUrl, "http://localhost");
  const pathname = url.pathname;
  if (/\/(?:adminbot|admin|debug)(?:\/|$)/i.test(pathname)) return null;
  const worker = pathname.match(/^\/w(\d+)(\/.*)?$/);
  if (worker) {
    const index = Number(worker[1]);
    if (index >= workers) return null;
    // Worker HTML requests still need the master's rendered application shell.
    if (/^\/(?:game|player)\//.test(worker[2] ?? "")) {
      return { port: 3000, path: rawUrl };
    }
    return { port: 3001 + index, path: (worker[2] || "/") + url.search };
  }
  if (pathname === "/api/create_game" && method === "POST") {
    return { port: 3001 + Math.floor(Math.random() * workers), path: rawUrl };
  }
  return { port: 3000, path: rawUrl };
}

export function selfhostHtml(html) {
  // The complete game retains its copyright and assets. The official site's
  // advertising, analytics and portal integrations don't belong on this host.
  return html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, body) => {
      if (/\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(attrs)) return "";
      if (/\bid\s*=\s*["']HgWESkOz["']/i.test(attrs)) return "";
      if (/window\.ramp|googletag|gtag\(/.test(body)) return "";
      return tag;
    })
    .replace("<head>", '<head><script src="/selfhost-bridge.js"></script>');
}
