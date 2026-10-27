import assert from "node:assert/strict";
import test from "node:test";
import { lobbyPath, inviteFromPath } from "../deployment/arcade/lobby-url.mjs";
import { routeRequest, selfhostHtml } from "../scripts/selfhost-routing.mjs";

test("worker APIs preserve queries and route to their owning worker", () => {
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
