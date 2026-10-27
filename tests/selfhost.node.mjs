import assert from "node:assert/strict";
import test from "node:test";
import { lobbyPath, inviteFromPath } from "../deployment/arcade/lobby-url.mjs";
import { findServer } from "../deployment/arcade/server-connection.mjs";
import { routeRequest, selfhostHtml } from "../scripts/selfhost-routing.mjs";

test("worker APIs preserve queries and route to their owning worker", () => {
  assert.equal(routeRequest("/w1/api/selfhost/snapshot"), null);
  assert.deepEqual(routeRequest("/w1/api/game/a123456789?x=1"), {
    port: 3002,
    path: "/api/game/a123456789?x=1",
  });
  assert.deepEqual(routeRequest("/w0"), { port: 3001, path: "/" });
  assert.deepEqual(routeRequest("/w1/game/a123456789?lobby"), {
    port: 3000,
    path: "/w1/game/a123456789?lobby",
  });
  assert.equal(routeRequest("/w2/api/game/id"), null);
  assert.equal(routeRequest("/w1/api/adminbot/create_game", "POST"), null);
});
test("new games go to a worker and assets stay on master", () => {
  assert.ok(
    [3001, 3002].includes(routeRequest("/api/create_game", "POST").port),
  );
  assert.equal(routeRequest("/assets/game.js").port, 3000);
});
test("arcade invites survive refresh without requiring Pages rewrites", () => {
  const invite = inviteFromPath(
    "https://gabrielhalloran.org/Arcade/openfront/",
    "/w1/game/a123456789?lobby&s=hello",
  );
  assert.equal(
    invite,
    "https://gabrielhalloran.org/Arcade/openfront/?lobby=a123456789&s=hello",
  );
  assert.equal(
    lobbyPath(new URL(invite).search),
    "/game/a123456789?lobby=&s=hello",
  );
  assert.equal(lobbyPath("?lobby=a123456789&live"), "/game/a123456789?live=");
});
test("invalid and cross-origin lobby paths cannot redirect the iframe", () => {
  assert.throws(() => lobbyPath("?lobby=../../other"));
  assert.equal(
    inviteFromPath("https://site.test/", "https://evil.test/game/a123456789"),
    null,
  );
  assert.equal(
    inviteFromPath("https://site.test/", "//evil.test/game/a123456789"),
    null,
  );
  assert.equal(inviteFromPath("https://site.test/", "/streamer-mode"), null);
  assert.equal(lobbyPath(""), "/");
});
test("self-hosted HTML keeps the game and bootstrap but omits official-site ad scripts", () => {
  const result = selfhostHtml(
    '<head><script>window.BOOTSTRAP_CONFIG={};</script><script src="/assets/game.js"></script><script src="https://ads.example/script.js"></script><script>window.ramp={};</script></head><footer>© OpenFront and Contributors</footer>',
  );
  assert.ok(result.includes("BOOTSTRAP_CONFIG"));
  assert.ok(result.includes("/assets/game.js"));
  assert.ok(result.includes("/selfhost-bridge.js"));
  assert.ok(result.includes("© OpenFront and Contributors"));
  assert.ok(!result.includes("ads.example"));
  assert.ok(!result.includes("window.ramp"));
});
test("arcade chooses the latest reachable repository address over a stale Pages deployment", async () => {
  const requests = [];
  const origin = await findServer({
    pageOrigin: "https://gabrielhalloran.org",
    fetcher: async (url) => {
      requests.push(url);
      if (url.startsWith("https://raw.githubusercontent.com"))
        return {
          ok: true,
          json: async () => ({
            serverUrl: "https://new.example",
            updatedAt: "2026-10-27T02:00:00Z",
          }),
        };
      if (url.startsWith("./server.json"))
        return {
          ok: true,
          json: async () => ({
            serverUrl: "https://old.example",
            updatedAt: "2026-10-27T01:00:00Z",
          }),
        };
      if (url === "https://new.example/selfhost/health")
        return { ok: true, json: async () => ({ online: true }) };
      throw new Error("Stale address must not be used.");
    },
  });
  assert.equal(origin, "https://new.example");
  assert.ok(!requests.some((url) => url.startsWith("https://old.example")));
});

test("arcade falls back to local configuration when repository access is unavailable", async () => {
  const origin = await findServer({
    pageOrigin: "http://localhost:9081",
    fetcher: async (url) => {
      if (url.startsWith("https://raw")) throw new Error("Unavailable");
      return {
        ok: true,
        json: async () =>
          url.startsWith("./")
            ? { serverUrl: "http://localhost:9080" }
            : { online: true },
      };
    },
  });
  assert.equal(origin, "http://localhost:9080");
});

test("arcade rejects invalid addresses and reports a recoverable offline state", async () => {
  await assert.rejects(
    findServer({
      pageOrigin: "https://gabrielhalloran.org",
      fetcher: async () => ({
        ok: true,
        json: async () => ({ serverUrl: "http://unsafe.example" }),
      }),
    }),
    /Reconnecting automatically/,
  );
});
