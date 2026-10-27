// Loaded before the game bundle by the PC gateway, including on direct invites.
(() => {
  // Upstream otherwise treats an unidentified cross-origin iframe as a
  // CrazyGames embed and waits for a portal SDK instead of joining our URL.
  window.openfrontSelfHosted = true;
  Object.defineProperty(window, "adsEnabled", {
    get: () => false,
    set: () => {},
    configurable: true,
  });
  window.gtag = () => {};
  try {
    localStorage.setItem("apiHost", `${location.origin}/selfhost-api`);
  } catch {}
  if (window.parent === window) return;
  const allowedParents = new Set([
    "https://gabrielhalloran.org",
    "https://www.gabrielhalloran.org",
    "https://gabe9230.github.io",
    "http://localhost:9081",
  ]);
  let parentOrigin;
  try {
    parentOrigin = new URL(document.referrer).origin;
  } catch {
    return;
  }
  if (!allowedParents.has(parentOrigin)) return;
  const report = () =>
    parent.postMessage(
      {
        type: "openfront:navigation",
        path: location.pathname + location.search,
      },
      parentOrigin,
    );
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method].bind(history);
    history[method] = (...args) => {
      const result = original(...args);
      report();
      return result;
    };
  }
  addEventListener("popstate", report);
  addEventListener("hashchange", report);
  addEventListener("DOMContentLoaded", report);
})();
